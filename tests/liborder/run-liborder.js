#!/usr/bin/env node
// Unit tests for library load ordering (src/lantern/liborder.js).
//
// Exercises the pure `orderLampFiles(sortedFiles, manifestText)` function:
// alphabetical default, manifest-pinned order, alphabetical fallback for
// unlisted files, comment/blank handling, dedup, and drift detection.
// Run with: npm run test:liborder

const assert = require("assert");
const { orderLampFiles } = require("../../src/lantern/liborder");

const files = ["actions.lamp", "globals.lamp", "rooms.lamp", "startup.lamp", "types.lamp"];

const cases = [
    {
        name: "no manifest → alphabetical (input order preserved)",
        run() {
            assert.deepStrictEqual(orderLampFiles(files, null), files);
        },
    },
    {
        name: "manifest pins listed files first, rest follow alphabetically",
        run() {
            const order = orderLampFiles(files, ["types.lamp", "globals.lamp"].join("\n"));
            assert.deepStrictEqual(order, ["types.lamp", "globals.lamp", "actions.lamp", "rooms.lamp", "startup.lamp"]);
        },
    },
    {
        name: "comments and blank lines are ignored",
        run() {
            const manifest = ["# load types first", "types.lamp", "", "  # then globals", "globals.lamp"].join("\n");
            const order = orderLampFiles(files, manifest);
            assert.deepStrictEqual(order.slice(0, 2), ["types.lamp", "globals.lamp"]);
        },
    },
    {
        name: "a repeated manifest entry is collapsed",
        run() {
            const order = orderLampFiles(files, ["rooms.lamp", "rooms.lamp"].join("\n"));
            assert.deepStrictEqual(order, ["rooms.lamp", "actions.lamp", "globals.lamp", "startup.lamp", "types.lamp"]);
        },
    },
    {
        name: "manifest naming a missing file throws",
        run() {
            assert.throws(() => orderLampFiles(files, "nope.lamp"), /not a \.lamp file/);
        },
    },
];

let failures = 0;
for (const c of cases) {
    try {
        c.run();
        console.log(`  ok  ${c.name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL  ${c.name}`);
        console.error(`      ${error.message}`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} liborder test(s) failed.`);
    process.exit(1);
}
console.log("\nAll liborder tests passed.");
