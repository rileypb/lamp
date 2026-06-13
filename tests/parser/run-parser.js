#!/usr/bin/env node
// Unit tests for the recursive-descent parser (parser_rd.js).
//
// These assert the specific AST shapes the new-syntax parser must produce —
// in particular the decisions the refactor had to get right: name coercion
// (underscore -> space), multi-word object reference -> ParenNameExpr,
// single-word reference -> PropertyAccess, global resolution, operator
// precedence, and the identifier validation rules.
//
// Run with: npm run test:parser

const assert = require("assert");
const { parseSource } = require("../../src/lantern/parser_rd");

function parse(src, globals = []) {
    return parseSource(src, "t.lamp", new Set(globals)).nodes;
}

const cases = [
    {
        name: "object decl: multi-word name coerces; values typed correctly",
        run() {
            const [obj] = parse(["game One-Room_Game:", '    author "Test Author"', "    version 1", "    start West_of_House", "    release dev"].join("\n"));
            assert.strictEqual(obj.kind, "ObjectDecl");
            assert.strictEqual(obj.typeName, "game");
            assert.strictEqual(obj.objectName, "One-Room Game");
            assert.deepStrictEqual(obj.fields.map((f) => [f.fieldName, f.value]), [
                ["author", { kind: "StringLiteral", value: "Test Author" }],
                ["version", { kind: "NumberLiteral", value: 1 }],
                ["start", { kind: "StringLiteral", value: "West of House" }],
                ["release", { kind: "StringLiteral", value: "dev" }],
            ]);
        },
    },
    {
        name: "object decl: no body",
        run() {
            const [obj] = parse("person yourself");
            assert.deepStrictEqual(obj, { kind: "ObjectDecl", typeName: "person", objectName: "yourself", fields: [] });
        },
    },
    {
        name: "type decl: parents and list<T> field type",
        run() {
            const [type] = parse(["type box < item, container:", "    list<game> items", "    int count"].join("\n"));
            assert.strictEqual(type.kind, "TypeDecl");
            assert.strictEqual(type.name, "box");
            assert.deepStrictEqual(type.parents, ["item", "container"]);
            assert.deepStrictEqual(type.fields, [
                { kind: "FieldDecl", typeName: "list<game>", fieldName: "items" },
                { kind: "FieldDecl", typeName: "int", fieldName: "count" },
            ]);
        },
    },
    {
        name: "type decl: no body",
        run() {
            const [type] = parse("type startup < event");
            assert.strictEqual(type.kind, "TypeDecl");
            assert.deepStrictEqual(type.parents, ["event"]);
            assert.deepStrictEqual(type.fields, []);
        },
    },
    {
        name: "global decl: multi-word name coerces; value parsed",
        run() {
            const [g] = parse("global bool USE_OXFORD_COMMA = false");
            assert.strictEqual(g.kind, "GlobalDecl");
            assert.strictEqual(g.name, "USE OXFORD COMMA");
            assert.strictEqual(g.typeName, "bool");
            assert.deepStrictEqual(g.value, { kind: "BooleanLiteral", value: false });
        },
    },
    {
        name: "global decl: object-typed, no value defaults to none",
        run() {
            const [g] = parse("global person player");
            assert.deepStrictEqual(g.value, { kind: "NoneLiteral" });
        },
    },
    {
        name: "global assign: multi-word name coerces",
        run() {
            const [a] = parse("USE_OXFORD_COMMA = true");
            assert.strictEqual(a.kind, "GlobalAssign");
            assert.strictEqual(a.name, "USE OXFORD COMMA");
            assert.deepStrictEqual(a.value, { kind: "BooleanLiteral", value: true });
        },
    },
    {
        name: "kind decl: enum labels",
        run() {
            const [k] = parse("kind reltype = enum(dev, beta, final)");
            assert.strictEqual(k.kind, "KindDecl");
            assert.strictEqual(k.name, "reltype");
            assert.deepStrictEqual(k.kindExpr, { kind: "EnumExpr", labels: ["dev", "beta", "final"] });
        },
    },
    {
        name: "event handler: statement kinds and nesting",
        run() {
            const [handler] = parse([
                "on startup:",
                "    let i = 0",
                "    while i < 5:",
                "        print i",
                "        i = i + 1",
                "    if i == 5:",
                '        print "done"',
                "    else:",
                '        print "no"',
                "    for j = 1 to 3 step 2:",
                "        dispatch tick",
                '    error "bad"',
            ].join("\n"));
            assert.strictEqual(handler.kind, "EventHandler");
            assert.strictEqual(handler.eventName, "startup");
            assert.deepStrictEqual(handler.body.map((s) => s.kind), [
                "LetStatement", "WhileStatement", "IfStatement", "ForStatement", "ErrorStatement",
            ]);
            const [, whileStmt, ifStmt, forStmt] = handler.body;
            assert.strictEqual(whileStmt.condition.kind, "LessThanExpr");
            assert.deepStrictEqual(whileStmt.body.map((s) => s.kind), ["PrintStatement", "AssignStatement"]);
            assert.strictEqual(ifStmt.condition.kind, "EqualsExpr");
            assert.strictEqual(ifStmt.thenBody[0].kind, "PrintStatement");
            assert.strictEqual(ifStmt.elseBody[0].kind, "PrintStatement");
            assert.strictEqual(forStmt.varName, "j");
            assert.deepStrictEqual(forStmt.step, { kind: "NumberLiteral", value: 2 });
            assert.strictEqual(forStmt.body[0].kind, "DispatchStatement");
        },
    },
    {
        name: "change handler: self, concat, property access",
        run() {
            const [handler] = parse(["on person.holder change:", '    print self.name + " moved"'].join("\n"));
            assert.strictEqual(handler.kind, "ChangeHandler");
            assert.strictEqual(handler.typeName, "person");
            assert.strictEqual(handler.fieldName, "holder");
            const expr = handler.body[0].expr;
            assert.strictEqual(expr.kind, "Concat");
            assert.deepStrictEqual(expr.left, { kind: "PropertyAccess", chain: ["self", "name"] });
            assert.deepStrictEqual(expr.right, { kind: "StringLiteral", value: " moved" });
        },
    },
    {
        name: "expression: multi-word object reference becomes ParenNameExpr",
        run() {
            const [handler] = parse(["on startup:", "    print Unit_Circle.radius"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, {
                kind: "ParenNameExpr", objectName: "Unit Circle", fieldChain: ["radius"],
            });
        },
    },
    {
        name: "expression: single-word object reference becomes PropertyAccess",
        run() {
            const [handler] = parse(["on startup:", "    print MyCircle.radius"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, { kind: "PropertyAccess", chain: ["MyCircle", "radius"] });
        },
    },
    {
        name: "expression: global reference and left-associative multiplication",
        run() {
            const [handler] = parse(["on startup:", "    print 2 * radius * PI"].join("\n"), ["PI"]);
            const expr = handler.body[0].expr;
            assert.strictEqual(expr.kind, "MultiplyExpr");
            assert.deepStrictEqual(expr.right, { kind: "GlobalExpr", name: "PI" });
            assert.strictEqual(expr.left.kind, "MultiplyExpr");
            assert.deepStrictEqual(expr.left.right, { kind: "StringLiteral", value: "radius" });
        },
    },
    {
        name: "expression: greater-than swaps operands into LessThanExpr",
        run() {
            const [handler] = parse(["on startup:", "    print count > 0"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, {
                kind: "LessThanExpr",
                left: { kind: "NumberLiteral", value: 0 },
                right: { kind: "StringLiteral", value: "count" },
            });
        },
    },
    {
        name: "print with no argument yields empty string",
        run() {
            const [handler] = parse(["on startup:", "    print"].join("\n"));
            assert.deepStrictEqual(handler.body[0], { kind: "PrintStatement", expr: { kind: "StringLiteral", value: "" } });
        },
    },
    {
        name: "lib import",
        run() {
            assert.deepStrictEqual(parse("lib test"), [{ kind: "LibImport", name: "test" }]);
        },
    },
    // Arithmetic operators
    {
        name: "expression: subtraction produces SubtractExpr",
        run() {
            const [handler] = parse(["on startup:", "    let x = 10 - 3"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, {
                kind: "SubtractExpr",
                left: { kind: "NumberLiteral", value: 10 },
                right: { kind: "NumberLiteral", value: 3 },
            });
        },
    },
    {
        name: "expression: division produces DivideExpr",
        run() {
            const [handler] = parse(["on startup:", "    let x = 20 / 4"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, {
                kind: "DivideExpr",
                left: { kind: "NumberLiteral", value: 20 },
                right: { kind: "NumberLiteral", value: 4 },
            });
        },
    },
    {
        name: "expression: power produces PowerExpr",
        run() {
            const [handler] = parse(["on startup:", "    let x = 2 ^ 8"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, {
                kind: "PowerExpr",
                left: { kind: "NumberLiteral", value: 2 },
                right: { kind: "NumberLiteral", value: 8 },
            });
        },
    },
    {
        name: "expression: power is right-associative (2^3^2 = 2^(3^2))",
        run() {
            const [handler] = parse(["on startup:", "    let x = 2 ^ 3 ^ 2"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, {
                kind: "PowerExpr",
                left: { kind: "NumberLiteral", value: 2 },
                right: {
                    kind: "PowerExpr",
                    left: { kind: "NumberLiteral", value: 3 },
                    right: { kind: "NumberLiteral", value: 2 },
                },
            });
        },
    },
    {
        name: "expression: + and * precedence (* binds tighter than +)",
        run() {
            const [handler] = parse(["on startup:", "    let x = 1 + 2 * 3"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, {
                kind: "Concat",
                left: { kind: "NumberLiteral", value: 1 },
                right: {
                    kind: "MultiplyExpr",
                    left: { kind: "NumberLiteral", value: 2 },
                    right: { kind: "NumberLiteral", value: 3 },
                },
            });
        },
    },
    // Unary negation
    {
        name: "expression: unary minus produces NegateExpr",
        run() {
            const [handler] = parse(["on startup:", "    let n = 5", "    let y = -n"].join("\n"));
            assert.deepStrictEqual(handler.body[1].expr, {
                kind: "NegateExpr",
                expr: { kind: "VariableExpr", name: "n" },
            });
        },
    },
    {
        name: "expression: unary minus binds looser than ^ (-n^2 = -(n^2))",
        run() {
            const [handler] = parse(["on startup:", "    let n = 5", "    let y = -n ^ 2"].join("\n"));
            assert.deepStrictEqual(handler.body[1].expr, {
                kind: "NegateExpr",
                expr: {
                    kind: "PowerExpr",
                    left: { kind: "VariableExpr", name: "n" },
                    right: { kind: "NumberLiteral", value: 2 },
                },
            });
        },
    },
    {
        name: "expression: unary minus binds tighter than * (-n*2 = (-n)*2)",
        run() {
            const [handler] = parse(["on startup:", "    let n = 5", "    let y = -n * 2"].join("\n"));
            assert.deepStrictEqual(handler.body[1].expr, {
                kind: "MultiplyExpr",
                left: {
                    kind: "NegateExpr",
                    expr: { kind: "VariableExpr", name: "n" },
                },
                right: { kind: "NumberLiteral", value: 2 },
            });
        },
    },
    // Parenthesized expressions
    {
        name: "expression: parens override precedence ((3+4)*2 = Multiply(Concat(3,4),2))",
        run() {
            const [handler] = parse(["on startup:", "    let x = (3 + 4) * 2"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, {
                kind: "MultiplyExpr",
                left: {
                    kind: "Concat",
                    left: { kind: "NumberLiteral", value: 3 },
                    right: { kind: "NumberLiteral", value: 4 },
                },
                right: { kind: "NumberLiteral", value: 2 },
            });
        },
    },
    {
        name: "expression: parens force left-assoc on power ((2^3)^2)",
        run() {
            const [handler] = parse(["on startup:", "    let x = (2 ^ 3) ^ 2"].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, {
                kind: "PowerExpr",
                left: {
                    kind: "PowerExpr",
                    left: { kind: "NumberLiteral", value: 2 },
                    right: { kind: "NumberLiteral", value: 3 },
                },
                right: { kind: "NumberLiteral", value: 2 },
            });
        },
    },
];

// The parser must reject these with a clear error.
const rejectCases = [
    { name: "leading separator in object name", src: "game _Bad:\n    version 1", message: /may not begin or end with a separator/ },
    { name: "trailing separator in object name", src: "game Bad_:\n    version 1", message: /may not begin or end with a separator/ },
    { name: "hyphen in local variable name", src: "on startup:\n    let bad-name = 1", message: /plain identifier/ },
    { name: "reserved word as object name", src: "game while:\n    version 1", message: /Expected object name/ },
    { name: "property access on a literal", src: "on startup:\n    print 2.name", message: /property access '\.' requires a variable or object reference/ },
    { name: "unmatched left parenthesis", src: "on startup:\n    let x = (3 + 4", message: /close expression/ },
];

let failures = 0;

for (const c of cases) {
    try {
        c.run();
        console.log(`  ok  ${c.name}`);
    } catch (err) {
        failures += 1;
        console.log(`FAIL  ${c.name}`);
        console.log(`      ${err.message.split("\n").slice(0, 12).join("\n      ")}`);
    }
}

for (const c of rejectCases) {
    try {
        assert.throws(() => parseSource(c.src, "t.lamp", new Set()), c.message);
        console.log(`  ok  rejects: ${c.name}`);
    } catch (err) {
        failures += 1;
        console.log(`FAIL  rejects: ${c.name} (${err.message})`);
    }
}

if (failures > 0) {
    console.error(`\n${failures} parser test(s) failed.`);
    process.exit(1);
}
console.log("\nAll parser tests passed.");
