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

### AR2. Decouple Lamplighter from the advent world model
`scopeOf`/`resolvePool`/`canBeAntecedent` hardcode `holder`/`physical`;
`lib/sys` `run_command` hardcodes the `player` global; `runAction` hardcodes
`"succeeded"`/`"failed"`. Define an explicit world-model contract (or
library-provided scope/antecedent hooks) so `lib/sys` is self-contained and a
non-advent library is possible. **(arch issue C)**

### AR3. Distinguish object references from string literals in the AST
A bare name and a quoted string share one `StringLiteral` node; the emitter
re-derives object-vs-string from expected type at seven sites with duplicated
logic, and validation is inconsistent (`checkedGetObject` vs bare `getObject`).
Resolve once in the parser/checker into an `ObjectRef` node; centralize dispatch
and compile-time unknown-object checking (covers object-name typos in `when`/`if`
comparisons, currently unvalidated). **(arch issue D)**

### AR4. Decode string escapes — DONE (2026-06-19)
`unescapeString` in `src/lantern/tokenizer.js` resolves `\\`, `\"`, `\n`, `\t`,
`\r` at the STRING-token chokepoint; unknown `\X` keeps its backslash. One decode
point, so emitter/prescan/`--encode-strings` all agree. Tested in
`tests/tokenizer` and golden `advent17` (plaintext + encoded byte-identical).
**(arch issue E)**

### AR5. Harden the native-JS function boundary
`gatherNativeJs` finds native names with a regex that also matches functions in
comments/strings and nested decls. Use a token/AST-aware scan or an explicit
export manifest per lib `index.js`. **(arch issue B)**

### AR6. Separate relation instances from the world-object registry
Relations live in `instanceRegistry`, so `scopeOf`/`buildVocabIndex` iterate
edges (anonymous edges get indexed under the `"null"` token). Give relations
their own store, or tag iterations to skip them. **(arch issue F)**

### AR7. Small structural fixes — MOSTLY DONE (2026-06-19)
Done: explicit lib load order via optional `load.order` manifest
(`src/lantern/liborder.js`, `tests/liborder`); same-file duplicate-function
compile error in `deduplicateFunctions` (`function_dup` fixture);
case-insensitive QUIT in `lib/advent/startup.lamp` (`advent18` fixture); deleted
dead artifacts (`gameloop.lamp_hide`, unused `words` global). **Remaining:**
thread emitter context (`currentBareStop` is hand-saved/restored around each
rule) instead of module-level mutable state, so the emitter is reentrant.
**(arch issue G)**

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
