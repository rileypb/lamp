# Lamp Architecture

Lamp is a system for designing and playing parser interactive fiction games. Authors write games in the Lamp language, which is then compiled by Lantern into a JavaScript program. The compiled game is linked with the Lamplighter runtime, which provides the necessary functionality to execute the game. Finally, Lighthouse is used to bundle the compiled game and runtime into a either a standalone Electron application or a web application that can be distributed to players.

## Overview

Lamp consists of three main components:
1. **Lantern**: A compiler that takes a game written in the Lamp language and produces an ineternal representation of the game.
2. **Lamplighter**: A library that provides the runtime environment for executing compiled games.
3. **Lighthouse**: A bundler that packages the compiled game and the runtime into a single executable that can be distributed to players.

## Lantern

Lantern is the compiler component of the Lamp system. It takes a game written in the Lamp language and converts it into a JavaScript program that can be executed with the Lamplighter runtime. Lantern performs several stages of compilation, including parsing, semantic analysis, and code generation.

### Components of Lantern

- **Lantern Parser**: Responsible for reading the source code and constructing the AST.
- **Semantic Analyzer**: Checks the AST for semantic correctness and reports any errors.
- **Code Generator**: Translates the AST into a JavaScript program that can be executed when linked with the Lamplighter runtime library.
- **Standard Library**: Provides a set of built-in functions and utilities that game developers can use in their games.

## Lamplighter

Lamplighter is the JavaScript runtime library that executes the compiled game produced by Lantern. It provides the necessary functionality to run the game, including handling player input, managing game state, and rendering the game world.

The Lamplighter runtime includes a small command line tool that can execute the compiled game in a terminal environment, as well as an API that can be used by Lighthouse to create bundled applications for distribution.

For the design of the component that turns player commands into in-game actions — its pipeline stages, how grammar and rules map onto Lamp constructs, and the language support it requires — see `devdocs/game_parser.md`.

## Lighthouse

Lighthouse is the bundler that takes the compiled game and the Lamplighter runtime and packages them into a single executable. It can produce either a standalone Electron application or a web application that can be distributed to players. Lighthouse ensures that all necessary dependencies are included and optimizes the final output for performance and size.

For the intended execution and isolation model of packaged games — how native library JavaScript is sandboxed and how development and packaged behavior are kept identical — see `devdocs/sandbox.md`.

## Terms

- **Lamp**: The language used to write interactive fiction games.
- **Lantern**: The compiler that translates Lamp code into JavaScript.
- **Lamplighter**: The runtime library that executes the compiled game.
- **Lighthouse**: The bundler that packages the compiled game and runtime into a distributable format.
- **Lamp Parser**: The component of Lantern responsible for parsing the Lamp source code.
- **Game Parser**: The parser that processes player commands and translates them into actions within the game world.

## Known Architectural Issues (review 2026-06-19)

A standing review of `src/lantern`, `src/lamplighter`, and `lib/advent`. These
are structural/design concerns (not feature gaps), ordered by how much they are
likely to constrain future work. Tracked as actionable items in `TODO.md`.

### A. Compiler front-end does regex prescans of raw source — RESOLVED (2026-06-19)
Previously `src/lantern/index.js` ran eight regex passes over raw file text to
build the name sets the parser needs up front. They stripped comments with a
naive `replace(/#.*$/, "")` (inconsistent with the tokenizer's string-aware
`stripComment` — e.g. a `#` inside a relation `syntax` template silently dropped
the template), re-encoded grammar fragments in regex, and were blind to
multi-line constructs.

Now `src/lantern/index.js` tokenizes each file once and runs
`prescanDeclarations` (`src/lantern/prescan.js`) over the token stream to collect
the same name sets, then parses from the same tokens via `parseTokens`
(`src/lantern/parser_rd.js`). The lexer runs exactly once per file and the
prescan shares its comment/string handling. Covered by `tests/prescan`
(`npm run test:prescan`). Remaining minor instance: `extractLibImports` (lib
dependency resolution, scans only the user file for `lib NAME`) still uses a
regex; it runs before the file set is known and is intentionally left as-is.

### B. Native JS ↔ Lamp boundary is bound by regex — RESOLVED (2026-06-19)
`gatherNativeJs` previously discovered native function names with a bare
`/\bfunction\s+NAME\s*\(/g` regex, which also matched the word in comments and
strings and matched nested function declarations — overstating what is callable,
so a `native function` declaration could pass validation yet fail at runtime.

It now uses `extractTopLevelFunctionNames` (`src/lantern/native_scan.js`), a
JavaScript surface scanner that skips line/block comments, string and template
literals, and regex literals, and tracks brace depth so only *depth-0* function
declarations (the ones inlined as callable globals) are collected. A native
function implemented only inside another function — or merely named in a comment
— is now a compile error (`native function "x" has no JavaScript implementation`)
instead of a runtime `ReferenceError`. Unit-tested in `tests/native_scan`; the
set extracted from the real lib files is unchanged, so the checker stays green.

