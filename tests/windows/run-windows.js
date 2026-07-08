#!/usr/bin/env node
// Unit tests for the text-window runtime (devdocs/text-windows.md): the per-window
// line buffer, the run encoding (styles/align/fill), the window_set/window_update
// wire messages, the capability query, and the snapshot behavior (arrangement
// reverts with the world; content buffers are transient). Drives the runtime
// primitives directly with a capturing channel — the wire's consumers (web shell,
// TUI) are later steps; the plain-host no-op path is covered by the `windows1`
// golden. Run with: npm run test:windows

const assert = require("assert");
const lamp = require("../../src/lamplighter");

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

lamp.bootstrapBuiltins();
lamp.defineType("game", ["object"], { author: "string" }, {});
// Mirrors lib/sys/types.lamp `type window`.
lamp.defineType("window", ["object"],
    { dock: "string", size: "int", priority: "int", visible: "bool", title: "string", look: "string" },
    { dock: "top", size: 1, priority: 0, visible: true, title: "", look: "pane" });
lamp.createObject("game", "WinGame", { author: "Me" });

const panel = lamp.createObject("window", "panel", { dock: "right", size: 20, title: "Mission" });
const ticker = lamp.createObject("window", "ticker", { dock: "bottom", priority: 2 });

let messages = [];
function installChannel() {
    messages = [];
    lamp.setWindowChannel((msg) => messages.push(msg));
}
function sets() { return messages.filter((m) => m.type === "window_set"); }
function updates() { return messages.filter((m) => m.type === "window_update"); }
function updateFor(id) { return updates().find((m) => m.id === id); }

test("sync sends window_set from fields then window_update per declared window", () => {
    installChannel();
    lamp.windowLine(panel, "Quests");
    lamp.windowSync();
    assert.deepStrictEqual(sets().map((m) => m.id).sort(), ["panel", "ticker"]);
    assert.deepStrictEqual(sets().find((m) => m.id === "panel"), {
        type: "window_set", id: "panel", dock: "right", size: 20, priority: 0, visible: true, title: "Mission", look: "pane",
    });
    assert.deepStrictEqual(sets().find((m) => m.id === "ticker"), {
        type: "window_set", id: "ticker", dock: "bottom", size: 1, priority: 2, visible: true, title: "", look: "pane",
    });
    assert.deepStrictEqual(updateFor("panel").lines, [[{ text: "Quests" }]]);
    assert.deepStrictEqual(updateFor("ticker").lines, [], "unwritten pane updates to empty content");
    // window_set precedes window_update for each window.
    const panelSetIdx = messages.findIndex((m) => m.type === "window_set" && m.id === "panel");
    const panelUpdIdx = messages.findIndex((m) => m.type === "window_update" && m.id === "panel");
    assert.ok(panelSetIdx < panelUpdIdx);
});

test("sync drains the buffer: a second sync sends empty lines", () => {
    installChannel();
    lamp.windowLine(panel, "once");
    lamp.windowSync();
    messages = [];
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("panel").lines, []);
});

test("style wrappers survive as styled runs; nesting composes; breaks are dropped", () => {
    installChannel();
    lamp.windowLine(panel, lamp.styled("bold", "Mission") + ": " + lamp.styled("bold", lamp.styled("italic", "Go")));
    lamp.windowLine(panel, "a" + lamp.outputMarker("line") + "b");
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("panel").lines, [
        [{ text: "Mission", styles: ["bold"] }, { text: ": " }, { text: "Go", styles: ["bold", "italic"] }],
        [{ text: "ab" }],
    ]);
});

test("window_line_split encodes left + fill + right; window_rule is one fill run", () => {
    installChannel();
    lamp.windowLineSplit(panel, "Turns", "12");
    lamp.windowRule(panel, "=");
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("panel").lines, [
        [{ text: "Turns" }, { text: " ", fill: true }, { text: "12" }],
        [{ text: "=", fill: true }],
    ]);
});

test("window_clear discards buffered lines before a sync", () => {
    installChannel();
    lamp.windowLine(panel, "stale");
    lamp.windowClear(panel);
    lamp.windowLine(panel, "fresh");
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("panel").lines, [[{ text: "fresh" }]]);
});

test("arrangement mutation shows in the next window_set; undo/restore reverts it", () => {
    installChannel();
    const before = lamp.captureState();
    lamp.setField(panel, "visible", false);
    lamp.setField(panel, "size", 32);
    lamp.windowSync();
    let set = sets().find((m) => m.id === "panel");
    assert.strictEqual(set.visible, false);
    assert.strictEqual(set.size, 32);

    lamp.restoreState(before);
    messages = [];
    lamp.windowSync();
    set = sets().find((m) => m.id === "panel");
    assert.strictEqual(set.visible, true, "visible reverted with the snapshot");
    assert.strictEqual(set.size, 20, "size reverted with the snapshot");
});

test("content buffers are transient: lines buffered before a restore still flush", () => {
    // The buffer is render state, not world state — a restore between compose and
    // sync must not lose or duplicate content (the next sync just sends what was
    // composed; the turn after recomposes from the restored world).
    installChannel();
    const before = lamp.captureState();
    lamp.windowLine(panel, "composed");
    lamp.restoreState(before);
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("panel").lines, [[{ text: "composed" }]]);
});

test("no channel: sync is a silent no-op that still drains buffers", () => {
    lamp.setWindowChannel(null);
    lamp.windowLine(panel, "unseen");
    lamp.windowSync();
    installChannel();
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("panel").lines, [], "channel-less sync drained the buffer");
});

test("invalid dock errors at sync, naming the window", () => {
    installChannel();
    lamp.setField(panel, "dock", "sideways");
    assert.throws(() => lamp.windowSync(), /window "panel" has invalid dock "sideways"/);
    lamp.setField(panel, "dock", "right");
});

test("look rides window_set: a bar-look window declares its visual identity", () => {
    installChannel();
    const bar = lamp.createObject("window", "the_bar", { look: "bar", priority: -100 });
    lamp.windowSync();
    const set = sets().find((m) => m.id === "the_bar");
    assert.strictEqual(set.look, "bar");
    assert.strictEqual(set.priority, -100, "a strongly negative priority passes through");
    // Cleanup for the earlier tests' exact-id expectations isn't needed — they ran first.
    lamp.setField(bar, "visible", false);
});

test("windowAvailable reflects host capabilities; absent capabilities mean none", () => {
    lamp.setHostCapabilities(null);
    assert.strictEqual(lamp.windowAvailable("top"), false);
    lamp.setHostCapabilities({ windows: { docks: ["top", "bottom"] } });
    assert.strictEqual(lamp.windowAvailable("top"), true);
    assert.strictEqual(lamp.windowAvailable("bottom"), true);
    assert.strictEqual(lamp.windowAvailable("left"), false);
    lamp.setHostCapabilities({});
    assert.strictEqual(lamp.windowAvailable("top"), false);
});

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log("\nAll windows tests passed.");
