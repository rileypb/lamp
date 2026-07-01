# Lamp specifications

## Functional Specifications

### Lantern

- Lantern is a command-line tool.
- Lantern takes a .lamp source file as input and produces a JavaScript file as output.
- The output JavaScript file is a representation of the game that can be executed with the Lamplighter runtime.
- `npm run compile INPUT.lamp OUTPUT.js` — compile a source file (emits a body-only module)
- `npm run play -- INPUT.lamp` — compile and run a source file through the sandbox launcher
- `npm run exe -- INPUT.lamp` — alias for `npm run play`
- `npm test` — run the golden test suite
- `lib/sys/` is the system library. Every invocation of Lantern automatically parses all `.lamp` files in `lib/sys/` — no explicit import is required. The sys library's `index.js` provides native implementations for the following built-in functions available to all Lamp programs:
    - `readline() → string` — reads one line of player input, blocking until the player submits. Input is brokered through the sandbox's input channel; `readline` is not available outside the sandbox.
    - `split(string) → list<string>` — splits a string on whitespace and returns the words as a list.
    - `length(string) → int`, `char_at(string, int) → string`, `code_at(string, int) → int`, `substring(string, int start, int end) → string` — the string-character primitives. All **codepoint-based** (an astral character counts as one) and **0-indexed** (matching list indexing). `char_at` returns `""` and `code_at` returns `-1` when the index is out of range; `substring` is the half-open range `[start, end)`, tolerant of out-of-range bounds. With `to_lower` and `+` these are enough to express text algorithms (ciphers, hashing, tokenisation) in Lamp rather than a native.
    - `map_strings(list<object>, function) → list<string>` — applies an object→string function (passed by name) to each element, returning the list of results. The general list-transform primitive (Lamp has list literals `[…]` but no append, so *deriving* a transformed list still needs a native); pairs with the locale's `format_list` to render a list of objects to prose (`format_list(map_strings(things, describe))`).
    - `run_command(string, object) → bool` — parses one line of player input against registered action templates, resolves slot objects in scope, and runs the matched action for the given actor. Returns **true iff a turn was spent** (an action actually ran), so the caller can fire every-turn rules; false for a parse failure, a disambiguation prompt, or an out-of-world verb.
- `lib/en-US/` is the **default locale pack** — English *language data* for the text-substitution layer (article functions `the`/`a`/`an`, case functions `cap`/`upper`/`lower`/`title`, and the list-to-prose formatter `format_list` with its "and"/Oxford comma). Like `lib/sys`, it auto-loads on every invocation, inserted **immediately after `lib/sys/` and before any imported library**. It is the swappable language layer (a future `lib/en-GB`/`lib/fr-FR` replaces it) — `lib/sys` holds only language-agnostic mechanism. See `devdocs/text.md` (three-layer split).
- Other subdirectories of `lib/` (e.g. `lib/test/`, `lib/advent/`) are optional libraries that must be imported explicitly with `lib LIBNAME`.
- `.lamp` files placed directly in `lib/` (not inside a named subdirectory) are not parsed and are not available for import.

#### First iteration scope

- Lantern parses `lib/sys/*.lamp` plus one user entry file (for example, `sample/min.lamp`) and emits one standalone Node.js JavaScript file.
- The parsed game must define at least one object of type `game`.
- If no `game` object is present, Lantern reports `error: no game object defined.` to **stderr** and exits with a nonzero status.
- On compile failure, Lantern reports diagnostics to **stderr** in the form `Compile error: <file>:<line>: <detail>` and includes the source line with a caret marker.
- The emitted file is a **body-only module** — no shebang and no `require()`. It is not runnable directly with `node`. The sandbox launcher (see `devdocs/sandbox.md`) injects `lamplighter` as a context global into a restricted `worker_threads` worker and is the only supported run path.
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
- Runtime execution currently fires only the `startup` event from `run()`. Every-turn and timed rules are not yet implemented.
- Expressions whose types cannot be inferred (globals, object name references, `list<T>` field assignments) are not rejected — unknown type is treated as compatible with any field type.
- Object-typed fields and globals are not statically type-checked (the checker returns unknown type for object references and `none`).
- The emitted file is body-only and runs only through the sandbox launcher (`npm run play`). Executing a generated file directly with `node` is not supported and will throw if player input is attempted.

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
- `defineRelation(name, fields, syntaxTemplate?, invertedFields?, sourceField?, targetField?, uniqueFields?)`
    - Registers a relation type. It is registered as a type (so `name.all` and `isTypeOrSubtype` dispatch work) but its edges live in a **separate relation-instance store**, not the world-object instance registry — so scope/vocabulary iteration never walks relation edges. Records the field schema, optional syntax template, the list of `inverted`-tagged field names, the list of `unique`-tagged field names (cardinality keys; see `addRelation`), and the canonical source and target field names (used by `relationInverse` to derive the mechanical inverse). See `devdocs/architecture.md` issue F.
- `addRelation(typeName, fields, options?)`
    - Creates a relation instance from a field-value mapping.
    - Deduplicates by field values (object fields by identity, value fields by equality); asserting an identical instance returns the existing one. For a `bidi` instance, an assertion that matches its mechanical inverse also deduplicates against it.
    - **Cardinality eviction.** For each `unique`-tagged field on the relation type, before inserting a non-duplicate instance, removes any existing edge whose value in that field equals the new edge's (via `removeRelation`, so remove handlers fire and names are unregistered). This enforces the one-edge-per-key invariant that makes a `unique` `to` endpoint a one-to-many relation.
    - `options` may carry `name` (registers the instance for `getObject`) and `bidi` (marks the instance bidirectional, upgrading an existing match in place).
    - The edge is stored in the relation-instance store (separate from world objects); it still appears in the relation type's `all` (the two stores are unioned only there).
- `queryRelation(typeName, query)`
    - Returns the matching edges as **oriented** field-mappings (the instance for a direct match; its mechanical inverse for a `bidi` instance matched in reverse). A slot holding the `ANY` wildcard sentinel matches any value; other slots match by identity (objects) or value (primitives).
- `queryRelationValue(typeName, query, outputField, mode)`
    - Extracts `outputField` from the matching oriented edges. `mode` is `"all"` (returns a list), `"first"` (first value or `none`), or `"only"` (the single value, `none` if none, runtime error if more than one).
- `removeRelation(typeName, query)`
    - Removes all instances matching `query` (using `ANY` as wildcard). For `bidi` instances, a match via the mechanical inverse also removes the entire underlying instance (both index entries). Unregisters any name the removed instance held.
- `removeRelationByName(name)`
    - Removes the named relation instance and unregisters its name. Runtime error if the name is not found or refers to a non-relation object.
- `moveObject(contained, container)`
    - Relocates `contained` into `container` by asserting the world-model containment relation **`contains`** with `container` as its source (`from`) endpoint and `contained` as its target (`to`) endpoint. The relation's `to` endpoint is tagged `unique`, so the assertion evicts `contained`'s prior container automatically (a move is a single assertion). Endpoint field names are read from the relation registry, so the world library may name them freely. Runtime error if no `contains` relation is defined. The emit target of the `move X to Y` statement.
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
    - **Newlines are runtime-owned (paragraph control, text.md H).** `print` does *not*
      unconditionally append a newline. A value whose rendered text ends in
      sentence-ending punctuation (`.` `?` `!`, past trailing quotes/parens) auto-ends
      its line; text without it *runs on* into the next output. The break markers
      `[line break]` / `[par]` / `[no break]` / `[run on]` / `[par if printed]` (and the
      lib/sys functions they desugar to) request or cancel breaks, which are
      deduplicated and flushed before the next text, a prompt, or at program exit.
- `setPrint(fn)`
    - Replaces the output implementation used by `print`.
- `message(name, default)`
    - Returns the registered override text for the named message, else `default`. The emit target of the inline message form `NAME:"DEFAULT"` (a localizable message whose default lives at the use site). See `devdocs/messages.md`.
- `registerMessageOverride(name, text)`
    - Registers an override text (a string or lazy `text` value) for a named message; a later registration wins. The emit target of a top-level `NAME: "TEXT"` declaration (e.g. a translation pack). Overrides reference the running action via the `act` global, so they render against it.
- `defineGlobal(name, value)`
    - Registers a named global with an initial value.
- `setGlobal(name, value)`
    - Assigns a new value to a previously registered global.
- `getGlobal(name)`
    - Returns the current value of a named global.
- `error(message)`
    - Stops execution by throwing a runtime error.
- `concat(left, right)`
    - If both arguments are numbers, returns their numeric sum. Otherwise formats each via `formatValue` (objects → name string, lists → joined string) and returns the string concatenation. Used by the emitter for all `+` expressions.
- `divide(a, b)`
    - Divides `a` by `b`. Returns `NaN` rather than throwing when `b` is zero.
- `makeList(items)`
    - Wraps a plain JS array in a Lamp list value `{ items, get first() }`. `.first` returns the first element or `null` for an empty list. Used by `type(...).all`, `queryRelationValue`, and native functions that return lists.
- `listItems(value)`
    - Normalizes any list-valued expression to a plain JS array for `for … in` iteration. `null`/`none` iterates as empty; raw arrays pass through. Throws if given a non-list non-null value.
- `registerActionRule(actionName, band, ruleFn, order?)`
    - Registers a phase-rule function into the named action's rulebook band. `band` is one of `"before"`, `"instead"`, `"check"`, `"do"`, `"after"`, `"report"`, or `"report_failed"`. `order` (0 author, 1 library; default 1) sorts author rules ahead of library rules. Used by the emitter for phase rule declarations; a multi-action selector rule emits one call per resolved action.
