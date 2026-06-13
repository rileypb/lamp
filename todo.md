# Todo

Issues found by comparing the implementation against `devdocs/specs.md`.

## 1. `real` literals not parseable

`parseSimpleValue` and `parseExpression` in `src/lantern/parser.js` only recognize integer literals (`/^-?\d+$/`). Floating-point literals like `3.14` are parsed as `StringLiteral`, bypassing type checking. The `real` → `int` widening rule in `checker.js` can never be exercised from source.

## 2. `global` syntax is undocumented

The parser supports `global NAME = VALUE` (global declaration) and top-level `NAME = VALUE` (global assignment). The sys library depends on this (`lib/sys/globals.lamp`). Neither construct appears in the Language Definition section of the spec.

## 3. ~~Type checker silently skips `all` and `first` in chain resolution~~ FIXED

`resolveChainType` now advances `currentType` correctly: `.all` wraps to `list<T>`, `.first` unwraps back to `T`. Field access on a `list<T>` (other than `.first`) returns unknown type.

## 4. Object declarations with no fields cause a parse error

`parseChildBlock` throws `"Expected an indented block"` when an object declaration has no body. This makes it impossible to create an object that provides no field values and relies entirely on inherited fields. The spec allows types with no additional fields to omit `:` and body, but doesn't address the same case for objects.

## 5. ~~`list<T>` field types have no checker support~~ FIXED (via item 3)

Chain traversal through `list<T>` typed fields now works correctly. `checkValueCompatibility` still silently passes `list<T>` fields (correct — no element-level validation yet).

## 6. ~~Error output goes to stdout instead of stderr~~ FIXED

`reportCompileError` and the "no game" exit now use `console.error`. Golden test runner updated to capture `error.stderr` for compile-failure cases.
