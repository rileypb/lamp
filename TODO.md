# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

## 1. Lighthouse web bundle — first slice
Design decisions are recorded in `devdocs/lighthouse.md` (service worker for
COOP/COEP, esbuild bundler [approved new devDependency], output+input-only
capabilities, directory-bundle artifact). Remaining steps, in order:
(a) ✅ **browser `Worker` bootstrap** — `src/lamplighter/sandbox/worker-browser.js`
(strips network globals, drives the transport seam over `postMessage` + SAB,
exports `runGame(factory)`; starts on the host `init` message). (b) ✅
**HTML/CSS/JS shell** — `src/lighthouse/web/{index.html,shell.css,shell.js}`:
main-thread host that builds the SAB, spawns `game.worker.js`, posts `init`,
relays `print`/`write` as text nodes + `log` to console, and services
`readline`/`prompt_readline` async (echo + SAB fill + `Atomics.notify`); refuses
to start if not cross-origin isolated. (c) add the **esbuild build step** that
wraps the body-only game as `(lamplighter, require, console) => {…}`, passes it
to `runGame`, and bundles it with the runtime + `worker-browser.js` into one
`game.worker.js`; also emits the directory bundle (copies the shell assets).
(d) ship the **COOP/COEP service worker** + decide first-load reload strategy.
**Blocked by:** none — next is (c), the first piece that needs the esbuild
devDependency. **Where:** new `src/lighthouse/`, imports `src/lamplighter/`.

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
- **a/an article selection.** advent prints "a idol" / "a oak door"; the `count`
  article should choose "an" before a vowel sound. The `article` enum exists but
  the runtime doesn't vary the indefinite article. **Where:** advent display
  helpers / `lib/advent`.
- **Reserved words as member names — assignment/handler asymmetry.** Expression
  property access now allows keyword field names (`self.action`), but assignment
  targets (`readTargetSegment`) and `on TYPE.field change` headers still require a
  plain IDENT. Align them if a keyword-named writable field ever appears.
- **`list<T>` field types end-to-end.** Parsing is now covered by a parser unit
  test, but no fixture declares a `list<T>` field and exercises it through
  emit/runtime. Add one to lock in end-to-end behaviour.
- Add a **one-way** connection to a test map (plain `connects`, no `bidi`) to
  lock in that asymmetric exits stay asymmetric.
