#!/usr/bin/env node
// Thin CLI entry: run a compiled game through the dev sandbox.

const { playFile } = require("./sandbox/host");

const generatedPath = process.argv[2];
if (!generatedPath) {
    console.error("Usage: node src/lamplighter/play.js <generated.js>");
    process.exit(1);
}

playFile(generatedPath)
    .then(() => {
        // Let the process exit naturally so buffered stdout flushes; an abrupt
        // process.exit can truncate piped output.
    })
    .catch((err) => {
        console.error(`Error: ${err.message}`);
        process.exitCode = 1;
    });
