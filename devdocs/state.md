# Game State, Snapshots, Undo & Save

> Status: design + **Slice 1 (snapshot core + UNDO) implemented**. SAVE/RESTORE
> (serialization to storage) build on the same snapshot and are the next slices.

## Purpose

Capture and restore the **mutable game state** of a running Lamp game, so the
runtime can support UNDO (in-memory) and — on the same mechanism — SAVE/RESTORE
(state serialized to storage). The design goal that shapes everything here is
**extensibility**: adding a new gameplay feature must not require editing the
snapshot code.

This is the Z-machine model: UNDO snapshots the dynamic state; SAVE writes the
same image to storage; RESTORE/LOAD reads it back. One encoder, three uses.

## What is "state" vs "program structure"

Only **mutable game state** is snapshotted. Everything established once at load
and never changed during play is **program structure** and is rebuilt by loading
the compiled module, not by the snapshot.

| Snapshotted (mutable game state) | Not snapshotted (load-time, immutable) |
|---|---|
| object **field values** (`instanceRegistry`) | `typeRegistry`, `kindRegistry`, `relationRegistry` (schema) |
| **relation edges** (`relationInstanceRegistry`) + their name bindings in `nameRegistry` | `eventRegistry`, `changeHandlerRegistry`, `actionRuleRegistry`, `rulebookRuleRegistry`, `relationAdd/RemoveHandlerRegistry` (rules/handlers) |
| **global values** (`globalRegistry`) | `grammarRegistry` (static) |
| **pronoun antecedent** (`pronounIt`) | `vocabIndex` (derived — rebuilt after restore) |

Action instances are transient (built per command, never registered), so they
are not state. The disambiguation continuation (`pendingDisambiguation`) is
within-turn only and is never live at a turn boundary, so it is not snapshotted.

## The value algebra (the only thing a value can be)

Every field value and global value is exactly one of:

- a **scalar** — `string` | `number` | `boolean` | `null` (enum/kind values are
  their plain string label);
- an **object reference** — a live named world instance;
- a **list** — `makeList(...)` of the above.

This algebra is **closed**: new gameplay features add new fields, globals, and
relations, but not new value *kinds*. So the encoder iterates registries
generically and never needs per-feature changes. The *one* place that must
change if a genuinely new value kind is ever added (e.g. a keyed map) is
`encodeValue`/`decodeValue` — a single, localized extension point, guarded by a
`throw` on any unrecognized value.

## Encoded form (JSON-able)

`captureState()` produces a plain, JSON-serializable object (so the same value
feeds UNDO held in memory and SAVE written to storage). References are encoded by
the target instance's **name** (world objects are always uniquely named):

```js
encodeValue:  scalar            -> scalar
              listValue         -> { $list: [ encodeValue(item), ... ] }
              named instance    -> { $ref: "<object name>" }
              (anything else)   -> throw  // catches a new value kind early
```

`decodeValue` is the inverse; `$ref` resolves via `nameRegistry`, `$list` rebuilds
a `makeList`.

## Restore semantics

Restore **overwrites existing instances' fields in place**, preserving object
identity (`===`), rather than deep-cloning the object graph. This is why the
ref-by-name scheme works and why `structuredClone` is *not* used (lists carry a
`first` getter and the graph is full of shared references — both hostile to a
naive clone).

- **Instances:** reconcile the set (remove instances created since the snapshot;
  recreate any deleted since), then clear and reassign each instance's fields by
  direct assignment — **never** via `setField`, so change-handlers do not fire (a
  restore is a state replacement, not gameplay).
- **Relations:** clear all edges and their name bindings, then recreate edges from
  the snapshot; add-handlers do not fire.
- **Globals / pronoun:** set directly.
- Finally, rebuild `vocabIndex`.

## State-provider registry (the extensibility mechanism)

The snapshot core does **not** hardcode the list of state to capture. Each piece
of mutable state is owned by a **state provider** registered with
`registerStateProvider({ key, capture, restore })`:

