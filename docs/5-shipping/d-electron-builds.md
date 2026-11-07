# Building a Desktop App

For a downloadable desktop game, Lighthouse emits an **Electron project
directory** — the web bundle wrapped in a minimal desktop app:

```sh
node src/lighthouse/build-electron.js mygame.lamp
# or, installed globally:
lighthouse-electron mygame.lamp
```

The output (default `dist/<name>-electron/`) is a ready-to-run project:
`main.js`, a generated `package.json` (name, product name, and author
from your game), the web bundle under `app/`, and a `README.md` with
these same instructions tailored to your game. All web-build options
pass through (`--encode-strings`, `--debug`, `--no-minify`, custom shell
directories ride along).

Run it:

```sh
cd dist/mygame-electron
npx electron .
```

(If you launch from a VSCode terminal and get a blank non-app, unset
`ELECTRON_RUN_AS_NODE` — VSCode exports it, which makes Electron run as
plain Node.)

A headless self-check is built in:

```sh
LAMP_SMOKE=1 npx electron .
```

prints a one-line report and exits 0 when the app boots correctly —
isolation, engine startup, and a save round-trip all verified. Useful in
CI.

## What the desktop app adds

The shell is byte-identical to the web build, but saves follow desktop
conventions: SAVE opens the OS save panel and writes a real `.lampsave`
file, RESTORE opens the OS open panel, and both remember the last folder
used. Players can back up, share, and organize save files like any
document. The renderer stays fully sandboxed — the game has no filesystem
access beyond that narrow save bridge.

## Packaging for distribution

The project directory *is* the deliverable for technical users; for
everyone else, package it:

```sh
npx @electron/packager . --out=release
```

This produces a double-clickable app (`--platform`/`--arch` for cross
targets, `--icon` for yours, `--asar` works). The generated
`package.json` already carries the metadata, so no configuration is
needed. For installers (dmg/msi/AppImage), step up to
[electron-builder](https://www.electron.build/).

One honest note: unsigned apps trigger OS warnings (Gatekeeper on macOS,
SmartScreen on Windows). Signing requires developer accounts and is
documented in the generated README; distributing through a storefront
like itch.io, whose users expect the bypass ritual, is the pragmatic
middle ground for hobby releases.

---

This concludes Part V. Continue with
[Part VI — Reference](../README.md#part-vi--reference).
