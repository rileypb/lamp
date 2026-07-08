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

test("a look-bar window renders full-width reverse video with the split justified", () => {
    // The traditional status line: a `look "bar"` top window (lib/advent/status.lamp)
    // whose split line justifies left/right across the whole 40-column row.
    const out = mockOut(40, 10);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    b.windowSet({ type: "window_set", id: "status bar", dock: "top", size: 1, priority: -100, visible: true, title: "", look: "bar" });
    b.windowUpdate({
        type: "window_update",
        id: "status bar",
        lines: [[{ text: "Foyer" }, { text: " ", fill: true }, { text: "3 turns" }]],
    });
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
    for (let n = 0; n < 10; n += 1) b.write(`L${n}\n`); // L0..L9 → overflows, pauses at [more]
    // Page past the [more] pauses (any key advances) so the lines land in scrollback;
    // with no prompt pending, surplus keypresses are ignored.
    for (let n = 0; n < 8; n += 1) input.emit("data", Buffer.from(" "));
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

test("output longer than the screen pauses with [more] and pages on a keypress", () => {
    const out = mockOut(20, 5); // no windows → viewH = the whole 5 rows
    const input = mockIn();
    let delivered = null;
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    for (let n = 0; n < 10; n += 1) b.write(`line ${n}\n`); // 10 rows > 5 → pauses (twice)
    assert.ok(out.buf.includes("[more]"), "[more] shown when output overflows the screen");
    b.requestLine("> ", (line) => { delivered = line; });
    input.emit("data", Buffer.from(" ")); // page 2 — still paging, prompt held back
    out.buf = "";
    input.emit("data", Buffer.from(" ")); // caught up → the held prompt appears
    assert.ok(out.buf.includes("> "), "the deferred prompt appears once paging completes");
    assert.ok(!out.buf.includes("[more]"), "[more] is cleared on the last page");
    input.emit("data", Buffer.from("look\r"));
    assert.strictEqual(delivered, "look", "input is delivered normally after paging");
    b.stop();
});

// --- text-window panes (devdocs/text-windows.md) ----------------------------
// The wire messages the host routes: windowSet (arrangement) + windowUpdate
// (repaint-block content). Helpers extract what a screen row holds by finding
// the last write after a moveTo(row, 1).
function rowContent(buf, row) {
    const marker = `\x1b[${row};1H\x1b[2K`;
    const at = buf.lastIndexOf(marker);
    if (at < 0) return null;
    const rest = buf.slice(at + marker.length);
    const next = rest.indexOf("\x1b[");
    return next < 0 ? rest : rest.slice(0, next);
}

test("backend advertises top/bottom dock capabilities", () => {
    const b = createTuiBackend({ out: mockOut(), input: mockIn(), exit() {} });
    assert.deepStrictEqual(b.capabilities, { windows: { docks: ["top", "bottom"] } });
});

test("a top pane reserves the first rows; the game area starts below it + a spacer", () => {
    const out = mockOut(40, 12);
    const b = createTuiBackend({ out, input: mockIn(), exit() {} });
    b.start();
    b.windowSet({ type: "window_set", id: "hud", dock: "top", size: 2, priority: 0, visible: true, title: "" });
    b.windowUpdate({ type: "window_update", id: "hud", lines: [[{ text: "Quests" }], [{ text: "- find lamp" }]] });
    out.buf = "";
    b.write("You are in a foyer.\n");
    assert.strictEqual(rowContent(out.buf, 1), "Quests", "pane line 1 at row 1");
    assert.strictEqual(rowContent(out.buf, 2), "- find lamp", "pane line 2 at row 2");
    assert.strictEqual(rowContent(out.buf, 3), "", "blank spacer row under the top block");
    assert.strictEqual(rowContent(out.buf, 4), "You are in a foyer.", "game area starts below the spacer");
    b.stop();
});

test("a bottom pane occupies the last rows; lower priority is nearer the bottom edge", () => {
    const out = mockOut(40, 12);
    const b = createTuiBackend({ out, input: mockIn(), exit() {} });
    b.start();
    b.windowSet({ type: "window_set", id: "bar", dock: "bottom", size: 1, priority: 0, visible: true, title: "" });
    b.windowUpdate({ type: "window_update", id: "bar", lines: [[{ text: "nearest edge" }]] });
    b.windowSet({ type: "window_set", id: "info", dock: "bottom", size: 1, priority: 5, visible: true, title: "" });
    out.buf = "";
    b.windowUpdate({ type: "window_update", id: "info", lines: [[{ text: "above it" }]] });
    // rows=12, two 1-row bottom panes, no top block: game area 1..10, panes at
    // 11 (info) and 12 (bar).
    assert.strictEqual(rowContent(out.buf, 11), "above it");
    assert.strictEqual(rowContent(out.buf, 12), "nearest edge");
    b.stop();
});

test("pane lines render styles, fill rules, and the left/right split at full width", () => {
    const out = mockOut(20, 12);
    const b = createTuiBackend({ out, input: mockIn(), exit() {} });
    b.start();
    b.windowSet({ type: "window_set", id: "hud", dock: "top", size: 3, priority: 0, visible: true, title: "" });
    out.buf = "";
    b.windowUpdate({
        type: "window_update",
        id: "hud",
        lines: [
            [{ text: "=", fill: true }],
            [{ text: "Mission", styles: ["bold"] }],
            [{ text: "Turns" }, { text: " ", fill: true }, { text: "12" }],
        ],
    });
    assert.ok(out.buf.includes("=".repeat(20)), "fill rule spans the full width");
    assert.ok(out.buf.includes("\x1b[1mMission\x1b[0m"), "bold pane run rendered as SGR");
    assert.ok(out.buf.includes("Turns" + " ".repeat(13) + "12"), "split line justifies right segment to the edge");
    b.stop();
});

test("a hidden pane reserves nothing; re-showing restores it", () => {
    const out = mockOut(40, 12);
    const b = createTuiBackend({ out, input: mockIn(), exit() {} });
    b.start();
    b.windowSet({ type: "window_set", id: "hud", dock: "top", size: 1, priority: 0, visible: true, title: "" });
    b.windowUpdate({ type: "window_update", id: "hud", lines: [[{ text: "HUD" }]] });
    b.windowSet({ type: "window_set", id: "hud", dock: "top", size: 1, priority: 0, visible: false, title: "" });
    out.buf = "";
    b.write("You are in a foyer.\n");
    assert.strictEqual(rowContent(out.buf, 1), "You are in a foyer.", "game area reclaims row 1 when the pane hides");
    b.windowSet({ type: "window_set", id: "hud", dock: "top", size: 1, priority: 0, visible: true, title: "" });
    assert.strictEqual(rowContent(out.buf, 1), "HUD", "pane content kept and re-shown");
    b.stop();
});

test("left/right docks are ignored on the terminal (no rows reserved)", () => {
    const out = mockOut(40, 12);
    const b = createTuiBackend({ out, input: mockIn(), exit() {} });
    b.start();
    b.windowSet({ type: "window_set", id: "side", dock: "right", size: 20, priority: 0, visible: true, title: "" });
    b.windowUpdate({ type: "window_update", id: "side", lines: [[{ text: "sideways" }]] });
    out.buf = "";
    b.write("You are in a foyer.\n");
    assert.strictEqual(rowContent(out.buf, 1), "You are in a foyer.", "game area unmoved by an unsupported dock");
    assert.ok(!out.buf.includes("sideways"), "side-pane content is not drawn");
    b.stop();
});

test("pagination accounts for reserved pane rows", () => {
    const out = mockOut(40, 8);
    const input = mockIn();
    const b = createTuiBackend({ out, input, exit() {} });
    b.start();
    // rows=8: without panes viewH=8; a 3-row top pane + its spacer shrink it to 4.
    b.windowSet({ type: "window_set", id: "hud", dock: "top", size: 3, priority: 0, visible: true, title: "" });
    for (let n = 0; n < 5; n += 1) b.write(`line ${n}\n`); // 5 rows > 4 → must page
    assert.ok(out.buf.includes("[more]"), "[more] triggers at the pane-reduced viewport");
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
