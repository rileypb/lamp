#!/usr/bin/env node
// Unit tests for the save core: the versioned header and the restore gate
// (devdocs/state.md → Save versioning). Drives captureSave/restoreSave directly,
// without the storage transport (that path is covered by the `save1` golden).
// Run with: npm run test:save

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const lamp = require("../../src/lamplighter");
const { encode: encodeText } = require("../../src/strcodec");
const { listSaveMeta } = require("../../src/lamplighter/sandbox/host");

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
lamp.defineType("thing", ["object"], {});
lamp.defineType("game", ["object"], {});
lamp.defineType("item", ["thing"], {});

lamp.createObject("game", "MyGame", { author: "Me" });
const coin = lamp.createObject("item", "coin", { held: false });

lamp.setBuildId("build-aaa");
const save = lamp.captureSave();

test("save header records build + game identity", () => {
    assert.strictEqual(save.format, 1);
    assert.strictEqual(save.buildId, "build-aaa");
    assert.strictEqual(save.gameName, "MyGame");
    assert.strictEqual(save.gameAuthor, "Me");
});

test("restore of a matching save reverts state", () => {
    lamp.setField(coin, "held", true);
    const result = lamp.restoreSave(save);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(lamp.getObject("coin").held, false);
});

test("restore refuses a save from a different build (version)", () => {
    lamp.setBuildId("build-bbb");
    const result = lamp.restoreSave(save);
    assert.deepStrictEqual(result, { ok: false, reason: "version" });
    // State must be untouched by a refused restore.
    lamp.setField(coin, "held", true);
    lamp.restoreSave(save);
    assert.strictEqual(lamp.getObject("coin").held, true);
});

test("restore refuses a save from a different game", () => {
    const otherGame = { ...save, gameName: "OtherGame", buildId: "build-bbb" };
    assert.deepStrictEqual(lamp.restoreSave(otherGame), { ok: false, reason: "game" });
});

test("restore refuses an unrecognized format", () => {
    assert.deepStrictEqual(lamp.restoreSave({ ...save, format: 99 }), { ok: false, reason: "format" });
});

test("performSave passes an unobfuscated meta sidecar (savedAt + turns)", () => {
    // Drive the `saveToSlot` primitive (what the lib `save` verb calls after collecting a
    // name): a recording save channel captures the (key, data, meta) the engine emits.
    // The blob stays obfuscated; meta does not.
    let recorded = null;
    lamp.setSaveChannel({
        write(key, data, meta) { recorded = { key, data, meta }; },
        read() { return null; },
    });

    const before = lamp.turnsTaken();
    lamp.advanceTurn();
    lamp.advanceTurn();
    assert.strictEqual(lamp.saveToSlot("slot1"), true);

    assert.ok(recorded, "save channel write was called");
    assert.strictEqual(recorded.key, "MyGame__slot1");
    assert.strictEqual(recorded.meta.turns, before + 2);
    assert.strictEqual(typeof recorded.meta.savedAt, "string");
    // meta is plaintext; the blob is obfuscated but decodes to the same savedAt.
    const blob = JSON.parse(lamp.decode(recorded.data));
    assert.strictEqual(blob.savedAt, recorded.meta.savedAt);
});

test("listSaves queries the channel with this game's prefix and passes rows through", () => {
    let listedPrefix = null;
    const hostRows = [
        { name: "beta", savedAt: "2026-01-02T00:00:00.000Z", turns: 5 },
        { name: "alpha", savedAt: "2026-01-01T00:00:00.000Z", turns: 2 },
    ];
    lamp.setSaveChannel({
        write() {},
        read() { return null; },
        list(prefix) { listedPrefix = prefix; return hostRows; },
    });
    const rows = lamp.listSaves();
    assert.strictEqual(listedPrefix, "MyGame__");
    assert.deepStrictEqual(rows, hostRows);
});

test("listSaves returns [] when the channel has no list support", () => {
    lamp.setSaveChannel({ write() {}, read() { return null; } });
    assert.deepStrictEqual(lamp.listSaves(), []);
});

test("a saved slot surfaces its faithful name + turns through listSaves", () => {
    // Round-trip through an in-memory store that mimics the host: save a slot whose
    // name has a space (sanitized to "chapter_one" in the key), then list — the row
    // must carry the original "chapter one" from the meta sidecar, not the key.
    const store = new Map();
    lamp.setSaveChannel({
        write(key, data, meta) { store.set(key, { data, meta }); },
        read(key) { return store.has(key) ? store.get(key).data : null; },
        list(prefix) {
            const rows = [];
            for (const [key, rec] of store) if (key.startsWith(prefix) && rec.meta) rows.push(rec.meta);
            return rows;
        },
    });
    const turnsBefore = lamp.turnsTaken();
    lamp.saveToSlot("chapter one");
    assert.ok(store.has("MyGame__chapter_one"), "blob stored under the sanitized key");
    const rows = lamp.listSaves();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].name, "chapter one");
    assert.strictEqual(rows[0].turns, turnsBefore);
});

