// Token-level declaration pre-pass.
//
// The parser needs a handful of name sets known up front (across all files)
// before it can resolve ambiguous surface forms: a bare identifier might be an
// object reference; `check take:` is a phase rule, not an object declaration;
// a custom relation `syntax` line dispatches on its leading literal. This pass
// collects those names from the *token stream* produced by tokenizer.js, so it
// shares the lexer's comment/string handling instead of re-scanning raw text
// with regexes (the old approach in index.js). See devdocs/architecture.md
// ("Known Architectural Issues" → A).
//
// One call handles one file; index.js merges the results across files and then
// parses each file from the same tokens it prescanned.

const { coerceName } = require("./tokenizer");

// Band words lead a phase rule (`check take:`). They are plain identifiers, so a
// `BAND NAME:` line is shaped exactly like a `TYPE NAME:` object declaration and
// must be excluded from the object-name scan.
const BAND_WORDS = new Set(["before", "instead", "check", "do", "after", "report"]);

const isKeyword = (token, value) => token && token.type === "KEYWORD" && token.value === value;
const isIdent = (token) => Boolean(token) && token.type === "IDENT";

// Invokes `visit(lineTokens, depth)` once per logical line, where `lineTokens`
// excludes the structural INDENT/DEDENT/NEWLINE/EOF markers and `depth` is the
// line's indentation level. INDENT/DEDENT precede the line's content tokens (see
// tokenizer.js), so `depth` is current by the time the line's tokens arrive.
function eachLogicalLine(tokens, visit) {
    let depth = 0;
    let current = [];
    for (const token of tokens) {
        if (token.type === "INDENT") { depth += 1; continue; }
        if (token.type === "DEDENT") { depth -= 1; continue; }
        if (token.type === "NEWLINE" || token.type === "EOF") {
            if (current.length > 0) visit(current, depth);
            current = [];
            continue;
        }
        current.push(token);
    }
    if (current.length > 0) visit(current, depth);
}

// The parameter names declared inside a `(...)` token span: each comma-separated
// group is `TYPE name` (TYPE may itself be multi-token, e.g. `list<string>`), so
// the name is the last identifier in the group.
function paramNamesFromSpan(span) {
    const groups = [];
    let group = [];
    for (const token of span) {
        if (token.type === "COMMA") {
            groups.push(group);
            group = [];
        } else {
            group.push(token);
        }
    }
    if (group.length > 0) groups.push(group);
    return groups
        .map((g) => {
            const idents = g.filter((t) => t.type === "IDENT");
            return idents.length > 0 ? idents[idents.length - 1].value : null;
        })
        .filter(Boolean);
}

function prescanDeclarations(tokens) {
    const globalNames = new Set();
    const functionNames = new Set();
    const relationNames = new Set();
    const actionNames = new Set();
    const objectNames = new Set();
    const tagNames = new Set();
    const rulebookParams = new Map();
    const relationTemplates = [];
    let currentRelation = null;

    eachLogicalLine(tokens, (line, depth) => {
        const head = line[0];

        // global TYPE name = value  → name is the identifier before `=`.
        if (isKeyword(head, "global")) {
            const eq = line.findIndex((t) => t.type === "EQUALS");
            if (eq > 0 && line[eq - 1].type === "IDENT") {
                globalNames.add(line[eq - 1].value);
            }
            return;
        }

        // [native] function TYPE name(...)  → name is the identifier before `(`.
        if (isKeyword(head, "function") || (isKeyword(head, "native") && isKeyword(line[1], "function"))) {
            const lp = line.findIndex((t) => t.type === "LPAREN");
            if (lp > 0 && line[lp - 1].type === "IDENT") {
                functionNames.add(line[lp - 1].value);
            }
            return;
        }

        // relation name:  (also arms the syntax-template association below)
        if (isKeyword(head, "relation")) {
            if (isIdent(line[1])) {
                relationNames.add(line[1].value);
                currentRelation = line[1].value;
            }
            return;
        }

        // action name:
        if (isKeyword(head, "action")) {
            if (isIdent(line[1])) actionNames.add(line[1].value);
            return;
        }

        // rulebook TYPE name(params)  → name before `(`, params inside.
        if (isKeyword(head, "rulebook")) {
            const lp = line.findIndex((t) => t.type === "LPAREN");
            const rp = line.findIndex((t) => t.type === "RPAREN");
            if (lp > 0 && line[lp - 1].type === "IDENT") {
                const span = rp > lp ? line.slice(lp + 1, rp) : [];
                rulebookParams.set(line[lp - 1].value, paramNamesFromSpan(span));
            }
            return;
        }

        // syntax "template"  — associates with the most recent relation.
        if (isIdent(head) && head.value === "syntax" && line[1] && line[1].type === "STRING" && currentRelation) {
            relationTemplates.push({ relationName: currentRelation, template: line[1].value });
            return;
        }

        // tags a, b  — only inside an action body (indented).
        if (depth > 0 && isIdent(head) && head.value === "tags") {
            for (let i = 1; i < line.length; i += 1) {
                if (line[i].type === "IDENT") tagNames.add(line[i].value);
            }
            return;
        }

        // Top-level object declaration: `TYPE NAME` or `TYPE NAME:` — exactly two
        // identifiers (plus an optional trailing colon), no `=`, leading token not
        // a band word. The object name is coerced (underscores → spaces) to match
        // how it is referenced.
        if (depth === 0 && isIdent(head) && !BAND_WORDS.has(head.value)) {
            if (line.some((t) => t.type === "EQUALS")) return;
            const significant = line.filter((t) => t.type !== "COLON");
            if (significant.length === 2 && significant[0].type === "IDENT" && significant[1].type === "IDENT") {
                objectNames.add(coerceName(significant[1].value));
            }
        }
    });

    return {
        globalNames,
        functionNames,
        relationNames,
        actionNames,
        objectNames,
        tagNames,
        rulebookParams,
        relationTemplates,
    };
}

module.exports = {
    prescanDeclarations,
};
