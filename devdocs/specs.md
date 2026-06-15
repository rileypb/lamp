# Lamp specifications

## Functional Specifications

### Lantern

- Lantern is a command-line tool.
- Lantern takes a .lamp source file as input and produces a JavaScript file as output.
- The output JavaScript file is a representation of the game that can be executed with the Lamplighter runtime.
- `npm run compile INPUT.lamp OUTPUT.js` — compile a source file
- `npm run exe -- INPUT.lamp` — compile and immediately run a source file (output goes to `build/`)
- `npm test` — run the golden test suite
- `lib/sys/` is the system library. Every invocation of Lantern automatically parses all `.lamp` files in `lib/sys/` — no explicit import is required.
- Other subdirectories of `lib/` (e.g. `lib/test/`, `lib/advent/`) are optional libraries that must be imported explicitly with `lib LIBNAME`.
- `.lamp` files placed directly in `lib/` (not inside a named subdirectory) are not parsed and are not available for import.

#### First iteration scope

- Lantern parses `lib/sys/*.lamp` plus one user entry file (for example, `sample/min.lamp`) and emits one standalone Node.js JavaScript file.
- The parsed game must define at least one object of type `game`.
- If no `game` object is present, Lantern reports `error: no game object defined.` to **stderr** and exits with a nonzero status.
- On compile failure, Lantern reports diagnostics to **stderr** in the form `Compile error: <file>:<line>: <detail>` and includes the source line with a caret marker.
- The emitted file is directly runnable from the command line.
- The emitted file requires the Lamplighter library and executes through it.
- Lighthouse integration is out of scope for this iteration.

#### Library imports

A user file may import an optional library with:

```lamp
lib LIBNAME
```

This includes all `.lamp` files from the resolved library directory in the compilation, inserted after `lib/sys/` and before the user file. Multiple `lib` lines are allowed; their files are included in the order the directives appear.

**Resolution order**: Lantern searches for `LIBNAME` by looking first in the project-level `lib/` directory (`lib/LIBNAME/`), then in a `lib/` directory adjacent to the user file (`<user-file-dir>/lib/LIBNAME/`). The first match wins. If neither location exists, Lantern reports a compile error: `file:line: library not found: LIBNAME`.

#### Native libraries

A library directory may contain an `index.js` file alongside its `.lamp` files. If present, Lantern reads `index.js` and inlines its content verbatim into the generated JavaScript, immediately after `lamplighter.bootstrapBuiltins()`. This allows a library to provide JavaScript helper functions that Lamp code can call.

**Constraint**: `index.js` must be self-contained — it may not `require()` sibling files. All supporting code must live in the single `index.js` file.

The `lib/sys/` directory may also provide a native `index.js` using the same mechanism. Native JS from `lib/sys/` is included before any imported-library JS.

Functions defined in `index.js` are declared to Lamp via `native function` (see Native functions below).

#### Known limitations (v0)

- Kind values are currently represented at runtime as strings.
- Runtime execution currently fires only the `startup` event from `run()`.
- Expressions whose types cannot be inferred (globals, object name references, `list<T>` field assignments) are not rejected — unknown type is treated as compatible with any field type.
- Object-typed fields and globals are not statically type-checked (the checker returns unknown type for object references and `none`).

### Lamplighter

- Lamplighter is the runtime library used by emitted JavaScript.
- Lamplighter provides built-in type bootstrapping, type/instance registration, event registration, and runtime execution.
- Lamplighter provides swappable output behavior via `print`.

#### Runtime API contract (v0)

Lantern-generated JavaScript targets the following Lamplighter API surface:

- `bootstrapBuiltins()`
    - Initializes built-in runtime types.
    - Safe to call multiple times.
- `defineType(name, parents, fields)`
    - Registers a type definition.
    - `parents` may be empty, or may contain one or more parent type names.
- `defineKind(name, kindDef)`
    - Registers a kind definition.
- `enum(...labels)`
    - Creates an enum kind definition.
- `kind(name)`
    - Returns a registered kind definition.
- `createObject(typeName, objectName, fieldValues)`
    - Creates and registers an object instance.
    - Sets universal fields `name` and `type` on the instance.
    - Also registers the instance under its name for lookup by `getObject`.
- `getObject(name)`
    - Returns the object instance registered under `name`.
- `type(name)`
    - Returns a type handle.
    - Type handle exposes `all`, which includes instances of the type and all subtypes.
    - `all.first` returns the first element in that list.
- `defineRelation(name, fields, syntaxTemplate?, invertedFields?)`
    - Registers a relation type. Internally registers it as a type (so `name.all` and the instance registry work) and records the field schema, optional syntax template, and the list of `inverted`-tagged field names.
- `addRelation(typeName, fields, options?)`
    - Creates a relation instance from a field-value mapping.
    - Deduplicates by field values (object fields by identity, value fields by equality); asserting an identical instance returns the existing one. For a `bidi` instance, an assertion that matches its mechanical inverse also deduplicates against it.
    - `options` may carry `name` (registers the instance for `getObject`) and `bidi` (marks the instance bidirectional, upgrading an existing match in place).
    - The instance is added to the relation type's `all` list.
- `queryRelation(typeName, query)`
    - Returns the matching edges as **oriented** field-mappings (the instance for a direct match; its mechanical inverse for a `bidi` instance matched in reverse). A slot holding the `ANY` wildcard sentinel matches any value; other slots match by identity (objects) or value (primitives).
