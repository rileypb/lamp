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

**`text` values are not a new kind.** A `text` value (a lazily-rendered template;
see `devdocs/text.md` K2 and the `text` primitive in `specs.md`) is a transient,
computed value — a thunk, like a function reference — and is deliberately kept
*out* of the algebra. A `text` is **program (a rendering rule), not state**, so it is
never serialized as a closure. Instead, a template literal that captures no lexical
binding gets a build-stable **id** (assigned by the emitter, registered at module load),
and a `text`-valued field serializes as a reference to it — `{$tmpl: id}` — which restore
rebuilds into a **live** thunk (`instantiateTemplate`). So a stored template stays dynamic
across undo/save/restore. See `devdocs/text-persistence.md` (Phase 1). Text that *can't* be
referenced this way — a template capturing `self`/a local/the action context, or one
composed at runtime — falls back to **freezing to its current rendered string** (an
ordinary scalar): still saveable, but a dead string that no longer tracks.

> **Resolved (2026-07-01) for the common case; residual fallback documented.** Previously
> `encodeValue` froze *every* `text` field, so undo, save, and restore all turned a live
> template into a dead string that went stale on the next state change (`bump.lamp` repro:
> `look / bump / look / undo / bump / look` showed the pre-undo value; `save`+`restore`
> was identical). Phase 1 of `devdocs/text-persistence.md` fixes this for every template
> that reads only globals/functions/literals — i.e. **all construction descriptions** (a
> construction default has no `self`/local scope by design) and rule-assigned templates
> like `now description is "I said [FOO]."`. Regression: golden `textlive1` (undo *and*
> save/restore). As a bonus, a persisted template is no longer *rendered* at capture, so it
> no longer advances `[first time]`/`[cycling]` cursors as a side effect (the
> `devdocs/text.md` "read-only render flag" issue, on the capture path).
>
> **Residual fallback (freezes, as before):** a template that captures a lexical binding —
> `self`, a `let`, or the transient action context — or one composed at runtime (`a + b`).
> These are exactly what I7 also can't persist. Phase 2 (`text-persistence.md`) adds
> `self`-capture; the rest stays freeze-and-document. So a *runtime-composed* or
> *local-capturing* stored template should still use a `freeze`-d string or a plain field
> the template reads.

**The render context is render-local and never saved.** Slice 3's adaptive sugar
reads a per-render context (the third-person `subject`, the verb `agreement`
descriptor, and the governing `count`) that is created at the outermost render
boundary and discarded when that render returns — it never outlives a single
`print`/`freeze`. So it is not part of any snapshot; `captureState`/`restoreState`
neither read nor write it. (The story viewpoint that drives `[We]` is a separate,
ordinary saved global — `viewpoint_person`/`viewpoint_plural` — not render state.)

**Per-site variation state IS saved (the site-durable tier).** The other half of the
text render context is per-call-site cursor state — the `[first time]` visit count
(Slice 4b), and the `[cycling]`/`[stopping]`/sticky cursors to come (Slice 4c). This
must survive across turns and snapshots, or a restored game would re-show a
`[first time]` block or re-shuffle a cycle. It is keyed by a compile-time **site id**
(allocated deterministically by the emitter and stable for a build, so it lines up
under a buildId-gated restore) and held in the runtime's `variationState` map,
captured by the `variation` state provider. Round-tripped in `tests/state`. This is
the site-durable tier of `devdocs/text.md` "Render context", distinct from the
never-saved render-local tier above. The random variation modes (`[at random]`,
`[in random order]`, `[sticky random]`) store their per-site cursors (`{last}` /
`{order, pos}` / `{chosen}`) in the same `variation` provider, and the **seeded
RNG** stream position is captured by a separate `rng` provider — so a restored game
reproduces the same draws rather than diverging.
This is the render-local tier of `devdocs/text.md` "Render context"; only the
site-durable tier (the future `[cycling]`/RNG cursors) will need a state provider.

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
mutable state outside an object field, global, or relation (e.g. the **turn
counter** added for save metadata — a module-level count not held in any field or
global — or a future scene tracker or daemon schedule) registers its own provider. The snapshot core is never edited; the new
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
- **Out-of-world verbs** bypass the turn clock and take no checkpoint.

  **Meta-verbs — layering-smell fix DONE (2026-06-30).** `undo`, `save`, and `restore`
  are no longer runtime verbs: all three are **out-of-world Lamp actions** in
  `lib/advent/save.lamp` that call runtime *primitives*, so every player command — meta or
  in-world — now resolves through the **single grammar path**. The old single-token
  `outOfWorldCommands` dispatch table (and `registerOutOfWorld`) is gone; command
  recognition has one home.

  The runtime keeps only the mechanism. For save/restore: the snapshot, the
  versioned/obfuscated blob, the build-compatibility gate, the storage seam, and access to
  a host's native save UI — exposed as `save_available` / `save_has_picker` /
  `save_pick_name` / `save_to_slot` and `restore_has_picker` / `restore_pick_blob` /
  `restore_read_slot` / `restore_apply_blob`. For undo: the checkpoint stack +
  `undo_turn()` (pop-and-restore, returns whether a turn was undone). The library owns the
  verb words and all wording (named/overridable messages); for save/restore the browser's
  modal name-entry stays a *host* seam reached through `*_has_picker` / `*_pick_*` (the
  verb only chooses text-prompt vs. defer-to-host — see "Save/restore UX: a host seam"
  below). This is the same split SCRIPT/TRANSCRIPT use; transcript was the proof-of-
  concept, save/restore/undo the applications.

