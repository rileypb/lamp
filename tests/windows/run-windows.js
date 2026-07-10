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
    { dock: "string", size: "int", priority: "int", visible: "bool", title: "string", look: "string",
      content_kind: "string", canvas_w: "int", canvas_h: "int" },
    { dock: "top", size: 1, priority: 0, visible: true, title: "", look: "pane",
      content_kind: "text", canvas_w: 0, canvas_h: 0 });
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
        type: "window_set", id: "panel", dock: "right", size: 20, priority: 0, visible: true, title: "Mission", look: "pane", kind: "text",
    });
    assert.deepStrictEqual(sets().find((m) => m.id === "ticker"), {
        type: "window_set", id: "ticker", dock: "bottom", size: 1, priority: 2, visible: true, title: "", look: "pane", kind: "text",
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

// Freestyle canvas panes (devdocs/freestyle-windows.md): the second content kind.
let deckMap;

test("canvas pane: window_set carries kind + virtual space; ops stream in window_update", () => {
    installChannel();
    deckMap = lamp.createObject("window", "deck_map", { dock: "right", size: 200, content_kind: "canvas", canvas_w: 160, canvas_h: 240 });
    lamp.defineImage("cover art", "art/cover.png");
    lamp.canvasRect(deckMap, "black", 0, 0, 160, 240);
    lamp.canvasLine(deckMap, "#00FF88", 10, 20, 150, 20);
    lamp.canvasText(deckMap, "white", 8, 30, 12, lamp.styled("bold", "DECK") + " 5");
    lamp.canvasImage(deckMap, "cover art", 40, 60, 80, 120);
    lamp.windowSync();
    const set = sets().find((m) => m.id === "deck_map");
    assert.strictEqual(set.kind, "canvas");
    assert.deepStrictEqual(set.canvas, { w: 160, h: 240 });
    const upd = updateFor("deck_map");
    assert.strictEqual(upd.kind, "canvas");
    assert.strictEqual(upd.lines, undefined, "a canvas update carries ops, not lines");
    assert.deepStrictEqual(upd.ops, [
        { op: "rect", color: "black", x: 0, y: 0, w: 160, h: 240 },
        { op: "line", color: "#00FF88", x1: 10, y1: 20, x2: 150, y2: 20 },
        { op: "text", color: "white", x: 8, y: 30, size: 12, text: "DECK 5" },
        { op: "image", image: "cover art", x: 40, y: 60, w: 80, h: 120 },
    ]);
    const textUpd = updateFor("panel");
    assert.strictEqual(textUpd.kind, "text", "text updates declare their kind");
    assert.ok(Array.isArray(textUpd.lines));
});

test("canvas draw list drains per sync; window_clear discards it", () => {
    installChannel();
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("deck_map").ops, [], "drained by the previous sync");
    lamp.canvasRect(deckMap, "red", 0, 0, 1, 1);
    lamp.windowClear(deckMap);
    lamp.canvasRect(deckMap, "blue", 2, 2, 3, 3);
    messages = [];
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("deck_map").ops, [{ op: "rect", color: "blue", x: 2, y: 2, w: 3, h: 3 }]);
});

test("content kinds never mix: mismatched primitives error, naming the window", () => {
    assert.throws(() => lamp.windowLine(deckMap, "prose"),
        /window_line called on window "deck_map" of kind "canvas"/);
    assert.throws(() => lamp.canvasRect(panel, "red", 0, 0, 1, 1),
        /canvas_rect called on window "panel" of kind "text"/);
});

test("an unknown color errors at the call site", () => {
    assert.throws(() => lamp.canvasRect(deckMap, "chartreuse", 0, 0, 1, 1),
        /canvas_rect: unknown color "chartreuse"/);
    assert.throws(() => lamp.canvasLine(deckMap, "#12345", 0, 0, 1, 1),
        /canvas_line: unknown color "#12345"/);
});

test("an undeclared image errors at the call site; getImagePath reads the registry", () => {
    assert.throws(() => lamp.canvasImage(deckMap, "no such art", 0, 0, 1, 1),
        /canvas_image: unknown image "no such art"/);
    assert.strictEqual(lamp.getImagePath("cover art"), "art/cover.png");
    assert.strictEqual(lamp.getImagePath("no such art"), undefined);
});

