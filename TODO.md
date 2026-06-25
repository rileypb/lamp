# TODO

Top recommended next steps, grouped by status and roughly in priority order
within each group. Each item notes *why*, *where*, and what it's *blocked by*.
Sourced from the staged roadmaps and prerequisite lists in
`devdocs/game_parser.md`, `devdocs/rulebooks.md`, and `devdocs/relations.md`.

> The 2026-06-19/20 architecture review (issues A–G) is **fully resolved** — see
> `devdocs/architecture.md` → "Known Architectural Issues" for the per-issue
> record. The only optional remnant is item 6 below.

> Feature backlog awaiting triage: `lurking_todo.md` catalogs candidate verbs,
> grammar, world-model traits, turn-cycle/daemon, and message ideas mined from
> `lurkinghorror.txt`. Text substitution (Slices 1–7) is **all DONE**; the full
> per-slice record lives in `devdocs/text.md`.

## Active

### 1. SAVE / RESTORE — remaining items (Slice 3)
UNDO, dev-host SAVE/RESTORE, the durable CLI save location, and browser
localStorage persistence are **done** (snapshot core + state-provider registry,
versioned save header + strict restore gate, `setSaveChannel` seam, named-slot
`save`/`restore` verbs; tests `tests/state`/`tests/save`/`tests/lighthouse`, design
in `devdocs/state.md`). A native CLI file dialog is **not** pursued (it breaks the
headless/piped/test path); the browser download/upload picker is the right home.
**Decided (2026-06-22): make save/restore UX a host seam** (parallel to
`promptLine`), not hardcoded prose and not a host takeover. Runtime keeps the
blob lifecycle (`captureSave`/`restoreSave`, `buildId` gate, obfuscation,
`saveSlotKey`); each host renders its own UX. The browser shell owns name entry
and a **restore picker** of existing slots (backed by localStorage, where the
store already lives); the CLI degrades to a text name-prompt with `^L`-lists.
**No standalone `saves` verb** — enumeration is an affordance *inside* the restore
flow (the IF-traditional model: `RESTORE` opens the interpreter's picker), not a
command. The seam's restore call is "host, let the player choose a slot, return
the chosen blob (or cancel)"; the runtime validates against `buildId` and applies,
and never needs the slot list itself. Full design recorded in `devdocs/state.md`
→ "Save/restore UX: a host seam (Slice 3b)"; UX mockup at
`src/lighthouse/web/mockup-save-restore.html` (throwaway).
**Built so far** (host-seam, via the broker protocol in `devdocs/sandbox.md`): the
turn counter; the `meta` sidecar on `save_write` (`{ name, savedAt, turns }`,
unobfuscated, both hosts); `save_list`/`listSaves()` (this game's slots, newest first);
and the **browser save dialog + restore picker** (`save_prompt`/`restore_prompt`
deferred modals in `shell.js`/`shell.css`; runtime detects them by `promptSave`/
`promptRestore` on the channel and otherwise uses the CLI text prompt). Unit tests in
`tests/save`, e2e sidecar in the `save1` golden; the browser modals are source-grep +
manual only (the headless gap).
**Remaining:**
- **CLI text-host polish:** `^L`-lists-saves at the name prompt + overwrite-confirmation
  (uses `save_list` + the in-`lib` prompt flow), and a CLI `save_delete`. Rides on item 2.
- **Cancel/error sentinels** (`-1`/`-2`): generalize `save_write`'s `ok`/`error` text
  reply so cancel and failure are distinguishable on every message.
- Optional browser **file export/import** (download/upload) layered over localStorage.
This shares the out-of-world-verb hook with Parser v2 (item 2) and RESTART (item 3).
Reconciles with item 2's "move prompting into `lib`": lib owns the verbs + the
*text-host* wording, but the *rendering* of the prompt/picker is the host seam.

### 2. Parser v2 — every-turn & timed rules + out-of-world actions
Action-rulebook bands are implemented; what remains for v2 is a turn clock:
every-turn rules and timed/scheduled events, plus **out-of-world actions**
(`save`/`undo`/`restore`/`again`). The turn clock should **reuse the minimal turn
counter** added for save metadata (item 1), not introduce a second count, and is
where it would gain an author-facing surface. Also surface the outcome of a player command
(the `run_command` path discards `runAction`'s result, unlike `let x = try`) so
turn rules can see whether the command succeeded.
- **Fold in here:** move the `undo`/`save`/`restore` verb handling + prompting +
  wording **out of the runtime** and into `lib/advent`. Today `performUndo`/
  `performSave`/`performRestore` live in the engine and hardcode English prose —
  a layering smell (`devdocs/state.md` → "Known layering smell"). The fix needs
  `registerOutOfWorld` to accept a **Lamp callback** so the library owns the verbs
  while the runtime keeps the save/restore/snapshot *primitives* — the same
  runtime→Lamp out-of-world hook this item builds, so do it once here.
- **Where:** rulebook driver in `src/lamplighter/index.js`, `run_command` loop.
- **See:** `devdocs/rulebooks.md` roadmap, `devdocs/game_parser.md` v2.

### 3. RESTART support for the end-of-story sequence
The end-of-story mechanism (`story` global, `end_story_rules`, the post-game loop
in `lib/advent/startup.lamp`) is in place but only offers QUIT — there is no state
reset, so RESTART was deferred. Implement it by having the sandbox **host
re-spawn the worker** on a `restart` signal (clean fresh state), which needs: a
`restart` native + message type, host handling in `playFile` (terminate + respawn,
guarding the `exit` handler), and re-enabling RESTART in the end sequence.
Alternative (messier): a runtime-wide `reset()` + re-run. **Where:**
`src/lamplighter/sandbox/host.js` + `worker.js`, `lib/advent/startup.lamp`.
Shares the out-of-world-verb hook with item 2.

### 4. Runtime error diagnostics — Lamp-ish failures, not JS stacks
Make a failure during play trace back to a precise Lamp line (where available) or a
clear Lamp-ish cause, instead of a raw JS exception. **Done (first cut):** a clear
"no starting room" error (seam guard in `lib/advent/startup.lamp`; `game.start`
defaults to `none` so the check fires) and `exe.js` no longer prints `execFileSync`'s
"Command failed" wrapper. **Next:** a `LampError` class with tagged propagation across
the worker boundary + one `formatDiagnostic` shared by all hosts (separate authoring
errors from engine bugs); more seam guards (move-to-none, describe none-room, unfilled
action slot, bad `start` target, list-index range); then either a `--debug-locations`
breadcrumb or **source maps** (recommended) to attach a `.lamp` line to *any* throw,
and debug-mode `field`/`index` accessors that turn raw `none` dereferences into
messages like "tried to read 'lighted' of nothing". Full design + roadmap in
`devdocs/errors.md`. Relates to item 6 (malformed-world startup check) — a core-runtime
guard needs that world contract.

## Optional / hardening

### 5. Lighthouse web bundle — headless CI test (optional)
Web v1 is **built, verified live, shell-polished, and hardened for distribution**
(string encoding + esbuild minify, both covered by `npm run test:lighthouse` /
`npm run test:encode`). **Remaining (optional):** a *headless* browser test that
drives the live loop (worker `Atomics.wait` + shell SAB fill) — closes the last
automation gap but needs a heavy Playwright/Puppeteer dep; decide if worth it for
CI. Also still open: whether to default `--encode-strings` on for distribution
builds. **Where:** `src/lighthouse/`.

### 6. Malformed-world startup check (optional hardening)
Carryover from arch issue C. When the parser is used, assert at startup that a
`physical` type and a containment representation (a `contains` relation, or — until
the migration completes — a `holder` field) exist, so a world library missing the
runtime↔world contract names fails loudly instead of resolving nothing deep in
`scopeOf`/`containerOf`. Low priority. **Where:** `src/lamplighter/index.js` (`run`).

## Design (not scheduled)

### 7. Core-vs-plugin: actions as core and/or an extensible compiler
Proposal recorded in `devdocs/compiler-extensibility.md`: resolve the
"IF baked into the compiler" coupling (arch doc → "Layer boundaries and IF
coupling") by (1) promoting actions+bands to first-class general core, and/or
(2) making Lantern plugin-extensible so a library contributes the action syntax.
Recommended de-risking first step: refactor Lantern into *core + one first-party
plugin* owning the action/IF constructs (no third-party grammar yet), which also
lets the base `action` type move out of the runtime bootstrap. No code until the
direction is chosen. **Where:** `src/lantern/*` (pipeline), `src/lamplighter/index.js`.

### 8. Content windows (status line is the first cut)
The traditional **status line is built on both hosts**: `lib/advent` composes room +
turn count and pushes it via the `status_line`/`turns_taken` primitives; the runtime
ships `{ left, right }` over a `status` message; the **web shell** renders a fixed-width
reverse-video bar, and the **CLI** renders it via an interactive **TUI render backend**
(alt-screen + raw mode; plain stdio for pipes/tests; `LAMP_NO_TUI` forces plain).
Design in `devdocs/windows.md`; backend seam in `devdocs/sandbox.md`. Branch
`CLI-status-bar`.
**CLI TUI:** styled transcript text, in-line editing (←/→, Home/End, Delete), ↑/↓
command history, mouse-wheel scroll (SGR reporting; Shift for native selection),
wrapping an over-long typed command (hard-wrapped by column), and multi-byte/emoji
input (UTF-8 chunk reassembly + code-point editing + display-width column math) are
**done**. Still deferred: batched redraws and keeping the transcript on exit
(alt-screen clears it now).
**Bigger (deferred):** generalize to arbitrary named content windows (the status line
collapses into one), a host capability handshake + headless fallback, and author
override of the status content (e.g. score games). **Where:**
`src/lighthouse/web/`, `src/lamplighter/sandbox/backends/`, `lib/sys`, `lib/advent`.

## Active (design decided 2026-06-25)

### Containment as a `contains` relation (replaces the `holder` field)
**Decision (2026-06-25):** make containment a one-to-many relation `contains`
(`from physical place` → `to physical contained unique`), the *single source of
truth*; `holder` becomes a query helper, not a stored field. This **reverses
world-model.md D1** (containment was the `holder` field; `scopeOf` walked
`inst.holder`) and the "world-iterating consumers never walk graph edges" note
(`index.js:7`) — relation IS now canonical. Per-decision choices: write via a new
core **`move X to Y`** statement (desugars to an assert of `contains Y X`); the
one-container invariant enforced by a **relation-level `unique` cardinality
modifier** on the `to` endpoint (asserting auto-evicts the prior edge); the
`supports` relation **stays separate** (still synced on containment change).
Only `scopeOf` reads `holder` in the runtime (buildVocabIndex does not), so the
core edit is contained. Names (default): `contains`/`place`/`contained`, keyword
`unique`. **Sequence:**
1. ~~Relation `unique` cardinality modifier — parser tag + `addRelation` auto-eviction + unit tests.~~ **DONE (2026-06-25):** `unique` contextual tag in `parseRelationBody` (combines with `inverted` in any order) → AST `uniqueFields` → emitter 7th `defineRelation` arg → runtime `addRelation` evicts colliding edges via `removeRelation` (remove handlers fire, names drop) before insert; dedup still short-circuits identical asserts. Tests: parser units + golden `relation24` (eviction, `?only` one-container invariant, move fires remove+add). Docs: specs.md (decl grammar, `defineRelation`/`addRelation` contract, contextual-keyword lists), relations.md (Cardinality section).
2. ~~`move X to Y` — tokenizer/parser/emitter/checker, desugars to a `contains` assertion.~~ **DONE (2026-06-25):** `move` is a reserved keyword (tokenizer KEYWORDS); `parseMoveStatement` parses `move EXPR to EXPR` → AST `MoveStatement{contained,container}` → emitter `lamplighter.moveObject(contained, container)` → runtime `moveObject` asserts `contains` with container=source/contained=target (endpoint names read from the registry; errors if no `contains` relation), relying on `unique` to evict the prior container. Checker threads both operands into call-checking. Tests: parser units + golden `move1` (orientation + relocate-evicts). Docs: specs.md (reserved words, `moveObject` API, `move` statement section). Note: `move` is now reserved (can't name a function/action `move`); updated a prescan test that used it as a sample name.
3. ~~Rewrite `scopeOf` to walk `contains`; update D1 + the line-7 note.~~ **DONE (2026-06-25):** new `containerOf(inst)` seam reads containment from the `contains` relation (endpoint names from the registry), **per-object falling back to the legacy `holder` field** when an object has no `contains` edge (transitional dual-read, chosen to keep all holder-based fixtures green). `scopeOf` rewritten to walk `containerOf`. Updated the registry comment (`index.js:7`), the D1 contract block (`index.js` + world-model.md: containment is now the `contains` relation, transitionally holder). Test: golden `scope_contains` (item placed via `contains`, no `holder`, resolves by scope; unplaced control rejected). All 141 golden green — no existing fixture touched. **Remaining for step 4:** remove the holder fallback once advent + fixtures migrate.
4. `lib/advent` migration — **planned 2026-06-25**, sub-sequenced so each commit stays green and stdout is invariant (no pinned generated-JS to regen). **Key discovery:** raw `.holder` *field* reads (advent AND cloak.lamp's ~12 own-rule reads, scattered fixtures) go stale the moment writes switch to `contains`, so a naive flip is a huge atomic change. **Bridge (decouples advent from fixtures):** (a) step-3 `containerOf` holder fallback covers field-placed/never-moved items; (b) a transitional advent handler `on contains add: self.contained.holder = self.place` keeps the legacy field correct for anything still reading it. No sample/fixture registers its own holder-change handler (checked), so the bridge can't collide.
   - ~~**4a (advent internals, ~6 files, no fixture changes).**~~ **DONE (2026-06-25):** declared `relation contains` in globals.lamp; added `native function container holder(physical x)` → index.js `holder(x){return lamplighter.containerOf(x);}` (exported `containerOf`); added the sync-bridge `on contains add: self.contained.holder = self.place`; rewrote all advent `.holder` reads → `holder(X)` and writes → `move X to Y`; converted `on person.holder change`→`on contains add: if self.contained==player: describe_room(self.place)` and the supports handler → `on contains remove: remove supports _ self.contained`; ported `contents_of`/`describe_supporters` to `containerOf`. Holder field kept on the types. **All 141 golden unchanged** (no fixture touched, no regen). Two `let here = holder(...)` workarounds needed: `go`'s relation-query slots (function calls disallowed in slots) and `in_darkness` (parser rejects `holder(p).lighted` — see parser item below).
   - ~~**4b (fixtures/samples → contains placement).**~~ **DONE (2026-06-25):** migrated all advent-world fixtures (advent3,4,5,6,7,10,11,12,15,16,19, save1, undo1, undo2, understand1, selector_unknown_tag, study_advent) — `holder X` placements → top-level `contains X obj`; cloak.lamp + advent12 + selector_unknown_tag own-rule `.holder` reads → `holder()`. Standalone parser1/parser_it (own world, use run_command/scope) fully migrated: dropped their `holder` field, declared a local `relation contains`, added `function physical holder(physical x): return contains ?only x`, reads→`holder()`, writes→`move`. All 141 golden stdout-invariant (one expected-output update: selector_unknown_tag's echoed source line). **study.lamp intentionally NOT migrated:** it's a self-contained world that drives actions via `try` (never `run_command`/`scopeOf`), so it doesn't use the runtime containment contract or the `containerOf` fallback and won't break in 4c; migrating would need a `physical`/common-supertype restructure (its `person`/`item` share no parent) for purely cosmetic consistency. Could revisit as a separate sample-polish task.
   - **4c (drop the bridge):** remove the `holder` field from item/person, the sync handler, and the `containerOf` holder fallback; `holder()` becomes pure-`contains`; mark world-model.md migration complete; full test run.
   - **Open (confirm before 4a):** relation shape `contains`/`place`/`contained unique` with `from physical` (lets a person hold inventory); `holder()` native-backed-by-`containerOf` (vs pure `contains _ x ?only`); the sync-bridge approach (vs migrating every fixture read atomically in 4a).
5. Nesting syntax (below) on top — desugars `room R:`/`item hook:` to `contains R hook`.
**Where:** `src/lantern/{tokenizer,parser_rd,emitter,checker}.js`, `src/lamplighter/index.js`, `lib/advent/*`, `devdocs/{relations,world-model}.md`.

## Smaller / opportunistic
- ~~**Parser: allow property access on a call/parenthesized result — `holder(p).lighted`, `(EXPR).field`.**~~ **DONE (2026-06-25):** factored a `collectTrailingFields()` helper in `parser_rd.js`; the call-result branch of `parseIdentExpr` now wraps a `CallExpr` with trailing dots in a `MemberAccess` (parenthesized branch refactored onto the same helper). Emitter already emits `(inner).field`; checker's `applyFieldToType` resolves the field off the call's return type (tolerant/unknown otherwise — no error). Simplified advent `in_darkness` back to `not holder(p).lighted`. Tests: two parser units (call result, chained + parenthesized). `go`'s `let here` stays — that's a *different* restriction (function calls disallowed in relation-query slots, by design). All 141 golden + parser green.
- **Nested/reference object-in-room syntax.** Author sugar for placing items in rooms:
  nested decl (`room R:` → `item hook:` …) and/or a reference form (`item hammer` inside
  a room body). Desugar target **now decided**: the `contains` relation (above) — nesting
  emits `contains <enclosing> <inner>`, layering-clean. Still needs: (a) a **type-name
  prescan set** (prescan collects no types today, object names only at `depth===0`,
  `prescan.js:152`) to tell a nested/reference decl from a field assignment (lexically
  identical: `IDENT IDENT`); (b) a `parseObjectBody` branch (`parser_rd.js:745`) emitting
  the `contains` assertion when the leading token is a known type. Ships as sequence step 5
  of the containment work. **Where:** `src/lantern/prescan.js`, `src/lantern/parser_rd.js`.
- **Output pagination ("[more]") — done, with one gap.** All three interactive hosts
  pause long output a screenful at a time (plain on a TTY, the TUI, and the web shell;
  design in `devdocs/sandbox.md` → "Output pagination"). Known gap: it relies on the
  worker blocking at the next prompt, so a game that prints a screenful and then *ends*
  with no trailing prompt can't be paged in the event-driven hosts (TUI/web) — the end
  message clears the pause. If that matters, have the runtime emit an explicit
  "end-of-output" checkpoint the host can pause on, or page on `done`. **Where:**
  `src/lamplighter/sandbox/backends/`, `src/lighthouse/web/shell.js`.
- **VS Code syntax highlighting (scaffolded).** A declarative TextMate-grammar
  extension lives in `editors/vscode/` (manifest + `language-configuration.json` +
  `syntaxes/lamp.tmLanguage.json`); no deps, loads via `F5`/`--extensionDevelopmentPath`.
  Token model is derived from `tokenizer.js` `KEYWORDS` and `parser_rd.js` `PHASE_WORDS`.
  **Next:** (a) add grammar snapshot tests (e.g. `vscode-tmgrammar-test`, dev-only) so
  the scopes don't silently drift from the compiler; (b) confirm the TextMate grammar
  matches the now-supported **multi-line string literals** (the tokenizer spans lines
  and dedents continuation lines as of this change — verify the grammar highlights a
  string across lines and doesn't treat a `#` inside it as a comment); (c) optionally a
  Language Server reusing the tokenizer/parser for diagnostics + go-to-definition.
  **Where:** `editors/vscode/`.
- **Reassigning a multi-word (underscore) global fails the checker.** `global int
  my_score = 0` then `my_score = 5` reports "assignment to undeclared name
  `my_score`", while a single-word global (`score = 5`) works. The assignment-target
  name coercion (underscore→space) doesn't line up with the global-name set the
  checker holds for multi-word names. Found while wiring `viewpoint_person`
  (Slice 3) — declaring it works, only *reassignment* is blocked. **Where:**
  `src/lantern/checker.js` (assignment-target lookup) + the global-name coercion.
- **Remaining pronouns (`him`/`her`/`them`).** `it` is implemented with
  explicit `direct` slot marking (the `direct item NAME` annotation on action
  field declarations sets the antecedent; at most one per action; enforced at
  compile time). The gendered/plural pronouns need a `pronoun` field (and
  `plural` for `them`) on `thing` plus per-pronoun antecedents. Also open:
  letting the game (not just the player) set the antecedent when it describes
  an object. **See:** `devdocs/game_parser.md` (Pronoun `it`; Open questions →
  Pronouns).
- **Named-rule replacement.** Override suppression works via bare-`stop` +
  author-before-library ordering (now shared by actions and rulebook
  contributions). Replacing *one* library rule out of several (without depending
  on registration order) needs named rules. See `devdocs/rulebooks.md` roadmap
  (*Next — identity & ergonomics*).
- **`list<T>` field types end-to-end.** Parsing is now covered by a parser unit
  test, but no fixture declares a `list<T>` field and exercises it through
  emit/runtime. Add one to lock in end-to-end behaviour.
