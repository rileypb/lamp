#!/usr/bin/env node
// Thin CLI entry: build a web bundle from a Lamp game.
//
// Usage: node src/lighthouse/build.js <input.lamp> [outDir] [--encode-strings]

const path = require("path");
const { buildWeb } = require("./index");

const args = process.argv.slice(2);
const encodeStrings = args.includes("--encode-strings");
const [inputArg, outArg] = args.filter((arg) => !arg.startsWith("--"));

if (!inputArg) {
    console.error("Usage: node src/lighthouse/build.js <input.lamp> [outDir] [--encode-strings]");
    process.exit(1);
}

const outDir = outArg || path.join("dist", path.basename(inputArg, ".lamp"));

try {
    const result = buildWeb(inputArg, outDir, { encodeStrings });
    console.log(`Lighthouse built web bundle: ${result.outDir}`);
    console.log(`  ${result.files.join(", ")}`);
} catch (err) {
    console.error(`Build error: ${err.message}`);
    process.exit(1);
}
