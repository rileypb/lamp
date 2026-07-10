// Recursive-descent parser over the full-file token stream (tokenizer.js).
//
// Produces the exact same AST as the legacy line-scanning parser (parser.js),
// so the checker and emitter are unaffected. This is the step-3 rewrite from
// devdocs/parser_refactor.md; it consumes the new underscore-identifier
// surface syntax (specs.md, "Names and identifiers").
//
// Name-role coercion (`coerceName`) is applied only where the legacy parser
// took raw multi-word text: object names, global names, object references.
// Plain identifiers (locals, loop vars, type/kind/field/event names) keep
// their raw spelling and are required to be JavaScript-safe.

const ast = require("./ast");
const { tokenize, coerceName } = require("./tokenizer");

const JS_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BP = { EQEQ: 5, NEQ: 5, LT: 5, GT: 5, LTE: 5, GTE: 5, PLUS: 10, MINUS: 10, STAR: 20, SLASH: 20, CARET: 30, LBRACKET: 40 };

function getInfixBP(token) {
    if (token.type === "KEYWORD" && token.value === "or") return 1;
    if (token.type === "KEYWORD" && token.value === "and") return 2;
    // `is` (type-membership test) binds like the comparison operators.
    if (token.type === "KEYWORD" && token.value === "is") return BP.EQEQ;
    // mod/div are multiplicative keyword operators, binding like * and /.
    if (token.type === "KEYWORD" && (token.value === "mod" || token.value === "div")) return BP.STAR;
    return BP[token.type];
}

const PHASE_WORDS = new Set(["before", "instead", "check", "do", "after", "report"]);

function parseSource(sourceText, filePath, globalNames = new Set(), functionNames = new Set(), relationNames = new Set(), relationTemplates = new Map(), actionNames = new Set(), objectNames = new Set(), tagNames = new Set(), rulebookParams = new Map(), verbNames = new Set(), typeNames = new Set(), fieldNames = new Set(), sugarMap = new Map()) {
    const tokens = tokenize(sourceText, filePath);
    return parseTokens(tokens, filePath, globalNames, functionNames, relationNames, relationTemplates, actionNames, objectNames, tagNames, rulebookParams, verbNames, typeNames, fieldNames, sugarMap);
}

// Parses an already-tokenized file. The driver (src/lantern/index.js) tokenizes
// each file once, runs the token-level prescan over those tokens, then parses
// from the same tokens — so tokenization happens exactly once per file.
function parseTokens(tokens, filePath, globalNames = new Set(), functionNames = new Set(), relationNames = new Set(), relationTemplates = new Map(), actionNames = new Set(), objectNames = new Set(), tagNames = new Set(), rulebookParams = new Map(), verbNames = new Set(), typeNames = new Set(), fieldNames = new Set(), sugarMap = new Map()) {
    return createParser(tokens, filePath, globalNames, functionNames, relationNames, relationTemplates, actionNames, objectNames, tagNames, rulebookParams, verbNames, typeNames, fieldNames, sugarMap).parseProgram();
}

// Applies Inform's single-quote convention to a literal text run: a `'` flanked
// by word characters on both sides is an apostrophe ("don't") and stays; any
// other `'` (start or end of a word) is a typographic double quote, so `'foo'`
// renders as "foo". The `[']` form (handled in splitTemplate) forces a literal
// apostrophe where this rule would otherwise convert. This is an English-prose
// convention; a future locale pass could own it. See devdocs/text.md A5.
// The word test includes accented Latin letters — French elisions sit against
// them constantly ("d'évident"), and an ASCII-only class silently turned those
// apostrophes into quotes.
function applyQuoteConvention(run) {
    if (run.indexOf("'") === -1) return run;
    let out = "";
    for (let k = 0; k < run.length; k += 1) {
        if (run[k] !== "'") {
            out += run[k];
            continue;
        }
        const wordBefore = k > 0 && /[A-Za-z0-9À-ɏ]/.test(run[k - 1]);
        const wordAfter = k + 1 < run.length && /[A-Za-z0-9À-ɏ]/.test(run[k + 1]);
        out += wordBefore && wordAfter ? "'" : '"';
    }
    return out;
}

