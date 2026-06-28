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

// Runs a generated game and returns its full output, never throwing — a runtime
// error yields the same output for both builds, so equivalence still holds.
function run(generatedPath, stdin) {
    try {
        return execFileSync("node", [PLAY_CLI, generatedPath], { input: stdin || "", encoding: "utf8" });
    } catch (err) {
        return `${err.stdout || ""}${err.stderr || ""}`;
    }
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
    // `disturbance` is a game global referenced only from .lamp (encoded). The
    // `oxford_comma` setting is intentionally NOT listed: the base list formatter
    // reads it by name in native index.js, which is inlined verbatim and not
    // encoded, so the name leaks — the documented native-literal limitation.
    { game: "sample/cloak.lamp", leaks: ["spacious hall", "cant go that way", "disturbance", "on [destination]"] },
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

    test(`${name}: encoded build hides prose + object/global/action/type/relation names`, () => {
        const enc = fs.readFileSync(encPath, "utf8");
        const plain = fs.readFileSync(plainPath, "utf8");
        assert.ok(enc.includes("lamplighter.decode("), "no decode() wrapping found");
        // No emitter-emitted registration/lookup call carries a plaintext first
        // arg. Excludes the calls that inlined native JS legitimately makes with
        // plaintext names — the documented native-`index.js` limitation (the emitter
        // does not rewrite native JS; see devdocs/lighthouse.md): `getGlobal`/`type`
        // (formatter + viewpoint + contents_of), and `addRelation`/`queryRelationValue`
        // (advent's `wire_doors`/door scope-provider use `connects`/`doorway`). The
        // emitter-side encoding of relation names is still asserted via `defineRelation`.
        assert.ok(
            !/(defineType|defineRelation|createObject|getObject|defineGlobal|setGlobal|registerGrammar|registerActionRule|runAction|removeRelation|queryRelation|registerChangeHandler|registerRelationAddHandler|registerRelationRemoveHandler)\("[ -~]+"/.test(enc),
            "type/relation/object/global/action names should be encoded, not plaintext",
        );
        // Field-name keys stay plaintext (schema/object literal keys).
        assert.ok(/"[a-z_]+":/.test(enc), "field-name keys should stay plaintext");
        for (const leak of leaks) {
            assert.ok(plain.includes(leak), `fixture should contain ${JSON.stringify(leak)} plaintext`);
            assert.ok(!enc.includes(leak), `encoded build leaked ${JSON.stringify(leak)}`);
        }
    });
}

// Broad behavior-preservation guard. Encoding type and relation names touches
// the type/dispatch/relation machinery, so a wide corpus of fixtures (relations,
// inheritance, queries, change handlers, actions) must compile both ways and run
// identically. Missing fixtures are skipped; this is purely an equivalence check.
const corpus = [
    "relation1", "relation5", "relation9", "relation10", "relation15", "relation20",
    "relation_template1", "action1", "action_outcome", "example3",
    "function7", "advent1", "advent5", "advent9",
];
for (const base of corpus) {
    const lampPath = [
        path.join(PROJECT_ROOT, "tests", "fixtures", `${base}.lamp`),
        path.join(PROJECT_ROOT, "sample", `${base}.lamp`),
    ].find((p) => fs.existsSync(p));
    if (!lampPath) continue;
    const stdinPath = path.join(GOLDEN_EXPECTED, `${base}.stdin.txt`);
    const stdin = fs.existsSync(stdinPath) ? fs.readFileSync(stdinPath, "utf8") : "";

    test(`${base}: encoded build runs identically to plaintext`, () => {
        const plainPath = path.join(tmp, `${base}.plain.js`);
        const encPath = path.join(tmp, `${base}.enc.js`);
        compile(lampPath, plainPath, { encodeStrings: false });
        compile(lampPath, encPath, { encodeStrings: true });
        assert.strictEqual(run(encPath, stdin), run(plainPath, stdin), "encoded run output differs");
    });
}

fs.rmSync(tmp, { recursive: true, force: true });

if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
}
console.log("\nall encode tests passed");
