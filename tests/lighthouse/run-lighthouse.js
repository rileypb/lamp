#!/usr/bin/env node
// Build-artifact tests for the Lighthouse web bundle: static smoke checks that
// buildWeb() emits a complete, parseable bundle with the expected wiring, plus a
// headless END-TO-END drive of the built worker bundle over the real wire protocol
// (drive-bundle.js hosts game.worker.js in a worker_thread behind a `self` shim —
// no browser needed). Only shell.js's own DOM behavior stays manual-only.
// Run with: npm run test:lighthouse

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { buildWeb } = require("../../src/lighthouse");
const { buildElectron } = require("../../src/lighthouse/electron");
const { driveBundle } = require("./drive-bundle");

const GAME = path.join(__dirname, "..", "..", "sample", "cloak.lamp");

let failures = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (err) {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(`  ${err.message}`);
    }
}

// Compiles parse-only: confirms valid JS without executing browser-only globals.
function assertParses(code, label) {
    assert.doesNotThrow(() => new vm.Script(code, { filename: label }), `${label} should parse as valid JS`);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-"));
let result;

const minOutDir = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-min-"));

async function main() {
try {
    // Build unminified so the structural markers below survive (minify mangles
    // local identifiers like runGame).
    result = buildWeb(GAME, outDir, { minify: false });

    await test("emits all bundle files", () => {
        for (const file of ["game.worker.js", "index.html", "shell.css", "shell.js", "sw.js"]) {
            assert.ok(fs.existsSync(path.join(outDir, file)), `missing ${file}`);
        }
    });

    await test("worker bundle parses and contains the bootstrap + game", () => {
        const code = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assertParses(code, "game.worker.js");
        assert.ok(code.includes("function runGame"), "runGame bootstrap missing");
        assert.ok(code.includes("setInputChannel"), "input channel wiring missing");
        assert.ok(/runGame\(function/.test(code), "game factory wrapper missing");
    });

    await test("worker bundle wires the brokered save channel", () => {
        const code = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assert.ok(code.includes("setSaveChannel"), "save channel wiring missing");
        assert.ok(
            code.includes("save_write") && code.includes("save_read") && code.includes("save_list"),
            "save broker messages missing",
        );
    });

    await test("shell services save/restore via localStorage", () => {
        const shell = fs.readFileSync(path.join(outDir, "shell.js"), "utf8");
        assert.ok(
            shell.includes("save_write") && shell.includes("save_read") && shell.includes("save_list"),
            "shell save handlers missing",
        );
        assert.ok(
            shell.includes("save_prompt") && shell.includes("restore_prompt"),
            "shell save/restore modal handlers missing",
        );
        assert.ok(shell.includes("localStorage"), "shell localStorage backing missing");
        assert.ok(shell.includes("saveBuffer"), "shell save buffer missing");
    });

    await test("transcript: worker wires the channel and the shell accumulates + downloads", () => {
        const worker = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assert.ok(worker.includes("setTranscriptChannel"), "worker transcript channel wiring missing");
        assert.ok(
            worker.includes("transcript_start") && worker.includes("transcript_write") && worker.includes("transcript_stop"),
            "transcript broker messages missing",
        );
        const shell = fs.readFileSync(path.join(outDir, "shell.js"), "utf8");
        assert.ok(
            shell.includes('case "transcript_start"') && shell.includes('case "transcript_write"') && shell.includes('case "transcript_stop"'),
            "shell transcript handlers missing",
        );
        assert.ok(shell.includes("downloadTranscript"), "shell transcript download missing");
    });

    await test("status line: a look-bar window end to end (old status channel retired)", () => {
        // The traditional status line is a `look "bar"` text window
        // (lib/advent/status.lamp); the dedicated status channel is gone.
        const worker = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assert.ok(!worker.includes("setStatusChannel"), "retired status channel still wired in worker");
        assert.ok(worker.includes('"status bar"'), "advent status_bar window missing from the bundle");
        const shell = fs.readFileSync(path.join(outDir, "shell.js"), "utf8");
        assert.ok(!shell.includes('case "status"'), "retired status handler still in shell");
        assert.ok(shell.includes("pane-bar"), "shell bar-look pane class missing");
        const css = fs.readFileSync(path.join(outDir, "shell.css"), "utf8");
        assert.ok(css.includes(".pane-bar"), "bar-look styling missing");
    });

    await test("text windows: worker forwards messages + capabilities; shell docks panes", () => {
        const worker = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assert.ok(worker.includes("setWindowChannel"), "worker window channel wiring missing");
        assert.ok(worker.includes("setHostCapabilities"), "worker capabilities wiring missing");
        const shell = fs.readFileSync(path.join(outDir, "shell.js"), "utf8");
        assert.ok(
            shell.includes('case "window_set"') && shell.includes('case "window_update"'),
            "shell window handlers missing",
        );
        assert.ok(shell.includes("capabilities"), "shell capabilities in init missing");
        const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
        for (const id of ["win-top", "win-bottom", "win-left", "win-right"]) {
            assert.ok(html.includes(`id="${id}"`), `pane container ${id} missing`);
        }
        const css = fs.readFileSync(path.join(outDir, "shell.css"), "utf8");
        assert.ok(css.includes(".pane") && css.includes(".pane-fill"), "pane styling missing");
    });

    await test("canvas panes: shell advertises kinds, renders ops, resolves the asset manifest", () => {
        // The renderer itself is DOM/canvas (manual browser pass, like modals and
        // the pager); this asserts the wiring shipped: the kinds advertisement,
        // the canvas handlers, the assets.json fetch, and the pane styling. A
        // no-image game still ships an (empty) manifest so the fetch never 404s.
        const shell = fs.readFileSync(path.join(outDir, "shell.js"), "utf8");
        assert.ok(shell.includes('kinds: ["text", "canvas"]'), "shell kinds advertisement missing");
        assert.ok(shell.includes("assets.json"), "shell asset manifest fetch missing");
        assert.ok(shell.includes("paintCanvasPane") && shell.includes("drawImage"), "shell canvas renderer missing");
        assert.ok(shell.includes("devicePixelRatio"), "DPR-aware backing store missing");
        assert.ok(shell.includes("hotspotAt") && shell.includes("synthesizeCommand"),
            "shell hotspot click machinery missing");
        const css = fs.readFileSync(path.join(outDir, "shell.css"), "utf8");
        assert.ok(css.includes(".pane-canvas"), "canvas pane styling missing");
        const manifest = JSON.parse(fs.readFileSync(path.join(outDir, "assets.json"), "utf8"));
        assert.deepStrictEqual(manifest, {}, "an imageless game ships an empty manifest");
    });

    await test("service worker parses and sets isolation headers", () => {
        const code = fs.readFileSync(path.join(outDir, "sw.js"), "utf8");
        assertParses(code, "sw.js");
        assert.ok(code.includes("Cross-Origin-Opener-Policy"), "COOP header missing");
        assert.ok(code.includes("Cross-Origin-Embedder-Policy"), "COEP header missing");
    });

    await test("index.html registers the service worker", () => {
        const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
        assert.ok(html.includes("serviceWorker.register"), "SW registration missing");
        assert.ok(html.includes("game.worker.js") || html.includes("shell.js"), "shell entry missing");
    });

    await test("index.html title is 'Name by Author' from the game source", () => {
        const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
        assert.ok(
            html.includes("<title>Cloak of Darkness by Roger Firth</title>"),
            "page title should be derived from the game name and author",
        );
    });

    await test("index.html title uses the display `title` field, not the identifier", () => {
        // The game's identifier is `Analytical`, but it sets a `title` with spaces and
        // punctuation an identifier can't hold. The page title must use the title field
        // (via Lantern's --meta sidecar), not the identifier — REVIEW 1.5.
        const titledOut = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-titled-"));
        buildWeb(path.join(__dirname, "titled.lamp"), titledOut, { minify: false });
        const html = fs.readFileSync(path.join(titledOut, "index.html"), "utf8");
        assert.ok(
            html.includes("<title>The Analytical Engine - A Difference Story by Ada Lovelace</title>"),
            `page title should use the title field, got: ${(html.match(/<title>[\s\S]*?<\/title>/) || [])[0]}`,
        );
    });

    await test("minified bundle parses and is smaller", () => {
        buildWeb(GAME, minOutDir, { minify: true });
        const min = fs.readFileSync(path.join(minOutDir, "game.worker.js"), "utf8");
        const plain = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assertParses(min, "game.worker.js (minified)");
        assert.ok(min.length < plain.length, "minified bundle should be smaller than unminified");
    });

    // Electron project (devdocs/lighthouse.md "Electron"): buildElectron wraps
    // buildWeb's output verbatim (minus the inert sw.js) in a project directory —
    // main.js serving app:// with isolation headers around a locked-down renderer,
    // and a package.json the author runs with `npx electron .`. The bundle inside
    // must stay playable over the same wire protocol as the web build. Whether
    // Chromium actually grants crossOriginIsolated under app:// is covered by the
    // LAMP_SMOKE self-check in the generated main.js (needs a real Electron).
    await test("electron project: web bundle minus sw.js, main.js + package.json around it", async () => {
        const elOut = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-electron-"));
        try {
            const result = buildElectron(GAME, elOut, { minify: true });
            for (const file of ["main.js", "preload.js", "package.json", "app/index.html",
                "app/game.worker.js", "app/shell.js", "app/shell.css", "app/assets.json"]) {
                assert.ok(fs.existsSync(path.join(elOut, file)), `missing ${file}`);
            }
            assert.ok(!fs.existsSync(path.join(elOut, "app", "sw.js")),
                "the inert service worker must not ship in the Electron project");
            assert.ok(!result.files.includes(path.join("app", "sw.js")),
                "sw.js must not be reported in the file list");

            const main = fs.readFileSync(path.join(elOut, "main.js"), "utf8");
            assertParses(main, "main.js");
            assert.ok(main.includes("registerSchemesAsPrivileged"), "app:// scheme privileges missing");
            assert.ok(main.includes("Cross-Origin-Opener-Policy") && main.includes("Cross-Origin-Embedder-Policy"),
                "isolation header injection missing");
            assert.ok(main.includes("sandbox: true") && main.includes("contextIsolation: true"),
                "locked-down renderer webPreferences missing");

            // fs-backed saves: the preload bridge exposes exactly the broker's four
            // operations; main.js services them as files under userData. The shell
            // stays the stock web file — it prefers the bridge when present and
            // falls back to localStorage (the web backing) when not.
            assert.ok(main.includes("preload:"), "preload bridge not wired into webPreferences");
            for (const channel of ["lamp-save-list", "lamp-save-read", "lamp-save-write", "lamp-save-remove"]) {
                assert.ok(main.includes(`ipcMain.handle("${channel}"`), `main.js missing ${channel} handler`);
            }
            assert.ok(main.includes('getPath("userData")'), "saves must live under userData");
            const preload = fs.readFileSync(path.join(elOut, "preload.js"), "utf8");
            assertParses(preload, "preload.js");
            assert.ok(preload.includes('exposeInMainWorld("lampSaves"'), "lampSaves bridge missing");
            const stockShell = fs.readFileSync(path.join(__dirname, "..", "..", "src", "lighthouse", "web", "shell.js"), "utf8");
            assert.strictEqual(fs.readFileSync(path.join(elOut, "app", "shell.js"), "utf8"), stockShell,
                "the Electron app must ship the stock web shell byte-identical");
            assert.ok(stockShell.includes("window.lampSaves"), "shell save-backend seam missing");

            const pkg = JSON.parse(fs.readFileSync(path.join(elOut, "package.json"), "utf8"));
            assert.strictEqual(pkg.main, "main.js");
            assert.ok(/^[a-z0-9][a-z0-9._-]*$/.test(pkg.name), `package name must be npm-safe, got: ${pkg.name}`);
            assert.strictEqual(pkg.productName, "Cloak of Darkness");
            assert.strictEqual(pkg.author, "Roger Firth");
            assert.strictEqual(pkg.scripts.start, "electron .");
            assert.ok(pkg.devDependencies.electron, "electron devDependency missing");

            // The app/ bundle is the stock web shell: the isolation guard remains
            // (it exits early under app://) and the title templating ran.
            const html = fs.readFileSync(path.join(elOut, "app", "index.html"), "utf8");
            assert.ok(html.includes("crossOriginIsolated"), "the shell's isolation guard must remain");
            assert.ok(html.includes("<title>Cloak of Darkness by Roger Firth</title>"), "title templating missing");

            const { output } = await driveBundle(path.join(elOut, "app"), ["west", "quit"]);
            assert.ok(output.includes("Cloakroom"), "the packaged bundle should play over the wire protocol");
        } finally {
            fs.rmSync(elOut, { recursive: true, force: true });
        }
    });

    // End-to-end: drive the MINIFIED bundle (the shape that ships) through the real
    // browser-worker wire protocol — SAB input fill, save/restore via the modal picker
    // messages, transcript capture, RESTART, and a clean `done`. One session, several
    // contract assertions.
    await test("bundle end-to-end: play, save/restore, transcript, restart, quit", async () => {
        const { output, transcripts, windowMessages } = await driveBundle(minOutDir, [
            "west",         // Foyer -> Cloakroom
            "save",         //   -> save_prompt modal (harness answers "e2e") -> "Game saved."
            "hang cloak on hook",
            "script",       // transcript on; the verb prompts for the file name...
            "log",          //   ...which arrives on the next line
            "east",         // captured in the transcript
            "script off",   // closing message is screen-only, not in the file
            "restore",      //   -> restore_prompt picker (harness returns the blob) -> pre-hang state
            "undo",         // restore cleared the undo history -> nothing to undo
            "restart",      // Infocom confirmation...
            "y",            //   ...accepted -> intro reprints
            "quit",
        ]);
        assert.ok(output.includes("Game saved."), "save via the modal picker protocol failed");
        assert.ok(output.includes("Game restored."), "restore via the picker protocol failed");
        assert.ok(output.includes("You can't undo any further."),
            "undo history should be empty right after a restore");
        assert.ok(output.includes("Do you wish to restart? (Y is affirmative):"),
            "mid-game RESTART should ask for confirmation");
        const introCount = output.split("Hurrying through the rainswept November night").length - 1;
        assert.strictEqual(introCount, 2, "RESTART should re-run startup (intro printed twice)");
        // The status line rides the window wire now: cloak (a plain advent game)
        // must ship a bar-look top window whose split carries the room + turns.
        const statusSet = windowMessages.find((m) => m.type === "window_set" && m.id === "status bar");
        assert.ok(statusSet, "status bar window_set missing");
        assert.strictEqual(statusSet.look, "bar");
        assert.strictEqual(statusSet.dock, "top");
        assert.ok(statusSet.priority < 0, "status bar priority should sit nearest the top edge");
        const statusUpd = windowMessages.find((m) => m.type === "window_update" && m.id === "status bar" && m.lines.length);
        assert.ok(statusUpd, "status bar content missing");
        const statusLine = statusUpd.lines[0];
        assert.ok(statusLine.some((r) => r.fill), "status line should carry the left/right split fill");
        assert.ok(statusLine[statusLine.length - 1].text.includes("turns"),
            "status right segment should show the turn count");
        const log = transcripts.get("log");
        assert.ok(log != null, "transcript 'log' was never started");
        assert.ok(log.includes("> east") && log.includes("Foyer"),
            "transcript should capture the command and its output");
        assert.ok(!log.includes("Transcript ended."),
            "the closing message must be screen-only, not in the transcript file");
    });

    // End-to-end for text windows: build the windows1 fixture as a real bundle and
    // drive it — capabilities must reach window_available in the game, and the pane's
    // arrangement + content must stream over the wire with the spec'd run encoding
    // (devdocs/text-windows.md). Only the shell's DOM rendering stays manual.
    await test("windows bundle end-to-end: capabilities reach the game; panes stream over the wire", async () => {
        const winOut = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-win-"));
        try {
            buildWeb(path.join(__dirname, "..", "fixtures", "windows1.lamp"), winOut, { minify: false });
            const { output, windowMessages } = await driveBundle(winOut, ["panes", "hide panel", "quit"]);
            assert.ok(output.includes("The host shows side panes."),
                "window_available should see the host's four-dock capabilities");
            const sets = windowMessages.filter((m) => m.type === "window_set" && m.id === "side panel");
            assert.ok(sets.length >= 2, "window_set should arrive at every prompt");
            assert.deepStrictEqual(
                { dock: sets[0].dock, size: sets[0].size, visible: sets[0].visible, title: sets[0].title },
                { dock: "right", size: 20, visible: true, title: "Mission" },
                "first window_set should carry the declared arrangement");
            assert.strictEqual(sets[sets.length - 1].visible, false,
                "HIDE PANEL should surface as visible:false in the next window_set");
            const upd = windowMessages.find((m) => m.type === "window_update" && m.id === "side panel" && m.lines.length);
            assert.ok(upd, "no window_update with content arrived");
            assert.deepStrictEqual(upd.lines[0], [{ text: "=", fill: true }], "rule line encoding");
            assert.deepStrictEqual(upd.lines[1], [{ text: "Mission", styles: ["bold"] }], "styled line encoding");
            assert.strictEqual(upd.lines[2][0].text, "Turns", "split line left segment");
            assert.strictEqual(upd.lines[2][1].fill, true, "split line fill run");
        } finally {
            fs.rmSync(winOut, { recursive: true, force: true });
        }
    });

    // Freestyle windows step 2 (devdocs/freestyle-windows.md): the `image`
    // declaration + a canvas pane through a real built bundle. The meta sidecar
    // must carry the declared asset (Lighthouse's step-3 copy source), and the
    // canvas ops must stream over the wire with the spec'd encoding. Under a
    // kinds-aware capability set window_kind_available answers true; the ops
    // stream regardless (hosts without support drop them at the transport).
    await test("image declaration + canvas pane: meta sidecar carries assets; ops stream over the wire", async () => {
        const imgOut = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-img-"));
        try {
            buildWeb(path.join(__dirname, "..", "fixtures", "image1.lamp"), imgOut, { minify: false });
            const meta = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "build", "image1.meta.json"), "utf8"));
            assert.strictEqual(meta.assets.length, 1, "one declared asset expected");
            assert.strictEqual(meta.assets[0].name, "floor_map");
            assert.ok(meta.assets[0].sourcePath.endsWith(path.join("tests", "fixtures", "art", "map.svg")),
                `asset sourcePath should resolve to the declared file, got: ${meta.assets[0].sourcePath}`);

            // Step 3: the bundle carries the declared asset (name-keyed, extension
            // preserved) and a manifest the shell resolves image ops through.
            const manifest = JSON.parse(fs.readFileSync(path.join(imgOut, "assets.json"), "utf8"));
            assert.deepStrictEqual(manifest, { floor_map: "assets/floor_map.svg" });
            assert.strictEqual(
                fs.readFileSync(path.join(imgOut, "assets", "floor_map.svg"), "utf8"),
                fs.readFileSync(path.join(__dirname, "..", "fixtures", "art", "map.svg"), "utf8"),
                "bundled asset should be a byte copy of the declared file");

            const { output, windowMessages } = await driveBundle(imgOut, ["canvases", "quit"], {
                capabilities: { windows: { docks: ["top", "bottom", "left", "right"], kinds: ["text", "canvas"] } },
            });
            assert.ok(output.includes("The host draws canvas panes."),
                "window_kind_available should see the host's canvas kind");
            const set = windowMessages.find((m) => m.type === "window_set" && m.id === "map pane");
            assert.ok(set, "canvas window_set missing");
            assert.strictEqual(set.kind, "canvas");
            assert.deepStrictEqual(set.canvas, { w: 160, h: 120 });
            const upd = windowMessages.find((m) => m.type === "window_update" && m.id === "map pane" && (m.ops || []).length);
            assert.ok(upd, "no canvas window_update with ops arrived");
            assert.deepStrictEqual(upd.ops[0], { op: "rect", color: "black", x: 0, y: 0, w: 160, h: 120 });
            assert.deepStrictEqual(upd.ops[1], { op: "image", image: "floor_map", x: 8, y: 8, w: 32, h: 32 });
            assert.strictEqual(upd.ops[2].op, "line");
            assert.deepStrictEqual(upd.ops[3], { op: "text", color: "white", x: 8, y: 56, size: 12, text: "GALLERY" });
        } finally {
            fs.rmSync(imgOut, { recursive: true, force: true });
        }
    });

    // Custom shells (devdocs/custom-shells.md): the shellgame fixture ships a
    // shellgame.shell/ directory — custom.js + custom.css (the hook path) and a
    // shell.css override (the eject path). The bundle must carry the extras,
    // apply the override, inject the tags, and the game must see shell: true
    // and stream shell_event messages. A shell-less capability set gets the
    // text fallback and no events.
    await test("custom shell: shell dir packaging + shell_send over the wire", async () => {
        const shOut = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-shell-"));
        try {
            buildWeb(path.join(__dirname, "..", "fixtures", "shellgame.lamp"), shOut, { minify: false });

            const fixtures = path.join(__dirname, "..", "fixtures", "shellgame.shell");
            assert.strictEqual(
                fs.readFileSync(path.join(shOut, "shell.css"), "utf8"),
                fs.readFileSync(path.join(fixtures, "shell.css"), "utf8"),
                "shell.css override should replace the stock file");
            for (const extra of ["custom.js", "custom.css"]) {
                assert.strictEqual(
                    fs.readFileSync(path.join(shOut, extra), "utf8"),
                    fs.readFileSync(path.join(fixtures, extra), "utf8"),
                    `${extra} should copy verbatim`);
            }
            const html = fs.readFileSync(path.join(shOut, "index.html"), "utf8");
            assert.ok(html.includes('<script src="custom.js"></script>'), "custom.js tag missing");
            assert.ok(html.includes('<link rel="stylesheet" href="custom.css">'), "custom.css tag missing");
            const stockHtml = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
            assert.ok(!stockHtml.includes("custom.js"), "a stock bundle must carry no custom tags");
            // The capability must be computed at DOMContentLoaded — during
            // shell.js's own evaluation the injected custom.js tag after it is
            // not yet in the DOM (parser-blocking; the first manual pass bug).
            const shellSrc = fs.readFileSync(path.join(shOut, "shell.js"), "utf8");
            assert.ok(shellSrc.includes("DOMContentLoaded"),
                "init post must wait for DOMContentLoaded");
            assert.ok(shellSrc.indexOf("shell: !!document.querySelector") > shellSrc.indexOf("function start"),
                "capabilities.shell must be queried inside the deferred start");

            const withShell = await driveBundle(shOut, ["cue", "quit"], {
                capabilities: { windows: { docks: ["top"] }, shell: true },
            });
            assert.ok(withShell.output.includes("The shell hears the cue."), "shell_available should be true");
            assert.deepStrictEqual(withShell.shellMessages, [
                { type: "shell_event", name: "theme", payload: "noir" },
                { type: "shell_event", name: "sound", payload: "sting" },
            ], "startup + cue events in order");

            const withoutShell = await driveBundle(shOut, ["cue", "quit"], {
                capabilities: { windows: { docks: ["top"] } },
            });
            assert.ok(withoutShell.output.includes("No shell to cue."), "text fallback without a custom layer");
            assert.deepStrictEqual(withoutShell.shellMessages, [], "no events without shell_available");
        } finally {
            fs.rmSync(shOut, { recursive: true, force: true });
        }
    });

    // --eject-shell seeds <game>.shell/ with the stock shell files, never
    // overwriting existing customizations.
    await test("--eject-shell seeds the shell dir without overwriting", async () => {
        const tmpGameDir = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-eject-"));
        const ejOut = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-ejout-"));
        try {
            fs.copyFileSync(path.join(__dirname, "..", "fixtures", "shellgame.lamp"),
                path.join(tmpGameDir, "shellgame.lamp"));
            const shellDir = path.join(tmpGameDir, "shellgame.shell");
            fs.mkdirSync(shellDir);
            fs.writeFileSync(path.join(shellDir, "shell.css"), "/* mine */\n", "utf8");
            buildWeb(path.join(tmpGameDir, "shellgame.lamp"), ejOut, { minify: false, ejectShell: true });
            for (const f of ["index.html", "shell.css", "shell.js", "sw.js"]) {
                assert.ok(fs.existsSync(path.join(shellDir, f)), `eject should seed ${f}`);
            }
            assert.strictEqual(fs.readFileSync(path.join(shellDir, "shell.css"), "utf8"), "/* mine */\n",
                "eject must not overwrite an existing customization");
            assert.strictEqual(fs.readFileSync(path.join(ejOut, "shell.css"), "utf8"), "/* mine */\n",
                "the build uses the preserved override");
        } finally {
            fs.rmSync(tmpGameDir, { recursive: true, force: true });
            fs.rmSync(ejOut, { recursive: true, force: true });
        }
    });

    // The KIM hacking simulator (devdocs/custom-shells.md; the first real
    // custom-shell consumer): under a shell-capable host the game streams whole
    // "kim" board states each turn, suppresses the ASCII keypad art, and reports
    // a transient "solved" when the hack succeeds; without the custom layer the
    // ASCII keypads render as always and no events flow.
    await test("phobos_ex KIM simulator: board states + solved over the wire; ASCII art suppressed", async () => {
        const exOut = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-kim-"));
        try {
            buildWeb(path.join(__dirname, "..", "..", "sample", "phobos_ex", "phobos_ex.lamp"), exOut, { minify: false });
            const html = fs.readFileSync(path.join(exOut, "index.html"), "utf8");
            assert.ok(html.includes('<script src="custom.js"></script>'), "EX bundle should carry the KIM custom layer");

            // Route to the locker: bypass the green door, walk to South Barracks,
            // hack, then solve (start {R,B,B,R}; press 1 and 4 → all blue).
            const walk = ["hack green door", "north", "north", "east", "south", "hack locker", "press 1", "press 4", "quit"];
            const withShell = await driveBundle(exOut, walk, {
                timeoutMs: 60000,
                capabilities: { windows: { docks: ["top", "bottom", "left", "right"], kinds: ["text", "canvas"] }, shell: true },
            });
            const kim = withShell.shellMessages.filter((m) => m.name === "kim").map((m) => m.payload);
            const boards = kim.filter((p) => p !== "off");
            assert.deepStrictEqual(boards, ["4|locker|RBBR", "4|locker|BBBR", "solved|4|locker|BBBB"],
                "whole-board states per turn, then the solved transient carrying the FINAL board");
            assert.ok(kim.includes("off"), "idle turns report off");
            assert.ok(withShell.output.includes("Galaxy presses button 1."), "prose still prints");
            assert.ok(!withShell.output.includes("= red"), "ASCII keypad art suppressed under the custom layer");
            assert.ok(withShell.output.includes("the locker swings open"), "the real puzzle rules adjudicated the presses");

            const withoutShell = await driveBundle(exOut, walk, { timeoutMs: 60000 });
            assert.ok(withoutShell.output.includes("= red"), "ASCII keypad art renders without the custom layer");
            assert.deepStrictEqual(withoutShell.shellMessages, [], "no events without shell_available");
        } finally {
            fs.rmSync(exOut, { recursive: true, force: true });
        }
    });

    // Phobos EX responsive UI (devdocs/custom-shells.md): the mission pane is
    // gone (spoilers) and the deck plan moved from a freestyle canvas pane to the
    // custom shell — a fog-of-war "map" feed each turn: seen rooms with ciphered
    // labels, label-less clickable frontier cells on Galaxy's neighbors, corridor
    // edges between visible cells, and the whole visible plan re-sent per turn.
    await test("phobos_ex map feed: fog of war, frontier cells, growth on movement", async () => {
        const exOut = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-ex-"));
        try {
            buildWeb(path.join(__dirname, "..", "..", "sample", "phobos_ex", "phobos_ex.lamp"), exOut, { minify: false });

            const web = await driveBundle(exOut, ["hack green door", "north", "north", "quit"], {
                timeoutMs: 60000,
                capabilities: { windows: { docks: ["top", "bottom", "left", "right"], kinds: ["text", "canvas"] }, shell: true },
            });
            assert.ok(!web.windowMessages.some((m) => m.id === "mission panel"),
                "the mission pane is removed");
            assert.ok(!web.windowMessages.some((m) => m.id === "deck map"),
                "the canvas deck map is removed");
            const maps = web.shellMessages.filter((m) => m.name === "map").map((m) => m.payload);
            assert.ok(maps.length >= 2, "a map state per prompt");
            // First prompt: Galaxy at Passage End (2,5) — one seen cell (hers) and
            // one frontier "?" on the Southern Spoke (2,4), clickable north; the
            // label is ciphered (not "entry"), the frontier label empty.
            const first = maps[0];
            const [herePos, roomsField, edgesField] = first.split("|");
            assert.strictEqual(herePos, "2,5");
            const rooms = roomsField.split(";");
            assert.strictEqual(rooms.length, 2, "fog of war: only here + one frontier at the start");
            const hereCell = rooms.find((r) => r.startsWith("2,5,"));
            assert.ok(hereCell.startsWith("2,5,h,,"), "here-cell flagged h with no command");
            assert.ok(!hereCell.includes("entry"), "seen labels render through the cipher");
            assert.ok(rooms.includes("2,4,f,north,"), "frontier cell: label-less, clickable north");
            assert.strictEqual(edgesField, "2,4,2,5", "one corridor between here and the frontier");
            // After walking north the Southern Spoke is seen and new frontiers
            // appear (Storeroom west, Hub north; Passage End stays seen).
            const after = maps[maps.length - 2];
            const afterRooms = after.split("|")[1].split(";");
            assert.ok(afterRooms.some((r) => r.startsWith("2,4,h,")), "Southern Spoke is now here");
            assert.ok(afterRooms.some((r) => r.startsWith("2,5,s,south,")), "Passage End seen and clickable back");
            assert.ok(afterRooms.some((r) => r.startsWith("1,4,f,west,")), "Storeroom frontier");
            assert.ok(afterRooms.some((r) => r.startsWith("2,2,f,north,")), "Hub frontier");

            // Frontier memory: another north (to the Hub) — the Storeroom's "?"
            // PERSISTS (glimpsed, not seen) but is no longer clickable (empty
            // command: click-to-walk stays adjacency-only), while the Hub's own
            // frontiers appear as clickable "?" cells.
            const atHub = maps[maps.length - 1].split("|")[1].split(";");
            assert.ok(atHub.some((r) => r.startsWith("2,2,h,")), "Hub is now here");
            assert.ok(atHub.some((r) => r === "1,4,f,,"), "the Storeroom's ? persists, inert at a distance");
            assert.ok(atHub.some((r) => r.startsWith("1,2,f,west,")), "Western Spoke frontier clickable");
            assert.ok(atHub.some((r) => r.startsWith("3,2,f,east,")), "Eastern Spoke frontier clickable");

            // The [fit] Galaxy banner (text.md I3): hacking the green door scores
            // a point, flashing the figlet — which must arrive as ONE write
            // segment (the single-print contract: literal newlines, constant
            // styling), carrying all six art lines under fixed+fit.
            const fitWrites = web.writes.filter((w) => (w.styles || []).includes("fit"));
            assert.strictEqual(fitWrites.length, 1, "one banner flash = one fit segment");
            assert.ok(fitWrites[0].styles.includes("fixed"), "the figlet keeps its fixed styling");
            assert.strictEqual(fitWrites[0].value.split("\n").length, 6,
                "the whole six-line figlet rides in the single segment");
            const shellSrc = fs.readFileSync(path.join(exOut, "shell.js"), "utf8");
            assert.ok(shellSrc.includes("fitToWidth"), "shell fit machinery missing");
            assert.ok(fs.readFileSync(path.join(exOut, "shell.css"), "utf8").includes(".style-fit"),
                "shell fit styling missing");

            const noShell = await driveBundle(exOut, ["quit"], { timeoutMs: 60000 });
            assert.deepStrictEqual(noShell.shellMessages, [], "no map feed without the custom layer");
        } finally {
            fs.rmSync(exOut, { recursive: true, force: true });
        }
    });
} finally {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.rmSync(minOutDir, { recursive: true, force: true });
}

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log("\nall lighthouse tests passed");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
