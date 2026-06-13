# Parser Refactor Plan

## Current architecture

The parser has two mismatched layers.

**Outer layer** (`parseNodes`, `parseStatementBlock`): line-by-line scanning. Each line is classified by `content.startsWith(...)` and matched against a per-construct regex. Every new statement type requires a new `if` branch and a new regex. Block structure is managed by passing `baseIndent` as a parameter and breaking when indentation falls below it.

**Inner layer** (`tokenizeExpression` + Pratt parser): a proper token stream and operator-precedence parser. This is the right shape for the whole language.

The mismatch means the outer layer gets harder to maintain as the language grows, and the two layers share no infrastructure.

## Target architecture

### 1. Single tokenizer for the whole file

Replace `tokenizeExpression` (expression-only) with a full-file tokenizer that emits a flat stream of typed tokens:

| Token | Description |
|---|---|
| `KEYWORD(value)` | Reserved words: `type`, `kind`, `global`, `on`, `for`, `while`, `if`, `else`, `let`, `print`, `error`, `dispatch`, `break`, `lib`, `to`, `step`, `change` |
| `IDENT(value)` | Any non-keyword identifier |
| `NUMBER(value)` | Integer or float literal |
| `STRING(value)` | Double-quoted string literal |
| `INDENT` | Emitted once when indentation increases |
| `DEDENT` | Emitted once per level when indentation decreases |
| `NEWLINE` | Significant line ending (blank lines and comments suppressed) |
| `COLON` | `:` |
| `DOT` | `.` |
| `PLUS`, `STAR`, `EQEQ`, `LT`, `GT` | Operators |
| `EQUALS` | `=` (assignment/declaration, not `==`) |
| `LPAREN`, `RPAREN` | `(`, `)` |
| `EOF` | End of input |

INDENT/DEDENT handling mirrors Python's tokenizer: maintain an indent-level stack; emit `INDENT` when the current line's level exceeds the top of the stack, emit one `DEDENT` per popped level when it decreases. Blank lines and comment-only lines are skipped entirely.

### 2. Recursive descent parser over the token stream

Replace the line scanner with a recursive descent parser that consumes the shared token stream.

`parseDeclaration()` dispatches on the first token:
- `KEYWORD(type)` → `parseTypeDecl()`
- `KEYWORD(kind)` → `parseKindDecl()`
- `KEYWORD(global)` → `parseGlobalDecl()`
- `KEYWORD(on)` → `parseOnHandler()` (event or change, distinguished by lookahead)
- `KEYWORD(lib)` → `parseLibImport()`
- `IDENT` → `parseObjectDecl()`

`parseStatement()` dispatches similarly:
- `KEYWORD(let)` → `parseLetStatement()`
- `KEYWORD(print)` → `parsePrintStatement()`
- `KEYWORD(if)` → `parseIfStatement()`
- `KEYWORD(while)` → `parseWhileStatement()`
- `KEYWORD(for)` → `parseForStatement()`
- `KEYWORD(break)` → `BreakStatement`
- `KEYWORD(dispatch)` → `parseDispatchStatement()`
- `KEYWORD(error)` → `parseErrorStatement()`
- `IDENT` (followed by `EQUALS` or dotted `EQUALS`) → `parseAssignStatement()`

Block structure: instead of passing `baseIndent` as a parameter, `parseBlock()` simply consumes an `INDENT` token, calls `parseStatement()` in a loop until it sees `DEDENT`, then consumes the `DEDENT`. No indent-level arithmetic anywhere in the parser.

### 3. Keep the Pratt parser

`parseExpression(minBP)` is already correct. It would call the shared `peek()`/`consume()` helpers rather than its own local copies, and operate on the same token stream the outer parser is consuming. No other changes needed.

## Multi-word identifier question

The hardest design question this refactor forces: **multi-word bare identifiers** (e.g. `game One-Room Game:`, `author Phil Riley`). These are unusual and require the tokenizer to emit multiple `IDENT` tokens where the parser must know to collect them until a structural token (`:`, `NEWLINE`, `=`).

Two options:

**Keep multi-word bare names.** The parser collects consecutive `IDENT` tokens into a single name wherever a name is expected. Works, but requires every parse function that consumes a name to explicitly do this collection.

**Require quotes for multi-word names.** `game "One-Room Game":`, `author "Phil Riley"`. Simplifies the tokenizer and parser significantly — a name is always a single token. Requires a syntax-breaking migration of all existing source files and library files.

This decision should be made before starting the refactor, as it affects the surface syntax.

## What does not change

The AST node types, the checker, and the emitter are entirely unaffected. The refactor is purely internal to `parser.js` (and `tokenizer.js` if split out). All existing golden tests should pass without modification once the refactor is complete.

## Migration approach

The refactor can be done in one pass (the parser internals are self-contained) or incrementally:

1. Write the new full-file tokenizer alongside the existing one. Verify it produces the expected token stream for all fixture files.
2. Rewrite `parseNodes` and `parseStatementBlock` as recursive descent over the new token stream, keeping the same AST output.
3. Delete the old `tokenizeExpression` and line-scanning code.
