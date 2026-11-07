# Room Descriptions and Looking

What the player reads when they arrive somewhere — or type LOOK — is
assembled from several layers, each with its own customization point.

## The anatomy of a room description

```
Hall
A dusty hall. A study lies east; the yard is north.

A crumpled form lies in a corner.

On the table is a candle.

You see a crate (in which is a coin) and a butler here.
```

In order: the **heading** (the room's name), the room's **description**
prose, each thing with an **initial appearance** in its own paragraph,
each occupied **supporter's** "On the table is…" paragraph, then the
**contents list** — every non-scenery thing the room holds except the
player, people included, with an open container's contents shown inline.

## The heading

The default heading is the bare room name on its own line, printed
through the `room_heading_rules` rulebook — so a game can restyle it by
contributing a rule (game rules run first and `stop` the default):

```lamp
rule room_heading_rules:
    print "[The r]. "     # no line break: description runs on into the paragraph
    stop true
```

This is how a game gets a name-embedded, novelistic opening ("Galaxy is
in the passage end. …") instead of the classic bold-name-on-top. When the
player is inside something, the heading gains the enclosure chain:
`Parlor (in the armchair)`.

## Controlling what's listed

- **`scenery`** — never listed (and not takeable): for things the
  description prose already establishes.
- **`initial_appearance`** — a self-description paragraph ("A crumpled
  form lies in a corner.") used *instead of* the list entry until the
  thing is first taken; after that it's `handled` and lists normally.
  The classic staging device for objects that should feel placed, not
  strewn.
- **`mentioned`** — a thing whose name renders through a substitution in
  the room's own description (`"…[the guard] slouches by the door…"`) is
  dropped from the list automatically, so it's never named twice. Prose
  that names a thing *without* a substitution doesn't trigger this — use
  `scenery` there.

People are listed alongside items ("…and a butler here"); their
inventories don't nest into the listing.

## Darkness

A dark room describes as:

```
Darkness
It is pitch dark, and you can't see a thing.
```

When the light changes without the player moving — a lamp switched off, a
`lighted` flag flipped by a rule — the end of the turn announces it:
darkness falling prints "It is now pitch dark in here!", and light
returning re-describes the room. Inside a closed opaque container, the
player's world is the interior: LOOK describes the enclosure and its
contents, and only carried light helps.

## Arrival verbosity

Arrival descriptions follow the classic display modes, set by the player
with `verbose` (always full — the default), `brief` (full on first visit,
name-only after), and `superbrief` (name-only). An explicit LOOK is
always full. Games needn't do anything to support these.

## The status line

Hosts with a screen (the web shell, the TUI) show a status bar: the room
name on the left — "Darkness" when dark — and the turn count, or the
score once your game sets `max_score`, on the right. It's a text window
(`status_bar`), so games can restyle, resize, or replace its content by
contributing to `status_line_rules`; see
[Text Windows](../4-presentation/b-text-windows.md).

---

Next: [Every-Turn Rules and the Turn Cycle](e-turn-cycle.md).
