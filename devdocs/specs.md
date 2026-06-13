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

The following words are **reserved** and may not be used as a name (object, type, kind, global, field, event, or local): `type`, `kind`, `global`, `on`, `for`, `while`, `if`, `else`, `let`, `print`, `error`, `dispatch`, `break`, `lib`, `to`, `step`, `change`, `function`, `return`. A reservation applies only to a whole identifier: a reserved word appearing *inside* a longer identifier is unrestricted, so `move_to_room` (which denotes the name `move to room`) is a valid identifier even though `to` is reserved.

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

At the top level, a bare `NAME = VALUE` line assigns a new value to a previously-declared global. This lets user files override defaults set by the standard library.

```lamp
USE_OXFORD_COMMA = true
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

Arguments are full expressions and may include literals, variables, arithmetic, other function calls, and function references. The static checker verifies that the argument count matches the declaration and that argument types are compatible with parameter types where inferable.

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

- **Bare identifiers** in expressions are resolved in this order: local variable (introduced by `let`), declared global, declared function (producing a function reference), then string literal. The string-literal fallback supports enum-label comparisons such as `== final`.

## Implementation notes

### Compiler pipeline

Lantern compiles in three passes:

1. **Pre-scan** (`index.js`): scan all source files with a single regex per line to collect declared global names and declared function names. Produces a `Set<string>` of global names and a `Set<string>` of function names. Both sets are needed so the parser can distinguish globals, function references, and enum-label string literals in expression context.
2. **Parse** (`parser_rd.js`): parse each file into an AST using the collected global and function names so that bare identifiers in expressions are resolved correctly.
3. **Check** (`checker.js`) + **emit** (`emitter.js`): semantic check then emit standalone Node.js JavaScript.

The emitted program runs in this order: kinds → kind constants → types → type constants → objects (primitive/kind fields only) → object-typed field assignments → global declarations → global assignments → function definitions → event handler registrations → `run()`. Globals and object-typed field assignments are placed after all `createObject` calls so that any `lamplighter.getObject(...)` reference resolves against an already-registered instance regardless of declaration order. Function definitions are emitted before event handler registrations so they are in scope when handlers run.

### Parser design

The parser (`parser_rd.js`) is a full-file recursive-descent parser over a token stream produced by `tokenizer.js`. It implements the underscore-identifier surface syntax defined above under "Names and identifiers".

**Tokenizer** (`tokenizer.js`): scans the entire source file and emits a flat token stream with Python-style significant indentation (`INDENT` / `DEDENT` / `NEWLINE`). Token types: `NUMBER`, `STRING`, `IDENT`, `KEYWORD`, `PLUS`, `MINUS`, `STAR`, `SLASH`, `CARET`, `EQEQ`, `LT`, `GT`, `LTE`, `GTE`, `LPAREN`, `RPAREN`, `DOT`, `COMMA`, `COLON`, `EQUALS`, `INDENT`, `DEDENT`, `NEWLINE`, `EOF`. Reserved words are emitted as `KEYWORD` tokens, not `IDENT`. Coercion (underscore → space, etc.) is not applied by the tokenizer; the parser calls `coerceName` where appropriate.

**Recursive-descent parser**: top-level declarations are dispatched by the leading keyword or by the shape of the first two tokens. Block structure is driven by `INDENT` / `DEDENT` tokens. Expression parsing uses a **Pratt parser** (top-down operator precedence):

- A `parseNud` function handles prefix position (literals, identifiers, unary minus, parenthesized sub-expressions).
- A `parseLed` function handles infix position (binary operators).
- Operator binding powers (higher binds tighter):

| Operator | Binding power |
|---|---|
| `==`, `<`, `<=`, `>`, `>=` | 5 |
| `+`, `-` | 10 |
| `*`, `/` | 20 |
| unary `-` | 25 |
| `^` | 30 (right-associative) |

Identifier disambiguation in expression position (`parseIdentExpr`) resolves in this order: `true`/`false`/`none` literals → function call (IDENT followed by `LPAREN`) → property-access chain (IDENT followed by `.`) → local variable → global → function reference → string literal (enum-label fallback).

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
