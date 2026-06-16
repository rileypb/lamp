# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

## 1. Cross-rule override suppression for `report` / `report failed`
Failure reasons + the `report failed` band are now implemented (see
`devdocs/rulebooks.md`); both report bands are **fire-all**, so a downstream rule
cannot retheme a library message by shadowing it — both print. Add a way for an
author rule to run first and halt the band (distinct from bare `stop`, which only
early-exits its own rule body). Ties into rule identity/ordering.
- **Where:** `runAction` in `src/lamplighter/index.js`; rule-ordering surface.
- **See:** `devdocs/rulebooks.md` Open questions (override suppression; unset
  reason — silent failure today).

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
