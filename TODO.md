# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

## 1. Cross-rule override suppression for `report` / `report failed`
Failure reasons + the `report failed` band are implemented; both report bands are
**fire-all**, so a downstream rule cannot retheme a library message by shadowing
it — both print. Direction chosen (see `devdocs/rulebooks.md`, *Cross-rule
override suppression*): fix the bare-`stop` spec/impl mismatch so bare `stop`
halts the band, then add author-before-library ordering. Two pieces:
1. **Bare-`stop`-halt.** Bare `stop` currently emits `return;` (= fall through);
   the model says it halts remaining rules. Emit a halt sentinel distinct from
   fall-through; `runAction` (and rulebook fns) stop the band on it. Yielded value
   is decided: report band keeps the settled outcome; non-void value rulebook
   resolves to its declared `default` (today wrongly `undefined` — fix this bug).
2. **Ordering.** Author rules before library rules within a band (cross-file
   ordering, staged under *Ordering* in `devdocs/rulebooks.md`).
- **Where:** `emitter.js` (StopStatement), `runAction`/rulebook emit, rule-order.
- **Rejected:** three-valued `outcome` (re-merges continuation with result).
  **Deferred:** named-rule replacement (layer on later if ordering can't express).

## 1a. Make action outcomes readable (smaller, related)
`try ACTION:` is statement-only and discards the `outcome`; author code can't
branch on success/failure. Surface it (e.g. `try` in expression position yielding
`outcome`, or a queryable last-action-outcome). See `devdocs/rulebooks.md` Open
questions and *Required language/runtime support* item 5.

## 2. Parser v2 — every-turn & timed rules
Action-rulebook bands are implemented; what remains for v2 is a turn clock:
every-turn rules and timed/scheduled events, plus out-of-world actions
(`save`/`undo`/`again` — currently out of scope).
- **Where:** rulebook driver in `src/lamplighter/index.js`, `run_command` loop.
- **See:** `devdocs/rulebooks.md` roadmap, `devdocs/game_parser.md` v2.

## Smaller / opportunistic
- **Bare-direction movement.** Players expect `northeast` (or `n`, `ne`) to
  move without typing `go`. Implement as additional `syntax:` lines on the `go`
  action (one per direction/abbreviation), or as a parser pre-pass that expands
  a lone direction word to `go [direction]`. No new language features needed.
  **Where:** `lib/advent/actions.lamp` syntax block and/or `src/lamplighter/index.js`.
- Add a **one-way** connection to a test map (plain `connects`, no `bidi`) to
  lock in that asymmetric exits stay asymmetric.
- Confirm `list<T>` field types parse end-to-end (open question in
  `devdocs/parser_refactor.md` — no fixture exercises it today).
- **a/an article selection.** advent prints "a idol" / "a oak door"; the `count`
  article should choose "an" before a vowel sound. The `article` enum exists but
  the runtime doesn't vary the indefinite article. **Where:** advent display
  helpers / `lib/advent`.