The library turn loop is unchanged — `undo`/`save`/`restore` typed by the player resolve
through `run_command`'s grammar path like any other verb; being `out_of_world`, they spend
no turn and take no checkpoint.

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

**Obfuscation.** The serialized blob is run through the same reversible XOR+base64
codec as `--encode-strings` (`src/strcodec.js`) before it leaves the runtime, and
decoded on the way back in. This discourages a casual peeker from reading or
hand-editing a save; it is **not** security — the key ships in the runtime, so a
determined cheater can reverse it (decode with `src/strcodec.js`). Files use a
`.sav` extension (opaque, not JSON). The build-compatibility gate still rejects
edited-then-mismatched saves regardless.

**Storage seam.** The host injects a save channel (`setSaveChannel({ write, read })`)
so the engine stays host-agnostic. The dev/CLI host brokers it like input: the
sandboxed game posts `save_write`/`save_read`, the host does the filesystem op
and replies over a dedicated `SharedArrayBuffer` (a `-1` length is the
"no such save" sentinel). Saves are addressed by **named slots** (the `save`/
`restore` out-of-world verbs prompt for a name), namespaced per game so two games'
identically-named slots don't collide. The dev/CLI host stores them in a durable
per-user app-data directory following each platform's convention (macOS
`~/Library/Application Support/lamp/saves`, Linux `$XDG_DATA_HOME/lamp/saves`,
Windows `%APPDATA%/lamp/saves`); `LAMP_SAVE_DIR` overrides it (the golden tests set
it to a throwaway dir so they never touch the real location). The browser host
wires the same seam to its own persistence (Slice 3).

## Save/restore UX: a host seam (Slice 3b)

> Status: **design** (2026-06-22). The blob lifecycle (Slice 2) is built; this is
> the UX layer over it. Mockup: `src/lighthouse/web/mockup-save-restore.html`.

Decision: the save/restore **UX is a host seam**, parallel to `promptLine` — not
hardcoded engine prose, and not a wholesale move into the host. The split:

- **Runtime keeps the blob lifecycle** — `captureSave`/`restoreSave`, the `buildId`
  compatibility gate, obfuscation, `saveSlotKey` namespacing. None of this can leave
  the runtime; it needs the live registries, build id, and game identity.
- **The host renders the UX** — name entry, the restore picker, slot listing, delete.
  Each host implements the seam its own way: the browser shell with native widgets,
  the CLI with a text name-prompt (the `lib`-side wording of TODO item 2). The
  *store* already lives host-side (browser localStorage; CLI app-data dir), so
  enumeration and deletion are naturally host operations on data the host owns.
- **The runtime never lists saves.** Restore is "host, let the player choose a slot,
  return the chosen blob (or cancel)"; the runtime validates it against `buildId` and
  applies. So there is **no `saves` verb** — enumeration is an affordance *inside* the
  restore flow, matching the IF-traditional model where `RESTORE` opens the
  interpreter's picker rather than a game command listing files.

**Verb role.** `save`/`restore` (and optional shell Save/Restore buttons) become thin
triggers that hand off to the host seam, instead of driving an in-game `promptLine`.

**Browser UX (the two modals).**
- *Save* — a name field plus the existing-saves list. Clicking an existing slot fills
  the name and flips the primary button **Save → Overwrite**; the list *is* the
  overwrite-confirmation surface, so there is no second dialog. (On a fresh game the
  list is empty and collapses.)
- *Restore* — a selectable picker (↑/↓/click, Enter/double-click restores), per-row
  delete, and the standard refusal messages (different game / different version /
  corrupted) still printed to the transcript by the runtime after a failed validate.
