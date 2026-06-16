# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

## 1. Overridable standard responses — failure reasons & `report failed`
Design settled and written up in `devdocs/rulebooks.md` (*Failure reasons and the
`report failed` band*). Rejected message-table/global-variable approaches (can't
express context; map loses compile-time key checking). Instead: `check` names a
typed reason and stops; a `report failed` band renders text; both success and
failure text live in overridable rules — no globals. Implement in sequence:
1. **Parser + checker** (`src/lantern/`): `stop failed REASON` (optional reason
   arg); `report failed ACTION` band; implicit `stop_reason reason` slot on
   action instances.
2. **Runtime driver** (`src/lamplighter/index.js`): on failed outcome, set
   `self.reason` and dispatch the `report failed` band; success keeps `report`.
3. **Library** (`lib/advent/`): add `stop_reason` as an open `type` + instances
   (extensible, like `direction`); convert `check` rules to raise reasons; add
   `report failed` rules with default text. *(lib/ edit.)*
4. **Tests:** golden fixture overriding a failure message + one context-dependent
   failure; regenerate expected output. Cross-check against the worked
   transcript in `sample/study.lamp` (section 8) and unflag its PROPOSED
   sections once the surface compiles.
- **Open (deferred):** namespaced reasons (`stop_reason.cant_take`); what
  `report failed` prints for an unset reason.

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
