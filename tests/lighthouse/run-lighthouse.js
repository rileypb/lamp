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