- `runAction(actionName, instance, opts?)`
    - Runs an action instance through its bands in order. A rule function that returns a value stops the action; `HALT` (a bare `stop`) halts the band; `undefined` falls through. On a `failed` outcome the `report_failed` band then runs. Returns `"succeeded"` if no rule stops. `opts.silent` (set by `silently try`) skips the `report` and `report_failed` bands. The `instance` carries the implicit `actor` and `action` fields alongside the declared slots.
- `registerRulebookRule(name, ruleFn, order?)`
    - Registers a rule function into a named rulebook's registry (used for both declaration-block rules and `rule NAME:` contributions). `order` (0 author, 1 library) sorts author contributions ahead of library rules.
- `runRulebook(name, args)`
    - Runs a named rulebook's registered rules in order, each called with `args` (the rulebook's argument values). Returns `{ stopped: true, value }` for the first rule that stops with a value, or `{ stopped: false }` if every rule falls through or a bare `stop` is hit. The emitted dispatcher function supplies the `default` when `stopped` is false.
- `registerGrammar(actionName, template)`
    - Registers a surface template string for an action with the Game Parser. Used by the emitter for each syntax line in an action declaration.
- `runCommand(line, actor)`
    - Parses `line` against registered grammar templates, resolves each slot to an in-scope object of the slot's declared type (or, for a **primitive-typed slot** — `int`/`real`/`string`/`text` — fills it from the matched input tokens directly: `int`/`real` require a single numeric token, a string/text slot takes the matched phrase verbatim; e.g. `press [n]` with `int n`), and runs the matched action. `actor` supplies the scope (actor's location contents and inventory). Prints `"I don't understand that."` on no match; `"You can't see any such thing."` on a failed slot resolve. The commanding actor is **passed in** — the Lamp-level `run_command(line, actor)` native threads it through (the advent loop passes `player`), so the runtime reads no `player` global itself. Before dispatching a fresh command it takes an **undo checkpoint** (see *State, undo, and save*); a registered **out-of-world** verb (`undo`/`save`/`restore`) bypasses the turn and takes no checkpoint.
