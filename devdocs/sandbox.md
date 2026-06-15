# Sandbox & Native Execution Model

> Status: design. This subsystem is not yet implemented. It describes the
> intended execution and isolation model for compiled games, with emphasis on
> native library JavaScript and on keeping development behavior identical to
> packaged (Lighthouse) behavior.

## Purpose

A compiled Lamp game is JavaScript. Today a native library's `index.js` is
inlined verbatim into the generated program and runs with the full privileges
of the host process or page (see `devdocs/specs.md`, "Native libraries").
For terminal play and single-author self-hosted web builds this is acceptable,
because the author already controls the execution environment. It becomes a
risk when a platform hosts multiple authors' games on a shared origin: one
author's native JavaScript can reach another game's DOM, storage, and network.

This document defines the isolation boundary that contains a running game, the
communication layer across that boundary, and the rule that keeps development
and packaged execution behaving the same so authors do not discover capability
restrictions only at deploy time.

## Boundaries

- **In scope:** where compiled game code (Lamp + Lamplighter + native lib JS)
  executes; what capabilities that code is granted; how it communicates with the
  surrounding host (terminal CLI, Electron shell, or web page); how Lantern and
  Lamplighter change to support this.
- **Out of scope:** the Lighthouse bundling format, the platform's per-author
  permission policy (the capability-broker *policy*, as opposed to its
  *mechanism*), and any change to the Lamp surface language. Native calls remain
  synchronous and source-compatible.

## Inputs and Outputs

- **Input:** a compiled game module (emitted by Lantern), the Lamplighter
  runtime, and zero or more native library `index.js` files.
- **Output:** a running game confined to a sandbox, exchanging only structured
  messages and shared-memory values with the host across a defined channel set.

## Core Model

The unit of sandboxing is the **whole game**, native library JavaScript
included — not a boundary drawn between compiled Lamp code and native code.

A running game executes inside a single **game worker**:

- In a web build, a `Worker` (browser).
- In development and the CLI, a `worker_threads` Worker (Node).

A game worker has no DOM by construction. At worker startup, before any author
code (compiled game or native lib) runs, the runtime **strips network and code-
loading globals**: `fetch`, `XMLHttpRequest`, `WebSocket`, `importScripts`, and
their equivalents. Native library JavaScript is therefore contained whether or
not it is inlined, because it cannot reach the host page or open its own network
connections.

Because native code is already contained by the game-worker boundary, **native
function calls stay in-process and synchronous**. No cross-isolate RPC, no value
marshalling, and no change to the emitted call site are required for native
calls themselves. The communication layer that matters is **game worker ↔
host**, not Lamp ↔ native.

### Two tiers

- **Tier 1 (the model defined here):** one game worker per game; native lib JS
  runs inside it, inlined and synchronous; dangerous globals stripped at startup.
  Each game is its own opaque worker context, so authors are isolated from each
  other and from the platform. This contains the cross-author threat.
- **Tier 2 (deferred, non-goal for now):** native lib JS in a *separate* worker
  behind a synchronous RPC bridge. This would protect a game's own runtime
  integrity from its own native lib — not a cross-author threat, since each game
  is single-author. Deferred until a concrete need arises. See Open Questions.

## Communication Layer

The game worker talks to the host across a message boundary. Four logical
channels:

1. **Output (`print`)** — game → host, asynchronous message. The host renders
   received text as a text node (`textContent` / `createTextNode`), never as
   HTML. This holds even though the text is the author's own, as defense in
   depth.
2. **Input (read player command)** — host → game, synchronous *from the game's
   point of view*: the game parser loop blocks until the player submits a
   command. Because the game runs in a worker, it blocks with `Atomics.wait` on
   a shared input buffer that the host fills on submit. This is the one place the
   design relies on `SharedArrayBuffer`.
3. **Capability broker** — for native libraries that legitimately need a
   privileged action (HTTP request, persistent save, audio). Instead of raw
   `fetch` or file access, native code calls a Lamplighter-provided function that
   forwards the request to the host, where the *platform* decides allow or deny.
   This is what lets the runtime strip raw network globals without crippling
   legitimate libraries.
4. **Lifecycle** — setup, teardown, and error reporting over ordinary messages.

Output and lifecycle are asynchronous messages; input uses the shared buffer so
Lamp's synchronous semantics are preserved without any language change.

## Host Environments

Each environment that runs a game is a pairing of two layers, which must not be
conflated:

1. **Host shell** — the surrounding UI: it renders output as text nodes,
   captures player input, and services capability-broker requests. It contains no
   game logic.
2. **Game-worker transport adapter** — the worker side of the boundary, part of
   Lamplighter: either a Node `worker_threads` Worker or a browser `Worker`. It
   carries the channel set defined above.

There are three environments, but only two host-shell codebases:

| Environment | Host shell        | Worker adapter            | Synchronous input             |
| ----------- | ----------------- | ------------------------- | ----------------------------- |
| Dev CLI     | thin stdio        | `worker_threads`          | shared buffer, no header gate |
| Web         | HTML/CSS/JS       | browser `Worker`          | shared buffer, needs COOP/COEP |
| Electron    | HTML/CSS/JS       | browser `Worker` (Chromium) | shared buffer, headers controlled by app |