- `queryRelationValue(typeName, query, outputField, mode)`
    - Extracts `outputField` from the matching oriented edges. `mode` is `"all"` (returns a list), `"first"` (first value or `none`), or `"only"` (the single value, `none` if none, runtime error if more than one).
- `removeRelation(typeName, query)`
    - Removes all instances matching `query` (using `ANY` as wildcard). For `bidi` instances, a match via the mechanical inverse also removes the entire underlying instance (both index entries). Unregisters any name the removed instance held.
- `removeRelationByName(name)`
    - Removes the named relation instance and unregisters its name. Runtime error if the name is not found or refers to a non-relation object.
- `ANY`
    - The wildcard sentinel used in query and remove slots, distinct from `null`/`none`.
- `onEvent(eventName, handler)`
    - Registers an event handler callback.
- `registerChangeHandler(typeName, fieldName, handler)`
    - Registers a change handler for `typeName.fieldName`. The handler receives the changed instance as its first argument (`self`).
- `setField(instance, fieldName, value)`
    - Assigns `value` to `instance[fieldName]` and fires all registered change handlers for that field on the instance's type and all parent types.
- `dispatch(eventName)`
    - Fires the named event immediately, invoking all registered handlers in registration order.
- `run()`
    - Executes the runtime entry sequence.
    - In v0, this fires the `startup` event.
- `print(value)`
    - Sends output to the active output implementation.
    - Objects print as their `name`.
    - Lists print as human-readable strings using `,` and `and`.
    - An empty list prints as `nothing` (the default empty-list display string; subject to change).
- `setPrint(fn)`
    - Replaces the output implementation used by `print`.
- `defineGlobal(name, value)`
    - Registers a named global with an initial value.
- `setGlobal(name, value)`
    - Assigns a new value to a previously registered global.
- `getGlobal(name)`
    - Returns the current value of a named global.
- `error(message)`
    - Stops execution by throwing a runtime error.

## Non-Functional Specifications

- Lamp will be written in JavaScript as a command-line Node.js application.
    - This includes the Lantern compiler, Lamplighter runtime, and Lighthouse bundler.

## Language Definition

### Syntax fundamentals

- **Indentation** defines block structure. A block begins after `:` and ends when indentation returns to the enclosing level.
- `#` introduces a line comment.
- Source files are plain text with one statement per line.

#### Names and identifiers

An **identifier** names an object, type, kind, global, field, or local variable. Identifiers are single tokens and never contain spaces.

Object names, global names, and object references support a **display coercion** so that a single-token identifier can stand for a multi-word display name:

- `_` (underscore) renders as a space.
- `-` (hyphen) renders as a literal hyphen.
- `\_` (backslash-underscore) renders as a literal underscore.

The coerced string is the name's canonical identity: it is both the lookup key used to resolve references and the value of the object's `name` field. For example, `room West_of_House:` declares an object whose name is `West of House`, and the reference `West_of_House` elsewhere resolves to the same object. `One-Room_Game` denotes the name `One-Room Game`; `well-worn_map` denotes `well-worn map`.

A separator may appear only *between* two identifier characters — neither `-` nor `_` (nor the `\_` escape) may be the first or last character of an identifier. This prevents a name from coercing to a string with leading or trailing whitespace. A leading `-` followed by digits is a negative-number literal (`-7`), not part of an identifier.

Local variables (introduced by `let`) and loop variables (introduced by `for`) are restricted to plain identifiers matching `[A-Za-z_][A-Za-z0-9_]*`: they may not contain `-` and no coercion is applied. These names are internal and are never displayed. Type names, kind names, and field names are likewise plain identifiers.

Free text that contains spaces or punctuation is written as a double-quoted string literal, not a bare identifier (for example, `author "Phil Riley"`).

The following words are **reserved** and may not be used as a name (object, type, kind, global, field, event, or local): `type`, `kind`, `global`, `on`, `for`, `while`, `if`, `else`, `let`, `print`, `error`, `dispatch`, `break`, `lib`, `to`, `step`, `change`, `function`, `native`, `return`, `when`, `and`, `or`, `not`, `relation`, `bidi`, `remove`, `disconnect`, `rulebook`, `stop`, `follow`, `action`, `try`. (`syntax`, `source`, `target`, and `inverted` are contextual keywords recognized only inside a `relation` body; `default` is a contextual keyword recognized only inside a `rulebook` body; the band words `before`, `instead`, `check`, `do`, `after`, and `report` are contextual keywords recognized only as the leading token of a phase rule for a declared action; none of these are globally reserved.) A reservation applies only to a whole identifier: a reserved word appearing *inside* a longer identifier is unrestricted, so `move_to_room` (which denotes the name `move to room`) is a valid identifier even though `to` is reserved.

### Objects and types

#### Object declarations

```lamp
TYPE_NAME OBJECT_NAME:
    FIELD_NAME VALUE
    ...
```

`TYPE_NAME OBJECT_NAME:` declares an object named `OBJECT_NAME` of type `TYPE_NAME`. A trailing `:` starts the body. Each indented line is a field assignment `FIELD_NAME VALUE`. A `VALUE` is a literal (number, double-quoted string, `true`, `false`, or `none`) or an object reference written as an identifier. Free text containing spaces is written as a quoted string; multi-word object names use the underscore convention described in Names and identifiers.

```lamp
game Minimal:
    author "Phil Riley"
    version 1
```

An object with no fields omits the `:` and body entirely:

```lamp
person yourself
```

Object-typed field values are written as the referenced object's name (an identifier):

```lamp
game One-Room_Game:
    author "Test Author"
    start West_of_House
```

