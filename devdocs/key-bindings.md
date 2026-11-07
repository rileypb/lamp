# Key bindings and silent commands

> Status: **built 2026-11-07**, unit-tested (`npm run test:tui`, `npm run
> test:shell`). Not yet checked by hand in a real terminal or browser. Asked for
> by Roguelight (`~/dev/roguelight`), which moves the player one map tile per
> Shift+Arrow.

## Purpose

Let a game give a key a command, so the player can act without typing and
without each act filling the transcript. The first use is single-tile movement
on a map, where a held key may send dozens of commands in a row.

## Boundaries

- **In scope:** the `bind_key` primitive and its wire message; the TUI's
  modified-arrow handling; the web shell's bound keys; silent delivery in both,
  including `LampShell.command(cmd, { silent: true })`.
- **Out of scope:** plain arrows, letters and other keys (plain arrows keep
  caret movement and history); any host→game data path besides an ordinary
  command line; queuing keys pressed mid-turn.

## The Lamp side

```lamp
native function void bind_key(string key, string command)
```

- `key` is one to three modifiers and an arrow, joined with `+`: `shift+up`,
  `ctrl+alt+left`. Case and modifier order don't matter. The runtime
  canonicalizes the name to `ctrl`, `alt`, `shift` order, so hosts match one
  spelling.
- An unknown name, a repeated modifier, or a plain arrow is a runtime error,
  thrown even on hosts that ignore bindings, so a typo shows up in testing.
- An empty `command` removes the binding.
- Fire-and-forget like `shell_send`. Call it from `startup_rules`. Bindings live
  in the host, not in game state, so UNDO, RESTORE and RESTART leave them alone.
  Rebinding is harmless.

The runtime seam is `setKeyChannel(impl)`, installed by both workers. The wire
message is `{ type: "key_bind", key, command }`.

## Host behavior

A bound key fires only when the game is waiting for a command and the input
line is empty. Otherwise:

- With text in the line, the key keeps its usual meaning (Shift+Left moves the
  caret in the TUI and selects in the browser).
- Mid-turn, mid-`[more]` or mid-modal, the key is dropped, not queued. A queue
  could walk the player on after danger appears.

When it fires, the command is delivered **silently**:

- no echo of the command line, and no entry in command history;
- the web shell removes the prompt it had already printed, so a run of steps
  leaves no bare `> ` lines (the TUI draws its prompt only on the input row, so
  it has nothing to remove);
- the command's own output prints as usual, so a step that prints nothing
  changes nothing in the transcript;
- an open SCRIPT/TRANSCRIPT file still records the prompt and command, because
  the runtime captures input itself (`promptLine`), so a saved transcript has
  no gaps.

| Host | Bindings |
| --- | --- |
| TUI | xterm `ESC [ 1 ; m <A-D>` (m − 1 is a bitmask: 1 shift, 2 alt, 4 ctrl), and rxvt Shift+arrow `ESC [ <a-d>` |
| Web shell | `keydown` on the input line, from `event.ctrlKey`, `altKey`, `shiftKey` and the arrow key |
| Plain (piped) | ignored: no backend `bindKey` |

Every bound command must also work when typed, since the plain host and some
terminals can't deliver the key.

## Assumptions

- Terminals differ in which modified arrows they pass through. macOS commonly
  takes Ctrl+Arrow for Spaces and sends Option+Arrow as word movement
  (`ESC b`, `ESC f`), which this doesn't recognize. Shift is the safest choice.
- A game can't ask whether a key works on the current host. See Open
  Questions.

## Open Questions

- Should hosts report which keys they can deliver (a capability such as
  `keys`), so a game can show "Shift+Arrow to step" only where it works?
- Should other keys be bindable, such as keypad digits for diagonal steps?
  The TUI can't tell keypad digits from typed ones in most terminals.
