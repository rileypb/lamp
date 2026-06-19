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

### B. Native JS ↔ Lamp boundary is bound by regex
`gatherNativeJs` discovers native function names with
`/\bfunction\s+NAME\s*\(/g` over each lib `index.js`. This also matches
functions inside comments or strings and nested function declarations, and it is
the sole source of truth the checker uses to validate `native function`
declarations. A token/AST-aware scan (or an explicit export manifest) would make
the boundary robust.

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

### D. The AST conflates bare object names with string literals
A bare identifier used as a value parses to the same `StringLiteral` node as a
quoted string. The emitter then re-derives "is this an object reference?" from
the expected type at **seven** separate sites (`emitRelationAssert`,
`emitCallArgs`, `emitObjectDecl`, `emitTryCall`, `emitRelationQuery`,
`emitGlobalDecl`, `emitRelationRemove`), each duplicating the
`!PRIMITIVE && !kind && ...` test. Validation is also inconsistent: some sites
call `checkedGetObject` (compile-time "unknown object" error) while others emit a
bare `lamplighter.getObject(...)` that only fails at runtime. A resolved
`ObjectRef` vs `StringLiteral` distinction (decided once in the parser/checker)
would centralize both the dispatch and the validation.

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
- **Lib load order is alphabetical** (`gatherLampFiles` sorts each dir). Rule
  precedence within the library tier depends on filenames, an implicit and
  fragile contract layered under the explicit author(0)/library(1) ordering.
- **Emitter/checker keep module-level mutable state** (e.g. `currentBareStop`,
  hand-saved/restored around each rule). Not reentrant; a context object threaded
  through the emit functions would be safer.
- **`deduplicateFunctions` silently drops** an earlier same-signature function
  with no diagnostic, so an accidental duplicate across lib files vanishes quietly.
- **QUIT is case-sensitive**: the loop in `lib/advent/startup.lamp` compares
  `input == "quit"` against the raw prompt line, but the end screen says "type
  QUIT". Uppercase input is rejected with "I don't understand that."
- **Dead artifacts**: `lib/advent/gameloop.lamp_hide`, the unused
  `global list<string> words` in `lib/advent/globals.lamp`.

