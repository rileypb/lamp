#!/usr/bin/env node

const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const inputArg = process.argv[2];
if (!inputArg) {
    console.error("Usage: lantern-exe <input.lamp> [--release] [--locale <tag>] [--encode-strings]");
    process.exit(1);
}

// Compile flags after the input (e.g. --release, --locale <tag>) pass straight to Lantern.
// Default is a debug build, so the debug verbs are available while developing.
const compileFlags = process.argv.slice(3);

const inputFile = path.resolve(inputArg);
// A per-invocation temp dir, not a build/ folder inside the package: a globally
// installed lantern-exe would otherwise write into npm's global node_modules,
// which may not be writable.
const buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "lantern-exe-"));
process.on("exit", () => fs.rmSync(buildDir, { recursive: true, force: true }));
const tmpFile = path.join(buildDir, `${path.basename(inputFile, ".lamp")}.generated.js`);
const lanternCli = path.join(__dirname, "index.js");
const playCli = path.join(__dirname, "..", "lamplighter", "play.js");

// Both child steps inherit stdio and report their own errors; a non-zero exit
// surfaces there, so swallow execFileSync's own "Command failed" wrapper (with its
// JS stack) and just propagate the status.
try {
    execFileSync("node", [lanternCli, inputFile, tmpFile, ...compileFlags], { stdio: "inherit" });
} catch (_) {
    process.exit(1);
}
try {
    execFileSync("node", [playCli, tmpFile], { stdio: "inherit" });
} catch (_) {
    process.exit(1);
}
