#!/usr/bin/env node
// The compiler warns (to stderr, non-fatally) when a text template assigned to a persistent
// slot will be frozen on save (it captures a local/shadowed name), and stays silent when the
// template is persistable. See devdocs/text-persistence.md.
// Run with: node tests/textwarn/run-textwarn.js

const assert = require("assert");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "../..");
const lantern = path.join(projectRoot, "src", "lantern", "index.js");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-textwarn-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (err) {
        failures += 1;
        console.error(`not ok - ${name}\n  ${err.stack || err.message}`);
    }
}

// Compile a fixture (which succeeds) and return its stderr — where non-fatal warnings ride.
function compileStderr(fixture) {
    const res = spawnSync("node", [lantern, path.join(__dirname, fixture), path.join(tmp, `${fixture}.js`)],
        { cwd: projectRoot, encoding: "utf8" });
    if (res.status !== 0) throw new Error(`compile failed for ${fixture}: ${res.stderr}`);
    return res.stderr || "";
}

test("a field template capturing a local warns that it will be frozen", () => {
    const stderr = compileStderr("warn_frozen.lamp");
    assert.match(stderr, /will be frozen when saved/, "expected a freeze warning");
    assert.match(stderr, /'widget'/, "warning should name the captured binding");
});

test("a field template reading a named instance does not warn", () => {
    const stderr = compileStderr("warn_clean.lamp");
    assert.doesNotMatch(stderr, /will be frozen when saved/, "persistable template must not warn");
});

if (failures === 0) {
    console.log("\nAll textwarn tests passed.");
} else {
    console.error(`\n${failures} textwarn test(s) failed.`);
    process.exit(1);
}
