# Runtime Errors & Diagnostics

> Status: **design + first cut.** The first concrete step (a clear "no starting room"
> error in `lib/advent`) is implemented; the general machinery below is proposed, not
> built. Tracked in TODO.md.

## Purpose

Make a failure during play trace back to **either a precise line of Lamp source** (when
the location is available) **or a Lamp-ish cause** ("this game has no starting room"),
instead of surfacing a raw JavaScript exception like `Cannot read properties of
undefined (reading 'lighted')`. The player/author should never see a JS stack trace for
an authoring mistake; an actual engine bug should be clearly labelled as such.

## Boundaries

- **In scope:** classifying runtime failures (authoring mistake vs engine bug), giving
  each a Lamp-facing message, attaching a Lamp source location where we can, and
  rendering them uniformly across the hosts (CLI plain/TUI, web shell, dev `exe`).
- **Out of scope (for now):** a full debugger, recoverable in-game error handling
  (`try`/catch at the Lamp level beyond the existing action `try`), and compile-time
  diagnostics (already handled — the tokenizer/parser/checker throw `file:line:` errors
  during `lantern` and are not the subject here).

## Current state (what exists today)

- **Compile-time errors** are good: tokenizer/parser/checker throw `path:line: message`
  (e.g. `checkedGetObject` → `unknown object "x"`). AST nodes carry `filePath` /
  `lineNumber` and the emitter uses them — but only at emit time.
- **Runtime errors** are a mix:
  - The `error` statement → `lamplighter.error(msg)` → `throw new Error(msg)`. Clean
    message, but no location.
  - Engine guards throw plain `Error` with decent text (`Unknown object`, `for ... in
    expected a list`, relation-arity messages, …).
  - **Raw JS operations carry no Lamp context.** Property access compiles to
    `r.lighted`, index to `t.items[i]`, so a `none`/undefined dereference throws a bare
    `TypeError` with a JS message and no `.lamp` line. This is the phobos class of bug.
- **Propagation:** the worker catches and posts `{ type: "error", message }`; the host
  forwards it and `play.js` prints `Error: <message>`. `exe.js` now swallows
  `execFileSync`'s "Command failed" wrapper so only the inner message shows.
- **No runtime source mapping** from generated JS back to `.lamp` exists.

## Inputs and outputs

- **Input:** an exception thrown anywhere under `run()` (startup event, command loop,
  rulebook/action handlers, native helpers).
- **Output:** a single rendered diagnostic. Two shapes:
  - **Authoring error** (a `LampError`): `<message>`, optionally prefixed with
    `<file>:<line>: `. No JS stack.
  - **Engine bug** (anything not a `LampError`): a labelled banner
    (`Internal Lamp error — please report:`) plus the JS message and stack, and (when
    available) the nearest Lamp location.

## Design

### 1. A `LampError` class

Introduce `LampError` (in the runtime) with `{ message, location?, kind }` where
`location = { file, line }` and `kind ∈ { "authoring", "world", "internal" }`. The
`error` statement and all engine guards throw `LampError`. The catch sites (worker,
`play.js`, web shell) check `err instanceof LampError` (or a tagged `name` across the
worker boundary, since structured clones lose the prototype — carry `err.lampError =
true` and `err.location` on the posted message) and render accordingly. Everything else
is treated as `kind: "internal"`.

### 2. Attaching a Lamp source location to runtime failures

Three strategies, increasing in fidelity and cost. Recommended: ship **(a)** as the
near-term win, pursue **(c)** as the durable answer; **(b)** is the cheap interim.

- **(a) Guard the known seams (library + runtime).** Many high-value failures have a
  precise, nameable cause and a natural check point. The "no starting room" guard is the
  template: detect the bad state where the library/runtime already has the context and
  raise a `LampError` with a written explanation. Catalog of candidates: moving an
  object to a `none` destination, describing a `none` room, an action whose required
  slot is unfilled, a `start` that names a non-room, list index out of range with the
  list/þ index in the message, divide-by-zero (already routed through
  `lamplighter.divide`). Cheap, no emit changes, immediately legible — but only covers
  enumerated cases.

