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

## Compiler / Runtime Changes Implied

- Lantern stops inlining native `index.js` into the emitted module. The launcher
  loads native source into the sandbox's restricted context at startup and
  registers functions by name; emitted call sites resolve against those
  registered names already in scope inside the worker. For Tier 1 the emitter
  changes little beyond no longer inlining.
- The static checker is unaffected: it continues to read `native function`
  signatures from `.lamp` files for type checking. Only the *delivery* of the
  implementation moves.
- Lamplighter's `print` and player-input paths route through the transport's
  channels instead of `console.log` / terminal readline directly; the terminal
  CLI becomes one host implementation of the transport.

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
