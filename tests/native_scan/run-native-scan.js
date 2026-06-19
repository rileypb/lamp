#!/usr/bin/env node
// Unit tests for the native-JS top-level function scanner
// (src/lantern/native_scan.js). Run with: npm run test:native-scan

const assert = require("assert");
const { extractTopLevelFunctionNames } = require("../../src/lantern/native_scan");

function scan(src) {
    return [...extractTopLevelFunctionNames(src)].sort();
}

const cases = [
    {
        name: "collects top-level declarations",
        run() {
            assert.deepStrictEqual(
                scan("function a() { return 1; }\nfunction b(x) { return x; }"),
                ["a", "b"],
            );
        },
    },
    {
        name: "ignores 'function' inside a line comment",
        run() {
            assert.deepStrictEqual(scan("// function ghost() {}\nfunction real() {}"), ["real"]);
        },
    },
    {
        name: "ignores 'function' inside a block comment",
        run() {
            assert.deepStrictEqual(scan("/* function ghost() {} */ function real() {}"), ["real"]);
        },
    },
    {
        name: "ignores 'function' inside a string and a template literal",
        run() {
            assert.deepStrictEqual(
                scan('function real() { const s = "function ghost(" + `function ghost2(`; }'),
                ["real"],
            );
        },
    },
    {
        name: "ignores nested function declarations",
        run() {
            assert.deepStrictEqual(
                scan("function outer() {\n  function inner() {}\n  return inner;\n}"),
                ["outer"],
            );
        },
    },
    {
        name: "a regex literal containing braces does not corrupt depth tracking",
        run() {
            assert.deepStrictEqual(
                scan("function a() { return /\\{x\\}/.test('y'); }\nfunction b() {}"),
                ["a", "b"],
            );
        },
    },
    {
        name: "handles async and generator declarations at top level",
        run() {
            assert.deepStrictEqual(
                scan("async function a() {}\nfunction* b() {}"),
                ["a", "b"],
            );
        },
    },
    {
        name: "division is not mistaken for a regex",
        run() {
            assert.deepStrictEqual(
                scan("function a() { const x = 10 / 2 / 1; }\nfunction b() {}"),
                ["a", "b"],
            );
        },
    },
];

let failures = 0;
for (const c of cases) {
    try {
        c.run();
        console.log(`  ok  ${c.name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL  ${c.name}`);
        console.error(`      ${error.message}`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} native-scan test(s) failed.`);
    process.exit(1);
}
console.log("\nAll native-scan tests passed.");
