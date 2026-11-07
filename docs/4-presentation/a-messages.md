# Messages and House Style

Every fixed piece of library prose — "Taken.", "You can't go that way.",
the darkness line, the parser's "You can't see any such thing." — is a
**named message** your game can replace. This is how a game gets a voice.

## Overriding by name

A top-level `NAME: "text"` line replaces the message everywhere it's
printed:

```lamp
take_report: "[We] [pocket] [the act.taken]."
go_cant: "The den has only the one exit."
parser_cant_see: "Nothing like that is here."
```

```
> take pebble
You pocket the pebble.
```

The catalog of names lives in the library's locale file —
[`lib/advent/locales/en-US.lamp`](../../lib/advent/locales/en-US.lamp) —
one `NAME: "…"` per message, which doubles as a reference for each
message's default wording. Failure messages follow their reasons
(`take_cant_take`, `go_cant_up`, `wear_already_worn`…); parser feedback is
the `parser_*` family.

## What a message can reference

An override renders wherever the original did, so it can't see the
original rule's locals. It *can* use:

- **`act`** — the running action: `act.actor`, `act.taken`, any slot by
  name. (`act` is the global counterpart of a rule's `self`.)
- **Globals and named objects** — including values the library routes
  through globals for exactly this purpose.
- All the [text machinery](../2-language/j-text.md) — `[We]`, `[the
  act.taken]`, verbs, conditionals, variation. If your override uses a
  verb the locale doesn't know (`[pocket]`), declare it: `verb pocket`.

Because library messages are written with `[We]` and friends, they adapt
to any viewpoint your game sets — override only what you want to *sound*
different.

## Messages vs. rules

Two levers, by kind of change:

- **Wording only** → a message override. One line, applies everywhere,
  stays in sync with the library's logic.
- **Different behavior** — conditions, side effects, per-object variation
  beyond what the message can express → a rule (`instead …`, or a
  `report` rule printing and `stop`ping, as in
  [Rulebooks](../2-language/g-rulebooks.md)).

Between the two sit the **per-object refusal fields** — `take_refusal`,
`attack_refusal`, `feels` — declarative one-object overrides needing no
rule at all.

## Game-authored messages

Your own prose can join the registry with the inline form — the default
lives at the use site, and remains overridable by name (useful for your
own late tweaks, or a translation pack):

```lamp
report examine when self.target == pebble:
    print pebble_msg:"Smooth, gray, unremarkable."
    print "[line break]"
    stop
```

## House style at larger scale

For a whole-game presentation shift — third-person narration, a named
protagonist, a glyph cipher — the pieces compose: the viewpoint globals
drive `[We]` everywhere, message overrides retheme the fixed prose, a
`room_heading_rules` contribution restyles the room heading, and
`end_story_rules` owns the closing. The Phobos sample
([sample/phobos/](../../sample/phobos/)) does all four; its
`lib/phobos/messages.lamp` is a worked example of a message pack.

---

Next: [Text Windows](b-text-windows.md).
