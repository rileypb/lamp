# Relations in Lamp

## Purpose

Relations are typed, directed edges in the Lamp object graph. Every object (room, item, person, direction, etc.) is a graph node. Relations connect pairs of nodes and can carry additional data fields, enabling graph-structured game state — room connectivity, containment hierarchies, social relationships, and anything else that links objects.

## Core Model

- All objects are graph nodes.
- A **relation instance** is a directed **binary** edge with a canonical `source` and `target` endpoint, plus any number of labelled fields, according to a declared relation type. (n-ary "group" relations are deferred future work; model them with an intermediate object for now.)
- Relation instances are themselves objects: they can be named, can have additional fields, and can be referenced. They are not garbage-collected because they are reachable through the objects they connect.
- Relations are directed by default. A bidirectional relation is a **single instance** that is indexed for traversal from both endpoints (see Bidirectional Relations), not two separate instances.
- Asserting the same relation with identical field values twice produces one instance. Equality is determined field by field: object-typed fields are matched by identity; value-typed fields (`string`, `int`, `bool`, `real`, kind values) are matched by value. Custom equality functions on relation types are a planned extension (see Open Questions).
- Relation types participate in the `TYPE.all` mechanism: `connects.all` returns all instances of type `connects`.

## Declaring a Relation Type

```lamp
relation TYPE_NAME:
    ENDPOINT_TYPE source
    ENDPOINT_TYPE target
    FIELD_TYPE FIELD_NAME [inverted]
    ...
    syntax "TEMPLATE"
```

Fields declare the schema of the relation. Field types follow the same rules as type fields: any primitive type, kind name, or object type name. By convention, field names that read like roles or prepositions (`source`, `target`, `via`) improve the natural-language feel of the syntax template.

The `syntax` field is optional. If omitted, the block form is used for all assertions and queries.

`syntax` is a **contextual keyword**: it is meaningful only as a field position inside a `relation` body. It is not globally reserved and may be used as an ordinary identifier elsewhere.

### Endpoints and orientation

Every relation is a directed binary edge and must declare exactly one `source` and one `target`. These are **role keywords** in the field-name position; they fix the relation's canonical orientation, `source → target`. The two endpoints may have any types and need not match.

Additional **labelled fields** may follow, each optionally tagged `inverted`:

- `inverted` — when the edge is reversed (see Bidirectional Relations), this field is replaced by its own inverse. Its type must itself declare an `inverse` field of that same type (so `direction dir inverted` requires the `direction` type to have a `direction inverse` field, e.g. `north.inverse = south`).
- *(untagged)* — copied unchanged when reversing.

```lamp
relation connects:
    room source
    direction dir inverted
    room target
    syntax "connects [source] [dir] [target]"
```

`source`, `target`, and `inverted` are contextual keywords recognized only inside a `relation` body.

Canonical orientation matters even for relations that are never made bidirectional. It is what lets a future reasoning layer relate one relation to another — e.g. "if `father(a, b)` then `older_than(a, b)`" — by knowing which endpoint is head and which is tail. An asymmetric relation like `father` declares `source`/`target` for exactly this reason; its reverse is a *different* relation (`child`), so it is not a `bidi` candidate.

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
- the inverse mapping, computed once at assertion time via the mechanical inverse (see below) (`source = hall, dir = south, target = foyer`).

A query matches the instance if **either** index entry matches. There is still exactly one underlying instance, so its fields, name, and any extra data are shared across both traversal directions.

### Interaction with deduplication

- Asserting a plain (one-way) relation whose values equal the inverse mapping of an existing `bidi` instance is a **no-op** — the reverse edge already exists.
- Asserting `bidi` over endpoints that already have a one-way instance **upgrades that instance in place**: it is marked bidirectional and gains the inverse index entry. No second instance is created.
- Asserting one-way over an existing `bidi` instance is a no-op.

### Mechanical inverse

The reverse mapping is derived **mechanically** from the canonical orientation and field roles. Given an instance `e`, the inverse mapping is:

- swap the endpoints — `source = e.target`, `target = e.source`;
- each `inverted` field takes its value's inverse — `dir = e.dir.inverse`;
- every other labelled field is copied — `locked = e.locked`.

This covers the room-connection case (swap endpoints, invert the direction) and symmetric relations (no `inverted` fields) without any user-written code. Because every relation already has exactly one `source` and one `target`, there is nothing to designate for the swap. The checker validates only that each `inverted` field's type exposes an `inverse` field of its own type.

### Custom inverse (future escape hatch)

When a relation's inverse cannot be expressed as "swap endpoints, self-invert tagged fields" (for example, an inverse that computes a new value from several fields), the mechanical rule is insufficient and the relation will instead supply an explicit inverse. That path is **deferred** because it depends on two features not yet built:

1. **Functions on types** — binding an `inverse` method to the relation type with `self` as the instance. Tentative surface syntax:

   ```lamp
   relation connects:
       ...
       function inverse:
           return connects(source = self.target, dir = self.dir.inverse, target = self.source)
   ```

2. **A relation constructor expression** — a side-effect-free `connects(field = value, ...)` that *produces* a field-mapping value (for the method to return) without asserting it to the store, syntactically distinct from the bare-statement assertion form.

Both are tracked in Open Questions and are not needed for the mechanical inverse that Phase 5 ships.

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

*Implemented (Phase 2).*

Named relation instances print their name, consistent with all other named objects.

Anonymous relation instances print as their type name followed by a parenthesized field summary:

```
connects(foyer, north, hall)
```

Fields are listed in declaration order; object-valued fields print as their name. This was brought forward into Phase 2 (ahead of named instances) because relation instances are otherwise unobservable, which made anonymous assertion untestable.

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

### Implemented so far (Phases 1–2)

- `lamplighter.defineRelation(name, fields, syntaxTemplate?)` — registers a relation type. Internally it calls `defineType(name, [], fields)` so the relation reuses the existing type/instance machinery (including the `TYPE.all` accessor), then records the field schema and syntax template in a separate `relationRegistry` for later phases.
- `lamplighter.addRelation(typeName, fields, options?)` — creates an anonymous relation instance, enforcing deduplication (object fields by identity, value fields by `===`); a duplicate assertion returns the existing instance. The instance is pushed onto the relation type's instance list, so `TYPE.all` includes it. `options.name` is accepted but not yet exercised (named instances are Phase 4).
- **Storage**: relation instances currently live in the ordinary type instance registry (the same store `createObject` uses). Deduplication and `.all` scan that per-type list linearly. There is no dedicated node-indexed store yet (see below).
- **Print**: `formatValue` renders a named relation instance as its name and an anonymous one as `type(field, ...)` (declaration-order field summary).

### Planned (later phases)

- A relation store indexed by (relation type, node) for efficient edge retrieval, replacing the linear scan above. A `bidi` instance occupies two index entries (forward and inverse) referencing the same instance object. *(Phase 6.)*
- A dedicated wildcard sentinel (distinct from `null`/`none`) used in query and removal field-mappings to mean "match any value." `none`/`null` in a slot continues to mean "match an unset field." Not added yet — it has no consumer until querying. *(Phase 6/7.)*
- `lamplighter.removeRelation(typeName, fields)` — removes all matching instances (whole instances, including both index entries of a `bidi`) and unregisters any names they held. *(Phase 7.)*
- `lamplighter.queryRelation(typeName, fields)` — returns matching instances; the wildcard sentinel matches any value; matches against either index entry of a `bidi` instance. *(Phase 6.)*
- `lamplighter.getRelation(name)` — retrieves a named instance. *(Phase 4.)*
- `addRelation` options: the `bidi` flag and in-place upgrade of an existing one-way instance. *(Phase 5.)*

Named relation instances will be registered as objects so that `getObject` works for them. Every instance, named or not, is added to its relation type's `all` list.

## Implementation Phases

