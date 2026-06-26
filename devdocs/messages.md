# Default messages and localization (design)

Status: **mechanism complete; advent's action messages converted.** Part 1 (the
`act` global), Part 2 (the named-message mechanism), and Part 3 for all of advent's
**action** messages (take/drop/wear/doff/examine/go/put_on reports + failures and the
implicit-action parentheticals; inventory header/empty + the `(worn)` marker) are
implemented. Only the inventory item *name* stays a plain print — it references the
loop-local `x`, and a message can reference only `act`/globals — but it is split out
so the `(worn)` marker beside it is still a named message. **Remaining (optional):** the
non-action strings: the startup banner/quit prompt in startup.lamp. (The darkness
line and the room-contents frame in rooms.lamp are now named — `darkness_name`/
`darkness_description`, `room_contents_intro`/`room_contents_outro` — for the
French translation; see devdocs/i18n.md.) A worked French pack now exists at
`lib/advent/locales/fr-FR.lamp`.

## Problem

A world library like `lib/advent` prints many default, player-facing strings from
its rules — `"Taken."`, `"You can't go that way."`, `"[The self.actor] [take] [the
self.taken]."`. The dynamic bits (articles, pronouns, verb agreement) are already
localized through the text-substitution layer (`lib/en-US`), but the **fixed prose**
is hardcoded English in the rulebooks, with no way to translate or retheme it.

The generic locale (`lib/en-US`) can't hold these: it is loaded *before* any
imported library, so it cannot reference advent's actions or messages. The right
shape is the gettext/Inform model — **source strings live in the library's authoring
language (English), factored out and named, and a translation pack overrides them.**

## The `act` global (Part 1 — done)

The obstacle to making a message overridable elsewhere is that `[the self.taken]`
captures a **lexical** `self` (the rule's action parameter), frozen at the point the
template is written. An override authored in another file has no `self`.

The fix: expose the running action as a **global**, `act`, instead of relying on
lexical `self`. A `text` value is a lazy closure rendered on `print`; if it reads
`act` (a global) rather than `self` (a lexical), it becomes **context-free** — it
renders against the *current* action wherever and whenever it is rendered. That makes
a message template movable, overridable from another file, and even settable at
runtime, with no scope-capture map and no runtime substitution interpreter. (The cost
is that messages may reference the action and globals/objects, but not arbitrary
locals — which Inform also disallows for out-of-context responses.)

- `act` is declared `global object act = none` in `lib/sys` (typed `object` because
  the base `action` type is a reserved keyword; slot access like `act.taken` is
  loosely typed but resolves at runtime).
- `runAction` sets `act` to the action instance for the action's whole run and
  restores the previous value afterward (so a nested `try` points `act` at the
  innermost action and pops back).
- `act` is **transient**: excluded from save/undo state.
- Authoring: rules and messages reference `act.actor` (universal), `act.taken`, etc.
  `act` replaces the `noun`/`second noun` global pattern — any slot is reachable by
  its declared name. Outside an action `act` is `none`.

## Named messages (Parts 2–3 — planned)

A **named, overridable message** is written at the point of use, with its English
default inline:

```lamp
report take:
    print taken:"Taken."
    print take_other:"[The act.actor] [take] [the act.taken]."
```

`NAME:"DEFAULT"` registers the message `NAME` with that default and evaluates to its
current text. A translation pack overrides by name, anywhere loaded after the default:

```lamp
taken: "Pris."
```

Because messages reference only `act`/globals (context-free), an override can be
compiled in its own pack and registered last-wins; no use-site deferral is needed.
Selection is by **which pack you import** (`lib advent` + `lib advent_fr`), so no
runtime `locale` global is required for compile-time translation.

**Mechanism (implemented).** The inline form provides the default *at the use site*,
so the override registry holds only overrides:

- `NAME:"DEFAULT"` (an `IDENT : STRING` expression) emits
  `lamplighter.message("NAME", <default text>)`, where `message(name, default) =
  override(name) ?? default`. The default compiles in the use-site scope (so it may
  use `self`, though `act` is preferred for override-compatibility).
- `NAME: "TEXT"` (a top-level `IDENT : STRING` declaration) emits
  `lamplighter.registerMessageOverride("NAME", <text>)` at load time. It compiles in
  top-level scope (no `self`), so its substitutions must use `act`/globals.

No hoisting or AST-walking is needed: the default is inline, the override is a
load-time registration, and `message()` prefers the override regardless of order.

Deferred: runtime-set messages with arbitrary computed text (needs a runtime
substitution evaluator); runtime locale switching.
