# Text Windows

A **text window** is a pane docked beside the transcript — a status bar,
a quest sidebar, a mission panel, a compass. The transcript stays the
scrolling heart of the game; windows frame it.

## Declaring a pane

A window is an ordinary object:

```lamp
window mission_panel:
    dock right         # top | bottom | left | right
    size 28            # rows (top/bottom) or columns (left/right)
    priority 0         # stacking among same-edge panes (lower = nearer the edge)
    visible false      # revealed later by story progress
    title "Mission"    # side panes may render a header
```

Because these are ordinary fields, arrangement is world state: reveal
with `mission_panel.visible = true`, resize with `mission_panel.size =
3` — changes apply at the next turn's sync and *revert with undo and
restore* like everything else.

## Content: compose, don't paint

Window content is **recomputed from world state every turn**, by rules
you contribute to `window_refresh_rules`:

```lamp
rule window_refresh_rules:
    window_line(mission_panel, bold("Quests"))
    window_rule(mission_panel, "-")
    for q in quest.all:
        if q.active:
            window_line(mission_panel, freeze "- [q.title]")
    window_line_split(quest_bar, "Quest: admire the pebble", freeze "admired [pebbles_admired]x")
```

Three composers: `window_line` (a flush-left line, stylable with
`bold`/`italic`/`fixed`), `window_line_split` (left text, fill, right
text — the status-line shape), and `window_rule` (a full-width repeated
character). A pane whose refresh emits nothing renders empty.

This declarative model is why panes are effortless to keep honest:
content is a pure function of the world, so after UNDO, RESTORE, or
RESTART the next repaint is automatically correct — nothing to save,
nothing to patch up. For a mid-turn dramatic update, call
`window_sync()` yourself.

Pane content never enters the transcript (SCRIPT captures the main
stream only).

## Hosts and fallback

Not every host renders panes: the web and Electron shells support all
four docks, the terminal TUI supports top and bottom, and the plain piped
host renders none (so window code never disturbs test transcripts). Ask
before relying:

```lamp
rule startup_rules:
    if not window_available("right"):
        mission_panel.dock = "top"      # re-dock for the TUI...
        mission_panel.size = 3
    if not window_available("top"):
        mission_panel.visible = false   # ...or fall back to a verb
```

Keep a text path authoritative (a STATUS or SCORE verb) for hosts with no
panes at all. A pane's refresh rule can also read its own `dock` and
compose differently — a roomy sidebar gets one field per row, a scarce
top strip gets a compact layout.

## The status bar

The traditional status line is itself a window, `status_bar` — one
reverse-video top row, room name left, turns or score right. Restyle it
like any pane: `status_bar.size = 3` for a multi-row header,
`status_bar.visible = false` to remove it, or replace its content by
contributing to its own rulebook (your rule runs first and `stop`s the
default):

```lamp
rule status_line_rules:
    window_line_split(status_bar, freeze "[holder(player)]", freeze "Day [day]")
    stop true
```

A separate pre-placement rule (`when holder(player) == none`) covers the
moment before the player exists — override it for a title-screen caption.

---

Next: [Custom Shells](c-custom-shells.md).