test("invalid kind and missing canvas space error at sync, naming the window", () => {
    installChannel();
    lamp.setField(deckMap, "content_kind", "iframe");
    assert.throws(() => lamp.windowSync(), /window "deck_map" has invalid content_kind "iframe"/);
    lamp.setField(deckMap, "content_kind", "canvas");
    lamp.setField(deckMap, "canvas_w", 0);
    assert.throws(() => lamp.windowSync(), /canvas window "deck_map" needs positive canvas_w and canvas_h/);
    lamp.setField(deckMap, "canvas_w", 160);
});

test("kind and canvas space are ordinary fields: undo/restore reverts them", () => {
    installChannel();
    const before = lamp.captureState();
    lamp.setField(deckMap, "canvas_w", 320);
    lamp.windowSync();
    assert.deepStrictEqual(sets().find((m) => m.id === "deck_map").canvas, { w: 320, h: 240 });
    lamp.restoreState(before);
    messages = [];
    lamp.windowSync();
    assert.deepStrictEqual(sets().find((m) => m.id === "deck_map").canvas, { w: 160, h: 240 }, "canvas space reverted with the snapshot");
});

test("windowKindAvailable: absent kinds on a window-capable host mean text-only", () => {
    lamp.setHostCapabilities(null);
    assert.strictEqual(lamp.windowKindAvailable("text"), false, "no capabilities: no kinds at all");
    lamp.setHostCapabilities({ windows: { docks: ["top", "bottom"] } });
    assert.strictEqual(lamp.windowKindAvailable("text"), true, "a pre-kinds host is a text host");
    assert.strictEqual(lamp.windowKindAvailable("canvas"), false);
    lamp.setHostCapabilities({ windows: { docks: ["top"], kinds: ["text", "canvas"] } });
    assert.strictEqual(lamp.windowKindAvailable("canvas"), true);
    lamp.setHostCapabilities({});
    assert.strictEqual(lamp.windowKindAvailable("text"), false);
});

test("windowSyncOne flushes only the named window, leaving others buffered", () => {
    installChannel();
    lamp.setField(panel, "dock", "right");
    lamp.windowLine(panel, "Quests");
    lamp.windowLine(ticker, "tick");
    lamp.windowSyncOne(panel);
    // Only the panel is emitted; the ticker's set/update never arrive.
    assert.deepStrictEqual(sets().map((m) => m.id), ["panel"]);
    assert.ok(updateFor("panel"), "panel content flushed");
    assert.ok(!updateFor("ticker"), "ticker not touched by a single-window sync");
    // The ticker's buffered line survives to the next full sync, undrained.
    installChannel();
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("ticker").lines, [[{ text: "tick" }]]);
    assert.deepStrictEqual(updateFor("panel").lines, [], "panel already drained by windowSyncOne");
});

test("hotspots ride the canvas update: composed per turn, drained per sync, plain-text commands", () => {
    installChannel();
    lamp.canvasHotspot(deckMap, 5, 5, 30, 20, lamp.styled("bold", "north"));
    lamp.canvasHotspot(deckMap, 38, 5, 30, 20, "open hatch");
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("deck_map").hotspots, [
        { x: 5, y: 5, w: 30, h: 20, command: "north" },
        { x: 38, y: 5, w: 30, h: 20, command: "open hatch" },
    ], "hotspots carry plain-text commands (style wrappers stripped)");
    messages = [];
    lamp.windowSync();
    assert.deepStrictEqual(updateFor("deck_map").hotspots, [], "drained by the previous sync");
    assert.strictEqual(updateFor("panel").hotspots, undefined, "text updates carry no hotspots field");
    assert.throws(() => lamp.canvasHotspot(panel, 0, 0, 1, 1, "look"),
        /canvas_hotspot called on window "panel" of kind "text"/);
});

test("windowSyncOne is kind-aware: a canvas pane flushes ops through the shared emit", () => {
    // The freestyle/window_sync_one merge point (devdocs/freestyle-windows.md):
    // both sync paths share emitWindow, so a single-window flush of a canvas pane
    // carries kind + canvas space + ops, exactly like the full sync.
    installChannel();
    lamp.canvasRect(deckMap, "red", 1, 1, 2, 2);
    lamp.windowSyncOne(deckMap);
    const set = sets().find((m) => m.id === "deck_map");
    assert.strictEqual(set.kind, "canvas");
    assert.deepStrictEqual(set.canvas, { w: 160, h: 240 });
    assert.deepStrictEqual(updateFor("deck_map").ops, [{ op: "rect", color: "red", x: 1, y: 1, w: 2, h: 2 }]);
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
