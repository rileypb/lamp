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
- **`wearable` on cloak in sample.** `lib/advent/globals.lamp` now has the `wears` relation and `wear`/`doff` actions, but `sample/cloak.lamp`'s cloak item lacks `wearable true`. Add when sample edits are requested.
- **`wearable` on cloak in sample.** The `wear`/`doff` actions are now in lib/advent, but `sample/cloak.lamp`'s cloak item lacks `wearable true`. Add when sample edits are requested.
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
