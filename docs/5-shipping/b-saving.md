# Saving and Restoring

Save, restore, undo, and restart all work in every Lamp game with no
authoring effort. This page is about what they capture, where saves live,
and the one thing an author must understand: build compatibility.

## The player's view

`save` and `restore` use **named slots**:

```
> save
Name for saved game: slot1
Game saved.
```

Each host renders the flow natively: the terminal prompts for a name, the
web shell shows save/restore dialogs with a slot picker (name, timestamp,
turn count), and an Electron build opens the OS file panels. `undo` steps
back one command — up to `undo_limit` turns (a plain global, default 32;
set it to 0 to disable undo, or any depth you like). `restart` rewinds to
the very beginning, intro and all, after a confirmation.

## What a save captures

Everything observable: object fields, globals, relations (the whole
containment tree), the turn counter, scene states — and the details that
make a restored game *indistinguishable* from one that never stopped: the
random stream's position, `[first time]` visit marks, `[one of]` cursors.
You never write serialization code; anything expressed as world state is
covered. (`const` data and window/pane *content* aren't saved — constants
never change, and panes recompute from world state at the next turn.)

## Where saves live

- **Terminal**: a per-user application-data directory
  (macOS `~/Library/Application Support/lamp/saves`, Linux
  `$XDG_DATA_HOME/lamp/saves`, Windows `%APPDATA%/lamp/saves`), files
  named `<Game>__<slot>.sav` — namespaced per game, so two games' `slot1`
  never collide.
- **Web**: the browser's localStorage, per game.
- **Electron**: real `.lampsave` files wherever the player chooses, with
  the OS dialogs remembering the last folder.

Save files are lightly obfuscated (not readable at a glance, and not
meant as security — the format is decodable by anyone determined).

## Build compatibility — the part authors must know

A save is keyed by the names in your compiled game — objects, fields,
globals, relations. Restoring a save into a *differently shaped* build
could silently corrupt the world, so Lamp refuses instead: every build
carries a **content hash of its sources**, stamped into each save, and
RESTORE rejects a mismatch with a clear message (distinguishing "this is
a different game" from "this save is from an older version").

The practical consequences:

- **Any source change invalidates existing saves.** Recompiling unchanged
  source keeps them valid (the hash is over sources, not output), and
  `--encode-strings`/minification don't matter — but fixing a typo in a
  description does.
- The `version`/`release` fields on your game are **display-only** — they
  are deliberately not the compatibility gate (authors forget to bump
  them).
- For a released game, treat updates as save-breaking: batch fixes,
  mention it in release notes, and remember players mid-game keep playing
  their downloaded copy happily — only *mixing* an old save with a new
  build refuses.

There is no cross-version save migration; that trade — strict refusal
over silent corruption — is the classic interpreter model, and it's the
right one for a system where saves are whole-world snapshots.

---

Next: [Building for the Web](c-web-builds.md).
