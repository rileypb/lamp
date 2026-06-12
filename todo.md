# Todo

Issues found by comparing the implementation against `devdocs/specs.md`.

## 1. `real` literals not parseable

`parseSimpleValue` and `parseExpression` in `src/lantern/parser.js` only recognize integer literals (`/^-?\d+$/`). Floating-point literals like `3.14` are parsed as `StringLiteral`, bypassing type checking. The `real` → `int` widening rule in `checker.js` can never be exercised from source.

## 2. `global` syntax is undocumented

The parser supports `global NAME = VALUE` (global declaration) and top-level `NAME = VALUE` (global assignment). The sys library depends on this (`lib/sys/globals.lamp`). Neither construct appears in the Language Definition section of the spec.

## 3. Type checker silently skips `all` and `first` in chain resolution

In `checker.js` `resolveChainType`, tokens `all` and `first` are skipped with `continue` without updating `currentType`. After `.all`, the tracked type stays as the collection type (e.g. `game`) instead of advancing to `list<game>`. Also, any user-defined field named `all` or `first` would be silently ignored by the type checker.

## 4. Object declarations with no fields cause a parse error

`parseChildBlock` throws `"Expected an indented block"` when an object declaration has no body. This makes it impossible to create an object that provides no field values and relies entirely on inherited fields. The spec allows types with no additional fields to omit `:` and body, but doesn't address the same case for objects.

## 5. `list<T>` field types have no checker support

`checkValueCompatibility` only handles `kindSchema` entries and `PRIMITIVE_TYPES`. `list<game>` is neither, so assignments to `list<T>` fields are silently skipped. The spec describes `list<T>` as a built-in type without flagging it as unimplemented.

## 6. Error output goes to stdout instead of stderr

`reportCompileError` and the "no game" exit in `src/lantern/index.js` both use `console.log` (stdout). CLI convention is to write errors to `console.error` (stderr). The golden tests capture stdout, which is why this works, but it's a deviation from standard CLI behavior.
