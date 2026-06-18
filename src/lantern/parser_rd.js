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
const BP = { EQEQ: 5, LT: 5, GT: 5, LTE: 5, GTE: 5, PLUS: 10, MINUS: 10, STAR: 20, SLASH: 20, CARET: 30, LBRACKET: 40 };

function getInfixBP(token) {
    if (token.type === "KEYWORD" && token.value === "or") return 1;
    if (token.type === "KEYWORD" && token.value === "and") return 2;
    return BP[token.type];
}

const PHASE_WORDS = new Set(["before", "instead", "check", "do", "after", "report"]);

function parseSource(sourceText, filePath, globalNames = new Set(), functionNames = new Set(), relationNames = new Set(), relationTemplates = new Map(), actionNames = new Set(), objectNames = new Set()) {
    const tokens = tokenize(sourceText, filePath);
    return createParser(tokens, filePath, globalNames, functionNames, relationNames, relationTemplates, actionNames, objectNames).parseProgram();
}

function createParser(tokens, filePath, globalNames, functionNames = new Set(), relationNames = new Set(), relationTemplates = new Map(), actionNames = new Set(), objectNames = new Set()) {
    let pos = 0;

    const peek = (offset = 0) => tokens[pos + offset];
    const next = () => tokens[pos++];
    const at = (type) => peek().type === type;
    const atKeyword = (value) => peek().type === "KEYWORD" && peek().value === value;

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
                case "function": return parseFunctionDecl();
                case "native": return parseNativeFunctionDecl();
                case "rulebook": return parseRulebookDecl();
                case "action": return parseActionDecl();
                default: throw err(`Unexpected '${token.value}' at top level`);
            }
        }
        if (token.type === "IDENT") {
            if (PHASE_WORDS.has(token.value) && peek(1).type === "IDENT" && actionNames.has(peek(1).value)) return parsePhaseRule();
            // `report failed ACTION:` — the failure-reporting band.
            if (token.value === "report" && peek(1).type === "IDENT" && peek(1).value === "failed"
                && peek(2).type === "IDENT" && actionNames.has(peek(2).value)) return parsePhaseRule();
            if (relationNames.has(token.value) && peek(1).type === "COLON") return parseRelationAssert();
            if (relationTemplates.has(token.value)) return parseCustomSyntaxAssert(relationTemplates.get(token.value), null);
            if (peek(1).type === "IDENT" && relationTemplates.has(peek(1).value)) return parseNamedCustomSyntaxAssert();
            return peek(1).type === "EQUALS" ? parseGlobalAssign() : parseObjectDecl();
        }
        throw err(`Unexpected token at top level: ${token.type}`);
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
        const { fields, syntax, invertedFields, sourceField, targetField } = parseRelationBody(keyword.line);
        return ast.createRelationDecl(name, fields, syntax, invertedFields, sourceField, targetField, filePath, keyword.line);
    }

    // A relation body holds field declarations plus an optional `syntax "..."`
    // line. Each field line may be prefixed with `from` (marks the source endpoint)
    // or `to` (marks the target endpoint); exactly one of each is required.
    // `inverted` and `syntax` are contextual keywords (tokenize as IDENTs).
    // A field marked `inverted` must have a type that declares an `inverse` field,
    // used when computing the mechanical reverse of a bidi relation.
    function parseRelationBody(declLine) {
        expect("INDENT", "Expected an indented block");
        const fields = [];
        const invertedFields = [];
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
            if (at("IDENT") && peek().value === "inverted") {
                next();
                invertedFields.push(fieldName);
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
        return { fields, syntax, invertedFields, sourceField, targetField };
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
        const typeName = plainName("object type");
        const objectName = coercedName("object name");
        let fields = [];
        if (at("COLON")) {
            next();
            expectNewline();
            fields = parseObjectBody();
        } else {
            expectNewline();
        }
        return ast.createObjectDecl(typeName, objectName, fields);
    }

    function parseObjectBody() {
        expect("INDENT", "Expected an indented block");
        const fields = [];
        while (!at("DEDENT")) {
            const nameToken = peek();
            const fieldName = plainName("field name");
            const value = parseSimpleValue();
            expectNewline();
            fields.push(ast.createFieldAssign(fieldName, value, filePath, nameToken.line));
        }
        next();
        return fields;
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
    // never full expressions (mirrors the legacy parseSimpleValue).
    function parseSimpleValue() {
        const token = next();
        if (token.type === "NUMBER") return ast.createNumberLiteral(token.value);
        if (token.type === "STRING") return ast.createStringLiteral(token.value);
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
        let whenExpr = null;
        if (atKeyword("when")) {
            next();
            whenExpr = parseExpression(0, new Set());
        }
        expect("COLON", "Expected ':' after function header");
        expectNewline();
        const paramLocals = new Set(params.map((p) => p.name));
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
    function parseActionDecl() {
        const keyword = expectKeyword("action");
        const name = plainName("action name");
        let slots = [];
        let templates = [];
        if (at("COLON")) {
            next();
            expectNewline();
            ({ slots, templates } = parseActionBody());
        } else {
            expectNewline();
        }
        return ast.createActionDecl(name, slots, templates, filePath, keyword.line);
    }

    // An action body holds slot field declarations and an optional `syntax:`
    // block of quoted surface templates. `syntax` is a contextual keyword here.
    function parseActionBody() {
        expect("INDENT", "Expected an indented action body");
        const slots = [];
        let templates = [];
        while (!at("DEDENT")) {
            if (peek().type === "IDENT" && peek().value === "syntax" && peek(1).type === "COLON") {
                next();
                next();
                expectNewline();
                templates = parseSyntaxBlock();
                continue;
            }
            const fieldType = parseFieldType();
            const fieldName = plainName("slot name");
            expectNewline();
            slots.push(ast.createFieldDecl(fieldType, fieldName));
        }
        next();
        return { slots, templates };
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

    // A leading-band phase rule: `BAND ACTION [when COND]:` followed by a block.
    // `self` is the action instance throughout the body.
    function parsePhaseRule() {
        const bandToken = next();
        let band = bandToken.value;
        // `report failed ACTION` selects the failure-reporting band; the `failed`
        // modifier distinguishes it from the success `report` band.
        if (band === "report" && at("IDENT") && peek().value === "failed"
            && peek(1).type === "IDENT" && actionNames.has(peek(1).value)) {
            next();
            band = "report_failed";
        }
        const actionName = plainName("action name");
        let whenExpr = null;
        if (atKeyword("when")) {
            next();
            whenExpr = parseExpression(0, new Set(["self"]));
        }
        expect("COLON", "Expected ':' after phase rule header");
        expectNewline();
        const body = parseBlock(new Set(["self"]));
        return ast.createPhaseRule(band, actionName, whenExpr, body, filePath, bandToken.line);
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
        expect("EQUALS", "Expected '=' in assignment");
        const expr = parseExpression(0, localNames);
        expectNewline();
        return ast.createAssignStatement(chain, expr, filePath, headToken.line);
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

    function parseNud(localNames) {
        const token = next();
        if (token.type === "STRING") return ast.createStringLiteral(token.value);
        if (token.type === "NUMBER") return ast.createNumberLiteral(token.value);
        if (token.type === "IDENT") {
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
        if (token.type === "KEYWORD" && token.value === "follow") {
            const { name, args } = parseFollowTail(localNames);
            return ast.createFollowExpr(name, args, filePath, token.line);
        }
        if (token.type === "LPAREN") {
            const expr = parseExpression(0, localNames);
            expect("RPAREN", "Expected ')' to close expression");
            return expr;
        }
        throw err(`Unexpected token in expression: ${token.type}`, token.line);
    }

    function parseLed(op, left, localNames) {
        if (op.type === "PLUS") return ast.createConcat(left, parseExpression(BP.PLUS, localNames));
        if (op.type === "MINUS") return ast.createSubtractExpr(left, parseExpression(BP.MINUS, localNames));
        if (op.type === "STAR") return ast.createMultiplyExpr(left, parseExpression(BP.STAR, localNames));
        if (op.type === "SLASH") return ast.createDivideExpr(left, parseExpression(BP.SLASH, localNames));
        if (op.type === "CARET") return ast.createPowerExpr(left, parseExpression(BP.CARET - 1, localNames));
        if (op.type === "EQEQ") return ast.createEqualsExpr(left, parseExpression(BP.EQEQ, localNames));
        if (op.type === "LT") return ast.createLessThanExpr(left, parseExpression(BP.LT, localNames));
        if (op.type === "GT") return ast.createLessThanExpr(parseExpression(BP.GT, localNames), left);
        if (op.type === "LTE") return ast.createLessOrEqualExpr(left, parseExpression(BP.LTE, localNames));
        if (op.type === "GTE") return ast.createLessOrEqualExpr(parseExpression(BP.GTE, localNames), left);
        if (op.type === "KEYWORD" && op.value === "and") return ast.createAndExpr(left, parseExpression(2, localNames));
        if (op.type === "KEYWORD" && op.value === "or") return ast.createOrExpr(left, parseExpression(1, localNames));
        if (op.type === "LBRACKET") {
            const index = parseExpression(0, localNames);
            expect("RBRACKET", "Expected ']' to close index expression");
            return ast.createIndexExpr(left, index);
        }
        throw err(`Unexpected operator: ${op.type}`, op.line);
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
            return ast.createCallExpr(raw, args, filePath, token.line);
        }

        const fields = [];
        while (at("DOT")) {
            next();
            fields.push(expect("IDENT", "Expected field name after '.'").value);
        }

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

    return { parseProgram };
}

function syntaxError(filePath, lineNumber, message) {
    return new Error(`${filePath}:${lineNumber}: ${message}`);
}

module.exports = {
    parseSource,
};
