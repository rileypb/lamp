# Content Windows & the Status Line

> Status: **status line implemented (web)**; general content windows are a
> deferred design direction. The status line is built as its own special-purpose
> mechanism now, to be re-expressed as a window once that model lands.

## Purpose

Surface game-provided content *outside* the main scrolling transcript — beginning
with the traditional IF **status line** (current room + turn count), and later
generalizing to arbitrary **content windows** (a map pane, score header, inventory
sidebar, etc.). The shaping principle: **content is composed by the game/runtime;
the host only lays it out and styles it.** The host shell stays free of game logic,
consistent with the output (`print`) and save channels (see `devdocs/sandbox.md`).

## Boundaries

- **In scope:** the transport for pushing structured, non-transcript content from
  the worker to the host; the status-line content (composed by the library) and its
  web rendering.
- **Out of scope (for now):** a general window-creation API (open/close, sizing,
  multiple named windows), window content beyond the status line, and any CLI
  rendering of windows — the CLI ignores the status message today.

## Inputs and Outputs

- **Input:** library-composed content. The status line is two strings, `left` and
  `right`, recomputed each turn (`update_status_line` in `lib/advent/startup.lamp`).
- **Output:** a `status` worker→host message `{ left, right }`; the web shell renders
  it. A host without a status bar (the CLI) installs no status channel, so the
  runtime primitive is a silent no-op there.

## The status line (first cut)

- **Content (library):** `lib/advent` composes `left` (the current room's rendered
  name, or `"Darkness"` when `in_darkness(player)`, matching `describe_room`) and
  `right = "[turns_taken()] turns"`, both `freeze`-d to plain strings, and calls the
  `status_line(left, right)` primitive once at the top of every turn. This lives in the world library because it knows the world model (player,
  room); `lib/sys` provides only the general primitives `status_line` and
  `turns_taken`.
- **Transport (runtime):** `setStatusLine(left, right)` ships the pair through an
  installed status channel (`setStatusChannel`); no channel ⇒ no-op. The browser worker
  installs the channel and posts `{ type: "status", left, right }`; the CLI worker does
  not.
- **Rendering (host):** the web shell renders a `#status-bar` with **reverse-video**
  colors (foreground/background swapped from the main area), a **fixed-width
  (monospace)** font, the `left` segment flush-left and `right` flush-right via flexbox
  `space-between` — so the host owns justification without needing a column count.
  Hidden until the first update and whenever both segments are empty.

Why structured fields rather than a pre-padded string: the runtime can't know the
responsive browser width, so it sends content and lets the host justify. This is also
the shape a general window API wants (content in, layout at the host).

## Assumptions

- The status line is redrawn each turn; the library owns the turn loop and the call
  site, so it controls cadence. The web shell `textContent`s the segments — never
  `innerHTML` — even though the text is the author's own (defense in depth).

## Non-goals (now)

- Multiple/arbitrary windows, a window lifecycle API, graphics, or CLI status
  rendering. The status line is deliberately a special creature until the window model
  is designed.

## Open questions

- **Generalization.** What is the minimal window model that the status line collapses
  into — named windows with a content push and a host-side layout role? How does a host
  declare which windows it can render (capability handshake), and what is the CLI
  fallback?
- **Author control.** Should a game be able to override the status-line content (e.g. a
  score game wanting "Score: N")? Today the content is fixed in `lib/advent`.
