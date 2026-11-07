# Text Output

Prose is a game's user interface, and Lamp's text system is built around
one idea: a string literal containing `[…]` substitutions is a **live
template** that re-renders against the current state of the world every
time it prints.

## Substitutions

An unescaped `[EXPR]` inside a string embeds a Lamp expression:

```lamp
print "Your score is [score].[line break]"
print "You see [the self.taken]."
```

A number renders as digits, an object as its name (or its `printed_name`
field when set), a list as prose. Two formatting substitutions you'll use
constantly: **`[line break]`** ends the line — `print` itself does *not* —
and **`[par]`** produces a paragraph break.

A literal with substitutions has type **`text`**: it is lazy, re-evaluating
its substitutions at every render. A `text` stored in a field stays live —
a description written `"The door is [if self.closed]closed[else]open[end
if]."` reads the door's *current* state each time. `text` values satisfy
`string` positions everywhere; when you need a fixed snapshot instead,
`freeze EXPR` renders once and keeps the resulting plain string.

## Articles, pronouns, and verb agreement

Inside substitutions, the language pack provides natural-language sugar:

- **Articles**: `[the X]` / `[a X]` render an object with its definite or
  indefinite article (proper-named objects get none). Capitalize the sugar
  word to capitalize the output: `[The self]`.
- **The player**: `[We]` / `[us]` / `[our]` render the story's viewpoint —
  "you" in the default second person, a name or "she" in games that change
  the viewpoint globals — so library and game messages adapt to any
  narration style.
- **A subject**: `[They]` / `[them]` / `[their]` / `[themself]` render the
  current third-person referent, and each object chooses its own pronouns
  via its `pronouns` field (a preset like `she`, `he`, `they`, `it`, or a
  full custom set such as `xe/xem/xyr/xyrs/xemself`).
- **Verbs**: `[are]`, `[drop]`, and any word registered with a `verb`
  declaration conjugate against the current subject.

Naming a thing switches agreement onto it — after `[The gizmo]`, a later
`[are]` agrees with the gizmo — and `[regarding EXPR]` sets the subject
explicitly while rendering nothing:

```lamp
print "[The gizmo] hums. [They] [are] busy.[line break]"
# → The gizmo hums. It is busy.

print "[regarding widget][Their] surface gleams.[line break]"
# → Its surface gleams.
```

This is what lets one message serve every object and every viewpoint.

## Conditional text

`[if COND]…[else if COND]…[else]…[end]` chooses between branches inline
(`[otherwise]` and `[end if]` are aliases, matching Inform habits):

```lamp
description "The door is [if self.closed]closed[else]open[end if]."
```

Branches may contain their own substitutions, but an `[if]` cannot nest
inside another bracket block — compose a separate `text` value and
interpolate it instead.

## First-time text

`[first time]…[only]` renders its content the first time *that spot in the
text* renders, and never again:

```lamp
description "[first time]You've never been here before. [only]The lab hums."
```

The state is per-site — each `[first time]` block tracks itself — and
durable: it survives undo, save, and restore.

## Variation

`[one of]…[or]…[or]…[MODE]` renders one alternative per render, chosen by
the closing mode word:

```lamp
description "The lab hums [one of]softly[or]loudly[or]alarmingly[cycling]."
```

Modes: `[cycling]` (in order, wrapping), `[stopping]` (advance, then stick
on the last), `[at random]` (never the same twice running), `[purely at
random]`, `[in random order]` (shuffled, no repeats until exhausted),
`[sticky random]` (random once, then fixed), and `[as decreasingly likely
outcomes]` (weighted toward the first). Like `[first time]`, the cursor is
per-site: variation advances each time *the same template site* renders —
examining the same thing repeatedly — not across different messages.

## Randomness

The same machinery is available on computed values:

- `pick(list, mode)` — choose an element by the variation modes (default:
  no-repeat random).
- `random(n)` — a uniform integer in `[0, n)`; the general primitive for
  dice and chance.
- `shuffle(list)` — shuffle in place.
- `seed_random(n)` / `randomize()` — the RNG is seeded and deterministic by
  default (good for testing); `randomize()` opts into cross-playthrough
  variety.

All draws come from one seeded, save-captured stream, so undo and restore
reproduce sequences exactly.

## Quote convention

In prose, a `'` between letters stays an apostrophe (`don't`), while
`'quoted words'` render with typographic double quotes — so dialogue inside
a double-quoted literal reads naturally. `[']` forces a literal apostrophe.

## Two gotchas

- In a *declaration-site* template (a field default), a field must be
  written `[self.field]`; a bare `[field]` is not a field reference (it
  falls through to a string literal).
- An index expression can't appear inside a substitution (`[m[k]]` — the
  scanner stops at the first `]`); bind it with `let` first.

---

This concludes Part II. Continue with
[Part III — The Adventure Library](../3-advent/a-world-model.md), which
covers the world model your rules act on.
