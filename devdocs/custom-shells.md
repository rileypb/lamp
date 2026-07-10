# Custom Shells — author-owned web presentation

> Status: **design decided 2026-07-09; built in the same pass.** This is point
> (4) of the presentation spectrum (TODO item 9): the game talks to an
> author-customized web shell over a game-specific protocol. Points (1)–(2)
> and hotspots are built (devdocs/text-windows.md, devdocs/freestyle-windows.md);
> the sandboxed-iframe tier (3) is **rejected**, not deferred — see Trust model.

## Purpose

Let an author ship their own presentation — sound, motion, full-page art
direction, novel UI — around a Lamp game, without Lamp having to enumerate
every media primitive. The game emits **semantic events** over one generic
message; the author's shell code interprets them. The protocol vocabulary is
the author's own, per game.

## Boundaries

- **In scope:** the `shell_send` primitive and its wire message; the
  `shell_available` capability query; the stock shell's hook surface
  (`LampShell`); Lighthouse's convention shell directory (override + copy +
  tag injection) and `--eject-shell`; tests.
- **Out of scope:** any new host→game data path (clicks and custom UI send
  input as **synthesized parser commands** through the ordinary submit path —
  built and decided with hotspots, echo-like-typed); Electron (same shell
  later, as ever); a curated media library (sound/animation helpers may grow
  in author-land, not in Lamp).

## Decisions (2026-07-09)

1. **Trust model: trusted tier.** Author shell JS runs on the main thread as
   part of the shell. A custom-shell game is trusted the way any website is
   trusted — stated plainly in docs. The worker capability boundary remains
   fully meaningful for pure-Lamp games (and still confines the *game* even
   under a custom shell; it is the author's *shell* code that is unconfined).
   The sandboxed-iframe tier is rejected: it forfeits full-page art direction
   (the point of the feature) for a boundary the trusted tier makes explicit
   instead.
2. **Author shape: eject + hook ("cake and eat it too").** The convention
   shell directory can override any stock asset by name — the deep path is
   "eject `shell.js` and edit" (`--eject-shell` copies the stock shell in to
   start from). But the stock shell also exposes a small hook surface and
   loads `custom.js` / `custom.css` when present, so the common case (a sound
   cue, a skin, a flourish) never forks the shell at all. **Why this works:**
   the engine↔shell contract is the wire protocol, which is additive by
   design (unknown message types ignored, fields only added) — an ejected
   shell keeps working as Lamp evolves; it just doesn't render what it
   predates. The cost is honest fork drift: an ejected shell.js stops
   receiving stock improvements, and re-syncing is the author's diff.
3. **Payload: name + one string.** `shell_send(name, payload)` — structure
   beyond one string is the author's own encoding (their protocol, their
   format). No Lamp→JSON mapping frozen into the wire.
