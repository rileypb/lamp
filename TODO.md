# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

## 1. Surface available exits in room description
Iterate `connects self.actor.holder _ _` and print the directions out of the
current room. Natural follow-on now that `bidi connects` + inverses and `for x in list:` work.
- **Where:** `lib/advent/rooms.lamp` — add an `list_room_exits` function and call it from `describe_room` or after it in `report look` and `person.holder change`.

## 2. Parser v1 — resolution depth
From the game_parser v1 roadmap. Current resolver is "first in-scope name match
wins" — can't distinguish "brass lamp" from "lamp". Add, incrementally:
- articles (`the`/`a` dropped), adjectives, `it` pronoun;
- disambiguation prompt when >1 match;
- richer "you can't see that" / "which do you mean" messages.
- **Where:** the resolver in `src/lamplighter/index.js` (`resolveNoun`).
- **Supporting prereq:** string helpers (`to_lower`, `starts_with`, `word_at`)
  — game_parser prerequisite #3; decide native-helper vs language.

## 3. Centralize standard responses (overridable messages)
Action responses ("Taken.", "You can't go that way.") are hardcoded string
literals in `do`/`report`/`check` rules. The whole point of the `report`/`check`
split is override-without-edit; a responses indirection (e.g. a small rulebook
or a message table) makes a game retheme output without touching world logic.
- **Where:** `lib/advent/actions.lamp`; possibly a new `responses` rulebook.

## 4. Parser v2 — every-turn & timed rules
Action-rulebook bands are implemented; what remains for v2 is a turn clock:
every-turn rules and timed/scheduled events, plus out-of-world actions
(`save`/`undo`/`again` — currently out of scope).
- **Where:** rulebook driver in `src/lamplighter/index.js`, `run_command` loop.
- **See:** `devdocs/rulebooks.md` roadmap, `devdocs/game_parser.md` v2.

## Smaller / opportunistic
- Add a **one-way** connection to a test map (plain `connects`, no `bidi`) to
  lock in that asymmetric exits stay asymmetric.
- Confirm `list<T>` field types parse end-to-end (open question in
  `devdocs/parser_refactor.md` — no fixture exercises it today).
