# Lighthouse — Web Packaging

> Status: design. First target is the **static web bundle**; Electron is
> deferred. Lighthouse is the packager only — it imports Lamplighter's worker
> bootstrap, channel protocol, and capability allowlist rather than
> reimplementing them. See `devdocs/sandbox.md` for the execution/isolation model
> and the Lamplighter-vs-Lighthouse ownership line this doc builds on.

## Purpose

Take a compiled Lamp game (Lantern output) plus the Lamplighter runtime and any
native library JS, and produce a distributable artifact a player can open in a
browser. Lighthouse adds only the **shell, the browser-`Worker` adapter
packaging, and the cross-origin-isolation headers** on top of Lamplighter; all
game logic and the capability boundary remain in Lamplighter's worker.

## Boundaries

- **In scope (this iteration):** the static web bundle — HTML/CSS/JS shell, the
  browser `Worker` adapter, the build step that produces the bundle, and the
  cross-origin-isolation mechanism.
- **Out of scope (deferred):** Electron wrapping (same HTML shell, different
  packaging and capability backing — pulled forward later); the platform's
  per-author permission *policy*; any change to the Lamp language or the
  Lamplighter channel protocol.

## Inputs and Outputs

- **Input:** a Lantern-emitted body-only game module, the Lamplighter runtime,
  and zero or more native library `index.js` files (Tier 1: inlined).
- **Output:** a **directory bundle** the player opens in a browser. The bundle is
  self-hosting on a dumb static host (GitHub Pages, itch.io, S3) — no server
  configuration required.

## Decisions (web v1)

1. **Cross-origin isolation via a bundled service worker.** `SharedArrayBuffer`
   (the synchronous-input bridge from sandbox.md) requires the page be
   cross-origin isolated (`COOP: same-origin`, `COEP: require-corp`). Rather than
   demand server header configuration, the bundle ships a **service worker that
   synthesizes these headers**, so the artifact runs on any static host. The
   server-header path and an async-input fallback are explicitly *not* the
   primary mechanism; async input would diverge from dev-parity and Lamp's
   blocking semantics.

2. **esbuild as the build-time bundler.** The Lamplighter runtime is CommonJS and
   the dev worker relies on `vm`/`fs`/`worker_threads`, none of which exist in a
   browser `Worker`; `importScripts` is stripped at startup, so nothing can be
   fetched at runtime. The runtime and the compiled game are therefore **baked
   into a browser worker bundle at build time** by esbuild (new devDependency,
   approved). In the browser, the `Worker` boundary itself *is* the restricted
   context that `vm.runInContext` provides in dev — author code gets a `require`
   shim that throws and `lamplighter` injected as a free global, with network/
   code-loading globals stripped at worker startup by Lamplighter's bootstrap.

3. **Capability surface: output, synchronous input, and persistent save.** Matches
   the dev sandbox (`print`/`write` out; brokered `readLine`/prompt in over
   SAB+Atomics) plus a brokered **save channel** (`setSaveChannel`) the shell backs
   with **localStorage** over a second shared buffer — the same broker shape as
   input. SAVE/RESTORE therefore work in the browser; named slots persist per game
   across reloads. File export/import (download/upload) is a possible later
   addition. See `devdocs/state.md`.

4. **Artifact shape: directory bundle.** `index.html` + shell script + browser
   worker bundle + service worker. A single inlined HTML file is rejected because
   the `Worker` and service worker both need their own script URLs.

## Build Step (`npm run build:web -- <game.lamp> [outDir]`)

Built in `src/lighthouse/`: `index.js` (the `buildWeb` logic) and `build.js` (a
thin CLI). Steps:

