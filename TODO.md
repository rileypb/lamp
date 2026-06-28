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
**Every-turn rules DONE:** advent declares an `every_turn_rules` rulebook the command
loop **follows once per turn** (`if run_command(...): if story == ongoing: follow
every_turn_rules()`). `run_command` now returns **true iff a turn was spent** (an action
ran), so parse failures / disambiguation prompts / out-of-world verbs fire nothing.
Games add side-effect `rule every_turn_rules:` (don't `stop`, so all run). Golden
`everyturn1` (countdown daemon that ends the story + the parse-failure-spends-no-turn
case); Phobos wires the suit auto-power-down **and the self-destruct doom-clock** on it.
Docs: specs.md "Every-turn rules". The **doom-clock** (`sample/phobos/lib/phobos/
countdown.lamp`) is the first real proof of the counter-in-an-every-turn-rule pattern: a
turn counter ticks down, the PA announces it (Siriusian) once Galaxy is inside the base,
and at zero it sets `story = lost` and ends the game with custom `end_story_rules` text.
**Remaining for v2:** **timed/scheduled events** (fire-once-at-turn-N — today done with a
counter in an every-turn rule, as the doom-clock shows; a built-in scheduler is the
convenience layer) and
**out-of-world actions** (`save`/`undo`/`restore`/`again`). Reuse the turn counter (item
1), don't add a second count.
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
defaults to `none` so the check fires); `exe.js` no longer prints `execFileSync`'s
"Command failed" wrapper; and unset **primitive** fields now read as their zero
(`string`→`""`, `int`/`real`→`0`, `bool`→`false`) instead of JS `undefined`, so an
unset `string` prints "" not the literal "undefined" (`collectDefaults` backfills
zeros from the field schema; specs.md "Unset field values"). **Next:** a `LampError`
class with tagged propagation across
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
`physical` type and a `contains` relation exist, so a world library missing the
runtime↔world contract names fails loudly instead of resolving nothing deep in
`scopeOf`/`containerOf` (which now returns null when no `contains` relation is
defined). Low priority. **Where:** `src/lamplighter/index.js` (`run`).

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
   - ~~**4c (drop the bridge).**~~ **DONE (2026-06-25):** removed `container holder` from advent `item`/`person`, the `on contains add` sync handler, and the `containerOf` holder fallback (now returns null when no `contains` edge / no relation). `holder()` is pure-`contains`. Updated index.js contract comments + world-model.md (transitional language removed; `contains` is the sole containment representation). Verified no `.holder` field refs remain in advent or the runtime. **All 141 golden + state/save/parser/tokenizer/prescan/native-scan/liborder green** — dropping the field broke nothing, confirming nothing depended on it. **Containment migration (steps 1–4) COMPLETE.** Optional leftovers: migrate `sample/study.lamp` (self-contained, deferred above) and item 6's startup guard.
   - **Open (confirm before 4a):** relation shape `contains`/`place`/`contained unique` with `from physical` (lets a person hold inventory); `holder()` native-backed-by-`containerOf` (vs pure `contains _ x ?only`); the sync-bridge approach (vs migrating every fixture read atomically in 4a).
5. Nesting syntax (below) on top — desugars `room R:`/`item hook:` to `contains R hook`.
**Where:** `src/lantern/{tokenizer,parser_rd,emitter,checker}.js`, `src/lamplighter/index.js`, `lib/advent/*`, `devdocs/{relations,world-model}.md`.

## Smaller / opportunistic
- ~~**Galaxy Suit + power-up (Phobos)**~~ **DONE** (`sample/phobos/lib/phobos/suit.lamp`):
  worn suit, POWER UP/DOWN, and a powered smash. The **ATTACK/HIT/SMASH/PUNCH verb is in
  advent** (any `item`; default declines via `attack_violence`; golden `attack1`); the suit
  layers the powered door-smash via `instead attack` (purple resists), falling through to
  advent's default otherwise — a testing shortcut past the hacking puzzles. The every-turn
  **auto-power-down** is now wired (item 2's `every_turn_rules`; the power-up turn is
  skipped via a flag). Deferred: the power banner (rides on scoring) and the locker-smash
  variant.
