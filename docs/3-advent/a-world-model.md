# The World Model

`lib advent` provides the standard IF world model: a hierarchy of types for
the things in your game, the relations that arrange them, and the queries
your rules use to ask where everything is.

## The type hierarchy

| Type | Parent | What it's for |
|---|---|---|
| `thing` | — | Anything nameable — the root, including non-physical things like directions and conversation topics. |
| `physical` | `thing` | Anything with a presence in the world: describable, touchable, listable. |
| `room` | `container` | A location. |
| `item` | `physical` | A portable (or scenery) object. |
| `box` | `item`, `container` | An item that holds things, openable and lockable. |
| `person` | `physical` | The player and NPCs. |
| `door` | `item` | A barrier between two rooms ([The Map](b-map.md)). |
| `backdrop` | `item` | Present everywhere or across a region ([The Map](b-map.md)). |
| `direction` | `thing` | North, up, and friends. |

Your game builds on these by declaring instances, subtypes (`type portal <
item:`), and reopened objects — the library's actions and `item.all` are
subtype-inclusive, so your subtype behaves as its parent everywhere.

## The fields that matter most

On `physical` (so on nearly everything):

- `description` — what EXAMINE prints.
- `scenery` — part of the room: unlisted in room descriptions, untakeable.
- `understand` — extra vocabulary, slash-separated:
  `understand "message/writing/floor"`. By default an object also answers
  to the words of its identifier; `private_name true` suppresses those, for
  objects whose internal name would leak a wrong word.
- `printed_name` — display name override; `proper` (no article) and
  `plural` adjust how it renders and agrees.
- `pronouns` — the object's pronoun set for adaptive messages
  (`"she"`, `"he"`, `"they"`, `"it"`, or a custom set).
- `initial_appearance` — a self-description paragraph used until first
  taken (see [Room Descriptions](d-describing.md)).
- `feels` / `sound` / `scent` — what TOUCH, LISTEN, SMELL report.
- `lit` — this thing gives off light (annotated `(providing light)` in
  inventory, and it lights dark rooms).
- `switchable` / `switched_on` — for TURN ON / TURN OFF.
- `supporter` — things can be PUT ON it (a table, a hook).
- `enterable` — the player can get in/on it; `vehicle` makes GO drive it.
- `take_refusal` / `attack_refusal` — per-object replacement text for
  refused TAKE / ATTACK.

On `room`: `description`, and `lighted` (default `true` — set `false` for
darkness). On `item`: `wearable`. On `box`: `closable`, `closed`,
`locked`, `transparent`, `matching_key`.

## The player

`yourself` is the built-in `person`; the global `player` points to it.
Reopen `yourself` to give starting possessions, a description for
X ME, or different pronouns. Games that swap protagonists reassign
`player` — the parser's `me` and the viewpoint machinery follow the
global.

## Containment

Everything is arranged in one containment tree via the `contains`
relation: rooms contain things and people, boxes and supporters contain
their contents, people contain what they carry. Because an object can be
in only one place, **`move X to Y`** is all you ever need — the old
placement evaporates automatically.

Two lookups do most of the work in rules:

- `holder(x)` — what directly contains `x`: a room, a box, a person, or
  the chair someone is sitting in.
- `location_of(x)` — the *room* enclosing `x`, however deeply nested.

```lamp
if holder(velvet_cloak) == player:      # carried right now
if location_of(butler) == Bar:          # somewhere in the Bar
```

Worn clothing is the separate `wears` relation (a worn item is also
carried): `wears yourself velvet_cloak` at top level starts it worn, and
the WEAR/DOFF actions maintain it during play.

## Scope, sight, and reach

**Scope** is what a command can refer to: roughly, what the actor's
location holds, what they carry, plus doors and backdrops present there —
recursing into open and transparent containers. What's sealed in a closed
opaque box is out of scope entirely.

The library distinguishes **seeing** from **reaching**. A closed
*transparent* box (a display case) leaves its contents visible — listed,
examinable — but not touchable: contact verbs refuse, sight verbs work.
This is automatic; sensory actions declare their slots `visible` while
everything else requires reach.

**Darkness**: a room with `lighted false` is dark unless a `lit` thing is
present. In the dark you can't see the room or its contents (LOOK prints
the darkness message), though touch still works. `in_darkness(actor)`
tests it, and light changes announce themselves at the end of the turn.

## Parts

`part_of PART WHOLE` marks a thing as a component — a door's scanner, a
panel's button. A part is in scope wherever its whole is and moves with
it; make it `scenery` so it isn't listed or takeable. `whole_of(part)`
returns its owner.

---

Next: [The Map](b-map.md).