1. Compile the game to a body-only module via the standard Lantern CLI (no
   pipeline reimplementation). A web bundle is a distribution build, so Lighthouse
   compiles with **`--release`** by default — files marked `not_for_release` (advent's
   debug verbs, a game's debug shortcuts) are excluded, so a shipped bundle can't be
   cheated past puzzles. `--debug` opts back in (for testing the shell against the tools).
2. Wrap that module as the bootstrap's `runGame(function (lamplighter, require,
   console) { … })` factory, binding the emitted code's free globals to the
   controlled values. esbuild leaves the shadowed `require` (renamed to avoid its
   own bundler require) intact, so a native lib's `require("fs")` reaches the
   throwing shim at runtime instead of being resolved at build time.
3. esbuild-bundle the wrapped entry + `worker-browser.js` + the runtime into one
   `game.worker.js` (`format: iife`, `platform: browser`). The runtime has zero
   `require`s and touches `process` only inside the default `writeImpl` (replaced
   by `setWrite` before any game code runs), so it bundles and loads cleanly.
   Minified by default (`--no-minify` to opt out): roughly halves the bundle
   (~66 KB → ~33 KB for cloak), mangles local identifiers, and strips comments.
   Safe with the sandbox `require` shadow (esbuild renames consistently) and
   leaves property names like `lamplighter.decode` intact; composes with
   `--encode-strings`.
4. Copy the game's declared image assets (devdocs/freestyle-windows.md) from the
   meta sidecar's `assets` list into `assets/<name>.<ext>` and write
   `assets.json` (image name → bundle-relative path). The manifest is always
   written — `{}` for an imageless game — so the shell's boot fetch never
   depends on what the game declares.
5. Copy the shell assets (`index.html`, `shell.css`, `shell.js`, `sw.js`) into
   the output directory. `index.html` is the one templated asset: its `<title>`
   is set to `Title by Author` (or just the title, or `Lamp Game` as fallbacks).
   The title/name/author come from a **game-identity sidecar** Lantern writes when
   invoked with `--meta <path>` (Lighthouse passes it) — read from the parsed AST, so
   the display `title` field is used (the game's identifier can't hold spaces or
   punctuation), falling back to the identifier when no `title` is set. This replaces
   an earlier lossy source re-scan and removes Lighthouse's dependency on the Lantern
   tokenizer.

Default output directory is `dist/<game-name>/`.

## Continuous deployment (GitHub Pages)

`.github/workflows/deploy-pages.yml` publishes the sample games to GitHub Pages
on every push to `main` (and on manual `workflow_dispatch`). GitHub serves one
Pages site per repo, so **multiple games ship in a single deployment as
subdirectories of one artifact** rather than as separate deployments. Two
publication policies coexist:

- **Rebuilt from source each push** (the Cloak samples + Phobos EX):
  `sample/cloak.lamp` → `dist/cloak` (served at `<pages>/cloak/`),
  `sample/cloak_fr.lamp` → `dist/cloak_fr` (`<pages>/cloak_fr/`), and
  `sample/phobos_ex/phobos_ex.lamp` → `dist/phobos_ex` (`<pages>/phobos_ex/`),
  all with `--encode-strings`. This also doubles as a live check that
  Lighthouse still builds on `main` — EX additionally exercises the
  custom-shell packaging (its `phobos_ex.shell/` map + KIM layer rides the
  bundle; devdocs/custom-shells.md).
- **Pre-built, committed bundle** (Phobos): the workflow **copies**
  `sample/phobos/web/` → `dist/phobos` without rebuilding, so ongoing Lamp
  changes on `main` can never break the published game — Phobos intentionally
  trails Lamp revisions. To update it, run **`npm run build:phobos`** (builds
  `sample/phobos/phobos.lamp` → `sample/phobos/web` with `--encode-strings`,
  release mode) and commit the bundle.

The workflow then writes a small `dist/index.html` landing page linking to all
games and uploads the whole `dist/` via `actions/upload-pages-artifact` /
`actions/deploy-pages`. This works because a bundle uses only **relative** URLs
and registers its service worker at `./sw.js`, so its scope is its own
subdirectory — each game gets isolation headers within its subpath and the
service workers don't collide. To add another game, add a build (or copy) step
into a new `dist/<name>` and a link on the landing page. No server header
configuration is needed: each bundle's service worker synthesizes the
cross-origin-isolation headers (see below), so `SharedArrayBuffer` is available
on plain Pages. Pages must be enabled for the repo with **Build and deployment →
Source: GitHub Actions**.

## String encoding (`--encode-strings`)

Optional spoiler-hiding for distribution builds: `npm run build:web -- <game.lamp>
--encode-strings` (passed through to Lantern) encodes player-facing prose so a
casual reader cannot lift room text, messages, and endings straight out of
`game.worker.js`. Lantern wraps prose literals — **plus object, global, action, type, and relation
names, and grammar/relation-syntax templates** (the player-visible command
phrasing) at every reference site — as `lamplighter.decode("…")` over an
XOR+base64 payload (`src/strcodec.js`); kind names, enum labels, rulebook/event
names, and field keys stay plaintext. Strings inside a native library's
`index.js` are not encoded (the emitter does not rewrite native JS), so a name a
native lib references by literal still leaks — in `lib/advent` today: the relation
names `connects`/`doorway` (the door subsystem's `wire_doors`/scope-provider), the
type names `door`/`item` (`type("…")` lookups), and the `oxford comma`/`viewpoint …`
globals (the list formatter + viewpoint). These are framework names identical across
every advent game, not author content, so they reveal nothing game-specific; the
author's prose and own names are still encoded. (Closing this gap — encoding the
name literals inside inlined native JS — is backlogged; see TODO.) Encoding names is safe because `decode` runs at load, so the
runtime registry keys are unchanged. It is **not** security — the decoder and key
ship in the same bundle, so it only raises the bar against casual `view-source`
snooping (note: strings inside native `index.js` are not encoded). Off by
default; the build's default `minify` (above) handles the code itself (including
the readable `const <objectName>` bindings), and the two compose. See
`devdocs/specs.md` → Compiler pipeline.

## Cross-origin isolation (service worker)

`src/lighthouse/web/sw.js` re-fetches each request and returns it carrying
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy:
require-corp`, and `Cross-Origin-Resource-Policy: cross-origin`, so the page is
cross-origin isolated (and `SharedArrayBuffer` available) on any static host with
no server configuration. `index.html` registers the worker before the shell runs
and reloads once when the worker takes control — the worker controls the page
only after it activates, so the first visit loads un-isolated and the reload
brings it back isolated. If already isolated, registration is a no-op.

