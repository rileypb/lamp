#!/usr/bin/env node

const { execFileSync } = require("child_process");
const path = require("path");

const inputArg = process.argv[2];
if (!inputArg) {
    console.error("Usage: lantern-exe <input.lamp>");
    process.exit(1);
}

const inputFile = path.resolve(inputArg);
const buildDir = path.join(__dirname, "..", "..", "build");
const tmpFile = path.join(buildDir, `${path.basename(inputFile, ".lamp")}.generated.js`);
const lanternCli = path.join(__dirname, "index.js");
const playCli = path.join(__dirname, "..", "lamplighter", "play.js");

execFileSync("node", [lanternCli, inputFile, tmpFile], { stdio: "inherit" });
execFileSync("node", [playCli, tmpFile], { stdio: "inherit" });
