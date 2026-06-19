#!/usr/bin/env node
// Unit tests for the token-level declaration prescan (src/lantern/prescan.js).
//
// The prescan collects the name sets the parser needs up front (object names,
// action/relation/function/global names, rulebook params, tag names, relation
// syntax templates) from the token stream. Run with: npm run test:prescan

const assert = require("assert");
const { tokenize } = require("../../src/lantern/tokenizer");
const { prescanDeclarations } = require("../../src/lantern/prescan");

function scan(src) {
    return prescanDeclarations(tokenize(src, "t.lamp"));
}

const cases = [
    {
        name: "global name is the identifier before '='",
        run() {
            const d = scan(["global int x = 5", "global list<string> words = none"].join("\n"));
            assert.deepStrictEqual([...d.globalNames].sort(), ["words", "x"]);
        },
    },
    {
        name: "function names: native and plain, including list<T> return type",
        run() {
            const d = scan([
                "native function string with_article(physical x)",
                "function void move(item a, room b)",
                "function list<string> names()",
            ].join("\n"));
            assert.deepStrictEqual([...d.functionNames].sort(), ["move", "names", "with_article"]);
        },
    },
    {
        name: "relation name and its #-bearing syntax template survive",
        run() {
            const d = scan([
                "relation marks:",
                "    from item a",
                "    to item b",
                '    syntax "marks [a] # [b]"',
            ].join("\n"));
            assert.deepStrictEqual([...d.relationNames], ["marks"]);
            assert.deepStrictEqual(d.relationTemplates, [{ relationName: "marks", template: "marks [a] # [b]" }]);
        },
    },
    {
        name: "action names",
        run() {
            const d = scan(["action take:", "    direct item taken"].join("\n"));
            assert.deepStrictEqual([...d.actionNames], ["take"]);
        },
    },
    {
        name: "rulebook params: typed list, and empty",
        run() {
            const d = scan([
                "rulebook bool combat(person a, list<item> weapons):",
                "    default true",
                "rulebook bool startup():",
                "    default true",
            ].join("\n"));
            assert.deepStrictEqual(d.rulebookParams.get("combat"), ["a", "weapons"]);
            assert.deepStrictEqual(d.rulebookParams.get("startup"), []);
        },
    },
    {
        name: "object names: coerced, multi-word, no-colon; excludes bands/keywords/asserts",
        run() {
            const d = scan([
                "room West_of_House:",
                "person yourself",
                "check take:",            // band word — not an object
                "type game:",             // keyword-led — not an object
                "wears yourself cloak",   // relation assert (3 idents) — not an object
                "global int hp = 5",      // keyword-led — not an object
            ].join("\n"));
            assert.deepStrictEqual([...d.objectNames].sort(), ["West of House", "yourself"]);
        },
    },
    {
        name: "tags are collected only from indented `tags` lines",
        run() {
            const d = scan([
                "action push:",
                "    tags manipulation, physical",
            ].join("\n"));
            assert.deepStrictEqual([...d.tagNames].sort(), ["manipulation", "physical"]);
        },
    },
    {
        name: "a # inside a string default does not truncate detection",
        run() {
            const d = scan('global string label = "color #5"');
            assert.deepStrictEqual([...d.globalNames], ["label"]);
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
    console.error(`\n${failures} prescan test(s) failed.`);
    process.exit(1);
}
console.log("\nAll prescan tests passed.");