- **`--encode-strings`: encode name literals inside inlined native JS (backlog).** Today
  the encoder rewrites name literals only in *emitter-emitted* code; strings inside a lib's
  `index.js` are inlined verbatim, so structural names a native references by literal stay
  plaintext in the encoded build (in `lib/advent`: relation names `connects`/`doorway` via
  `wire_doors`/the door scope-provider, type names `door`/`item`, and the `oxford comma`/
  `viewpoint …` globals). **Not a runtime bug** (names decode back to the same plaintext
  registry keys at load, so encoded doored games run fine) and **not author content** (only
  framework names leak; the game's prose + own names are encoded) — accepted + documented in
  `devdocs/lighthouse.md`, and the encode test (`tests/encode/run-encode.js`) excludes the
  native-called verbs (`getGlobal`/`type`/`addRelation`/`queryRelationValue`). **To close
  it:** either (1) **targeted literal substitution** in the inlined native source using the
  encoder's existing name→code map (fragile — risks matching a name in a native comment/
  unrelated string, and breaks the "native JS is verbatim" contract; would need careful
  scoping/tests), or (2) **runtime indirection** so natives reference relations/types by an
  opaque handle instead of a name literal (cleaner, broader native↔runtime API refactor).
  **Where:** `src/lantern/emitter.js` + `src/strcodec.js` (option 1), or the
  `lamplighter` native API (option 2).
- ~~**Door subsystem for advent (Phobos port).**~~ **DONE.** A `door` type (in
  `types.lamp`, after its parent `item`) declares its two sides as `<direction>
  <room>` fields (destination semantics — `north RoomB` = "go north to reach it");
  the `wire_doors` native (called at startup) materializes two directed `connects`
  edges + two `doorway` edges. Scope via a general **scope-provider seam**
  (`registerScopeProvider` + `scopeOf` union) — advent registers a provider
  surfacing the current room's doors (also the seam for future backdrops /
  `place-in-scope`). Closed door blocks `go` (`door_closed` reason). **Option A
  consistency check** in `checker.js`: a door must set exactly two directional
  `room` fields (keyed on field signature, not the type name, so a user `door` is
  unaffected). Tests: golden `doors1` (block / two-sided scope / open+pass /
  traverse) + `door_too_many` (compile error); 157 golden + state + save green.
  Phobos's 6 doors wired in `sample/phobos/lib/phobos/base.lamp` (base sealed until
  a HACK/unlock verb exists). Docs: specs.md (Doors section, `door`/`doorway`,
  `registerScopeProvider`, `door_closed`). **Follow-ups:** (B) a general
  library-contributed consistency pass (decoupled; reusable for room-reachability /
  edge-collision / action-slot invariants — first slice of item 7); standard
  OPEN/CLOSE/LOCK/UNLOCK door verbs; door **parts** (handprint scanners) as
  `contains` vs. a distinct `part_of` relation; door-closed message is a plain
  print (i18n gap — names a non-slot local).
