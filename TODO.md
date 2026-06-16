# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

## 1. Parser v1 — vocabulary model & resolution depth
Design is settled (see `devdocs/game_parser.md`, Vocabulary model). Implement:
- Add `thing` base type to `lib/advent/types.lamp`; move `direction < thing`;
  add `printed name`, `understand` fields on `thing`; add `article` enum and
  field on `physical`.
- Build vocabulary index in native JS: on startup, register each object's
  identifier tokens + `understand` tokens; expose `objects_for_tokens(tokens)`
  to the resolver.
- Update `resolveNoun` in `src/lamplighter/index.js`: strip articles, token-bag
  match against vocabulary index, return candidates (not first-match).
- Disambiguation prompt when >1 candidate ("Which do you mean, the X or the Y?")
- Richer failure messages ("You can't see any such thing.").
- **Supporting prereq:** string helpers (`to_lower`, `split`) — use existing
  `split()` from `lib/sys/`; add `to_lower` as a native helper.

## 2. Centralize standard responses (overridable messages)
Action responses ("Taken.", "You can't go that way.") are hardcoded string
literals in `do`/`report`/`check` rules. The whole point of the `report`/`check`
split is override-without-edit; a responses indirection (e.g. a small rulebook
or a message table) makes a game retheme output without touching world logic.
- **Where:** `lib/advent/actions.lamp`; possibly a new `responses` rulebook.

## 3. Parser v2 — every-turn & timed rules
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
