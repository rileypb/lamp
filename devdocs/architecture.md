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

### A. Compiler front-end does regex prescans of raw source
`src/lantern/index.js` runs eight regex passes over raw file text
(`extractGlobalNames`, `extractFunctionNames`, `extractRelationNames`,
`extractActionNames`, `extractObjectNames`, `extractActionTags`,
`extractRulebookParams`, `extractRelationTemplates`) and feeds the results into
`parseSource(... 8 name sets ...)`. The parser cannot stand on its own — it
depends on a prior text scan. Problems: (1) the prescans strip comments with a
naive `replace(/#.*$/, "")`, which is **inconsistent with the tokenizer's
string-aware `stripComment`** (a `#` inside a string literal on a
declaration-shaped line is mis-stripped); (2) they re-implement fragments of the
grammar in regex that must stay in sync with the real parser; (3) they are
line-oriented and blind to multi-line constructs. Intended direction: tokenize
once, run a lightweight token-level declaration pre-pass, then parse from tokens.

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

### E. String escapes are not processed
The tokenizer stores a string literal's **raw bytes**, backslashes included, and
the emitter passes them through `JSON.stringify`, which escapes the backslash
again. Result: `\n`, `\t`, and `\"` render literally, so prose **cannot contain
a double quote or a newline**. Escape decoding needs to happen once (tokenizer or
a dedicated unescape step) so `"a\"b"` and `"line1\nline2"` mean what they say.

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

