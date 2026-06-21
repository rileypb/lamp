#!/usr/bin/env node
// Round-trip unit tests for the state snapshot core (devdocs/state.md).
//
// Drives the runtime API directly (no parser): build a small world, capture a
// snapshot, mutate every kind of mutable state, restore, and assert the state
// reverted exactly — covering scalars, object references (identity preserved),
// lists, globals, relation edges, and the pronoun-style provider extension.
// Run with: npm run test:state

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

// --- minimal world ---------------------------------------------------------
lamp.bootstrapBuiltins();
lamp.defineType("thing", ["object"], {});
lamp.defineType("room", ["thing"], {});
lamp.defineType("item", ["thing"], {});

const hall = lamp.createObject("room", "hall", {});
const shelf = lamp.createObject("item", "shelf", { holder: hall });
const coin = lamp.createObject("item", "coin", { holder: hall, shiny: true });
const gem = lamp.createObject("item", "gem", { holder: hall });

lamp.defineGlobal("score", 0);
lamp.defineGlobal("loot", lamp.makeList([]));

lamp.defineRelation("supports", { source: null, target: null }, null, [], "source", "target");

// --- capture, mutate, restore ----------------------------------------------
const snap = lamp.captureState();

lamp.setField(coin, "holder", shelf);          // object-ref field change
lamp.setField(coin, "shiny", false);           // scalar field change
lamp.setGlobal("score", 42);                   // scalar global
lamp.setGlobal("loot", lamp.makeList([coin, gem])); // list-of-refs global
lamp.addRelation("supports", { source: shelf, target: coin }); // new edge

lamp.restoreState(snap);

test("scalar field reverts", () => {
    assert.strictEqual(lamp.getObject("coin").shiny, true);
});

test("object-reference field reverts", () => {
    assert.strictEqual(lamp.getObject("coin").holder, lamp.getObject("hall"));
});

test("object identity is preserved across restore", () => {
    // The same instance objects persist; refs resolve to them, not to clones.
    assert.strictEqual(lamp.getObject("coin"), coin);
    assert.strictEqual(lamp.getObject("coin").holder, hall);
});

test("scalar global reverts", () => {
    assert.strictEqual(lamp.getGlobal("score"), 0);
});

test("list global reverts (and round-trips empty)", () => {
    const loot = lamp.getGlobal("loot");
    assert.deepStrictEqual(lamp.listItems(loot), []);
});

test("relation edge added since snapshot is gone after restore", () => {
    const matches = lamp.queryRelation("supports", { source: lamp.ANY, target: lamp.ANY });
    assert.strictEqual(matches.length, 0);
});

test("a custom state provider is captured and restored", () => {
    let external = "before";
    lamp.registerStateProvider({
        key: "demo_external",
        capture: () => external,
        restore: (data) => { external = data; },
    });
    const s = lamp.captureState();
    external = "after";
    lamp.restoreState(s);
    assert.strictEqual(external, "before");
});

test("per-site variation state is captured and reverts on restore", () => {
    // A [first time] site advances once (count 0 -> 1). Snapshot, advance twice
    // more, then restore: the count must roll back to the snapshotted value so an
    // already-consumed [first time] stays consumed and a since-advanced site is
    // rolled back — without this, undo/restore would re-show or re-suppress text.
    assert.strictEqual(lamp.variationAdvance("vsite"), 0);
    const s = lamp.captureState();
    lamp.variationAdvance("vsite");
    lamp.variationAdvance("vsite");
    lamp.restoreState(s);
    assert.strictEqual(lamp.variationAdvance("vsite"), 1);
});

test("seeded RNG state reverts on restore (reproducible draws)", () => {
    // Snapshot, draw a random pick, restore, draw again: the same value comes back
    // because the RNG state provider rolls the stream position back.
    const snap = lamp.captureState();
    const first = lamp.variationPick("rsite", 6, "purely");
    lamp.restoreState(snap);
    const again = lamp.variationPick("rsite", 6, "purely");
    assert.strictEqual(again, first);
});

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log("\nAll state tests passed.");
