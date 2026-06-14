# Relations in Lamp

## Purpose

Relations are typed, directed edges in the Lamp object graph. Every object (room, item, person, direction, etc.) is a graph node. Relations connect pairs of nodes and can carry additional data fields, enabling graph-structured game state — room connectivity, containment hierarchies, social relationships, and anything else that links objects.

## Core Model

- All objects are graph nodes.
- A **relation instance** is a directed edge connecting two or more objects according to a declared relation type.
- Relation instances are themselves objects: they can be named, can have additional fields, and can be referenced. They are not garbage-collected because they are reachable through the objects they connect.
- Relations are directed by default. Bidirectional relations (see below) are a single instance with symmetric traversal, not two separate instances.
- Asserting the same relation with identical field values twice produces one instance. Equality is determined field by field: object-typed fields are matched by identity; value-typed fields (`string`, `int`, `bool`, `real`, kind values) are matched by value. Custom equality functions on relation types are a planned extension (see Open Questions).
- Relation types participate in the `TYPE.all` mechanism: `connects.all` returns all instances of type `connects`.

## Declaring a Relation Type

```lamp
relation TYPE_NAME:
    FIELD_TYPE FIELD_NAME
    ...
    syntax "TEMPLATE"
```

Fields declare the schema of the relation. Field types follow the same rules as type fields: any primitive type, kind name, or object type name. By convention, field names that read like roles or prepositions (`source`, `target`, `via`) improve the natural-language feel of the syntax template.

The `syntax` field is optional. If omitted, the block form is used for all assertions and queries.

### Example

```lamp
relation connects:
    room source
    direction dir
    room target
    syntax "connects [source] [dir] [target]"
```

### Syntax Templates

The `syntax` value is a string where:
- `[FIELD_NAME]` marks a slot filled by the value of that field.
- All other tokens are literals that must appear verbatim.
- The relation type name does not need to appear in the template, but by convention it should appear first for parser disambiguation.
- Literal tokens in templates may be reserved keywords (e.g. `via`, `in`) — the template parser accepts keyword tokens in literal positions.

The parser collects all syntax templates during the pre-scan phase, alongside global and function names. At parse time, a line in a statement position whose first token matches a relation type name (or the first literal in its template) is dispatched to that relation's template parser.

If two relation types produce ambiguous first tokens, Lantern reports a compile error at relation declaration time. If two templates share a first token, the parser attempts disambiguation on subsequent literal tokens; if no unambiguous prefix exists, it is also a compile error.

## Asserting a Relation Instance

A relation instance is created by writing its template as a top-level statement or inside an event or change handler.

### Anonymous instance (no name)

```lamp
connects foyer north hall
```

The instance exists and is reachable via the connected objects, but has no standalone name. Asserting this a second time with the same values is a no-op.

### Named instance

```lamp
connects north_door foyer north hall
```

The instance can be referred to by `north_door` elsewhere (to add fields, disconnect it by name, etc.).

### With additional fields

Named instances can be declared with a body, just like any object:

```lamp
connects north_door foyer north hall:
    bool locked = false
```

Anonymous instances cannot have a body; if fields are needed, name the instance.

### Block form (fallback when no syntax template)

```lamp
connects:
    source foyer
    dir north
    target hall
```

This is always valid regardless of whether a syntax template is defined.

## Bidirectional Relations

The `bidi` modifier creates a single relation instance that is traversable in both directions.

```lamp
bidi connects foyer north hall
```

This creates one instance. Traversal from `foyer` via `north` yields `hall`; reverse traversal from `hall` is computed by calling the relation type's `inverse` function (see below).

`bidi` is syntactic sugar: the emitted runtime representation is a single relation instance with a symmetric traversal flag, not two instances.

### Inverse functions

Each relation type that supports `bidi` must declare an `inverse` function. This is a **function on a type** — a method — which is a new concept not yet present in Lamp. The function receives the relation instance and returns a new field-value mapping representing the reversed traversal. Because the inverse may depend on any field (not just swapping endpoints), it must be expressible as a full Lamp function body.

```lamp
function connects inverse(connects self):
    return connects self.target self.dir.inverse self.source
```

This requires:
- **Functions on types**: a function declared with a type-qualified name (`TYPE FUNCTION_NAME`) that receives an instance of that type as a first parameter.
- **`direction.inverse`**: the `direction` type needs an `inverse` field of type `direction` (e.g. `north.inverse = south`) so that the inverse function can look up the opposing direction.

Functions on types are not yet designed. Phase 5 is blocked on that design being settled first.

## Removing a Relation

Two removal forms are supported:

```lamp
remove connects foyer north hall
```

Matches and removes all instances satisfying the template (including `_` wildcards, see Partial Queries). Because deduplication means at most one anonymous instance matches any fully-bound template, a fully-bound `remove` always removes zero or one instance.

```lamp
disconnect north_door
```

Removes the named instance `north_door`. Unambiguous and O(1).

## Querying Relations

The same template syntax is valid in boolean expression position:

```lamp
if connects foyer north hall:
    ...
```

Evaluates to `true` if at least one relation instance of type `connects` matches all three slots.

### Partial Queries

One or more slots may be replaced with `_` (wildcard) to match any value in that position:

```lamp
if connects foyer _ _:
    ...
```

