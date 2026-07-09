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

    // Phobos EX (the first real windows consumer, devdocs/text-windows.md step 4):
    // the mission-status pane docks right on a four-dock host, and its startup rule
    // re-docks it to a 4-row top pane when only top/bottom are available (the TUI's
    // capability set) — the capability-handshake + mutable-arrangement path, driven
    // end-to-end through a real built bundle.
    await test("phobos_ex mission panel: right dock on the web set, top-dock fallback on the TUI set", async () => {
        const exOut = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-lighthouse-ex-"));
        try {
            buildWeb(path.join(__dirname, "..", "..", "sample", "phobos_ex", "phobos_ex.lamp"), exOut, { minify: false });

            const web = await driveBundle(exOut, ["quit"], { timeoutMs: 60000 });
            const webSet = web.windowMessages.find((m) => m.type === "window_set" && m.id === "mission panel");
            assert.ok(webSet, "mission panel window_set missing");
            assert.strictEqual(webSet.dock, "right", "four-dock host keeps the right dock");
            assert.strictEqual(webSet.size, 26);
            assert.strictEqual(webSet.title, "Mission");
            const upd = web.windowMessages.find((m) => m.type === "window_update" && m.id === "mission panel" && m.lines.length);
            assert.ok(upd, "mission panel content missing");
            assert.deepStrictEqual(upd.lines[0], [{ text: "Galaxy Jones", styles: ["bold"] }]);
            assert.deepStrictEqual(upd.lines[1], [{ text: "-", fill: true }]);
            assert.strictEqual(upd.lines[2][0].text, "Score", "score split line present");
            assert.ok(upd.lines.some((l) => l[0] && l[0].text === "Rank"), "rank line present");
            assert.ok(!upd.lines.some((l) => l[0] && l[0].text === "Countdown"),
                "no countdown line at Passage End (Galaxy hasn't heard the PA yet)");

            const tui = await driveBundle(exOut, ["quit"], {
                timeoutMs: 60000,
                capabilities: { windows: { docks: ["top", "bottom"] } },
            });
            const tuiSet = tui.windowMessages.find((m) => m.type === "window_set" && m.id === "mission panel");
            assert.ok(tuiSet, "mission panel window_set missing on the TUI set");
            assert.strictEqual(tuiSet.dock, "top", "startup rule re-docks to top when right is unavailable");
            assert.strictEqual(tuiSet.size, 3, "top-dock fallback shrinks to 3 rows");
            // The refresh composes a compact layout for the row-precious top dock:
            // two fields per row, no rule, everything within the reserved rows.
            const tuiUpd = tui.windowMessages.find((m) => m.type === "window_update" && m.id === "mission panel" && m.lines.length);
            assert.ok(tuiUpd, "mission panel content missing on the TUI set");
            assert.ok(tuiUpd.lines.length <= tuiSet.size, "compact layout fits the reserved rows");
            assert.deepStrictEqual(tuiUpd.lines[0][0], { text: "Galaxy Jones", styles: ["bold"] },
                "compact first row leads with the bold header");
            assert.ok(tuiUpd.lines[0].some((r) => r.text && r.text.startsWith("Score")),
                "compact first row carries the score");
            assert.ok(tuiUpd.lines[1].some((r) => r.text && r.text.startsWith("Scans")),
                "compact second row carries the scans (previously clipped on the TUI)");
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