- `registerScopeProvider(provider)`
    - Registers a `provider(actor, location)` that contributes extra in-scope objects, unioned into `scopeOf` after the containment sweep and before the fixpoint expansion (so a provided object's contained parts are pulled in too). Containment (`contains`) is the runtime's only built-in notion of presence; a provider supplies presence that isn't containment — e.g. advent's doors (present in two rooms, contained in neither), and later backdrops / `place-in-scope`. Mirrors `registerStateProvider`.
- `registerScopeBarrier(barrier)`
    - Registers a `barrier(container)` predicate — the complement of a scope provider. During `scopeOf`'s fixpoint expansion, before scope expands *into* an in-scope container's contents, every barrier is asked; if any returns true the container is **sealed** (its contents stay out of scope, though the container itself remains referable). Core never names a domain field; advent registers a barrier for **closed containers** (`container.closed`), so a shut box's contents can't be examined or taken until it opens. Pairs with advent's `contents_of`, which likewise returns empty for a closed holder so the contents are hidden from listings too.
- `registerRelationAddHandler(relationName, handler)`
    - Registers a handler called whenever a new instance of the named relation is asserted. The handler receives the new instance as its argument (`self`). Used by the emitter for `on RELATION add:` blocks.
- `registerRelationRemoveHandler(relationName, handler)`
    - Registers a handler called whenever an instance of the named relation is removed. The handler receives the removed instance as its argument (`self`). Used by the emitter for `on RELATION remove:` blocks.
- `setInputChannel(requestLine)`
    - Installs the input callback used by `readLine()`. Called by the sandbox launcher to wire the worker's blocking-input bridge before the game starts.
- `readLine()`
    - Requests one line of player input via the installed input channel. Throws if no channel has been installed (i.e., outside the sandbox).
- `setBuildId(id)`
    - Records the build fingerprint Lantern stamps at the top of every generated module — a content hash over the compilation source inputs (invariant under `--encode-strings`). Gates save compatibility (see below).

#### State, undo, and save

The runtime can capture and restore the **mutable game state**, which powers
UNDO (in-memory) and SAVE/RESTORE (state serialized to storage on the same
mechanism). Full design in `devdocs/state.md`; the contract in brief:

- **What is state.** Object **field values**, **relation edges**, **global
  values**, and the pronoun antecedent. Schema, rules, handlers, and grammar are
  load-time program structure and are *not* snapshotted (they come from re-loading
  the module). Every value is a member of the closed algebra **scalar | object
  reference | list**; references are encoded by object name.
- **Extensibility.** State is captured by a **state-provider registry**, not a
  hardcoded list. New mutable state is captured by registering a provider — the
  snapshot core is never edited. New fields/globals/relations are captured
  automatically by the built-in providers.
- **API.** `captureState()` → a plain JSON-able snapshot; `restoreState(snap)`
  overwrites instance fields **in place** (preserving object identity; no change
  handlers fire) and rebuilds the vocab index. `registerStateProvider({ key,
  capture, restore })` adds a provider. `clearUndoHistory()` empties the undo
  stack.
- **UNDO.** `runCommand` checkpoints before each fresh turn; the **`undo`**
  out-of-world verb pops and restores. Depth is the author-settable **`undo_limit`**
  global (default 32; `0` disables), read fresh each checkpoint like `oxford_comma`.
- **SAVE / RESTORE.** `captureSave()` wraps a snapshot in a versioned header
  `{ format, buildId, gameName, gameAuthor, savedAt, state }`. `restoreSave(save)`
  checks format → game → version and **never restores on a mismatch** (a
  cross-build restore can corrupt a name-keyed world), returning
  `{ ok }` / `{ ok:false, reason }`. The host injects storage via
  `setSaveChannel({ write, read })`; the **`save`**/**`restore`** out-of-world
  verbs prompt for a named slot. Build compatibility is gated on the `buildId`
  hash, not the author-facing `version`/`release` (which stay display-only).

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

The following words are **reserved** and may not be used as a name (object, type, kind, global, field, event, or local): `type`, `kind`, `global`, `on`, `for`, `in`, `while`, `if`, `else`, `let`, `print`, `error`, `dispatch`, `break`, `lib`, `locale`, `not_for_release`, `from`, `to`, `step`, `change`, `function`, `native`, `freeze`, `return`, `when`, `and`, `or`, `not`, `relation`, `bidi`, `remove`, `disconnect`, `rulebook`, `stop`, `follow`, `action`, `try`, `verb`, `move`, `mod`, `div`. (`mod` and `div` are the integer remainder / floored-division operators. `freeze EXPR` forces a `text` value to a `string`; see the `text` primitive type. `verb WORD, …` registers conjugation-sugar words for text substitution; see the `text` type. `syntax`, `inverted`, and `unique` are contextual keywords recognized only inside a `relation` body; `tags`, `out_of_world`, and `world_scope` are contextual only inside an `action` body; `default` is a contextual keyword recognized only inside a `rulebook` body; the band words `before`, `instead`, `check`, `do`, `after`, and `report` are contextual keywords recognized only as the leading token of a phase rule; `any` and `except` are contextual only in a phase-rule action selector; `rule` is contextual only when followed by a declared rulebook name; `silently` is contextual only immediately before `try`; `understand` and `as` are contextual only in a top-level `understand "TEMPLATE" as ACTION` grammar contribution; none of these are globally reserved.) A reservation applies only to a whole identifier: a reserved word appearing *inside* a longer identifier is unrestricted, so `move_to_room` (which denotes the name `move to room`) is a valid identifier even though `to` is reserved.

### Objects and types

#### Object declarations

```lamp
TYPE_NAME OBJECT_NAME:
    FIELD_NAME VALUE
    ...
```

`TYPE_NAME OBJECT_NAME:` declares an object named `OBJECT_NAME` of type `TYPE_NAME`. A trailing `:` starts the body. Each indented line is a field assignment `FIELD_NAME VALUE`. A `VALUE` is a literal (number, double-quoted string, `true`, `false`, or `none`) or an object reference written as an identifier. Free text containing spaces is written as a quoted string; multi-word object names use the underscore convention described in Names and identifiers.

A field line may omit the value entirely as a **boolean shorthand**: a bare `FIELD_NAME` (a field name with no value) means `FIELD_NAME true`. This is intended for flag fields — `wearable` is `wearable true`. The bare form on a non-boolean field is a type error (the implied `true` fails the field's value-compatibility check), so it is only useful for `bool` fields.

**Unset field values.** A field an object does not set takes its type's declared default if one was given (`string description = "n/a"`), else a **primitive zero**: `string` → `""`, `int`/`real` → `0`, `bool` → `false`. So an unset string reads as the empty string (printing nothing), never the literal `undefined`. Reference-typed fields (an object type, `list<T>`) have no zero — an unset reference is `none`, and a type that needs to distinguish "not yet set" declares an explicit `= none`.

```lamp
item velvet_cloak:
    description "A handsome cloak."
    wearable          # same as `wearable true`
```

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

#### Nested object declarations (containment)

Inside an object body, a line whose leading token is a **declared type** that is **not** a **field name** places a **nested object** inside the enclosing object via the `contains` relation. It is sugar for declaring the object at top level and asserting `contains ENCLOSING NAME`:

```lamp
room Cloakroom:
    description "A small cloakroom."
    item hook:
        description "A small brass hook."
        scenery true
    item lamp:
        description "A shiny brass lamp."
```

is exactly equivalent to:

```lamp
room Cloakroom:
    description "A small cloakroom."

item hook:
    description "A small brass hook."
    scenery true
item lamp:
    description "A shiny brass lamp."

contains Cloakroom hook
contains Cloakroom lamp
```

The nested object is hoisted to top level (its name is globally referenceable, like any object — forward references work), and a `contains` placement is emitted. Nesting may recurse (an object nested in an object nested in a room). The enclosing program must have a `contains` relation in scope (e.g. via `lib advent`); the placement uses its two slots, container first.

**Smart disambiguation.** A nested-placement line and a field assignment are both `TOKEN VALUE`; they are told apart by whether the leading token is a **type name** vs. a **field name**. A token that is both (e.g. `article` is a type *and* a field on `physical`) is treated as a **field**, so `article proper` sets the `article` field rather than placing a `proper`. (Edge case: a type whose name is also used as a field name somewhere cannot be nested by this rule — give it a body or place it with a top-level `contains`.)

**With or without a body.** A nested line may carry a `:` body (declaring a fresh object, which may nest further) or be **bodyless**:

```lamp
room vault:
    item chest:           # bodied — a fresh nested object
        item marble       # bodyless — a fieldless nested object
    item lantern          # bodyless — a reference to an object declared elsewhere
```

A bodyless `TYPE NAME` emits an *empty* declaration plus the placement; **object reopening** (below) then merges it with the object's real declaration if one exists elsewhere — so the same form serves both a **fieldless leaf** (no other declaration) and a **reference** to an existing object (merges into it; the type must agree). (An empty `:` body is not allowed — use the bodyless form for a fieldless object.)

#### Reopening an object

An object may be declared in **more than one block** with the same name; the blocks **merge** into a single object. This is the instance-level analogue of reopening a type, and works across files — a game can reopen an object a library defines (e.g. advent's `yourself`) to add fields or nested objects:

```lamp
person yourself:          # adds to advent's `yourself`, does not redeclare it
    item hat:
        description "A hat."
        wearable
```

Rules:
- **The type must agree.** Every block declaring a given name must use the same `TYPE`; a mismatch (`item yourself:` when `yourself` is a `person`) is a compile error.
- **Fields union, last-wins.** Disjoint fields combine. A field set in more than one block takes the **last** value in source order; because libraries are compiled before the user file, a game's reopen **overrides** a library object's field (parallel to global override).
- Nested objects (above) contributed by any block are placed in the merged object.

There is no separate keyword: any second `TYPE NAME:` block with an existing name reopens it. (Beware that an accidental duplicate name therefore merges rather than erroring.)

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
- `string` — string values; literals are written in double quotes: `"hello"`.
  Backslash escapes are resolved by the tokenizer: `\"` (double quote), `\n`
  (newline), `\t` (tab), `\r` (carriage return), `\\` (literal backslash), and
  `\u{HEX}` (a Unicode code point, 1–6 hex digits — `\u{e9}` → "é",
  `\u{1f600}` → an emoji). Any other `\X` (including a malformed `\u{…}`) is left
  as-is (the backslash is kept), so a stray backslash in prose is never lost.
  A literal may span **multiple source lines**: a `"` that is not closed on its
  line continues until the next unescaped `"`, with each source newline becoming a
  literal newline in the value. Inside a multi-line literal, `#` is content (not a
  comment) and blank lines are preserved. The continuation lines are **dedented** —
  their common leading whitespace is stripped — so prose can be indented under the
  statement for readability without that indentation appearing in the value (the
  first line, being the text after the opening quote, is left as written; blank
  lines are ignored when measuring the common indent, and any indentation beyond the
  common amount is kept). A string literal used as a **value** (a `print`/`let`/field
  or global default/argument/return — *not* a grammar/`syntax`/`understand`
  template, whose `[slot]` markers stay literal) also gets two transformations:
  - **Quote convention** (Inform-style): a `'` flanked by letters/digits on both
    sides is an apostrophe and stays (`don't`); any other `'` is a typographic
    double quote, so `'hello'` renders as `"hello"`. Write `[']` to force a literal
    apostrophe where the rule would otherwise convert.
  - **Text substitution**: an unescaped `[EXPR]` embeds a Lamp expression. A literal
    with at least one substitution is a **`text`** value (below), not a `string`;
    write a literal bracket as `\[` / `\]`. An empty `[]` or an unterminated `[` is
    a compile error.
- `text` — a **lazily-rendered template**: the value of a string literal that
  contains `[EXPR]` substitutions. Rendering (on `print`, on `freeze`, or when
  embedded in another template) interleaves the literal segments with each
  expression rendered as `print` would render that value — an object as its `name`
  (or its `printed_name` field when set), a list as its prose, a number as digits.
  A `text` is **lazy**: its substitutions re-evaluate every time it renders, so a
  stored `text` reflects current state. `text` and `string` interoperate (a `text`
  satisfies a `string` position and renders on output); **`freeze EXPR`** forces a
  `text` to a concrete `string` snapshot (the value at that moment). A `text` is a
  transient/computed value (like a function): it is not a member of the save-state
  algebra, so a stored `text` is **frozen to its current string when captured** for
  undo/save (see `devdocs/state.md`). Text substitution is the foundation of the
  text-generation system — see `devdocs/text.md`.
  - **Natural-language sugar (locale layer).** Inside a substitution, bare words are
    rewritten to `lib/en-US` calls: an article `[the X]`/`[a X]`; the **player**
    pronouns `[We]`/`[us]`/`[our]`/`[ours]` (rendered by the story viewpoint —
    person + number, default 2nd singular → "you"; the globals
    `viewpoint_person`/`viewpoint_plural` change it); the **subject** pronouns
    `[They]`/`[them]`/`[their]`/`[theirs]`/`[themself]` (a third-person referent set
    by `[regarding EXPR]` or by naming a thing); and a verb `[drop]`/`[are]`
    (conjugated against the current agreement). Naming a thing switches the agreement
    onto it (so a verb after `[the cloak]` agrees with the cloak); `[We]`/`[They]`/
    `[regarding EXPR]` reset it. `[regarding EXPR]` sets the subject and renders empty
    (a decorative leading article — `[regarding the player]` — is stripped).
  - **Inline conditionals.** `[if COND]…[else if COND]…[else]…[end]` choose between
    branches by a Lamp boolean `COND`; `[otherwise]` is an `[else]` alias and `[end
    if]` an `[end]` alias. A branch may contain its own substitutions. **Nesting a
    `[if]` inside a branch is not allowed** (the `[else]`/`[end]` pairing would be
    unreadable without indentation); compose a separate `text` value and interpolate
    it instead. Conditionals are valid only inside a string-literal template (not as
    a standalone expression). Unbalanced markers are a compile error.
  - **First-time text.** `[first time]…[only]` renders the enclosed text the first
    time that site is reached and nothing afterward. The per-site visit state is
    durable — captured in snapshots — so it survives `undo`/`save`/`restore` (a
    restored game does not re-show the block). Like the conditional blocks, a
    `[first time]` cannot nest inside another block; `[only]` without a matching
    `[first time]` (or vice versa) is a compile error.
  - **Variation.** `[one of]ALT[or]ALT…[MODE]` renders one alternative per render,
    chosen by the closing mode: `[cycling]` (in order, wrapping), `[stopping]`
    (advance then stick on the last), `[at random]` (uniform, never the
    immediately-previous), `[purely at random]` (independent uniform), `[in random
    order]` (shuffled, no repeat until exhausted), `[sticky random]` (random once,
    then fixed). An alternative may contain its own substitutions. The random modes
    draw from a seeded RNG; both the RNG stream and the per-site cursors are durable
    (captured in snapshots), so `undo`/`save`/`restore` reproduce the sequence. Like
    the other blocks, `[one of]` cannot nest; `[or]` or a mode word without a
    matching `[one of]` is a compile error. A further mode `[as decreasingly likely
    outcomes]` is a weighted draw (the first alternative most likely). The function
    form **`pick(LIST, MODE)`** chooses among a computed list's elements by the same
    modes (`MODE` optional, default no-repeat random); it returns one element. RNG
    control: **`seed_random(n)`** reseeds reproducibly, **`randomize()`** seeds from
    entropy for cross-playthrough variety (the default seed is fixed, so output is
    deterministic until a game opts in). **`random(n) → int`** draws a uniform integer
    in `[0, n)` from the same seeded, save-captured stream (so a draw reproduces across
    restore); `n < 1` yields `0`. It is the general randomness primitive — build dice and
    the like in Lamp on top of it. **`shuffle(list)`** shuffles a list into a uniformly
    random order **in place** (Fisher-Yates on the same seeded stream, so it reproduces
    across restore); it is a native rather than Lamp because it is generic over the element
    type (Lamp has no generics — cf. `map_strings`). These read a
    **render-local context** that resets per render and is never saved. The
    world-model→locale contract for a referent is the optional fields
    `grammatical_person` (1/2/3, default 3), `gender` ("male"/"female"/"neuter"), and
    `plural`; the player object sets `grammatical_person 2`. See `devdocs/text.md` D.
- A **`verb` declaration** — `verb WORD, WORD, …` at top level — registers
  conjugation-sugar words so a template `[drop]` is rewritten to a `conjugate("drop")`
  call rather than read as an object reference. It has no runtime effect (the
  conjugation rules live in the locale's `conjugate()`); the locale ships the
  default verbs and a game adds its own. A word may itself be a keyword (`verb do`).
- `int` — integer values; literals are plain digits: `42`, `-7`
- `bool` — boolean values; literals are `true` and `false`
- `real` — floating-point values; literals require a decimal point: `3.14`, `-0.5`
- `list<T>` (generic list of elements of type `T`). A list value exposes the
  accessors `.first` (the first element, or `none` if empty, type `T`) and
  `.size` / `.count` (the element count, type `int`). These work on a list-typed
  name (`stuff.size`) and on a computed value — a parenthesized expression
  (`(connects here _ ?all).size`) or a function-call result (`holder(p).lighted`) — the
  latter being **postfix field access**: a `.field` chain may follow a `(…)` group or a
  `name(args)` call, not only a bare name. The locale provides
  `a_list(xs)` / `the_list(xs)` (render a list with indefinite / definite articles)
  and `is_empty(xs)`. Count-driven copula agreement (G3): `are(n)` returns "is"/"are"
  by a raw count (singular only at exactly 1), and the sugar `[is LIST]` /
  `[is the LIST]` / `[is a LIST]` (capitalized `[Is …]`) renders the copula agreeing
  with the list's size — empty and singular both "is" — followed by the list with
  no / definite / indefinite articles.

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

#### Relation add/remove handlers

```lamp
on RELATION_NAME add:
    STATEMENT
    ...

on RELATION_NAME remove:
    STATEMENT
    ...
```

Defines a handler that runs whenever an instance of the named relation type is asserted (`add`) or removed (`remove`). Inside the body, `self` is the relation instance being added or removed.

```lamp
on connects add:
    print "A new connection was made."

on connects remove:
    print "A connection was removed."
```

Multiple handlers for the same relation are all called in registration order.

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
- A relation query contributes one point per non-wildcard slot: `connects foyer north hall` scores 3; `connects foyer _ _` scores 1; `connects _ _ _` scores 0.
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
- `when` conditions may reference globals, object properties, and relation queries — not parameters, local variables, or function calls.

### Relations

A **relation** is a typed, directed edge connecting objects in the game graph. A relation type declares a set of fields (its endpoints and any extra data); a relation *instance* connects specific objects according to that type. Relations are the basis for graph-structured state such as room connectivity.

The full relation design and roadmap live in `devdocs/relations.md`. This section specifies the behavior implemented so far.

#### Relation type declarations

```lamp
relation TYPE_NAME:
    from ENDPOINT_TYPE SOURCE_FIELD_NAME
    to ENDPOINT_TYPE TARGET_FIELD_NAME
    FIELD_TYPE FIELD_NAME [inverted] [unique]
    ...
    syntax "TEMPLATE"
```

`relation` declares a relation type — a directed **binary** edge. Every relation must have exactly one `from`-prefixed field (the source endpoint) and one `to`-prefixed field (the target endpoint). These prefixes fix the relation's canonical orientation; the field names themselves are user-chosen. Any number of additional labelled fields may follow (`FIELD_TYPE FIELD_NAME`), each optionally tagged `inverted` and/or `unique` (in either order; the `from`/`to` endpoint fields may also carry these tags). The optional `syntax` line gives a custom assertion template (see below).

A field tagged **`unique`** is a **cardinality key**: at most one edge may exist per distinct value of that field. Asserting an edge whose value in a unique field equals an existing edge's **evicts** the prior edge (firing its remove handlers and unregistering any name) before inserting the new one. Tagging the `to` endpoint `unique` therefore models a **one-to-many** relation — many sources may share a target's slot over time, but each target participates in at most one edge at once (e.g. `contains`: an object is in exactly one place). Each unique field is an independent key; the early-return deduplication still applies, so re-asserting an identical edge is a no-op and does not self-evict.

`from` and `to` are **globally reserved keywords** and cannot be used as object names, field names, or variables. `syntax`, `inverted`, and `unique` are contextual keywords: they are special only inside a `relation` body and are otherwise ordinary identifiers.

```lamp
relation connects:
    from room source
    direction dir inverted
    to room target
    syntax "connects [source] [dir] [target]"

relation wears:
    from person wearer
    to item worn
    syntax "wears [wearer] [worn]"
```

A relation type participates in the universal `all` field: `connects.all` is the list of all instances of that relation.

Canonical orientation is established for every relation, not just bidirectional ones; it is what lets one relation be compared to another (e.g. a future rule deriving `older_than(a, b)` from `father(a, b)`). n-ary "group" relations are not yet supported.

#### Bidirectional relations

The `bidi` modifier asserts a relation that is traversable from either endpoint as a **single** instance (not two):

```lamp
bidi connects foyer north hall
```

The reverse direction is the relation's **mechanical inverse**: swap the `from` and `to` endpoint fields, replace each `inverted` field with its value's own inverse, and copy the rest. An `inverted` field's type must declare an `inverse` field of that same type (so `direction dir inverted` requires `direction` to have a `direction inverse` field, with values like `north.inverse = south`). Asserting the reverse edge of a `bidi` instance deduplicates against it, and `bidi` over an existing one-way instance upgrades it in place.

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

#### Moving an object (`move`)

```lamp
move CONTAINED to CONTAINER
```

`move X to Y` relocates `X` into `Y`. Both operands are full expressions (object references, property-access chains such as `self.taken`, or query results). It is the author surface for **containment**: it desugars to an assertion of the world-model `contains` relation (`Y` as the container/source endpoint, `X` as the contained/target endpoint). Because `contains` tags its target endpoint `unique`, the assertion automatically evicts `X`'s previous container — so a move is a single statement with no explicit removal, and the old container's `contains remove` handler fires before the new one's `contains add`. `move` may appear at the top level or inside event handlers, change handlers, and function bodies. (`move` is a reserved keyword; the `contains` relation is the runtime↔world containment contract — see `devdocs/world-model.md`.)

#### Printing relation instances

A relation instance with a name prints as its name. An anonymous instance prints as its type name followed by a parenthesized, declaration-order field summary, with object-valued fields shown by name:

```
connects(foyer, north, hall)
```

### Rulebooks

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

#### Contributing rules to a rulebook

A `rulebook` declaration fixes the rulebook's signature (name, parameters, result
type) and its `default`, but its rules need not all live in the declaration
block. Any file may add a rule to an existing rulebook with the leading form:

```lamp
rule RULEBOOK_NAME [when CONDITION]:
    STATEMENT
    ...
```

`rule` is the named-rulebook analogue of a phase rule. The rulebook's parameters
are in scope in the guard and body; `stop EXPRESSION` stops the rulebook with that
value; a bare `stop` (or falling through) yields the `default`. The `when` guard
is optional — a contribution without one always runs. The canonical use is a
library rulebook a game extends, e.g. advent's `startup_rules`, to which a game
contributes its opening text:

```lamp
rule startup_rules:
    print "Hurrying through the rainswept November night…"
```

Like phase rules, contributions from the **author file** run before a library
declaration's own rules (order 0 vs 1); within a tier, source order holds. `rule`
is a contextual keyword, recognized only when immediately followed by a declared
rulebook name (collected in the pre-scan). The contribution set is fixed at
compile time — there is no runtime insertion or removal.

#### Deferred (not in this surface)

Designed in `devdocs/rulebooks.md` but intentionally outside the initial surface:
named rules (for replacing one specific library rule); group/`order` ordering
constraints; `void` rulebooks; and any runtime mutation of rulebooks.

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

An action body may also include a `syntax:` block of quoted surface templates
that the Game Parser matches player input against. In a template, `[slot]` binds
the matched words to that slot; every other token is a literal. (`syntax` is a
contextual keyword inside an action body.)

```lamp
action take:
    item taken
    syntax:
        "take [taken]"
        "get [taken]"
```

A top-level `understand "TEMPLATE" as ACTION` contributes one additional surface
template to an action **declared anywhere** (including a library action), without
redeclaring it. The action must already be declared, and each `[slot]` in the
template must name one of that action's slots; both are checked at compile time.
This lets a game add a verb phrasing for a library action — e.g. giving the
generic `put_on` action a game-specific `hang … on …` phrasing:

```lamp
understand "hang [put_item] on [destination]" as put_on
```

(`understand` is contextual: at top level followed by a string it is this
declaration; inside an object body, `understand "n"` is an ordinary field
assignment.) It emits a single `registerGrammar` call — the same one an action's
own `syntax:` line emits — so the two are equivalent at runtime.

#### Running commands

`run_command(line)` (a built-in native function) parses one line of player input
against the registered action templates, resolves each slot to an in-scope object
of the slot's type, and runs the matched action. The typical game loop reads a
line and passes it to `run_command`. Scope is the actor's location contents and
inventory (via the `holder` field); the actor is the `player` global. This is the
Game Parser v0 (`devdocs/game_parser.md`); adjectives, pronouns, disambiguation,
and multiple objects are not yet handled.

```lamp
on startup:
    while true:
        let line = readline()
        if line == "quit":
            break
        run_command(line)
```

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

`stop failed` may carry an optional stop reason:

```lamp
stop failed REASON
```

`REASON` is any object of a `stop_reason` type (an open type whose instances are
declared like ordinary objects: `stop_reason not_carrying`). When a `stop failed
REASON` halts the action, the reason is stored in `self.reason` on the action
instance and is available to the `report failed` band.

A seventh band, **`report failed`**, runs only when the action outcome is
`failed`. It is declared like any other band:

```lamp
report failed take:
    if self.reason == not_carrying:
        print "You're not carrying that."
        stop
```

`self.reason` holds the stop reason passed to `stop failed`, or `none` if no
reason was given. A bare `stop` inside a `report failed` body suppresses further
`report failed` rules (identical to `stop` behavior in other bands). If no
`report failed` rule fires, the failed action produces no output.

#### Implicit slots: `actor` and `action`

Beyond its declared slots, every action instance carries two implicit fields:

- `self.actor` — the acting person (set by the game loop; overridable in a nested
  `try`, see Running an action).
- `self.action` — the name of the action being run. It compares against a bare
  action name, so a rule that spans several actions can branch on which fired:
  `if self.action == go: …`.

#### Out-of-world actions

An action body may carry an **`out_of_world`** line (a contextual keyword, like `syntax`):

```lamp
action score:
    out_of_world
    syntax:
        "score"

report score:
    print "Your score is [points]."
```

An out-of-world action runs normally — its bands fire and it prints — but it **bypasses
the turn clock**: it spends no turn, takes no undo checkpoint, and does not advance the turn
count, so the command loop's **every-turn rules do not fire** for it (`run_command` returns
`false`). This is the model for meta and debug verbs (SCORE, and library debug commands like
SHOWME/GONEAR) — commands that inspect or adjust the session rather than act in the world.
The meta-verbs `undo`/`save`/`restore` are themselves `out_of_world` actions (in
`lib/advent/save.lamp`, over runtime primitives) — there is no separate built-in meta-verb
table; every command resolves through the grammar. An `out_of_world` action also carries
full grammar and slots, so it can take operands (`showme [target]`). Distinct from a
*failed* in-world command (a parse failure or a refused action also spends no turn, but is
in-world); `out_of_world` declares the action's nature.

An action body may also carry a **`world_scope`** line (a contextual keyword): its object
slots then resolve against **every object in the world** (all `physical` instances), not
just the actor's scope — so the verb can name a thing that is out of sight, sealed in a
closed container, worn by someone, or in another room. (Normal actions resolve only what is
in scope, so `examine [thing]` can't reach those.) This is the model for debug verbs that
manipulate or inspect arbitrary objects (**PURLOIN [thing]** moves any item into the
player's hands; **SHOWME [thing]** dumps an object's type, location, fields, and contents;
**GONEAR [room-or-thing]** teleports the player to a room, or to the room enclosing a thing;
**TREE** dumps the whole world's containment tree; **SCOPE** lists what is in the player's
scope right now). advent ships these in `lib/advent/debug.lamp` as `out_of_world` (and, where
they name a thing, `world_scope`) actions, in `lib/advent/debug.lamp` (marked
`not_for_release`, so a `--release` build excludes them). The two modifiers
are independent — an action may carry either, both, or neither.

#### Action tags

An action may declare one or more **tags** with a `tags` line in its body
(comma-separated; `tags` is a contextual keyword, like `syntax`):

```lamp
action take:
    item taken
    tags manipulation, theft
    syntax:
        "take [taken]"
```

Tags are not pre-declared — the set of valid tags is the union of every `tags`
line across all actions. They exist to name a *set* of actions for a selector
(below).

#### Action selectors — rules spanning a set of actions

A phase rule's action position accepts a **selector** instead of a single action
name: a compile-time boolean expression over *atoms*, where each atom denotes the
set of actions it names. This collapses a rule that should apply uniformly across
many actions into one declaration.

| Atom / operator | Denotes |
|---|---|
| `any` | every declared action (the universe) |
| an action name (`take`) | that one action |
| a tag name (`manipulation`) | every action carrying that tag |
| `a and b` | intersection |
| `a or b` | union |
| `not a` | complement |
| `a except b` | sugar for `a and not b` |
| `( … )` | grouping |

Precedence, lowest to highest: `or`, then `and`/`except`, then `not`/atom. There
is **no comma sugar** (write `take or drop`, not `take, drop`); exclude several
actions by chaining `except` or grouping.

```lamp
instead any except go except look when self.actor.holder == bar and in_darkness(self.actor):
    print "In the dark? You could easily disturb something."
    stop failed
```

The selector is resolved to a concrete action set **at compile time** and the
rule is expanded to one registration per action, each carrying the same band,
guard, body, and source position. A selector that resolves to the empty set, or
names an atom that is neither a declared action nor a known tag, is a compile
error. `any` and `except` are contextual keywords, recognized only in selector
position.

A multi-action rule's `self` may only reference slots that **every** targeted
action has — in practice the universal `actor`, `action`, and (in `report
failed`) `reason`. Referencing an action-specific slot that is not present on
every action in the set is a compile error; write a single-action rule for
behaviour that needs such a slot.

#### Running an action

```lamp
try ACTION:
    SLOT_NAME VALUE
    ...
```

`try` constructs an action instance with the given slot values and runs it
through the bands. Slot values may be literals, bare object references, or
property-access expressions (e.g. `self.actor`, `self.clothing`).

`try` used as a **statement** runs the action and discards the outcome:

```lamp
try take:
    taken lamp
```

`try` used as an **expression** produces the action's outcome — either the
string `"succeeded"` or `"failed"` — and may be bound with `let`:

```lamp
let result = try take:
    taken self.clothing
if not (result == succeeded):
    stop failed
```

**`actor` override**: every action instance carries an implicit `actor` field set
by the game loop. Inside an action body, a nested `try` block may specify `actor`
explicitly to run the inner action on behalf of a different actor, even when
`actor` is not declared as a slot on the inner action:

```lamp
try take:
    taken self.clothing
    actor self.actor
```

**`silently try`**: prefixing a `try` with `silently` runs the inner action
through the `before`/`instead`/`check`/`do`/`after` bands but **skips its
`report` and `report failed` bands**, suppressing its player-facing output. This
is for implicit sub-actions whose own messages would be noise — e.g. hanging a
worn cloak silently takes it off first, without printing "You take off the
cloak." `silently` is a contextual keyword recognized only immediately before
`try`, in both the statement and `let x = silently try …` expression forms.

```lamp
silently try doff:
    clothing self.carried
    actor self.actor
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

- **For-each loop** — iterates over the elements of a list, in order:

```lamp
for VAR in LIST_EXPRESSION:
    STATEMENT
    ...
```

`LIST_EXPRESSION` must have a `list<T>` type (for example `room.all`, an object's `list<T>` field, or a function returning a list such as `split(...)`); `VAR` is a new local of element type `T` scoped to the loop body. Iterating `none` runs the body zero times. A non-list expression is a compile error. The leading-token disambiguation between the counted and for-each forms is the token after `VAR`: `=` selects the counted loop, `in` selects the for-each loop.

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

- **Integer division and remainder** — `div` and `mod` are **keyword** operators (in the readable-word family with `and`/`or`/`not`):

```lamp
17 div 5   # 3   (floored integer division)
17 mod 5   # 2   (remainder)
```

Both take numeric operands and produce `int`. They use **floored** semantics: the result of `mod` takes the divisor's sign (so `(0 - 7) mod 3` is `2`), and the identity `a == (a div b) * b + (a mod b)` holds. Division or remainder by zero yields `0`. They have the **same precedence as `*` and `/`** (so `a mod b + c` is `(a mod b) + c`) and are left-associative. `mod` and `div` are reserved words.

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

- **List literal** — `[E0, E1, …]` constructs a list value from element expressions (`[]` is the empty list). The element type is inferred from the elements (`[1, 2, 3]` is `list<int>`). In prefix position `[` opens a literal; in infix position it is indexing, so the two never collide.

```lamp
let primes = [2, 3, 5, 7]
nums = [10, 20, 30]
```

- **List indexing** — `LIST_EXPRESSION[INDEX]` retrieves the element at a zero-based integer index:

```lamp
let words = split(line)
let first_word = words[0]
```

Indexing into an out-of-bounds position returns `undefined` (no runtime error). (A `[…]` index inside a **text substitution** is not yet supported — the substitution scanner matches the first `]`; bind to a `let` first.)

- **Element assignment** — `TARGET[INDEX] = VALUE` mutates one element of a list in place. The target resolves to a list (a local or a list-typed global/field); the mutation is durable (captured by undo/save):

```lamp
nums[0] = 99
order[i] = order[j]
```

- **Follow expression** — `follow NAME(args)` invokes a rulebook and produces its result value (see Rulebooks):

```lamp
follow reachable(brass_lamp)
```

## Implementation notes

### Compiler pipeline

Lantern compiles in three passes:

1. **Pre-scan** (`index.js` + `prescan.js`): each file is tokenized **once**; `prescanDeclarations` walks that token stream (sharing the tokenizer's comment/string handling) to collect declared global names, function names, relation names, action names, object names, action tag names, rulebook names with their parameter names, and relation syntax templates — so the parser can resolve bare identifiers and recognize tag/selector/`rule`-contribution heads before full parsing. (The earlier per-line regex prescan was replaced; see `devdocs/architecture.md` issue A.) Also scans each library directory for `index.js`; if present, inlines the raw native JS and extracts its **top-level** function names via `native_scan.js` — a JS surface scanner that skips comments, strings, template/regex literals, and tracks brace depth (issue B) — for `native function` resolution.
2. **Parse** (`parser_rd.js`): parse each file into an AST using the collected global and function names so that bare identifiers in expressions are resolved correctly.
3. **Check** (`checker.js`) + **emit** (`emitter.js`): semantic check then emit standalone Node.js JavaScript.

**Optional string encoding (`--encode-strings`).** When this flag is passed, the emitter wraps player-facing strings as `lamplighter.decode("…")` over an encoded payload instead of plain JS string literals. Encoded: prose/value literals (via `emitValue`/`emitExpression` and type-level field defaults); **object, global, action, type, and relation names** at *every* emission site, routed through the shared `emitName`/`emitFieldSchema`/`emitNameList` helpers — `createObject`/`getObject`/`objectRef`/`checkedGetObject`; `defineGlobal`/`setGlobal`/`getGlobal`; `registerGrammar`/`registerActionRule`/`runAction` (action name + the instance's `type`/`action` values); `defineType` (name, parent list, and the field schema's type-name *values*); `lamplighter.type(...)` constants; `defineRelation` (name + field-type values); `addRelation`/`removeRelation`/`queryRelation`/`queryRelationValue`; and `registerChangeHandler`/`registerRelationAddHandler`/`registerRelationRemoveHandler`; and **grammar templates** (`registerGrammar`) and **relation syntax templates** (`defineRelation`), the player-visible command phrasing. All of these are registry/dispatch keys, but encoding is behavior-preserving because `decode` runs at load: every registration and lookup decodes to the same plaintext key at runtime (the broad equivalence corpus in `tests/encode` guards this). The `emitFieldSchema`/`emitNameList` helpers fall back to verbatim `JSON.stringify` in plaintext mode. This is behavior-preserving because `decode` runs at load: object/global names are registry keys, but the runtime key is the decoded plaintext, identical to the plaintext build, so lookups and `===` identity are unchanged. Left plaintext: **kind names and enum labels** (`defineKind`/`enum`), **rulebook and event names** (`registerRulebookRule`/`onEvent`), and **field/property keys** (encoding keys would require dynamic property access); the JS `const <name>` bindings stay plain identifiers (minify mangles them). Strings inside inlined native `index.js` are not touched — the emitter does not parse native JS — so a native library that references a name or prints text by literal (e.g. `getGlobal("player")`, `type("item")`) still leaks it; those plaintext lookups continue to resolve precisely because the encoded registrations decode to the same keys. The shared codec (`src/strcodec.js`, XOR + base64) is reversible by design: its purpose is only to make spoilers inconvenient for a casual reader of a shipped bundle, **not** to provide security — the decoder and key ship together. Strings inside inlined native `index.js` are not touched (the emitter does not parse native JS). The flag is off by default (readable output for development); Lighthouse turns it on for distribution builds.

**Release builds (`--release`) and `not_for_release`.** A whole `.lamp` file may declare
itself debug-only with a top-level **`not_for_release`** directive (a keyword on its own
line, like `locale`). In a normal build the directive is inert (the file compiles as usual);
a **`--release`** build **excludes** every file carrying it. The compiler detects the
directive from the token stream and drops those files before parsing, so their declarations
(verbs, rules, objects) never enter the program — and the build fingerprint is computed over
the *included* files only (a release build is a distinct build). This is the Lamp analogue
of Inform's NOT-FOR-RELEASE sections: advent's debug verbs live in `lib/advent/debug.lamp`
(marked `not_for_release`), so a shipped game built with `--release` can't be cheated past
puzzles with PURLOIN/GONEAR/etc.; a game's own debug shortcuts go in its own
`not_for_release` file (e.g. `sample/phobos/lib/phobos/debug.lamp`). The flag is off by
default for the bare compiler and for `lantern-exe` (which forwards compile flags), so debug
verbs are available during development; **Lighthouse (`build:web`) builds release by default**
(a web bundle is a distribution build — `--debug` opts back in), so the Pages deploy ships
without debug verbs.

The emitted program is a body-only module that assumes `lamplighter` is already available as a context global (injected by the sandbox launcher). It is prefixed with a single `lamplighter.setBuildId("…")` call carrying the build fingerprint (a content hash of the source inputs, used to gate save compatibility). It then runs in this order: `bootstrapBuiltins()` → native JS (inlined from `index.js` files) → kinds → kind constants → types → type constants → objects (primitive/kind fields only) → object-typed field assignments → top-level relation assertions/removes → global declarations → global assignments → function definitions → rulebook definitions (each a dispatcher function plus a `registerRulebookRule` call per declaration-block rule) → event handler registrations → change handler registrations → phase rule registrations (a selector rule expands to one registration per resolved action) → rulebook rule contribution registrations → grammar registrations → relation add/remove handler registrations → `run()`. Globals and object-typed field assignments are placed after all `createObject` calls so that any `lamplighter.getObject(...)` reference resolves against an already-registered instance regardless of declaration order. Function definitions are emitted before event handler registrations so they are in scope when handlers run.

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
- Enum-kind fields reject labels outside the enum definition. This applies to
  both field values and type-field defaults (`reltype release = dev` is accepted;
  an unknown label is a compile error).
- Expression inference covers literals, local variables, property-access chains (including `.all` → `list<T>` and `.first` → `T`), `+`, `*`, `==`, `<`, and `>`. Globals and object name references currently return unknown type and are not statically checked.
- `list<T>` is recognized as a valid field type in chain resolution. Element-level validation of `list<T>` field assignments is not yet performed.
- Function call statements are checked for correct argument count and compatible argument types against the declared parameter types.
- `return EXPRESSION` inside a function body is checked against the function's declared return type when the expression type can be inferred.
- Function parameters and the loop variable in `for` are typed as locals within their enclosing body. Function parameters take the declared parameter type; the loop variable has type `int`.
- `function`-typed parameters and `FunctionRefExpr` values are accepted without deeper signature checking — the static checker does not currently validate that a passed function's parameter list or return type matches what the receiving parameter expects.
- Conditional overloads (`when` clauses) are validated: all overloads of a function must share the same signature; at most one may be unconditional; `when` conditions may not contain function calls or function references (relation queries are allowed); `when` conditions must produce a `bool` value. Syntactically identical `when` conditions on the same function produce a warning.
- Native function declarations are validated against the collected native JavaScript: if a `native function` declaration names a function that does not appear (as a `function NAME(` pattern) in any `index.js` from the compiled library set, Lantern reports a compile error.
- The no-shadowing rule is enforced: a `let` binding, function parameter, or `for` loop variable whose name matches a declared global is a compile error.
- Assignment to a bare name that is neither a `let`-bound local in scope nor a declared global is a compile error.

## lib/advent

`lib advent` is the standard Inform-style IF library. A file that begins with
`lib advent` gets the full suite of types, relations, globals, and actions
described below.

### Types

| Type | Parent | Key fields |
|---|---|---|
| `thing` | — | `string printed_name`, `string understand`, `bool private_name` |
| `physical` | `thing` | `article article`, `string description`, `string gender` (default `"masculine"`), `string feels` (default `""`), `bool feelable` (default `true`), `bool far_away`, `bool obstructed`, `bool edificial`, `string take_refusal`, `string attack_refusal`, `bool lit` (Inform's `lit`; darkness is room-level so this only annotates the inventory row `(providing light)`) |
| `room` | `container` | `string description`, `bool lighted` (default `true`) |
| `item` | `physical` | `bool scenery`, `bool wearable`, `string initial_appearance` (default `""`), `bool handled` |
| `box` | `item, container` | `bool closable`, `bool closed`, `bool locked` |
| `person` | `physical` | — |
| `direction` | `thing` | `direction inverse`, `string understand` |
| `door` | `item` | `bool closed=true`, `bool locked=false`, `bool lockable=true`, one `room` field per direction |
| `backdrop` | `item` | — (present in scope in *every* room; see Backdrops) |

`article` is an enum kind with values `count`, `definite`, `proper`, `plural`.
`stop_reason` is an open object type; lib/advent declares the reasons listed
below, and game files may declare more.

By default an object is referable both by its **identifier** tokens (the name split
on `_`/whitespace — `green_door` → "green", "door") and by its `understand` words.
Setting **`private_name true`** (Inform's "privately-named") suppresses the identifier
tokens, so the object is referable *only* by its explicit `understand` words — for a
thing whose internal name would otherwise leak a colliding token (a sign object named
`locker_sign` must not answer to "locker"). Golden `privatename1`.

### Globals and constants

- `global person player = yourself` — the player character; `yourself` is a
  built-in `person` object.
- `global string input` — the raw input line each turn.
- `global story_state story = ongoing` — story-end state (`ongoing`/`won`/`lost`);
  see *Ending the story*.
- Directions: `north`, `northeast`, `east`, `southeast`, `south`, `southwest`,
  `west`, `northwest`, `up`, `down` — each with an `inverse` and an `understand`
  alias (e.g. `"n"`, `"ne"`).

Settings (declared in `lib/sys`, available to any game) are ordinary author-set
globals read by the runtime/library:

- `global bool oxford_comma = false` — use the serial comma in list prose.
- `global int undo_limit = 32` — turns of UNDO history kept (`0` disables);
  read fresh each turn (see *State, undo, and save*).

### Startup banner

The advent `on startup` handler prints a title banner before any `startup_rules`
contributions, reading it from the game object's fields:

```
<game.title, or the game identifier when title is blank>
<game.tagline> by <game.author>
Version <game.version> <game.release>
```

The banner is **gated on `tagline`**: a game opts in by setting it; games that
leave it blank (the `""` default) get no banner. The base `game` type
(`lib/sys/types.lamp`) defaults the banner fields — `title = ""`, `tagline = ""`,
`version = 0`, `release = dev` — so a game need only set the ones it cares about.

**`title`** is the display title: a game identifier can't hold spaces, punctuation,
or accents, so a game whose title needs them (e.g. phobos's
`title "Phobos - A Galaxy Jones Story"`) sets `title`; blank falls back to the
identifier. `title` is display-only — save identity still keys on the identifier
(`gameInfo()` reads `game.name`), so setting a title never invalidates saves.

**Placement.** The banner is a callable **`print_banner()`** (it does the `tagline`
gate itself, so calling it with no tagline is a no-op). `on startup` auto-prints it
before `startup_rules` only when **`game.auto_banner`** is true (the default). A game
that wants the banner elsewhere — e.g. *between* an intro narration and a reveal —
sets `auto_banner false` and calls `print_banner()` itself from `startup_rules`.

### Room description heading

`describe_room` prints the room-name heading through an overridable rulebook,
**`room_heading_rules(room r)`** (`bool`, default `true`), whose default rule prints
the bare room name on its own line (`"[r][line break]"`) — so default output is
unchanged. A game replaces the heading by contributing a rule **from its author
file** (so it runs before the library default and `stop`s it); printing without a
trailing line break makes the description run on into the same paragraph. This is
how a game gets a third-person, name-embedded intro — e.g. "Galaxy is in **the
passage end**. <description>". Any presentation fields the custom heading needs are
the **game's** concern, not advent's: the game **reopens the `room` type** to add
them. Phobos adds `preposition` ("in"/"on") and `always_indefinite` (render the name
with "a"/"an" rather than "the"); see `sample/phobos/` (and the `room_heading1`
fixture).

**Initial appearance.** An `item` with a non-empty **`initial_appearance`** string
describes itself in its own paragraph in the room description — e.g. "A form hangs on
the wall beneath the sign." — *instead of* appearing in the standard "[We] [see] … here."
list, until it is first picked up. Taking an item sets its **`handled`** flag (in `do
take`); once handled it drops back into the normal list (so after take-then-drop the room
reads "[We] [see] a form here."). The split is `listable_contents(room)` — `contents_of`
minus any not-yet-handled item that carries an `initial_appearance`; those items stay
fully in **scope** (scope doesn't read `contents_of`), so they're examinable and takeable
the whole time. The default empty `initial_appearance` leaves an item always listed
normally, so existing games are unaffected.

### Opening and closing containers

advent provides **OPEN** and **CLOSE** (`shut`) actions over `box` containers. A box
opts in with **`closable true`**; `closed` is its live state (a closed box seals its
contents out of scope and out of listings, via the scope barrier and `contents_of`).
The actions take any `item` and refuse a non-`closable` target ("That's not something you
can open."). Opening **reveals** the newly-visible contents — "[We] [open] [the chest],
revealing a coin." (an empty box just confirms; the success reports use the `[We] [open]`
/ `[We] [close]` sugar, so they follow the story viewpoint). A **`locked`** thing refuses to
open ("It seems to be locked.") — there are **no LOCK/UNLOCK verbs**; a game clears
`locked` through its own mechanism (e.g. a hacking puzzle that unlocks a container without
letting OPEN bypass it). The `locked` test runs **first**, so a `locked` **door** — which is
not `closable` (it opens via its own hack/`go` passage) — still reports "locked" on OPEN
rather than "not openable". Already-open/closed are reported. Otherwise **doors are out of
scope** here — they keep their own passage/`go` and game-specific (hack) mechanism, and their
`closed`/`locked` defaults differ from a box's. Refusal reasons:
`not_openable`/`not_closable`/`already_open`/`already_closed`/`locked_shut`.

### Ending the story

advent tracks story state in `global story_state story = ongoing`, where
`story_state` is `enum(ongoing, won, lost)`. Game code ends the story by setting
it from a rule, e.g. in a `report` band:

```lamp
report read when self.target == sawdust:
    print "The message, neatly marked in the sawdust, reads..."
    story = won
```

The command loop runs while `story == ongoing`; once a command leaves it
`ongoing`, the loop exits, **follows the `end_story_rules` rulebook** to print the
ending message, and then accepts only `quit` (or its shorthand `q`):

```
*** You have won ***

Please type QUIT to exit.
```

`end_story_rules` is an ordinary rulebook (`bool`, default `true`) with library
rules for `won` and `lost`; a game customizes the ending text by contributing its
own rule, which runs before the library rule and stops it:

```lamp
rule end_story_rules when story == lost:
    print "*** Game over, friend. ***"
    stop true
```

Both the command loop and the end-of-story prompt accept `quit` or its shorthand
`q` (case-insensitive) to end the session, via the `is_quit_command` helper.

RESTART is not yet wired into the end sequence, so only `quit` ends the session —
though the state-snapshot mechanism (see *State, undo, and save*) now provides the
reset primitive a RESTART would build on.

### Every-turn rules

advent declares an `every_turn_rules` rulebook that the command loop **follows once
per turn**, after a command that actually spent a turn and while `story == ongoing`:

```lamp
if run_command(input, player):
    if story == ongoing:
        print "[par if printed]"   # separate every-turn output into its own paragraph
        follow every_turn_rules()
```

The `[par if printed]` puts any every-turn output in its own paragraph after the
action's report, and is a no-op when nothing was printed. The guard is `run_command`'s
boolean return — true only when an action ran — so a
parse failure, a disambiguation prompt, and out-of-world verbs (undo) spend no turn
and fire nothing. A game contributes side-effect rules — daemons, countdowns,
per-turn upkeep — and should **not** `stop`, so every contributed rule runs:

```lamp
rule every_turn_rules:
    fuse = fuse - 1
    if fuse == 0:
        print "The bomb goes off."
        story = lost
```

A rule may end the story (the loop exits to the end sequence next iteration). Timed
(fire-once-at-turn-N) events are not yet a built-in — schedule them with a counter in
an every-turn rule. (`every_turn_rules` is declared `bool, default false` only because
a `void` rulebook isn't expressible; the result is unused.)

### Relations

- **`connects`** — room connectivity. `from room source`, `direction dir
  inverted`, `to room target`. Custom syntax: `connects [source] [dir]
  [target]`. Assert with `bidi` for two-way exits.
- **`wears`** — worn items. `from person wearer`, `to item worn`. Custom syntax:
  `wears [wearer] [worn]`. The `wear` action asserts this; `doff` retracts it.
- **`doorway`** — the side→guarding-door index for the door subsystem (below).
  `from room side`, `direction dir`, `to door barrier`. Materialized at startup by
  `wire_doors` from each door's directional fields; read by `go` (to block a closed
  door) and by the door scope provider. Not authored directly.

### Doors

A **`door`** is a barrier between two rooms that can be `closed` and/or `locked`. A
door declares its two sides in-body as `<direction> <room>` lines — the
**destination** reading: `north RoomB` means *RoomB lies to the north, reached by
going north*:

```lamp
door green_door:
    north Southern_Spoke
    south Passage_End
    scenery
    description "A heavy green door."
```

At startup, the native `wire_doors` reads each door's directional fields and
materializes the map: two directed `connects` edges (so `go` traverses) and two
`doorway` edges. A door is present in both rooms it joins but contained in neither,
so a **scope provider** (registered via the runtime's `registerScopeProvider` seam)
surfaces the current room's doors for command resolution; a door's contained parts
come along via scope's existing fixpoint. A closed door blocks `go` with the
`door_closed` reason ("[The door] is closed."). **Consistency:** a door must connect
exactly two rooms — Lantern rejects a door object that sets other than two
directional fields at compile time (keyed on the directional-field signature, so an
unrelated user type named `door` is unaffected). Only the ten built-in directions
are supported as door sides; standard OPEN/CLOSE/LOCK/UNLOCK verbs are not yet
provided (a game drives door state itself).

### Backdrops

A **`backdrop`** is a thing present in scope in *every* room — walls, the floor, the
ceiling, the sky, a distant landmark — rather than contained in any one. A second
**scope provider** (registered in `lib/advent/index.js`, alongside the door one)
surfaces **every `backdrop` instance** regardless of the actor's location, so a
backdrop is referable everywhere; like all scope-provided objects its own contained
parts come along via the scope fixpoint. Backdrops are not in any room's `contains`,
so they never appear in room-contents listings. advent supplies only the *presence*
mechanism — the per-room and indoors/outdoors wording is the game's, via its own
`instead examine` / `instead touch` (etc.) rules keyed on `holder(self.actor)`:

```lamp
backdrop sky:
    understand "sky/clouds"
    description "The sky is a flat, even blue."

instead touch when self.target == sky:
    print "Your fingers find only empty air."
    stop succeeded
```

(Region- or room-scoped backdrops — present in only some rooms — are not yet
modelled; every backdrop is everywhere. Golden `backdrop1`.)

### Parts

A **`part_of PART WHOLE`** relation (`from physical part`, `to physical whole`) marks a
thing as part of another — a door's handprint scanner, a suit's light, a panel's button.
A part is in scope **wherever its whole is**, and moves with it. `wire_parts` (called at
startup, beside `wire_doors`) materializes a `contains` edge (the whole contains the part)
for each `part_of`, so the part rides scope's containment fixpoint — the same mechanism a
door's parts use. Because the part is placed *inside* its whole, dropping the whole carries
the part along for free. A part is normally `scenery` (unlisted, untakeable); advent adds no
behaviour beyond the scoping. The whole a part belongs to is `whole_of(part)`.

One subtlety this exposed: the closed-container **scope barrier** now applies only to actual
`container` types (a box), not to anything with a `closed` field — a `door` is a passage, not
a vessel, so a *closed* door must not hide its parts. Golden `parts1`.

### Stop reasons

`already_carrying`, `cant_take_that`, `not_carrying`, `cant_put_on_that`,
`cant_go_that_way`, `not_wearable`, `already_worn`, `not_worn`, `too_dark`,
`door_closed`, and the touch/reach family `cant_touch`, `cant_reach`,
`cant_take_unfeelable`, `too_massive`.

### Actions

| Action | Slots | Player syntax | Notes |
|---|---|---|---|
| `look` | — | `look`, `l` | Describes the current room. |
| `wait` | — | `wait`, `z` | Lets a turn pass (Inform's "waiting"); prints `wait_report` ("Time passes."). Changes nothing, but is an ordinary in-world action, so it spends the turn and every-turn rules fire. |
| `examine` | `direct physical target` | `examine [target]`, `x [target]`, `read [target]` | Prints `self.target.description` (or `examine_nothing` when empty). Targets any `physical`, so people and non-item scenery are examinable too. When the target is an **open container** (`is_container` and not closed) holding something, appends Inform's contents listing — `examine_in_container` "In [the target] is …" / `examine_in_container_plural` "… are …" (agreeing in number). Gated to container kinds, so examining a person doesn't spill their inventory (golden `examinecontents1`). |
| `touch` | `direct physical target` | `touch [target]`, `feel [target]` | Inform's "touching" (ported from Can't Touch This.i7x). Senses a thing without changing the world (no `do` band, like `examine`), and works in the dark. Prints the target's `feels` text when set, else `touch_nothing` = "[We] [feel] nothing unexpected." Refused when the target is `unfeelable` (reason `cant_touch`, message `touch_cant` = "[We] can't touch [the act.target].") or out of reach — `far_away`/`obstructed` (reason `cant_reach`, message `touch_cant_reach` = "[We] can't reach [the act.target]."). The reach/feel traits also refuse `take` (see below). Targets any `physical`. `target` is `direct`, so `it` refers back to it. |
| `attack` | `direct physical target` | `attack [target]`, `hit [target]`, `smash [target]`, `punch [target]` | **Fails by default** (reason `attack_pointless`, message `attack_violence`), so any `do` is skipped — it's a refusal. A non-empty **`attack_refusal`** (`physical`, Can't Hit That.i7x) replaces `attack_violence` per object. A game adds `instead attack` rules for things that respond (`stop succeeded` to act, or a bare `stop failed` after its own refusal — the `report failed` reason guard then suppresses the default). Targets any `physical` (so people are attackable). `target` is `direct`, so `it` refers back to it. |
| `push` | `direct item target` | `push [target]` | Inform's "pushing a thing" — for buttons, switches and the like. **Fails by default** (reason `nothing_happens`, message `push_inert` = "Nothing obvious happens."), same band shape as `attack`: a game adds `instead push` rules for controls that respond. `target` is `direct`, so `it` refers back to it. A game that needs a *key-press* grammar (`press 1` on a keypad) declares its own action with a number/text slot — `push` stays the item verb so the two never collide (see the Phobos `press_key` sample). |
| `pull` | `direct item target` | `pull [target]` | Inform's "pulling a thing" — the counterpart to `push`, for levers and the like. **Fails by default** (shares the `nothing_happens` reason; message `pull_inert` = "Nothing obvious happens."); a game adds `instead pull` rules for things that respond. `target` is `direct`, so `it` refers back to it. |
| `take` | `item taken` | `take [taken]`, `get [taken]` | Moves item to actor. Refused for an already-carried item (`already_carrying`), a `scenery` item (`cant_take_that`), and — from Can't Touch This.i7x — an `unfeelable` item (`cant_take_unfeelable` = "[We] can't take [the act.taken]."), one out of reach (`far_away`/`obstructed` → `cant_reach`), or an `edificial` one (`too_massive` = "[The act.taken] [is] much too massive to take."). The trait checks run before the scenery check, so a massive scenery fixture reports "too massive". A non-empty **`take_refusal`** (`physical`, Can't Take That.i7x) replaces the default message for *any* take failure except the carry-state errors. |
| `drop` | `item dropped` | `drop [dropped]` | Moves item to actor's location; implicitly calls `doff` if item is worn (printing `(first taking off X)` for the player). |
| `inventory` | — | `inventory`, `i` | Lists carried items; marks worn items with `(worn)` and `lit` items with `(providing light)`. |
| `wear` | `item clothing` | `wear [clothing]` | Asserts `wears actor clothing`; implicitly calls `take` if item is not yet carried (printing `(first taking X)` for the player). |
| `doff` | `item clothing` | `remove [clothing]`, `take off [clothing]` | Retracts `wears actor clothing`. (Named `doff` internally because `remove` is a reserved keyword.) |
| `enter` | `direct item target` | `enter [target]` | Inform's "entering". advent has no enterable/vehicle model, so it **fails by default** (reason `cant_enter`, message `cant_enter_msg` = "That's not something [we] can enter."); a game adds `instead enter` rules to move the actor into an interior (e.g. a vehicle). `target` is `direct`, so `it` refers back to it. |
| `give` | `direct item gift`, `physical recipient` | `give [gift] to [recipient]` | **Fails by default** (reason `give_declined`, message `give_declined_msg` = "[The act.recipient] [do] not seem interested."); a game adds `instead give` rules for recipients that react (e.g. an NPC taking a gift). `gift` is `direct`. |
| `show` | `direct item shown`, `physical recipient` | `show [shown] to [recipient]` | **Fails by default** (reason `show_declined`, message `show_declined_msg` = "[The act.recipient] [are] unimpressed."); a game adds `instead show` rules. `shown` is `direct`. |
| `go` | `direction way` | `go [way]`, `[way]` | Moves actor along a `connects` edge. Directions: the eight compass points, `up`/`down`, and `inward`/`outward` (typed `in`/`out`, named that way because `in` is a reserved keyword). A blocked exit (`cant_go_that_way`) gives a **direction-aware** excuse (Can't Go That Way.i7x): `up` → `go_cant_up` ("[We] can neither climb walls nor fly."), `down` → `go_cant_down` ("[We] can't just dig downward."), `inward` → `go_cant_in` ("What [do] [we] want to enter?"), else `go_cant` ("[We] can't go that way."). A game refines per-room by contributing a `report failed go` rule **from its main file** (author order, runs first). |
| `put_on` | `direct item put_item`, `item destination` | `put [put_item] on [destination]` | Moves an item onto a supporter (sets `holder`, records `supports`); a `check` refuses a non-`supporter` destination (`cant_put_on_that`). Worn items are taken off first. Games add their own phrasing with `understand` (e.g. cloak's `hang … on …`). |

All report rules are actor-aware: player actions produce second-person text
(`"Taken."`, `"Dropped."`, etc.); NPC actions produce third-person text
(`"npc takes hat."`, `"npc drops hat."`, etc.).

The player also has **out-of-world** verbs handled by the runtime (no turn taken):
`undo`, `save`, `restore` — see *State, undo, and save*.

### The conversation library (`lib/conversation`)

An opt-in library (not part of core advent, since conversation style is a matter of taste). A
game pulls it in with `lib conversation`, declared **after** `lib advent` (it references advent's
`physical`/`thing`) and before the game file. It adds:

- **`subject`** — a topic type (`< thing`, so it has a printed name + `understand` vocab, but
  **not** `physical`). Because it isn't physical, a `[topic]` slot resolves against *every*
  subject in the world rather than by scope (the same global-by-name path `direction` uses; see
  `resolvePool`). Field `reply` (string) is the interlocutor's answer when ASKED.
- **`ask`** — `physical interlocutor`, `subject topic`; `ask [interlocutor] about [topic]`.
  Default report prints the topic's `reply`, or `convo_no_reply` ("[The act.interlocutor] [have]
  nothing to say about that.") when empty.
- **`tell`** — same slots; `tell [interlocutor] about [topic]`. Neutral default (`convo_not_interested`).
- **`say`** — `string topic`; `say [topic]` / `answer [topic]`. **SAY/ANSWER free text**: unlike
  ASK/TELL (which resolve a declared `subject`), the topic is a primitive `string` slot, so it
  captures whatever the player typed **verbatim** (lowercased by the parser — `say I am human` →
  `"i am human"`). The action **fails by default** (reason `nothing_to_say`, message `say_no_reply`
  = "There is no reply."); a game adds `instead say` rules guarded on `self.topic` (e.g.
  `self.topic == "yes"`) for utterances that land, `stop succeeded` after handling, and lets
  anything its guards don't match fall through (no `stop`) to the default. The listener is *not* a
  slot — a game gates on the relevant NPC being present (`holder(npc) == holder(player)`).

A game declares one `subject` per topic with its `reply`, and overrides `ask`/`tell` with
`instead`/`after` rules guarded on `self.topic` (and `self.interlocutor` for per-NPC responses)
for dynamic reactions. No table primitive is needed — topic data lives on the subject objects.
SAY/ANSWER instead is the free-text counterpart for fixed utterances (yes/no, an asserted phrase).

### Scoring (`lib/advent/scoring.lamp`)

A small opt-in score subsystem. Globals `score` and `max_score` (a game sets `max_score`, e.g. in
`startup_rules`); `award_points(n)` bumps `score` and prints the standard notification (`score_up_one`
/ `score_up_many`). The **SCORE** verb (out-of-world `request_score`, syntax `score`) reports the
total (`score_report` / `score_report_nomax`). A game can wrap `award_points` to add a flourish —
Phobos's `galaxy_score(n)` prints the "Galaxy Jones" ASCII banner on every gain, and maps the final
score to a rank in its end banner.

### Debug: the TEST runner (`lib/advent/debug.lamp`)

A debug feature (in the `not_for_release` debug file, so excluded from `--release` builds), modeled
on Inform 7's `test NAME with "a/b/c"`. A **`test_script`** holds a `"/"`-joined `commands` string;
`test [script]` splits it (the general `split_on(s, sep)` sys native) and **queues** the commands
onto the input stream. The runtime keeps a command queue that `promptLine` drains ahead of host
input, echoing each line like a typed command — so queued commands flow through the **real**
command loop and every-turn rules / story checks fire exactly as in normal play. The native
`queue_commands(list<string>)` inserts at the **front**, so a script that begins with another
`test NAME` expands that script *in place* (depth-first). `test_script` is a non-`physical` type,
so the `[script]` slot resolves by name globally (like conversation subjects). Scripts are authored
in the game's own debug file (e.g. `sample/phobos/lib/phobos/debug.lamp`).

## Open Questions

- Should the no-shadowing rule extend to top-level `let`-style bindings if locals are ever permitted outside a local context, or remain scoped to local contexts only?