### C. Lamplighter embeds the advent world model
The "general" runtime hardcodes advent-library concepts: `scopeOf`,
`resolvePool`, and `canBeAntecedent` are written in terms of the `holder` field
and the `physical` type; `run_command` (in `lib/sys/index.js`) calls
`getGlobal("player")`; `runAction` compares outcomes against the literal strings
`"succeeded"`/`"failed"` (which must match the `outcome` enum in
`lib/sys/kinds.lamp`); list formatting reads the magic global
`"USE OXFORD COMMA"`. `lib/sys` is therefore **not self-contained** — it depends
on names defined in `lib/advent`. A different world library cannot reuse the
parser/scope/loop without inheriting these assumptions. Either formalize the
contract (a documented "world model interface" the runtime requires) or push the
scope/antecedent logic down into library-provided hooks.

### D. The AST conflates bare object names with string literals — RESOLVED (2026-06-19)
A bare identifier used as a value parses to the same `StringLiteral` node as a
quoted string; the object-vs-string decision is made from the expected type at
the use site. That decision was duplicated across seven emitter sites with an
inconsistent `getObject` vs `checkedGetObject` split.

Now the predicate lives in one place — `valueIsObjectRef(valueNode, declaredType)`
— and one dispatch helper, `emitObjectOrValue(...)`, is used by all seven sites
(`emitGlobalDecl`, `emitRelationAssert`, `emitRelationQuery`, `emitRelationRemove`,
`emitTryCall`, `emitCallArgs`, and the object-decl field split via
`isObjectTypedField`). Validation is uniform: every object-typed value goes
through `checkedGetObject`, so unknown objects in call arguments, relation
queries, and relation removes are now compile errors (previously silent runtime
failures) reported at the call/use site. The checker additionally flags the
expression case the emitter can't see: a bare name compared (`==`) against an
object-typed expression that isn't a declared object (`checkObjectNameComparison`)
— catching `self.dropped == cloack`-style typos. Covered by golden fixtures
`call_unknown_object` and `compare_unknown_object`; output for all valid programs
is byte-identical (verified by the encode corpus and generated-JS comparisons).

Implementation note: the dispatch was centralized in the emitter (one predicate +
one helper) rather than by introducing a distinct `ObjectRef` AST node and
rewriting it in the parser/checker. That achieves the same outcomes — no
duplication, uniform compile-time validation — with byte-identical output and
without a compiler-wide node-kind change. A residual limitation: a typo on the
*object* side of a comparison whose other side is a bare object reference
(`ParenNameExpr`) or a global (both infer to no type) is not caught; only the
common field/local/return-typed side is.

### E. String escapes are not processed — RESOLVED (2026-06-19)
The tokenizer now resolves escapes when it builds a STRING token's value
(`unescapeString` in `src/lantern/tokenizer.js`): `\\`, `\"`, `\n`, `\t`, and
`\r` become their characters; any other `\X` keeps its backslash so a stray
backslash in prose is never lost. This is the single decode point, so the
emitter, the prescan's relation templates, and `--encode-strings` all see the
resolved value. Covered by `tests/tokenizer` (unit) and the `advent17` golden
fixture (embedded quote + newline + literal backslash, plaintext and encoded).

### F. Relations share the world-object instance registry
`defineRelation` registers each relation as an ordinary type, so relation
instances live in `instanceRegistry` alongside game objects. `scopeOf` and
`buildVocabIndex` iterate every instance, including relation edges (anonymous
edges have `name: null`, which `buildVocabIndex` indexes under the token
`"null"`). Harmless today (edges are never in scope and never physical) but it is
a latent correctness/perf smell: world scope iterates graph edges as if they
were objects. Consider a separate store for relation instances, or a tag the
iteration can skip.

### G. Smaller structural notes
- **Lib load order** — RESOLVED (2026-06-19). A library may now pin file load
  order with an optional `load.order` manifest (`src/lantern/liborder.js`,
  consumed by `gatherLampFiles`); listed files load first, the rest follow
  alphabetically (the unchanged default). Drift is caught — a manifest entry for
  a missing file is a compile error. Unit-tested in `tests/liborder`.
- **`deduplicateFunctions` silently dropped duplicates** — RESOLVED
  (2026-06-19). Two functions sharing a name and `when` condition in the *same
  file* now raise a compile error (cross-file repeats remain the intended
  library-override path). Golden fixture `function_dup`.
- **QUIT was case-sensitive** — RESOLVED (2026-06-19). `lib/advent/startup.lamp`
  now compares `to_lower(input) == "quit"`, so uppercase `QUIT` exits. Golden
  fixture `advent18`.
- **Dead artifacts removed** (2026-06-19): `lib/advent/gameloop.lamp_hide` and
  the unused `global list<string> words` in `lib/advent/globals.lamp`.
- **Emitter `currentBareStop` save/restore** — RESOLVED (2026-06-19). The JS a
  bare `stop` emits (`return lamplighter.HALT;` inside a phase/rulebook rule,
  `return;` elsewhere) is now a `bareStop` parameter threaded through
  `emitStatementList`/`emitStatementLines` (default `"return;"`; the two rule
  emitters pass the HALT form), replacing the module-level `let` that was
  hand-saved and restored around each rule. Output is byte-identical (encode
  corpus + generated-JS golden). The remaining module-level `let`s in the emitter
  and checker (`relationFieldSchemas`, `emitKindNames`, `mainFilePath`, etc.) are
  set-once per `emitProgram`/`checkProgram` call and never mutated mid-pass, so
  they are per-invocation config rather than the save/restore hazard; full
  reentrancy (concurrent compiles in one process) would still need them bundled.

