#!/usr/bin/env node
// Tests for Lantern's --encode-strings build option and the shared string codec.
//
// Encoding only hides player-facing prose from casual readers; it must not change
// behavior. Each case compiles a game plaintext and encoded, runs both through
// the sandbox, and asserts identical output — and that the encoded build hides
// prose while leaving structural names plaintext. Run with: npm run test:encode

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { encode, decode } = require("../../src/strcodec");

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const LANTERN_CLI = path.join(PROJECT_ROOT, "src", "lantern", "index.js");
const PLAY_CLI = path.join(PROJECT_ROOT, "src", "lamplighter", "play.js");
const GOLDEN_EXPECTED = path.join(PROJECT_ROOT, "tests", "golden", "expected");

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

function compile(inputPath, outPath, { encodeStrings }) {
    const args = [LANTERN_CLI, inputPath, outPath];
    if (encodeStrings) args.push("--encode-strings");
    execFileSync("node", args, { stdio: "pipe" });
}

function run(generatedPath, stdin) {
    return execFileSync("node", [PLAY_CLI, generatedPath], {
        input: stdin || "",
        encoding: "utf8",
    });
}

test("codec round-trips arbitrary text", () => {
    for (const s of ["", "north", "You are in a maze.", "café ☕ — \"quotes\" and \\slashes\\", "line\nbreak"]) {
        assert.strictEqual(decode(encode(s)), s, `round-trip failed for ${JSON.stringify(s)}`);
    }
});

test("encoded output is not the plaintext", () => {
    const text = "splendidly decorated in red and gold";
    assert.ok(!encode(text).includes("splendidly"), "encoded payload leaked plaintext");
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lamp-encode-"));

// Equivalence cases: (game path relative to root, a distinctive prose substring
// that must be present plaintext but absent in the encoded build).
// `leaks`: strings present plaintext in the unencoded build that must NOT appear
// in the encoded build — a mix of prose, object names, and global names.
const cases = [
    { game: "sample/cloak.lamp", leaks: ["spacious hall", "cant go that way", "USE OXFORD COMMA"] },
    { game: "sample/study.lamp", leaks: [] },
];

for (const { game, leaks } of cases) {
    const name = path.basename(game, ".lamp");
    const inputPath = path.join(PROJECT_ROOT, game);
    const stdinPath = path.join(GOLDEN_EXPECTED, `${name}.stdin.txt`);
    const stdin = fs.existsSync(stdinPath) ? fs.readFileSync(stdinPath, "utf8") : "";

    const plainPath = path.join(tmp, `${name}.plain.js`);
    const encPath = path.join(tmp, `${name}.enc.js`);

    test(`${name}: encoded build runs identically to plaintext`, () => {
        compile(inputPath, plainPath, { encodeStrings: false });
        compile(inputPath, encPath, { encodeStrings: true });
        assert.strictEqual(run(encPath, stdin), run(plainPath, stdin), "encoded run output differs");
    });

    test(`${name}: encoded build hides prose + object/global names, keeps type names plaintext`, () => {
        const enc = fs.readFileSync(encPath, "utf8");
        const plain = fs.readFileSync(plainPath, "utf8");
        assert.ok(enc.includes("lamplighter.decode("), "no decode() wrapping found");
        // Type names (createObject's first argument) stay plaintext by design.
        assert.ok(/createObject\("[a-z_]+"/.test(enc), "type names should stay plaintext");
        // Object names are no longer emitted as plaintext getObject keys.
        assert.ok(!/getObject\("[ -~]+"\)/.test(enc), "object names should be encoded, not plaintext");
        for (const leak of leaks) {
            assert.ok(plain.includes(leak), `fixture should contain ${JSON.stringify(leak)} plaintext`);
            assert.ok(!enc.includes(leak), `encoded build leaked ${JSON.stringify(leak)}`);
        }
    });
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log("\nall encode tests passed");
