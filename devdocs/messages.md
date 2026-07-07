# Default messages and localization (design)

Status: **layer-3 split complete (2026-07-05) — advent's rules hold no prose.** Every
named message in lib/advent is a default-less reference (`message NAME`); the English
text lives in `lib/advent/locales/en-US.lamp` (loaded under the default locale by the
same per-library mechanism as the French pack), the French in `locales/fr-FR.lamp`,
and the compiler's **completeness check** errors when the active locale misses a key.
Consequence: no English prose or English template sugar compiles under fr-FR, so
`lib/fr-FR` declares no English vocabulary at all (see devdocs/i18n.md). Only the
inventory item *name* stays a plain print — it references the loop-local `x`, and a
message can reference only `act`/globals — split out so the `(worn)` marker beside it
is still a named message. Two former local-reference gaps were closed by routing the
value through a global the message can read: the closed-door refusal
(`blocking_door`, doors.lamp) and the score notification (`points_awarded`,
scoring.lamp). The engine's parser feedback also routes through the registry
(`parser_cant_see`/`parser_no_understand`/`parser_no_multi`, with engine-side
defaults).

Earlier stages, all done: Part 1 (the `act` global), Part 2 (the named-message
mechanism), Part 3 (advent's action + non-action strings named).

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

## Default-less references and the completeness check (layer 3 — done)

The inline-default form left advent's English prose (and its English template sugar)
compiling under every locale — a partial translation silently mixed languages, and a
locale pack had to declare English vocabulary just to parse text it never rendered.
The layer-3 split moves the prose out:

- **`message NAME`** (expression) — a message reference with *no* inline default;
  emits `lamplighter.message("NAME")`. `message` is contextual: two adjacent
  identifiers are invalid otherwise, so a local or object named `message` still
  parses as a plain identifier.
- **Completeness check** (checker, whole merged program): every default-less
  reference must have a `NAME: "…"` registration in *some* loaded file — normally
  the library's locale file `lib/<lib>/locales/<tag>.lamp`. A missing key is a
  compile error naming the reference site (golden `missing_message`), so a partial
  translation fails the build instead of rendering blank or falling back to another
  language. Runtime `message()` keeps a loud `[missing message: NAME]` fallback for
  the unreachable case.
- **Ownership**: advent's rules say `print message take_report`; the English text
  lives in `lib/advent/locales/en-US.lamp` (the default locale loads it exactly like
  fr-FR loads the French file), French in `locales/fr-FR.lamp` — both complete, both
  compiler-enforced. A game file, loaded last, still overrides by name as before.
  The inline-default form remains for game-authored messages (`print my_msg:"…"`),
  where source language and play language coincide.
- **The `act`/globals constraint bites at migration**: a moved default may not
  reference rule locals. The two cases in advent were fixed by routing the value
  through a global (`blocking_door`, `points_awarded`); the migrated texts' lexical
  `self.` became `act.` (identical inside the running action).

Deferred: runtime-set messages with arbitrary computed text (needs a runtime
substitution evaluator); runtime locale switching.
