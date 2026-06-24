#!/usr/bin/env node
// Unit tests for the interactive TUI render backend (backends/tui.js). Drives the
// backend with a mock stdout (captures escape sequences) and a mock stdin (an
// EventEmitter), so the layout/input logic is exercised without a real terminal —
// the actual on-screen rendering is verified manually. Run: npm run test:tui

const assert = require("assert");
const { EventEmitter } = require("events");
const { createTuiBackend, wrapLine } = require("../../src/lamplighter/sandbox/backends/tui");

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (err) {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(`  ${err.stack || err.message}`);
    }
}

function mockOut(cols = 40, rows = 10) {
    const e = new EventEmitter();
    e.columns = cols;
    e.rows = rows;
    e.buf = "";
    e.write = (s) => { e.buf += s; return true; };
    return e;
}
function mockIn() {
    const e = new EventEmitter();
    e.rawMode = null;
    e.setRawMode = (v) => { e.rawMode = v; };
    e.resume = () => {};
    return e;
}

// --- wrapLine (pure) -------------------------------------------------------
test("wrapLine: empty line yields one blank display line", () => {
    assert.deepStrictEqual(wrapLine("", 10), [""]);
});
test("wrapLine: short line is unchanged", () => {
    assert.deepStrictEqual(wrapLine("hello", 10), ["hello"]);
});
test("wrapLine: breaks at the last space within the window", () => {
    assert.deepStrictEqual(wrapLine("hello world foo", 11), ["hello world", "foo"]);
});
test("wrapLine: hard-breaks an over-long word", () => {
    assert.deepStrictEqual(wrapLine("abcdefghij", 4), ["abcd", "efgh", "ij"]);
});
test("wrapLine: preserves leading/internal spacing", () => {
    assert.deepStrictEqual(wrapLine("  indented", 20), ["  indented"]);
});

// --- backend lifecycle + rendering -----------------------------------------
test("start enters alt screen + raw mode; stop restores both", () => {
    const out = mockOut();
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    assert.ok(out.buf.includes("\x1b[?1049h"), "alt screen on");
    assert.strictEqual(input.rawMode, true);
    b.stop();
    assert.ok(out.buf.includes("\x1b[?1049l"), "alt screen off");
    assert.strictEqual(input.rawMode, false);
});

test("status bar is reverse-video, left/right justified to width", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    b.setStatus("Foyer", "3 turns");
    assert.ok(out.buf.includes("\x1b[7m"), "reverse video used");
    const segs = [...out.buf.matchAll(/\x1b\[7m(.*?)\x1b\[0m/g)].map((m) => m[1]);
    const bar = segs[segs.length - 1];
    assert.strictEqual(bar, "Foyer" + " ".repeat(28) + "3 turns");
    b.stop();
});

test("input request → typing → Enter echoes the command and delivers the line", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    b.write("You are in a foyer.\n");
    let delivered = null;
    b.requestLine("> ", (line) => { delivered = line; });
    input.emit("data", Buffer.from("look"));
    assert.ok(out.buf.includes("> look"), "input line shows the typed command");
    input.emit("data", Buffer.from("\r"));
    assert.strictEqual(delivered, "look");
    b.stop();
});

test("Backspace deletes the last typed character", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    let delivered = null;
    b.requestLine("> ", (line) => { delivered = line; });
    input.emit("data", Buffer.from("lookk"));
    input.emit("data", Buffer.from("\x7f")); // backspace
    input.emit("data", Buffer.from("\r"));
    assert.strictEqual(delivered, "look");
    b.stop();
});

test("Ctrl-C restores the terminal and exits via the injected exit", () => {
    const out = mockOut();
    const input = mockIn();
    let code = null;
    const b = createTuiBackend({ out, input, exit: (c) => { code = c; } });
    b.start();
    input.emit("data", Buffer.from("\x03"));
    assert.strictEqual(code, 130);
    assert.strictEqual(input.rawMode, false, "raw mode restored on quit");
    assert.ok(out.buf.includes("\x1b[?1049l"), "alt screen exited on quit");
});

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log("\nAll TUI tests passed.");
