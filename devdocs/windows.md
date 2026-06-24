# Content Windows & the Status Line

> Status: **status line implemented (web + CLI TUI)**; general content windows are a
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
  rendering on both the web shell and the interactive CLI (TUI).
- **Out of scope (for now):** a general window-creation API (open/close, sizing,
  multiple named windows) and window content beyond the status line.

## Inputs and Outputs

- **Input:** library-composed content. The status line is two strings, `left` and
  `right`, recomputed each turn (`update_status_line` in `lib/advent/startup.lamp`).
- **Output:** a `status` worker→host message `{ left, right }`. Both the browser
  worker and the CLI worker emit it; the host's render backend decides what to do
  with it. The runtime primitive (`setStatusLine`) is a silent no-op when no status
  channel is installed (e.g. a future headless host).

## The status line (first cut)

- **Content (library):** `lib/advent` composes `left` (the current room's rendered
  name, or `"Darkness"` when `in_darkness(player)`, matching `describe_room`) and
  `right = "[turns_taken()] turns"`, both `freeze`-d to plain strings, and calls the
  `status_line(left, right)` primitive once at the top of every turn. This lives in the world library because it knows the world model (player,
  room); `lib/sys` provides only the general primitives `status_line` and
  `turns_taken`.
- **Transport (runtime):** `setStatusLine(left, right)` ships the pair through an
  installed status channel (`setStatusChannel`); no channel ⇒ no-op. Both the browser
  worker and the CLI worker (`src/lamplighter/sandbox/worker.js`) install the channel
  and post `{ type: "status", left, right }`.
- **Rendering (web host):** the shell renders a `#status-bar` with **reverse-video**
  colors (foreground/background swapped from the main area), a **fixed-width
  (monospace)** font, the `left` segment flush-left and `right` flush-right via flexbox
  `space-between` — so the host owns justification without needing a column count.
  Hidden until the first update and whenever both segments are empty.
- **Rendering (CLI host):** the dev/CLI host has two interchangeable **render backends**
  behind one interface (`src/lamplighter/sandbox/backends/`): a **plain** stdio backend
  (the default for pipes/redirection/tests — it *ignores* the status message so captured
  output is unchanged) and an **interactive TUI** backend selected when stdout/stdin are
  a TTY (`LAMP_NO_TUI` forces plain). The TUI renders the status as a pinned top row in
  reverse video, justified left/right to the terminal width — the same two-segment
  content, laid out by the host. See `devdocs/sandbox.md` ("render backends").

Why structured fields rather than a pre-padded string: the runtime can't know the
host's width (responsive browser, terminal columns), so it sends content and lets each
host justify. This is also the shape a general window API wants (content in, layout at
the host).

## Assumptions

- The status line is redrawn each turn; the library owns the turn loop and the call
  site, so it controls cadence. The web shell `textContent`s the segments — never
  `innerHTML` — even though the text is the author's own (defense in depth).

## Non-goals (now)

- Multiple/arbitrary windows, a window lifecycle API, or graphics. The status line is
  deliberately a special creature until the window model is designed.

## CLI TUI — polish

Done: styled transcript text (bold/italic via a span model), in-line cursor editing
(←/→, Home/End, Delete, mid-line insert), ↑/↓ command history, mouse-wheel scroll
of the transcript (SGR mouse reporting; new output snaps back to the bottom; hold Shift
for the terminal's native text selection, which mouse reporting otherwise suppresses),
wrapping a typed command longer than the terminal width (hard-wrapped by column so the
caret tracks across rows), and multi-byte/emoji input (a `StringDecoder` reassembles
UTF-8 split across stdin chunks; editing and the caret work in code points; column math
uses an approximate East-Asian/emoji display width — wide = 2, combining/zero-width = 0
— so wrapping and the caret align with what the terminal draws). Still deferred (see
TODO item 7): batched redraws and preserving the transcript on exit (the alternate
screen clears it today, like `less`/`nano`).

## Open questions

- **Generalization.** What is the minimal window model that the status line collapses
  into — named windows with a content push and a host-side layout role? How does a host
  declare which windows it can render (capability handshake), and what is the CLI
  fallback?
- **Author control.** Should a game be able to override the status-line content (e.g. a
  score game wanting "Score: N")? Today the content is fixed in `lib/advent`.
