# Content Windows & the Status Line

> Status: **the status line IS a text window (2026-07-08).** The general window
> model is built (devdocs/text-windows.md) and the status line is re-expressed on
> it: a `look "bar"` top window (`status_bar`, priority -100) declared and
> composed by `lib/advent/status.lamp`. The dedicated status machinery —
> `status_line(left, right)`, `setStatusLine`/`setStatusChannel`, the `status`
> wire message, the web `#status-bar`, and the TUI's hardcoded row 1 — is
> **retired outright**. Multi-row status is now just `status_bar.size = N` plus
> a game's own `status_line_rules` content (see below).

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

- **Input:** library-composed content, via the text-window primitives. The default
  status content is composed by the `status_line_rules` rulebook
  (`lib/advent/status.lamp`), followed from `window_refresh_rules` once per prompt.
- **Output:** the ordinary window wire — `window_set` (carrying `look: "bar"`) +
  `window_update` (one line: left segment, fill run, right segment). No dedicated
  status message exists; hosts without window support see nothing.

## The status line (as a window)

- **Declaration (lib/advent/status.lamp):** `window status_bar: dock top; size 1;
  priority -100; look "bar"`. The negative priority pins it nearest the top edge,
  above any game pane; `look "bar"` is the visual identity (full-width reverse
  video, no border/title, monospace) each host interprets.
- **Content:** the `status_line_rules` rulebook's default rule composes the
  IF-convention line — current room (or "Darkness") left; turn count, or
  "[score] of [max_score] points" for a scored game, right — via
  `window_line_split(status_bar, left, right)`.
- **Customizing (a game):**
  - *Content:* contribute `rule status_line_rules: … stop` from the game file — it
    runs before the library default and replaces it (the `room_heading_rules`
    pattern). Being its own rulebook, the `stop` cannot affect other panes.
  - *Height:* `status_bar.size = 3` (usually in `startup_rules`) + compose that
    many lines — the multi-row status some games want.
  - *Remove:* `status_bar.visible = false`.
- **Rendering:** the web shell styles a `.pane-bar` (reverse video, borderless,
  full width); the TUI draws each bar row as a full-width reverse block, with
  styled runs re-asserting the reverse after their own SGR reset. Both fall out
  of the general pane renderers — the bar is one `classList` toggle / one branch.
- **The old two-string channel** (`status_line` primitive → `setStatusLine` →
  `{type:"status"}` → `#status-bar` / TUI row 1) is deleted end to end.

Why structured runs rather than a pre-padded string: the runtime can't know the
host's width (responsive browser, terminal columns), so it sends content — with the
left/right split expressed as a fill run — and each host lays it out. This is the
same encoding every text window uses.

## Assumptions

- The status line is redrawn each turn; the library owns the turn loop and the call
  site, so it controls cadence. The web shell `textContent`s the segments — never
  `innerHTML` — even though the text is the author's own (defense in depth).

## Non-goals (now)

- Graphics / freestyle (non-text) windows — spec'd in
  devdocs/freestyle-windows.md (runtime surface built 2026-07-09; hosts pending).

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
TODO item 8): batched redraws and preserving the transcript on exit (the alternate
screen clears it today, like `less`/`nano`).

## Output pagination ("[more]")

All three interactive hosts pause a long passage with a `[more]` prompt and reveal it a
screenful at a time, so it isn't scrolled past unread. Pagination is a host concern (the
host knows its viewport/width; the runtime emits a turn's whole output then blocks at the
prompt) — the full per-host design is in `devdocs/sandbox.md` ("Output pagination").

## Open questions

Both of this doc's original open questions are resolved by the window model
(devdocs/text-windows.md): **generalization** — the status line collapsed into a
`look "bar"` window over the capability handshake, with hosts that render nothing
simply seeing nothing; **author control** — games replace the content via
`status_line_rules` (and the built-in default already shows "[score] of
[max_score] points" when `max_score` is set). Remaining direction: general
window *styling* fields (reverse video, background color) instead of enumerated
looks — tracked in devdocs/text-windows.md.
