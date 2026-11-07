# Images

Graphics live in **canvas panes** — a window whose content is a small
vocabulary of drawing operations instead of text lines. Good for a map
pane, a room illustration, a diagram — all in pure Lamp, no custom shell
required.

## Declaring images

```lamp
image cover_art: file "art/cover.png"
image deck_plan: file "art/deck.svg"
```

The path is relative to the source file and checked at compile time (a
missing file fails the build). Lighthouse copies exactly the declared
assets into a web bundle. PNG, JPEG, WebP, GIF, and SVG are supported.
Note that image names are used *verbatim* in draw calls — unlike object
names, no underscore coercion applies.

## A canvas pane

A canvas pane is a window with a different content kind and a declared
**virtual coordinate space**:

```lamp
window map_pane:
    dock right
    size 240                # screen pixels in the docked dimension
    content_kind "canvas"
    canvas_w 160            # your logical units...
    canvas_h 240            # ...all drawing uses these
```

You always draw in virtual units; the host scales the space to fit the
pane, aspect preserved. Your game never needs to know the real size —
resizes and themes are the host's problem.

## Drawing

Compose in a refresh rule, like any window — the whole picture, every
turn, from world state:

```lamp
rule window_refresh_rules:
    canvas_rect(map_pane, "black", 0, 0, 160, 240)
    for r in room.all:
        if r.seen:
            canvas_rect(map_pane, "blue", r.map_x, r.map_y, 20, 14)
    canvas_image(map_pane, "compass_rose", 120, 200, 32, 32)
    canvas_text(map_pane, "white", 8, 8, 10, "DECK 2")
    canvas_hotspot(map_pane, 120, 200, 32, 32, "look")
```

The ops: `canvas_rect(w, color, x, y, wd, ht)`, `canvas_line(w, color,
x1, y1, x2, y2)`, `canvas_text(w, color, x, y, size, text)`,
`canvas_image(w, name, x, y, wd, ht)`, and `canvas_hotspot(w, x, y, wd,
ht, command)` — a clickable region that submits `command` as ordinary
typed input. Colors are the sixteen named styles (which follow the
player's theme) or `#rrggbb`. Because the pane repaints whole each turn,
UNDO and RESTORE keep the picture honest for free, and hotspots are
always as current as the drawing they overlay.

## Where it renders

Only the web and Electron shells draw canvas panes. Check and fall back:

```lamp
rule startup_rules:
    if window_kind_available("canvas"):
        map_pane.visible = true
```

Declare the pane `visible false` and reveal it only where supported;
terminal players keep the text experience (a MAP verb, the mission text
pane) as the authoritative path — a hotspot must never be the only way to
do something.

---

Next: [Localization](e-i18n.md).
