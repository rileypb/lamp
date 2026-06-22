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

// Like parse but supplies the declared verb-sugar word set (the 11th positional
// arg), so `[drop]` desugars to a conjugate() call. See parser_rd desugarSugar.
function parseWithVerbs(src, verbs = [], globals = []) {
    return parseSource(
        src, "t.lamp", new Set(globals), new Set(), new Set(), new Map(),
        new Set(), new Set(), new Set(), new Map(), new Set(verbs),
    ).nodes;
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
                { kind: "FieldDecl", typeName: "list<game>", fieldName: "items", defaultValue: null, direct: false },
                { kind: "FieldDecl", typeName: "int", fieldName: "count", defaultValue: null, direct: false },
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
        name: "template literal: text + embedded expressions split into parts",
        run() {
            const [handler] = parse(["on startup:", '    print "you have [score] of [max]"'].join("\n"), ["score"]);
            const expr = handler.body[0].expr;
            assert.strictEqual(expr.kind, "TemplateLiteral");
            // Empty text segments (e.g. the tail after the last `]`) are omitted.
            assert.deepStrictEqual(expr.parts.map((p) => p.kind), ["text", "expr", "text", "expr"]);
            assert.deepStrictEqual(expr.parts[0], { kind: "text", value: "you have " });
            assert.deepStrictEqual(expr.parts[1].expr, { kind: "GlobalExpr", name: "score" });
            assert.deepStrictEqual(expr.parts[2], { kind: "text", value: " of " });
        },
    },
    {
        name: "template literal: embedded expression resolves locals and property access",
        run() {
            const [handler] = parse(["on startup:", "    let n = 1", '    print "n is [n.x]"'].join("\n"));
            const expr = handler.body[1].expr;
            assert.strictEqual(expr.kind, "TemplateLiteral");
            assert.deepStrictEqual(expr.parts[1].expr, { kind: "PropertyAccess", chain: ["n", "x"] });
        },
    },
    {
        name: "template literal: no substitution stays a StringLiteral; \\[ \\] resolve to literal brackets",
        run() {
            const [handler] = parse(["on startup:", '    print "a \\[tag\\] here"'].join("\n"));
            assert.deepStrictEqual(handler.body[0].expr, { kind: "StringLiteral", value: "a [tag] here" });
        },
    },
    {
        name: "freeze: produces a FreezeExpr over the operand",
        run() {
            const [handler] = parse(["on startup:", '    let s = freeze "hi [score]"'].join("\n"), ["score"]);
            const expr = handler.body[0].expr;
            assert.strictEqual(expr.kind, "FreezeExpr");
            assert.strictEqual(expr.expr.kind, "TemplateLiteral");
        },
    },
    {
        name: "article sugar: [the X] / [A X] desugar to article calls; [a + b] does not",
        run() {
            const [a] = parse(["on startup:", '    print "[the cloak]"'].join("\n"));
            const e1 = a.body[0].expr.parts[0].expr;
            assert.strictEqual(e1.kind, "CallExpr");
            assert.strictEqual(e1.name, "the");
            const [b] = parse(["on startup:", '    print "[A apple]"'].join("\n"));
            const e2 = b.body[0].expr.parts[0].expr;
            assert.strictEqual(e2.kind, "CallExpr");
            assert.strictEqual(e2.name, "cap");
            assert.strictEqual(e2.args[0].kind, "CallExpr");
            assert.strictEqual(e2.args[0].name, "indefinite");
            // A leading article word followed by an operator is NOT sugar (so a
            // local `a` in `[a + b]` is safe); it parses as an ordinary expression.
            const [c] = parse(["on startup:", "    let a = 1", '    print "[a + b]"'].join("\n"));
            assert.strictEqual(c.body[1].expr.parts[0].expr.kind, "Concat");
        },
    },
    {
        name: "pronoun sugar: [We]/[they]/[them] desugar to zero-arg locale calls; [We] caps",
        run() {
            const [a] = parse(["on startup:", '    print "[We] and [they] saw [them]"'].join("\n"));
            const parts = a.body[0].expr.parts;
            const we = parts[0].expr;
            assert.strictEqual(we.kind, "CallExpr");
            assert.strictEqual(we.name, "cap");
            assert.strictEqual(we.args[0].name, "we");
            assert.deepStrictEqual(we.args[0].args, []);
            assert.strictEqual(parts[2].expr.name, "they");
            assert.strictEqual(parts[4].expr.name, "them");
        },
    },
    {
        name: "regarding sugar: [regarding EXPR] desugars to a regarding(EXPR) call",
        run() {
            const [a] = parse(["on startup:", '    print "[regarding cloak]gone"'].join("\n"));
            const e = a.body[0].expr.parts[0].expr;
            assert.strictEqual(e.kind, "CallExpr");
            assert.strictEqual(e.name, "regarding");
            assert.strictEqual(e.args.length, 1);
        },
    },
    {
        name: "verb sugar: a declared verb word becomes conjugate(\"word\"); [Drop] caps; an undeclared word stays a reference",
        run() {
            const [a] = parseWithVerbs(["on startup:", '    print "[We] [drop] it"'].join("\n"), ["drop"]);
            const drop = a.body[0].expr.parts[2].expr;
            assert.strictEqual(drop.kind, "CallExpr");
            assert.strictEqual(drop.name, "conjugate");
            assert.deepStrictEqual(drop.args[0], { kind: "StringLiteral", value: "drop" });
            const [b] = parseWithVerbs(["on startup:", '    print "[Drop] it"'].join("\n"), ["drop"]);
            const cap = b.body[0].expr.parts[0].expr;
            assert.strictEqual(cap.name, "cap");
            assert.strictEqual(cap.args[0].name, "conjugate");
            // An undeclared bare word is an ordinary reference, not a verb.
            const [c] = parse(["on startup:", '    print "[box]"'].join("\n"));
            assert.notStrictEqual(c.body[0].expr.parts[0].expr.kind, "CallExpr");
        },
    },
    {
        name: "is/are list sugar: [is LIST]/[is the LIST]/[is a LIST] desugar; [Is …] caps; bare [is] stays a verb",
        run() {
            const [a] = parse(["on startup:", '    print "[is stuff]"'].join("\n"));
            const bare = a.body[0].expr.parts[0].expr;
            assert.strictEqual(bare.kind, "CallExpr");
            assert.strictEqual(bare.name, "is_are_list");
            const [b] = parse(["on startup:", '    print "[is the stuff]"'].join("\n"));
            assert.strictEqual(b.body[0].expr.parts[0].expr.name, "is_are_the_list");
            const [c] = parse(["on startup:", '    print "[is a stuff]"'].join("\n"));
            assert.strictEqual(c.body[0].expr.parts[0].expr.name, "is_are_a_list");
            const [d] = parse(["on startup:", '    print "[Is the stuff]"'].join("\n"));
            const cap = d.body[0].expr.parts[0].expr;
            assert.strictEqual(cap.name, "cap");
            assert.strictEqual(cap.args[0].name, "is_are_the_list");
            // Bare [is] with no operand stays the verb conjugation, not the list sugar.
            const [e] = parseWithVerbs(["on startup:", '    print "[is]"'].join("\n"), ["is"]);
            assert.strictEqual(e.body[0].expr.parts[0].expr.name, "conjugate");
        },
    },
    {
        name: "paragraph markers: [par]/[line break]/[no break]/[run on]/[par if printed] desugar to output-stream calls",
        run() {
            const cases = [
                ["[par]", "paragraph"],
                ["[line break]", "line_break"],
                ["[no break]", "no_break"],
                ["[run on]", "no_break"],
                ["[par if printed]", "par_if_printed"],
            ];
            for (const [marker, fn] of cases) {
                const [a] = parse(["on startup:", `    print "${marker}"`].join("\n"));
                const e = a.body[0].expr.parts[0].expr;
                assert.strictEqual(e.kind, "CallExpr", `${marker} should be a call`);
                assert.strictEqual(e.name, fn, `${marker} -> ${fn}()`);
                assert.deepStrictEqual(e.args, []);
            }
        },
    },
    {
        name: "verb declaration: `verb a, b` parses to a discardable VerbDecl (keyword words allowed)",
        run() {
            const nodes = parse(["verb drop, do", "on startup:", "    print 1"].join("\n"));
            assert.strictEqual(nodes[0].kind, "VerbDecl");
            assert.strictEqual(nodes[1].kind, "EventHandler");
        },
    },
    {
        name: "inline conditional: [if]/[else if]/[else]/[end] builds a cond part with branches",
        run() {
            const [h] = parse(["on startup:", '    print "[if dark]x[else if lit]y[else]z[end]!"'].join("\n"), ["dark", "lit"]);
            const parts = h.body[0].expr.parts;
            const cond = parts[0];
            assert.strictEqual(cond.kind, "cond");
            assert.strictEqual(cond.branches.length, 3);
            assert.deepStrictEqual(cond.branches[0].cond, { kind: "GlobalExpr", name: "dark" });
            assert.deepStrictEqual(cond.branches[0].parts, [{ kind: "text", value: "x" }]);
            assert.deepStrictEqual(cond.branches[1].cond, { kind: "GlobalExpr", name: "lit" });
            assert.strictEqual(cond.branches[2].cond, null);
            assert.deepStrictEqual(parts[1], { kind: "text", value: "!" });
        },
    },
    {
        name: "inline conditional: a branch carries its own text and value substitutions",
        run() {
            const [h] = parse(["on startup:", '    print "[if dark]seen [score] times[end]"'].join("\n"), ["dark", "score"]);
            const branch = h.body[0].expr.parts[0].branches[0];
            assert.deepStrictEqual(branch.parts[0], { kind: "text", value: "seen " });
            assert.deepStrictEqual(branch.parts[1].expr, { kind: "GlobalExpr", name: "score" });
            assert.deepStrictEqual(branch.parts[2], { kind: "text", value: " times" });
        },
    },
    {
        name: "inline conditional: rejects unbalanced markers and nested [if]",
        run() {
            assert.throws(() => parse(["on startup:", '    print "[end]"'].join("\n")), /'\[end\]' without a matching '\[if\]'/);
            assert.throws(() => parse(["on startup:", '    print "[if dark]x"'].join("\n"), ["dark"]), /unterminated '\[if\]'/);
            assert.throws(() => parse(["on startup:", '    print "[else]"'].join("\n")), /'\[else\]' without a matching/);
            assert.throws(() => parse(["on startup:", '    print "[if dark]a[if dark]b[end][end]"'].join("\n"), ["dark"]), /nested '\[if\]' is not allowed/);
        },
    },
    {
        name: "[first time]…[only]: builds a firstTime part; rejects [only] without [first time] and nesting",
        run() {
            const [h] = parse(["on startup:", '    print "[first time]hi [score][only]bye"'].join("\n"), ["score"]);
            const parts = h.body[0].expr.parts;
            assert.strictEqual(parts[0].kind, "firstTime");
            assert.deepStrictEqual(parts[0].parts[0], { kind: "text", value: "hi " });
            assert.strictEqual(parts[0].parts[1].expr.kind, "GlobalExpr");
            assert.deepStrictEqual(parts[1], { kind: "text", value: "bye" });
            assert.throws(() => parse(["on startup:", '    print "[only]"'].join("\n")), /'\[only\]' without a matching '\[first time\]'/);
            assert.throws(() => parse(["on startup:", '    print "[first time]x"'].join("\n")), /unterminated '\[first time\]'/);
            assert.throws(() => parse(["on startup:", '    print "[if dark]a[first time]b[only][end]"'].join("\n"), ["dark"]), /nested '\[first time\]' is not allowed/);
        },
    },
    {
        name: "[one of]…[or]…[mode]: builds a oneOf node with alternatives and mode; rejects [or]/[mode] without [one of]",
        run() {
            const [h] = parse(["on startup:", '    print "[one of]a[or]b [score][cycling]"'].join("\n"), ["score"]);
            const node = h.body[0].expr.parts[0];
            assert.strictEqual(node.kind, "oneOf");
            assert.strictEqual(node.mode, "cycling");
            assert.strictEqual(node.alternatives.length, 2);
            assert.deepStrictEqual(node.alternatives[0], [{ kind: "text", value: "a" }]);
            assert.deepStrictEqual(node.alternatives[1][0], { kind: "text", value: "b " });
            assert.strictEqual(node.alternatives[1][1].expr.kind, "GlobalExpr");
            assert.throws(() => parse(["on startup:", '    print "[or]x"'].join("\n")), /'\[or\]' without a matching '\[one of\]'/);
            assert.throws(() => parse(["on startup:", '    print "[at random]"'].join("\n")), /without a matching '\[one of\]'/);
            assert.throws(() => parse(["on startup:", '    print "[one of]a[or]b"'].join("\n")), /unterminated '\[one of\]'/);
            // F7 weighted mode marker.
            const [w] = parse(["on startup:", '    print "[one of]a[or]b[as decreasingly likely outcomes]"'].join("\n"));
            assert.strictEqual(w.body[0].expr.parts[0].mode, "decreasing");
        },
    },
    {
        name: "[s] plural suffix: splits the preceding word into a pluralSuffix part; rejects when not after a word",
        run() {
            const [h] = parse(["on startup:", '    print "[n] bullet[s]!"'].join("\n"), ["n"]);
            const parts = h.body[0].expr.parts;
            // ... expr(n), text(" bullet") -> text(" ") + pluralSuffix("bullet"), text("!")
            const suffix = parts.find((p) => p.kind === "pluralSuffix");
            assert.strictEqual(suffix.word, "bullet");
            assert.deepStrictEqual(parts[1], { kind: "text", value: " " });
            assert.throws(() => parse(["on startup:", '    print "[n][s]"'].join("\n"), ["n"]), /'\[s\]' must immediately follow a word/);
        },
    },
    {
        name: "member access: (EXPR).field parses to a MemberAccess; name.field stays a PropertyAccess",
        run() {
            const [h] = parse(["on startup:", "    let n = (a).size"].join("\n"), ["a"]);
            const expr = h.body[0].expr;
            assert.strictEqual(expr.kind, "MemberAccess");
            assert.deepStrictEqual(expr.fields, ["size"]);
            assert.deepStrictEqual(expr.object, { kind: "GlobalExpr", name: "a" });
            const [h2] = parse(["on startup:", "    let n = xs.count"].join("\n"));
            assert.deepStrictEqual(h2.body[0].expr, { kind: "PropertyAccess", chain: ["xs", "count"] });
        },
    },
    {
        name: "A5 quotes: word-boundary ' becomes \" ; [']  forces a literal apostrophe; both stay StringLiteral",
        run() {
            const [a] = parse(["on startup:", `    print "say 'hi'"`].join("\n"));
            assert.deepStrictEqual(a.body[0].expr, { kind: "StringLiteral", value: 'say "hi"' });
            const [b] = parse(["on startup:", `    print "it[']s"`].join("\n"));
            assert.deepStrictEqual(b.body[0].expr, { kind: "StringLiteral", value: "it's" });
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
    // <= and >= operators
    {
        name: "expression: <= produces LessOrEqualExpr",
        run() {
            const [handler] = parse(["on startup:", "    let n = 5", "    let y = n <= 10"].join("\n"));
            assert.deepStrictEqual(handler.body[1].expr, {
                kind: "LessOrEqualExpr",
                left: { kind: "VariableExpr", name: "n" },
                right: { kind: "NumberLiteral", value: 10 },
            });
        },
    },
    {
        name: "expression: >= swaps operands into LessOrEqualExpr",
        run() {
            const [handler] = parse(["on startup:", "    let n = 5", "    let y = 10 >= n"].join("\n"));
            assert.deepStrictEqual(handler.body[1].expr, {
                kind: "LessOrEqualExpr",
                left: { kind: "VariableExpr", name: "n" },
                right: { kind: "NumberLiteral", value: 10 },
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
    { name: "empty substitution in template", src: 'on startup:\n    print "bad []"', message: /empty '\[\]' substitution/ },
    { name: "unterminated substitution in template", src: 'on startup:\n    print "bad [score"', message: /unterminated '\[' substitution/ },
    { name: "malformed expression in substitution", src: 'on startup:\n    print "bad [1 +]"', message: /invalid substitution/ },
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
