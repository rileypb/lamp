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

## Lighthouse

Lighthouse is the bundler that takes the compiled game and the Lamplighter runtime and packages them into a single executable. It can produce either a standalone Electron application or a web application that can be distributed to players. Lighthouse ensures that all necessary dependencies are included and optimizes the final output for performance and size.

## Terms

- **Lamp**: The language used to write interactive fiction games.
- **Lantern**: The compiler that translates Lamp code into JavaScript.
- **Lamplighter**: The runtime library that executes the compiled game.
- **Lighthouse**: The bundler that packages the compiled game and runtime into a distributable format.
- **Lamp Parser**: The component of Lantern responsible for parsing the Lamp source code.
- **Game Parser**: The parser that processes player commands and translates them into actions within the game world.

