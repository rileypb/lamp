# Relations

A **relation** is a typed edge connecting objects — the language's way of
representing structured facts about the world. The map (`connects`),
containment (`contains`), and worn clothing (`wears`) are all relations;
your game can declare its own for any pairing it needs.

## Declaring a relation

```lamp
relation unlocks:
    from item source
    to portal target
    syntax "unlocks [source] [target]"
```

Every relation is a directed binary edge with exactly one `from` field (the
source) and one `to` field (the target); the field names are yours to
choose. Additional data fields may follow. The `syntax` line declares an
assertion/query template: `[field]` marks a slot, every other word is
literal, and the template must begin with a literal (conventionally the
relation's name).

Two field tags matter:

- **`unique`** makes a field a cardinality key: at most one edge per value
  of that field. Asserting a new edge with a matching value **evicts** the
  old edge first. This is how `contains` guarantees an object is in exactly
  one place — its target endpoint is unique, so placing something
  automatically removes it from where it was.
- **`inverted`** (on a data field) marks a field whose value should flip
  when a `bidi` edge is read backwards — advent's `connects` marks its
  direction field `inverted`, so a north edge reads as south from the other
  end. (The field's type must declare an `inverse` field, as `direction`
  does.)

## Asserting edges

With a `syntax` template, an assertion is one line, usable at top level or
inside any rule or function:

```lamp
unlocks brass_key oak_door
bidi connects Foyer south Bar
```

`bidi` asserts a single edge traversable from either end — going south from
the Foyer reaches the Bar *and* going north from the Bar reaches the Foyer.
Asserting an edge identical to an existing one is a no-op (relations are
deduplicated).

An assertion may be **named** by putting an identifier before the leading
literal — `north_door connects foyer north hall` — and a named edge can
later be removed with `disconnect north_door`.

## Querying

In an expression, the same template is a query. With values in every slot
it is a boolean — true when a matching edge exists — and `_` is a wildcard:

```lamp
if connects Foyer north _:
    print "There's a passage north."
if likes yourself _:
    print "You like something."
```

To **retrieve** a value instead, mark exactly one slot with `?` and a
multiplicity qualifier:

```lamp
let dest  = connects here self.way ?first   # the room reached, or none
let exits = connects here _ ?all            # list<room> of all reachable rooms
let ways  = connects here ? Bar             # list<direction> leading to the Bar
```

- `?first` — the first match's value, or `none` if no match.
- `?only` — the single value; `none` if no match, a runtime error if
  several match (use it when more than one would be a bug).
- `?all` (or bare `?`) — a list of the values across all matches.

Queries see `bidi` edges from both ends, with `inverted` fields flipped —
`connects Bar north ?first` finds the Foyer through the bidi edge asserted
above. Query slots must be simple atoms (a name, literal, `_`, or a
dotted chain); bind anything computed to a `let` first.

## Removing edges

```lamp
remove likes yourself widget    # remove this specific edge
remove connects Foyer _ _       # remove all edges from the Foyer
disconnect north_door           # remove a named edge
```

A `remove` matching a `bidi` edge from either direction removes the whole
edge.

## Moving objects: `move`

```lamp
move brass_key to player
move self.taken to holder(self.actor)
```

`move X to Y` is the author surface for containment: it asserts
`contains Y X`, and because `contains` marks its target unique, the old
placement is evicted automatically — one statement, no explicit removal.
The old container's `contains remove` handler fires before the new one's
`contains add`.

## Reacting to edges

`on RELATION add:` / `on RELATION remove:` handlers run when edges appear
and disappear, with `self` bound to the edge — see [Events](e-events.md).

---

Next: [Rulebooks](g-rulebooks.md).