- **Phobos third-person presentation + Siriusian cipher (port) — in progress.**
  **Room heading DONE:** advent factors the heading into an overridable
  `room_heading_rules(room r)` rulebook (default byte-identical) + `room`
  `preposition`/`always_indefinite` fields; Phobos contributes a name-embedded
  third-person intro that runs on into the description ("Galaxy is in **the passage
  end**. <desc>"). Golden `room_heading1`; 158 green; docs in specs.md. **Third-person
  viewpoint DONE:** the story viewpoint now supports third-person gendered narration —
  person/number from the globals `viewpoint_person`/`viewpoint_plural`
  (`lib/sys/globals.lamp`, defaults 2/false, byte-invariant), and **gender read off the
  player object** (`player.gender`, the same source the subject pronouns use — not a global,
  so it tracks the main character) by the locale's `viewpoint()` (both en-US and fr-FR).
  advent's hard-coded "You see " contents intro became the `[We] [see]` sugar. Phobos sets
  `viewpoint_person = 3` + `gender "female"` on `yourself`, so the contents listing reads
  "She sees a … here." and examine-nothing "She sees nothing unusual …". (text.md D7.)
  **Initial appearance DONE:** `item.initial_appearance` (a paragraph shown in the room until
  the item is first taken) + a `handled` flag set on take; `listable_contents` pulls
  not-yet-handled initial-appearance items out of the "[We] [see] … here." list (they stay
  in scope). Phobos's loose documents use it ("A form hangs on the wall beneath the sign.");
  golden `initial_appearance1`; byte-invariant (empty default). **Remaining for
  presentation:** (a) contents reword "Also here is/are …" — needs a parallel **contents
  seam** (advent's frame can't add the copula from a message override alone, like the
  heading); (b) the still-2nd-person **parser feedback** ("You can't see any such thing."
  — `parser_cant_see`/`parser_no_understand`); (c) deferred (agreed): third-person
  **action reports** — but NOT take/drop (Phobos leaves "Taken."/"Dropped." as-is);
  examine-undescribed / disguise variant; nested-location parenthetical. **Siriusian
  display cipher DONE:**
  `siriusian(text)` native in `sample/phobos/lib/phobos/index.js` (non-invertible:
  drop odd chars / shift-by-len / reverse / many-to-one glyphs); used as
  `[siriusian("…")]`; **the full Passage End description renders byte-for-byte like
  the I7 transcript** (label + door-state conditional). **Reading DONE (Linguistic
  Module slice 1):** the **progressive scan-level reveal** is ported
  (`lib/phobos/linguistics.lamp` + `print_translated`/`is_textual`): a `document`
  (textual) type with `content`/`scan_level`; examine/read renders the content
  word-by-word — each word translates to English once its difficulty tier is in the
  global `scan_levels`, else fixed-width Siriusian (`!`/`$`/`#` = proper-noun/control
  tiers that stay alien; `/` = paragraph break); emitted via `write()` so only `/`
  breaks the prose. **Scanning DONE (slice 2):** the **SCAN verb + Linguistic Module
  item** (carried from start) marks a `document` `scanned` and flips its tier on in
  `scan_levels` (a fixed five-slot `list<bool>`, so adding a tier is element assignment —
  no append, no new natives; the scan target is typed `document` so it reads fields
  directly). Guards: already-scanned, not-carrying-Module. Undo reverts scan state.
  **All five textual documents DONE** (Texts.i7x): the diary (tier 2, full content1+content2,
  9 paragraphs) plus the sign-out form (1), science notebook (3), reactor manual (4), and
  commander's log (5) — **full tier coverage, so full translation is reachable** (the log's
  tier-20 `#` security-key words reveal only once all five tiers are scanned). `[']` escapes
  word-final possessives; the form alone carries a physical description shown before its
  content. **All room descriptions DONE** (Base.i7x, in `base.lamp`): static
  `[siriusian("…")]` signage + `[if <door>.closed]` state; the North Barracks `cabinet` added
  so its conditional resolves. **Remaining:** **scan-aware Siriusian labels** — room/door
  labels are static-alien today and never translate; making them respond to `scan_levels`
  (like document content) needs a string-returning translate function and would also convert
  the Passage End door label off `siriusian()`. Also: the in-prose sub-objects (signs, poster,
  reactor levers, control panel + launch/self-destruct buttons, the cabinet's Cyberhelmet) as
  examinable objects; the `obscure`/`revealed` real-name swap; the log's control-code tail
  (with the purple-door system).
  ~~**Migration (native phobos JS → Lamp)**~~ **DONE** (memory
  `phobos-native-to-lamp-migration`). Phase 1: general lib/sys primitives `length`/
  `char_at`/`code_at`/`substring` (codepoint-based, 0-indexed) + the `mod`/`div` operators;
  golden `strops1`. Phase 2: the whole Siriusian cipher + `token_difficulty` +
  `print_translated` rewritten in pure Lamp on those primitives, **byte-identical** to the
  deleted native (door label + diary); the cipher's reversal is string-prepend (`out = g +
  out`), no list append. `textual`/`content`/`scan_level`/`scanned` added to `item` by
  **reopening the type in Phobos** (advent untouched, `document` dropped); `is_textual` is
  now the pure-Lamp guard `self.target.textual`. `lib/phobos/index.js` is gone. **`x is
  Type`** operator still deferred (not needed). **Test gap:** the filter is phobos-lib-
  specific, so no golden (the Phobos sample isn't golden-discoverable — would need extending
  golden discovery to `sample/<dir>/`). See `sample/phobos/PORTING.md`.
- **BUG: assignment to a bare object-name field target emits undefined JS.**
  `SomeObject.field = value` (where `SomeObject` is a bare object reference, not a
  local/global/`self`) emits `lamplighter.setField(SomeObject, …)` with
  `SomeObject` as an undefined JS identifier → runtime `ReferenceError`. *Reads*
  resolve correctly (`getObject(...)`); only the **assignment-target head**
  doesn't. Fix: in `emitStatement`'s `AssignStatement` branch
  (`src/lantern/emitter.js:822`), resolve an object-name head via `getObject` like
  expression position does (thread the object-name set in). Workaround: bind to a
  `let` or use `self.<slot>`. Found porting Phobos hacking.
- **Hacking subsystem (Phobos port) — in progress.** The KIM tool + `hack` verb +
  green-door instant bypass are done (`sample/phobos/lib/phobos/hacking.lamp`):
  `hack green door` opens it and `go north` then works. **`press <n>` input
  unblocked (option B DONE):** primitive-typed action slots are implemented
  (`resolveSlots`/`literalSlotValue`; golden `numslot1`). **Yellow door DONE:** the
  `press` action (gated on `adhered`), the 9-button `list` state, the per-key
  flip-sets, the keypad display, and solve→open all work end-to-end
  (`lib/phobos/hacking.lamp`); dogfoods number slots + list literals + element
  assignment. **Red door DONE:** a second nine-button Lights-Out reusing the same
  engine (shared `nine_solved()` goal) but starting with button 6 lit and a distinct
  harder flip-set; solves end-to-end (sequence 1,2,3,5,7) and opens south to the
  armory. **Blue door DONE:** a *sort-by-swap* (different mechanic) — nine shuffled
  Siriusian digit-glyph labels (`number_order`), press two to swap their labels, goal
  is to sort. Dogfooded a **new general `random(n)` native** (lib/sys, reusing the
  engine's seeded/save-captured RNG; golden `random1`); shuffle is a forward
  Fisher-Yates in Lamp. **Locker DONE:** a four-button toggle (each press flips only
  itself; start `{red,blue,blue,red}` → press 1 and 4) that opens a **container** and
  reveals the **diary** sealed inside. Dogfooded a general advent feature — a **closed
  container hides + seals its contents** (`contents_of` closed-check + core
  **`registerScopeBarrier`** seam; golden `closedbox1`); South Barracks ported in full.
  **Remaining doors:** purple (pick-5-of-16, needs the scan/control-code system —
  deferred). `read` is now an advent synonym for `examine` (reading the diary shows its
  description). Locker deferreds: pod scenery, locker synonyms.
  Also deferred: `score 1` per solve
  (Galaxy Banner + notification, with scoring); the RESET button (re-press undoes,
  so not required). Globals use natural multi-word names (`kim_adhered_to`,
  `nine_buttons`) now that the multi-word-global bug is fixed (see below).
- **Library file ordering / cross-file type topo-sort.** Lantern emits type
  definitions in file-glob (alphabetical) order with no cross-file topological
  sort, so a subtype declared in an alphabetically-earlier file than its parent
  fails at load (`Parent type is not defined: …`). Hit while adding `doors.lamp`
  (worked around by putting the `door` type in `types.lamp`). Fix options: (a)
  **topologically sort type declarations by inheritance before emit** (automatic,
  robust — the only ordering constraint is parent-before-subtype; objects /
  relations / globals already resolve order-independently); or (b) a **library
  manifest** declaring file order. Lean (a). **Where:** `src/lantern/{index,emitter}.js`. See `sample/phobos/PORTING.md`. **Where:** `lib/advent/`,
  `src/lantern/*`, `src/lamplighter/index.js`, devdocs.
- **Scoring / rank subsystem (motivated by the Phobos port).** advent has no
  score or rank system; the Phobos I7 game uses `Use scoring` + Score.i7x +
  Rank.i7x. Phobos's `score N` phrase (Score.i7x) bundles three effects in order:
  **print the Galaxy Banner** ("Galaxy Jones" ASCII figlet — shown on *every*
  point-gain, e.g. each hack), **add N to the score**, **fire the score-change
  notification** ("[Your score has just gone up by one point.]"). So a Lamp port
  needs a `score` global + an award entry point that does banner + increment +
  notify, plus a `SCORE` verb and rank-from-score. Galaxy Banner.i7x also has
  action/power banners. The green-door hack is the first concrete caller (it omits
  `score 1` today). Art + details in `sample/phobos/PORTING.md`. Would need a `score` global, a points-award surface, and a
  rank-from-score lookup, plus a status-line/`SCORE` verb surface. *Not yet
  designed.* Surfaced by `sample/phobos/PORTING.md`. **Where:** `lib/advent/`.
- **Localization to French — in progress (`devdocs/i18n.md`).** Goal: a playable French
  Cloak of Darkness. **Part 1 DONE (2026-06-26):** the compile-time **locale switch** —
  `--locale <tag>` flag (also `--locale=<tag>`) > a `locale "<tag>"` source declaration >
  the `en-US` default; picks the locale dir filling the post-`sys` slot. New `locale` keyword
  → inert `LocaleDecl` (read in a pre-pass, mirroring `lib` gathering); a library may ship
  per-locale override files `lib/<lib>/locales/<tag>.lamp` (loaded after its defaults, so
  `NAME:"…"` message overrides win last-wins; en-US default unchanged). Clear "pack not found"
  error. Tests: parser units (LocaleDecl + reject unquoted); 148 golden invariant.
  **Part 2 DONE (2026-06-26):** `lib/fr-FR` grammar pack — gendered articles (le/la/l'/les,
  un/une/des, elision before vowel/h via a `gender` field), French list prose (" et ", no serial
  comma), copula est/sont, metropolitan number words (soixante-dix/quatre-vingts), case
  transforms. Defines every native `lib/en-US` does; verbs aren't conjugated (translation spells
  them out — `conjugate` is identity, vocab mirrors en-US so English default templates parse).
  Test: golden `frlocale1` (selected via a `locale "fr-FR"` declaration; 149 golden green).
  **Part 3 DONE (2026-06-26):** `lib/advent/locales/fr-FR.lamp` — French overrides for every named
  advent message (take/drop/wear/doff/put-on reports + failures + parentheticals, inventory
  header/empty/`(worn)`, darkness line, room-contents frame). Supporting: named the darkness line +
  contents frame in `rooms.lamp` (en-US invariant); inventory row now uses the locale's `indefinite`
  not advent's English-only `with_article` (en-US invariant; localizes to "une clé"); added a
  `gender` field on advent's `physical` type (default masculine). Also moved the recursive
  nested-contents parenthetical out of advent into a locale native `contained_phrase(container,
  inner, count)` (replacing the English-built `render_thing` concat + `prep_for`): en-US builds
  "(in which is …)", fr-FR the gender-agreed "(dans laquelle se trouve …)". Tests: goldens
  `fradvent1` (end-to-end French responses) + `frnested1` (nested containers/supporter, gendered
  relative pronoun + dans/sur + se trouve(nt)); 151 golden green, en-US byte-invariant.
  **Layer 3 DONE (2026-06-26):** French command grammar in the same pack — verb synonyms via
  `understand "…" as ACTION` (additive: English still matches) and direction words by reopening the
  `direction` objects. Two general fixes: UTF-8 stdin in the plain host (`plain.js` read a byte at a
  time and decoded each alone, mangling "clé"; now decodes the whole line) and routing the engine's
  parser feedback ("You can't see any such thing." / "I don't understand that.") through the
  `message` registry so a pack overrides them (`parser_cant_see`/`parser_no_understand`). Test:
  golden `frverbs1` (French commands → French responses + localized parser failures + accented noun
  match); 152 golden green, en-US byte-invariant.
  **Layer 4 DONE (2026-06-26):** `sample/cloak_fr.lamp` — a forked French Cloak of Darkness (inline
  prose translated, objects given `gender` + `understand` synonyms, custom French verbs `lire`/
  `accrocher … à …`). Plays fully in French. To finish the banner, advent's startup/end prose moved
  to named messages (en-US byte-invariant), overridden in French: `banner_by`/`banner_version`
  (split around game-field interpolations), `story_won`/`story_lost` (end_story_rules), `quit_prompt`.
  Test: golden `cloak_fr` (winning path); 153 golden green. **i18n COMPLETE** across all four layers.
  **Remaining gaps (minor):** game title can't be localized (banner prints the ASCII identifier — needs
  a title field on the `game` type); the disambiguation prompt + unbound-pronoun message interpolate
  runtime values (need interpolable message values); out-of-world meta-verbs (quit/undo/save/restore)
  are English-keyed (rides on TODO item 2's "move out-of-world verbs into lib"). **Where:** `sample/`,
  `src/lamplighter/index.js`, `lib/advent/`.
  **Follow-up (2026-06-26):** default action messages when none is defined — `examine` of an object
  with no description prints `examine_nothing` ("[We] [see] nothing unusual about [the act.target]."),
  and a room with no description shows just its name (describe_room skips the empty line). Added `see`
  to the locale verb vocab for the `[see]` sugar; French override `examine_nothing` phrased to avoid
  the `de`/`à`+article contraction gap (see i18n.md Pending). Tests: goldens `examine_nothing1`
  (en-US) + `frexamine1` (fr-FR); 155 golden green.
- ~~**Named messages: convert advent's non-action strings.**~~ **DONE (2026-06-26):** all of
  advent's non-action player prose is now named (for the French translation, see the localization
  item above + `devdocs/messages.md`): the darkness line + room-contents frame (`rooms.lamp`), the
  title-banner connectives + `quit_prompt` (`startup.lamp`), the end-of-story banner (`globals.lamp`
  `story_won`/`story_lost`), and the engine's parser feedback (`parser_cant_see`/
  `parser_no_understand`). (The inventory item rows stay plain — they reference a loop-local, not
  `act`.) Remaining un-named: the host-rendered status line and the ASCII game-title banner (needs a
  `game` title field) — both noted under the localization item.
- ~~**Nested objects need a body / reference form (step-5 limitations).**~~ **DONE (2026-06-26):**
  **smart disambiguation** — a line in an object body is a nested placement when its leading
  token is a known **type** that is **not** a known **field name** (so `item hook` nests but
  `article proper` stays a field). Drops the `:`-body requirement: a bodyless `TYPE NAME` emits
  an empty ObjectDecl + `contains`, which **object reopening** merges with the object's real
  declaration if one exists — so the same form is both a fieldless leaf *and* the reference
  form. Prescan now collects field names (light type-body tracking) + an object/other block
  stack for nested-name registration; both type names and field names thread to the parser.
  Remaining edge: a type whose name is also used as a field name can't be smart-nested (give it
  a body or use top-level `contains`). Tests: prescan + parser units; `nestlist1` now uses
  bodyless leaves (output invariant); 146 golden green. Dual-nature containers (per-placement
  in/on) remain deferred — orthogonal, additive later. **Where:** `src/lantern/{prescan,index,
  parser_rd}.js`.
- ~~**Recursive contents listing for nested containers (pure-Lamp via `map_strings`).**~~ **DONE
  (2026-06-26):** added `map_strings` (lib/sys) + exposed `format_list` to Lamp (lib/en-US,
  normalized via listItems so a_list/the_list still pass arrays); pure-Lamp `render_thing`/
  `render_contents`/`prep_for` in `lib/advent/rooms.lamp`; `contents_of` generalized room→
  `physical`. Output e.g. `a chest (in which is a thimble (in which is a marble))`, supporters
  "on which", plural copula via `are`. Tests: golden `nestlist1` (deep nesting + supporter +
  plural); `doublecontainment` golden updated (now shows the nested coin); flat-case room
  listings invariant; 146 golden green. Decisions as planned (D2 closed deferred, D6 tree
  assumption).
  **Enabling primitive (lib/sys):** `native function list<string> map_strings(list<object> xs,
  function fn)` → `makeList(listItems(xs).map(x => fn(x)))`. General, reusable, sidesteps
  generics (object→string), and proves natives can call Lamp function refs.
  **Lister (pure Lamp, lib/advent):** `render_contents(holder) = format_list(map_strings(
  contents_of(holder), render_thing))`; `render_thing(x) = indefinite(x)` plus
  `" (" + prep_for(x) + " which " + are(inner.size) + " " + render_contents(x) + ")"` when
  `contents_of(x)` is non-empty (mutually recursive; `render_thing` passed by name). `prep_for`:
  `x.supporter ? "on" : "in"`. Wire `list_room_contents` → `[render_contents(r)]`; generalize
  `contents_of` room→`physical`. Prose stays in the locale (`indefinite`/`format_list`/`are`).
  **Decisions:** D1 prep from `supporter` flag (dual-nature deferred); D2 closed containers
  deferred (no open/close actions yet; `closed` is box-only); D3 exclude scenery (contents_of
  already does); D4 keep `describe_supporters` separate; **D5 = pure Lamp + `map_strings`** (no
  advent renderer native); D6 assume containment is a tree (pure-Lamp visited-set can't thread
  through `map_strings`; cycle would loop — matches Inform, note limitation). **Watch:**
  `list<item>`→`list<object>` element-subtyping at the `map_strings` call (type `list<physical>`
  if strict). Tests: golden box/pedestal example + empty container + singular/plural copula;
  flat-case goldens stay invariant. **Where:** `lib/sys/{functions.lamp,index.js}`,
  `lib/advent/rooms.lamp`.
- ~~**Drop advent's duplicated `display_name` / `with_article` (layering smell).**~~ **DONE
  (2026-06-26):** advent's `display_name`/`with_article` (which shadowed/overlapped the locale's
  `display_name`/`indefinite`) are deleted; the locale now owns all naming/articles. The two
  callers were retired during fr-FR localization: the inventory row → the locale's `indefinite`;
  the supporter listing → a new locale helper `supporter_phrase` (en-US "On the hook is a cloak.",
  fr-FR "Sur l'étagère se trouvent …"). `describe_supporters` now decides only which supporters
  and what rests on them. en-US byte-invariant; French covered by the `frnested1` golden.
- ~~**Object reopening (merge same-named `ObjectDecl`s) — reopen e.g. `yourself`.**~~ **DONE
  (2026-06-25):** emitter merges same-named ObjectDecls into one `createObject` with unioned
  fields (mirrors the `mergedTypes` merge). Decisions implemented as agreed: **implicit** (any
  duplicate name merges), **type must agree** (mismatch → located compile error; added
  `filePath`/`lineNumber` to ObjectDecl for it), **last-wins** field conflict in source order
  (so a game reopen overrides a library object's field). Tests: golden `doublecontainment`
  (reopen `yourself` to add a nested hat; deep coin-in-crate containment) + compile-error golden
  `reopen_type_mismatch`. Docs: specs.md "Reopening an object".
- ~~**Bare boolean-attribute shorthand — `wearable` for `wearable true`.**~~ **DONE (2026-06-25):**
  one line in `parseObjectBody` — a field name with no value desugars to `= true`
  (`at("NEWLINE") ? createBooleanLiteral(true) : parseSimpleValue()`). Purely additive (a bare
  field line was a parse error before); no emitter change; no collision with the nested-object
  branch (needs a `:`). Validation is free — a bare non-bool field errors as "expects string,
  got bool" via `checkObjectDecl` (kept the borrowed message; didn't add a tailored one). Tests:
  parser unit + golden `boolattr1` (wear a `wearable` cloak, scenery rock refuses take, explicit
  `scenery false` lamp still takeable). Docs: specs.md object-declarations.
- ~~**Parser: allow property access on a call/parenthesized result — `holder(p).lighted`, `(EXPR).field`.**~~ **DONE (2026-06-25):** factored a `collectTrailingFields()` helper in `parser_rd.js`; the call-result branch of `parseIdentExpr` now wraps a `CallExpr` with trailing dots in a `MemberAccess` (parenthesized branch refactored onto the same helper). Emitter already emits `(inner).field`; checker's `applyFieldToType` resolves the field off the call's return type (tolerant/unknown otherwise — no error). Simplified advent `in_darkness` back to `not holder(p).lighted`. Tests: two parser units (call result, chained + parenthesized). `go`'s `let here` stays — that's a *different* restriction (function calls disallowed in relation-query slots, by design). All 141 golden + parser green.
- ~~**Nested object-in-room syntax (step 5).**~~ **DONE (2026-06-25):** a `TYPE NAME:`
  body line (leading token a declared type, with a `:` body) inside an object body
  declares a nested object placed via `contains ENCLOSING NAME`. Implemented: a
  cross-file **type-name prescan** (`prescanTypeNames`, merged in index.js before the
  main prescan so a game can nest a type from lib/advent) + nested **object-name**
  collection (colon-form only, so forward refs to nested objects resolve); a
  `parseObjectBody` branch that hoists the nested ObjectDecl + a `contains` RelationAssert
  (identical to hand-written placement; recurses for deep nesting). The trailing `:` is
  the disambiguator — a body-less `TYPE NAME` stays a field assignment (so `article proper`
  works where `article` is also a type). **Reference form deferred** (body-less `TYPE NAME`
  is ambiguous with field assignment); use a top-level `contains`/`move` to place an
  existing object. Tests: golden `nest1` (scope/take/examine through nesting) + parser &
  prescan units. Docs: specs.md "Nested object declarations". **Where:**
  `src/lantern/{prescan,index,parser_rd}.js`.
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
- ~~**Reassigning a multi-word (underscore) global fails.**~~ **FIXED.** Globals are
  keyed by their coerced name ("my score"), but an assignment target's head is the
  raw identifier ("my_score") — so both the **checker** (rejected the assignment) and
  the **emitter** (silently emitted a dead bare `my_score = …`) missed the global.
  Both now coerce the head at the six `globalNames.has` sites (checker) and the
  AssignStatement / PropertyAccess heads (emitter); `setGlobal` uses the coerced key.
  Locals keep the raw name (no-shadow guarantees no collision). Regression golden
  `multiword_global1` (reassignment + multi-word global field read run at runtime).
  The two `coerceName` imports were added to checker.js/emitter.js.
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
- ~~**`list<T>` field types end-to-end.**~~ Exercised now via mutable lists
  (golden `listmut1`): a `list<int>` global, literal init, element read/write, undo
  durability.
- ~~**List literals + element assignment (mutable lists).**~~ **DONE.** `[a, b, c]`
  literal (parser nud on `[`; `ListLiteral` → `makeList`; checker infers `list<T>`)
  and `xs[i] = v` element assignment (indexed `AssignStatement` target → mutate
  `.items[i]` in place, mirroring the `IndexExpr` read). Durable across undo/save —
  `encodeValue` deep-copies list items at capture (verified by golden `listmut1`).
  Built to unblock the Phobos hacking button puzzles. Docs: specs.md. **Two limits
  found:** (1) a `[…]` **index inside a text substitution** isn't supported (the
  substitution scanner matches the first `]`; bind to a `let` first) — a tokenizer
  fix if wanted; (2) the pre-existing emitter bug (assignment to a bare object-name
  target) is unrelated but adjacent.
