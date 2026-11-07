# Lamp — User Documentation

Lamp is a system for writing and playing interactive fiction. You write your
game in the Lamp language, compile it with **Lantern**, play it with
**Lamplighter**, and package it for players with **Lighthouse**.

This is the table of contents for the user documentation. Folders are
numbered by part and files are lettered, so everything sorts in reading
order. Pages not yet written are marked *(planned)*.

## Part I — Getting Started

1. [Introduction](1-getting-started/a-introduction.md) — What Lamp is, what
   a finished game looks like, and how Lantern, Lamplighter, and Lighthouse
   fit together.
2. [Installation](1-getting-started/b-installation.md) — Installing Node.js
   and the `lampif` package; the `lantern`, `lamplighter`, and `lighthouse`
   commands.
3. [Your First Game](1-getting-started/c-first-game.md) — A minimal playable
   game in a single `.lamp` file: a room, an object, compile, play.
4. [Tutorial: Cloak of Darkness](1-getting-started/d-tutorial-cloak.md) —
   Building the classic IF demo step by step: rooms, darkness, a wearable
   cloak, custom phrasings, and a won/lost ending.

## Part II — The Lamp Language

5. [Syntax Fundamentals](2-language/a-syntax.md) — Source files, indentation
   and blocks, comments, identifiers and display names, string literals,
   reserved words.
6. [Objects and Kinds](2-language/b-objects-and-kinds.md) — Declaring
   objects and types, fields and defaults, nesting and reopening,
   inheritance, `self` in declarations, enum kinds.
7. [Globals and Constants](2-language/c-globals.md) — Global variables,
   list and map tables, `const`, overriding library defaults.
8. [Functions](2-language/d-functions.md) — Defining and calling functions,
   function references, conditional overloads, native functions.
9. [Events](2-language/e-events.md) — Named events and `dispatch`,
   field-change handlers, relation add/remove handlers.
10. [Relations](2-language/f-relations.md) — Declaring relations, asserting
    and removing edges, queries (`?first`/`?only`/`?all`), `bidi`, `move`.
11. [Rulebooks](2-language/g-rulebooks.md) — Named rulebooks and `follow`;
    actions, the rule bands (before / instead / check / do / after /
    report), stop reasons, selectors, and `try`.
12. [Scenes](2-language/h-scenes.md) — Scene begin/end conditions, hooks,
    the `during` guard, and scene chaining.
13. [Statements and Expressions](2-language/i-statements-and-expressions.md)
    — Control flow, assignment, operators, lists, name resolution.
14. [Text Output](2-language/j-text.md) — `print` and text substitutions,
    articles and pronouns, verb agreement, conditional and varying text,
    randomness.

## Part III — The Adventure Library (`lib/advent`)

15. [The World Model](3-advent/a-world-model.md) — The type hierarchy, key
    fields, the player, containment (`move`, `holder`, `location_of`),
    scope, sight and reach, darkness, parts.
16. [The Map](3-advent/b-map.md) — Directions and exits, doors and locks,
    regions, and backdrops.
17. [Actions](3-advent/c-actions.md) — The standard verbs, the fail-soft
    pattern, implicit actions, and writing your own actions.
18. [Room Descriptions and Looking](3-advent/d-describing.md) — The
    description pipeline: headings, initial appearances, listing control,
    darkness, verbosity, the status line.
19. [Every-Turn Rules and the Turn Cycle](3-advent/e-turn-cycle.md) — What
    spends a turn, daemons and countdowns on `every_turn_rules`.
20. [NPCs and Movement](3-advent/f-npcs.md) — NPCs acting via `try`,
    witnessed movement, routes, orders and persuasion.
21. [Conversation](3-advent/g-conversation.md) — The opt-in
    `lib/conversation` library: greeting, ASK/TELL topics, free-text SAY,
    asking for things.
22. [Scoring](3-advent/h-scoring.md) — `score`/`max_score`,
    `award_points`, the SCORE verb and status line.
23. [Ending the Story](3-advent/i-endings.md) — `story = won`/`lost`,
    custom ending text via `end_story_rules`, the end-of-story prompt.

## Part IV — Presentation and Polish

24. [Messages and House Style](4-presentation/a-messages.md) — Overriding
    library and parser messages by name, the `act` global, messages vs.
    rules, giving a game a voice.
25. [Text Windows](4-presentation/b-text-windows.md) — Docked panes,
    declarative per-turn content, host fallback, customizing the status
    bar.
26. [Custom Shells](4-presentation/c-custom-shells.md) — `shell_send`
    events, the `<game>.shell/` directory, `LampShell` hooks, clicks as
    commands.
27. [Images](4-presentation/d-images.md) — `image` assets, canvas panes,
    the drawing ops, hotspots, graceful fallback.
28. [Localization](4-presentation/e-i18n.md) — Choosing a locale,
    localizing a game (the French Cloak), writing a new locale pack.

## Part V — Testing and Shipping

29. [Testing Your Game](5-shipping/a-testing.md) — TEST scripts,
    transcripts, and deterministic diff-based regression testing.
30. [Saving and Restoring](5-shipping/b-saving.md) — Named slots, what a
    save captures, where saves live, and build compatibility.
31. [Building for the Web](5-shipping/c-web-builds.md) — Lighthouse
    bundles, build options, and static hosting (GitHub Pages).
32. [Building a Desktop App](5-shipping/d-electron-builds.md) — The
    Electron project, OS-native saves, packaging and signing.

## Part VI — Reference

33. [Command-Line Reference](6-reference/a-cli.md) *(planned)* — All flags
    for `lantern`, `lamplighter`, `lighthouse`, and `lighthouse-electron`.
34. [Action Reference](6-reference/b-actions.md) *(planned)* — Every
    built-in action with its grammar and default behavior.
35. [Message Reference](6-reference/c-messages.md) *(planned)* — Every
    library message and how to override it.
36. [Lamp for Inform 7 Authors](6-reference/d-from-inform7.md) *(planned)* —
    A translation guide for authors coming from Inform 7.
