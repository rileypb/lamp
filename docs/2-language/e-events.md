# Events

Lamp has three families of hooks that run when something *happens*: named
events, field-change handlers, and relation handlers. (The fourth and
biggest — action rules — has [its own page](g-rulebooks.md).)

## Named events

An event is a type descending from the built-in `event`; a handler is an
`on` block; `dispatch` fires one:

```lamp
type pinged < event

on pinged:
    print "Ping received.[line break]"
```

```lamp
dispatch pinged
```

Any number of handlers may exist for the same event; all run in
registration order. The built-in `startup` event fires once when the game
begins (though with the adventure library you'll usually contribute to its
`startup_rules` rulebook instead of handling `startup` directly — the
library owns the startup sequence and runs your rules at the right moment
in it). Scenes also dispatch events — `NAME_begins` / `NAME_ends` — that
you handle the same way; see [Scenes](h-scenes.md).

## Change handlers

A change handler runs whenever a field is assigned on any instance of a
type:

```lamp
on gadget.setting change:
    print "[The self] shifts mood.[line break]"
```

Inside the body, **`self` is the instance whose field changed**. Handlers
fire for the declared type and its subtypes, and multiple handlers for the
same field all run in registration order. Assignments made anywhere —
rules, functions, other handlers — are observed.

## Relation handlers

A relation handler runs when an edge of a relation is asserted or removed:

```lamp
on likes add:
    print "A fondness forms.[line break]"

on likes remove:
    print "The magic fades.[line break]"
```

Inside the body, `self` is the relation edge being added or removed. These
are powerful with the world model's own relations: a handler on `contains`
sees every movement of every object. Note the eviction order — when an
object moves, its old container's `contains remove` fires before the new
container's `contains add` (see [Relations](f-relations.md)).

## `self`, everywhere

Across the whole language, `self` follows one convention: *the instance the
enclosing declaration is about*. In a change handler it's the changed
object; in a relation handler, the edge; in an action rule, the running
action; in a declaration-site template, the owning object.

## The `during` guard

Every handler form accepts `during SCENE` after its header, gating it on a
scene being active:

```lamp
on pinged during watch:
    ...
on gadget.setting change during watch:
    ...
on likes add during watch:
    ...
```

See [Scenes](h-scenes.md).

---

Next: [Relations](f-relations.md).
