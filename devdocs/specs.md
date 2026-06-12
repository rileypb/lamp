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
- If no `game` object is present, Lantern reports `error: no game object defined.` and exits with a nonzero status.
- On compile failure, Lantern reports diagnostics in the form `Compile error: <file>:<line>: <detail>` and includes the source line with a caret marker.
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

#### Known limitations (v0)

- Kind values are currently represented at runtime as strings.
- Runtime execution currently fires only the `startup` event from `run()`.
- Type-checking is only as strong as the current expression inference rules; expressions whose types cannot yet be inferred are not rejected.
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
- Multi-word identifiers and values are valid (for example, `game Minimal` and `author Phil Riley`).

### Objects and types

#### Object declarations

```lamp
TYPE_NAME OBJECT_NAME:
    FIELD_NAME VALUE
    ...
```

`TYPE_NAME OBJECT_NAME:` declares an object named `OBJECT_NAME` of type `TYPE_NAME`. A trailing `:` starts the body. Each indented line is a field assignment `FIELD_NAME VALUE`. Values may be multi-word text.

```lamp
game Minimal:
    author Phil Riley
    version 1
```

An object with no fields omits the `:` and body entirely:

```lamp
person yourself
```

Object-typed field values are written as the object's name (bare or multi-word):

```lamp
game One-Room Game:
    author Test Author
    start West of House
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
global bool USE OXFORD COMMA = false
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

At the top level, a bare `NAME = VALUE` line assigns a new value to a previously-declared global. This lets user files override defaults set by the standard library.

```lamp
USE OXFORD COMMA = true
```

Global assignments are type-checked against the type declared in the corresponding global declaration.

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

### Statements

- **Variable binding** — binds a local name to a value:

```lamp
let NAME = EXPRESSION
```

- **Output** — writes a value to the player:

```lamp
print EXPRESSION
```

`print` with no argument prints a blank line.

- **Assignment** — updates a local variable or object field:

```lamp
NAME = EXPRESSION
TARGET.FIELD = EXPRESSION
```

A single-name target reassigns a `let`-bound local. A dotted target assigns to an object field. Field assignments are compile-time checked against the declared field type when Lantern can infer the expression type.

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
"version " + this_game.version
```

`+` is type-directed:

- `int + int` produces `int`
- `real + int` and `int + real` produce `real`
- if either side is `string`, the result is `string`
- enum-kind values may be implicitly coerced to `string` when used with `+`

- **Multiplication** — `*` multiplies numeric values:

```lamp
2 * circle.radius
2 * (Unit Circle).radius * PI
```

`*` is type-directed:

- `int * int` produces `int`
- `real * int` and `int * real` produce `real`

`*` has higher precedence than `+`.

- **Comparison** — `==`, `<`, and `>` compare two expressions and produce `bool`:

```lamp
this_game.release == final
i < 5
count > 0
```

- **Object name reference** — a named object can be referenced directly in expressions. For single-word object names the name is used as a bare identifier:

```lamp
MyCircle.radius
```

For multi-word object names, the name is wrapped in parentheses:

```lamp
(Unit Circle).radius
```

`(NAME)` looks up the object named `NAME` at runtime. A `.`-separated field chain may follow.

- **`none`** — the absent-object literal, valid in any expression context that accepts an object reference:

```lamp
if this_game.start == none:
    error "no start room defined"
```

- **Bare identifiers** in expressions are resolved in this order: local variable (introduced by `let`), declared global, then string literal. The string-literal fallback supports enum-label comparisons such as `== final`.

## Implementation notes

### Compiler pipeline

Lantern compiles in three passes:

1. **Pre-scan** (`index.js`): scan all source files with a single regex per line to collect declared global names. Produces a `Set<string>` of global names.
2. **Parse** (`parser.js`): parse each file into an AST using the collected global names so that global references in expressions are resolved correctly.
3. **Check** (`checker.js`) + **emit** (`emitter.js`): semantic check then emit standalone Node.js JavaScript.

The emitted program runs in this order: kinds → kind constants → types → type constants → objects (primitive/kind fields only) → object-typed field assignments → global declarations → global assignments → event handler registrations → `run()`. Globals and object-typed field assignments are placed after all `createObject` calls so that any `lamplighter.getObject(...)` reference resolves against an already-registered instance regardless of declaration order.

### Parser design

The outer parser is line-by-line and indentation-driven. Each line is classified by its leading keyword (`type`, `kind`, `global`, `on`, …) and dispatched to a dedicated parse function. Block structure is handled by comparing indentation levels; `parseChildBlock` and `parseStatementBlock` consume lines until indentation falls back to the enclosing level.

Expression parsing (`parseExpression`) uses a **tokenizer + Pratt parser** (top-down operator precedence):

**Tokenizer** (`tokenizeExpression`): scans the raw expression string character by character and produces a flat token stream. Token types: `NUMBER`, `STRING`, `IDENT`, `PLUS`, `STAR`, `EQEQ`, `LT`, `GT`, `LPAREN`, `RPAREN`, `DOT`, `EOF`. Negative number literals (e.g. `-7`) are recognized when the preceding token is not a value token.

**Pratt parser**: a `parse(minBP)` function that drives a loop over the token stream. Each token has either a *null denotation* (nud — starts an expression) or a *left denotation* (led — extends an expression to the left). Operator precedences:

| Operator | Binding power |
|---|---|
| `==`, `<`, `>` | 5 |
| `+` | 10 |
| `*` | 20 |

Adding a new infix operator requires one entry in the `BP` table and one branch in `led`. DOT (`.`) is not a binary operator in the Pratt table; instead, `nud(IDENT)` eagerly consumes any following `.field` chain to build `PropertyAccess` nodes. Parentheses (`(…)`) are consumed by `nud(LPAREN)` and always denote a multi-word object name reference — arithmetic grouping is not currently supported.

### Static checking

Lantern performs a semantic checking pass before emission.

- Object-declaration field values are checked against the declared field type.
- Field assignments in executable code are checked against the target field type.
- Primitive fields (`string`, `int`, `real`) reject incompatible inferred expression types.
- Enum-kind fields reject labels outside the enum definition.
- Expression inference currently covers literals, local variables, property-access chains, `+`, `*`, and `==`. Globals and object name references (`(Name)`) currently return unknown type and are not statically checked.