### Phase 1 — Relation type declarations ✅ done
- Parse `relation TYPE_NAME:` with field declarations and optional `syntax` field (`syntax` recognized as a contextual keyword in this position).
- Add `relation` to the AST and to the reserved words list.
- Emit `lamplighter.defineRelation(name, fields, syntaxTemplate?)` plus a `const NAME = lamplighter.type(NAME)` handle so `TYPE.all` resolves.
- No instantiation yet; just the type registry.

As-built notes:
- **Pre-scan was *not* changed in Phase 1.** Relation names are not referenced from expressions or statements at the declaration stage, so nothing needed collecting yet. Pre-scan collection of relation names landed in Phase 2, where dispatch requires it.
- **No checker changes.** `print` statements are not type-checked and no checkable position references relations, so the semantic checker was left untouched. Relation-aware inference is deferred to the query phase.

### Phase 2 — Anonymous assertion (block form) ✅ done
- Parse block-form relation assertion at the top level and inside handlers/functions (reuses the object-body parser).
- Pre-scan relation names (in `lantern/index.js`) and thread the set to the parser so `RELATION_NAME:` dispatches to assertion rather than an object declaration.
- Emit `lamplighter.addRelation(typeName, fields)`, resolving object-typed slot values to `getObject(...)`.
- Add `addRelation` + the deduplication check to Lamplighter.

As-built notes:
- **No dedicated relation store.** Instances are kept in the existing type instance registry; dedup and `.all` scan that list. The node-indexed store is deferred to Phase 6 (it is a query optimization with no consumer yet).
- **Wildcard sentinel deferred** to Phase 6/7 for the same reason.
- **Print Behavior implemented here** (see Print Behavior) to make assertions observable.
- **No checker validation** of assertion field names against the relation schema yet (a misspelled slot name passes silently). To be added with query type-checking.

### Phase 3 — Custom syntax assertion ✅ done
- During pre-scan, collect syntax templates; enforce the "template begins with a literal" rule.
- In the parser, dispatch top-level and statement lines whose leading literal matches a template.
- Handle reserved keyword tokens in literal template positions.

As-built notes:
- **No AST, emitter, or runtime changes.** A custom-syntax assertion parses into the *same* `RelationAssert` node as the block form — the template only tells the parser which positional value fills which field — so everything downstream of the parser was reused unchanged.
- **Templates are parsed in pre-scan** (`lantern/index.js`): each `syntax "..."` line is associated with the most recent `relation NAME:`, split into literal/slot parts, and indexed by leading literal into a dispatch map passed to the parser.
- **Leading-literal collisions are a hard compile error.** The doc's fallback to disambiguation on *subsequent* literals is deferred — distinct relations rarely share a leading literal (it is conventionally the relation name), so this is treated as an edge case.
- **Keyword-*led* templates are not supported** — only keyword literals in non-leading positions (e.g. `... to ...`). Dispatch lives in the parser's IDENT branch and the leading literal is always the relation name (an IDENT).
- **No checker validation** that a slot's value type matches the relation's declared field type, consistent with earlier phases.

### Phase 4 — Named instances ✅ done · additional fields ⏳ deferred
- Parse `connects NAME ...` (name after the leading literal); distinguish named vs anonymous by arity.
- Emit `addRelation` with a `name` option; register the instance under that name.

As-built notes (named instances):
- **Custom-syntax form only.** A name is given as `connects NAME source dir target`. Named/anonymous is disambiguated by counting line tokens: a template with K parts consumes K tokens anonymously and K+1 when named (the extra leading identifier is the name). Block-form named instances are not implemented (the doc never specified one).
- **Names are coerced** like object names (`north_door` → `north door`) and registered in the runtime name registry, so `getObject` resolves them (used later by `disconnect`).
- **Naming an existing edge.** If a named assertion deduplicates against an existing unnamed instance, the name is applied to that instance in place rather than discarded.
- **No bare-identifier reference yet.** A named instance is reachable via the name registry but is not emitted as a `const`, so it cannot yet be referenced as a bare identifier in expressions. Not needed until removal/queries.

