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
| `COMMA` | `,` (parent-type lists, `enum(...)` labels) |
| `EOF` | End of input |

> **Review note — missing/overloaded tokens.** The table above (as originally drafted) omitted `COMMA`, which the current grammar needs in two places: comma-separated parent types (`type box < item, container:`, see `lib/advent/types.lamp:17`) and `enum(red, green, blue)`. Two more overloads need an explicit decision:
> - `<` is **both** the comparison operator (`i < 5`) and the inheritance marker (`type box < item:`). `>` is both comparison and the closing bracket of `list<T>`. The tokenizer should emit a single `LT`/`GT` token for each and let the parser interpret by context (the current code already disambiguates by location).
> - `list<T>` field types (`list<game> inventory`) currently survive as one token via the regex char class `[A-Za-z0-9_<>]`. Under a real tokenizer this becomes `IDENT(list) LT IDENT(game) GT IDENT(inventory)`, so `parseFieldType()` must reassemble it. No `list<...>` appears in current fixtures, but the spec defines it, so the parser must handle it.

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

> **Review note — dispatch ambiguity needs lookahead.** Two `IDENT`-led cases are only distinguishable by scanning ahead to the line's structural token:
> - Top level: object declaration (`game Game 1:` / `person yourself`) vs. global assignment (`USE OXFORD COMMA = true`). Today this is the heuristic `isTopLevelGlobalAssign` (contains `=`, no `:`). The recursive-descent version must look ahead past the (multi-word) name to decide whether an `EQUALS` or a `COLON`/`NEWLINE` comes first.
> - `on`: event handler (`on startup:`) vs. change handler (`on person.holder change:`), distinguished by the `.` + trailing `change` keyword. The plan notes this; flagging that both need the same bounded-lookahead helper.

### 3. Keep the Pratt parser

`parseExpression(minBP)` is already correct. It would call the shared `peek()`/`consume()` helpers rather than its own local copies, and operate on the same token stream the outer parser is consuming. No other changes needed.

## Multi-word identifiers — resolved design (underscore identifiers)

The original draft framed this as "multi-word names." In reality the current grammar also allows multi-word *values* (free text, not expressions) and characters the proposed `IDENT` rule cannot represent (the hyphen in `One-Room Game`). Confirmed in fixtures:

- Multi-word object names, incl. hyphens: `game One-Room Game:`, `room West of House:`, `circle Unit Circle:` (`tests/fixtures/advent1.lamp:3,:9`).
- Multi-word global names: `global bool USE OXFORD COMMA = false` (`lib/sys/globals.lamp:1`); matching assignment `USE OXFORD COMMA = true`.
- Multi-word field values that are not expressions: `parseObjectFields` → `parseSimpleValue` takes the raw line remainder, so `author Phil Riley` → string `"Phil Riley"` and `start West of House` → forward ref `getObject("West of House")`.

### Decision

Adopt **single-token underscore identifiers with display coercion**, plus **quoted free-text values**. A name is always exactly one token; the `(Multi Word)` paren reference form and `createParenNameExpr` are eliminated — every object reference becomes a plain `IDENT` lookup.