- **(b) "Current statement" breadcrumb (debug builds).** Have the emitter prefix each
  statement with a location update — `lamplighter.at("file.lamp", 14)` (or assign a
  module-level `__loc`) — so the catch handler can report "near `file.lamp:14`" for
  *any* exception, including raw `TypeError`s. Coarse (statement granularity, last
  breadcrumb wins) and adds calls to the output, so gate it behind a compile flag
  (`--debug-locations`, off for distribution like `--encode-strings` is on). Good
  stopgap that turns "no location ever" into "the right neighborhood".

- **(c) Source maps (durable).** Emit a standard JS source map alongside
  `*.generated.js`: the emitter already threads `lineNumber`; track output-line → Lamp
  `{file,line}` while building the program and write a `.map`. In the catch handler,
  load the map and translate the top JS stack frame to a `.lamp` location. Zero runtime
  overhead in the happy path, exact line, and it also improves engine-bug reports. Needs
  a source-map writer in the emitter and a consumer in the host (a small dependency
  decision — `source-map` is the standard package; or hand-roll the VLQ encoding, which
  is modest). This subsumes (b) for accuracy.

### 3. Convert raw dereferences into Lamp-ish messages

Independently of location, the *message* for the common cases can be made Lamp-shaped by
routing the risky operations through runtime helpers **in debug builds** (paired with
(b)/(c) for the line):

- property access `r.f` → `lamplighter.field(r, "f")` → on `none`/undefined throws
  `LampError("tried to read 'f' of nothing (none)")`.
- index `t.items[i]` → `lamplighter.index(t, i)` → range-checked message.

These add call overhead, so they are **debug-mode emit** only; release builds keep the
fast raw form. This is the general fix for the phobos `('lighted' of undefined)` class.

### 4. Uniform rendering across hosts

One formatter (`formatDiagnostic(err)`) used by every catch site so the CLI (plain and
TUI), the web shell, and `exe` show the same thing: authoring/world errors as a plain
message (with `file:line` when present); internal errors behind the "please report"
banner with the stack. The TUI must `stop()` (restore the terminal) before printing, and
the web shell renders into the transcript, not a JS console.

## Assumptions

- Authoring errors are non-recoverable for the current run (we print and exit); there is
  no Lamp-level catch for them yet. The action-rulebook `try` mechanism is a separate,
  intentional control-flow feature, not error handling.
- Source locations are only as good as the AST's `lineNumber`s; library code (e.g. the
  startup guard) reports a library message, not the author's line, which is correct —
  the *cause* is in the game, the *check* is in `lib/advent`.

## Non-goals (now)

- In-language exception handling, error recovery / resume, multi-error batching at
  runtime, or a stepping debugger.

## Roadmap (prioritized)

1. **Done:** clear "no starting room" error (seam guard in `lib/advent/startup.lamp`;
   `game.start` defaults to `none` so the check fires); `exe.js` no longer prints the
   `execFileSync` wrapper.
2. `LampError` class + tagged propagation across the worker boundary + a single
   `formatDiagnostic` used by all hosts (separates authoring from internal).
3. More seam guards (move-to-none, describe none-room, unfilled action slot, bad
   `start` target, list index range).
4. `--debug-locations` breadcrumb (b) **or** go straight to source maps (c); pick based
   on whether we want the dependency. Recommendation: do (c).
5. Debug-mode `field`/`index` accessors (3) for Lamp-ish messages on raw dereferences.

## Open questions

- **Source maps vs breadcrumb:** accept a `source-map` dependency (or hand-roll VLQ) for
  exact lines, or settle for statement-granularity breadcrumbs with no dependency?
- **Default debug or release:** should the dev `play`/`exe` path default to debug-mode
  emit (guarded accessors + locations) and Lighthouse force release, mirroring
  `--encode-strings`?
- **Where do world-model guards live** — in `lib/advent` (Lamp, author-legible) or in the
  core runtime (applies to any library)? The "starting room" check is library-level
  because `start`/`room` are advent concepts; a core runtime guard would need the
  malformed-world contract (TODO item 5).
