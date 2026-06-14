# Relations in Lamp

## Purpose

Relations are typed, directed edges in the Lamp object graph. Every object (room, item, person, direction, etc.) is a graph node. Relations connect pairs of nodes and can carry additional data fields, enabling graph-structured game state — room connectivity, containment hierarchies, social relationships, and anything else that links objects.

## Core Model

- All objects are graph nodes.
- A **relation instance** is a directed edge connecting two or more objects according to a declared relation type.
- Relation instances are themselves objects: they can be named, can have additional fields, and can be referenced. They are not garbage-collected because they are reachable through the objects they connect.
- Relations are directed by default. A bidirectional relation is a **single instance** that is indexed for traversal from both endpoints (see Bidirectional Relations), not two separate instances.
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

`syntax` is a **contextual keyword**: it is meaningful only as a field position inside a `relation` body. It is not globally reserved and may be used as an ordinary identifier elsewhere.

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
- **A template must begin with a literal token** (not a slot). By strong convention that leading literal is the relation type name. This requirement is what makes statement-position dispatch decidable: a parser cannot dispatch on a leading slot, because a slot matches any object identifier.
- Literal tokens in templates may be reserved keywords (e.g. `via`, `in`) — the template parser accepts keyword tokens in literal positions.

The parser collects all syntax templates during the pre-scan phase, alongside global and function names. At parse time, a line in a statement position whose leading literal matches a relation template's leading literal is dispatched to that relation's template parser.

If two templates share a leading literal, the parser attempts disambiguation on subsequent literal tokens. If no unambiguous literal prefix distinguishes two templates, Lantern reports a compile error at relation declaration time.

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

The name appears immediately after the leading literal, before the first slot value. The instance can then be referred to by `north_door` elsewhere (to add fields, disconnect it by name, etc.). The parser distinguishes the named form by arity: a template with N slots takes N values when anonymous and N+1 leading identifiers when named.

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

The `bidi` modifier creates a single relation instance that is traversable from either endpoint.

```lamp
bidi connects foyer north hall
```

`bidi` produces **one instance**. To make reverse traversal queryable, the instance is registered in the relation store under two index entries that point at the same object:

- the forward mapping (`source = foyer, dir = north, target = hall`), and
- the inverse mapping, computed once at assertion time via the relation type's inverse operation (`source = hall, dir = south, target = foyer`).

A query matches the instance if **either** index entry matches. There is still exactly one underlying instance, so its fields, name, and any extra data are shared across both traversal directions.

### Interaction with deduplication

- Asserting a plain (one-way) relation whose values equal the inverse mapping of an existing `bidi` instance is a **no-op** — the reverse edge already exists.
- Asserting `bidi` over endpoints that already have a one-way instance **upgrades that instance in place**: it is marked bidirectional and gains the inverse index entry. No second instance is created.
- Asserting one-way over an existing `bidi` instance is a no-op.

### Inverse operation

A relation type that supports `bidi` must supply an **inverse operation**: given an instance, it produces the field-mapping of the reverse traversal. Because the inverse may depend on any field (not just swapping endpoints), it must be expressible as a full Lamp body.

Two pieces of this are **not yet designed** and are tracked in Open Questions:

1. **How the inverse operation is declared and bound to its relation type.** This needs the "functions on types" feature, which does not yet exist. The example below is illustrative, not final syntax.
2. **A relation constructor expression** distinct from the assertion statement. The inverse operation must *produce a field-mapping value* without adding an edge to the store; assertion (the bare template statement) is a side-effecting statement. These must be different surface forms. The constructor form below (`connects(field = value, ...)`) is provisional.

```lamp
# provisional syntax — pending "functions on types" and a constructor expression
function connects inverse(connects self):
    return connects(source = self.target, dir = self.dir.inverse, target = self.source)
```

The inverse operation also depends on the `direction` type exposing an `inverse` field of type `direction` (e.g. `north.inverse = south`) so the opposing direction can be looked up.

Phase 5 is blocked on items 1 and 2 above being designed first.