**Coercion rules, by role (a token's role is fixed by where the parser consumes it):**

1. **Name tokens** — object-declaration names, object references, global names. The tokenizer resolves `_` → space, `-` → a literal hyphen, and `\_` → a literal `_`, producing the *canonical name string*. That string is the object's identity everywhere: the `createObject`/`getObject`/`defineGlobal` key **and** the displayed `name` field. So `room West_of_House:` registers and displays as `West of House`; a later `start West_of_House` resolves to the same object. Because `-` and `_` are distinct, both a literal hyphen and a space are representable: `One-Room_Game` → `One-Room Game` (exactly reproducing the old fixture name), `well-worn_map` → `well-worn map`.
2. **Quoted string literals** (`"..."`) — free text, **no** coercion. `_`/`-` are already literal; standard `\"` / `\\` escapes apply as today. This is where arbitrary multi-word/punctuated values live: `author "Phil Riley"`.
3. **Local variables (`let x`) and `for`-loop variables** — these are the **only** identifiers that compile to real JavaScript variables, so they are restricted to JS-safe names (`[A-Za-z_][A-Za-z0-9_]*`): no `-`, no coercion. The parser/checker rejects a hyphen here with a clear error. Field names and type names also stay plain identifiers (no coercion needed — they emit as string keys, so a hyphen would be *lexically* legal, but there's no reason to use one).

**Why locals are restricted:** every name role except locals/loop-vars compiles to a JS **string** (`defineType("game",…)`, `createObject("West of House",…)`, property keys), where a hyphen is harmless. Locals/loop-vars compile to JS *variables*, which cannot contain `-`. Restricting them avoids any emitter-side name mangling and the `a-b`/`a_b`/`a b` collision questions mangling would raise. Hyphens/underscores are a naming-and-display feature for game objects — exactly where they're wanted; locals are internal and never displayed.

**Consequence to specify (not a bug, a footgun to document):** the same spelling coerces differently by role. `let this_game = …` stays the local `this_game` (rule 3), whereas an *object* named `this_game` would display as `this game` (rule 1). They occupy separate namespaces, so resolution is unambiguous. Every existing fixture uses `this_game` only as a `let`-local, so existing bodies are unaffected.

**Why `_` and `-` rather than a hyphen-only separator:** `_` → space is the common case (rarer in prose, so the space-coercion surprises less); `-` stays a literal hyphen for the genuinely-hyphenated display names that interactive fiction needs. A future binary minus operator remains possible under the CSS-style rule below (it must be space-delimited).

**Tokenizer impact (lexer rule, CSS-style):** a name word starts with `[A-Za-z_]`, then continues over `[A-Za-z0-9_]` **or** a `-` that is *immediately followed by* `[A-Za-z0-9_]` (interior glue only — a `-` is never leading or trailing in an identifier). The two-char escape `\_` is also permitted inside it. A `-` at token start followed by a digit remains a negative-number literal (`-7`, `-0.5`), as today. Quoted strings keep their own scanner.

**Where coercion lives (implementation note).** The tokenizer is **role-agnostic**: an `IDENT` token carries the *raw source spelling* (e.g. `West_of_House`, `well\_worn_map`), not a resolved string — the tokenizer cannot apply coercion because whether `_`→space applies depends on the identifier's role (rule 1 vs. rule 3), which only the parser knows. Coercion is a separate pure helper, `coerceName(raw)`, that the parser calls **only** at name-role sites. Locals/loop-vars and field names use the raw spelling directly (and the checker enforces the JS-safe restriction). This is a correction to the original "the emitted token carries the resolved canonical string" wording. Implemented in `src/lantern/tokenizer.js` (`tokenize`, `coerceName`).

> **Banked convention:** if a binary `-` (subtraction) operator is added later, it must require surrounding whitespace (`x - 1` = subtraction; `x-1` = the single identifier `x-1`). No minus operator exists today, so nothing breaks now.

### Migration required

This is a syntax-breaking change. Every `.lamp` file in `lib/sys/`, `lib/advent/`, `lib/vanilla/`, `sample/`, and `tests/fixtures/` that uses a multi-word name or value must be rewritten (`One-Room Game` → `One-Room_Game`, `author Phil Riley` → `author "Phil Riley"`, `(Unit Circle).radius` → `Unit_Circle.radius`, `USE OXFORD COMMA` → `USE_OXFORD_COMMA`, etc.). **Per `CLAUDE.md`, files under `lib/` and `sample/` may not be edited without explicit instruction — this migration needs your explicit go-ahead for those directories.**

## What does not change

The AST node types, the checker, and the emitter are unaffected. Because coercion happens in the tokenizer and yields the *same canonical strings* the old line-scanner produced (`createObject("West of House", …)` is byte-for-byte identical), the emitter output for a correctly-migrated source file matches today's.

> **Correction to the original claim.** "All golden tests pass without modification" is **false** under this decision: the *source fixtures* must be migrated to the new spelling and their golden expectations regenerated. What holds is the weaker, true statement: once each fixture is migrated, its regenerated expectation should be identical to today's (the canonical strings are unchanged), so the migration is mechanical and reviewable as a no-op in emitter output.

## Migration approach

Because the underscore-identifier decision is syntax-breaking, the source migration and the parser rewrite are coupled. Suggested order:

1. **Spec first.** Update `devdocs/specs.md` syntax sections to the new identifier rules — `_` → space, `-` → literal hyphen, `\_` → literal underscore, the CSS-style interior-hyphen lexer rule, JS-safe restriction on `let`/`for` variable names, and quoted free-text values — and remove the `(Multi Word)` paren-reference form. The spec is the source of truth and currently documents the old multi-word-bare-name syntax (`game Minimal`, `author Phil Riley`, `(Unit Circle).radius`).
2. **Tokenizer.** ✅ Done — `src/lantern/tokenizer.js` (`tokenize`, `coerceName`, `KEYWORDS`), with unit tests in `tests/tokenizer/run-tokenizer.js` (`npm run test:tokenizer`). The tokenizer is role-agnostic: `IDENT` carries raw spelling; `coerceName` is applied by the parser at name sites only.
3. **Recursive-descent parser.** ✅ Done (additive) — `src/lantern/parser_rd.js` exports the same `parseSource(sourceText, filePath, globalNames)` and produces byte-identical ASTs. Verified by `tests/parser/run-parser.js` (`npm run test:parser`), which parses the legacy syntax with `parser.js` and the new underscore syntax with `parser_rd.js` and asserts deep AST equality across every construct (including the multi-word-object-reference → `ParenNameExpr` case) plus the new validation rejections. **Not yet wired into `index.js`** — that switchover happens in step 4 alongside the source migration, since `parser_rd.js` requires the new surface syntax. Validation implemented (banked from tokenizer review):
   - Call `coerceName` only at name-role sites (object/global names, object references). Locals (`let`), loop vars (`for`), type/kind/field names use raw spelling and must match `[A-Za-z_][A-Za-z0-9_]*` (reject `-`).
   - Reject a name identifier whose first or last character is a separator (`-`, `_`, or `\_`) — it would coerce to a string with leading/trailing whitespace (specs.md "Names and identifiers").
   - Reject a name that is exactly a reserved word (the tokenizer already classifies these as `KEYWORD`, so a `KEYWORD` token in a name position is the error signal).
   - Fix `stripComment`'s escaped-backslash bug (`\\"`) when reused/ported, so it agrees with the string scanner — or share one escape-aware scanner. (Inherited verbatim from the old `parser.js`; no fixture hits it, so it is bug-for-bug compatible today.)
4. **Migrate sources + regenerate goldens, together.** Rewrite every multi-word name/value in `tests/fixtures/`, `sample/`, and `lib/**` to the new spelling, then regenerate golden expectations. Each migrated fixture's regenerated `expected` output should be **identical** to its current expected output (canonical strings are unchanged); any diff in emitter output is a migration error, not an intended change. **`lib/` and `sample/` edits require explicit user authorization (`CLAUDE.md`).**

   **Dry-run complete (no files mutated):** `tests/migration/verify-migration.js` (`npm run test:migration`) applies the planned migration in memory to every file the compiler parses and asserts the new parser reproduces the legacy parser's AST for each — all 28 files pass (the one deliberate parse-error fixture, `example12`, rejects under both). Scope is now known precisely:
   - **`sample/`** — no `.lamp` files; nothing to migrate.
   - **`lib/`** — exactly one line: `lib/sys/globals.lamp` `USE OXFORD COMMA` → `USE_OXFORD_COMMA`. `lib/advent/**` and `lib/sys/{kinds,types}.lamp` need no change.
   - **`tests/fixtures/`** — multi-word object/global names → underscores, bare free-text values → quoted, `(Paren)` refs → dotted (substitutions enumerated in `verify-migration.js`).

   ✅ **Switchover complete.** The migration was applied on disk (20 fixtures + the one `lib/sys/globals.lamp` line), `index.js` now requires `parser_rd`, and the **golden suite passes with zero changes to `tests/golden/expected/`** — generated JS and runtime output are byte-identical for all 20 cases. `parser_rd` also restores the legacy diagnostic for a trailing `.` on a non-reference (so `example12`'s compile-error message is unchanged). The in-memory migration dry-run (`verify-migration.js`) was removed once its premise (unmigrated on-disk originals) no longer held.
5. ✅ **Legacy parser deleted.** `src/lantern/parser.js` (line scanner + `tokenizeExpression`) is removed; nothing references it. `tests/parser/run-parser.js` is now a standalone unit test of `parser_rd` — it asserts the exact AST shapes the refactor had to get right (name coercion, multi-word reference → `ParenNameExpr`, single-word → `PropertyAccess`, global resolution, precedence, GT operand swap) plus the validation rejections (leading/trailing separator, hyphen-in-local, reserved-word-as-name, property-access-on-literal).

## Status: complete

The refactor is finished. The compiler parses via `src/lantern/tokenizer.js` + `src/lantern/parser_rd.js`; the legacy line scanner is gone. Test suites: `npm run test:tokenizer`, `npm run test:parser`, and `npm test` (golden, 20/20 with no `expected/` changes) all pass.

### Open questions

- **Scope of the first PR.** Recommend splitting: (1) spec update, (2) tokenizer + unit tests, (3) parser rewrite + fixture migration + golden regen. Step 3 is the only irreversible/breaking commit and should be reviewed on its own.
- **Field-type tokens.** `parseFieldType` must reassemble `list<game>` from `IDENT LT IDENT GT IDENT`. Confirm whether `list<T>` is in scope for this refactor or deferred (no fixture exercises it today).
- **Top-level dispatch + `on` change-vs-event** both need a bounded-lookahead helper (see review note above); decide whether that lives in the parser or as a small token-stream utility.
