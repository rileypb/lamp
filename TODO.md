# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

## Architecture review follow-ups (2026-06-19)
From the standing review captured in `devdocs/architecture.md` → "Known
Architectural Issues". Listed highest-leverage first.

### AR1. Replace raw-source regex prescans with a token-level pre-pass — DONE (2026-06-19)
`src/lantern/index.js` now tokenizes each file once, runs `prescanDeclarations`
(`src/lantern/prescan.js`) over the tokens to build the parser's name sets, then
parses from the same tokens via `parseTokens`. The eight `extract*` regex
functions are gone; the lexer runs once per file and the prescan shares its
comment/string handling. Unit-tested in `tests/prescan` (`npm run test:prescan`).
Remaining nit: `extractLibImports` (lib resolution; scans only the user file)
still uses a regex — low risk, left as-is. **(arch issue A)**

### AR2. Decouple Lamplighter from the advent world model — DONE (2026-06-19)
Design: `devdocs/world-model.md`. Decision D1 — Lamplighter is an IF runtime;
`holder`/`physical`/`succeeded`/`failed`/`startup` are runtime-owned and hardcoded
(documented contract, not configurable). The `lib/sys ↔ lib/advent` split is kept
(base vs. opt-in IF world; a merge was investigated and rejected — it collides
with fixtures that build their own worlds).
- `run_command(line, actor)` — the actor is passed in (typed `object`), so
  `lib/sys` no longer reads `getGlobal("player")` and is self-contained.
- Presentation moved library-side — `formatListValue` calls a
  `setListFormatter`-installed formatter; `lib/sys` owns list-prose rendering and
  reads the renamed `oxford_comma` global (author form: `oxford_comma = true`).
  (Cost: the native reads the name by literal, so it leaks in `--encode-strings`
  builds — documented limitation.)
- Contract made explicit: a "Runtime ↔ world-model contract" block in
  `src/lamplighter/index.js`, per-site tags, and notes in `world-model.md` /
  `rulebooks.md`.

Optional future hardening (not done, low priority): a startup check that
`physical`/`holder` exist when the parser is used, so a malformed world fails
loudly instead of on `undefined.holder`. **(arch issue C)**

### AR3. Distinguish object references from string literals — DONE (2026-06-19)
The seven duplicated object-vs-string predicates collapsed to one
(`valueIsObjectRef` + `emitObjectOrValue` in `src/lantern/emitter.js`); validation
is uniform `checkedGetObject`, so unknown objects in call args / relation queries
/ relation removes are now compile errors (`call_unknown_object` fixture). The
checker also flags bare-name typos compared against an object-typed expression
(`checkObjectNameComparison`; `compare_unknown_object` fixture). Output for valid
programs is byte-identical. Chosen approach: emitter-centralized dispatch rather
than a distinct `ObjectRef` AST node — same outcomes, far lower risk. Residual:
typos on the `ParenNameExpr`/global side of a comparison aren't inferred, so
aren't caught. **(arch issue D)**

### AR4. Decode string escapes — DONE (2026-06-19)
`unescapeString` in `src/lantern/tokenizer.js` resolves `\\`, `\"`, `\n`, `\t`,
`\r` at the STRING-token chokepoint; unknown `\X` keeps its backslash. One decode
point, so emitter/prescan/`--encode-strings` all agree. Tested in
`tests/tokenizer` and golden `advent17` (plaintext + encoded byte-identical).
**(arch issue E)**

### AR5. Harden the native-JS function boundary — DONE (2026-06-19)
`gatherNativeJs` now uses `extractTopLevelFunctionNames`
(`src/lantern/native_scan.js`), a JS surface scanner that skips comments,
strings, template/regex literals, and tracks brace depth so only depth-0
function declarations count. A native function implemented only nested (or named
in a comment) is now a compile error instead of a runtime `ReferenceError`.
Unit-tested in `tests/native_scan`; real-lib output unchanged. **(arch issue B)**

### AR6. Separate relation instances from the world-object registry
Relations live in `instanceRegistry`, so `scopeOf`/`buildVocabIndex` iterate
edges (anonymous edges get indexed under the `"null"` token). Give relations
their own store, or tag iterations to skip them. **(arch issue F)**

