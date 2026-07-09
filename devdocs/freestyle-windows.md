# Freestyle Windows — graphics panes (constrained ops)

> **Step 1 is built (2026-07-09, branch `freestyle`):** the `content_kind`/
> `canvas_w`/`canvas_h` fields (lib/sys/types.lamp), the four canvas ops +
> `window_kind_available` (lib/sys natives → runtime), the per-pane draw-list
> buffer flushed by `windowSync` (`window_set` gains `kind` — and `canvas: {w,h}`
> on canvas panes; `window_update` declares `kind` and carries `ops` for canvas
> panes, `lines` for text), kind-mismatch/color/space validation with errors
> naming the window, and 8 new unit tests (tests/windows). All 244 goldens
> byte-invariant; native-scan/tui/state/save/sandbox/transcript/release/encode/
> lighthouse suites pass. Two spec adjustments discovered in the build:
> **`kind` is a Lamp keyword** (the kind declaration), so the field is named
> `content_kind` and the native's parameter `content_kind` — the wire still says
> `kind`; and `canvas_image` takes the image name as a **string** until the
> `image` declaration lands in step 2 (the text-window precedent: natives don't
> take lib-declared types). **Merge hazard:** this branch is based just before
> commit `4e8c829` (`window_sync_one`); when that merges in, `windowSyncOne`
> must send the same kind-aware `window_set`/`window_update` payloads —
> factoring the per-window send out of `windowSync` for both callers.
>
> **Step 2 is built (2026-07-09):** the `image NAME: file "PATH"` declaration end
> to end — parsed **contextually** on its exact shape (`image` is *not* a
> keyword, so it stays usable as an ordinary identifier; a game's own
> `type image` objects still parse), name as a plain **uncoerced** identifier
> (registry key = what the author writes in the `canvas_image` reference — the
> kind-name precedent, not object-name coercion); checker errors on a missing
> file (resolved relative to the declaring source) and on duplicate names;
> emitter registers `lamplighter.defineImage(name, path)` (name encodes under
> `--encode-strings`; verified decoding to the same registry key); runtime keeps
> the registry and `canvas_image` now validates names against it (a typo errors
> loudly on any host) with `getImagePath(name)` as the host-side accessor; the
> `--meta` sidecar gains `assets: [{ name, sourcePath }]` (absolute, so
> Lighthouse copies without re-parsing). Tests: goldens `image1` (canvas pane +
> declaration end-to-end on the plain host, byte-invariant stdout) and
> `image_missing` (compile error), a lighthouse e2e (sidecar assets + canvas
> ops through a real built bundle under a kinds-aware capability set), and
> registry unit tests in tests/windows. All 246 goldens + every suite pass.
> Language surface recorded in specs.md → "Image assets".
>
> Status: **design decided 2026-07-09; steps 1–2 built, steps 3–4 remain.** This doc specs the
> *constrained-ops* variant of freestyle windows — point (2) on the
> presentation spectrum recorded in TODO.md item 9: a docked pane whose content
> is a closed vocabulary of drawing ops (images, rects, lines, text-at-position)
> that the **stock** shell renders on a canvas. The author writes zero host-side
> JavaScript; all their code stays in Lamp, inside the worker sandbox. The
> iframe content kind and full author-custom shells (points 3–4 of the
> spectrum) are explicitly out of scope here and get their own design pass.
> Builds directly on the window model (devdocs/text-windows.md — layout,
> handshake, recompute cadence, wire) and the packaging model
> (devdocs/lighthouse.md).

## Purpose

Let a game show composed graphics alongside the transcript — a map pane, a room
illustration, a diagram — without changing Lamp's trust model or the host
boundary. A freestyle window is an ordinary `window` object with a different
content kind: instead of lines of styled text runs, its per-turn refresh
composes a **draw list** the host replays onto a canvas.

## Boundaries

- **In scope:** the `content_kind` field on windows; the virtual-canvas coordinate
  model; the v1 op set (image, rect, line, text); the `image` asset
  declaration and its compile-time check; Lighthouse asset bundling; the web
  shell's canvas renderer; the capability-handshake extension (content
  *kinds*); tests and one real consumer.
