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

3. **Capability surface: output + synchronous input only.** Matches the current
   dev sandbox exactly (`print`/`write` out; brokered `readLine`/prompt in over
   SAB+Atomics). Persistent save (localStorage or download) stays deferred,
   consistent with the existing save/restore TODO.

4. **Artifact shape: directory bundle.** `index.html` + shell script + browser
   worker bundle + service worker. A single inlined HTML file is rejected because
   the `Worker` and service worker both need their own script URLs.

## Build Step (`lamp build`, web target)

1. Compile the game with Lantern (or accept already-compiled output).
2. esbuild the browser worker bundle = Lamplighter runtime + Lamplighter's
   browser-`Worker` adapter + the body-only game module + inlined native JS.
3. Emit the directory bundle: `index.html`, shell JS (renders text-node output,
   captures input, services the capability broker), the worker bundle, and the
   COOP/COEP service worker.

## Shell

Built in `src/lighthouse/web/` as the bundle's template assets:

- `index.html` — scrolling transcript + a single input line.
- `shell.css` — minimal parser-IF terminal styling; `white-space: pre-wrap` so IF
  column/indent formatting survives.
- `shell.js` — the main-thread host. Constructs the `SharedArrayBuffer`, spawns
  `game.worker.js`, posts `init`, relays `print`/`write` as **text nodes only**
  (never `innerHTML`), routes `log` to the console, and services
  `readline`/`prompt_readline` by capturing one line asynchronously, echoing it,
  and filling the buffer (`Atomics.store` + `Atomics.notify`). It never blocks —
  the worker blocks on `Atomics.wait` while the main thread stays responsive. If
  the page is not cross-origin isolated it refuses to start with a notice rather
  than failing on `SharedArrayBuffer` construction.
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

## Open Questions

- **Service-worker first-load.** A service worker controls the page only after
  its first navigation; the very first load may not be cross-origin isolated.
  Decide the reload/registration strategy (e.g. auto-reload once the SW is
  active).
- **`lamp build` CLI surface.** Exact command name, inputs (raw `.lamp` vs.
  pre-compiled), and output path conventions.