### AR7. Small structural fixes — DONE (2026-06-19)
Explicit lib load order via optional `load.order` manifest
(`src/lantern/liborder.js`, `tests/liborder`); same-file duplicate-function
compile error in `deduplicateFunctions` (`function_dup` fixture);
case-insensitive QUIT in `lib/advent/startup.lamp` (`advent18` fixture); deleted
dead artifacts (`gameloop.lamp_hide`, unused `words` global); and the emitter's
bare-`stop` JS is now a threaded `bareStop` parameter rather than a hand-saved
module `let` (byte-identical output). Note: the remaining set-once module `let`s
in emitter/checker are per-invocation config, not the save/restore hazard; full
concurrent reentrancy would still need them bundled. **(arch issue G)**

## 0. GitHub Pages deploy — enable Pages source (one-time) — DONE workflow (2026-06-19)
`.github/workflows/deploy-pages.yml` builds `sample/cloak.lamp` and publishes it
to GitHub Pages on push to `main` (and `workflow_dispatch`). **Remaining (manual,
one-time):** in the repo Settings → Pages, set **Source: GitHub Actions** so the
workflow's `deploy-pages` step has a target; until then the deploy job will fail.
The bundle's service worker supplies COOP/COEP, so no host header config is
needed. **Where:** `.github/workflows/deploy-pages.yml`, `devdocs/lighthouse.md`.

## 1. Lighthouse web bundle — headless CI test (optional)
Web v1 is **built, verified live, shell-polished, and hardened for distribution**.
**Done:** string encoding (`--encode-strings`, `npm run test:encode`) — covers
prose, object/global/action/**type/relation** names, and grammar + relation-syntax
templates (the command phrasing); kind/enum/rulebook/event names + field keys
stay plaintext; native-`index.js` strings untouched (a name a native lib
references by literal still leaks) — and esbuild `minify` (default on,
`--no-minify` escape; ~66 KB → ~33 KB for cloak; covered by
`npm run test:lighthouse`). Encoding correctness is guarded by a broad
byte-identical-playthrough equivalence corpus (relations, inheritance, queries,
actions) in `tests/encode`. **Remaining (optional):** a
*headless* browser test that drives the live loop (worker `Atomics.wait` + shell
SAB fill) — closes the last automation gap but needs a heavy Playwright/Puppeteer
dep; decide if worth it for CI. Also still open: whether to default
`--encode-strings` on for distribution builds. **Where:** `src/lighthouse/`.

## 2. RESTART support for the end-of-story sequence
The end-of-story mechanism (`story` global, `end_story_rules`, the post-game loop
in `lib/advent/startup.lamp`) is in place but only offers QUIT — there is no state
reset, so RESTART was deferred. Implement it by having the sandbox **host
re-spawn the worker** on a `restart` signal (clean fresh state), which needs: a
`restart` native + message type, host handling in `playFile` (terminate + respawn,
guarding the `exit` handler), and re-enabling RESTART in the end sequence.
Alternative (messier): a runtime-wide `reset()` + re-run. **Where:**
`src/lamplighter/sandbox/host.js` + `worker.js`, `lib/advent/startup.lamp`.

## 3. Parser v2 — every-turn & timed rules
Action-rulebook bands are implemented; what remains for v2 is a turn clock:
every-turn rules and timed/scheduled events, plus out-of-world actions
(`save`/`undo`/`again` — currently out of scope). Also surface the outcome of a
player command (the `run_command` path discards `runAction`'s result, unlike
`let x = try`) so turn rules can see whether the command succeeded.
- **Where:** rulebook driver in `src/lamplighter/index.js`, `run_command` loop.
- **See:** `devdocs/rulebooks.md` roadmap, `devdocs/game_parser.md` v2.

## Smaller / opportunistic
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
- **General `put [x] on [y]` action.** Items reach a supporter only through
  `hang` ([lib/advent/actions.lamp](lib/advent/actions.lamp)). The supporter
  machinery is in place — room-description listing via `describe_supporters`
  (`advent15`), and the `supports`/`holder` invariant is now enforced by an
  `on item.holder change` handler that retracts stale edges on take/drop/re-hang
  (`advent16`). What's missing is a player-facing verb to place an item on an
  arbitrary supporter (with a `supporter`-aware `check`), rather than reusing
  the cloak-specific `hang`.
