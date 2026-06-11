# Lamp specifications

## Functional Specifications

### Lantern

- Lantern is a command-line tool.
- Lantern takes a .lamp source file as input and produces a JavaScript file as output.
- The output JavaScript file is a representation of the game that can be executed with the Lamplighter runtime.
- Any .lamp files in the lib/ directory are considered part of the standard library and should be available for import in user games. Any in lib/sys are automatically included in all games and do not require an explicit import.

#### First iteration scope

- Lantern parses `lib/sys/*.lamp` plus one user entry file (for example, `sample/min.lamp`) and emits one standalone Node.js JavaScript file.
- The parsed game must define at least one object of type `game`.
- If no `game` object is present, Lantern reports `error: no game object defined.` and exits with a nonzero status.
- The emitted file is directly runnable from the command line.
- The emitted file requires the Lamplighter library and executes through it.
- Lighthouse integration is out of scope for this iteration.

### Lamplighter

- Lamplighter is the runtime library used by emitted JavaScript.
- Lamplighter provides built-in type bootstrapping, type/instance registration, event registration, and runtime execution.
- Lamplighter provides swappable output behavior via `print`.

#### Runtime API contract (v0)

Lantern-generated JavaScript targets the following Lamplighter API surface:

- `bootstrapBuiltins()`
    - Initializes built-in runtime types.
    - Safe to call multiple times.
- `defineType(name, parent, fields)`
    - Registers a type definition.
    - `parent` may be `null`.
- `createObject(typeName, objectName, fieldValues)`
    - Creates and registers an object instance.
    - Sets universal fields `name` and `type` on the instance.
- `type(name)`
    - Returns a type handle.
    - Type handle exposes `all`, which includes instances of the type and all subtypes.
    - `all.first` returns the first element in that list.
- `onEvent(eventName, handler)`
    - Registers an event handler callback.
- `run()`
    - Executes the runtime entry sequence.
    - In v0, this fires the `startup` event.
- `print(value)`
    - Sends output to the active output implementation.
- `setPrint(fn)`
    - Replaces the output implementation used by `print`.
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

Built-in complex types:
- `object`
- `type`
- `event`

Built-in primitive types:
- `string`
- `int`
- `bool`
- `real`
- `list<T>` (generic list of elements of type `T`)

#### Type inheritance

A type may inherit from a parent type using `<`:

```lamp
type TYPE_NAME < PARENT_TYPE_NAME:
    FIELD_TYPE FIELD_NAME
    ...
```

Instances of `TYPE_NAME` inherit all fields declared on `PARENT_TYPE_NAME`. The body may add further fields.

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

Every kind has an output function for printing a value of that kind. The `enum` kind's output function is built-in. For example, if `color` is defined as above, then `print red` outputs `red`, and so on for the other labels. An unset value of an enum kind outputs as `none`.

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

### Statements

- **Variable binding** — binds a local name to a value:

```lamp
let NAME = EXPRESSION
```

- **Output** — writes a value to the player:

```lamp
print EXPRESSION
```

- **Field assignment** — updates an object field:

```lamp
TARGET.FIELD = EXPRESSION
```

- **Error** — aborts execution with a message:

```lamp
error EXPRESSION
```

### Expressions

- **Property access** — chains of `.`-separated names:

```lamp
game.all.first
this_game.name
```

- **String concatenation** — `+` joins strings:

```lamp
"by " + this_game.author
"version " + this_game.version
```
