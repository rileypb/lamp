# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

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
- **Extend object-name validation (`checkedGetObject`) to expression contexts.**
  Object-name comparisons in `when`/`if` expressions (e.g. `self.dropped == cloak`)
  aren't validated at compile time; a typo silently becomes a string label that
  never matches. **Where:** `src/lantern/emitter.js` / checker.
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