Object-typed fields are resolved after all objects have been created, so the referenced object may be declared anywhere in the source — before or after the object that references it.

#### Type declarations

```lamp
type TYPE_NAME:
    FIELD_TYPE FIELD_NAME
    ...
```

A type declaration is an object declaration whose object type is `type`. `type game:` declares an object named `game` of type `type`. The body declares fields available on instances of that type.

```lamp
type game:
    string author
    int version
```

`FIELD_TYPE` may be any primitive type, kind name, or object type name. An object-typed field holds a reference to an instance of that type (or `none`):

```lamp
type game:
    string author
    int version
    reltype release
    room start
```

Built-in complex types:
- `object`
- `type`
- `event`

Built-in primitive types:
- `string` — string values; literals are written in double quotes: `"hello"`
- `int` — integer values; literals are plain digits: `42`, `-7`
- `bool` — boolean values; literals are `true` and `false`
- `real` — floating-point values; literals require a decimal point: `3.14`, `-0.5`
- `list<T>` (generic list of elements of type `T`)

The literal `none` represents the absence of an object reference. It is valid wherever an object-typed value is expected and evaluates to `null` at runtime.

#### Type inheritance

A type may inherit from a parent type using `<`:

```lamp
type TYPE_NAME < PARENT_TYPE_NAME:
    FIELD_TYPE FIELD_NAME
    ...
```

Instances of `TYPE_NAME` inherit all fields declared on `PARENT_TYPE_NAME`. The body may add further fields.

A type may inherit from multiple parent types by separating parent names with commas:

```lamp
type TYPE_NAME < PARENT_A, PARENT_B:
    FIELD_TYPE FIELD_NAME
    ...
```

```lamp
type startup < event
```

A type with no additional fields omits the `:` and body entirely.

#### Universal fields

All objects expose the following built-in fields:

- `all` — the collection of all instances of this object's type. `game.all` has type `list<game>`.
- `type` — the type of this object. `this_game.type` is `game`.

### Kinds

A **kind** defines a range of values, as distinct from a type which defines a class of discrete objects. Kinds are used to type object fields.

#### Kind declarations

```lamp
kind KIND_NAME = KIND_EXPR
```

`kind` binds a name to a kind expression. The name can then be used as a field type in type declarations.

#### Built-in kind constructors

- `enum(LABEL, ...)` — produces a kind whose values are the given labels. Labels are bare identifiers (no quotes).

```lamp
kind color = enum(red, green, blue)
```

#### Output behavior

The runtime currently represents enum values as strings and prints them via standard string output (for example, `dev`, `beta`, `final`).

### Globals

A **global** declares a named value that persists for the lifetime of the game. Globals are accessible to the Lamplighter runtime and may be overridden by user files.

#### Global declarations

```lamp
global TYPE_NAME GLOBAL_NAME = VALUE
```

Declares a global named `GLOBAL_NAME` of type `TYPE_NAME` with an initial value of `VALUE`. `TYPE_NAME` may be any primitive type, kind name, or object type name.

```lamp
global bool USE_OXFORD_COMMA = false
global real PI = 3.141592653
```

For object-typed globals, the initial value may be an existing object name or the literal `none` (no object assigned):

```lamp
global person player = yourself
global person player = none
```

The `= VALUE` clause is optional for object-typed globals; omitting it is equivalent to `= none`:

```lamp
global person player
```

Globals are initialized at program startup after all objects have been created, so an object-name initial value always refers to an already-registered instance.

#### Global assignments

A bare `NAME = VALUE` line assigns a new value to a previously-declared global, whether at the top level or inside a local context (an event handler, change handler, or function body). At the top level this lets user files override defaults set by the standard library; inside a local context it mutates shared game state.

```lamp
USE_OXFORD_COMMA = true
```

Global assignments are type-checked against the type declared in the corresponding global declaration. Inside a local context the same syntax is used; because locals may not shadow globals (see Name resolution and scope), `NAME = VALUE` is never ambiguous about whether it targets a local or a global.

#### Globals in expressions

Single-word global names may be used directly in expressions. They resolve to the current value of the global at the point of evaluation.

```lamp
2 * radius * PI
```

### Events

Events are objects of type `event`. Built-in event types include `startup`:

```lamp
type startup < event
```

#### Event handlers

```lamp
on EVENT_NAME:
    STATEMENT
    ...
```

`on` defines a handler block that executes when the named event fires.

```lamp
on startup:
    let this_game = game.all.first
    print this_game.name
```

#### Change handlers

```lamp
on TYPE.FIELD change:
    STATEMENT
    ...
```

Defines a handler that runs whenever the named field is assigned on any instance of `TYPE`. Inside the body, `self` is the instance whose field changed.

```lamp
on person.holder change:
    print self.name + " moved to " + self.holder.name
```

Change handlers fire for the declared type and any subtype. Multiple handlers for the same field are all called in registration order.

Field assignments inside handler bodies (and all event handler bodies) use the `setField` runtime call rather than direct property assignment, so changes are always observed.

### Functions

A **function** is a named, reusable block of statements declared at the top level of a source file (including library files).

#### Function declarations

```lamp
function RETURN_TYPE NAME(PARAM_TYPE PARAM_NAME, ...):
    STATEMENT
    ...
```

`function` declares a named function with a return type, an optional parameter list, and an indented body. A function with no parameters uses an empty `()`. The body is a block that follows the same indentation rules as event handlers.

```lamp
function void greet(string greeting, string subject):
    print greeting + ", " + subject + "!"

function int add(int a, int b):
    return a + b

function int factorial(int n):
    if n == 0:
        return 1
    return n * factorial(n - 1)
```

