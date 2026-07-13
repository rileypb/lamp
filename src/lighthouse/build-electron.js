#!/usr/bin/env node
// Thin CLI entry: build an Electron project directory from a Lamp game.
//
// Usage: node src/lighthouse/build-electron.js <input.lamp> [outDir] [--encode-strings] [--no-minify] [--debug] [--eject-shell]

const path = require("path");
const { buildElectron } = require("./electron");

const args = process.argv.slice(2);
const encodeStrings = args.includes("--encode-strings");
const minify = !args.includes("--no-minify");
const release = !args.includes("--debug");
const ejectShell = args.includes("--eject-shell");
const [inputArg, outArg] = args.filter((arg) => !arg.startsWith("--"));

if (!inputArg) {
    console.error("Usage: node src/lighthouse/build-electron.js <input.lamp> [outDir] [--encode-strings] [--no-minify] [--debug] [--eject-shell]");
    process.exit(1);
}

const outDir = outArg || path.join("dist", `${path.basename(inputArg, ".lamp")}-electron`);

try {
    const result = buildElectron(inputArg, outDir, { encodeStrings, minify, release, ejectShell });
    console.log(`Lighthouse built Electron project: ${result.outDir}`);
    console.log(`  ${result.files.join(", ")}`);
    console.log(`  run it: cd ${result.outDir} && npx electron .`);
} catch (err) {
    console.error(`Build error: ${err.message}`);
    process.exit(1);
}
