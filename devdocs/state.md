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

- A bounded **undo stack** of encoded snapshots. The depth is the
  author-settable **`undo_limit`** global (declared in `lib/sys`, default 32),
  read fresh each checkpoint exactly like the `oxford_comma` presentation setting
  — so a game can change it at runtime (`undo_limit = 10`), and `undo_limit = 0`
  disables undo. The runtime falls back to 32 when the global is absent (a program
  not using the standard library) or invalid. Because it is an ordinary global it
  is itself snapshotted (harmless and consistent with `oxford_comma`); the undo
  *stack* is not part of game state and is never snapshotted.
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

## SAVE / RESTORE (Slice 2)

SAVE is the snapshot plus a **versioned header**, written through a host storage
seam; RESTORE reads it back behind a strict compatibility gate.

**Save versioning.** A save is keyed by names (objects, globals, fields,
relations); if the compiled build changed shape, those keys may not line up, so a
cross-build restore can silently corrupt the world. RESTORE therefore
**detects-and-refuses** rather than best-effort migrating (the Z-machine model:
saves carry the story's release/serial/checksum and `@restore` refuses on
mismatch). Two identifiers:

- **`buildId`** — a reproducible content hash Lantern computes over the
  compilation *source inputs* (not the emitted JS, so it is invariant under
  `--encode-strings`), stamped into the module via `setBuildId`. Identical source
  → identical id (a no-op recompile keeps saves valid; a build on another machine
  validates the same save); any change → a different id. This is the
  compatibility gate, and being a *hash* it is reproducible and could later be
  narrowed to a schema-only fingerprint — neither true of a random-per-compile id.
- **game name + author** — read from the game object at save time, so RESTORE can
  distinguish a save for a *different game* from one for an *older build of this
  game*, for the refusal message.

The author-facing `version`/`release` fields stay display-only; they are not the
gate (an author would forget to bump them after a structural change).

**Header.** `{ format, buildId, gameName, gameAuthor, savedAt, state }`.
`restoreSave` checks format → game → version in that order and returns
`{ ok }` / `{ ok:false, reason }`; on success it `restoreState`s and clears undo
history. It never restores on a mismatch.

**Storage seam.** The host injects a save channel (`setSaveChannel({ write, read })`)
so the engine stays host-agnostic. The dev/CLI host brokers it like input: the
sandboxed game posts `save_write`/`save_read`, the host does the filesystem op
and replies over a dedicated `SharedArrayBuffer` (a `-1` length is the
"no such save" sentinel). Saves are addressed by **named slots** (the `save`/
`restore` out-of-world verbs prompt for a name), namespaced per game so two games'
identically-named slots don't collide. The dev host stores them under a temporary
directory (provisional; a durable per-user location is a later concern). The
browser host wires the same seam to its own persistence (Slice 3).

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
- **Slice 2 — SAVE/RESTORE to storage (dev host). (Implemented.)** Versioned
  header (`buildId` + game identity), `captureSave`/`restoreSave` with the strict
  restore gate, the `setSaveChannel` storage seam brokered to the filesystem by
  the dev host, and named-slot `save`/`restore` out-of-world verbs. Unit test
  `tests/save`; golden `save1`.
- **Slice 3 — browser persistence.** Wire the save channel to the sandbox's
  persistence capability (`devdocs/sandbox.md`) — download/localStorage. Also
  open: a durable save location for the CLI host, and save-slot listing/metadata.

## Open questions

- **Undo depth.** Bounded stack, depth = the author-settable `undo_limit` global
  (default 32; `0` disables). Single-level (classic Z-machine) or unbounded are
  just other `undo_limit` values; no further decision needed.
- **Save slots & metadata.** Named slots, timestamps, per-save descriptions — a
  Slice 2 concern.
- **Schema drift across saves.** A save from an older build loaded into a newer
  one (added/removed globals or fields). Tolerated loosely today (missing keys
  ignored); a versioning policy is a Slice 2/3 question.
- **`again`/redo.** Redo (un-undo) and `again` (repeat last command) share the
  "remember the last command" need with the parser; deferred.