- Slot metadata columns: **name · timestamp · turn count**. Timestamp is
  host-derived (localStorage write time); **turn count is game-derived and rides along
  in the capture** — see the protocol note below. The turn count itself is **built**: a
  minimal engine-internal counter (`advanceTurn`/`turnsTaken`) incremented at the
  `runCommand` checkpoint site, captured by the `turns` state provider so it survives
  undo/restore (a forerunner of the Parser v2 turn clock; see "State-provider
  registry"). It is surfaced host-readably via the **`meta` sidecar** (built — both hosts
  write `{ name, savedAt, turns }` beside the blob; see `devdocs/sandbox.md`) and read
  back by **`save_list`** (built — `listSaves()` enumerates this game's slots, most-recent
  first). The **browser restore picker and save dialog are built** (`save_prompt`/
  `restore_prompt` deferred modals in `shell.js`; the runtime detects the capability by
  `promptSave`/`promptRestore` on the channel and otherwise falls back to the CLI text
  prompt). What remains is the CLI-side polish: the `^L`-list at the name prompt and an
  overwrite-confirmation, which ride on the in-`lib` prompt flow (item 2).

**Broker protocol growth.** The wire protocol is specified in `devdocs/sandbox.md`
→ "Save/restore broker protocol" (message catalog, reply/sentinel encoding, the
inline-vs-deferred contract). In brief: today's channel carries only
`save_write(key,text)` / `save_read(key)` and replies *inline synchronously* (suited
to synchronous localStorage). The seam adds:
- `save_list` — host enumerates **this game's** slots and returns `{ name, savedAt, turns }`
  rows. **Filtering is mandatory, not incidental:** the `lamp:save:` localStorage
  namespace is shared by every Lamp game on the same origin, so a naive scan of the
  whole prefix would surface other games' saves (origin isolation hides this when each
  bundle is its own origin, but a shared-origin portal or local dev would leak). The
  host doesn't know the game name — only the runtime does (`gameInfo().name` /
  `saveSlotKey`) — so the request must carry the game's key-prefix
  (`<safeGameName>__`) from the runtime; the host filters localStorage to
  `SAVE_KEY_PREFIX + that prefix` and strips it back off for the displayed slot name.
  (Caveat: `safe()` sanitization can collapse distinct names to one prefix, and two
  different games sharing name+author share a namespace — `buildId` separates
  *versions*, not *games*; consider a stronger namespace key if a shared origin is ever
  expected.)
- **Metadata visibility.** The picker's timestamp/turn-count columns live in the
  *obfuscated* blob header (`savedAt` + the added turn count), which the host can't
  read. So either store an **unobfuscated metadata sidecar** beside each blob (host
  renders the picker with no runtime round-trip — preferred, at one extra key per slot)
  or have the runtime decode for the list.
- a **save-with-metadata** variant so game-derived metadata (turn count, and room/score
  if wanted) travels with the blob and the picker can label slots.
- a **deferred-reply** contract for the async modal: a name-entry or picker modal waits
  on a user event, so the host must reply *after* the interaction (the input channel's
  `requestInput`→`deliverLine` shape) rather than inline. The worker is already blocked
  on `Atomics.wait`, exactly as it is during `readline`, so no new blocking primitive is
  needed — only the deferred-reply shape on the save channel.

**Reconciliation with the layering-smell fix — DONE (2026-06-30).** That fix moved the
verb words and prompting wording into `lib`, refined exactly as planned: `lib/advent/
save.lamp` owns the *verbs* and the *text-host wording*, while the *rendering* of the
prompt/picker stays a host seam — a host with a native save UI (the browser) supplies its
own widgets (reached via `save_has_picker`/`restore_has_picker` + `save_pick_name`/
`restore_pick_blob`), a text host (CLI) gets the `lib` prose. The runtime keeps the blob
lifecycle as primitives (`save_to_slot`, `restore_apply_blob`, …). "Move prompting into
`lib`" held, read as "for hosts without a native save UI."

**Where:** `src/lamplighter/index.js` (blob-lifecycle + host-seam primitives; metadata in
`captureSave`), `lib/sys/{functions,index}.{lamp,js}` (native bridge),
`lib/advent/save.lamp` (verbs + wording), `src/lamplighter/sandbox/{worker-browser,worker,
host}.js` + `src/lighthouse/web/shell.js` (protocol + deferred replies),
`src/lighthouse/web/{shell.js,shell.css,index.html}` (modals).

## Transcript (scripting)

