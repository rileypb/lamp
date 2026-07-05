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

// Type names and field names declared in one file's tokens. The driver collects
// these across *all* files first, then passes the merged sets to
// `prescanDeclarations` and the parser, which use them to disambiguate a nested
// object placement from a field assignment inside an object body: a line
// `TYPE NAME` is a placement when TYPE is a known type and *not* a known field name
// (so `item hook` nests, but `article proper` stays a field even though `article`
// is also a type). Field names come from `type X:` bodies — `FIELDTYPE FIELDNAME`,
// the name being the identifier before `=` (defaulted field) or the last identifier.
function prescanTypes(tokens) {
    const typeNames = new Set();
    const fieldNames = new Set();
    let typeBodyDepth = -1; // lines at exactly this depth are the current type's fields
    eachLogicalLine(tokens, (line, depth) => {
        if (typeBodyDepth >= 0 && depth < typeBodyDepth) typeBodyDepth = -1;
        if (isKeyword(line[0], "type") && isIdent(line[1])) {
            typeNames.add(line[1].value);
            typeBodyDepth = line[line.length - 1].type === "COLON" ? depth + 1 : -1;
            return;
        }
        if (typeBodyDepth >= 0 && depth === typeBodyDepth) {
            const eq = line.findIndex((t) => t.type === "EQUALS");
            const nameTok = eq > 0 ? line[eq - 1] : line[line.length - 1];
            if (nameTok && nameTok.type === "IDENT") fieldNames.add(nameTok.value);
        }
    });
    return { typeNames, fieldNames };
}

function prescanDeclarations(tokens, knownTypeNames = new Set(), knownFieldNames = new Set()) {
    const globalNames = new Set();
    const functionNames = new Set();
    const relationNames = new Set();
    const actionNames = new Set();
    const objectNames = new Set();
    const reasonNames = new Set();
    const tagNames = new Set();
    const verbNames = new Set();
    const sugarDecls = new Map();
    const rulebookParams = new Map();
    const relationTemplates = [];
    let currentRelation = null;

    // Types/fields for nested-object detection: this file's own declarations unioned
    // with the cross-file sets the driver passes in (single-file callers, e.g. tests,
    // pass none and rely on the local scan).
    const own = prescanTypes(tokens);
    const typeNames = own.typeNames;
    const nestingTypes = new Set([...typeNames, ...knownTypeNames]);
    const fieldNames = new Set([...own.fieldNames, ...knownFieldNames]);

    // A nested object placement is recognized only inside an *object* body (not a
    // type/relation/action/code body, which can hold lines of the same `TYPE NAME`
    // shape). `blockStack` tracks, per open `:` block, whether it is an object body.
    const blockStack = [];

    // Whether `line` (at `depth`, inside the block `enclosing`) declares/places an
    // object, returning the raw object name or null. Top level: any two-identifier
    // line. Nested (depth > 0): only inside an object body, leading a known type that
    // is not a field name (so `item hook` places, `article proper` is a field).
    const objectNameOf = (line, depth, enclosing) => {
        const head = line[0];
        if (!isIdent(head) || BAND_WORDS.has(head.value)) return null;
        if (line.some((t) => t.type === "EQUALS")) return null;
        const significant = line.filter((t) => t.type !== "COLON");
        if (significant.length !== 2 || significant[0].type !== "IDENT" || significant[1].type !== "IDENT") return null;
        if (depth === 0) return significant[1].value;
        if (enclosing && enclosing.isObjectBody
                && nestingTypes.has(significant[0].value) && !fieldNames.has(significant[0].value)) {
            return significant[1].value;
        }
        return null;
    };

    eachLogicalLine(tokens, (line, depth) => {
        const head = line[0];

        // Object-name + block-kind tracking runs first (before the keyword branches'
        // early returns), since it must see every line to maintain the block stack.
        while (blockStack.length > 0 && blockStack[blockStack.length - 1].depth >= depth) blockStack.pop();
        const enclosing = blockStack.length > 0 ? blockStack[blockStack.length - 1] : null;
        const objName = objectNameOf(line, depth, enclosing);
        if (objName) objectNames.add(coerceName(objName));
        if (line[line.length - 1].type === "COLON") {
            blockStack.push({ depth, isObjectBody: objName !== null });
        }

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

        // verb a, b, c  — registers conjugation-sugar words so the parser rewrites
        // `[drop]` in a template to a conjugate() call (vs. an object reference).
        // A word may itself be a keyword (`verb do`), so collect IDENT and KEYWORD
        // tokens alike, skipping the comma separators; a STRING carries letters an
        // identifier can't (`verb "être"`). See devdocs/text.md D3.
        if (isKeyword(head, "verb")) {
            for (let i = 1; i < line.length; i += 1) {
                if (line[i].type === "IDENT" || line[i].type === "KEYWORD" || line[i].type === "STRING") {
                    verbNames.add(line[i].value);
                }
            }
            return;
        }

        // sugar bare|operand TOKEN[, TOKEN]  — a locale's template-sugar tokens. Each TOKEN is a
        // word (or `"quoted" as native`) mapping to a native call. The parser's desugarer reads
        // this map. See devdocs/i18n.md ("declarable grammar sugar").
        if (isKeyword(head, "sugar") && isIdent(line[1])
                && (line[1].value === "bare" || line[1].value === "operand")) {
            const shape = line[1].value;
            let i = 2;
            while (i < line.length) {
                const tok = line[i];
                if (tok.type === "COMMA") { i += 1; continue; }
                if (tok.type !== "IDENT" && tok.type !== "KEYWORD" && tok.type !== "STRING") { i += 1; continue; }
                const token = String(tok.value).toLowerCase();
                let native = coerceName(tok.value);
                i += 1;
                if (i + 1 < line.length && line[i].type === "IDENT" && line[i].value === "as") {
                    native = line[i + 1].value;
                    i += 2;
                }
                sugarDecls.set(token, { native, shape });
            }
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

        // Reason producers: `stop <outcome> <reason>` (the failure-reason form) and a direct
        // `… reason = <reason>` assignment. A reason names a `stop_reason` singleton; harvesting
        // it here means the author needn't declare `stop_reason X` — index.js injects a synthetic
        // declaration. Also add it to objectNames so the parser resolves every reason (single- OR
        // multi-word) uniformly as an object reference, not sometimes a bare string.
        if (isKeyword(head, "stop") && line.length === 3
                && isIdent(line[1]) && (line[1].value === "failed" || line[1].value === "succeeded")
                && isIdent(line[2])) {
            const r = coerceName(line[2].value);
            objectNames.add(r);
            reasonNames.add(r);
            return;
        }
        const eqIdx = line.findIndex((t) => t.type === "EQUALS");
        if (eqIdx > 1 && isIdent(line[eqIdx - 1]) && line[eqIdx - 1].value === "reason"
                && line.length === eqIdx + 2 && isIdent(line[eqIdx + 1])) {
            const r = coerceName(line[eqIdx + 1].value);
            objectNames.add(r);
            reasonNames.add(r);
        }

    });

    return {
        globalNames,
        functionNames,
        relationNames,
        actionNames,
        objectNames,
        reasonNames,
        sugarDecls,
        typeNames,
        tagNames,
        verbNames,
        rulebookParams,
        relationTemplates,
    };
}

module.exports = {
    prescanDeclarations,
    prescanTypes,
};