Evaluates to `true` if `foyer` has any outgoing `connects` relation regardless of direction or destination.

Partial queries are also valid in `when` clauses and contribute to specificity: each bound slot adds 1 point, consistent with the existing specificity rules for atomic conditions.

```lamp
function void go(direction d) when connects foyer d _:
    ...
```

The example above requires a function parameter (`d`) inside a `when` condition, which the current spec forbids. Partial queries using only globals and object properties in bound slots are implementable now. Parameter references inside `when` are a separate future design item.

## Print Behavior

Named relation instances print their name, consistent with all other named objects.

Anonymous relation instances print as their type name followed by a parenthesized field summary:

```
connects(foyer, north, hall)
```

Fields are listed in declaration order; object-valued fields print as their name.

## Change Handlers

Change handlers for relation add and remove events are a planned goal:

```lamp
on connects add:
    ...

on connects remove:
    ...
```

The handler body would have access to the relation instance via `self`. Full specification is deferred.

## Programmatic API

Runtime creation and removal of relations via statement forms inside handlers and functions is a planned goal:

```lamp
add connects room1 d room2
remove connects room1 d _
```

This will be the mechanism for conditional or dynamic relation manipulation. Syntax is provisional.

## Reserved Words

The following words must be added to the Lamp reserved words list in `specs.md`:

- `relation` — introduces a relation type declaration
- `remove` — removes a matching relation instance
- `disconnect` — removes a named relation instance
- `bidi` — asserts a bidirectional relation instance

## Lamplighter Runtime

Relation instances need runtime support beyond the existing `createObject` / `setField` model:

- A relation store indexed by (relation type, node) so that outgoing and incoming edges can be retrieved efficiently.
- `lamplighter.defineRelation(name, fields, syntaxTemplate?)` — registers a relation type and sets up its `all` accessor.
- `lamplighter.addRelation(typeName, fields, instanceName?)` — creates a relation instance, enforcing deduplication. Returns the (possibly existing) instance.
- `lamplighter.removeRelation(typeName, fields)` — removes all matching instances; `null` in a slot matches any value.
- `lamplighter.queryRelation(typeName, fields)` — returns matching instances; `null` in a slot matches any value.
- `lamplighter.getRelation(name)` — retrieves a named instance.

Relation instances are registered as named objects when they have a name, so that `getObject` works for named instances. They are also registered in the relation type's `all` list regardless of whether they are named.

## Implementation Phases

### Phase 1 — Relation type declarations
- Parse `relation TYPE_NAME:` with field declarations and optional `syntax` field.
- Add `relation` to the AST and pre-scan; add `relation` to the reserved words list.
- Emit `lamplighter.defineRelation(name, fields, syntaxTemplate?)`.
- Set up `TYPE.all` for relation types in Lamplighter.
- No instantiation yet; just the type registry.

### Phase 2 — Anonymous assertion (block form)
- Parse block-form relation assertion at the top level and inside handlers.
- Emit `lamplighter.addRelation(...)`.
- Add the relation store, deduplication check, and `addRelation` to Lamplighter.

### Phase 3 — Custom syntax assertion
- During pre-scan, collect syntax templates.
- In the parser, dispatch statement lines that match a template to the relation assertion path.
- Handle reserved keyword tokens in literal template positions.
- Extend emitter accordingly.

### Phase 4 — Named instances and additional fields
- Parse `connects NAME ...` with an optional body.
- Emit a call that creates the instance, registers it by name, and adds it to the relation store.

### Phase 5 — Bidirectional modifier
- Design and implement functions on types (prerequisite).
- Define `direction.inverse` field on the `direction` type.
- Parse `bidi connects ...`.
- Emit a single relation instance with a symmetric flag; resolve traversal via the `inverse` function.
- Add `bidi` to the reserved words list.

### Phase 6 — Boolean query syntax
- Recognize the template syntax in expression position.
- Emit `lamplighter.queryRelation(...).length > 0`.

### Phase 7 — Remove / disconnect
- Parse `remove TEMPLATE` and `disconnect NAME`.
- Emit `lamplighter.removeRelation(...)` and `lamplighter.removeRelationByName(...)`.
- Add `remove` and `disconnect` to the reserved words list.

### Phase 8 — Partial queries and specificity integration
- Allow `_` in query slots in both `if` expressions and `when` clauses.
- Wire partial query specificity into the conditional overload system (each bound slot = 1 point).
- Parameter references inside `when` conditions are out of scope for this phase.

### Phase 9 — Change handlers
- Parse `on RELATION_TYPE add:` and `on RELATION_TYPE remove:`.
- Fire registered handlers from `addRelation` / `removeRelation`.

## Open Questions

- **Functions on types**: The inverse function design (and by extension Phase 5) depends on settling what "functions on a type" means in Lamp — declaration syntax, dispatch, and how the instance is passed. This is a prerequisite for bidirectional relations and likely has uses elsewhere.
- **Custom equality functions**: The default deduplication criterion (field identity for objects, value equality for primitives) covers most cases. Future extension: allow a relation type to declare an `equals` function for domain-specific equality (e.g. a relation that considers two instances the same if only certain fields match).
- **Relations of relations**: Relation instances are objects, so they are valid as field values in other relation types. No special handling needed.