- **Out of scope:** clickable hotspots / any input from a pane (deferred —
  additive on this wire, shares command-synthesis machinery with the
  custom-shell feature); sound and video; arbitrary HTML / the sandboxed-iframe
  content kind; game-driven animation (the worker is blocked between turns);
  TUI rendering of graphics (the handshake says no).

## What carries over from the window model (decided, not revisited)

- **Declaration:** a freestyle pane is the same lib/sys `window` object —
  `dock`/`size`/`priority`/`visible`/`title` as ordinary mutable,
  snapshot-covered fields. Arrangement travels with undo/save/restore for free.
- **Content model:** declarative per-turn recompute (`window_refresh_rules` →
  `window_sync()`), idempotent **whole-pane repaint** — the newest update is
  the whole truth. After UNDO/RESTORE/RESTART the next sync repaints the map
  correctly with nothing snapshotted. The draw-list buffer is transient render
  state, never saved, exactly like the text line buffer.
- **Wire posture:** fire-and-forget worker→host messages, never blocking,
  never transcript-captured. `window_set` declares, `window_update` repaints.
- **Degradation:** the transport silently drops unrenderable panes; the
  library can *ask* first (capability handshake) so the game falls back
  deliberately (e.g. a text map pane, or keeping a MAP/LOOK verb
  authoritative). Plain/piped hosts see nothing — golden output is
  byte-invariant by construction.

## Decisions (2026-07-09)

1. **Op vocabulary — images + primitives.** Draw image, fill rect, line,
   text-at-position; clear is implicit in the repaint model. Roughly the Glk
   graphics floor plus line/text. Covers illustrations *and* composed maps.
   Richer vector shapes (paths, arcs, gradients) are rejected for v1 — a much
   larger renderer contract to freeze for no catalogued need.
2. **Coordinates — declared virtual canvas.** The window declares a logical
   space (e.g. 320×200); every op uses those units; the host scales the space
   to fit the pane, preserving aspect ratio (letterboxing as needed). The game
   never learns the pane's real size — the resize problem stays a pure host
   concern, same philosophy as width-agnostic text lines.
3. **Assets — explicit Lamp declaration.** `image <name>: file "<path>"` at
   top level. The compiler verifies the file exists (path relative to the
   game source); Lighthouse copies exactly the declared set into the bundle.
   No convention directory, no separate manifest to hand-maintain.
4. **Hotspots — deferred.** v1 is output-only, like text windows v1. The wire
   is shaped so a later `hotspots` field on the update payload is additive.

## Candidate spec

### The `window` type extension (lib/sys)

```lamp
type window:
    …existing fields…
    string content_kind = "text"   # "text" | "canvas" (`kind` is a Lamp keyword —
                                   # the kind declaration — so the field can't
                                   # bear that name; the wire carries it as `kind`)
    int canvas_w = 0               # virtual-space width  (canvas panes; required)
    int canvas_h = 0               # virtual-space height (canvas panes; required)
```

A canvas pane's `size` is its requested screen extent in the docked dimension
(see "Sizing" below); `canvas_w`/`canvas_h` define the coordinate space ops
draw in. `content_kind` is validated at sync like `dock` (bad kind → a clear
runtime error naming the window), and canvas panes additionally require
positive `canvas_w`/`canvas_h` there.

```lamp
window deck_map:
    dock right
    content_kind "canvas"
    canvas_w 160
    canvas_h 240
```

### Asset declaration (Lantern)

```lamp
image cover_art: file "art/cover.png"
```

- Inline one-liner, recognized **contextually** by its exact shape (`image
  IDENT: file "STRING"`) — `image` is not a keyword. `<name>` is a plain,
  **uncoerced** identifier (the string in a `canvas_image` reference matches
  the declaration verbatim); the `file` path is resolved **relative to the
  declaring source file**.
