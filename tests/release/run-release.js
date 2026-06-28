#!/usr/bin/env node
// Tests for Lantern's --release build flag. A file marked `not_for_release` (advent's
// debug.lamp) is compiled into a normal/debug build but excluded from a --release build, so
// a shipped game can't be cheated past puzzles with the debug verbs. Run: npm run test:release

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const LANTERN_CLI = path.join(PROJECT_ROOT, "src", "lantern", "index.js");
const PLAY_CLI = path.join(PROJECT_ROOT, "src", "lamplighter", "play.js");
const FIXTURE = path.join(PROJECT_ROOT, "tests", "fixtures", "purloin1.lamp");

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (err) {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(`  ${err.message}`);
    }
}

function compile(out, release) {
    const args = [LANTERN_CLI, FIXTURE, out];
    if (release) args.push("--release");
    return execFileSync("node", args, { encoding: "utf8" });
}

function run(generated, stdin) {
    return execFileSync("node", [PLAY_CLI, generated], { input: stdin, encoding: "utf8" });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-release-"));
const dbgOut = path.join(tmp, "debug.js");
const relOut = path.join(tmp, "release.js");

test("debug build (default) includes the not_for_release debug verbs", () => {
    const log = compile(dbgOut, false);
    assert.match(log, /compiled \d+ file\(s\)/, "should compile");
    assert.doesNotMatch(log, /\(release\)/, "default build is not a release build");
    const out = run(dbgOut, "purloin gem\nquit\n");
    assert.match(out, /purloined/, "PURLOIN should work in a debug build");
});

test("release build (--release) excludes the not_for_release debug verbs", () => {
    const log = compile(relOut, true);
    assert.match(log, /\(release\)/, "should report a release build");
    const out = run(relOut, "purloin gem\nquit\n");
    assert.doesNotMatch(out, /purloined/, "PURLOIN should be gone from a release build");
    assert.match(out, /don't understand/, "the debug verb should be unrecognized");
});

test("release build drops exactly the not_for_release file(s)", () => {
    const dbgCount = Number(/compiled (\d+) file/.exec(compile(dbgOut, false))[1]);
    const relCount = Number(/compiled (\d+) file/.exec(compile(relOut, true))[1]);
    assert.strictEqual(relCount, dbgCount - 1, "exactly one not_for_release file (debug.lamp) excluded");
});

if (failures === 0) {
    console.log("\nAll release tests passed.");
} else {
    console.error(`\n${failures} release test(s) failed.`);
    process.exit(1);
}