```js
captureState():  { [p.key]: p.capture() for p in stateProviders }
restoreState(s): for p in stateProviders: p.restore(s[p.key]); then rebuild vocab
```

Four built-in providers are registered at startup, in an order that lets later
providers resolve `$ref`s against already-restored instances:

1. `instances` — object field values (restored first so refs resolve).
2. `globals` — global values (may hold object refs, e.g. `player`).
3. `relations` — relation edges + their name bindings.
4. `pronoun` — the `it` antecedent.

**This is the contract for future features:** any subsystem that introduces new
mutable state outside an object field, global, or relation (e.g. a future
turn-clock counter, scene tracker, or daemon schedule held in a module-level
variable) registers its own provider. The snapshot core is never edited; the new
state is captured because its provider was registered. (Most features won't need
this at all — score, turn counter, and the like are just globals/fields, captured
automatically by the built-in providers.)

A round-trip test (`tests/state`) guards the invariant: play a script, capture,
mutate, restore, and assert the state matches the capture.

## UNDO (Slice 1)

- A bounded **undo stack** of encoded snapshots.
- `runCommand` takes a **checkpoint** (`captureState()` pushed on the stack)
  at the start of each fresh command turn, *before* it mutates — so `undo`
  reverts the command just typed. Disambiguation answers continue the same turn
  and do not checkpoint again.
- **Out-of-world verbs** bypass the turn clock and take no checkpoint. `undo` is
  registered as the first such verb via `registerOutOfWorld(word, handler)`; it
  pops the latest snapshot and restores it (`"[Previous turn undone.]"`), or
  reports `"You can't undo any further."` on an empty stack. This interim
  out-of-world hook will fold into proper out-of-world *actions* when the parser's
  turn cycle (Parser v2) lands.

The library turn loop is unchanged — `undo` typed by the player simply falls
through to `run_command`, which recognizes it. No `lib/` change is required for
UNDO.

## Inputs and Outputs

- **Input (capture):** the live registries.
- **Output (capture):** a plain JSON-able snapshot object.
- **Input (restore):** a snapshot object (from the undo stack now, from storage
  later).
- **Output (restore):** the registries mutated back to the snapshot; `vocabIndex`
  rebuilt; no handlers fired.

## Assumptions

- World objects are uniquely named (`createObject` requires a name), so
  name-based references are stable identifiers.
- Object references as values are always named world instances; relation edges
  are never stored as a field/global value (they live only in
  `relationInstanceRegistry`).
- Enum/kind values are plain strings.

## Non-goals (this subsystem)

- No partial/delta snapshots or inverse-operation logs; full-state snapshot is the
  proven IF approach and is simpler and more robust.
- No persistence transport here — SAVE/RESTORE storage (a file in the stdio host,
  a browser capability later) is a separate slice; see `devdocs/sandbox.md` for
  the capability boundary.

## Roadmap

- **Slice 1 — snapshot core + UNDO. (Implemented.)** Encoder/restore, provider
  registry + four built-ins, undo stack, `runCommand` checkpoint, out-of-world
  `undo`. In-memory only; works in every host.
- **Slice 2 — SAVE/RESTORE to storage (dev host).** `JSON.stringify` the same
  snapshot to a file via a storage native; `restore` clears undo history. Out-of-
  world `save`/`restore` verbs.
- **Slice 3 — browser persistence.** Wire the storage native to the sandbox's
  persistence capability (`devdocs/sandbox.md`), download/localStorage.

## Open questions

- **Undo depth.** Bounded stack (current) vs. single-level (classic Z-machine) vs.
  unbounded. Currently bounded; revisit if memory matters.
- **Save slots & metadata.** Named slots, timestamps, per-save descriptions — a
  Slice 2 concern.
- **Schema drift across saves.** A save from an older build loaded into a newer
  one (added/removed globals or fields). Tolerated loosely today (missing keys
  ignored); a versioning policy is a Slice 2/3 question.
- **`again`/redo.** Redo (un-undo) and `again` (repeat last command) share the
  "remember the last command" need with the parser; deferred.
