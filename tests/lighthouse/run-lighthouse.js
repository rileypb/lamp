#!/usr/bin/env node
// Build-artifact smoke tests for the Lighthouse web bundle.
//
// These assert that buildWeb() emits a complete, parseable bundle with the
// expected wiring. A full end-to-end run (worker + SharedArrayBuffer input +
// shell) requires a cross-origin-isolated browser and is out of scope for the
// Node test harness; the dev sandbox path (npm run test:sandbox) exercises that
// the compiled game actually runs. Run with: npm run test:lighthouse

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { buildWeb } = require("../../src/lighthouse");

const GAME = path.join(__dirname, "..", "..", "sample", "cloak.lamp");

let failures = 0;

function test(name, fn) {
    try {
        fn();
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

try {
    // Build unminified so the structural markers below survive (minify mangles
    // local identifiers like runGame).
    result = buildWeb(GAME, outDir, { minify: false });

    test("emits all bundle files", () => {
        for (const file of ["game.worker.js", "index.html", "shell.css", "shell.js", "sw.js"]) {
            assert.ok(fs.existsSync(path.join(outDir, file)), `missing ${file}`);
        }
    });

    test("worker bundle parses and contains the bootstrap + game", () => {
        const code = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assertParses(code, "game.worker.js");
        assert.ok(code.includes("function runGame"), "runGame bootstrap missing");
        assert.ok(code.includes("setInputChannel"), "input channel wiring missing");
        assert.ok(/runGame\(function/.test(code), "game factory wrapper missing");
    });

    test("worker bundle wires the brokered save channel", () => {
        const code = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assert.ok(code.includes("setSaveChannel"), "save channel wiring missing");
        assert.ok(
            code.includes("save_write") && code.includes("save_read") && code.includes("save_list"),
            "save broker messages missing",
        );
    });

    test("shell services save/restore via localStorage", () => {
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

    test("transcript: worker wires the channel and the shell accumulates + downloads", () => {
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

    test("status line: worker forwards it and the shell renders it", () => {
        const worker = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assert.ok(worker.includes("setStatusChannel") && worker.includes('"status"'),
            "worker status channel missing");
        const shell = fs.readFileSync(path.join(outDir, "shell.js"), "utf8");
        assert.ok(shell.includes('case "status"') && shell.includes("status-left"),
            "shell status handler missing");
        const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
        assert.ok(html.includes('id="status-bar"'), "status bar element missing");
        const css = fs.readFileSync(path.join(outDir, "shell.css"), "utf8");
        assert.ok(css.includes("#status-bar"), "status bar styling missing");
    });

    test("service worker parses and sets isolation headers", () => {
        const code = fs.readFileSync(path.join(outDir, "sw.js"), "utf8");
        assertParses(code, "sw.js");
        assert.ok(code.includes("Cross-Origin-Opener-Policy"), "COOP header missing");
        assert.ok(code.includes("Cross-Origin-Embedder-Policy"), "COEP header missing");
    });

    test("index.html registers the service worker", () => {
        const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
        assert.ok(html.includes("serviceWorker.register"), "SW registration missing");
        assert.ok(html.includes("game.worker.js") || html.includes("shell.js"), "shell entry missing");
    });

    test("index.html title is 'Name by Author' from the game source", () => {
        const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
        assert.ok(
            html.includes("<title>Cloak of Darkness by Roger Firth</title>"),
            "page title should be derived from the game name and author",
        );
    });

    test("minified bundle parses and is smaller", () => {
        buildWeb(GAME, minOutDir, { minify: true });
        const min = fs.readFileSync(path.join(minOutDir, "game.worker.js"), "utf8");
        const plain = fs.readFileSync(path.join(outDir, "game.worker.js"), "utf8");
        assertParses(min, "game.worker.js (minified)");
        assert.ok(min.length < plain.length, "minified bundle should be smaller than unminified");
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
