# The Map

## Directions and exits

The map is the `connects` relation: room, direction, room. `bidi` makes an
exit two-way (the reverse uses the direction's inverse); without it, the
connection is one-way — useful for chutes and trapdoors:

```lamp
bidi connects Foyer south Bar
connects Attic down Cellar        # one-way drop
```

The directions are the eight compass points, `up`/`down`, and
`inward`/`outward` (typed IN and OUT by the player). Players move with
`go north`, `north`, or just `n`. A direction with no exit refuses with a
direction-aware message ("You can neither climb walls nor fly." for `up`);
customize per room with a `report failed go` rule, or block an existing
exit with `instead go` (as the cloak tutorial's foyer does).

Route-finding is built in: `route_to(here, destination)` returns the first
step of a shortest route as a direction (or `none`), which is the engine
of NPC travel — see [NPCs and Movement](f-npcs.md).

## Doors

A **door** stands between two rooms, declaring its sides as
direction-room lines — the *destination* reading, "going east reaches the
Study":

```lamp
door oak_door:
    east Study
    west Hall
    scenery
    description "A heavy oak door."
```

At startup the library wires the map from those fields: the door creates
the `connects` edges itself (don't also assert them), is present in both
rooms, and blocks movement while closed ("The oak door is closed.").
Doors are closed by default and answer to the standard OPEN and CLOSE
verbs; a door must name exactly two sides (compile-checked).

Locks work through **`matching_key`** (on both `door` and `box`):

```lamp
door vault_door:
    north Vault
    south Corridor
    locked
    matching_key iron_key
```

`unlock vault_door with iron_key` — or bare `unlock vault_door`, which
uses the matching key if the actor holds it, announcing "(with the iron
key)". Unlocking doesn't open (OPEN is a separate action, as tradition
demands); locking requires the door closed. The default `matching_key` of
`none` means no key fits — the lock yields only to your game's own
mechanism. For fully custom lock logic, `instead unlock` rules replace the
standard behavior (`sample/study_advent.lamp` drives one from a
key-to-door relation).

## Regions

A **region** groups rooms so rules can ask "anywhere in the base?" without
enumerating:

```lamp
region estate
region garden:
    region estate          # regions nest: garden is part of estate

room Lawn:
    region garden
```

`in_region(room, region)` tests membership through the nesting chain —
the Lawn is in the estate through the garden:

```lamp
before go when in_region(location_of(player), estate):
    ...
```

Regions also make good field-default fallbacks by convention: reopen
`region` with the same fields as your rooms and read them room-first,
then up the region chain — one region carries the majority value, rooms
override.

## Backdrops

A **backdrop** is present in scope *everywhere* — walls, the sky, a
distant mountain — without being contained in any room, so it never
appears in contents listings:

```lamp
backdrop sky:
    understand "sky/clouds"
    description "The sky is a flat, even blue."
```

Give a backdrop a `region` field to confine it to that region's rooms (a
PA system heard only inside the base); unscoped backdrops are truly
everywhere. The library provides the presence; the responses are yours,
via ordinary rules — vary them per room by guarding on
`holder(self.actor)`:

```lamp
instead touch when self.target == sky:
    print "Your fingers find only empty air.[line break]"
    stop succeeded
```

---

Next: [Actions](c-actions.md).
