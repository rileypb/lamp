#!/usr/bin/env node
// Unit tests for the save core: the versioned header and the restore gate
// (devdocs/state.md → Save versioning). Drives captureSave/restoreSave directly,
// without the storage transport (that path is covered by the `save1` golden).
// Run with: npm run test:save

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

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log("\nAll save tests passed.");
