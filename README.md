# Lamp

Lamp is an interactive fiction authoring and playing system. Authors write parser
IF games in the **Lamp language**; the toolchain compiles them to JavaScript and
packages them for distribution.

The system has three parts:

- **Lantern** — the compiler. It takes a `.lamp` game and emits a JavaScript
  program (an internal representation of the game).
- **Lamplighter** — the runtime library that executes a compiled game, handling
  player input, game state, and rendering. It includes a small CLI for playing a
  game in the terminal.
- **Lighthouse** — the bundler. It packages a compiled game and the runtime into a
  distributable web or Electron application.

See [`devdocs/architecture.md`](devdocs/architecture.md) for the full design and
[`devdocs/specs.md`](devdocs/specs.md) for the language specification.

## Requirements

- [Node.js](https://nodejs.org/) (the toolchain is plain Node.js with no runtime
  dependencies).
- `npm install` — installs the single dependency, [esbuild](https://esbuild.github.io/),
  which Lighthouse uses to bundle web builds. Lantern and the terminal player do
  not need it.

Sample games live in [`sample/`](sample/) (e.g. [`sample/cloak.lamp`](sample/cloak.lamp)).

## Install globally (optional)

Everything below runs straight from the repo, but the toolchain also installs as
global commands. Pack a tarball and install that:

```sh
npm pack                      # from the repo root; writes lampif-0.1.0.tgz
npm install -g lampif-0.1.0.tgz
```

Install from the tarball, not `npm install -g .` — npm symlinks a folder install
back to the clone instead of copying it.

This puts five commands on your `PATH`, usable from any directory; the standard
library ships inside the install, so the clone is no longer needed:

- `lantern <input.lamp> [output.js]` — compile a game
- `lamplighter <generated.js>` — play a compiled game in the terminal
- `lantern-exe <input.lamp>` — compile and play in one step
- `lighthouse <input.lamp> [outDir]` — build a web bundle
- `lighthouse-electron <input.lamp> [outDir]` — build an Electron project

Per-game libraries resolve exactly as they do in the repo: from a `lib/` folder
next to your `.lamp` file. Uninstall with `npm uninstall -g lampif`.

## Lantern: compile a game

Compile a `.lamp` source file to a JavaScript program:

```sh
node src/lantern/index.js <input.lamp> [output.js] [options]
# or via the npm script:
npm run compile -- <input.lamp> [output.js] [options]
```

If you omit `output.js`, Lantern writes `<input>.generated.js` next to the source.

Options:

- `--release` — produce a release build (excludes debug verbs/tooling). The default
  is a debug build.
- `--locale <tag>` — select the language pack (default `en-US`). A `locale "…"`
  declaration in the source is used if the flag is absent.
- `--encode-strings` — obfuscate string literals in the output.

Example:

```sh
node src/lantern/index.js sample/cloak.lamp build/cloak.generated.js
```

## Lamplighter: play a compiled game

Run a compiled `.generated.js` game in the terminal:

```sh
node src/lamplighter/play.js <generated.js>
# or:
npm run play -- <generated.js>
```

Example:

```sh
node src/lamplighter/play.js build/cloak.generated.js
```

### Compile and play in one step

`lantern-exe` compiles a `.lamp` file to a temporary directory (cleaned up on exit)
and immediately plays it. Compile flags after the input pass straight through to
Lantern:

```sh
node src/lantern/exe.js <input.lamp> [--release] [--locale <tag>] [--encode-strings]
# or:
npm run exe -- <input.lamp>
```

Example:

```sh
node src/lantern/exe.js sample/cloak.lamp
```

## Lighthouse: build a web game

Lighthouse compiles a game and bundles it with the runtime and a browser shell into
a self-contained web application:

```sh
node src/lighthouse/build.js <input.lamp> [outDir] [options]
# or:
npm run build:web -- <input.lamp> [outDir]
```

If you omit `outDir`, the bundle is written to `dist/<input>/`. The output contains
`index.html`, `shell.css`, `shell.js`, `sw.js` (service worker), and
`game.worker.js` (the compiled game running in a Web Worker).

Options:

- `--debug` — keep debug verbs/tooling. Web bundles are release builds by default.
- `--no-minify` — skip minification (useful for debugging the output).
- `--encode-strings` — obfuscate string literals in the bundle.

Example:

```sh
node src/lighthouse/build.js sample/cloak.lamp dist/cloak
```

### Serving the web build

The shell uses a service worker, so it must be served over HTTP — opening
`index.html` via `file://` will not work. Serve the output directory with any
static file server, for example:

```sh
npx serve dist/cloak
# or:
cd dist/cloak && python3 -m http.server 8000
```

Then open the printed URL in a browser.

## Tests

```sh
npm test            # golden-output compiler tests
npm run test:sandbox
npm run test:lighthouse
# ...see package.json for the full list of test suites
```