`SCRIPT` / `TRANSCRIPT` mirror the live session — the game's output **and** the
player's prompts and typed commands — to a host-written text file, the classic IF
"scripting" feature. It is **not** game state: a transcript is never snapshotted, and
UNDO/RESTORE neither stop nor rewind it; it simply records what scrolled past.

**Mechanism vs. policy — the split.** Unlike `undo`/`save`/`restore` (native verbs
hardcoded in the runtime, the documented "layering smell" above), transcript is built the
right way: the **runtime owns only the mechanism**, the **library owns the policy**.

- **Runtime (mechanism, `src/lamplighter/index.js`).** The capture wiring and a host file
  seam, exposed as four primitives: `transcriptStart(name) → bool` (open; false if
  unavailable, already running, or the host failed), `transcriptStop()`,
  `transcriptRunning() → bool`, `transcriptAvailable() → bool`. These *must* be the
  runtime's: output and input flow through its stream manager, which a Lamp game can't
  reach. The runtime also owns the filesystem-safe filename stem (`transcriptKey`) —
  just the player's name sanitized, **not** game-namespaced like a save key: a save is an
  opaque blob in a shared store (the `<game>__` prefix prevents collisions), but a
  transcript is a human-named artifact the host drops in the working directory, so the
  player gets a plain `<name>.txt`. Surfaced to Lamp as the lib/sys natives
  `transcript_start` / `transcript_stop` / `transcript_running` / `transcript_available`.
- **Library (policy, `lib/advent/transcript.lamp`).** The verb words, the filename
  prompt, and the wording. Two **out-of-world Lamp actions** (`script_on`/`script_off`,
  built on the `out_of_world` action mechanism) carry the grammar — `script`,
  `script on`, `transcript`, `transcript on` start; `script off` / `transcript off` stop
  — guard on `transcript_running`/`transcript_available`, prompt via `prompt(...)`, and
  print named/overridable messages (`transcript_started:"…"`, etc.). A game can reword,
  localize, or omit the feature by not loading the file. This is the worked example for
  migrating undo/save/restore the same way (TODO item 2).

**Capture hooks.** All output flows through one chokepoint, `hostWrite`, which forwards
to the host sink and — when a transcript is open — mirrors the plain text (styles ride
only to the host). The player's input is echoed by the host/terminal, bypassing the
output stream, so `promptLine`/`readLine` separately feed the prompt + typed line into
the transcript. The toggle is a single module flag (`transcriptActive`). Ordering makes
the wording land naturally: the action calls `transcript_start` (file opens), *then*
prints "Transcript started.", so the confirmation is the file's first line; on stop it
calls `transcript_stop` (capture off) *before* printing "Transcript ended.", so that line
is screen-only. A failed host open, or a write error mid-session, silently drops the
transcript rather than disrupting play.

