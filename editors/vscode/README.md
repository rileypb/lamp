# Lamp Language — VS Code support

Syntax highlighting for `.lamp` files (the Lamp interactive-fiction authoring
language). This is a declarative TextMate-grammar extension: no build step and no
runtime dependencies.

## Files

- `package.json` — extension manifest; registers the `lamp` language and grammar.
- `language-configuration.json` — comments (`#`), bracket pairs, indentation rules.
- `syntaxes/lamp.tmLanguage.json` — the TextMate grammar (tokens → scopes).

## Try it locally

1. Open this folder (`editors/vscode/`) in VS Code.
2. Press `F5` ("Run Extension") to launch an Extension Development Host.
3. Open any `.lamp` file (e.g. `sample/cloak.lamp`) and confirm coloring.

Alternatively, from a terminal:

```sh
code --extensionDevelopmentPath="$PWD/editors/vscode" sample/cloak.lamp
```

## Install persistently

Package to a `.vsix` and install it (requires the `@vscode/vsce` CLI, run via
`npx`, so nothing is added to this repo's dependencies):

```sh
cd editors/vscode
npx @vscode/vsce package
code --install-extension lamp-language-0.0.1.vsix
```

## Token model

The grammar tracks the compiler's own definitions so highlighting does not drift:

- Reserved keywords mirror `KEYWORDS` in `src/lantern/tokenizer.js`.
- Phase-rule bands (`before`/`after`/`instead`/`check`/`report`/`do`) mirror
  `PHASE_WORDS` in `src/lantern/parser_rd.js`.
- Strings, escapes (`\\ \" \n \t \r \u{…}`), and `#` comments mirror the
  tokenizer's string/comment handling.
- `[…]` bracket substitutions inside strings (e.g. `[line break]`, `[par]`) are
  scoped as template expressions.

### Known divergences / open questions

- **Multi-line strings.** The tokenizer currently requires a string to close on
  its own line, but some sample files use strings that span lines. The grammar is
  deliberately tolerant (a string runs until the next `"`). Revisit if the
  language formally settles single- vs. multi-line strings.
- **Kind names.** `room`, `item`, etc. are library-defined, not reserved, so
  `room Foyer:` declarations are matched heuristically (lowercase kind word +
  name at line start).
