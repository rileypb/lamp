# Objects and Kinds

A Lamp world is made of **objects** — rooms, items, people, the game itself —
each an instance of a **type** that declares its fields.

## Declaring objects

```lamp
TYPE_NAME OBJECT_NAME:
    FIELD_NAME VALUE
    ...
```

Each indented line sets a field. A value is a literal (`42`, `"text"`,
`true`, `false`, `none`) or another object's name:

```lamp
item velvet_cloak:
    description "A handsome cloak."
    wearable          # same as `wearable true`
```

A bare field name is **boolean shorthand** for `true` — that's why sample
games write `wearable` and `scenery` alone. An object with no fields omits
the `:` and body entirely (`person yourself`).

Object-typed fields (like `start Foyer` on a game) are resolved after all
objects are created, so the referenced object may be declared anywhere in
the source — forward references just work.

**Unset fields** read as their type's declared default if it has one,
otherwise as a "zero": `""` for strings, `0` for numbers, `false` for
booleans. An unset object reference is `none`.

## Nested objects

Inside an object body, a line starting with a *type name* declares a nested
object placed inside the encloser via the `contains` relation:

```lamp
room Cloakroom:
    description "A small cloakroom."
    item hook:
        description "A small brass hook."
        scenery
```

This is exactly equivalent to declaring `hook` at top level plus
`contains Cloakroom hook`. Nesting recurses (an item inside a box inside a
room), and the nested name is globally visible like any object. A nested
line may also be **bodyless** — `item lantern` with no colon — which either
declares a fieldless object or, if `lantern` is declared elsewhere, simply
places that existing object here.

## Reopening an object

Declaring the same `TYPE NAME:` twice **merges** the blocks into one object.
This works across files, so a game can reopen an object a library defines —
for example, giving the player a starting possession:

```lamp
person yourself:          # adds to advent's yourself
    item hat:
        description "A hat."
        wearable
```

The type must agree across blocks; fields set in more than one block take
the last value in source order, so a game's reopen overrides a library
object's field. (Beware: an accidental duplicate name merges silently
rather than erroring.)

## Declaring types

```lamp
type portal < item:
    bool locked
```

A type declaration lists fields as `FIELD_TYPE FIELD_NAME`, optionally with
a default (`string feels = "generic plastic"`). `< PARENT` inherits the
parent's fields; multiple parents are comma-separated. Field types may be:

- **Primitives**: `string`, `int`, `real`, `bool`, and `text` (a lazily
  rendered template — see [Text Output](j-text.md)).
- **Object types**: the field holds a reference to an instance (or `none`).
- **Kinds** (below) and `list<T>`.

Library types are open in two ways: a game can declare subtypes of them
(advent's actions and `item.all` are subtype-inclusive, so a `portal`
behaves as an `item` everywhere), and it can reopen an object of them.

**Re-defaulting**: a subtype may re-declare an inherited field to change its
*default* (repeating the same field type exactly):

```lamp
type gadget:
    string feels = "generic plastic"

type chrome_gadget < gadget:
    string feels = "smooth cold metal"
```

## `self` in declaration templates

A field's default (in a type body) or value (in an object body) may be a
text template that references **`self`** — the object the field belongs to.
The template is bound per instance, so one shared default renders each
instance's own name and state:

```lamp
type scanner_door < door:
    string description = "The door is [if self.closed]closed[else]open[end if]."
    string take_refusal = "[The self] won't budge."
```

Every `scanner_door` gets a live description that re-renders against its
own `closed` field on each print. Note that the field must be written
`[self.closed]` — a bare `[closed]` in a template is not a field reference.
Declaration templates may reference `self`, globals, named objects, and
function calls; nothing else is in scope there.

## Built-in fields

Every object exposes two built-in fields: **`all`** — the list of all
instances of its type (`item.all` has type `list<item>`) — and **`type`** —
the object's type.

## Kinds

A **kind** defines a range of *values*, as opposed to a type's class of
discrete objects. The built-in constructor is `enum`:

```lamp
kind color = enum(red, green, blue)

type lamp_shade < item:
    color tint = red
```

Enum labels are bare identifiers; a field of a kind type holds one label,
compares with `==`, and prints as the label text.

---

Next: [Globals and Constants](c-globals.md).