test("listSaveMeta (CLI host) filters by prefix, sorts newest-first, skips non-meta/corrupt", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-savelist-"));
    const meta = (name, savedAt, turns) => JSON.stringify({ name, savedAt, turns });
    fs.writeFileSync(path.join(dir, "MyGame__a.meta"), meta("a", "2026-01-01T00:00:00.000Z", 1));
    fs.writeFileSync(path.join(dir, "MyGame__b.meta"), meta("b", "2026-02-01T00:00:00.000Z", 9));
    fs.writeFileSync(path.join(dir, "Other__c.meta"), meta("c", "2026-03-01T00:00:00.000Z", 3));
    fs.writeFileSync(path.join(dir, "MyGame__a.sav"), "opaque-blob");
    fs.writeFileSync(path.join(dir, "MyGame__bad.meta"), "{ not json");
    try {
        const rows = listSaveMeta(dir, "MyGame__");
        assert.deepStrictEqual(rows.map((r) => r.name), ["b", "a"]);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test("listSaveMeta returns [] for a missing directory", () => {
    assert.deepStrictEqual(listSaveMeta(path.join(os.tmpdir(), "lamp-nope-xyz-404"), "MyGame__"), []);
});

// The SAVE/RESTORE verbs (prompting + wording) live in lib/advent/save.lamp and are
// covered end-to-end by the `save1` golden (text-host path). These tests cover the
// runtime *primitives* the verb calls — including the host-native-picker seam the golden
// can't exercise headlessly.

test("saveHasPicker + savePickName run the host save modal; saveToSlot persists the name", () => {
    let promptedPrefix = null;
    let written = null;
    lamp.setSaveChannel({
        promptSave(prefix) { promptedPrefix = prefix; return { name: "from picker" }; },
        write(key, data, meta) { written = { key, meta }; },
        read() { return null; },
    });
    assert.strictEqual(lamp.saveHasPicker(), true);
    const name = lamp.savePickName();
    assert.strictEqual(promptedPrefix, "MyGame__", "picker gets this game's slot prefix");
    assert.strictEqual(name, "from picker");
    assert.strictEqual(lamp.saveToSlot(name), true);
    assert.strictEqual(written.key, "MyGame__from_picker");
    assert.strictEqual(written.meta.name, "from picker");
});

test("savePickName returns '' when the host modal is dismissed (verb then writes nothing)", () => {
    lamp.setSaveChannel({
        promptSave() { return null; },
        write() { throw new Error("must not write when the picker is dismissed"); },
        read() { return null; },
    });
    assert.strictEqual(lamp.saveHasPicker(), true);
    assert.strictEqual(lamp.savePickName(), "");
});

test("saveHasPicker is false for a text host (no promptSave) so the verb prompts itself", () => {
    lamp.setSaveChannel({ write() {}, read() { return null; } });
    assert.strictEqual(lamp.saveHasPicker(), false);
});

test("restoreHasPicker + restorePickBlob return the blob directly; restoreApplyBlob applies it", () => {
    lamp.setBuildId("build-picker");
    const coin = lamp.getObject("coin");
    lamp.setField(coin, "held", false);
    const blob = encodeText(JSON.stringify(lamp.captureSave()));
    lamp.setField(coin, "held", true);
    lamp.setSaveChannel({
        promptRestore() { return blob; },
        write() {},
        read() { throw new Error("read must not be used when promptRestore exists"); },
    });
    assert.strictEqual(lamp.restoreHasPicker(), true);
    const got = lamp.restorePickBlob();
    assert.strictEqual(got, blob);
    assert.strictEqual(lamp.restoreApplyBlob(got), "ok");
    assert.strictEqual(lamp.getObject("coin").held, false, "state rolled back by the applied blob");
});

test("restorePickBlob returns '' when the host modal is dismissed (state untouched)", () => {
    const coin = lamp.getObject("coin");
    lamp.setField(coin, "held", true);
    lamp.setSaveChannel({
        promptRestore() { return null; },
        write() {},
        read() { return null; },
    });
    assert.strictEqual(lamp.restorePickBlob(), "");
    assert.strictEqual(lamp.getObject("coin").held, true);
});

test("text-host restore: restoreReadSlot returns the stored blob, or '' for no such save", () => {
    const store = new Map();
    lamp.setBuildId("build-txt");
    lamp.setSaveChannel({
        write(key, data) { store.set(key, data); },
        read(key) { return store.has(key) ? store.get(key) : null; },
    });
    assert.strictEqual(lamp.saveToSlot("slotA"), true);
    assert.notStrictEqual(lamp.restoreReadSlot("slotA"), "", "stored slot reads back a blob");
    assert.strictEqual(lamp.restoreReadSlot("missing"), "", "absent slot reads back ''");
});

test("restoreApplyBlob reports 'corrupt' on garbage and the version gate on a build mismatch", () => {
    lamp.setSaveChannel({ write() {}, read() { return null; } });
    assert.strictEqual(lamp.restoreApplyBlob("not a valid blob at all"), "corrupt");
    lamp.setBuildId("build-A");
    const blob = encodeText(JSON.stringify(lamp.captureSave()));
    lamp.setBuildId("build-B");
    assert.strictEqual(lamp.restoreApplyBlob(blob), "version");
});

test("saveAvailable reflects whether a save channel is installed", () => {
    lamp.setSaveChannel({ write() {}, read() { return null; } });
    assert.strictEqual(lamp.saveAvailable(), true);
    lamp.setSaveChannel(null);
    assert.strictEqual(lamp.saveAvailable(), false);
    assert.strictEqual(lamp.saveToSlot("x"), false, "no channel → save fails");
});

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log("\nAll save tests passed.");
