# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

> The 2026-06-19/20 architecture review (issues A–G) is **fully resolved** — see
> `devdocs/architecture.md` → "Known Architectural Issues" for the per-issue
> record. The only optional remnant is item 6 below.

> Feature backlog awaiting triage: `lurking_todo.md` catalogs candidate verbs,
> grammar, world-model traits, turn-cycle/daemon, and message ideas mined from
> `lurkinghorror.txt`. `devdocs/text.md` is the **text-substitution**
> design + 7-slice Action list (Inform-7-style `"[We] [drop] [the velvet_cloak]"`).
> **Slices 1–5 DONE** (lists & numbers complete, incl. G3 count-driven agreement);
> Slice 6 (layout/paragraph control) is next. `lurking_todo.md` still awaits triage.

## 1. Text substitution — Slices 1–5 DONE; Slice 6 next
**Slice 1 (complete):** bracket substitution + quote convention + lazy `text`/`freeze`.
**Slice 2 (complete) — names, articles, case:** the **`lib/en-US` default locale pack
auto-loads after `lib/sys`** (`gatherLibDirs`), realizing the three-layer split.
Articles + bare-word sugar `[the X]`/`[a X]`; case `cap`/`upper`/`lower`/`title`;
`format_list`; the pluralizer `pluralize(x)`; the boolean `proper`/`plural` contract.
**Slice 3 (complete) — the adaptive engine:** a render-local **render context**
(third-person `subject` + verb `agreement` + `count`, never saved) created at the
outermost render boundary. `[We]`/`[us]`/`[our]`/`[ours]` are the **player**,
rendered by the story viewpoint (`viewpoint_person`/`viewpoint_plural` globals,
default 2nd → "you"); `[They]`/`[them]`/`[their]`/`[theirs]`/`[themself]` are the
**subject**, set by `[regarding EXPR]` or by naming a thing. Verb conjugation
`[drop]`/`[are]`/`[has]` via `conjugate()` agreeing with the `agreement` descriptor
(set by `[We]`/`[They]`/`[regarding]`) + the `verb` declaration (prescan-collected
sugar words). World-model→locale person contract (`grammatical_person`/`gender`/
`plural`). One report serves every actor via `[regarding self.actor][They]`. Fixture
`slice3` + golden; parser/prescan unit tests; all 11 suites green (123). See
`devdocs/text.md` → "Slice 3".
**Slice 4 (in progress) — variation & conditionals.**
- **4a (complete) — inline conditionals (E1–E4):** `[if COND]`/`[else if COND]`/
  `[else]`/`[end]` in templates (`[otherwise]`/`[end if]` aliases), nesting +
  per-branch substitutions, unbalanced-marker errors. Template-only. Built in the
  parser (`classifyControl`/`buildTemplateParts` → `cond` AST node) + emitter
  (`emitTemplateFrag` ternary chain); no runtime change. Fixture `cond1` + golden;
  parser unit tests; all 11 suites green (124).
- **4b (complete) — variation state infra + `[first time]…[only]` (F9, F8 base):**
  the site-durable tier landed. Each stateful text site gets a deterministic
  compile-time **site id** (emitter, reset per build); the runtime holds a per-site
  visit count (`variationState` / `variationAdvance`) captured by the `variation`
  **state provider** so undo/save/restore stay consistent. `[first time]…[only]`
  parses to a `firstTime` node (same block stack as `[if]`, no nesting) and emits
  `(variationAdvance(id) === 0 ? render : "")`. Fixture `firsttime1` + golden;
  `tests/state` round-trip; parser tests; all 11 suites green (125).
- **4c (complete) — variation modes (F1–F6) + seeded RNG (F8):** `[one of]ALT[or]
  ALT…[MODE]` with `[cycling]`/`[stopping]`/`[at random]`/`[purely at random]`/`[in
  random order]`/`[sticky random]`. Parser folds it into a `oneOf` node (alternatives
  + mode, no nesting); the emitter computes the index once (cycling/stopping from
  `variationAdvance`, random modes from `variationPick`) inside an IIFE, then a
  ternary renders only the chosen alternative. Seeded RNG (mulberry32, fixed default
  seed → deterministic goldens) captured by the `rng` state provider; per-site random
  cursors live in the `variation` provider. Fixture `variation1` + golden; `tests/state`
  RNG round-trip; parser tests; all 11 suites green (126).
- **4 — deferred follow-ups (complete):** (F7) weighted variation `[as decreasingly
  likely outcomes]` (`variationPick` mode `"decreasing"`); the **`pick(list, mode)`**
  function form over a computed list (emitter special-cases `pick` and injects a
  per-call-site id; checker infers the element type + 1–2 arity); and **RNG seeding**
  `seed_random(n)` / `randomize()` in lib/sys (entropy seeding opt-in; default seed
  stays fixed for deterministic goldens). Fixture `variation2` + golden; parser test;
  131 goldens. Remaining nicety: arbitrary explicit per-alternative weights (only the
  "decreasing" scheme is built).
