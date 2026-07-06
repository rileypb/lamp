# Text Windows — design brainstorm & candidate spec

> Status: **axes decided 2026-07-06; steps 1–2 built** — runtime + Lamp surface,
> and the web shell renders panes (step 3 TUI, step 4 consumers pending).
> The brainstorm sections that follow record the options considered; the
> "Candidate spec" section at the end states the chosen shape. This
> generalizes the status line (devdocs/windows.md) into real *text windows* on
> the web/Electron shell and, for top/bottom docks, the CLI TUI. A companion
> idea, **freestyle windows** (host-rendered rich regions: maps drawn on
> canvas, images, arbitrary layout), is deliberately out of scope here; see
> "Freestyle windows (boundary only)" for the line between the two.

## What a text window is

A rectangular portion of the play area, sized in **rows or columns of text**,
in which the game renders text the same way it renders the main transcript:
plain runs plus the closed style set (`bold`/`italic`/`fixed`, text.md I3),
`textContent`-only, never markup. Canonical examples, all from real IF:

- the status line (one top row — already built as a special case);
- a multi-row header (score/rank banner, chapter title);
- a quest/inventory sidebar (a right-hand column);
- a persistent map or compass pane (rows of fixed-width glyph art);
- a bottom hint/toolbar row.

The main transcript remains what it is today: the scrolling, paginated,
transcript-captured stream. Text windows are *panes around it*.

## Prior art

