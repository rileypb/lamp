# TODO

Top recommended next steps, roughly in priority order. Each item notes *why*,
*where*, and what it's *blocked by*. Sourced from the staged roadmaps and
prerequisite lists in `devdocs/game_parser.md`, `devdocs/rulebooks.md`, and
`devdocs/relations.md`.

## 1. `for X in LIST:` iteration (language feature) — ✅ DONE
The single highest-leverage missing primitive. Implemented by overloading the
existing `for` keyword: the token after the loop var selects the form (`=` →
counted loop, `in` → for-each). `in` is now reserved. `LIST_EXPRESSION` must be
`list<T>`; the loop var is bound to element type `T`; iterating `none` runs zero
times; a non-list expression is a compile error.
- **Touched:** `tokenizer.js` (reserved `in`), `ast.js`
  (`createForEachStatement`), `parser_rd.js` (`parseFor` branch), `checker.js`
  (element-type inference + non-list error), `emitter.js`
  (`for...of lamplighter.listItems(...)`), `src/lamplighter/index.js`
  (`listItems` normalizer). Docs: `devdocs/specs.md`.
- **Tests:** `tests/fixtures/foreach1.lamp` (object-list + string-list + empty),
  `tests/fixtures/foreach_badtype.lamp` (compile-failure).
- **Still possible later:** list literals, `.length`, indexing — not needed for
  iteration and deferred until a consumer appears.

## 2. `inventory` action + contents-listing in `look`
The most visible gameplay gap: carried/visible items are currently invisible.
`look` should list room contents; add an `inventory` (`i`) action listing what
the actor holds.
- **Where:** `lib/advent/actions.lamp` (new `report` rules), exercised via
  `tests/fixtures/advent3.lamp`.
- **Now unblocked** (item 1 done): iterate `holder` contents with `for ... in`.

## 3. Surface available exits in room description
Iterate `connects self.actor.holder _ _` and print the directions out of the
current room. Natural follow-on now that `bidi connects` + inverses work.
- **Where:** `lib/advent/rooms.lamp` arrival handler or `report look`.
- **Now unblocked** (item 1 done).

## 4. Parser v1 — resolution depth
From the game_parser v1 roadmap. Current resolver is "first in-scope name match
wins" — can't distinguish "brass lamp" from "lamp". Add, incrementally:
- articles (`the`/`a` dropped), adjectives, `it` pronoun;
- disambiguation prompt when >1 match;
- richer "you can't see that" / "which do you mean" messages.
- **Where:** the resolver in `src/lamplighter/index.js` (`resolveNoun`).
- **Supporting prereq:** string helpers (`to_lower`, `starts_with`, `word_at`)
  — game_parser prerequisite #3; decide native-helper vs language.

## 5. Centralize standard responses (overridable messages)
Action responses ("Taken.", "You can't go that way.") are hardcoded string
literals in `do`/`report`/`check` rules. The whole point of the `report`/`check`
split is override-without-edit; a responses indirection (e.g. a small rulebook
or a message table) makes a game retheme output without touching world logic.
- **Where:** `lib/advent/actions.lamp`; possibly a new `responses` rulebook.

## 6. Parser v2 — every-turn & timed rules
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
