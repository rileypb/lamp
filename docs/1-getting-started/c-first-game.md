# Your First Game

A complete, playable Lamp game fits in one small file. Save this as
`lantern_room.lamp`:

```lamp
lib advent

game Lantern_Room:
    author "You"
    tagline "A first Lamp game"
    version 1
    release dev
    start Cellar

room Cellar:
    description "A low stone cellar. Stairs lead up to the kitchen."

room Kitchen:
    description "A warm kitchen, smelling of bread."

bidi connects Cellar up Kitchen

item brass_lantern:
    description "A dented brass lantern, still serviceable."

contains Cellar brass_lantern
```

Run it:

```sh
node src/lantern/exe.js lantern_room.lamp
# or, if installed globally:
lantern-exe lantern_room.lamp
```

And play:

```
Lantern Room
A first Lamp game by You
Version 1 dev

Cellar
A low stone cellar. Stairs lead up to the kitchen.

You see a brass lantern here.

> examine lantern
A dented brass lantern, still serviceable.

> take lantern
Taken.

> up
Kitchen
A warm kitchen, smelling of bread.
```

## What each part does

**`lib advent`** imports the adventure library: the world model (rooms,
items, containment, darkness), the standard verbs, and the turn loop. Almost
every game starts with this line.

**The `game` block** declares the game itself. Its name (`Lantern_Room`)
is an *identifier* — no spaces allowed — and doubles as the display title
with underscores turned into spaces ("Lantern Room"). The fields:

- `author`, `version`, `release` — identity, shown in the banner.
- `tagline` — a subtitle. Setting it is also what *opts you into* the title
  banner; leave it out and no banner prints.
- `start` — the room the player begins in. This is the one field a playable
  game must set.

**`room` declarations** create rooms. A `description` is the prose printed
when the player enters or types LOOK. Indentation is structural, as in
Python: the indented lines belong to the block above them.

**`bidi connects Cellar up Kitchen`** builds the map. `connects` is a
*relation* linking two rooms through a direction; `bidi` makes it two-way,
so going up from the Cellar leads to the Kitchen *and* going down from the
Kitchen leads back. Without `bidi`, the connection is one-way. The standard
directions are the eight compass points plus `up`, `down`, `inward`, and
`outward` (the last two answer to the player typing IN and OUT; they're
declared with longer names because `in` is an operator in Lamp).

**`item brass_lantern`** creates a portable object, and
**`contains Cellar brass_lantern`** places it: `contains` is the containment
relation, and works between any holder and thing — a room and an item, a
container and its contents, or the player and what they carry.

Notice the player referred to the object as `lantern`. Objects answer to the
words of their identifier out of the box; you can add more synonyms with an
`understand` line, which the tutorial covers.

## What you got for free

You wrote no verbs, yet the game already understands LOOK, EXAMINE,
TAKE and DROP, INVENTORY, movement in every direction, and much more —
plus the meta-commands UNDO, SAVE, RESTORE, RESTART, and QUIT. That is the
adventure library at work. Writing a game is mostly *declaring your world*
and then *adding rules* for the ways your game differs from the defaults.

Rules are the other half of the language, and the best way to meet them is
to build a real game: [Tutorial: Cloak of Darkness](d-tutorial-cloak.md).