- **Glk** (Andrew Plotkin's IF I/O layer; the display model Glulx games use —
  glulxe is a Glulx interpreter that talks Glk). Spec:
  <https://eblong.com/zarf/glk/Glk-Spec-075.html>, windows in ch. 3.
  The parts worth stealing and the parts worth refusing:
  - **Two text window types.** A *text buffer* (scrolling prose, word-wrapped,
    the transcript) and a *text grid* (a fixed character grid with an
    addressable cursor, `glk_window_move_cursor`; repainted by the game). The
    status line is idiomatically a 1-row grid. The buffer/grid split is the
    load-bearing distinction — grids are for *composed* content, buffers for
    *flowing* content.
  - **The split tree.** Windows form a binary tree: opening a window splits an
    existing one via a *pair window*, with a method (`Above/Below/Left/Right` ×
    `Fixed/Proportional`) and a size measured in the units of a designated *key
    window* (so "3 rows" means 3 rows of *that grid's* font). Maximal
    flexibility; also the single most complained-about API in Glk — authors
    routinely get the key-window and split-order rules wrong, which is why
    Inform 7 games almost always reach for the **Flexible Windows** extension
    (Jon Ingold), which wraps the tree in *named windows docked to an edge*.
    That wrapper is the author-facing shape to learn from.
  - **Arrange events + `glk_window_get_size`.** Glk tells the game when the
    display was resized and lets it measure a window, so grid content can be
    width-aware. This is the piece that **does not survive contact with Lamp's
    architecture** (see "The resize problem" below).
  - **Graceful failure.** `glk_window_open` may return null (host can't do
    splits); a well-written game degrades. Any Lamp design needs the same
    posture, because the plain/piped host will support *nothing*.
- **GlkOte** (<https://eblong.com/zarf/glk/glkote/docs.html>) — the web
  implementation of the Glk display layer, used by Quixe/Parchment/Lectrote.
  Architecturally the closest cousin to Lamp's worker/shell split: the game
  side sends JSON *state updates* — the window arrangement plus per-window
  content — and the display library renders them. Its content encoding
  (per-window list of lines, each line a list of styled runs) is a proven wire
  shape for exactly our channel.
- **Z-machine screen model** (Z-Machine Standard §8): just two windows — the
  scrolling lower window and an upper *grid* window resized with
  `split_window`, drawn with `set_cursor`. Decades of games (including The
  Lurking Horror's status line) shipped on this. A useful floor: **one
  transcript + N fixed grid panes covers almost everything IF actually does.**
- **Inform 7 practice**: Flexible Windows (named, edge-docked, sized in
  rows/cols or percent, with a per-window "rule for refreshing"), Basic Screen
  Effects (status-line rows). The *refresh rule* idea — the game declares how
  to repaint a window and the library calls it when needed — maps beautifully
  onto Lamp rulebooks.

## What Lamp already has (the seeds)

- **The shaping principle** (windows.md): *content is composed by the
  game/runtime; the host only lays it out and styles it.* The status line
  already ships structured segments, not pre-padded strings, because the
  runtime cannot know the host's width.
- **A one-window transport**: `status_line(left, right)` primitive →
  `setStatusChannel` → `{ type: "status", left, right }` worker message → web
  `#status-bar` / TUI pinned row. The window design should be the thing this
  collapses into.
- **A styled-run output model**: `write(value, styles)` runs with a closed
  style set, rendered as classed spans (web) / SGR (TUI). Window content
  should reuse *exactly* this run shape — same styles, same
  `textContent`-only rule.
- **A message-channel host boundary** (sandbox.md): async worker→host
  messages for output-like traffic; the input path blocks the worker on
  `Atomics.wait`. Window updates are output-like: **fire-and-forget messages,
  no reply**, like `print` and `transcript_write`.
- **Render backends** (plain vs TUI) and the per-host capability pattern
  (`save_has_picker`): precedent for hosts that silently ignore what they
  can't render, and for the library *asking* what the host supports.

## The resize problem (the one hard constraint)

Glk's width-aware grids depend on the game *reacting to resize*. Lamp's worker
is synchronous: between turns it is blocked on `Atomics.wait` for input and
cannot service a host event. A browser window resized mid-turn cannot wake the
game to repaint a pane. Three postures:

1. **The game never knows the size** (recommended default). Window content is
   width-agnostic — lines of runs; the host wraps, clips, or justifies.
   Justification needs (status line's flush-left/flush-right) are met by
   *declared alignment on runs or line segments*, not by the game counting
   columns. This is already the house philosophy and it makes resize a pure
   host concern: CSS reflows, the TUI redraws from its stored segments.
2. **Size as a stale hint.** Expose `window_size(name)` (rows/cols at last
   layout) for games that want, say, a horizontal rule sized to the pane. The
   value can be a turn stale after a resize; content self-corrects at the next
   update. Cheap, honest, occasionally ugly.
3. **Host-side micro-layout.** Enrich the line encoding with a few layout
   atoms the *host* resolves at render time: alignment (`left/center/right`),
   a fill/rule run ("repeat `─` to fill"), column stops. Keeps content
   width-correct at every instant without the game ever measuring. Costs wire
   and renderer complexity; each atom must be implementable on both web and
   TUI.

A likely landing: (1) + a *tiny* dose of (3) — alignment per segment, maybe a
fill run — and defer (2) until something real needs it.

## Design axes

### A. Window kinds: grid, mini-buffer, or one "repaint block"?

- **Glk-style grid** (cursor addressing, character cells): maximal fidelity,
  but cursor ops are an *incremental, stateful* wire protocol, awkward across
  save/restore, and web rendering of a true cell grid fights proportional
  fonts (forces monospace panes).
- **Mini text buffer** (a second scrolling transcript): trivially supported —
  it's the existing output path pointed elsewhere — but scrolling side panes
  are rarely what IF wants, and each buffer raises pagination/scrollback
  questions.
- **Repaint block** (recommended candidate): a text window's content is *the
  whole window's lines*, re-sent as one update; the host replaces, never
  scrolls. No cursor, no incremental state, idempotent on the wire. This is
  how the status line already behaves (recomputed each turn), and it is
  GlkOte's grid encoding without the cursor. Games that want cursor-art
  compose lines in Lamp (string ops are cheap and already exist).
- Could offer both kinds later (`kind: block | buffer`); start with block only
  and note that the transcript itself is the one buffer window.

### B. Layout: split tree vs edge docking vs named slots

- **Glk split tree**: most general (nested splits, panes-within-panes);
  authors historically fail it; hard to map onto the TUI; overkill for the
  catalogued examples.
- **Edge docking** (recommended candidate; = Flexible Windows' model): a
  window declares `dock: top | bottom | left | right` + a size; the host
  stacks same-edge windows in open order (or a declared priority) and gives
  the remainder to the transcript. Covers every example above. Web: CSS
  grid/flex. TUI: top/bottom docks are the already-built pinned-row technique
  generalized to N rows.
- **Named slots**: the host publishes slots ("header", "sidebar"); the game
  fills them. Simplest, but bakes host layout opinions into game code and
  caps what a game can ask for. Probably right for *freestyle* windows later,
  wrong as the primary text-window model.
- Nesting/z-order/overlap: **out** — tiling only. (I7 games do overlap via
  Glk hackery; nothing in the target list needs it.)

### C. Sizing units

Rows for top/bottom docks, columns for left/right docks — measured in *the
window's own text metrics*, resolved by the host (web: `ch`/`lh` on a
monospace-defaulted pane; TUI: literal cells). Optionally `percent` later.
Explicitly avoid Glk's key-window indirection: each window is its own
measure. The host may clamp (a 200-column sidebar on a phone); clamping is
layout, and layout is the host's.

### D. Content & update model

- **Full repaint per update** (recommended): `window_update(name, lines)` where
  `lines` is a list of lines, each a list of `{text, styles, align?}` runs —
  the GlkOte shape, reusing the existing style vocabulary. Properties worth
  the price of re-sending a pane:
  - idempotent — a lost/duplicate update can't corrupt state;
  - the *newest update is the whole truth*, so undo/restore/restart need only
    re-run the compose step (see H);
  - the host can redraw at any time (resize, theme change) from its cache.
- **Incremental ops** (append line, move cursor, clear region): smaller
  messages, stateful wire, snapshot problems. Reject unless a profiling need
  appears (panes are small; whole-pane updates are trivially cheap next to a
  turn's transcript output).
- Updates are **fire-and-forget** like `print`/`transcript_write` — never a
  blocking reply. Window content must not stall the turn.
- Window content does **not** enter the transcript capture (SCRIPT) — the
  transcript is the main stream, as with the status line today. (Glk agrees:
  echo streams hang off the buffer window.)

### E. Author API: imperative vs declarative-recomputed

- **Imperative** (Glk/Flexible-Windows style): `window_open(name, dock, size)`,
  `window_print(name, …)`, `window_clear(name)`, `window_close(name)` as
  lib/sys primitives. Familiar; but now *arrangement and content are mutable
  state living outside the world model*, so undo/save/restore need a state
  provider replaying it, and every game hand-rolls its refresh timing.
- **Declarative + per-turn recompute** (recommended candidate): a window is
  *declared* (existence, dock, size) and its content is *derived* — a rulebook
  or function the library calls at the same cadence as `update_status_line`
  (top of every turn, and once at startup):

  ```lamp
  window sidebar:
      dock right
      cols 24

  rule refresh_sidebar_window:            # or: window's `refresh` rulebook
      window_line(sidebar, bold("Quests"))
      for q in quest.all:
          if q.active: window_line(sidebar, "- " + q.title)
  ```

  Content becomes a pure function of world state: **nothing to snapshot** —
  after undo/restore/restart the next recompute repaints every pane correctly
  for free (the status line already proves this property).
- **Declarative ≠ immutable.** The declaration fixes how arrangement is
  *expressed*, not that it never changes. If the window is an object with
  ordinary fields (`dock`, `cols`, `visible`), then resizing and
  closing/reopening are plain field assignments (`sidebar.cols = 32`,
  `sidebar.visible = true`); the library re-reads the fields at the per-turn
  sync and re-sends the idempotent `window_set` (the host diffs against its
  cache to skip no-op relayouts). Because object fields are already covered
  by the state providers, **arrangement travels with undo/save/restore for
  free** — undo past the turn the map pane opened and it closes again. An
  explicit `visible` field also keeps "closed" distinct from "empty": a blank
  pane can stay reserved on screen, while `visible false` returns its space
  to the transcript. Cadence limitation: field changes render at the next
  turn-boundary sync; a mid-turn dramatic resize would need a `window_sync()`
  primitive that flushes arrangement+content early (same shape as the
  mid-turn `window_update` middle ground below).
- Middle ground: declarative arrangement + an imperative `window_update` the
  game may call *whenever it likes* (the library merely also calls the refresh
  rulebook each turn). Mid-turn updates (a countdown pane ticking during a
  long `do` band) fall out naturally since updates are plain messages.
- Where it lives: the *primitives* (`window_update` etc.) in lib/sys, the
  *cadence and the status-line re-expression* in lib/advent — same split as
  `status_line`/`update_status_line` today.

### F. Capability handshake & degradation

- Hosts differ hard: web/Electron can do all four docks; the TUI can do
  top/bottom rows now and left/right columns only with real work (per-row
  composition against a narrowed transcript wrap width); plain/piped supports
  none (and must stay byte-identical for tests).
- Options: (a) Glk-style *per-open failure* — `window_open`/declaration
  yields a usable/ignored flag the game can branch on (mirrors
  `save_has_picker`); (b) an upfront **capability handshake** — the host
  advertises `{ docks: [...], maxRows, color? }` at startup and the runtime
  answers `window_available(dock)`; (c) silent degradation — unsupported
  windows are simply never rendered, content is lost.
- Silent-degradation-only is tempting (the status line does it) but wrong for
  *content-bearing* panes: a game that puts the quest log only in the sidebar
  has hidden real information from CLI players. The library wants to *know*,
  so it can fall back (e.g. keep the SCORE verb authoritative, or fold the
  pane's lines into the transcript on demand). Lean (b) with (c) as the
  transport-level behavior underneath.
- Test invariance: the plain backend ignores window messages exactly as it
  ignores `status` — golden output unchanged; window content gets its own
  test channel (assert on the messages, not the pixels).

### G. Wire protocol sketch (strawman)

Worker → host, all fire-and-forget:

| Message | Payload | Notes |
| --- | --- | --- |
| `window_set` | `{ id, dock, size, title? }` | declare/redeclare a pane (idempotent) |
| `window_update` | `{ id, lines: [[{text, styles?, align?}…]…] }` | whole-pane repaint |
| `window_close` | `{ id }` | remove pane, return space to transcript |

Host → worker (only if the handshake lands): one `capabilities` message at
startup, *before* the game loop starts (so no mid-block delivery problem).
`status` stays as-is until the status line is re-expressed, then becomes a
compatibility alias for a 1-row top window with two aligned segments.

### H. State, save, and RESTART

With the declarative-recompute model this section nearly vanishes — the win
that most recommends it:

- **Undo/restore/restart**: content re-derives on the next recompute, and
  arrangement mutations (resize/close/reopen) revert with the world because
  they live in ordinary object fields the state providers already capture —
  no window-specific state provider, no blob format change. (Contrast
  imperative: a `windows` state provider must capture arrangement + last
  content, and restores must replay open/close/resize events to the host —
  exactly the kind of edge that rots.)
- **Read-only render flag** (TODO "read-only render flag"): window refresh
  *is* real output (it runs every turn, same as the status line), so
  `[first time]`/`[cycling]` advancing inside a window template is
  arguably correct — but a window repainted every turn will *churn* cycling
  text distractingly. Worth a note in the eventual spec: prefer stable
  content functions in refresh rules; possibly render refreshes read-only.

### I. Host rendering notes

- **Web/Electron**: CSS grid around the transcript (`header / sidebar-left /
  main / sidebar-right / footer` areas materialized on demand); panes default
  monospace (they're text windows; alignment math should hold); reverse-video
  is *not* assumed — the status bar's look stays a status-bar style, not a
  window default. Pagination (`[more]`) measures the transcript's reduced
  viewport, which the shell already owns.
- **TUI**: generalize the pinned status row to N reserved top rows + M bottom
  rows; transcript scroll region shrinks accordingly (the `gameTop` offset in
  tui.js becomes computed). Defer left/right docks (report them unsupported
  in the handshake) — column composition is real work for little demand.
- **Plain/piped**: ignores everything, by contract.
- **Electron**: nothing extra — it runs the web shell; windows are one more
  reason Electron stays "the web host in a frame".

## Freestyle windows (boundary only — future doc)

The second window type the roadmap wants: a host-rendered region whose content
is *not* lines of styled text — an SVG/canvas map, images, arbitrary HTML.
Everything above deliberately excludes it, but the boundary should be drawn
now so text windows don't grow escape hatches:

- Text windows carry **only** the run model; no markup, ever (the
  `textContent` rule is a security boundary, not a style preference).
- Freestyle content will need its own channel with its own sandboxing story
  (e.g. a sandboxed iframe fed via `srcdoc`, or a constrained drawing
  command list à la Glk graphics windows) — decided in its own design pass.
- The *layout* model (docking, sizing, capability handshake) should be shared:
  a freestyle window is another `window_set` with a different content kind,
  not a second windowing system. Sizing in px/percent rather than rows/cols
  is the one layout difference to anticipate.

## Non-goals (this feature)

- Per-window player input (Glk allows it; Lamp keeps one input line in the
  transcript).
- Overlapping/floating windows, z-order, nesting.
- Cursor-addressable grids on the wire (compose lines game-side instead).
- Sound, graphics, hyperlinks (freestyle territory).
- Paginating window content (panes are small; the transcript is the only
  paginated stream).

## Decisions (2026-07-06)

The axes above were resolved as follows (each is the option the brainstorm
recommended, except the last, which adds the Phobos-EX twist):

1. **Declaration:** a plain `window`-typed object shipped by lib/sys — no new
   parser syntax. Arrangement fields are ordinary mutable, snapshot-covered
   object state.
2. **Content kind:** repaint-block only in v1; the transcript stays the only
   scrolling buffer. A `kind` field can add buffers later.
3. **Size exposure:** never — the game composes width-agnostic lines; the
   host lays out. No `window_size`, no resize events.
4. **Capabilities:** an upfront host→worker `capabilities` message before the
   game loop starts, surfaced to Lamp as `window_available(dock)`; the
   transport still silently drops unrenderable panes underneath.
5. **Status line:** stays on its existing channel, untouched and
   byte-invariant; re-expressed as a 1-row top window in a follow-up once
   alignment runs prove they reproduce it exactly.
6. **TUI scope:** top/bottom docks in v1 (generalize the pinned status row);
   left/right report unsupported in the handshake.
7. **Line atoms:** per-segment `align` (left/center/right) plus a **fill
   run** (one char repeated to consume slack — rules, dot leaders, the
   left/right split).
8. **First consumers:** a wire-level test fixture, plus one real pane in
   **Phobos EX** — a *copy* of Phobos (`sample/phobos_ex/`) — so the original
   remains byte-identical to the 1:1 I7 port (the parity goal is a fidelity
   claim; EX is where Lamp-native enhancements live).

## Candidate spec

> **Step 1 is built (2026-07-06, branch `windows`):** the `window` type
> (lib/sys/types.lamp), the six primitives (lib/sys), the runtime buffer +
> `window_set`/`window_update` messages + `setWindowChannel`/
> `setHostCapabilities` (src/lamplighter/index.js), the advent cadence
> (`window_refresh_rules` + `window_sync()` at the status-line site), unit
> tests (`tests/windows`, `npm run test:windows`), and the plain-path golden
> `windows1`. All 225 goldens byte-invariant. No host renders panes yet.
> Two implementation notes: the primitives declare their pane parameter as
> `object` (not `window`) — no lib native yet takes a lib-declared type and
> step 1 doesn't gamble on it; and mutating arrangement from game code
> currently needs the `let w = pane` workaround for the known
> bare-object-name assignment-target emitter bug (see TODO), which windows
> now make worth fixing.
>
> **Step 2 is built (2026-07-06):** the browser worker forwards window
> messages verbatim (`setWindowChannel`) and applies `capabilities` off the
> `init` message before the game starts; the shell posts a four-dock
> capability set, docks panes into `#win-top`/`#win-bottom`/`#win-left`/
> `#win-right` around a new `#main-row` (empty containers collapse — a
> windowless game renders exactly as before), sizes side panes in `ch` and
> top/bottom panes in line-height units, orders same-edge panes by `priority`
> via flex `order` (right/bottom containers reverse direction so lower is
> nearer the edge), renders runs as `textContent`-only spans reusing the
> `style-*` classes, fills via a clipped repeated char, and clamps side panes
> to 45% width. The pane `title` renders as a header on side panes only
> (top/bottom rows are reserved by `size`). E2E: `drive-bundle.js` sends the
> same capabilities as the shell and collects window messages;
> `run-lighthouse.js` builds the `windows1` fixture as a real bundle and
> asserts capabilities reach `window_available`, arrangement + visibility
> toggle arrive, and the run encoding matches the spec. The shell's actual
> DOM painting stays a manual browser check (the standing modal/pager gap).

### The `window` type (lib/sys)

```lamp
type window:
    string dock = "top"      # top | bottom | left | right
    int size = 1             # rows (top/bottom) or columns (left/right),
                             # in the pane's own text metrics
    int priority = 0         # stacking order among same-edge windows
                             # (lower = nearer the screen edge)
    bool visible = true
    string title = ""        # host MAY render (web pane header); TUI ignores
```

A game declares a pane as an ordinary object:

```lamp
window mission_panel:
    dock right
    size 28
    visible false            # revealed when the mission log is found
```

Resize/close/reopen are field assignments (`mission_panel.visible = true`);
they take effect at the next sync and revert with undo/restore because object
fields are already state-provider-covered. Dock/size are validated at sync
(bad dock → a clear runtime error naming the window), not by the checker.

### Content: refresh + sync (lib/sys primitives, lib/advent cadence)

Runtime keeps a transient per-window line buffer (render state — never
snapshotted). Primitives (lib/sys natives):

- `window_line(window w, string text)` — append a flush-left line (styled via
  the ordinary `bold`/`italic`/`fixed` wrappers, which survive as runs).
- `window_line_split(window w, string left, string right)` — one line, left
  segment + fill + right segment (the status-line shape).
- `window_rule(window w, string ch)` — a full-width fill line.
- `window_clear(window w)` — reset the buffer mid-compose (rarely needed; the
  sync clears automatically).
- `window_sync()` — flush: for each `window`-typed instance, send
  `window_set` (from its fields) and `window_update` (its buffered lines),
  then clear buffers. Callable mid-turn for dramatic effect; no-op when the
  host declared no window support.
- `window_available(string dock) -> bool` — the capability query.

Cadence (lib/advent): a `window_refresh_rules` rulebook followed once at
startup and once at the top of every turn (same site as
`update_status_line`), then `window_sync()`. Rules append lines; a window
whose refresh emits nothing renders empty (still reserved if `visible`).
Content is thus a pure function of world state — nothing to snapshot; after
undo/restore/RESTART the next sync repaints correctly for free. The three
convenience primitives cover the catalogued examples; the wire encoding below
is more general (per-run align/fill) so richer Lamp surface can be added
without a protocol change.

### Wire protocol

Worker → host, fire-and-forget (like `print`/`transcript_write`; never
blocking, never transcript-captured):

| Message | Payload |
| --- | --- |
| `window_set` | `{ id, dock, size, priority, visible, title }` |
| `window_update` | `{ id, lines }` — `lines`: array of lines; each line an array of runs `{ text, styles?, align?, fill? }` |

`window_set` is idempotent — re-sent each sync; the host diffs against its
cache to skip no-op relayouts. There is **no** `window_close`: `visible:
false` returns the space to the transcript. `align` is `left` (default) /
`center` / `right` per run; `fill: true` marks a run whose single-char `text`
repeats to consume the line's slack. `id` is the object's canonical runtime
name — note that a multi-word identifier is coerced (`side_panel` →
`"side panel"`), same as every object name.

Host → worker, once, before the game loop starts (riding the existing boot
sequence, so it never hits the blocked-worker constraint):

| Message | Payload |
| --- | --- |
| `capabilities` | `{ windows: { docks: ["top", …] } }` |

Absent message ⇒ no window support (the plain host sends nothing and ignores
all window messages — piped/golden output is byte-invariant by construction).

### Hosts

- **Web/Electron (`shell.js`)**: CSS grid areas materialized on demand around
  the transcript (top rows / bottom rows / left cols / right cols); panes
  default monospace; `textContent`-only runs with `style-*` classes, exactly
  like transcript output. Declares all four docks. Pagination measures the
  transcript's reduced viewport (already host-owned).
- **CLI TUI (`backends/tui.js`)**: N reserved top rows + M bottom rows;
  `gameTop` and the scroll region become computed from the visible
  top/bottom panes; declares `["top","bottom"]`. Side docks deferred.
- **Plain (`backends/plain.js`)**: declares nothing, ignores everything.

### Tests & first consumers

- **Unit tests (`tests/windows/`)**: install a capturing window channel
  (mirroring `tests/save`'s primitive-level style), drive a fixture, assert
  the `window_set`/`window_update` message sequence — including the
  visible-toggle, a field resize, undo reverting arrangement, and the
  fill/align encoding. Golden stdout stays the assertion-free plain path.
- **Lighthouse e2e**: extend `drive-bundle.js` to assert window messages from
  a real built worker (the headless harness already speaks the wire).
- **Phobos EX (`sample/phobos_ex/`)**: a copy of Phobos carrying one real
  pane (e.g. a mission-status panel: rank, scanned tiers, doom-clock once
  it's running; `visible` flipped by story progress) plus the CLI fallback
  path (`window_available` false → the SCORE verb remains authoritative).
  The original `sample/phobos/` is untouched and stays byte-identical to the
  I7 port. Note: golden discovery walks one level into `sample/` subdirs, so
  EX's walkthrough becomes a second full-game golden — acceptable (it should
  stay passing anyway), but worth watching for suite runtime.

### Out of scope for v1 (unchanged from Non-goals)

Buffers-as-panes, side docks on the TUI, per-window input, freestyle content,
and the status-line re-expression (follow-up: reproduce the bar as a 1-row
top window via `window_line_split`, byte-identical on both hosts, then retire
the `status` message).

## Open questions

- Grid-faithfulness: is the repaint-block kind enough, or does some target
  (live map art?) genuinely need cursor addressing rather than whole-line
  recomposition? (Composing lines game-side is the bet; revisit if a real
  pane fights it.)
- Handshake timing: is a single pre-loop `capabilities` message enough, or do
  we need mid-session capability change (browser window going tiny)? (Mid-
  session host→worker signaling collides with the blocked-worker constraint;
  a stale-until-next-turn answer may be acceptable.)
- Does the library auto-fold unsupported panes' content into the transcript,
  or is degradation each game's problem? (Leaning: the library offers a
  helper; the game opts in — Phobos EX will force the question.)
- Should `window_refresh_rules` render read-only (the TODO "read-only render
  flag") so `[cycling]`/`[first time]` text in a pane doesn't churn every
  turn? (Leaning yes, but it rides on that flag landing.)