`RETURN_TYPE` is either `void` (no value returned) or a primitive type name (`int`, `string`, `bool`, `real`). Parameter types follow the same conventions as field types in type declarations, with the addition of `function` (see Function references below).

Functions are visible across all source files compiled together — a function declared in `lib/sys/` or an imported library is callable from the user file and vice versa. Recursive calls are supported.

#### Return statement

```lamp
return EXPRESSION
return
```

`return EXPRESSION` exits the enclosing function and produces the value of `EXPRESSION` as the call result. A bare `return` (no expression) exits a `void` function early. A `void` function that reaches the end of its body without a `return` also exits normally.

The static checker validates that the returned expression type is compatible with the declared return type when the type can be inferred.

#### Function call statement

A function call may appear as a standalone statement:

```lamp
greet("Hello", "World")
fn(n)
```

Arguments are full expressions and may include literals, variables, arithmetic, other function calls, and function references. The static checker verifies that the argument count matches the declaration and that argument types are compatible with parameter types where inferable. An argument that is a bare object name (which parses as a string) is resolved to the referenced object when the corresponding parameter is object-typed, mirroring object-typed field values.

#### Function references

The type `function` denotes a function value. A parameter of type `function` accepts any declared function passed by name (without calling it):

```lamp
function int apply(int n, function fn):
    return fn(n)

function int double(int n):
    return n * 2

on startup:
    print apply(5, double)   # prints 10
```

A function reference is written as a bare identifier (the function name, without `()`). Inside the body, a `function`-typed parameter is called the same way as any other function: `fn(args)`.

Function references are currently untyped beyond the `function` tag — the static checker does not validate that the referenced function's signature matches the parameter's expected signature.

#### Native functions

A library `.lamp` file may declare a function whose implementation is provided by the library's `index.js` rather than a Lamp body:

```lamp
native function RETURN_TYPE NAME(PARAM_TYPE PARAM_NAME, ...)
```

A native function declaration carries the full signature (return type, name, and parameter list) but no body. The Lamp type system treats it identically to a regular function — callers can pass arguments, receive a return value, and the static checker validates argument count and types.

```lamp
native function string greet(string name)
native function int compute(int x, int y)
```

**Constraints**:
- A native function declaration must appear in a `.lamp` file inside a library directory whose `index.js` defines a top-level JavaScript function with the same name. If no such implementation exists, Lantern reports a compile error.
- Lantern detects native implementations by scanning `index.js` for `function NAME(` patterns. Arrow functions and other non-`function`-keyword forms are not detected and should not be used for native implementations.
- `native function` does not support `when` guards — conditional overloads are for Lamp-bodied functions only.

#### Conditional overloads

A function may have multiple definitions, each with an optional `when` guard:

```lamp
function RETURN_TYPE NAME(PARAM_TYPE PARAM_NAME, ...) when CONDITION:
    STATEMENT
    ...
```

When a function is called, Lamp evaluates which definition applies by selecting the one whose `when` condition is true and has the highest **specificity**. An unconditional definition (no `when` clause) acts as the fallback with specificity 0.

Specificity rules (see `devdocs/specificity.md` for full detail):
- Each atomic condition contributes 1 point.
- `COND_A and COND_B` has specificity equal to the sum of its parts.
- `COND_A or COND_B` has specificity equal to the maximum of its parts.
- `not COND` has the same specificity as `COND`.
- When two matching definitions tie in specificity, the last one defined wins.

If no condition matches and there is no unconditional fallback, Lamp throws a runtime error.

```lamp
function int damage(int base):
    return base

function int damage(int base) when hero_buffed == true:
    return base * 2

function int damage(int base) when hero_buffed == true and boss_fight == true:
    return base * 3
```

**Constraints** (enforced at compile time):
- All overloads of a function must share the same parameter count, parameter names, parameter types, and return type.
- At most one overload may be unconditional. Multiple unconditional definitions are an error.
- `when` conditions may only reference globals and object properties — not parameters, local variables, or function calls.

### Relations

A **relation** is a typed, directed edge connecting objects in the game graph. A relation type declares a set of fields (its endpoints and any extra data); a relation *instance* connects specific objects according to that type. Relations are the basis for graph-structured state such as room connectivity.

The full relation design and roadmap live in `devdocs/relations.md`. This section specifies the behavior implemented so far.

#### Relation type declarations

```lamp
relation TYPE_NAME:
    ENDPOINT_TYPE source
    ENDPOINT_TYPE target
    FIELD_TYPE FIELD_NAME [inverted]
    ...
    syntax "TEMPLATE"
```

`relation` declares a relation type — a directed **binary** edge. Every relation must declare exactly one `source` and one `target`; these are role keywords (in the field-name position) that fix the relation's canonical orientation, `source → target`. The two endpoints may have any types. Any number of additional labelled fields may follow (`FIELD_TYPE FIELD_NAME`), each optionally tagged `inverted`. The optional `syntax` line gives a custom assertion template (see below).

`syntax`, `source`, `target`, and `inverted` are contextual keywords: they are special only inside a `relation` body and are otherwise ordinary identifiers.

```lamp
relation connects:
    room source
    direction dir inverted
    room target
    syntax "connects [source] [dir] [target]"
```

A relation type participates in the universal `all` field: `connects.all` is the list of all instances of that relation.

Canonical orientation is established for every relation, not just bidirectional ones; it is what lets one relation be compared to another (e.g. a future rule deriving `older_than(a, b)` from `father(a, b)`). n-ary "group" relations are not yet supported.

