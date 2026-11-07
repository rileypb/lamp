# Building for the Web

Lighthouse packages a game as a self-contained static web app — the
runtime and your compiled game in a Web Worker, wrapped in a polished
browser shell.

```sh
node src/lighthouse/build.js mygame.lamp dist/mygame
# or, installed globally:
lighthouse mygame.lamp dist/mygame
```

The output directory (default `dist/<name>/`) contains `index.html`
(its `<title>` templated from your game's `title`/`author`), `shell.js` /
`shell.css` (the browser shell), `sw.js` (a service worker), and
`game.worker.js` (runtime + game, minified), plus `assets/` and
`assets.json` when the game declares images. Everything is static files —
no server code.

**Web builds are release builds**: debug verbs, `not_for_release` files,
and your test scripts are excluded, so a shipped bundle can't be cheated
past its puzzles. Options:

- `--debug` — keep the debug tooling (for testing the shell).
- `--encode-strings` — obfuscate prose and names in `game.worker.js`, so
  view-source doesn't spoil the game. Casual-proof, not cryptography.
- `--no-minify` — readable output for debugging.
- `--eject-shell` — copy the stock shell into `<game>.shell/` to
  customize ([Custom Shells](../4-presentation/c-custom-shells.md)).

## What players get

The shell provides the full amenities: scrollback with `[more]` paging,
the status bar and any panes your game declares, save/restore dialogs
backed by localStorage, transcript download, canvas panes and your custom
shell layer if present, and light/dark theming.

## Serving it

The bundle must be served over **HTTP** — opening `index.html` via
`file://` won't work (the service worker can't register). Any static
server does:

```sh
npx serve dist/mygame
```

The service worker is what makes plain static hosting sufficient: the
engine needs cross-origin isolation (for `SharedArrayBuffer`), and the
worker synthesizes the required headers itself — no server configuration,
which is why a bundle runs on GitHub Pages, itch.io-style hosts, or any
dumb file server.

Bundles use only relative URLs and scope their service worker to their
own directory, so several games can live as subdirectories of one site
without colliding. Lamp's own repository deploys its sample games to
GitHub Pages exactly this way (`.github/workflows/deploy-pages.yml` is a
working reference: build each game into `dist/<name>`, add a landing
page, upload the lot).

---

Next: [Building a Desktop App](d-electron-builds.md).