- **Checker:** missing file → compile error naming the declaration and path;
  duplicate names → compile error naming both declarations.
- **Emitter:** `defineImage(name, path)` runtime registration. Names are
  registry keys like object names; `--encode-strings` encodes them (decode
  runs at load, same argument as every other name) — but note art is
  inherently visible in the bundle; assets are never "spoiler-hidden". The
  path stays plaintext (build metadata, not player prose).
- **Runtime:** the registry backs `canvas_image`'s name validation (a typo'd
  or undeclared name errors at the call on any host) and exposes
  `getImagePath(name)` for hosts.
- **Meta sidecar:** the `--meta` sidecar (which already carries game identity)
  gains the declared asset list `assets: [{ name, sourcePath }]` (`sourcePath`
  absolute), so Lighthouse learns what to copy without re-parsing.

### Ops (lib/sys primitives)

All coordinates/sizes in the window's virtual units. `color` is a string:
one of the lib/sys color-style names (the 16 ANSI/Z-machine names), or
`#rrggbb` — validated at the call site (a typo errors loudly rather than
rendering nothing on a distant host); the shell sets it as a canvas style —
it never touches markup. Pane parameters are declared `object` (the
text-window precedent: natives don't take lib-declared types).

- `canvas_rect(object w, string color, int x, int y, int wd, int ht)` — filled
  rectangle. A full-space rect is the background fill.
- `canvas_line(object w, string color, int x1, int y1, int x2, int y2)`
- `canvas_text(object w, string color, int x, int y, int size, string text)` —
  `size` is font height in virtual units; host renders monospace, baseline at
  `y + size` (top-left anchored box, like rect). Substitutions render; style
  wrappers are stripped (one color per op; no run model on a canvas).
- `canvas_image(object w, string img, int x, int y, int wd, int ht)` — draw a
  declared image, by **name**, scaled into the box. (`wd`/`ht` mandatory in
  v1: the game can't query intrinsic image size, and mandatory boxes keep
  composition deterministic. The name is a string until — and likely after —
  the `image` declaration lands in step 2; the step-2 checker can then
  validate literal names against declared images.)

Ops append to the window's transient draw list; `window_sync()` /
`window_sync_one()` flush it exactly as they flush text lines. Calling a
canvas op on a text window (or `window_line` on a canvas window) is a runtime
error naming the window — content kind is not mixed.

### Wire protocol

`window_set` gains the new fields:

| Message | Payload |
| --- | --- |
| `window_set` | `{ id, dock, size, priority, visible, title, kind, canvas: {w, h}? }` |
| `window_update` | `{ id, kind, ops }` for canvas panes — `ops`: array of `{ op: "rect"\|"line"\|"text"\|"image", … }` mirroring the primitives; image ops carry the asset **name** |

Text panes are unchanged (`lines` payload; `kind: "text"` explicit). Updates
remain idempotent whole repaints. A later hotspot feature adds a field to this
payload; no message shape changes.

Handshake: the host→worker `capabilities` message gains kinds —
`{ windows: { docks: [...], kinds: ["text", "canvas"] } }`. Absent `kinds`
means `["text"]` (back-compat with the shipped shell). Lamp surface:
`window_kind_available(string kind) -> bool` beside `window_available(dock)`.

### Sizing (the one layout difference text-windows.md anticipated)

For `content_kind "canvas"`, `size` is interpreted in **CSS pixels** for the docked
dimension (width for left/right, height for top/bottom), host-clamped exactly
like the 45% side-pane clamp today. Clamping is layout, and layout is the
host's; the virtual canvas guarantees content correctness at any real size.
The cross dimension follows the dock (full height/width of the pane box); the
canvas letterboxes inside it.

### Asset pipeline (Lighthouse)

- Build copies each declared asset into `assets/` in the bundle (name-keyed,
  extension preserved: `assets/<name>.<ext>`; name collisions across
  different source paths are a build error) and emits `assets.json`
  (`{ name: relativePath }`).
- The shell fetches `assets.json` at boot, lazily loads images on first
  reference (`Image` element → `drawImage`; a missing/failed image renders a
  placeholder box rather than throwing). SVG via `<img>`/`drawImage` does not
  execute scripts, so `.svg` is safe to allow alongside png/jpg/webp/gif.
- The service worker's synthesized isolation headers already cover same-origin
  subresources; no CORP issue for bundled assets.
- **Dev/CLI:** no host renders canvas panes outside the web shell; seeing the
  art means a web build. (A dev-mode web preview is a possible later nicety.)

### Web shell rendering

A canvas pane is a `<canvas>` element in the existing dock containers,
participating in the same flex order/priority layout as text panes. On
`window_update` the shell stores the draw list and repaints; on resize/theme
change it repaints from the cache (the same host-redraws-from-cache property
the text panes have). Scale factor = fit `canvas_w`×`canvas_h` into the pane
box, aspect preserved, centered. Device-pixel-ratio-aware backing store so art
isn't blurry on HiDPI. Strings drawn via `fillText` only — nothing from the
wire ever touches markup.

### TUI / plain

- **TUI:** advertises `kinds: ["text"]`; canvas panes are ignored if they
  arrive (the handshake already said no). No graphics-to-ASCII heroics.
- **Plain:** advertises nothing, ignores everything, byte-invariant goldens.

### Tests & first consumer

- **Unit (`tests/windows/`):** capturing channel asserts the ops encoding,
  kind mismatch errors, canvas fields on `window_set`, undo reverting a
  `content_kind`/arrangement change, and that draw lists are cleared per sync.
- **Compiler:** goldens for the `image` declaration (ok, missing file error,
  meta sidecar contents).
- **Lighthouse e2e (`drive-bundle.js`):** build a fixture with a canvas pane +
  a declared image; assert assets copied, `assets.json` correct, ops arrive
  under a `kinds: ["text","canvas"]` capability set and are dropped under the
  TUI set.
- **First consumer:** **Phobos EX** gains a deck-map canvas pane (right dock;
  rooms as rects, visited-state fill, "you" marker, Siriusian labels via
  `canvas_text`) with the text mission pane retained as the
  `window_kind_available("canvas") == false` fallback. The original
  `sample/phobos/` stays untouched, as ever.

## Build steps (proposed, in order)

1. **Runtime + Lamp surface:** `content_kind`/`canvas_w`/`canvas_h` fields, the four
   ops, draw-list buffering in `window_sync`, `window_kind_available`, wire
   messages, unit tests. No host renders yet (the step-1 pattern from text
   windows).
2. **Compiler:** the `image` declaration end to end (parse → check file →
   emit `defineImage` → meta sidecar), with goldens.
3. **Web shell + Lighthouse:** asset copying + `assets.json`, the canvas
   renderer, capability advertisement, e2e.
4. **First consumer:** the Phobos EX deck map + fallback path; manual browser
   pass.

## Assumptions

- Whole-pane draw lists re-sent each turn are cheap (panes are small; ops are
  tiny JSON) — same bet the text repaint model already won.
- Aspect-preserving scale-to-fit is the right default and the only mode in
  v1 (no stretch/tile modes until something real asks).
- Monospace is an acceptable v1 font story for `canvas_text`.

## Non-goals (v1)

Hotspots/input, sound, video, iframe/HTML content, animation or host-side
transitions, rotation/transform ops, gradients/paths, per-window font choice,
TUI graphics, image intrinsic-size queries.

## Open questions

- `size` in CSS px for canvas panes: right call, or percent of the play area?
  (px matches "host clamps anyway"; revisit if the first consumer fights it.)
- Should `canvas_text` participate in i18n/glyph ciphers (Phobos's Siriusian
  swaps strings game-side, so probably nothing needed — confirm with the EX
  pane).
- Does the library offer a standard fold-back helper for text fallback panes,
  or is that each game's problem? (Same open question as text windows; the EX
  consumer forces it again.)
- Asset dedup/hashing in the bundle (two declarations of the same file; cache
  busting on redeploys) — decide at step 3.