**Where:** `src/lamplighter/index.js` (capture hooks + primitives + `setTranscriptChannel`
seam), `lib/sys/{functions,index}.{lamp,js}` (native bridge), `lib/advent/transcript.lamp`
(verbs + wording), `src/lamplighter/sandbox/{worker,host}.js` (broker + file writes). The
wire protocol is in `devdocs/sandbox.md` → "Transcript broker protocol". A host that
installs no transcript channel (today's browser worker) makes `transcript_available`
false, so SCRIPT reports it unavailable — a follow-up, like the browser save UX.

## RESTART (design — reload, not snapshot)

RESTART throws away the current game and begins again from the start. It is **not yet
implemented**; this section records the design decision so it isn't re-litigated.

**Requirement.** RESTART must re-run `on startup`, because that is where the introductory
text is shown *and* where any startup randomness (`randomize()`) is rolled. Restoring a
post-startup snapshot (skip the intro, freeze the randomness) is therefore not RESTART.

**Why not an in-process snapshot baseline (rejected).** The tempting cheap path is to
snapshot the world in `run()` *before* `fireEvent("startup")`, then on RESTART restore
that baseline and re-dispatch `startup`. It fails on two counts, and the second is
fundamental:

1. **It crashes.** `captureState` freezes templates by *rendering* them (see the value
   algebra above). Capturing pre-startup renders every object's description against a
   world that isn't built yet — doors unwired, the player placed nowhere, and globals
   that `startup_rules` initializes still at their declaration defaults. phobos's
   `siriusian` cipher reads the `scan_levels` global (`none` until startup) and throws;
   list-literal global defaults don't compile, so it can't even be defaulted away.
2. **It's incoherent.** "The state of the world before it has been set up" is not a
   world — it is a pile of constructed objects with no relationships, no placement, and
   uninitialized globals. The rendering crash is the symptom: a description can't render
   because it describes a world that doesn't cohere yet. The notion of "the initial state
   to restart to" only exists *after* initialization. Re-running startup on top of a
   snapshot of the pre-init rubble is backwards — and templates can't be snapshotted
   faithfully anyway (the freeze limitation above).

**Decision — reload (host respawn).** "Start over" means **re-initialize**, and raw
construction isn't snapshottable — it is *code* that must re-execute. So RESTART
re-executes the module: the host **terminates and re-spawns the worker** on the same
generated file (`src/lamplighter/sandbox/host.js`), giving a fresh module load — fresh
construction (live template thunks, a clean object graph) and `on startup` from scratch.
This is truly pristine and sidesteps `captureState` entirely, so it inherits none of the
template-freeze problems. Cost: per-host respawn logic (CLI now; the browser
worker/shell later) plus guarding the `exit` handler so a restart isn't read as
"game over". (An in-process `reset()` + re-execute keeps it host-agnostic but must clear
*every* registry correctly — one miss is silent corruption — so the respawn, which gets a
fresh module scope for free, is preferred.) Recognition mirrors QUIT: RESTART is
session-control (it unwinds the loop), so the library command loop recognizes it, not the
parser. See TODO item 3.

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
  registry + four built-ins, undo stack, `runCommand` checkpoint, and `undo`. (The verb
  moved to `lib/advent/save.lamp` on 2026-06-30 — an out-of-world Lamp action over the
  `undo_turn()` primitive; see the layering-smell fix above.) In-memory only; works in
  every host that loads a library defining the verb.
- **Slice 2 — SAVE/RESTORE to storage (dev host). (Implemented.)** Versioned
  header (`buildId` + game identity), `captureSave`/`restoreSave` with the strict
  restore gate, the `setSaveChannel` storage seam brokered to the filesystem by
  the dev host, and named-slot `save`/`restore`. (The verbs themselves moved to
  `lib/advent/save.lamp` on 2026-06-30 — out-of-world Lamp actions over the runtime
  blob-lifecycle primitives; see the layering-smell fix above.) Unit test `tests/save`;
  golden `save1`.
- **Slice 3 — browser persistence. (Implemented, localStorage.)** The browser
  worker installs the same brokered save channel as the CLI; the shell
  (`src/lighthouse/web/shell.js`) backs it with **localStorage** over a second
  shared buffer (synchronous, so it fits the blocking broker with no async work).
  Named slots persist per game across reloads. The durable CLI save location is
  also done (per-user app-data dir + `LAMP_SAVE_DIR`). Build-smoke coverage in
  `tests/lighthouse`; the live browser loop is manually verified (the headless
  test gap is the same one already noted for input).
- **Slice 3b — save/restore UX as a host seam. (Design, 2026-06-22.)** Browser
  name-entry + restore-picker modals (mockup:
  `src/lighthouse/web/mockup-save-restore.html`); the `save_list`/metadata protocol
  additions and the deferred-reply contract; no `saves` verb (enumeration lives in
  the restore flow). See "Save/restore UX: a host seam" above. Optional browser
  **file export/import** (the native download/upload path) layers on top. A native
  CLI file dialog is deliberately *not* pursued (it breaks the headless/piped path).

## Open questions

- **Undo depth.** Bounded stack, depth = the author-settable `undo_limit` global
  (default 32; `0` disables). Single-level (classic Z-machine) or unbounded are
  just other `undo_limit` values; no further decision needed.
- **Save slots & metadata.** Named slots, timestamps, turn count; **resolved** to
  name · timestamp · turn count for the picker (see "Save/restore UX: a host seam").
  Per-save free-text descriptions remain optional/future.
- **CLI save-name-prompt UX (now unblocked — the verb move is done).** The
  `save`/`restore` verbs and their prompting now live in `lib/advent/save.lamp`, so the
  CLI name prompt — the text-host rendering of the host seam — can offer: `^L` to **list**
  this game's existing saves, and an **overwrite-confirmation** before clobbering an
  existing slot. Both need a save-slot listing/exists primitive surfaced to Lamp
  (`listSaves` exists in the runtime but has no native yet) plus the in-`lib` prompt flow.
  Tracked in TODO item 1 (Slice 3).
- **Schema drift across saves.** A save from an older build loaded into a newer
  one (added/removed globals or fields). Tolerated loosely today (missing keys
  ignored); a versioning policy is a Slice 2/3 question.
- **`again`/redo.** Redo (un-undo) and `again` (repeat last command) share the
  "remember the last command" need with the parser; deferred.