Deferred — **additional instance fields** (the `connects NAME ...: \n bool locked = false` body):
- Open design questions before implementing: (1) do extra fields participate in deduplication, or is dedup always endpoint-only? (2) does the print summary include them (it currently iterates only declared schema fields)? (3) they are untyped in the relation schema — how are they checked/queried? Tracked in Open Questions.

### Phase 5 — Canonical orientation + bidirectional modifier ✅ done
- Relation declarations require exactly one `source` and one `target` (contextual role keywords); labelled fields may carry an `inverted` tag.
- `bidi` is a reserved keyword and an assertion prefix (block and custom-syntax forms).
- Mechanical inverse: swap `source`/`target`, self-invert `inverted` fields, copy the rest.
- A `bidi` assertion registers one instance; the reverse edge deduplicates against it, and a `bidi` over an existing one-way instance upgrades it in place.

As-built notes:
- **`source`/`target`/`inverted` are contextual keywords** (not tokenizer keywords) recognized only in a relation body; `bidi` *is* a real reserved keyword (it leads an assertion and must dispatch). The exactly-one-`source`/`target` rule is enforced in the parser; the checker validates that each `inverted` field's type declares an `inverse` field of that same type.
- **No separate node-indexed store yet.** `bidi` dedup/match is done by computing the mechanical inverse on the fly during the existing linear `findMatchingRelation` scan (an instance matches if its own fields match *or*, when `bidi`, its computed inverse matches). The dedicated dual-index store is deferred to Phase 6, where queries make fast lookup worthwhile; behavior is identical, only the cost differs.
- **Reverse-oriented query views are deferred to Phase 6** (there are no queries yet). What Phase 5 makes observable is the dedup behavior: asserting the reverse one-way edge after a `bidi` is a no-op, so `connects.all` shows a single instance (vs. two for two independent one-way asserts).
- **`direction.inverse` is ordinary data** — declared `direction inverse` on the `direction` type and set via object bodies (`direction north: \n inverse south`); no new assignment syntax was needed.
- **Migrated** `relation2` from `a`/`b` to `source`/`target` for the new mandatory-endpoints rule.

Out of scope (still deferred): functions on types, the relation constructor expression, non-mechanical custom inverses, and cross-relation reasoning over canonical orientation (e.g. `father` ⇒ `older_than`).

### Phase 6 — Boolean query syntax ✅ done
- Recognize the custom-syntax template in expression position as a boolean query, with `_` wildcard slots.
- Emit `lamplighter.queryRelation(...).length > 0`; add the `ANY` wildcard sentinel and `queryRelation` to the runtime.

As-built notes:
- **Existence only.** A query evaluates to `bool` (`if connects foyer north hall:`). Value-returning queries ("the room reached going `north` from here") are *not* part of this phase and remain unbuilt — they are the next real milestone for movement. Because boolean queries never expose a matched instance, **reverse-oriented views were not needed and stay deferred**.
- **Slots are atoms (Option A):** `_` wildcard, literal, object name, variable/global, or property-access chain. Operators and indexing terminate a slot naturally (the slot is parsed as a single nud, no Pratt loop); function calls in a slot are an explicit compile error. Full-expression slots can be added later without breaking these.
- **`connects.all` is preserved**: query dispatch in expression position fires only when the relation's leading literal is *not* followed by `.`, so the type handle stays a property access.
- **`_` is query-only**: using it in an assertion slot is a compile error.
- **No node-indexed store yet.** `queryRelation` linear-scans, matching a slot's `ANY` as wildcard and matching a `bidi` instance via its mechanical inverse too. The dedicated index stays deferred (optimization only).
- **`when`/specificity stays Phase 8.** A query parses in a `when` clause, but partial-query specificity and parameter-in-`when` are not wired up yet.

Out of scope (still deferred): value-returning queries + reverse-oriented views, the node-indexed store, and `when`/specificity integration.

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