**Slice 5 (complete) — lists & numbers.**
- **5a (complete) — list quantities & articles (G2/G1/G6):** `.size`/`.count` on a
  list (name or parenthesized query, the latter via a new `MemberAccess` node — the
  `(...)` nud collects a trailing `.field` chain; shared `applyFieldToType` checker
  helper; `makeList` size/count getters). `a_list()`/`the_list()`/`is_empty()` in
  lib/en-US. Fixture `list1` + golden; parser test; all 11 suites green (127).
- **5b (complete) — numbers (G4):** `in_words(n)` → "forty-two", `ordinal(n)` →
  "forty-second" in lib/en-US (American style, up to billions). Fixture `numbers1` +
  golden; 128 goldens green.
- **5c (complete) — plural suffix (G7):** single `[s]` token; parse-time splits the
  preceding word into a `pluralSuffix` node, emits `plural_suffix("W")` which inflects
  via `pluralize_word` unless the **governing count** is 1. The count is set by
  wrapping every value substitution in `lamplighter.interp(…)` (records an interpolated
  number); left-to-right array order means the count is set before `[s]` reads it.
  Fixture `plural1` + golden; parser test; 129 goldens.
- **5d (complete) — G5 grouped/qualified lists:** `a_group()`/`the_group()` collapse
  same-display-name objects into counted entries ("two brass lanterns, three coins
  and a key"); both article variants. Reuses in_words + pluralize + format_list.
  Fixture `group1` + golden; 130 goldens.
- **5e (complete) — G3 count-driven agreement:** `are(int n)` returns "is"/"are" by a
  raw count (singular only at exactly 1, so `are(0)` → "are"). Sugar `[is LIST]` /
  `[is the LIST]` / `[is a LIST]` (capitalized `[Is …]`) renders the copula agreeing
  with the list's **size** — empty and singular both "is" ("is nothing"), 2+ "are" —
  followed by the list with no / definite / indefinite articles. Pure parser desugar
  (`desugarSugar` → `is_are_list`/`is_are_the_list`/`is_are_a_list`, reusing
  `format_list`/`the_list`/`a_list`); no emitter/AST change. Fixture `agreement1` +
  golden; parser test; 132 goldens. The `[is …]` operand is list-typed
  (checker-enforced). Companion helpers `that_those(n)`/`a_an(x)` unbuilt (add on demand).
- **Slice 5 deferred:** an author-overridable grouping key for G5.
**Follow-up from Slice 3 (optional):** migrate advent's reports from the manual
`self.actor == player` branch to `[regarding self.actor][They] [verb] [the self.noun]`
templates (D8 — churns goldens, do deliberately). (Verb agreement auto-switches onto
a named noun, matching Inform — "...and drops it" is correct — and `[regarding]`
overrides; see text.md "Auto subject-switching (and its override)".)
**Deferred refinements:** per-locale sugar words + locale swapping — the sugar word
sets (`the`/`a`/`an`, pronouns, `regarding`) are hardcoded English in the parser and
`lib/en-US` is hard-auto-loaded; generalize when a non-English locale lands.
**Where:** `src/lamplighter/index.js` (render context), `lib/en-US/`,
`src/lantern/{parser_rd,prescan}.js`, `lib/advent/` (D8 migration).

## 2. SAVE / RESTORE — browser persistence + durable CLI saves (Slice 3)
UNDO (Slice 1) and SAVE/RESTORE to the dev host (Slice 2) are **done**: the
snapshot core (`captureState`/`restoreState`, a state-provider registry +
encode/decode over the closed value algebra), the undo stack + `undo` verb, a
versioned save header (`buildId` content-hash from Lantern + game identity) with
a strict restore gate, the `setSaveChannel` storage seam brokered to the
filesystem by the dev host, and named-slot `save`/`restore` verbs. Tests:
`tests/state`, `tests/save`, goldens `undo1`/`undo2`/`save1`; design in
`devdocs/state.md`. The **durable CLI save location is done** (per-user app-data
dir, `LAMP_SAVE_DIR` override; macOS `~/Library/Application Support/lamp/saves`
etc.); save files are obfuscated (`.sav`, XOR+base64). A native CLI file dialog is
**not** pursued (it breaks the headless/piped/test path); the browser host's
download/upload picker is the right home for that. **Browser persistence is done**:
the browser worker installs the same brokered save channel, and the shell
(`src/lighthouse/web/shell.js`) backs it with **localStorage** over a second shared
buffer; named slots persist per game across reloads. Build-smoke coverage in
`tests/lighthouse`; live loop manually verified. **Remaining (Slice 3):**
- Save-slot **listing/metadata** (a `saves` verb).
- Optional browser **file export/import** (download/upload — the native-file-UI
  path) layered on top of localStorage.
- **CLI save-name-prompt UX (defer until the out-of-world verb move — item 5).**
  Once the `save`/`restore` verbs + prompting live in `lib` (not the engine),
  the name prompt can host these CLI conveniences:
  - `^L` (or a keyword) at the name prompt → **list previous saves** for this game.
  - an **overwrite-confirmation** ("Replace the saved game named X?") before
    clobbering an existing slot, instead of silently overwriting.
  Both need the save-slot listing/exists primitives above and the in-`lib` prompt
  flow, so they wait on item 5.
This shares the out-of-world-verb hook with RESTART (item 4) and Parser v2.

## 3. Lighthouse web bundle — headless CI test (optional)
Web v1 is **built, verified live, shell-polished, and hardened for distribution**
(string encoding + esbuild minify, both covered by `npm run test:lighthouse` /
`npm run test:encode`). **Remaining (optional):** a *headless* browser test that
drives the live loop (worker `Atomics.wait` + shell SAB fill) — closes the last
automation gap but needs a heavy Playwright/Puppeteer dep; decide if worth it for
CI. Also still open: whether to default `--encode-strings` on for distribution
builds. **Where:** `src/lighthouse/`.

## 4. RESTART support for the end-of-story sequence
The end-of-story mechanism (`story` global, `end_story_rules`, the post-game loop
in `lib/advent/startup.lamp`) is in place but only offers QUIT — there is no state
reset, so RESTART was deferred. Implement it by having the sandbox **host
re-spawn the worker** on a `restart` signal (clean fresh state), which needs: a
`restart` native + message type, host handling in `playFile` (terminate + respawn,
guarding the `exit` handler), and re-enabling RESTART in the end sequence.
Alternative (messier): a runtime-wide `reset()` + re-run. **Where:**
`src/lamplighter/sandbox/host.js` + `worker.js`, `lib/advent/startup.lamp`.

## 5. Parser v2 — every-turn & timed rules + out-of-world actions
Action-rulebook bands are implemented; what remains for v2 is a turn clock:
every-turn rules and timed/scheduled events, plus **out-of-world actions**
(`save`/`undo`/`restore`/`again`). Also surface the outcome of a player command
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

## 6. Malformed-world startup check (optional hardening)
Carryover from arch issue C. When the parser is used, assert at startup that a
`physical` type and a `holder` field exist, so a world library missing the
runtime↔world contract names fails loudly instead of on `undefined.holder` deep
in `scopeOf`. Low priority. **Where:** `src/lamplighter/index.js` (`run`).

## 7. Core-vs-plugin: actions as core and/or an extensible compiler (design, not scheduled)
Proposal recorded in `devdocs/compiler-extensibility.md`: resolve the
"IF baked into the compiler" coupling (arch doc → "Layer boundaries and IF
coupling") by (1) promoting actions+bands to first-class general core, and/or
(2) making Lantern plugin-extensible so a library contributes the action syntax.
Recommended de-risking first step: refactor Lantern into *core + one first-party
plugin* owning the action/IF constructs (no third-party grammar yet), which also
lets the base `action` type move out of the runtime bootstrap. No code until the
direction is chosen. **Where:** `src/lantern/*` (pipeline), `src/lamplighter/index.js`.

## Smaller / opportunistic
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
- **Nicer diagnostic for a leading unknown name in a rule head.** A selector or
  rulebook contribution that *begins* with an unknown atom (`instead manipulatoin …`,
  `rule no_such_rulebook:`) isn't recognized as a rule, so it reports a generic
  parse error rather than "unknown action or tag" / "unknown rulebook". Heads that
  start with a known name report the precise error. Consider a fallback that
  recognizes `BAND <ident> …` / `rule <ident> …` and surfaces the better message.
- **Named-rule replacement.** Override suppression works via bare-`stop` +
  author-before-library ordering (now shared by actions and rulebook
  contributions). Replacing *one* library rule out of several (without depending
  on registration order) needs named rules. See `devdocs/rulebooks.md` roadmap
  (*Next — identity & ergonomics*).
- **Reserved words as member names — assignment/handler asymmetry.** Expression
  property access now allows keyword field names (`self.action`), but assignment
  targets (`readTargetSegment`) and `on TYPE.field change` headers still require a
  plain IDENT. Align them if a keyword-named writable field ever appears.
- **`list<T>` field types end-to-end.** Parsing is now covered by a parser unit
  test, but no fixture declares a `list<T>` field and exercises it through
  emit/runtime. Add one to lock in end-to-end behaviour.
- **General `put [x] on [y]` action — DONE (2026-06-20).** advent now has a
  generic `put_on` action (`put [x] on [y]`) with a `supporter`-aware `check`
  (refuses non-supporters with `cant_put_on_that`); `hang` is gone as a builtin.
  cloak contributes its `hang … on …` phrasing via the new
  `understand "TEMPLATE" as ACTION` construct and keeps only its flavored report.
  Enabled by that construct — grammar can now be contributed to an action
  declared anywhere (parser/checker/emitter + `understand1` /
  `understand_unknown_action` fixtures); the runtime's flat grammar registry
  already supported it. The generic action is covered end-to-end by `advent19`
  (default `You put X on Y.` report + `cant_put_on_that` refusal on a
  non-supporter).