## Removing a Relation

Two removal forms are supported:

```lamp
remove connects foyer north hall
```

Matches and removes all instances satisfying the template (including `_` wildcards, see Partial Queries). Removal operates on the whole instance: if the matched template corresponds to either index entry of a `bidi` instance, the entire instance (both index entries) is removed. Because deduplication means at most one instance matches any fully-bound template, a fully-bound `remove` removes zero or one instance. If the removed instance is named, its name registration is also dropped, so a subsequent `getObject` for that name returns nothing.

```lamp
disconnect north_door
```

Removes the named instance `north_door` (both index entries if bidirectional) and unregisters its name. If no relation instance is registered under that name, this is a runtime error.

## Querying Relations

The same template syntax is valid in boolean expression position:

```lamp
if connects foyer north hall:
    ...
```

Evaluates to `true` if at least one relation instance of type `connects` matches all three slots (in either traversal direction, for `bidi` instances).

### Partial Queries

One or more slots may be replaced with `_` (wildcard) to match any value in that position:

```lamp
if connects foyer _ _:
    ...
```

Evaluates to `true` if `foyer` has any outgoing `connects` relation regardless of direction or destination.

The wildcard `_` is distinct from the value `none`: `_` matches any value in the slot, whereas `none` matches only an unset (absent) field. They must compile to different runtime sentinels so that "field is unset" remains expressible as a query.

Partial queries are also valid in `when` clauses and contribute to specificity: each bound (non-wildcard) slot adds 1 point, consistent with the existing specificity rules for atomic conditions.

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

## Use Inside Handlers and Functions

Assertion, `remove`, and `disconnect` are ordinary statements and may appear inside event handlers, change handlers, and function bodies, not just at the top level. No separate runtime API surface is needed in the language — the same statement forms cover both static (top-level) and dynamic (in-handler) graph construction.

## Reserved Words

The following words must be added to the Lamp reserved words list in `specs.md`:

- `relation` — introduces a relation type declaration
- `remove` — removes a matching relation instance
- `disconnect` — removes a named relation instance
- `bidi` — asserts a bidirectional relation instance

`syntax` is **not** added to this list; it is a contextual keyword recognized only inside a `relation` body (see Declaring a Relation Type).

## Lamplighter Runtime

Relation instances need runtime support beyond the existing `createObject` / `setField` model:

- A relation store indexed by (relation type, node) so that outgoing and incoming edges can be retrieved efficiently. A `bidi` instance occupies two index entries (forward and inverse) that reference the same instance object.
- A dedicated wildcard sentinel (distinct from `null`/`none`) used in query and removal field-mappings to mean "match any value." `none`/`null` in a slot continues to mean "match an unset field."
- `lamplighter.defineRelation(name, fields, syntaxTemplate?)` — registers a relation type, including a type handle so that `TYPE.all` resolves for the relation type.
- `lamplighter.addRelation(typeName, fields, options?)` — creates a relation instance, enforcing deduplication; `options` carries the optional instance name and the `bidi` flag. Returns the (possibly pre-existing or upgraded) instance.
- `lamplighter.removeRelation(typeName, fields)` — removes all matching instances (whole instances, including both index entries of a `bidi`) and unregisters any names they held; the wildcard sentinel in a slot matches any value.
- `lamplighter.queryRelation(typeName, fields)` — returns matching instances; the wildcard sentinel in a slot matches any value; matches against either index entry of a `bidi` instance.
- `lamplighter.getRelation(name)` — retrieves a named instance.

Named relation instances are registered as objects so that `getObject` works for them. Every instance, named or not, is added to its relation type's `all` list.

## Implementation Phases

### Phase 1 — Relation type declarations
- Parse `relation TYPE_NAME:` with field declarations and optional `syntax` field (`syntax` recognized as a contextual keyword in this position).
- Add `relation` to the AST and pre-scan; add `relation` to the reserved words list.
- Emit `lamplighter.defineRelation(name, fields, syntaxTemplate?)`, including type-handle registration so `TYPE.all` resolves.
- No instantiation yet; just the type registry.