- **Functions on types**: No longer a Phase 5 blocker — the mechanical inverse (field role tags) covers `bidi`. Still wanted as the escape hatch for non-mechanical custom inverses, and likely useful beyond relations. Needs a declaration syntax (tentatively `function inverse:` inside the relation body), how `self` is passed, and dispatch.
- **Relation constructor expression**: Only needed once custom inverses (above) land — a side-effect-free `connects(field = value, ...)` that produces a field-mapping value without asserting, syntactically distinct from the bare-statement assertion. Deferred with functions on types.
- **Custom equality functions**: The default deduplication criterion (field identity for objects, value equality for primitives) covers most cases. Future extension: allow a relation type to declare an `equals` function for domain-specific equality.
- **Relation inheritance**: Whether relation types can inherit from one another (`relation TYPE < PARENT`) is not yet decided. Treated as out of scope until a concrete need arises.
- **Group (n-ary) relations**: Relations are binary for now (one `source`, one `target`). Support for relations over more than two endpoints is intended future work; until then, model them with an intermediate object.
- **Cross-relation reasoning**: Canonical `source`/`target` orientation is in place specifically to enable later rules that derive one relation from another (e.g. `father(a, b)` ⇒ `older_than(a, b)`). The rule/inference mechanism itself is unspecified.
- **Additional instance fields** (deferred from Phase 4): the `connects NAME ...:` body of extra typed fields (`bool locked = false`). Needs decisions on (1) whether extra fields participate in deduplication or dedup stays endpoint-only, (2) whether the anonymous-instance print summary includes them, and (3) how fields absent from the relation schema are typed, checked, and queried.
- **Mutation through a reverse-oriented view**: a query matching a `bidi` instance via its inverse index entry returns a view with endpoints oriented to the query, not the stored object. Reading is fine; writing a field through that view is the open wart. Intended guidance is to mutate via the canonical (named) instance or a forward match; whether reverse views should proxy writes back to the underlying instance is unresolved.

## Resolved (previously open)

- **Empty-list printing** — fixed. `print connects.all` on a relation with zero instances now renders `nothing` (previously `[object Object]`). The cause was `lamplighter.isListValue` treating `first === undefined` as "not a list"; it now tests `"first" in value`, which holds for the empty list because `first` is a getter. The empty-list display string is `"nothing"` and may change later. This was a pre-existing bug affecting every empty `list<T>`, not just relations.

- **Parser dispatch soundness** — resolved by requiring every template to begin with a literal token (see Syntax Templates).
- **Wildcard vs `none` collision** — resolved by using a dedicated wildcard sentinel distinct from `null`/`none`.
- **Bidirectional model (one instance vs. two edges vs. passage object)** — resolved in favor of **one instance** (dual-indexed). It honors the "`bidi` is one relation" requirement and gives shared state, single-step removal, honest counting, and once-firing change handlers for free; the costs (forward-biased stored fields, reverse-oriented query views) are implementation-internal. The two-edge and passage-object alternatives were rejected: two independent edges break shared mutable state (the door case), and a separate passage object adds authoring weight for what `bidi` should make effortless.
- **Canonical orientation** — resolved: every relation is a directed binary edge declaring exactly one `source` and one `target` (role keywords). This fixes head/tail for all relations, supersedes the earlier bidi-only `endpoint` tag, and is the prerequisite for future cross-relation reasoning.
- **How the inverse is specified** — resolved with mechanical inversion: swap `source`/`target` and self-invert `inverted`-tagged fields. Avoids functions on types and a constructor expression for the common case; a custom-inverse escape hatch is deferred (see Open Questions).
- **Bidirectional query path** — resolved by dual-indexing a single instance under forward and inverse mappings.
- **Bidi vs. deduplication identity** — resolved by the upgrade/no-op rules under Bidirectional Relations.
- **Value-based remove vs. the name registry** — resolved: removal drops whole instances and unregisters any names they held.
- **Redundant programmatic `add`** — resolved: assertion/`remove`/`disconnect` statements work inside handlers, so no separate API form is needed.
- **`connects.all`** — resolved: `defineRelation` registers a type handle so relation types participate in `TYPE.all`.
- **Relations of relations** — relation instances are objects, so they are valid as field values in other relation types; no special handling needed.
