#!/usr/bin/env node
// Unit tests for the interactive TUI render backend (backends/tui.js). Drives the
// backend with a mock stdout (captures escape sequences) and a mock stdin (an
// EventEmitter), so the layout/input logic is exercised without a real terminal —
// the actual on-screen rendering is verified manually. Run: npm run test:tui

const assert = require("assert");
const { EventEmitter } = require("events");
const { createTuiBackend, wrapLine, textWidth } = require("../../src/lamplighter/sandbox/backends/tui");

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

// --- display width (pure) --------------------------------------------------
test("textWidth: ASCII and accented (single code point) are width 1 each", () => {
    assert.strictEqual(textWidth("café"), 4); // é is U+00E9, one code point, width 1
});
test("textWidth: CJK and emoji count as width 2", () => {
    assert.strictEqual(textWidth("你好"), 4);
    assert.strictEqual(textWidth("😀"), 2); // surrogate pair, one wide glyph
});
test("textWidth: combining marks are zero-width", () => {
    assert.strictEqual(textWidth("é"), 1); // e + combining acute
});
test("wrapLine: wraps on display width, not code-unit count", () => {
    assert.deepStrictEqual(wrapLine("你好世界", 5), ["你好", "世界"]); // 2 cols each → 2 per row of 5
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

test("styled output renders bold/italic SGR in the transcript", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    b.write("a ", []);
    b.write("brass", ["bold"]);
    b.write(" lantern\n", []);
    assert.ok(out.buf.includes("\x1b[1mbrass\x1b[0m"), "bold span rendered");
    assert.ok(out.buf.includes("a "), "plain text preserved");
    b.stop();
});

test("in-line editing: ← then insert puts the character mid-word", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    let delivered = null;
    b.requestLine("> ", (line) => { delivered = line; });
    input.emit("data", Buffer.from("lok"));     // caret after "lok"
    input.emit("data", Buffer.from("\x1b[D"));   // ← (caret between o and k)
    input.emit("data", Buffer.from("o"));        // insert → "look"
    input.emit("data", Buffer.from("\r"));
    assert.strictEqual(delivered, "look");
    b.stop();
});

test("Delete and Home/End edit within the line", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    let delivered = null;
    b.requestLine("> ", (line) => { delivered = line; });
    input.emit("data", Buffer.from("xlook"));
    input.emit("data", Buffer.from("\x1b[H"));   // Home → caret at start
    input.emit("data", Buffer.from("\x1b[3~"));  // Delete → removes leading x
    input.emit("data", Buffer.from("\r"));
    assert.strictEqual(delivered, "look");
    b.stop();
});

test("command history recalls previous lines with ↑/↓", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    const delivered = [];
    function ask() {
        b.requestLine("> ", (line) => { delivered.push(line); });
    }
    ask();
    input.emit("data", Buffer.from("look\r"));
    ask();
    input.emit("data", Buffer.from("north\r"));
    ask();
    input.emit("data", Buffer.from("\x1b[A")); // ↑ → "north"
    input.emit("data", Buffer.from("\x1b[A")); // ↑ → "look"
    input.emit("data", Buffer.from("\r"));
    assert.deepStrictEqual(delivered, ["look", "north", "look"]);
    b.stop();
});

test("an over-long typed command wraps onto a second row instead of truncating", () => {
    const out = mockOut(10, 10); // 10-column terminal
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    let delivered = null;
    b.requestLine("> ", (line) => { delivered = line; });
    out.buf = ""; // capture only the render after typing
    // prompt "> " (2) + 12 chars = 14 columns, must wrap across two 10-col rows
    input.emit("data", Buffer.from("abcdefghijkl"));
    assert.ok(out.buf.includes("> abcdefgh"), "first row holds the prompt + head");
    assert.ok(out.buf.includes("ijkl"), "the tail wraps onto the next row, not truncated");
    out.buf = ""; // capture the render after submit (the echo)
    input.emit("data", Buffer.from("\r"));
    assert.strictEqual(delivered, "abcdefghijkl", "the full command is still delivered");
    // The echo hard-wraps by column, so the prompt keeps its command on the same row
    // (word-wrap would break at the space after "> ", orphaning the prompt).
    assert.ok(out.buf.includes("> abcdefgh"), "echo keeps the command next to the prompt");
    b.stop();
});

test("a multi-byte char split across chunks is reassembled, not corrupted", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    let delivered = null;
    b.requestLine("> ", (line) => { delivered = line; });
    // "café": the é is UTF-8 0xC3 0xA9 — deliver it split across two data events.
    input.emit("data", Buffer.from([0x63, 0x61, 0x66, 0xc3]));
    input.emit("data", Buffer.from([0xa9]));
    input.emit("data", Buffer.from("\r"));
    assert.strictEqual(delivered, "café");
    b.stop();
});

test("an emoji is inserted and deleted as a single unit", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    let delivered = null;
    b.requestLine("> ", (line) => { delivered = line; });
    input.emit("data", Buffer.from("ab😀")); // surrogate pair
    input.emit("data", Buffer.from("\x7f")); // backspace removes the whole emoji
    input.emit("data", Buffer.from("c"));
    input.emit("data", Buffer.from("\r"));
    assert.strictEqual(delivered, "abc");
    b.stop();
});

test("← moves over an emoji by a whole code point", () => {
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    let delivered = null;
    b.requestLine("> ", (line) => { delivered = line; });
    input.emit("data", Buffer.from("a😀"));    // caret after the emoji
    input.emit("data", Buffer.from("\x1b[D")); // ← skips the whole emoji
    input.emit("data", Buffer.from("X"));       // insert between a and 😀
    input.emit("data", Buffer.from("\r"));
    assert.strictEqual(delivered, "aX😀");
    b.stop();
});

test("mouse wheel scrolls the transcript back and snaps forward", () => {
    const out = mockOut(20, 5); // viewH = rows - 2 = 3 visible transcript rows
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    assert.ok(out.buf.includes("\x1b[?1000h"), "mouse reporting enabled on start");
    for (let n = 0; n < 10; n += 1) b.write(`L${n}\n`); // L0..L9
    out.buf = ""; // capture only the next render
    input.emit("data", Buffer.from("\x1b[<64;1;1M")); // wheel up (button 64)
    assert.ok(out.buf.includes("L4"), "scrolled up to show earlier lines");
    assert.ok(!out.buf.includes("L9"), "newest line scrolled off");
    out.buf = "";
    input.emit("data", Buffer.from("\x1b[<65;1;1M")); // wheel down (button 65)
    assert.ok(out.buf.includes("L9"), "scrolled back toward the bottom");
    b.stop();
    assert.ok(out.buf.includes("\x1b[?1000l"), "mouse reporting disabled on stop");
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