### Phase 2 — Anonymous assertion (block form)
- Parse block-form relation assertion at the top level and inside handlers.
- Emit `lamplighter.addRelation(...)`.
- Add the relation store, the wildcard sentinel, the deduplication check, and `addRelation` to Lamplighter.

### Phase 3 — Custom syntax assertion
- During pre-scan, collect syntax templates; enforce the "template begins with a literal" rule and leading-literal disambiguation.
- In the parser, dispatch statement lines whose leading literal matches a template.
- Handle reserved keyword tokens in literal template positions.
- Extend emitter accordingly.

### Phase 4 — Named instances and additional fields
- Parse `connects NAME ...` (name after the leading literal) with an optional body; distinguish named vs anonymous by arity.
- Emit a call that creates the instance, registers it by name, and adds it to the relation store and the type's `all` list.

### Phase 5 — Bidirectional modifier
- Design and implement functions on types and a relation constructor expression (prerequisites; see Open Questions).
- Define the `direction.inverse` field on the `direction` type.
- Parse `bidi connects ...`; add `bidi` to the reserved words list.
- On assertion, compute the inverse mapping and register the single instance under both forward and inverse index entries; implement in-place upgrade of an existing one-way instance.

### Phase 6 — Boolean query syntax
- Recognize the template syntax in expression position, including the `_` wildcard sentinel.
- Emit `lamplighter.queryRelation(...).length > 0`.

### Phase 7 — Remove / disconnect
- Parse `remove TEMPLATE` and `disconnect NAME`.
- Emit `lamplighter.removeRelation(...)` and `lamplighter.removeRelationByName(...)`, removing whole instances and unregistering names.
- Add `remove` and `disconnect` to the reserved words list.

### Phase 8 — Partial queries and specificity integration
- Allow `_` in query slots in both `if` expressions and `when` clauses.
- Wire partial query specificity into the conditional overload system (each bound slot = 1 point).
- Parameter references inside `when` conditions are out of scope for this phase.

### Phase 9 — Change handlers
- Parse `on RELATION_TYPE add:` and `on RELATION_TYPE remove:`.
- Fire registered handlers from `addRelation` / `removeRelation`.

## Open Questions

- **Functions on types**: The inverse operation (and thus Phase 5) depends on settling what "functions on a type" means in Lamp — declaration syntax, how the instance is passed, and dispatch. Likely useful beyond relations. The `function connects inverse(connects self)` form shown above is illustrative only.
- **Relation constructor expression**: Phase 5 also needs a side-effect-free way to *construct* a relation field-mapping value (for the inverse operation to return) that is syntactically distinct from the assertion statement. The provisional `connects(field = value, ...)` form needs to be designed and reconciled with the rest of the expression grammar.
- **Custom equality functions**: The default deduplication criterion (field identity for objects, value equality for primitives) covers most cases. Future extension: allow a relation type to declare an `equals` function for domain-specific equality.
- **Relation inheritance**: Whether relation types can inherit from one another (`relation TYPE < PARENT`) is not yet decided. Treated as out of scope until a concrete need arises.

## Resolved (previously open)

- **Parser dispatch soundness** — resolved by requiring every template to begin with a literal token (see Syntax Templates).
- **Wildcard vs `none` collision** — resolved by using a dedicated wildcard sentinel distinct from `null`/`none`.
- **Bidirectional query path** — resolved by dual-indexing a single instance under forward and inverse mappings.
- **Bidi vs. deduplication identity** — resolved by the upgrade/no-op rules under Bidirectional Relations.
- **Value-based remove vs. the name registry** — resolved: removal drops whole instances and unregisters any names they held.
- **Redundant programmatic `add`** — resolved: assertion/`remove`/`disconnect` statements work inside handlers, so no separate API form is needed.
- **`connects.all`** — resolved: `defineRelation` registers a type handle so relation types participate in `TYPE.all`.
- **Relations of relations** — relation instances are objects, so they are valid as field values in other relation types; no special handling needed.