- **One shell, two packagings.** The web and Electron host shells are the same
  HTML/CSS/JS shell, because Electron's renderer is Chromium. They differ only in
  packaging (static bundle vs. Electron app) and in what the capability broker is
  allowed to grant: Electron can back a "save to disk" capability with real `fs`,
  while a web build offers only `localStorage` or a download. The broker
  *protocol* is identical; only its *backing* differs.
- **Electron uses the browser-`Worker` adapter.** Electron exposes both Node and
  Chromium, so it could use either adapter. It must use the browser `Worker` path
  so its boundary behavior matches the web build; otherwise Electron silently
  diverges from what web players experience.
- **Shared-memory input only constrains the browser-`Worker` environments.** The
  dev CLI's `worker_threads` adapter gets `SharedArrayBuffer` without any header
  requirement, so development cannot surface a COOP/COEP misconfiguration.
  Capability parity (the point of the dev sandbox) still holds; only that one
  header constraint is invisible in development.

All shells stay deliberately thin — render, capture, broker, nothing more. All
game logic lives in the worker.

## Development / Packaging Parity

The guiding rule: **the sandboxed launcher is the only blessed way to run a
game, in development and in production.** There is no supported "raw `node`
generated.js" path, because that path runs with full process privileges and
would let an author build against capabilities the packaged web build will not
have.

Mechanism:

- Lamplighter exposes a **transport abstraction** with two implementations
  behind one interface: a browser `Worker` (web) and a Node `worker_threads`
  Worker (development/CLI). Both implement the same channel set, the same message
  protocol, and the same shared-buffer input bridge.
- The standard run path (for example, a `lamp play GAME.lamp` command) compiles
  and then **launches the game inside the worker sandbox**, rather than executing
  the emitted file directly on the main thread.
- **Capability surface, not just protocol, must match.** A browser worker has no
  `require`, no `fs`, no `process`; a Node `worker_threads` worker has all three.
  The development native sandbox therefore loads author native code in a
  restricted scope (for example, `vm.runInContext` with a curated global object,
  or a function scope with no module bindings) that denies `require`, `process`,
  and `fs`, and strips `fetch` and other network globals — mirroring the browser
  worker's capabilities. A native lib that reaches for a forbidden capability
  fails on the author's first local run, not at deploy time.

This relies only on platform built-ins — `worker_threads`, `vm`,
`SharedArrayBuffer`, `Atomics` — and introduces no new npm dependency.

## Dev-First Implementation

A dev-only sandbox (terminal CLI host + `worker_threads` adapter, web and
Electron deferred) is the first deliverable. Its scope is shaped by how player
input works today.

### Status

Built (in `src/lamplighter/sandbox/` and `src/lamplighter/play.js`, run via
`npm run play`):

- The `worker_threads` game worker with a restricted `vm` context: the runtime is
  injected as the only `require` target; `process`, `Buffer`, `fetch`, and timers
  are withheld. Native code reaching for `require("fs")` fails at the boundary.
- The stdio host relays `print` to stdout and bridged `console` to stderr.
- Synchronous player input as a brokered capability: the host owns stdin, the
  worker blocks on `SharedArrayBuffer` + `Atomics.wait`. `readline` in
  `lib/sys/index.js` now delegates to `lamplighter.readLine()` rather than calling
  `fs.readSync` directly.
- The sandbox launcher is the only supported run path. `npm run exe` and the
  golden runner both compile and then launch through the stdio host;
  `lamplighter.readLine()` throws if no input channel is installed, so running a
  generated file directly with `node` is no longer supported.
- The emitter produces a body-only module (no shebang, no runtime require); the
  launcher injects `lamplighter` as a context global.

### Input is currently a raw-capability native function

Player input is not part of Lamplighter. It is supplied by a native library that
reads standard input synchronously:

```js
// tests/fixtures/lib/interactivetest/index.js
function readline() {
    const fs = require("fs");
    const buf = Buffer.alloc(1);
    const n = fs.readSync(0, buf, 0, 1);  // blocking read of fd 0
    ...
}
```

Lamp calls it synchronously inside a handler (`let line = readline()` in
`tests/fixtures/interactive1.lamp`). The golden runner feeds stdin via
`execFileSync(..., { input })`.

This is exactly the capability set the sandbox denies — `require` and `fs` —
so it is a concrete demonstration of why input must become a **brokered host
capability** rather than raw native I/O. Under the sandbox, the game runs in the
worker, the host keeps stdin, and `readline` must be a Lamplighter-provided
function that obtains a line from the host.

### Synchronous input across the worker boundary

`readline` is synchronous from the game's point of view, today and inherently
(parser IF blocks for a command). Once the game is in the worker, a synchronous
`readline` must cross worker → host: the worker blocks on `Atomics.wait` while
the host performs the blocking stdin read and fills a shared buffer.