#### Bidirectional relations

The `bidi` modifier asserts a relation that is traversable from either endpoint as a **single** instance (not two):

```lamp
bidi connects foyer north hall
```

The reverse direction is the relation's **mechanical inverse**: swap `source` and `target`, replace each `inverted` field with its value's own inverse, and copy the rest. An `inverted` field's type must declare an `inverse` field of that same type (so `direction dir inverted` requires `direction` to have a `direction inverse` field, with values like `north.inverse = south`). Asserting the reverse edge of a `bidi` instance deduplicates against it, and `bidi` over an existing one-way instance upgrades it in place.

#### Asserting relation instances

An assertion creates a relation instance. Asserting an instance whose field values are all equal to an existing instance's (object fields compared by identity, value fields by value) is a no-op that reuses the existing instance — relations are deduplicated. Assertions may appear at the top level or inside event handlers, change handlers, and function bodies.

**Block form** is always available, with or without a `syntax` template:

```lamp
connects:
    source foyer
    dir north
    target hall
```

**Custom-syntax form** is available when the relation declares a `syntax` template:

```lamp
connects foyer north hall
```

In a template, `[FIELD_NAME]` marks a slot filled by the value at that position; every other token is a literal that must appear verbatim. A literal token may be a reserved word (for example, `to` in `"links [source] to [target]"`). A template must begin with a literal token (conventionally the relation type name); this leading literal is how the parser recognizes a custom-syntax line. Two relation templates may not share a leading literal.

A custom-syntax assertion may name the instance by placing a name before the leading literal:

```lamp
north_door connects foyer north hall
```

The name is coerced like an object name (`north_door` → `north door`) and registered for lookup by `getObject`. A named assertion that deduplicates against an existing unnamed instance applies the name to that instance.

#### Querying relation instances

In expression position, a relation's custom-syntax template is a **boolean query** that is `true` when at least one matching instance exists:

```lamp
if connects foyer north hall:
    print "There's a passage north."
```

A slot may be `_` (a wildcard matching any value) instead of a value:

```lamp
if connects foyer _ _:
    print "The foyer has at least one exit."
```

Query slots are atoms: a value (object name, literal), a global or local variable, a property-access chain, or `_`. Operators, indexing, and function calls are not allowed inside a slot (bind them to a `let` first). A query against a `bidi` relation also matches via the relation's mechanical inverse, so the reverse direction is found. A boolean query is an ordinary `bool` expression and composes with `and`, `or`, `not`, and `if`/`while` conditions. `_` is valid only in a query — using it in an assertion is a compile error.

A query may instead **retrieve a value** by marking exactly one slot as the output with `?` and a multiplicity qualifier:

```lamp
let dest = connects foyer north ?only     # the room reached, none if absent, error if ambiguous
let exits = connects foyer _ ?all         # list<room> of all rooms reachable from foyer
let way  = connects foyer ? hall          # list<direction> from foyer to hall
```

- `?` or `?all` → a `list<T>` of the output slot's values across all matches.
- `?first` → the first value, or `none` if there are no matches.
- `?only` → the single value; `none` if no match, and a runtime error if more than one matches.

`T` is the output slot's declared field type. A value query against a `bidi` relation returns the inverse-oriented value, so `connects hall south ?only` (with `bidi connects foyer north hall`) yields `foyer`. (`all`, `first`, and `only` are contextual qualifiers recognized only immediately after `?`.)

#### Removing relation instances

Two removal forms are supported:

**Template-match remove** — removes all instances whose field values satisfy the template. Slots may be `_` (wildcard, matches any value):

```lamp
remove connects foyer north hall   # remove this specific edge
remove connects foyer _ _          # remove all edges from foyer
```

For a `bidi` instance, a match via either its forward fields or its mechanical inverse triggers removal of the entire instance (both directions disappear).

**Block form** (for relations without a syntax template):

```lamp
remove connects:
    source foyer
    dir _
    target hall
```

**Disconnect by name** — removes a named relation instance:

```lamp
disconnect north_door
```

A runtime error if no relation instance is registered under that name. `remove` and `disconnect` may appear at the top level or inside event handlers, change handlers, and function bodies.

#### Printing relation instances

A relation instance with a name prints as its name. An anonymous instance prints as its type name followed by a parenthesized, declaration-order field summary, with object-valued fields shown by name:

```
connects(foyer, north, hall)
```

### Rulebooks

> Initial surface (general rulebooks). Design-locked but not yet implemented. The
> design rationale and the deferred action-band layer live in
> `devdocs/rulebooks.md`.

A **rulebook** is an ordered, typed, short-circuiting decision pipeline: an
ordered set of guarded **rules** that runs until one rule decides the result. A
rulebook is invoked with `follow` and yields a single value of its declared
result type.

#### Rulebook declarations

```lamp
rulebook RESULT_TYPE NAME(PARAM_TYPE PARAM_NAME, ...):
    default DEFAULT_EXPR
    when CONDITION:
        STATEMENT
        ...
    ...
```

`rulebook` declares a named rulebook with a result type, an optional parameter
list (same form as function parameters), a required `default`, and one or more
rules. `RESULT_TYPE` may be any primitive type, kind name, or object type.

```lamp
rulebook bool reachable(physical thing):
    default false
    when thing.holder == player:
        stop true
    when thing.holder == player.holder:
        stop true
```

- `default DEFAULT_EXPR` gives the value the rulebook yields when no rule stops.
  It is required; its type is checked against `RESULT_TYPE`. (`default` is a
  contextual keyword, recognized only inside a rulebook body.)