## Shell

Built in `src/lighthouse/web/` as the bundle's template assets:

- `index.html` — scrolling transcript + a single input line.
- `shell.css` — minimal parser-IF terminal styling; `white-space: pre-wrap` so IF
  column/indent formatting survives.
- `shell.js` — the main-thread host. Constructs the `SharedArrayBuffer`, spawns
  `game.worker.js`, posts `init`, relays `print`/`write` as **text nodes only**
  (never `innerHTML`), routes `log` to the console, and services
  `readline`/`prompt_readline` by capturing one line asynchronously (Enter to
  submit), echoing it, and filling the buffer (`Atomics.store` +
  `Atomics.notify`). It never blocks — the worker blocks on `Atomics.wait` while
  the main thread stays responsive. If the page is not cross-origin isolated it
  refuses to start with a notice rather than failing on `SharedArrayBuffer`
  construction.
- **Inline input.** The input field is the permanent tail element of
  `#transcript`; output is inserted *before* it, so the caret always sits inline
  right after the last output. The game's own prompt (e.g. `prompt("> ")`) is the
  single prompt — there is no separate bottom-pinned prompt.
- **Canvas (freestyle) panes** (devdocs/freestyle-windows.md): the shell
  advertises `kinds: ["text", "canvas"]`, renders a canvas pane's draw list onto
  a `<canvas>` in the ordinary dock layout (scale-to-fit the declared virtual
  space, DPR-aware, `fillText` only), resolves image ops through the bundle's
  `assets.json`, and paints named colors via the `--c-*` theme variables.
- **Custom shells** (devdocs/custom-shells.md): a `<game>.shell/` directory
  beside the game file customizes the bundle — root files matching stock asset
  names override them (the "eject" path; `--eject-shell` seeds the directory),
  everything else copies verbatim, and `custom.js`/`custom.css` get tags
  injected into `index.html` when present. The stock shell exposes the
  `LampShell` hook global (`on(name, fn)` for the game's `shell_send` events,
  `command(cmd)` to synthesize input) and declares `shell: true` in
  capabilities exactly when the bundle carries a `custom.js`.
- The shell contains no game logic — render, capture input, broker, nothing more.

## Assumptions

- The browser worker boundary is sufficient isolation on its own; Lighthouse does
  not replicate the dev `vm` context in the browser.
- Lamplighter's bootstrap, channel protocol, and capability allowlist are reused
  unchanged; Lighthouse adds shell + adapter packaging + headers only.

## Non-Goals

- Electron packaging (deferred; same shell later).
- Any brokered capability beyond output and input for v1.
- Reimplementing or forking the worker bootstrap or capability list.

## Built

- **Browser `Worker` bootstrap** — `src/lamplighter/sandbox/worker-browser.js`,
  the browser analogue of `worker.js`. Lamplighter-owned (lives under
  `src/lamplighter/sandbox/`); Lighthouse only packages it. It strips the
  network/code-loading globals (`fetch`, `XMLHttpRequest`, `WebSocket`,
  `importScripts`, `EventSource`), drives the same `setPrint`/`setWrite`/
  `setInputChannel`/`setPromptChannel` seam over `postMessage` + a
  `SharedArrayBuffer`/`Atomics` input bridge (identical buffer layout to the
  stdio host), and hands author code the same throwing `require` shim and bridged
  `console` as the dev path. The build step registers the wrapped body-only game
  via the exported `runGame(factory)` entry; the game starts only after the
  host's `init` message delivers the shared input buffer.

## Status

Web v1 is built, smoke-tested, **verified live in a browser** (service worker
registers, page becomes cross-origin isolated, the full loop plays), and — since
2026-07-01 — **end-to-end tested headlessly in CI** with no browser dependency:
`npm run test:lighthouse` drives the built (minified) worker bundle through the
real wire protocol via `tests/lighthouse/drive-bundle.js`, which hosts
`game.worker.js` in a Node `worker_thread` behind a `self` shim (Node supplies
`SharedArrayBuffer`/`Atomics`/`TextDecoder`) and plays the shell's side: SAB
input fill, `save_prompt`/`restore_prompt` modal replies, `save_write`/
`save_read` storage, and `transcript_*` accumulation. The e2e test covers play,
SAVE/RESTORE through the picker protocol, transcript capture (with the
closing-message-is-screen-only contract), RESTART + confirmation, and a clean
`done`. The one layer no headless check reaches is `shell.js`'s own DOM behavior
(modals, scrolling, [more] paging, the transcript download click) — that stays a
manual browser pass.

## Open Questions

- **Shell/UX polish.** Minor details observed in the first live run remain to be
  pinned down and fixed (to be enumerated).
- **`lamp build` CLI surface.** Currently `npm run build:web -- <game.lamp>
  [outDir]`. Confirm the eventual unified `lamp` command name and whether it also
  accepts pre-compiled output.
- **Electron target.** Same shell, different packaging and capability backing;
  deferred. Confirm it reuses this bundle's shell and the worker bootstrap.