4. **Discovery: convention directory.** `<game>.shell/` next to the game file
   (per-game, so multi-game directories like `sample/` don't collide). No
   compiler involvement — shell packaging is a Lighthouse concern.

## The Lamp surface (lib/sys)

```lamp
native function void shell_send(string name, string payload)
native function bool shell_available()
```

- `shell_send` is fire-and-forget, like `print` and window updates: never a
  reply, never blocking, never transcript-captured. On a host with no shell
  channel (plain, TUI) it drops silently — golden output is byte-invariant by
  construction.
- `shell_available()` reports whether the host declared a custom layer
  (capabilities `shell: true`), so a game can fall back (e.g. print the
  atmospheric line it would otherwise have scored with sound). As with
  hotspots, the guidance is that shell effects be **enhancement-only**;
  anything information-bearing must also exist in text.
- The name/payload render through the text pipeline (substitutions work) and
  are stripped to plain text — the shell hook receives plain strings.
- **State discipline (guidance):** state-bearing custom UI should be re-sent
  as the whole truth each turn (a rule alongside `window_refresh_rules`), not
  accumulated from deltas — the declarative-recompute principle — so it
  survives UNDO/RESTORE. Lamp cannot enforce this in author JS; the docs
  prescribe it.

## Wire

| Message | Payload | Direction |
| --- | --- | --- |
| `shell_event` | `{ name, payload }` (both strings) | worker → host, fire-and-forget |

Host→worker: `capabilities` gains an optional top-level `shell: true`.
Absent ⇒ no custom layer (`shell_available()` false). Input from custom UI is
synthesized parser commands through the ordinary submit path — no new
message.

The runtime seam mirrors the window channel: `setShellChannel(impl)` installed
by the browser worker bootstrap; no channel ⇒ `shellSend` drops.

## The stock shell's hook surface

`shell.js` exposes one global, `LampShell`:

- `LampShell.on(name, handler)` — register a handler for a `shell_send` name;
  `handler(payload, name)`. Last registration per name wins.
- `LampShell.command(cmd)` — synthesize a parser command through the ordinary
  submit path (the hotspot mechanism: echoed like typed; dropped mid-turn,
  mid-modal, mid-[more]).

Unhandled `shell_event`s are dropped (fail-silently, as ever). Handler
exceptions are caught and logged — an author bug must not kill the broker.

`index.html` gains `custom.css` / `custom.js` tags **only when Lighthouse saw
those files in the shell directory** (build-time templating, like the title),
so a stock bundle carries no dangling references. `capabilities.shell` is
declared true exactly when the page carries a `custom.js` tag — build-time
truth, immune to script-order races. A fully ejected shell.js owns its own
capabilities line. Load order note: `custom.js` evaluates in document order
right after `shell.js`, before the worker can deliver its first message in
practice; a paranoid author registers handlers at top level, nothing deferred.

## Lighthouse packaging

For `<dir>/<name>.lamp`, the shell directory is `<dir>/<name>.shell/`:

- A file whose relative path matches a stock asset (`index.html`, `shell.js`,
  `shell.css`, `sw.js`) **overrides** it (the title templating still runs on
  an overridden `index.html`).
- Every other file (`custom.js`, `custom.css`, sounds, fonts, art,
  subdirectories) is **copied verbatim** into the bundle.
- `--eject-shell` copies the stock shell files into the shell directory
  (never overwriting existing files) and then builds — the "start
  customizing" affordance.
- Declared `image` assets (freestyle-windows.md) are untouched by any of
  this; `assets/` and `assets.json` behave as before.

## Degradation

- **Plain/TUI:** no shell channel installed; `shell_send` drops; the CLI never
  sees author web code. `shell_available()` false → the game's text fallback
  runs. Goldens byte-invariant by construction.
- **Stock web bundle (no shell dir):** no `custom.js` tag → `shell: false` in
  capabilities → same as above, in the browser.

## Tests

- **Unit (`tests/shell/`):** the channel seam — shellSend encodes plain
  strings (styles stripped, substitutions rendered), drops without a channel,
  `shellAvailable` reads the capability.
- **Lighthouse e2e:** a fixture game + `<fixture>.shell/` with `custom.js`
  (an event handler) and a `shell.css` override: assert the bundle carries
  the copied/overridden files and the injected tags, `shell: true` reaches
  the game (`shell_available()`), and `shell_event` messages arrive on the
  wire with the composed payload. Golden: the fixture's plain-host stdout is
  byte-invariant (`shell_send` adds nothing).
- The hook surface's DOM behavior is a manual browser pass, per house rule.

## Non-goals

The iframe tier (rejected); a hosted-platform permission policy (a platform
that runs third-party custom-shell games needs its own review/trust story —
out of Lamp's scope); host→game payloads beyond synthesized commands; hot
upgrade tooling for ejected shells (re-eject and diff).

## Open questions

- Should `--eject-shell` also stamp the ejected files with the Lamp version
  they came from (a comment header), to help later re-syncs? (Cheap; decide
  when someone actually re-syncs.)
- Does the TUI ever want a shell channel (e.g. a terminal bell for a "sound"
  event)? (Nothing asks yet; the seam makes it a small backend patch.)