- Each `when CONDITION:` introduces a **rule**: a guard plus an indented body.
  The body is a block following the same rules as a function body.

#### Rule evaluation

Following a rulebook runs its rules in **declaration order**. For each rule whose
`CONDITION` is true, the body runs; if the body reaches `stop EXPRESSION`, the
rulebook stops and yields `EXPRESSION`. If the body completes without `stop`,
evaluation falls through to the next rule. If no rule stops, the rulebook yields
its `default`.

- Rule order is exactly declaration order. Rulebooks do **not** use specificity
  (unlike conditional function overloads): guards decide applicability, order
  decides sequence, and `stop` decides which rule's value wins.
- A rule `CONDITION` is an ordinary `bool` expression evaluated in the rule's
  scope (parameters and globals). Unlike a `when` guard on a conditional overload,
  a rule guard **may** reference the rulebook's parameters.

#### `stop`

```lamp
stop EXPRESSION
```

`stop` ends the enclosing rulebook immediately, yielding `EXPRESSION` as its
result. It is valid only inside a rulebook rule body, and `EXPRESSION` is checked
against the rulebook's result type. A rule body that completes without `stop`
falls through to the next rule.

#### Following a rulebook

```lamp
follow NAME(ARGUMENT, ...)
```

`follow` invokes a rulebook and produces its result value. It may appear anywhere
an expression is valid, or as a standalone statement (running the rulebook for
its effects and discarding the result):

```lamp
let r = follow reachable(brass_lamp)
if not follow reachable(self.taken):
    print "You can't reach that."
```

The leading `follow` keyword marks the call as a rulebook invocation, so it is
never confused with a function call and the parser does not need to know rulebook
names to recognize the form. Argument count and types are checked against the
declared parameters, as for function calls.

#### Deferred (not in this surface)

Designed in `devdocs/rulebooks.md` but intentionally outside the initial surface:
named rules; cross-file rule addition; group/`order` ordering constraints;
`void` rulebooks; and any runtime mutation of rulebooks.

### Action rulebooks

An **action** is the built-in application of a rulebook: a typed object whose
fields are its named **slots**, with a fixed six-band rulebook attached. See
`devdocs/rulebooks.md` and `devdocs/game_parser.md` for the design.

#### Action declarations

```lamp
action NAME:
    SLOT_TYPE SLOT_NAME
    ...
```

`action` declares an action type — a subtype of the built-in `action` type —
whose body lists its slots as field declarations (same form as a type body). An
action with no slots omits the `:` and body.

```lamp
action take:
    item taken
```

(The `syntax` grammar block that maps surface commands onto an action is part of
the Game Parser and is not yet implemented.)

#### Phase rules

Behavior is attached with **phase rules** — a leading band keyword, the action
name, an optional `when` guard, and a block. The six bands run in order:
**before → instead → check → do → after → report**. Inside the body, `self` is
the action instance.

```lamp
instead take when self.taken.sacred:
    print "You dare not touch the idol."
    stop failed

check take:
    if self.taken.scenery:
        print "That's hardly portable."
        stop failed

do take:
    print "Taken."

report take:
    print "(You pocket it.)"
```

The action runs its rules band by band. A rule body that reaches `stop OUTCOME`
ends the whole action with that `outcome` (`succeeded` or `failed`); a body that
falls through continues to the next rule, and the next band. If no rule stops,
the action `succeeded`. (`stop` in a phase rule carries an `outcome` value; the
band words are contextual keywords, valid only as the leading token of a phase
rule for a declared action.)

#### Running an action

```lamp
try ACTION:
    SLOT_NAME VALUE
    ...
```

`try` constructs an action instance with the given slot values and runs it
through the bands. It is a statement; slot values follow the same rules as object
field values (a literal or a bare object reference).

```lamp
try take:
    taken lamp
```

### Name resolution and scope

A **local context** is the body of an event handler, change handler, or function. Within a local context, names are drawn from two disjoint namespaces:

- **Locals** — names introduced by `let`, by a function parameter, or by a `for` loop variable. A local is visible only within the context (and nested blocks) in which it is introduced.
- **Globals** — names introduced by a `global` declaration, visible everywhere.

#### Single resolution model

A bare single-name reference resolves the same way in every position — read or write — within a local context:

1. a local binding in scope, otherwise
2. a declared global.

Because reads and writes share one resolution order, a name always denotes the same binding whether it is read or assigned. `score = score + 1` reads and writes the same `score`.

#### No shadowing

A `let` binding, function parameter, or `for` loop variable may not reuse the name of a declared global. Declaring a local that shadows a global is a compile error:

```lamp
global score = 0
on startup:
    let score = 10        # error: local 'score' shadows global 'score'
```

This keeps the local and global namespaces disjoint, so the single resolution model never has to choose between a local and a global of the same name.

#### Assignment resolves a target, never declares one

A single-name assignment `NAME = EXPRESSION` reassigns an existing binding:

- if `NAME` is a local in scope, it reassigns that local;
- otherwise if `NAME` is a declared global, it assigns the global;
- otherwise it is a compile error — assignment never implicitly declares a new local. Use `let` to introduce a local.

### Statements

- **Variable binding** — introduces a new local bound to a value:

```lamp
let NAME = EXPRESSION
```

`NAME` must not collide with a declared global (see Name resolution and scope).

- **Output** — writes a value to the player:

```lamp
print EXPRESSION
```

`print` with no argument prints a blank line.

- **Assignment** — updates an existing local variable, global, or object field:

```lamp
NAME = EXPRESSION
TARGET.FIELD = EXPRESSION
```

A single-name target reassigns the binding `NAME` resolves to — a local if one is in scope, otherwise a declared global (see Name resolution and scope). Assigning a name that is neither a local in scope nor a declared global is a compile error. A dotted target assigns to an object field. Field assignments are compile-time checked against the declared field type when Lantern can infer the expression type.

- **Error** — aborts execution with a message:

```lamp
error EXPRESSION
```

- **Conditional** — python-style conditional blocks with optional `else`:

```lamp
if EXPRESSION:
    STATEMENT
    ...
else:
    STATEMENT
    ...
```

- **While loop** — python-style loop that repeats while a condition holds:

```lamp
while EXPRESSION:
    STATEMENT
    ...
```

- **For loop** — counted loop from `START` to `FINISH` (inclusive), incrementing by `STEP` each iteration. `step STEP` is optional and defaults to 1.

```lamp
for VAR = START to FINISH:
    STATEMENT
    ...

for VAR = START to FINISH step STEP:
    STATEMENT
    ...
```

`VAR` is a new local variable scoped to the loop body. `to` implies counting upward; the loop condition is `VAR <= FINISH`.

- **Break** — exits the innermost enclosing `while` or `for` loop:

```lamp
break
```

- **Dispatch** — fires a named event, invoking all registered handlers for that event:

```lamp
dispatch EVENT_NAME
```

`EVENT_NAME` is a single identifier. Any number of `on EVENT_NAME:` handlers may exist; all are called in registration order.

- **Follow** — invokes a rulebook (see Rulebooks). As a standalone statement it runs the rulebook and discards the result:

```lamp
follow NAME(ARGUMENT, ...)
```

- **Stop** — ends the enclosing rulebook, yielding a value. Valid only inside a rulebook rule body:

```lamp
stop EXPRESSION
```

### Expressions

- **Variable reference** — a local name introduced by `let`:

```lamp
this_game
```

- **Property access** — chains of `.`-separated names:

```lamp
game.all.first
this_game.name
```

- **Addition and concatenation** — `+` adds numeric values or concatenates strings:

```lamp
"by " + this_game.author
score + 10
```

`+` is type-directed:

- `int + int` produces `int`
- `real + int` and `int + real` produce `real`
- if either side is `string`, the result is `string`
- enum-kind values may be implicitly coerced to `string` when used with `+`

- **Subtraction** — `-` subtracts numeric values:

```lamp
n - 1
total - cost
```

Type rules mirror `+` for numeric operands. `-` has the same precedence as `+`.

- **Unary minus** — a leading `-` negates a numeric value:

```lamp
-7
-x
```

Unary minus has higher precedence than `*` and `/`, so `-x^2` parses as `-(x^2)`.

- **Multiplication** — `*` multiplies numeric values:

```lamp
2 * circle.radius
2 * Unit_Circle.radius * PI
```

`*` is type-directed:

- `int * int` produces `int`
- `real * int` and `int * real` produce `real`

`*` has higher precedence than `+` and `-`.

- **Division** — `/` divides numeric values:

```lamp
total / count
circumference / (2 * PI)
```

Type rules mirror `*`. Division by zero produces `NaN` rather than an error.

- **Exponentiation** — `^` raises the left operand to the power of the right operand:

```lamp
2 ^ 10
x ^ 0.5
```

`^` has higher precedence than `*` and `/` and is right-associative, so `2 ^ 3 ^ 2` parses as `2 ^ (3 ^ 2)`.

- **Grouping** — parentheses override precedence:

```lamp
(a + b) * c
circumference / (2 * PI)
```

- **Boolean conjunction** — `and` combines two boolean expressions; the result is `true` only if both sides are `true`:

```lamp
x > 0 and x < 10
alive and has_key
```

- **Boolean disjunction** — `or` combines two boolean expressions; the result is `true` if either side is `true`:

```lamp
score == 0 or lives == 0
door_open or window_open
```

- **Boolean negation** — `not` inverts a boolean expression:

```lamp
not game_over
not (x == 0 or y == 0)
```

`not` has higher precedence than `and`, which has higher precedence than `or`. So `not a or b and c` parses as `(not a) or (b and c)`.

- **Comparison** — `==`, `<`, `<=`, `>`, and `>=` compare two expressions and produce `bool`. `!=` is not supported.

```lamp
this_game.release == final
i < 5
count > 0
score >= 100
n <= limit
```

- **Object name reference** — a named object can be referenced directly in expressions by its identifier. Multi-word names use the underscore convention (see Names and identifiers); the coerced name is looked up at runtime. A `.`-separated field chain may follow:

```lamp
MyCircle.radius
Unit_Circle.radius
```

- **`none`** — the absent-object literal, valid in any expression context that accepts an object reference:

```lamp
if this_game.start == none:
    error "no start room defined"
```

- **Function call expression** — calls a named function and produces its return value:

```lamp
add(3, 4)
factorial(n - 1)
apply(5, double)
```

Arguments are full expressions. A call expression may appear anywhere a value is expected: in `let` bindings, as arguments to other calls, in arithmetic, etc.

- **Function reference** — a declared function name used without `()` produces a `function` value that can be passed as an argument:

```lamp
let f = double
apply(5, double)
```

- **Bare identifiers** in expressions are resolved in this order: local variable (introduced by `let`), declared global, declared function (producing a function reference), declared object (producing an object reference), then string literal. The object-reference step lets a bare single-word object name compare by identity (`x == statue`); the string-literal fallback supports enum-label comparisons such as `== final`. (A multi-word object name already resolves to an object reference via the underscore convention.)

