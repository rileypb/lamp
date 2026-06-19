#!/usr/bin/env node
// Unit tests for the full-file tokenizer (src/lantern/tokenizer.js).
//
// Tokenizes representative source snippets and compares the rendered token
// stream against an expected string. Run with: npm run test:tokenizer

const assert = require("assert");
const { tokenize, coerceName } = require("../../src/lantern/tokenizer");

function render(tokens) {
    return tokens
        .map((t) => (t.value !== undefined ? `${t.type}(${t.value})` : t.type))
        .join(" ");
}

const tokenCases = [
    {
        name: "object declaration with body",
        src: ["game Minimal:", "    version 1"].join("\n"),
        expect: "IDENT(game) IDENT(Minimal) COLON NEWLINE INDENT IDENT(version) NUMBER(1) NEWLINE DEDENT EOF",
    },
    {
        name: "type declaration is a keyword",
        src: "type game:",
        expect: "KEYWORD(type) IDENT(game) COLON NEWLINE EOF",
    },
    {
        name: "multi-word names stay single raw idents",
        src: ["room West_of_House:", "    name One-Room_Game"].join("\n"),
        expect:
            "IDENT(room) IDENT(West_of_House) COLON NEWLINE INDENT IDENT(name) IDENT(One-Room_Game) NEWLINE DEDENT EOF",
    },
    {
        name: "inheritance with comma-separated parents",
        src: "type box < item, container:",
        expect: "KEYWORD(type) IDENT(box) LT IDENT(item) COMMA IDENT(container) COLON NEWLINE EOF",
    },
    {
        name: "list<T> field type tokenizes as LT/GT",
        src: ["type bag:", "    list<game> items"].join("\n"),
        expect:
            "KEYWORD(type) IDENT(bag) COLON NEWLINE INDENT IDENT(list) LT IDENT(game) GT IDENT(items) NEWLINE DEDENT EOF",
    },
    {
        name: "kind with enum constructor",
        src: "kind color = enum(red, green, blue)",
        expect:
            "KEYWORD(kind) IDENT(color) EQUALS IDENT(enum) LPAREN IDENT(red) COMMA IDENT(green) COMMA IDENT(blue) RPAREN NEWLINE EOF",
    },
    {
        name: "change handler shape",
        src: ["on person.holder change:", "    print self.name"].join("\n"),
        expect:
            "KEYWORD(on) IDENT(person) DOT IDENT(holder) KEYWORD(change) COLON NEWLINE INDENT KEYWORD(print) IDENT(self) DOT IDENT(name) NEWLINE DEDENT EOF",
    },
    {
        name: "numbers: int, negative, float",
        src: 'print "v" + -7 + 3.5',
        expect: "KEYWORD(print) STRING(v) PLUS NUMBER(-7) PLUS NUMBER(3.5) NEWLINE EOF",
    },
    {
        name: "comparison operators and equals vs eqeq",
        src: ["if a == b:", "    x = 5"].join("\n"),
        expect:
            "KEYWORD(if) IDENT(a) EQEQ IDENT(b) COLON NEWLINE INDENT IDENT(x) EQUALS NUMBER(5) NEWLINE DEDENT EOF",
    },
    {
        name: "comments and blank lines are suppressed",
        src: ["# header comment", "game G:    # trailing", "    version 1", "", '    author "x"'].join("\n"),
        expect:
            "IDENT(game) IDENT(G) COLON NEWLINE INDENT IDENT(version) NUMBER(1) NEWLINE IDENT(author) STRING(x) NEWLINE DEDENT EOF",
    },
    {
        name: "nested blocks emit balanced indent/dedent",
        src: ["on startup:", "    if x:", "        print 1", "    print 2"].join("\n"),
        expect:
            "KEYWORD(on) IDENT(startup) COLON NEWLINE INDENT KEYWORD(if) IDENT(x) COLON NEWLINE INDENT KEYWORD(print) NUMBER(1) NEWLINE DEDENT KEYWORD(print) NUMBER(2) NEWLINE DEDENT EOF",
    },
    {
        name: "for loop header keywords",
        src: ["for i = 1 to 5 step 2:", "    print i"].join("\n"),
        expect:
            "KEYWORD(for) IDENT(i) EQUALS NUMBER(1) KEYWORD(to) NUMBER(5) KEYWORD(step) NUMBER(2) COLON NEWLINE INDENT KEYWORD(print) IDENT(i) NEWLINE DEDENT EOF",
    },
    {
        name: "string resolves an escaped quote",
        src: 'print "a \\" b"',
        expect: 'KEYWORD(print) STRING(a " b) NEWLINE EOF',
    },
    {
        name: "string resolves newline, tab, and backslash escapes",
        src: 'print "a\\nb\\tc\\\\d"',
        expect: "KEYWORD(print) STRING(a\nb\tc\\d) NEWLINE EOF",
    },
    {
        name: "unknown escape keeps its backslash",
        src: 'print "C:\\Users"',
        expect: "KEYWORD(print) STRING(C:\\Users) NEWLINE EOF",
    },
    // New single-char tokens and priority ordering
    {
        name: "MINUS SLASH CARET tokenize as infix operators",
        src: "5 - 3 / 2 ^ 4",
        expect: "NUMBER(5) MINUS NUMBER(3) SLASH NUMBER(2) CARET NUMBER(4) NEWLINE EOF",
    },
    {
        name: "negative number scanner wins over MINUS: -digit → NUMBER not MINUS+NUMBER",
        src: "print -7",
        expect: "KEYWORD(print) NUMBER(-7) NEWLINE EOF",
    },
    {
        name: "MINUS produced when hyphen is followed by a space then digit (a - 7)",
        src: "a - 7",
        expect: "IDENT(a) MINUS NUMBER(7) NEWLINE EOF",
    },
    {
        name: "subtraction of a negative: 10 - -7 → MINUS then NUMBER(-7)",
        src: "10 - -7",
        expect: "NUMBER(10) MINUS NUMBER(-7) NEWLINE EOF",
    },
    {
        name: "interior-hyphen identifier scanner wins over MINUS: x-y stays one IDENT",
        src: "x-y",
        expect: "IDENT(x-y) NEWLINE EOF",
    },
    {
        name: "<= and >= produce LTE and GTE; bare < and > still produce LT and GT",
        src: "a < b <= c > d >= e",
        expect: "IDENT(a) LT IDENT(b) LTE IDENT(c) GT IDENT(d) GTE IDENT(e) NEWLINE EOF",
    },
];

