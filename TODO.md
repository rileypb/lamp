# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

## 1. Parser v2 — every-turn & timed rules
Action-rulebook bands are implemented; what remains for v2 is a turn clock:
every-turn rules and timed/scheduled events, plus out-of-world actions
(`save`/`undo`/`again` — currently out of scope). Also surface the outcome of a
player command (the `run_command` path discards `runAction`'s result, unlike
`let x = try`) so turn rules can see whether the command succeeded.
- **Where:** rulebook driver in `src/lamplighter/index.js`, `run_command` loop.
- **See:** `devdocs/rulebooks.md` roadmap, `devdocs/game_parser.md` v2.

## Smaller / opportunistic
- **Simplify `sample/cloak.lamp` dark-bar rules with a selector.** Action selectors are now implemented (boolean over actions/tags, `any`/`except`, `self.action`); the six near-identical `instead … when … bar … dark` rules can collapse to one `instead any except go except look …`. Do when sample edits are requested.
- **Better diagnostic for a leading unknown selector atom.** A selector that *begins* with an unknown atom (`instead manipulatoin …`) isn't recognized as a phase rule, so it reports a generic parse error ("Expected end of line") rather than "unknown action or tag". Selectors that start with a valid atom report the precise error. Consider a fallback that recognizes `BAND <ident> …` and surfaces the nicer message.
- **Pre-existing parser-unit failure.** `tests/parser` "type decl: parents and list<T> field type" fails on a clean tree because the expected AST omits the `defaultValue` field that `createFieldDecl` now always sets. Update the expectation.
- **`wearable` on cloak in sample.** The `wear`/`doff` actions are now in lib/advent, but `sample/cloak.lamp`'s cloak item lacks `wearable true`. Add when sample edits are requested.
- **Extend `checkedGetObject` to expression contexts.** Object-name comparisons in `when` conditions and `if` expressions (e.g. `self.dropped == cloak`) are not validated at compile time; a typo silently becomes a string label that never matches.
- Add a **one-way** connection to a test map (plain `connects`, no `bidi`) to
  lock in that asymmetric exits stay asymmetric.
- **Named-rule replacement.** Override suppression now works via bare-`stop` +
  author-before-library ordering. Replacing *one* library rule out of several
  (without depending on registration order) needs named rules. See
  `devdocs/rulebooks.md` roadmap (*Next — identity & ergonomics*).
- Confirm `list<T>` field types parse end-to-end (open question in
  `devdocs/parser_refactor.md` — no fixture exercises it today).
- **a/an article selection.** advent prints "a idol" / "a oak door"; the `count`
  article should choose "an" before a vowel sound. The `article` enum exists but
  the runtime doesn't vary the indefinite article. **Where:** advent display
  helpers / `lib/advent`.