- **Follow expression** — `follow NAME(args)` invokes a rulebook and produces its result value (see Rulebooks):

```lamp
follow reachable(brass_lamp)
```

## Implementation notes

### Compiler pipeline

Lantern compiles in three passes:

1. **Pre-scan** (`index.js`): scan all source files with a single regex per line to collect declared global names and declared function names. Also scans each library directory for `index.js`; if present, reads it and extracts top-level function names (via `function NAME(` regex). Produces a `Set<string>` of global names, a `Set<string>` of function names, and the raw native JS content strings to inline.
2. **Parse** (`parser_rd.js`): parse each file into an AST using the collected global and function names so that bare identifiers in expressions are resolved correctly.
3. **Check** (`checker.js`) + **emit** (`emitter.js`): semantic check then emit standalone Node.js JavaScript.

The emitted program runs in this order: runtime bootstrap → native JS (inlined from `index.js` files) → kinds → kind constants → types → type constants → objects (primitive/kind fields only) → object-typed field assignments → global declarations → global assignments → function definitions → event handler registrations → `run()`. Globals and object-typed field assignments are placed after all `createObject` calls so that any `lamplighter.getObject(...)` reference resolves against an already-registered instance regardless of declaration order. Function definitions are emitted before event handler registrations so they are in scope when handlers run.

### Parser design

The parser (`parser_rd.js`) is a full-file recursive-descent parser over a token stream produced by `tokenizer.js`. It implements the underscore-identifier surface syntax defined above under "Names and identifiers".

**Tokenizer** (`tokenizer.js`): scans the entire source file and emits a flat token stream with Python-style significant indentation (`INDENT` / `DEDENT` / `NEWLINE`). Token types: `NUMBER`, `STRING`, `IDENT`, `KEYWORD`, `PLUS`, `MINUS`, `STAR`, `SLASH`, `CARET`, `EQEQ`, `LT`, `GT`, `LTE`, `GTE`, `LPAREN`, `RPAREN`, `DOT`, `COMMA`, `COLON`, `EQUALS`, `INDENT`, `DEDENT`, `NEWLINE`, `EOF`. Reserved words are emitted as `KEYWORD` tokens, not `IDENT`. Coercion (underscore → space, etc.) is not applied by the tokenizer; the parser calls `coerceName` where appropriate.

**Recursive-descent parser**: top-level declarations are dispatched by the leading keyword or by the shape of the first two tokens. Block structure is driven by `INDENT` / `DEDENT` tokens. Expression parsing uses a **Pratt parser** (top-down operator precedence):

- A `parseNud` function handles prefix position (literals, identifiers, unary minus, parenthesized sub-expressions).
- A `parseLed` function handles infix position (binary operators).
- Operator binding powers (higher binds tighter):

| Operator | Binding power |
|---|---|
| `or` | 1 |
| `and` | 2 |
| unary `not` | 3 |
| `==`, `<`, `<=`, `>`, `>=` | 5 |
| `+`, `-` | 10 |
| `*`, `/` | 20 |
| unary `-` | 25 |
| `^` | 30 (right-associative) |

Identifier disambiguation in expression position (`parseIdentExpr`) resolves in this order: `true`/`false`/`none` literals → function call (IDENT followed by `LPAREN`) → property-access chain (IDENT followed by `.`) → local variable → global → function reference → declared object reference → string literal (enum-label fallback). Object names are collected in a pre-scan pass (like globals and functions) so a bare single-word object name resolves to the object rather than a string.

### Static checking

Lantern performs a semantic checking pass before emission.

- Object-declaration field values are checked against the declared field type.
- Field assignments in executable code are checked against the target field type.
- Primitive fields (`string`, `int`, `real`) reject incompatible inferred expression types.
- Enum-kind fields reject labels outside the enum definition.
- Expression inference covers literals, local variables, property-access chains (including `.all` → `list<T>` and `.first` → `T`), `+`, `*`, `==`, `<`, and `>`. Globals and object name references currently return unknown type and are not statically checked.
- `list<T>` is recognized as a valid field type in chain resolution. Element-level validation of `list<T>` field assignments is not yet performed.
- Function call statements are checked for correct argument count and compatible argument types against the declared parameter types.
- `return EXPRESSION` inside a function body is checked against the function's declared return type when the expression type can be inferred.
- Function parameters and the loop variable in `for` are typed as locals within their enclosing body. Function parameters take the declared parameter type; the loop variable has type `int`.
- `function`-typed parameters and `FunctionRefExpr` values are accepted without deeper signature checking — the static checker does not currently validate that a passed function's parameter list or return type matches what the receiving parameter expects.
- Conditional overloads (`when` clauses) are validated: all overloads of a function must share the same signature; at most one may be unconditional; `when` conditions may not contain function calls or function references; `when` conditions must produce a `bool` value. Syntactically identical `when` conditions on the same function produce a warning.
- Native function declarations are validated against the collected native JavaScript: if a `native function` declaration names a function that does not appear (as a `function NAME(` pattern) in any `index.js` from the compiled library set, Lantern reports a compile error.
- The no-shadowing rule is enforced: a `let` binding, function parameter, or `for` loop variable whose name matches a declared global is a compile error.
- Assignment to a bare name that is neither a `let`-bound local in scope nor a declared global is a compile error.

## Open Questions

- Should the no-shadowing rule extend to top-level `let`-style bindings if locals are ever permitted outside a local context, or remain scoped to local contexts only?