const coerceCases = [
    ["West_of_House", "West of House"],
    ["One-Room_Game", "One-Room Game"],
    ["well-worn_map", "well-worn map"],
    ["PI", "PI"],
    ["USE_OXFORD_COMMA", "USE OXFORD COMMA"],
    ["well\\_worn_map", "well_worn map"],
];

const throwCases = [
    {
        name: "unterminated string",
        src: 'print "oops',
        message: /Unterminated string/,
    },
    {
        name: "inconsistent dedent",
        src: ["on startup:", "        print 1", "    print 2"].join("\n"),
        message: /Inconsistent indentation/,
    },
];

let failures = 0;

for (const c of tokenCases) {
    try {
        const actual = render(tokenize(c.src, "test.lamp"));
        assert.strictEqual(actual, c.expect);
        console.log(`  ok  ${c.name}`);
    } catch (err) {
        failures += 1;
        console.log(`FAIL  ${c.name}`);
        console.log(`      expected: ${c.expect}`);
        console.log(`      actual:   ${err.actual !== undefined ? err.actual : err.message}`);
    }
}

for (const [raw, expected] of coerceCases) {
    try {
        assert.strictEqual(coerceName(raw), expected);
        console.log(`  ok  coerceName(${JSON.stringify(raw)})`);
    } catch (err) {
        failures += 1;
        console.log(`FAIL  coerceName(${JSON.stringify(raw)})`);
        console.log(`      expected: ${JSON.stringify(expected)}`);
        console.log(`      actual:   ${JSON.stringify(err.actual)}`);
    }
}

for (const c of throwCases) {
    try {
        assert.throws(() => tokenize(c.src, "test.lamp"), c.message);
        console.log(`  ok  throws: ${c.name}`);
    } catch (err) {
        failures += 1;
        console.log(`FAIL  throws: ${c.name} (${err.message})`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} tokenizer test(s) failed.`);
    process.exit(1);
}
console.log("\nAll tokenizer tests passed.");