// Template sugar is locale-declared, not baked into the compiler: a locale pack's `sugar`
// declarations (collected in the prescan into `sugarMap`, token → { native, shape }) drive the
// desugarer, so a new language never needs a parser change. `operand` sugar takes one reference
// (`[the X]` → the(X)); `bare` sugar is zero-arg (`[we]` → we()). See devdocs/i18n.md
// ("declarable grammar sugar") and lib/en-US/functions.lamp for the English set.
function sugarNative(word, sugarMap, shape) {
    const entry = sugarMap.get(word);
    return entry && entry.shape === shape ? entry.native : undefined;
}
// `[the X]`: an operand-shape sugar word applied to a single reference token. Anything more
// complex (operators, multiple operands) is left alone — write the explicit call form, e.g.
// `[the(box.first)]`. A word→function rename (`a` → indefinite) keeps `[a + b]` with a local `a`
// untouched (three tokens, no match) while `[a apple]` desugars to `indefinite(apple)`.
function desugarOperandSugar(src, sugarMap) {
    const m = src.match(/^([A-Za-z']+)\s+([A-Za-z_]\S*)$/);
    if (!m) return src;
    const word = m[1];
    const operand = m[2];
    const native = sugarNative(word.toLowerCase(), sugarMap, "operand");
    if (!native) return src;
    const call = `${native}(${operand})`;
    return word === word.toLowerCase() ? call : `cap(${call})`;
}

// Paragraph-control marker phrases (H1/H2/H3) → their lib/sys output-stream calls.
// `[run on]` is an alias for `[no break]` (both cancel a pending break). These are
// matched before the bare-word sugar so `[par]` is not read as an object reference.
const MARKER_CALLS = {
    "line break": "line_break()",
    "par": "paragraph()",
    "paragraph break": "paragraph()",
    "no break": "no_break()",
    "run on": "no_break()",
    "par if printed": "par_if_printed()",
};

// The closed style vocabulary (must mirror the runtime's STYLE_ORDER): the three
// type styles + the 16 ANSI/Z-machine foreground colors. Each marker desugars to
// the same-named lib/sys wrapping function.
const STYLE_MARKER_NAMES = new Set([
    "bold", "italic", "fixed",
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "bright_black", "bright_red", "bright_green", "bright_yellow",
    "bright_blue", "bright_magenta", "bright_cyan", "bright_white",
    "fit",
]);

// Classifies a substitution source as an inline-conditional control marker (E1-E4)
// or null for an ordinary value/sugar substitution. Markers are the leading words
// `if` / `else if` / `else` / `end` (with `otherwise` as an `else` alias and an
// optional `end if`); the condition is the remaining Lamp boolean expression. These
// are control words only at the START of a substitution, so a value expression is
// never misread. See devdocs/text.md E.
function classifyControl(src) {
    let m;
    if ((m = src.match(/^(?:else\s+if|otherwise\s+if)\b\s*(.*)$/))) return { type: "elif", cond: m[1].trim() };
    if (/^(?:else|otherwise)$/.test(src)) return { type: "else" };
    if (/^end(?:\s+if)?$/.test(src)) return { type: "end" };
    if ((m = src.match(/^if\b\s*(.*)$/))) return { type: "if", cond: m[1].trim() };
    // [first time]…[only] (F9): show the enclosed text on the first render of this
    // site, then nothing. See devdocs/text.md F9.
    if (/^first\s+time$/.test(src)) return { type: "firsttime" };
    if (/^only$/.test(src)) return { type: "only" };
    // [one of]ALT[or]ALT…[MODE] (F1-F6): choose one alternative per render by the
    // closing mode word. See devdocs/text.md F1-F6.
    if (/^one\s+of$/.test(src)) return { type: "oneof" };
    if (/^or$/.test(src)) return { type: "or" };
    if (/^purely\s+at\s+random$/.test(src)) return { type: "mode", mode: "purely" };
    if (/^at\s+random$/.test(src)) return { type: "mode", mode: "random" };
    if (/^in\s+random\s+order$/.test(src)) return { type: "mode", mode: "shuffled" };
    if (/^sticky\s+random$/.test(src)) return { type: "mode", mode: "sticky" };
    if (/^cycling$/.test(src)) return { type: "mode", mode: "cycling" };
    if (/^stopping$/.test(src)) return { type: "mode", mode: "stopping" };
    if (/^as\s+decreasingly\s+likely\s+outcomes$/.test(src)) return { type: "mode", mode: "decreasing" };
    // Style spans (I3, Slice 7): [bold]…[/bold] etc. desugar to the same-named
    // lib/sys wrapping functions — the three type styles plus the ANSI/Z-machine
    // color names (see STYLE_MARKER_NAMES below). Unlike the conditional/variation
    // blocks, these nest — their named close tags keep the pairing readable.
    // Long-form spellings only: single-letter [b]/[i] would collide with bare
    // variable prints ([i] is the obvious loop index), so they are not sugar. The
    // explicit call form `[fixed(x)]` is unaffected (it carries parens, so it
    // never reaches here). Note the style words shadow bare-name substitutions of
    // the same spelling — an object named `red` can't be printed as `[red]` (use
    // `[the red]` or a different name). See devdocs/text.md I3.
    if (STYLE_MARKER_NAMES.has(src)) return { type: "styleOpen", name: src };
    if (src.startsWith("/") && STYLE_MARKER_NAMES.has(src.slice(1))) {
        return { type: "styleClose", name: src.slice(1) };
    }
    // [s] plural suffix (G7): pluralizes the preceding word by the governing count.
    if (/^s$/.test(src)) return { type: "plural" };
    return null;
}

// Rewrites one substitution's source through the natural-language sugar layer:
// `[regarding EXPR]` sets the render subject (D5); a bare pronoun word becomes its
// locale call (D1/D2); a declared verb word becomes a conjugate() call agreeing
// with the subject (D3); otherwise the article sugar (B3-B5) applies, and anything
// it does not match is returned verbatim as an ordinary expression.
function desugarSugar(src, verbNames, sugarMap) {
    // Paragraph-control markers (H1/H2/H3): inline substitutions that desugar to the
    // lib/sys output-stream functions. See devdocs/text.md H.
    if (MARKER_CALLS[src]) return MARKER_CALLS[src];
    const regarding = src.match(/^regarding\s+(\S.*)$/);
    if (regarding) {
        // `[regarding the player]` names the player *object* — the article word is
        // decorative (Inform writes it this way), so strip a leading the/a/an and
        // pass the bare reference; regarding() needs the object, not its name.
        const operand = regarding[1].trim().replace(/^(the|a|an)\s+/i, "");
        return `regarding(${operand})`;
    }
    // [is LIST] / [is the LIST] / [is a LIST] (G3): the copula agreeing with the
    // list's size ("is" for empty/singular, "are" for 2+) followed by the list
    // rendered with no / definite / indefinite articles. The verb word is decorative
    // — agreement is by count — so `are` leads equivalently; a capitalized lead word
    // ([Is …]) capitalizes for a sentence start. See devdocs/text.md G3.
    const isAre = src.match(/^(is|are)\s+(\S.*)$/i);
    if (isAre) {
        let rest = isAre[2].trim();
        let helper = "is_are_list";
        let article;
        if ((article = rest.match(/^the\s+(\S.*)$/i))) { helper = "is_are_the_list"; rest = article[1].trim(); }
        else if ((article = rest.match(/^an?\s+(\S.*)$/i))) { helper = "is_are_a_list"; rest = article[1].trim(); }
        const call = `${helper}(${rest})`;
        return /^[A-Z]/.test(isAre[1]) ? `cap(${call})` : call;
    }
    // Letters, plus a straight apostrophe so contraction sugar (`[we're]`, `[don't]`, D9)
    // is a single bare word alongside the pronouns/verbs. Accented Latin letters are
    // admitted so a locale's verb/sugar vocabulary isn't limited to ASCII (`[être]`);
    // words that match nothing fall through to the operand path exactly as before.
    if (/^[A-Za-z'À-ɏ]+$/.test(src)) {
        const lower = src.toLowerCase();
        const wrap = (call) => (src === lower ? call : `cap(${call})`);
        const native = sugarNative(lower, sugarMap, "bare");
        if (native) return wrap(`${native}()`);
        if (verbNames.has(src) || verbNames.has(lower)) return wrap(`conjugate("${lower}")`);
    }
    return desugarOperandSugar(src, sugarMap);
}

// Splits a string-literal value (in expression position) into template parts: an
// ordered list of { kind: "text", value } literals and { kind: "exprSrc", src }
// substitutions. The tokenizer has already resolved \n \t \r \" \\, but `\[` and
// `\]` survive as backslash-bracket (brackets are not tokenizer escapes), so this
// is where they become literal `[` / `]`. An unescaped `[` opens a substitution
// running to the next unescaped `]`; the inner source is an embedded Lamp
// expression the caller parses, except `[']` which is the literal-apostrophe form.
// Literal text runs pass through applyQuoteConvention; the forced `[']` does not.
// `hasSub` is false when there is no expression substitution (a plain string,
// possibly with `[']`/escaped brackets), so the caller keeps a StringLiteral.
function splitTemplate(rawValue, fail) {
    const parts = [];
    let text = "";
    let hasSub = false;
    let i = 0;
    const flush = () => {
        if (text.length > 0) {
            parts.push({ kind: "text", value: applyQuoteConvention(text) });
            text = "";
        }
    };
    while (i < rawValue.length) {
        const c = rawValue[i];
        if (c === "\\" && (rawValue[i + 1] === "[" || rawValue[i + 1] === "]")) {
            text += rawValue[i + 1];
            i += 2;
            continue;
        }
        if (c === "[") {
            i += 1;
            let src = "";
            while (i < rawValue.length && rawValue[i] !== "]") {
                src += rawValue[i];
                i += 1;
            }
            if (i >= rawValue.length) {
                throw fail("unterminated '[' substitution in string literal (use \\[ for a literal bracket)");
            }
            i += 1;
            const trimmed = src.trim();
            if (trimmed === "'") {
                flush();
                parts.push({ kind: "text", value: "'" });
                continue;
            }
            if (trimmed.length === 0) {
                throw fail("empty '[]' substitution in string literal");
            }
            flush();
            parts.push({ kind: "exprSrc", src: trimmed });
            hasSub = true;
            continue;
        }
        text += c;
        i += 1;
    }
    flush();
    if (parts.length === 0) {
        parts.push({ kind: "text", value: "" });
    }
    return { parts, hasSub };
}

function createParser(tokens, filePath, globalNames, functionNames = new Set(), relationNames = new Set(), relationTemplates = new Map(), actionNames = new Set(), objectNames = new Set(), tagNames = new Set(), rulebookParams = new Map(), verbNames = new Set(), typeNames = new Set(), fieldNames = new Set(), sugarMap = new Map()) {
    let pos = 0;
    // Nested/reference object placements (`item hook:` inside a room body) parse to
    // hoisted top-level nodes — the nested ObjectDecl plus a `contains` placement —
    // collected here and drained into the program by parseProgram after each
    // top-level declaration. See parseObjectBody.
    const hoisted = [];

    const peek = (offset = 0) => tokens[pos + offset];
    const next = () => tokens[pos++];
    const at = (type) => peek().type === type;
    const atKeyword = (value) => peek().type === "KEYWORD" && peek().value === value;

    // A phase-rule selector begins with `(`, `not`, `any`, a declared action, or a
    // known tag. Used to recognize `BAND SELECTOR:` at the top level.
    const selectorStartsAt = (offset) => {
        const t = peek(offset);
        if (t.type === "LPAREN") return true;
        if (t.type === "KEYWORD" && t.value === "not") return true;
        if (t.type === "IDENT") {
            return t.value === "any" || actionNames.has(t.value) || tagNames.has(t.value);
        }
        return false;
    };

    function err(message, line) {
        return syntaxError(filePath, line !== undefined ? line : peek().line, message);
    }

    function expect(type, message) {
        if (peek().type !== type) {
            throw err(message || `Expected ${type}, got ${peek().type}`);
        }
        return next();
    }

    function expectKeyword(value) {
        if (!atKeyword(value)) {
            throw err(`Expected '${value}'`);
        }
        return next();
    }

    const expectNewline = () => expect("NEWLINE", "Expected end of line");

    // A plain identifier: locals, loop vars, type/kind/field/event/lib names.
    // No coercion; must be JavaScript-safe (rejects '-' and the '\_' escape).
    function plainName(what) {
        const token = peek();
        if (token.type !== "IDENT") {
            throw err(`Expected ${what}`, token.line);
        }
        next();
        if (!JS_IDENT.test(token.value)) {
            throw err(`${what} must be a plain identifier: ${token.value}`, token.line);
        }
        return token.value;
    }

    // A coerced name: object names, global names. Underscores become spaces;
    // a leading/trailing separator is rejected (it would coerce to leading or
    // trailing whitespace).
    function coercedName(what) {
        const token = peek();
        if (token.type !== "IDENT") {
            throw err(`Expected ${what}`, token.line);
        }
        next();
        const raw = token.value;
        if (raw[0] === "_" || raw[raw.length - 1] === "_") {
            throw err(`${what} may not begin or end with a separator: ${raw}`, token.line);
        }
        return coerceName(raw);
    }

    function parseProgram() {
        const nodes = [];
        while (!at("EOF")) {
            nodes.push(parseDeclaration());
            // Nested object declarations + their `contains` placements parsed inside
            // the just-finished declaration's body are hoisted to top level here.
            while (hoisted.length > 0) nodes.push(hoisted.shift());
        }
        return ast.createProgram(nodes);
    }

    function parseDeclaration() {
        const token = peek();
        if (token.type === "KEYWORD") {
            switch (token.value) {
                case "type": return parseTypeDecl();
                case "relation": return parseRelationDecl();
                case "bidi": return parseBidiAssert();
                case "remove": return parseRemoveStatement(new Set());
                case "disconnect": return parseDisconnectStatement();
                case "kind": return parseKindDecl();
                case "global": return parseGlobalDecl();
                case "on": return parseOnHandler();
                case "lib": return parseLibImport();
                case "locale": return parseLocaleDecl();
                case "not_for_release": return parseNotForReleaseDecl();
                case "function": return parseFunctionDecl();
                case "native": return parseNativeFunctionDecl();
                case "rulebook": return parseRulebookDecl();
                case "action": return parseActionDecl();
                case "verb": return parseVerbDecl();
                case "sugar": return parseSugarDecl();
                default: throw err(`Unexpected '${token.value}' at top level`);
            }
        }
        if (token.type === "IDENT") {
            // Message override: `NAME: "TEXT"` at top level overrides the named
            // message (e.g. a translation pack). See devdocs/messages.md.
            if (peek(1).type === "COLON" && peek(2).type === "STRING") return parseMessageOverride();
            if (token.value === "rule" && peek(1).type === "IDENT" && rulebookParams.has(peek(1).value)) return parseRulebookRule();
            if (PHASE_WORDS.has(token.value) && selectorStartsAt(1)) return parsePhaseRule();
            // `report failed SELECTOR:` — the failure-reporting band.
            if (token.value === "report" && peek(1).type === "IDENT" && peek(1).value === "failed"
                && selectorStartsAt(2)) return parsePhaseRule();
            if (token.value === "understand" && peek(1).type === "STRING") return parseUnderstandDecl();
            if (relationNames.has(token.value) && peek(1).type === "COLON") return parseRelationAssert();
            if (relationTemplates.has(token.value)) return parseCustomSyntaxAssert(relationTemplates.get(token.value), null);
            if (peek(1).type === "IDENT" && relationTemplates.has(peek(1).value)) return parseNamedCustomSyntaxAssert();
            // `image NAME: file "PATH"` — an asset declaration (devdocs/freestyle-windows.md).
            // Dispatched on the exact shape (contextual — `image` is not a keyword), so a
            // game that declares its own `type image` keeps its object declarations.
            if (token.value === "image" && peek(1).type === "IDENT" && peek(2).type === "COLON"
                && peek(3).type === "IDENT" && peek(3).value === "file" && peek(4).type === "STRING") {
                return parseImageDecl();
            }
            return peek(1).type === "EQUALS" ? parseGlobalAssign() : parseObjectDecl();
        }
        throw err(`Unexpected token at top level: ${token.type}`);
    }

    // `understand "TEMPLATE" as ACTION` — a standalone grammar contribution. Both
    // `understand` and `as` tokenize as IDENTs (contextual), so this is only a
    // declaration at top level; `understand "x"` inside an object body is an
    // ordinary field assignment parsed elsewhere.
    function parseUnderstandDecl() {
        const kw = next();
        const template = expect("STRING", "Expected a syntax template string after 'understand'");
        if (!(at("IDENT") && peek().value === "as")) {
            throw err("Expected 'as <action>' after the understand template");
        }
        next();
        const actionName = plainName("action name");
        expectNewline();
        return ast.createUnderstandDecl(template.value, actionName, filePath, kw.line);
    }

    // `NAME: "TEXT"` — overrides the named message's text (e.g. a translation pack).
    // The text is a template like any other; it compiles in top-level scope, so it
    // may reference `act`/globals/objects but not a lexical `self`/local.
    function parseMessageOverride() {
        const nameTok = next();
        expect("COLON", "Expected ':' in message override");
        const strTok = next();
        const overrideExpr = parseStringExpr(strTok, new Set());
        expectNewline();
        return ast.createMessageOverride(nameTok.value, overrideExpr, filePath, nameTok.line);
    }

    function parseTypeDecl() {
        const keyword = expectKeyword("type");
        const name = plainName("type name");
        const parents = [];
        if (at("LT")) {
            next();
            parents.push(plainName("parent type name"));
            while (at("COMMA")) {
                next();
                parents.push(plainName("parent type name"));
            }
        }
        let fields = [];
        if (at("COLON")) {
            next();
            expectNewline();
            fields = parseTypeBody();
        } else {
            expectNewline();
        }
        return ast.createTypeDecl(name, parents, fields, filePath, keyword.line);
    }

    function parseTypeBody() {
        expect("INDENT", "Expected an indented block");
        const fields = [];
        while (!at("DEDENT")) {
            const fieldType = parseFieldType();
            const fieldName = plainName("field name");
            let defaultValue = null;
            if (at("EQUALS")) {
                next();
                defaultValue = parseSimpleValue();
            }
            expectNewline();
            fields.push(ast.createFieldDecl(fieldType, fieldName, defaultValue));
        }
        next();
        return fields;
    }

    function parseRelationDecl() {
        const keyword = expectKeyword("relation");
        const name = plainName("relation name");
        expect("COLON", "Expected ':' after relation name");
        expectNewline();
        const { fields, syntax, invertedFields, uniqueFields, sourceField, targetField } = parseRelationBody(keyword.line);
        return ast.createRelationDecl(name, fields, syntax, invertedFields, sourceField, targetField, uniqueFields, filePath, keyword.line);
    }

    // A relation body holds field declarations plus an optional `syntax "..."`
    // line. Each field line may be prefixed with `from` (marks the source endpoint)
    // or `to` (marks the target endpoint); exactly one of each is required.
    // `inverted`, `unique`, and `syntax` are contextual keywords (tokenize as
    // IDENTs). A field marked `inverted` must have a type that declares an
    // `inverse` field, used when computing the mechanical reverse of a bidi
    // relation. A field marked `unique` is a cardinality key: at most one edge may
    // exist per distinct value of that field, so asserting a new edge evicts any
    // existing edge sharing the value (one-to-many containment). Both tags may
    // follow the field name in either order.
    function parseRelationBody(declLine) {
        expect("INDENT", "Expected an indented block");
        const fields = [];
        const invertedFields = [];
        const uniqueFields = [];
        let syntax = null;
        let sourceField = null;
        let targetField = null;
        while (!at("DEDENT")) {
            if (at("IDENT") && peek().value === "syntax" && peek(1).type === "STRING") {
                next();
                const template = expect("STRING", "Expected syntax template string");
                expectNewline();
                syntax = template.value;
                continue;
            }
            let isSource = false;
            let isTarget = false;
            if (atKeyword("from")) {
                next();
                isSource = true;
            } else if (atKeyword("to")) {
                next();
                isTarget = true;
            }
            const fieldType = parseFieldType();
            const fieldName = plainName("field name");
            while (at("IDENT") && (peek().value === "inverted" || peek().value === "unique")) {
                if (next().value === "inverted") invertedFields.push(fieldName);
                else uniqueFields.push(fieldName);
            }
            expectNewline();
            if (isSource) sourceField = fieldName;
            if (isTarget) targetField = fieldName;
            fields.push(ast.createFieldDecl(fieldType, fieldName));
        }
        next();
        if (sourceField === null || targetField === null) {
            throw err("a relation must declare exactly one 'from' field and one 'to' field", declLine);
        }
        return { fields, syntax, invertedFields, uniqueFields, sourceField, targetField };
    }

    // `bidi RELATION ...` — a bidirectional assertion. Parses the following
    // block- or custom-syntax assertion and marks it bidirectional.
    function parseBidiAssert() {
        expectKeyword("bidi");
        const token = peek();
        if (token.type !== "IDENT") {
            throw err("Expected a relation assertion after 'bidi'", token.line);
        }
        let node;
        if (relationNames.has(token.value) && peek(1).type === "COLON") {
            node = parseRelationAssert();
        } else if (relationTemplates.has(token.value)) {
            node = parseCustomSyntaxAssert(relationTemplates.get(token.value), null);
        } else {
            throw err(`'${token.value}' is not a relation`, token.line);
        }
        node.bidi = true;
        return node;
    }

    // `remove RELATION ...` — remove all matching instances. Dispatches to
    // block form or custom-syntax form, same as assertion. Slots may be `_`.
    function parseRemoveStatement(localNames) {
        const keyword = expectKeyword("remove");
        const token = peek();
        if (token.type !== "IDENT") {
            throw err("Expected a relation name after 'remove'", token.line);
        }
        if (relationNames.has(token.value) && peek(1).type === "COLON") {
            return parseBlockFormRemove(keyword.line, localNames);
        }
        if (relationTemplates.has(token.value)) {
            return parseCustomSyntaxRemove(relationTemplates.get(token.value), keyword.line, localNames);
        }
        throw err(`'${token.value}' is not a relation`, token.line);
    }

    // Block-form remove: `remove RELATION_NAME:` + indented body of field/value lines.
    // Slot values may be `_` wildcard.
    function parseBlockFormRemove(keywordLine, localNames) {
        const nameToken = peek();
        const relationName = plainName("relation name");
        expect("COLON", "Expected ':' after relation name in remove");
        expectNewline();
        expect("INDENT", "Expected an indented block");
        const fields = [];
        while (!at("DEDENT")) {
            const slotToken = peek();
            const fieldName = plainName("field name");
            const value = parseRelationRemoveSlot(localNames);
            expectNewline();
            fields.push(ast.createFieldAssign(fieldName, value, filePath, slotToken.line));
        }
        next();
        return ast.createRelationRemove(relationName, fields, filePath, keywordLine);
    }

    // Custom-syntax remove driven by the relation's `syntax` template. Literals
    // must match verbatim; slot positions may be `_` wildcard or a simple value.
    function parseCustomSyntaxRemove(template, keywordLine, localNames) {
        next(); // consume leading literal (matched by dispatch)
        const fields = [];
        for (let i = 1; i < template.parts.length; i += 1) {
            const part = template.parts[i];
            if (part.kind === "literal") {
                const token = peek();
                if ((token.type === "IDENT" || token.type === "KEYWORD") && token.value === part.text) {
                    next();
                } else {
                    throw err(`Expected '${part.text}' in ${template.relationName} remove`, token.line);
                }
            } else {
                const slotToken = peek();
                const value = parseRelationRemoveSlot(localNames);
                fields.push(ast.createFieldAssign(part.field, value, filePath, slotToken.line));
            }
        }
        expectNewline();
        return ast.createRelationRemove(template.relationName, fields, filePath, keywordLine);
    }

    // A slot value in a `remove` statement: `_` wildcard, or a variable/global/
    // literal/property-access (same atoms as a query slot, no `?` output marker).
    function parseRelationRemoveSlot(localNames) {
        if (at("IDENT") && peek().value === "_") {
            next();
            return ast.createWildcardExpr();
        }
        const token = next();
        if (token.type === "NUMBER") return ast.createNumberLiteral(token.value);
        if (token.type === "STRING") return ast.createStringLiteral(token.value);
        if (token.type === "IDENT") {
            const expr = parseIdentExpr(token, localNames);
            if (expr.kind === "CallExpr") {
                throw err("function calls are not allowed in a remove slot", token.line);
            }
            return expr;
        }
        throw err(`Expected a value or '_' in remove slot`, token.line);
    }

    // `disconnect NAME` — remove a named relation instance by name.
    function parseDisconnectStatement() {
        const keyword = expectKeyword("disconnect");
        const name = coercedName("instance name");
        expectNewline();
        return ast.createDisconnectStatement(name, filePath, keyword.line);
    }

    // Block-form anonymous assertion: `RELATION_NAME:` followed by an indented
    // body of `FIELD_NAME VALUE` lines (same shape as an object body).
    function parseRelationAssert() {
        const nameToken = peek();
        const relationName = plainName("relation name");
        expect("COLON", "Expected ':' after relation name");
        expectNewline();
        const fields = parseObjectBody();
        return ast.createRelationAssert(relationName, fields, null, filePath, nameToken.line);
    }

    // `NAME connects foyer north hall` — instance name comes first, then the
    // custom-syntax template. The name token has already been peeked; consume it,
    // then delegate to parseCustomSyntaxAssert with the name pre-provided.
    function parseNamedCustomSyntaxAssert(localNames) {
        const nameToken = peek();
        const instanceName = coercedName("relation instance name");
        const template = relationTemplates.get(peek().value);
        return parseCustomSyntaxAssert(template, instanceName, nameToken.line);
    }

    // Custom-syntax assertion driven by a relation's `syntax` template. Literal
    // parts must match verbatim (IDENT or KEYWORD tokens both allowed, so a
    // reserved word like `to` may appear as a literal); slot parts consume one
    // value. When localNames is provided (statement body context), slot values
    // may be property-access chains such as `self.actor`; at top level they are
    // plain object names. Produces the same RelationAssert node as the block form.
    function parseCustomSyntaxAssert(template, instanceName, headLine, localNames = null) {
        const headToken = peek();
        if (headLine === undefined) headLine = headToken.line;

        next(); // leading literal (matched by dispatch)

        const fields = [];
        for (let i = 1; i < template.parts.length; i += 1) {
            const part = template.parts[i];
            if (part.kind === "literal") {
                const token = peek();
                if ((token.type === "IDENT" || token.type === "KEYWORD") && token.value === part.text) {
                    next();
                } else {
                    throw err(`Expected '${part.text}' in ${template.relationName} assertion`, token.line);
                }
            } else {
                const valueToken = peek();
                let value;
                if (localNames !== null && valueToken.type === "IDENT"
                        && valueToken.value !== "true" && valueToken.value !== "false"
                        && valueToken.value !== "none") {
                    next();
                    value = parseIdentExpr(valueToken, localNames);
                } else {
                    value = parseSimpleValue();
                }
                fields.push(ast.createFieldAssign(part.field, value, filePath, valueToken.line));
            }
        }
        expectNewline();
        return ast.createRelationAssert(template.relationName, fields, instanceName, filePath, headLine);
    }

    // A relation query in expression position. The leading literal has already
    // been consumed by parseNud. Each slot is an atom (`_` wildcard, literal,
    // object name, variable/global, or property-access chain) — not a full
    // expression — so operators and indexing terminate the slot naturally and
    // function calls are explicitly rejected.
    function parseRelationQuery(template, localNames, headLine) {
        const fields = [];
        let outputField = null;
        let outputMode = null;
        for (let i = 1; i < template.parts.length; i += 1) {
            const part = template.parts[i];
            if (part.kind === "literal") {
                const token = peek();
                if ((token.type === "IDENT" || token.type === "KEYWORD") && token.value === part.text) {
                    next();
                } else {
                    throw err(`Expected '${part.text}' in ${template.relationName} query`, token.line);
                }
            } else {
                const slot = parseRelationSlot(localNames, template.relationName);
                if (slot.kind === "OutputSlot") {
                    if (outputField !== null) {
                        throw err(`a ${template.relationName} query may have only one '?' output slot`, headLine);
                    }
                    outputField = part.field;
                    outputMode = slot.mode;
                    fields.push({ fieldName: part.field, value: ast.createWildcardExpr() });
                } else {
                    fields.push({ fieldName: part.field, value: slot });
                }
            }
        }
        return ast.createRelationQuery(template.relationName, fields, outputField, outputMode, filePath, headLine);
    }

    function parseRelationSlot(localNames, relationName) {
        if (at("QUESTION")) {
            next();
            let mode = "all";
            if (at("IDENT") && (peek().value === "all" || peek().value === "first" || peek().value === "only")) {
                mode = next().value;
            }
            return ast.createOutputSlot(mode);
        }
        if (at("IDENT") && peek().value === "_") {
            next();
            return ast.createWildcardExpr();
        }
        const token = next();
        if (token.type === "NUMBER") return ast.createNumberLiteral(token.value);
        if (token.type === "STRING") return ast.createStringLiteral(token.value);
        if (token.type === "IDENT") {
            const expr = parseIdentExpr(token, localNames);
            if (expr.kind === "CallExpr") {
                throw err(`function calls are not allowed in a ${relationName} query slot`, token.line);
            }
            return expr;
        }
        throw err(`Expected a value, '_', or '?' in ${relationName} query`, token.line);
    }

    function parseFieldType() {
        if (atKeyword("function")) {
            next();
            return "function";
        }
        const base = plainName("type name");
        if (at("LT")) {
            next();
            const inner = plainName("type name");
            expect("GT", "Expected '>' to close list type");
            return `${base}<${inner}>`;
        }
        return base;
    }

    function parseObjectDecl() {
        const headLine = peek().line;
        const typeName = plainName("object type");
        const objectName = coercedName("object name");
        let fields = [];
        if (at("COLON")) {
            next();
            expectNewline();
            fields = parseObjectBody(objectName);
        } else {
            expectNewline();
        }
        return ast.createObjectDecl(typeName, objectName, fields, filePath, headLine);
    }

    // An object body is a list of `FIELD VALUE` lines. A `TYPE NAME` line — leading
    // token a known **type** that is **not** a known **field name** — is instead a
    // **nested object placement** inside `containerName` via the `contains` relation
    // (smart disambiguation: `item hook` places a hook, but `article proper` stays a
    // field assignment because `article` is also a field, even though it is a type).
    // With a `:` body it declares a fresh object (which may nest further); bodyless,
    // it emits an empty declaration that object *reopening* merges with the real one
    // if the name is declared elsewhere — so a bare `item gizmo` works as both a
    // fieldless leaf and a reference to an existing object. Either way it desugars to
    // a hoisted ObjectDecl plus a hoisted `contains containerName NAME` placement.
    function parseObjectBody(containerName) {
        expect("INDENT", "Expected an indented block");
        const fields = [];
        while (!at("DEDENT")) {
            const head = peek();
            if (head.type === "IDENT" && typeNames.has(head.value) && !fieldNames.has(head.value)
                    && peek(1).type === "IDENT") {
                const headLine = head.line;
                if (peek(2) && peek(2).type === "COLON") {
                    const decl = parseObjectDecl();
                    hoisted.push(decl);
                    hoisted.push(buildContainsPlacement(containerName, decl.objectName, headLine));
                } else {
                    const typeName = head.value;
                    next();
                    const childName = coercedName("object name");
                    expectNewline();
                    hoisted.push(ast.createObjectDecl(typeName, childName, [], filePath, headLine));
                    hoisted.push(buildContainsPlacement(containerName, childName, headLine));
                }
                continue;
            }
            const nameToken = peek();
            const fieldName = plainName("field name");
            // Bare boolean shorthand: `wearable` (a field name with no value) means
            // `wearable true`. A non-bool field given the bare form is rejected by the
            // checker (it sees `= true` against, e.g., a string field).
            const value = at("NEWLINE") ? ast.createBooleanLiteral(true) : parseSimpleValue();
            expectNewline();
            fields.push(ast.createFieldAssign(fieldName, value, filePath, nameToken.line));
        }
        next();
        return fields;
    }

    // Builds the `contains containerName childName` assertion that places a nested
    // object. Uses the registered `contains` template's two slots (container first,
    // contained second — the conventional `contains [place] [contained]` order), so
    // the emitted node is identical to a hand-written `contains` assertion.
    function buildContainsPlacement(containerName, childName, line) {
        const template = relationTemplates.get("contains");
        if (!template || template.relationName !== "contains") {
            throw err("nested object placement requires a 'contains' relation in scope", line);
        }
        const slots = template.parts.filter((part) => part.kind !== "literal");
        if (slots.length !== 2) {
            throw err("nested placement needs a 'contains' relation with exactly two slots", line);
        }
        const fields = [
            ast.createFieldAssign(slots[0].field, ast.createStringLiteral(containerName), filePath, line),
            ast.createFieldAssign(slots[1].field, ast.createStringLiteral(childName), filePath, line),
        ];
        return ast.createRelationAssert("contains", fields, null, filePath, line);
    }

    // Like parseObjectBody but accepts property-access chains (e.g. `self.actor`)
    // in value positions when localNames is provided. Used for `try` blocks and
    // block-form relation assertions inside action bodies.
    function parseExprBody(localNames) {
        expect("INDENT", "Expected an indented block");
        const fields = [];
        while (!at("DEDENT")) {
            const nameToken = peek();
            const fieldName = plainName("field name");
            const valueToken = peek();
            let value;
            if (valueToken.type === "IDENT"
                    && valueToken.value !== "true" && valueToken.value !== "false"
                    && valueToken.value !== "none") {
                const token = next();
                value = parseIdentExpr(token, localNames);
            } else {
                value = parseSimpleValue();
            }
            expectNewline();
            fields.push(ast.createFieldAssign(fieldName, value, filePath, nameToken.line));
        }
        next();
        return fields;
    }

    // Object-field and global values are literals or a bare object reference,
    // never full expressions (mirrors the legacy parseSimpleValue) — except a
    // quoted string may carry `[expr]` substitutions, becoming a TemplateLiteral
    // (`text`) here just as in expression position. Embedded expressions see only
    // file-level names (globals/objects/functions); there is no local or `self`
    // scope at a field/global default, so an empty local set is passed.
    function parseSimpleValue() {
        const token = next();
        if (token.type === "NUMBER") return ast.createNumberLiteral(token.value);
        if (token.type === "STRING") return parseStringExpr(token, new Set());
        if (token.type === "IDENT") {
            if (token.value === "true") return ast.createBooleanLiteral(true);
            if (token.value === "false") return ast.createBooleanLiteral(false);
            if (token.value === "none") return ast.createNoneLiteral();
            if (token.value === "_") throw err("'_' is only valid as a wildcard in a relation query", token.line);
            return ast.createStringLiteral(coerceName(token.value));
        }
        throw err(`Expected a value, got ${token.type}`, token.line);
    }

    function parseGlobalDecl() {
        const keyword = expectKeyword("global");
        const typeName = parseFieldType();
        const name = coercedName("global name");
        let value;
        if (at("EQUALS")) {
            next();
            value = parseSimpleValue();
        } else {
            value = ast.createNoneLiteral();
        }
        expectNewline();
        return ast.createGlobalDecl(name, typeName, value, filePath, keyword.line);
    }

    function parseGlobalAssign() {
        const nameToken = peek();
        const name = coercedName("global name");
        expect("EQUALS");
        const value = parseSimpleValue();
        expectNewline();
        return ast.createGlobalAssign(name, value, filePath, nameToken.line);
    }

    // `image NAME: file "PATH"` (inline only). The name is a plain identifier,
    // uncoerced — it is a registry key referenced by string from canvas_image, so
    // what the author declares is exactly what they write in the reference (the
    // kind-name precedent, not the object-name coercion).
    function parseImageDecl() {
        const first = next();
        const name = plainName("image name");
        expect("COLON");
        next();
        const pathToken = expect("STRING", "Expected image file path string");
        expectNewline();
        return ast.createImageDecl(name, pathToken.value, filePath, first.line);
    }

    function parseKindDecl() {
        expectKeyword("kind");
        const name = plainName("kind name");
        expect("EQUALS");
        const kindExpr = parseKindExpr();
        expectNewline();
        return ast.createKindDecl(name, kindExpr);
    }

    function parseKindExpr() {
        const ctor = peek();
        if (ctor.type === "IDENT" && ctor.value === "enum") {
            next();
            expect("LPAREN", "Expected '(' after enum");
            const labels = [];
            if (!at("RPAREN")) {
                labels.push(plainName("enum label"));
                while (at("COMMA")) {
                    next();
                    labels.push(plainName("enum label"));
                }
            }
            expect("RPAREN", "Expected ')' to close enum");
            return ast.createEnumExpr(labels);
        }
        throw err("Unsupported kind expression", ctor.line);
    }

    function parseOnHandler() {
        expectKeyword("on");
        const first = plainName("event or type name");
        if (at("DOT")) {
            next();
            const fieldName = plainName("field name");
            expectKeyword("change");
            expect("COLON", "Expected ':' after change handler header");
            expectNewline();
            const body = parseBlock(new Set(["self"]));
            return ast.createChangeHandler(first, fieldName, body);
        }
        if (at("IDENT") && peek().value === "add") {
            next();
            expect("COLON", "Expected ':' after 'add'");
            expectNewline();
            const body = parseBlock(new Set(["self"]));
            return ast.createRelationAddHandler(first, body);
        }
        if (atKeyword("remove")) {
            next();
            expect("COLON", "Expected ':' after 'remove'");
            expectNewline();
            const body = parseBlock(new Set(["self"]));
            return ast.createRelationRemoveHandler(first, body);
        }
        expect("COLON", "Expected ':' after event name");
        expectNewline();
        const body = parseBlock(new Set());
        return ast.createEventHandler(first, body);
    }

    function parseLibImport() {
        expectKeyword("lib");
        const name = plainName("library name");
        expectNewline();
        return ast.createLibImport(name);
    }

    // `locale "fr-FR"` — the tag is a quoted string (locale tags carry a hyphen,
    // which is not a valid identifier). Compile-time only; the --locale flag
    // overrides it. The directive node is inert at emit.
    function parseLocaleDecl() {
        expectKeyword("locale");
        const tag = expect("STRING", "Expected a quoted locale tag after 'locale'");
        expectNewline();
        return ast.createLocaleDecl(tag.value);
    }

    // `not_for_release` on its own line marks the whole file as debug-only (excluded by a
    // `--release` build). Inert when present in a normal build. See specs.md.
    function parseNotForReleaseDecl() {
        expectKeyword("not_for_release");
        expectNewline();
        return ast.createNotForReleaseDecl();
    }

    function parseNativeFunctionDecl() {
        const keyword = expectKeyword("native");
        expectKeyword("function");
        const returnType = parseFieldType();
        const name = plainName("function name");
        expect("LPAREN", "Expected '(' after function name");
        const params = [];
        if (!at("RPAREN")) {
            params.push(parseFunctionParam());
            while (at("COMMA")) {
                next();
                params.push(parseFunctionParam());
            }
        }
        expect("RPAREN", "Expected ')' to close parameter list");
        expectNewline();
        return ast.createNativeFunctionDecl(name, returnType, params, filePath, keyword.line);
    }

    function parseFunctionDecl() {
        const keyword = expectKeyword("function");
        const returnType = parseFieldType();
        const name = plainName("function name");
        expect("LPAREN", "Expected '(' after function name");
        const params = [];
        if (!at("RPAREN")) {
            params.push(parseFunctionParam());
            while (at("COMMA")) {
                next();
                params.push(parseFunctionParam());
            }
        }
        expect("RPAREN", "Expected ')' to close parameter list");
        const paramLocals = new Set(params.map((p) => p.name));
        let whenExpr = null;
        if (atKeyword("when")) {
            next();
            // Parse the guard with the parameter names in scope so a guard that
            // references one parses as a variable reference — which the checker then
            // rejects with a clear error (guards may not reference parameters) —
            // instead of the name silently falling through to the string-literal
            // fallback and the overload never firing.
            whenExpr = parseExpression(0, paramLocals);
        }
        expect("COLON", "Expected ':' after function header");
        expectNewline();
        const body = parseBlock(paramLocals);
        return ast.createFunctionDecl(name, returnType, params, whenExpr, body, filePath, keyword.line);
    }

    function parseFunctionParam() {
        const typeName = parseFieldType();
        const name = plainName("parameter name");
        return { typeName, name };
    }

    // `action NAME:` declares an action type whose body is its named slots
    // (field declarations, like a type body). The `syntax` grammar block is
    // deferred (see devdocs/game_parser.md).
    // `verb a, b, c` — registers conjugation-sugar words (collected in the prescan,
    // already in `verbNames`). It carries no runtime behavior: the conjugation
    // rules live in the locale's conjugate() function, and the declaration only
    // tells the parser to rewrite `[drop]` to a conjugate() call. So it parses to a
    // node the checker and emitter ignore. A word may be a keyword (`verb do`).
    function parseVerbDecl() {
        expectKeyword("verb");
        do {
            const t = peek();
            // A quoted word carries letters an identifier can't (accents: `verb "être"`),
            // parallel to the quoted form in sugar declarations.
            if (t.type !== "IDENT" && t.type !== "KEYWORD" && t.type !== "STRING") {
                throw err("Expected a verb word after 'verb'");
            }
            next();
        } while (at("COMMA") && (next(), true));
        expectNewline();
        return ast.createVerbDecl();
    }

    // `sugar bare WORD[, …]` / `sugar operand WORD[, …]` — a locale declares template-sugar
    // tokens (WORD → native call). Each WORD is a bare identifier or a `"quoted" as native`
    // pair (a token can carry an apostrophe/accent a native name can't, e.g. `"we're" as we_re`).
    // Inert here (the prescan builds the token→native map that drives desugaring); this only
    // validates the syntax. See devdocs/i18n.md ("declarable grammar sugar").
    function parseSugarDecl() {
        expectKeyword("sugar");
        const shape = peek();
        if (shape.type !== "IDENT" || (shape.value !== "bare" && shape.value !== "operand")) {
            throw err("Expected 'bare' or 'operand' after 'sugar'");
        }
        next();
        do {
            const t = peek();
            if (t.type !== "IDENT" && t.type !== "KEYWORD" && t.type !== "STRING") {
                throw err("Expected a sugar token (a word, or \"quoted\" as native)");
            }
            next();
            if (at("IDENT") && peek().value === "as") {
                next();
                if (!at("IDENT")) throw err("Expected a native name after 'as'");
                next();
            }
        } while (at("COMMA") && (next(), true));
        expectNewline();
        return ast.createSugarDecl();
    }

    function parseActionDecl() {
        const keyword = expectKeyword("action");
        const name = plainName("action name");
        let slots = [];
        let templates = [];
        let tags = [];
        let outOfWorld = false;
        let worldScope = false;
        let multi = false;
        if (at("COLON")) {
            next();
            expectNewline();
            ({ slots, templates, tags, outOfWorld, worldScope, multi } = parseActionBody());
        } else {
            expectNewline();
        }
        return ast.createActionDecl(name, slots, templates, filePath, keyword.line, tags, outOfWorld, worldScope, multi);
    }

    // An action body holds slot field declarations, an optional `syntax:` block of
    // quoted surface templates, and optional `tags` lines. `syntax` and `tags` are
    // contextual keywords here.
    function parseActionBody() {
        expect("INDENT", "Expected an indented action body");
        const slots = [];
        let templates = [];
        const tags = [];
        let outOfWorld = false;
        let worldScope = false;
        let multi = false;
        while (!at("DEDENT")) {
            if (peek().type === "IDENT" && peek().value === "syntax" && peek(1).type === "COLON") {
                next();
                next();
                expectNewline();
                templates = parseSyntaxBlock();
                continue;
            }
            // `out_of_world` (a contextual keyword, like `syntax`/`tags`) marks an action
            // that bypasses the turn clock: it takes no turn, no undo checkpoint, and fires
            // no every-turn rules — for meta/debug verbs (SCORE, SHOWME, …). See specs.md.
            if (peek().type === "IDENT" && peek().value === "out_of_world") {
                next();
                expectNewline();
                outOfWorld = true;
                continue;
            }
            // `world_scope` (a contextual keyword) makes the action's object slots resolve
            // against every object in the world, not just the actor's scope — for debug
            // verbs that reach unreachable things (PURLOIN, GONEAR, …). See specs.md.
            if (peek().type === "IDENT" && peek().value === "world_scope") {
                next();
                expectNewline();
                worldScope = true;
                continue;
            }
            // `multi` (a contextual keyword) marks the action's `direct` slot as accepting
            // multiple objects ("take all", "drop ball and umbrella"); the parser then
            // dispatches the action once per resolved object. The newline lookahead keeps
            // `multi` usable as a slot type name (`multi thing x` stays a slot line).
            if (peek().type === "IDENT" && peek().value === "multi" && peek(1).type === "NEWLINE") {
                next();
                expectNewline();
                multi = true;
                continue;
            }
            if (peek().type === "IDENT" && peek().value === "tags") {
                next();
                tags.push(plainName("tag name"));
                while (at("COMMA")) {
                    next();
                    tags.push(plainName("tag name"));
                }
                expectNewline();
                continue;
            }
            let direct = false;
            if (at("IDENT") && peek().value === "direct") {
                if (slots.some((s) => s.direct)) {
                    throw err("An action may have at most one `direct` slot");
                }
                direct = true;
                next();
            }
            const fieldType = parseFieldType();
            const fieldName = plainName("slot name");
            expectNewline();
            slots.push(ast.createFieldDecl(fieldType, fieldName, null, direct));
        }
        next();
        return { slots, templates, tags, outOfWorld, worldScope, multi };
    }

    function parseSyntaxBlock() {
        expect("INDENT", "Expected an indented syntax block");
        const templates = [];
        while (!at("DEDENT")) {
            const template = expect("STRING", "Expected a quoted syntax template");
            expectNewline();
            templates.push(template.value);
        }
        next();
        return templates;
    }

    // A leading-band phase rule: `BAND SELECTOR [when COND]:` followed by a block.
    // SELECTOR is a single action name (the common case) or a boolean selector over
    // actions/tags (see parseSelector). `self` is the action instance in the body.
    function parsePhaseRule() {
        const bandToken = next();
        let band = bandToken.value;
        // `report failed SELECTOR` selects the failure-reporting band; the `failed`
        // modifier distinguishes it from the success `report` band.
        if (band === "report" && at("IDENT") && peek().value === "failed" && selectorStartsAt(1)) {
            next();
            band = "report_failed";
        }
        const selector = parseSelector();
        let whenExpr = null;
        if (atKeyword("when")) {
            next();
            whenExpr = parseExpression(0, new Set(["self"]));
        }
        expect("COLON", "Expected ':' after phase rule header");
        expectNewline();
        const body = parseBlock(new Set(["self"]));
        // A bare single action name keeps the single-action code path (actionName
        // set, selector null); anything else is a multi-action selector rule.
        if (selector.kind === "SelAtom" && actionNames.has(selector.name)) {
            return ast.createPhaseRule(band, selector.name, whenExpr, body, filePath, bandToken.line);
        }
        return ast.createPhaseRule(band, null, whenExpr, body, filePath, bandToken.line, selector);
    }

    // Selector grammar (lowest to highest precedence): `or`, then `and`/`except`
    // (`a except b` ≡ `a and not b`), then `not`/atom. Atoms are `any`, action
    // names, tag names, or parenthesized selectors. No comma sugar.
    function parseSelector() {
        let left = parseSelectorAnd();
        while (atKeyword("or")) {
            const op = next();
            const right = parseSelectorAnd();
            left = ast.createSelOr(left, right, filePath, op.line);
        }
        return left;
    }

    function parseSelectorAnd() {
        let left = parseSelectorUnary();
        while (atKeyword("and") || (peek().type === "IDENT" && peek().value === "except")) {
            const op = next();
            const right = parseSelectorUnary();
            left = op.value === "except"
                ? ast.createSelAnd(left, ast.createSelNot(right, filePath, op.line), filePath, op.line)
                : ast.createSelAnd(left, right, filePath, op.line);
        }
        return left;
    }

    function parseSelectorUnary() {
        if (atKeyword("not")) {
            const op = next();
            return ast.createSelNot(parseSelectorUnary(), filePath, op.line);
        }
        if (at("LPAREN")) {
            next();
            const inner = parseSelector();
            expect("RPAREN", "Expected ')' to close selector group");
            return inner;
        }
        const token = peek();
        const name = plainName("action or tag name");
        if (name === "any") {
            return ast.createSelAny(filePath, token.line);
        }
        return ast.createSelAtom(name, filePath, token.line);
    }

    // A `rule RULEBOOK [when COND]:` contribution: adds one rule to an existing
    // named rulebook from any file. The rulebook's parameters are in scope.
    function parseRulebookRule() {
        const keyword = next();
        const rulebookName = plainName("rulebook name");
        const paramLocals = new Set(rulebookParams.get(rulebookName) || []);
        let whenExpr = null;
        if (atKeyword("when")) {
            next();
            whenExpr = parseExpression(0, paramLocals);
        }
        expect("COLON", "Expected ':' after rule header");
        expectNewline();
        const body = parseBlock(paramLocals);
        return ast.createRulebookRule(rulebookName, whenExpr, body, filePath, keyword.line);
    }

    function parseRulebookDecl() {
        const keyword = expectKeyword("rulebook");
        const resultType = parseFieldType();
        const name = plainName("rulebook name");
        expect("LPAREN", "Expected '(' after rulebook name");
        const params = [];
        if (!at("RPAREN")) {
            params.push(parseFunctionParam());
            while (at("COMMA")) {
                next();
                params.push(parseFunctionParam());
            }
        }
        expect("RPAREN", "Expected ')' to close parameter list");
        expect("COLON", "Expected ':' after rulebook header");
        expectNewline();
        const paramLocals = new Set(params.map((p) => p.name));
        const { rules, defaultExpr } = parseRulebookBody(paramLocals, keyword.line);
        return ast.createRulebookDecl(name, resultType, params, rules, defaultExpr, filePath, keyword.line);
    }

    // A rulebook body holds a single required `default EXPR` line (a contextual
    // keyword, not globally reserved) and zero or more `when COND:` rules. Rules
    // run in declaration order; `default` may appear anywhere among them.
    function parseRulebookBody(paramLocals, declLine) {
        expect("INDENT", "Expected an indented rulebook body");
        const rules = [];
        let defaultExpr = null;
        while (!at("DEDENT")) {
            if (at("EOF")) {
                throw err("Unexpected end of input inside rulebook body");
            }
            if (peek().type === "IDENT" && peek().value === "default") {
                if (defaultExpr !== null) {
                    throw err("a rulebook may declare 'default' only once");
                }
                next();
                defaultExpr = parseExpression(0, paramLocals);
                expectNewline();
                continue;
            }
            if (atKeyword("when")) {
                next();
                const whenExpr = parseExpression(0, paramLocals);
                expect("COLON", "Expected ':' after rule guard");
                expectNewline();
                const body = parseBlock(new Set(paramLocals));
                rules.push({ whenExpr, body });
                continue;
            }
            throw err("Expected 'default' or a 'when' rule inside rulebook body");
        }
        next();
        if (defaultExpr === null) {
            throw syntaxError(filePath, declLine, "rulebook requires a 'default' value");
        }
        return { rules, defaultExpr };
    }

    function parseBlock(localNames) {
        expect("INDENT", "Expected an indented block");
        const statements = [];
        while (!at("DEDENT")) {
            if (at("EOF")) {
                throw err("Unexpected end of input inside block");
            }
            statements.push(parseStatement(localNames));
        }
        next();
        return statements;
    }

    function parseStatement(localNames) {
        const token = peek();
        if (token.type === "KEYWORD") {
            switch (token.value) {
                case "let": return parseLet(localNames);
                case "print": return parsePrint(localNames);
                case "if": return parseIf(localNames);
                case "while": return parseWhile(localNames);
                case "for": return parseFor(localNames);
                case "dispatch": return parseDispatch();
                case "error": return parseErrorStatement(localNames);
                case "return": return parseReturn(localNames);
                case "bidi": return parseBidiAssert();
                case "remove": return parseRemoveStatement(localNames);
                case "disconnect": return parseDisconnectStatement();
                case "stop": return parseStop(localNames);
                case "follow": return parseFollowStatement(localNames);
                case "try": return parseTryStatement(localNames);
                case "move": return parseMoveStatement(localNames);
                case "break":
                    next();
                    expectNewline();
                    return ast.createBreakStatement();
                default: throw err(`Unexpected '${token.value}' in statement`);
            }
        }
        if (token.type === "IDENT") {
            if (token.value === "silently" && peek(1).type === "KEYWORD" && peek(1).value === "try") {
                next(); // consume "silently"
                return parseTryStatement(localNames, true);
            }
            if (relationNames.has(token.value) && peek(1).type === "COLON") return parseRelationAssert();
            if (relationTemplates.has(token.value)) return parseCustomSyntaxAssert(relationTemplates.get(token.value), null, undefined, localNames);
            if (peek(1).type === "IDENT" && relationTemplates.has(peek(1).value)) return parseNamedCustomSyntaxAssert(localNames);
            if (peek(1).type === "LPAREN") return parseCallStatement(localNames);
            return parseAssign(localNames);
        }
        throw err(`Unexpected token in statement: ${token.type}`);
    }

    function parseCallStatement(localNames) {
        const nameToken = peek();
        const name = plainName("function name");
        expect("LPAREN", "Expected '('");
        const args = [];
        if (!at("RPAREN")) {
            args.push(parseExpression(0, localNames));
            while (at("COMMA")) {
                next();
                args.push(parseExpression(0, localNames));
            }
        }
        expect("RPAREN", "Expected ')'");
        expectNewline();
        return ast.createCallStatement(name, args, filePath, nameToken.line);
    }

    // `move X to Y` — relocate X into container Y. Desugars to an assertion of the
    // world-model containment relation (`contains`); the relation's `unique` target
    // endpoint evicts X's prior container, so a move is a single assertion. Both
    // operands are full expressions (object references, `self.taken`, query results).
    function parseMoveStatement(localNames) {
        const keyword = expectKeyword("move");
        const contained = parseExpression(0, localNames);
        expectKeyword("to");
        const container = parseExpression(0, localNames);
        expectNewline();
        return ast.createMoveStatement(contained, container, filePath, keyword.line);
    }

    function parseReturn(localNames) {
        expectKeyword("return");
        const expr = at("NEWLINE") ? null : parseExpression(0, localNames);
        expectNewline();
        return ast.createReturnStatement(expr);
    }

    // `try ACTION:` with an indented block of `slot value` lines constructs an
    // action instance and runs it through its rulebook bands.
    function parseTryStatement(localNames = null, silent = false) {
        const keyword = expectKeyword("try");
        const { actionName, fields } = parseTryTail(localNames);
        return ast.createTryStatement(actionName, fields, filePath, keyword.line, silent);
    }

    // Parses the action name and optional `:`-block after the `try` keyword,
    // consuming the trailing newline (and block). Shared by the statement form
    // and the `let x = try ...` expression form.
    function parseTryTail(localNames = null) {
        const actionName = plainName("action name");
        let fields = [];
        if (at("COLON")) {
            next();
            expectNewline();
            fields = localNames !== null ? parseExprBody(localNames) : parseObjectBody();
        } else {
            expectNewline();
        }
        return { actionName, fields };
    }

    function parseStop(localNames) {
        const keyword = expectKeyword("stop");
        const expr = at("NEWLINE") ? null : parseExpression(0, localNames);
        // `stop failed REASON` — an optional second expression naming a
        // stop_reason; threaded onto the action instance's `reason` slot.
        const reason = (expr !== null && !at("NEWLINE")) ? parseExpression(0, localNames) : null;
        expectNewline();
        return ast.createStopStatement(expr, reason, filePath, keyword.line);
    }

    function parseFollowStatement(localNames) {
        const keyword = expectKeyword("follow");
        const { name, args } = parseFollowTail(localNames);
        expectNewline();
        return ast.createFollowStatement(name, args, filePath, keyword.line);
    }

    // Parses the `NAME(args)` that follows the `follow` keyword, in both
    // statement and expression position.
    function parseFollowTail(localNames) {
        const name = plainName("rulebook name");
        expect("LPAREN", "Expected '(' after rulebook name");
        const args = [];
        if (!at("RPAREN")) {
            args.push(parseExpression(0, localNames));
            while (at("COMMA")) {
                next();
                args.push(parseExpression(0, localNames));
            }
        }
        expect("RPAREN", "Expected ')'");
        return { name, args };
    }

    function parseLet(localNames) {
        const keyword = peek();
        expectKeyword("let");
        const name = plainName("variable name");
        expect("EQUALS");
        // `let x = try ACTION[: block]` captures the action's outcome. The try
        // tail consumes its own newline/block, so don't expect a newline after.
        const silentTry = peek().type === "IDENT" && peek().value === "silently"
            && peek(1).type === "KEYWORD" && peek(1).value === "try";
        if (atKeyword("try") || silentTry) {
            if (silentTry) next(); // consume "silently"
            const tryKeyword = next();
            const { actionName, fields } = parseTryTail(localNames);
            localNames.add(name);
            const tryExpr = ast.createTryExpr(actionName, fields, filePath, tryKeyword.line, silentTry);
            return ast.createLetStatement(name, tryExpr, filePath, keyword.line);
        }
        const expr = parseExpression(0, localNames);
        expectNewline();
        localNames.add(name);
        return ast.createLetStatement(name, expr, filePath, keyword.line);
    }

    function parsePrint(localNames) {
        expectKeyword("print");
        const expr = at("NEWLINE") ? ast.createStringLiteral("") : parseExpression(0, localNames);
        expectNewline();
        return ast.createPrintStatement(expr);
    }

    function parseErrorStatement(localNames) {
        expectKeyword("error");
        const expr = parseExpression(0, localNames);
        expectNewline();
        return ast.createErrorStatement(expr);
    }

    function parseDispatch() {
        expectKeyword("dispatch");
        const name = plainName("event name");
        expectNewline();
        return ast.createDispatchStatement(name);
    }

    function parseIf(localNames) {
        expectKeyword("if");
        const condition = parseExpression(0, localNames);
        expect("COLON", "Expected ':' after if condition");
        expectNewline();
        const thenBody = parseBlock(new Set(localNames));
        let elseBody = null;
        if (atKeyword("else")) {
            next();
            expect("COLON", "Expected ':' after else");
            expectNewline();
            elseBody = parseBlock(new Set(localNames));
        }
        return ast.createIfStatement(condition, thenBody, elseBody);
    }

    function parseWhile(localNames) {
        expectKeyword("while");
        const condition = parseExpression(0, localNames);
        expect("COLON", "Expected ':' after while condition");
        expectNewline();
        const body = parseBlock(new Set(localNames));
        return ast.createWhileStatement(condition, body);
    }

    function parseFor(localNames) {
        const keyword = peek();
        expectKeyword("for");
        const varName = plainName("loop variable");
        if (atKeyword("in")) {
            next();
            const listExpr = parseExpression(0, localNames);
            expect("COLON", "Expected ':' after for header");
            expectNewline();
            const bodyLocals = new Set(localNames);
            bodyLocals.add(varName);
            const body = parseBlock(bodyLocals);
            return ast.createForEachStatement(varName, listExpr, body, filePath, keyword.line);
        }
        expect("EQUALS");
        const start = parseExpression(0, localNames);
        expectKeyword("to");
        const finish = parseExpression(0, localNames);
        let step;
        if (atKeyword("step")) {
            next();
            step = parseExpression(0, localNames);
        } else {
            step = ast.createNumberLiteral(1);
        }
        expect("COLON", "Expected ':' after for header");
        expectNewline();
        const bodyLocals = new Set(localNames);
        bodyLocals.add(varName);
        const body = parseBlock(bodyLocals);
        return ast.createForStatement(varName, start, finish, step, body, filePath, keyword.line);
    }

    function parseAssign(localNames) {
        const headToken = peek();
        const chain = [readTargetSegment()];
        while (at("DOT")) {
            next();
            chain.push(readTargetSegment());
        }
        // Indexed assignment target: `xs[i] = v` (the chain resolves to a list).
        let index = null;
        if (at("LBRACKET")) {
            next();
            index = parseExpression(0, localNames);
            expect("RBRACKET", "Expected ']' in indexed assignment target");
        }
        expect("EQUALS", "Expected '=' in assignment");
        const expr = parseExpression(0, localNames);
        expectNewline();
        return ast.createAssignStatement(chain, expr, filePath, headToken.line, index);
    }

    function readTargetSegment() {
        const token = peek();
        if (token.type !== "IDENT") {
            throw err("Expected a name in assignment target", token.line);
        }
        next();
        return token.value;
    }

    function parseExpression(minBP, localNames) {
        let left = parseNud(localNames);
        while (true) {
            const token = peek();
            const bp = getInfixBP(token);
            if (bp === undefined || bp <= minBP) break;
            next();
            left = parseLed(token, left, localNames);
        }
        // A trailing '.' at the end of a complete expression means property
        // access was attempted on something that is not a reference (e.g. a
        // literal). minBP === 0 marks a top-level expression boundary.
        if (minBP === 0 && at("DOT")) {
            throw err("property access '.' requires a variable or object reference, not a literal value");
        }
        return left;
    }

    // Entry point for parsing a substitution source as a single complete
    // expression (tolerating the leading/trailing layout tokens the tokenizer
    // emits for a one-line source), used by parseEmbeddedExpression.
    function parseWholeExpression(localNames) {
        while (at("NEWLINE") || at("INDENT")) next();
        const expr = parseExpression(0, localNames);
        while (at("NEWLINE") || at("DEDENT")) next();
        if (!at("EOF")) {
            throw err("unexpected tokens after substitution expression");
        }
        return expr;
    }

    // A string literal in expression position may carry `[expr]` substitutions.
    // With none it is a plain StringLiteral (escaped brackets resolved); otherwise
    // it becomes a TemplateLiteral whose embedded expressions are parsed here with
    // the same name scope as the surrounding expression. Grammar/syntax/understand
    // templates take a different path (parseSimpleValue / expect("STRING")), so
    // their literal `[slot]` markers are untouched.
    function parseStringExpr(token, localNames) {
        const { parts, hasSub } = splitTemplate(token.value, (m) => err(m, token.line));
        if (!hasSub) {
            return ast.createStringLiteral(parts.map((p) => p.value).join(""));
        }
        return ast.createTemplateLiteral(buildTemplateParts(parts, localNames, token.line));
    }

    // Folds the flat text/substitution parts into a tree, lifting the block markers
    // into nodes: `[if]`/`[else if]`/`[else]`/`[end]` into a `cond` node (branches,
    // each holding its own parts) and `[first time]`/`[only]` into a `firstTime`
    // node. A stack tracks the (at most one) open block; the open frame appends to
    // its active part list, switched by `[else if]`/`[else]`. Opening a second block
    // inside one is rejected — without indentation the marker pairing is unreadable,
    // so authors compose a separate text value and interpolate it (Lamp keeps real
    // branching in indented code). A value substitution is desugared and parsed; a
    // condition is a plain Lamp expression (no sugar). See devdocs/text.md E, F9.
    function buildTemplateParts(parts, localNames, line) {
        const fail = (m) => err(m, line);
        const root = [];
        const stack = [{ items: root, block: null }];
        const top = () => stack[stack.length - 1];
        // A conditional/variation block ([if]/[first time]/[one of]) is open somewhere
        // in the stack. Those may not nest (the marker pairing is unreadable without
        // indentation); style spans are exempt — they have named close tags — so they
        // are not counted here and may nest freely, inside or around a control block.
        const inControlBlock = () => stack.some((f) => f.block && f.block.kind !== "style");
        for (const p of parts) {
            if (p.kind === "text") {
                top().items.push({ kind: "text", value: p.value });
                continue;
            }
            const ctrl = classifyControl(p.src);
            if (!ctrl) {
                top().items.push({ kind: "expr", expr: parseEmbeddedExpression(desugarSugar(p.src, verbNames, sugarMap), line, localNames) });
                continue;
            }
            if (ctrl.type === "plural") {
                // [s] pluralizes the immediately-preceding word: split the trailing
                // word off the last text part and emit a pluralSuffix node for it.
                const items = top().items;
                const last = items[items.length - 1];
                const m = last && last.kind === "text" ? last.value.match(/([A-Za-z]+)$/) : null;
                if (!m) throw fail("'[s]' must immediately follow a word in template");
                const word = m[1];
                last.value = last.value.slice(0, last.value.length - word.length);
                if (last.value === "") items.pop();
                items.push({ kind: "pluralSuffix", word });
                continue;
            }
            if (ctrl.type === "styleOpen") {
                const styleNode = { kind: "style", name: ctrl.name, parts: [] };
                top().items.push(styleNode);
                stack.push({ items: styleNode.parts, block: styleNode });
                continue;
            }
            if (ctrl.type === "styleClose") {
                const frame = top();
                if (!frame.block || frame.block.kind !== "style") {
                    throw fail(`'[/${ctrl.name}]' without a matching '[${ctrl.name}]' in template`);
                }
                if (frame.block.name !== ctrl.name) {
                    throw fail(`'[/${ctrl.name}]' does not match the open '[${frame.block.name}]' style in template`);
                }
                stack.pop();
                continue;
            }
            if (ctrl.type === "if" || ctrl.type === "firsttime" || ctrl.type === "oneof") {
                if (inControlBlock()) {
                    const what = ctrl.type === "if" ? "[if]" : ctrl.type === "firsttime" ? "[first time]" : "[one of]";
                    throw fail(`nested '${what}' is not allowed in a template (the marker pairing would be unreadable without indentation); compute the inner text as a separate value and interpolate it`);
                }
                if (ctrl.type === "if") {
                    if (ctrl.cond === "") throw fail("'[if]' requires a condition in template");
                    const condNode = { kind: "cond", branches: [{ cond: parseEmbeddedExpression(ctrl.cond, line, localNames), parts: [] }] };
                    top().items.push(condNode);
                    stack.push({ items: condNode.branches[0].parts, block: condNode });
                } else if (ctrl.type === "firsttime") {
                    const ftNode = { kind: "firstTime", parts: [] };
                    top().items.push(ftNode);
                    stack.push({ items: ftNode.parts, block: ftNode });
                } else {
                    const oneOfNode = { kind: "oneOf", mode: null, alternatives: [[]] };
                    top().items.push(oneOfNode);
                    stack.push({ items: oneOfNode.alternatives[0], block: oneOfNode });
                }
            } else if (ctrl.type === "or") {
                const frame = top();
                if (!frame.block || frame.block.kind !== "oneOf") throw fail("'[or]' without a matching '[one of]' in template");
                const alt = [];
                frame.block.alternatives.push(alt);
                frame.items = alt;
            } else if (ctrl.type === "mode") {
                if (!top().block || top().block.kind !== "oneOf") throw fail(`'[${ctrl.mode}]' variation mode without a matching '[one of]' in template`);
                top().block.mode = ctrl.mode;
                stack.pop();
            } else if (ctrl.type === "elif" || ctrl.type === "else") {
                const frame = top();
                if (!frame.block || frame.block.kind !== "cond") {
                    throw fail(`'[${ctrl.type === "elif" ? "else if" : "else"}]' without a matching '[if]' in template`);
                }
                const branches = frame.block.branches;
                if (branches[branches.length - 1].cond === null) {
                    throw fail("'[else if]'/'[else]' after '[else]' in template");
                }
                if (ctrl.type === "elif" && ctrl.cond === "") throw fail("'[else if]' requires a condition in template");
                const branch = { cond: ctrl.type === "elif" ? parseEmbeddedExpression(ctrl.cond, line, localNames) : null, parts: [] };
                branches.push(branch);
                frame.items = branch.parts;
            } else if (ctrl.type === "end") {
                if (!top().block || top().block.kind !== "cond") throw fail("'[end]' without a matching '[if]' in template");
                stack.pop();
            } else {
                if (!top().block || top().block.kind !== "firstTime") throw fail("'[only]' without a matching '[first time]' in template");
                stack.pop();
            }
        }
        if (stack.length !== 1) {
            const block = top().block;
            throw fail(block.kind === "cond"
                ? "unterminated '[if]' (missing '[end]') in template"
                : block.kind === "firstTime"
                    ? "unterminated '[first time]' (missing '[only]') in template"
                    : block.kind === "style"
                        ? `unterminated '[${block.name}]' style (missing '[/${block.name}]') in template`
                        : "unterminated '[one of]' (missing a mode like '[at random]' or '[cycling]') in template");
        }
        return root;
    }

    // Parses one substitution's source as a standalone expression, reusing the
    // surrounding parser's name scope (globals, functions, relations, objects) and
    // the caller's local variables. Errors are re-pointed at the host string's line.
    function parseEmbeddedExpression(src, line, localNames) {
        let subTokens;
        try {
            subTokens = tokenize(src, filePath);
        } catch (e) {
            throw err(`invalid substitution "[${src}]": ${e.message}`, line);
        }
        const sub = createParser(subTokens, filePath, globalNames, functionNames, relationNames, relationTemplates, actionNames, objectNames, tagNames, rulebookParams, verbNames, typeNames, fieldNames, sugarMap);
        try {
            return sub.parseWholeExpression(localNames);
        } catch (e) {
            throw err(`invalid substitution "[${src}]": ${e.message}`, line);
        }
    }

    function parseNud(localNames) {
        const token = next();
        if (token.type === "STRING") return parseStringExpr(token, localNames);
        if (token.type === "NUMBER") return ast.createNumberLiteral(token.value);
        if (token.type === "IDENT") {
            // Named message: `NAME:"DEFAULT"` — an overridable message whose default
            // text is inline. Evaluates to the override registered for NAME, else the
            // default. See devdocs/messages.md.
            if (at("COLON") && peek(1).type === "STRING") {
                next(); // ':'
                const strTok = next();
                return ast.createMessageExpr(token.value, parseStringExpr(strTok, localNames), filePath, token.line);
            }
            // Default-less message reference: `message NAME` — the text comes entirely
            // from a registered `NAME: "…"` override (a locale pack owns the prose; the
            // checker requires one to be loaded). `message` is contextual: two adjacent
            // identifiers are invalid otherwise, so a plain `message` local/object still
            // parses as an identifier. See devdocs/messages.md.
            if (token.value === "message" && at("IDENT")) {
                const nameTok = next();
                return ast.createMessageExpr(nameTok.value, null, filePath, token.line);
            }
            // A relation query in expression position (`connects foyer north hall`).
            // Guard on `!at("DOT")` so the type handle (`connects.all`) stays a
            // property access rather than being parsed as a query.
            if (relationTemplates.has(token.value) && !at("DOT")) {
                return parseRelationQuery(relationTemplates.get(token.value), localNames, token.line);
            }
            return parseIdentExpr(token, localNames);
        }
        // Unary minus: RBP 25 — tighter than +/- (10) and */÷ (20), looser than ^ (30),
        // so `-x^2` parses as `-(x^2)` and `-x*2` as `(-x)*2`.
        if (token.type === "MINUS") return ast.createNegateExpr(parseExpression(25, localNames));
        if (token.type === "KEYWORD" && token.value === "not") return ast.createNotExpr(parseExpression(3, localNames));
        // `freeze EXPR` binds tightly (like unary minus) so `freeze a + b` is
        // `(freeze a) + b`; wrap in parens to freeze a larger expression.
        if (token.type === "KEYWORD" && token.value === "freeze") return ast.createFreezeExpr(parseExpression(25, localNames));
        if (token.type === "KEYWORD" && token.value === "follow") {
            const { name, args } = parseFollowTail(localNames);
            return ast.createFollowExpr(name, args, filePath, token.line);
        }
        if (token.type === "LPAREN") {
            const expr = parseExpression(0, localNames);
            expect("RPAREN", "Expected ')' to close expression");
            // Postfix field access on the parenthesized value, e.g.
            // `(connects foyer _ ?all).size` (G2). Collect the trailing dotted
            // names into a MemberAccess; with no trailing '.' the value passes
            // through unchanged.
            const fields = collectTrailingFields();
            return fields.length === 0 ? expr : ast.createMemberAccess(expr, fields);
        }
        // List literal `[a, b, c]` (or `[]`). In prefix position `[` is a literal;
        // in infix position it is indexing (LBRACKET led), so the two never collide.
        if (token.type === "LBRACKET") {
            const elements = [];
            if (!at("RBRACKET")) {
                elements.push(parseExpression(0, localNames));
                while (at("COMMA")) {
                    next();
                    elements.push(parseExpression(0, localNames));
                }
            }
            expect("RBRACKET", "Expected ']' to close list literal");
            return ast.createListLiteral(elements, filePath, token.line);
        }
        throw err(`Unexpected token in expression: ${token.type}`, token.line);
    }

    function parseLed(op, left, localNames) {
        if (op.type === "PLUS") return ast.createConcat(left, parseExpression(BP.PLUS, localNames));
        if (op.type === "MINUS") return ast.createSubtractExpr(left, parseExpression(BP.MINUS, localNames));
        if (op.type === "STAR") return ast.createMultiplyExpr(left, parseExpression(BP.STAR, localNames));
        if (op.type === "SLASH") return ast.createDivideExpr(left, parseExpression(BP.SLASH, localNames));
        if (op.type === "CARET") return ast.createPowerExpr(left, parseExpression(BP.CARET - 1, localNames));
        if (op.type === "EQEQ") return ast.createEqualsExpr(left, parseExpression(BP.EQEQ, localNames), filePath, op.line);
        // `a != b` desugars to `not (a == b)` — reuses the equality + negation machinery.
        if (op.type === "NEQ") return ast.createNotExpr(ast.createEqualsExpr(left, parseExpression(BP.NEQ, localNames), filePath, op.line));
        if (op.type === "LT") return ast.createLessThanExpr(left, parseExpression(BP.LT, localNames));
        if (op.type === "GT") return ast.createLessThanExpr(parseExpression(BP.GT, localNames), left);
        if (op.type === "LTE") return ast.createLessOrEqualExpr(left, parseExpression(BP.LTE, localNames));
        if (op.type === "GTE") return ast.createLessOrEqualExpr(parseExpression(BP.GTE, localNames), left);
        if (op.type === "KEYWORD" && op.value === "and") return ast.createAndExpr(left, parseExpression(2, localNames));
        if (op.type === "KEYWORD" && op.value === "or") return ast.createOrExpr(left, parseExpression(1, localNames));
        // `EXPR is TYPE` — the right side is a bare type name, not an expression.
        if (op.type === "KEYWORD" && op.value === "is") {
            const typeName = plainName("type name after 'is'");
            return ast.createIsExpr(left, typeName, filePath, op.line);
        }
        if (op.type === "KEYWORD" && op.value === "mod") return ast.createModExpr(left, parseExpression(BP.STAR, localNames));
        if (op.type === "KEYWORD" && op.value === "div") return ast.createDivExpr(left, parseExpression(BP.STAR, localNames));
        if (op.type === "LBRACKET") {
            const index = parseExpression(0, localNames);
            expect("RBRACKET", "Expected ']' to close index expression");
            return ast.createIndexExpr(left, index);
        }
        throw err(`Unexpected operator: ${op.type}`, op.line);
    }

    // Collect a run of trailing `.field` accesses. A member name after `.` may be
    // a reserved word (e.g. `self.action`), mirroring JS member access — the
    // leading-identifier reservation does not apply in field position. Returns the
    // field-name list (possibly empty).
    function collectTrailingFields() {
        const fields = [];
        while (at("DOT")) {
            next();
            const fieldTok = peek();
            if (fieldTok.type !== "IDENT" && fieldTok.type !== "KEYWORD") {
                throw err("Expected field name after '.'", fieldTok.line);
            }
            next();
            fields.push(fieldTok.value);
        }
        return fields;
    }

    function parseIdentExpr(token, localNames) {
        const raw = token.value;
        if (raw === "true") return ast.createBooleanLiteral(true);
        if (raw === "false") return ast.createBooleanLiteral(false);
        if (raw === "none") return ast.createNoneLiteral();

        if (at("LPAREN")) {
            next();
            const args = [];
            if (!at("RPAREN")) {
                args.push(parseExpression(0, localNames));
                while (at("COMMA")) {
                    next();
                    args.push(parseExpression(0, localNames));
                }
            }
            expect("RPAREN", "Expected ')'");
            const call = ast.createCallExpr(raw, args, filePath, token.line);
            // Postfix field access on the call result, e.g. `holder(p).lighted`.
            const callFields = collectTrailingFields();
            return callFields.length === 0 ? call : ast.createMemberAccess(call, callFields);
        }

        const fields = collectTrailingFields();

        if (fields.length === 0) {
            if (localNames.has(raw)) return ast.createVariableExpr(raw);
            if (globalNames.has(raw)) return ast.createGlobalExpr(coerceName(raw));
            if (functionNames.has(raw)) return ast.createFunctionRefExpr(raw);
            const coerced = coerceName(raw);
            // A bare name that is a declared object resolves to that object (so
            // `x == statue` compares object identity); other JS-safe bare names
            // fall back to a string literal (the enum-label path).
            if (objectNames.has(coerced)) return ast.createParenNameExpr(coerced, []);
            return JS_IDENT.test(coerced)
                ? ast.createStringLiteral(coerced)
                : ast.createParenNameExpr(coerced, []);
        }

        if (localNames.has(raw)) return ast.createPropertyAccess([raw, ...fields]);
        if (globalNames.has(raw)) return ast.createPropertyAccess([coerceName(raw), ...fields]);
        const coerced = coerceName(raw);
        return JS_IDENT.test(coerced)
            ? ast.createPropertyAccess([coerced, ...fields])
            : ast.createParenNameExpr(coerced, fields);
    }

    return { parseProgram, parseWholeExpression };
}

function syntaxError(filePath, lineNumber, message) {
    return new Error(`${filePath}:${lineNumber}: ${message}`);
}

module.exports = {
    parseSource,
    parseTokens,
};