The cross-origin-isolation constraint on `SharedArrayBuffer` (`COOP`/`COEP`) is
**browser-only**. Node `worker_threads` gets shared memory with no headers, so
the input channel is fully buildable in dev without that constraint. COOP/COEP
re-enters only when the browser `Worker` adapter is built.

### Scope (Path B — chosen)

The input channel is built as part of the dev sandbox:

- Add the `SharedArrayBuffer` + `Atomics` worker → host synchronous read.
- **Retire the native `readline` in favor of a Lamplighter-provided `readline`**
  — the first real capability broker.

This is more up-front work than an output-only first cut, but the sandbox can run
real (interactive) games, and the synchronous-input machinery is built in the
cheapest environment (no browser header constraints) before web piles on.

The rejected alternative (output-only first) would have proved the boundary
without the input channel, but could not run the interactive fixtures
(`interactive1`, `interactive2`, `advent2`), leaving them on the legacy path.

This forces one decision previously deferred: **input stops being a native
`fs.readSync` and becomes a brokered host capability.** The `interactivetest`
fixture (and any real input primitive) must be rewritten against the new
`readline`; that rewrite is the template for every later privileged capability.

### Ownership: Lamplighter vs. Lighthouse

The dev run path is **not** a Lighthouse responsibility. Lighthouse's job is
producing a distributable artifact (Electron app, static web bundle with its HTML
shell and `COOP`/`COEP` headers). The dev path produces nothing shippable — it
compiles, spawns a worker, loads runtime + game into the restricted context, and
wires the stdio host. It is a launcher, not a packager.

The ownership line is drawn at the transport seam, and it is what makes the
dev-parity guarantee real rather than aspirational:

- **Lamplighter owns** (shared by every host): the transport interface and
  channel protocol; the **worker bootstrap** — restricted `vm` context,
  capability allowlist, and the `SharedArrayBuffer` + `Atomics` input bridge; and
  the **terminal/stdio host** that is the dev run path.
- **Lighthouse owns** (distribution only): the HTML shell, browser `Worker`
  adapter packaging, `COOP`/`COEP` header configuration, and Electron wrapping. It
  *imports* Lamplighter's bootstrap rather than reimplementing it.

If Lighthouse grew its own copy of the bootstrap or capability list, a web build
could allow or deny something the dev sandbox did not — the exact surprise this
design exists to prevent. Everything built for Path B (worker bootstrap,
restricted context, stdio host, `readline` broker, SAB input bridge) lands in
Lamplighter and is reused unchanged by Lighthouse, which adds only the shell,
adapter, and headers on top.

## Compiler / Runtime Changes Implied

- Native `index.js` is still inlined into the emitted module (Tier 1): one
  restricted context holds both the compiled game and native code, so the
  capability boundary comes from the context, not from separating native out.
  (Separating native into its own context is a Tier 2 concern only.)
- The emitter produces a **body-only module** — no `#!` shebang and no
  `require("…/lamplighter")` line. The launcher injects `lamplighter` as a context
  global, which inlined native code and the compiled game reference as a free
  variable. A bare `require` of anything else (notably `require("fs")`) is denied
  by the context's `require` shim.
- The static checker is unaffected: it continues to read `native function`
  signatures from `.lamp` files for type checking.
- Lamplighter's `print` and player-input paths route through the transport's
  channels instead of `console.log` / terminal readline directly; the terminal
  CLI is one host implementation of the transport.

## Assumptions

- Each game is authored by a single party; native lib JS is trusted *by that
  game's own author* but not by the platform or by other authors.
- Preserving Lamp's synchronous native-call and blocking-input semantics is
  required; the language does not gain async constructs.
- A web host able to serve cross-origin-isolation headers is available for builds
  that use shared-memory input (see Open Questions).

## Non-Goals

- Isolating native lib JS from its own game's runtime (Tier 2).
- Defining the platform's permission policy for the capability broker.
- Sandboxing the terminal CLI against the local author's own machine; the CLI
  host runs with the author's privileges by design.
- Any change to the Lamp surface language.

## Open Questions

- **Cross-origin isolation.** `SharedArrayBuffer` requires the page be
  cross-origin isolated (`COOP: same-origin`, `COEP: require-corp`). Web builds
  using synchronous input must be served with these headers, or fall back to an
  asynchronous input loop. Some static hosts cannot set headers; a service worker
  can synthesize them. Which path does Lighthouse target first?
- **Object-typed native parameters.** In Tier 1 a native function can receive a
  live Lamplighter object directly. A future Tier 2 boundary could not pass live
  references and would need handles plus callbacks. Confirm Tier 1 keeps live
  objects so a later Tier 2 is not silently assumed.
- **Capability-broker manifest.** How does a native library declare which
  privileged actions it needs, and how does the platform grant or deny them? This
  likely warrants its own spec section.
- **Electron host.** Where does the Electron target sit between the trusting
  terminal CLI and the strict web build? Confirm it uses the same transport with
  a host-configured capability set.
