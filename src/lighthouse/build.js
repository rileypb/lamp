#!/usr/bin/env node
// Thin CLI entry: build a web bundle from a Lamp game.
//
// Usage: node src/lighthouse/build.js <input.lamp> [outDir]

const path = require("path");
const { buildWeb } = require("./index");

const inputArg = process.argv[2];
const outArg = process.argv[3];

if (!inputArg) {
    console.error("Usage: node src/lighthouse/build.js <input.lamp> [outDir]");
    process.exit(1);
}

const outDir = outArg || path.join("dist", path.basename(inputArg, ".lamp"));

try {
    const result = buildWeb(inputArg, outDir);
    console.log(`Lighthouse built web bundle: ${result.outDir}`);
    console.log(`  ${result.files.join(", ")}`);
} catch (err) {
    console.error(`Build error: ${err.message}`);
    process.exit(1);
}
