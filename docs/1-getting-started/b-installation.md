# Installation

## Requirements

- [Node.js](https://nodejs.org/). The toolchain is plain Node.js; the compiler
  and the terminal player have no runtime dependencies.

## Get the toolchain

Clone the Lamp repository, then from the repo root:

```sh
npm install
```

This installs the single dependency, [esbuild](https://esbuild.github.io/),
which only Lighthouse (the web bundler) uses. If you never build for the web,
you can skip it.

Sample games live in `sample/` — `sample/cloak.lamp` is a good first thing to
run.

## Run from the repo

Everything works directly from the repository, no install step needed:

```sh
# Compile a game (writes <input>.generated.js next to the source if you
# omit the output path):
node src/lantern/index.js sample/cloak.lamp build/cloak.generated.js

# Play a compiled game in the terminal:
node src/lamplighter/play.js build/cloak.generated.js

# Or compile and play in one step:
node src/lantern/exe.js sample/cloak.lamp
```

Equivalent npm scripts exist: `npm run compile -- …`, `npm run play -- …`,
`npm run exe -- …`, `npm run build:web -- …`.

## Install globally (optional)

The toolchain also installs as global commands. Pack a tarball and install
that:

```sh
npm pack                      # from the repo root; writes lampif-<version>.tgz
npm install -g lampif-0.1.0.tgz
```

Install from the tarball, not `npm install -g .` — npm symlinks a folder
install back to the clone instead of copying it.

This puts five commands on your `PATH`, usable from any directory. The
standard library ships inside the install, so you no longer need the clone:

| Command | What it does |
|---|---|
| `lantern <input.lamp> [output.js]` | compile a game |
| `lamplighter <generated.js>` | play a compiled game in the terminal |
| `lantern-exe <input.lamp>` | compile and play in one step |
| `lighthouse <input.lamp> [outDir]` | build a web bundle |
| `lighthouse-electron <input.lamp> [outDir]` | build an Electron project |

Per-game libraries resolve the same way as in the repo: from a `lib/` folder
next to your `.lamp` file. Uninstall with `npm uninstall -g lampif`.

## Compiler options

The common Lantern flags (they also pass through `lantern-exe`):

- `--release` — produce a release build, excluding debug verbs and tooling.
  The default is a debug build.
- `--locale <tag>` — select the language pack (default `en-US`). A
  `locale "…"` declaration in the source is used if the flag is absent.
- `--encode-strings` — obfuscate string literals in the output, so players
  can't read your game text out of the compiled file.

## Check it works

```sh
node src/lantern/exe.js sample/cloak.lamp
```

You should see the *Cloak of Darkness* banner and a `>` prompt. Type `look`,
wander around, and `quit` when done.

Next: [Your First Game](c-first-game.md).
