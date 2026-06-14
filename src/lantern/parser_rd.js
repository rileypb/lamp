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

function parseSource(sourceText, filePath, globalNames = new Set(), functionNames = new Set(), relationNames = new Set(), relationTemplates = new Map()) {
    const tokens = tokenize(sourceText, filePath);
    return createParser(tokens, filePath, globalNames, functionNames, relationNames, relationTemplates).parseProgram();
}

function createParser(tokens, filePath, globalNames, functionNames = new Set(), relationNames = new Set(), relationTemplates = new Map()) {
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
                case "kind": return parseKindDecl();
                case "global": return parseGlobalDecl();
                case "on": return parseOnHandler();
                case "lib": return parseLibImport();
                case "function": return parseFunctionDecl();
                case "native": return parseNativeFunctionDecl();
                default: throw err(`Unexpected '${token.value}' at top level`);
            }
        }
        if (token.type === "IDENT") {
            if (relationNames.has(token.value) && peek(1).type === "COLON") return parseRelationAssert();
            if (relationTemplates.has(token.value)) return parseCustomSyntaxAssert(relationTemplates.get(token.value));
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
            expectNewline();
            fields.push(ast.createFieldDecl(fieldType, fieldName));
        }
        next();
        return fields;
    }

    function parseRelationDecl() {
        const keyword = expectKeyword("relation");
        const name = plainName("relation name");
        expect("COLON", "Expected ':' after relation name");
        expectNewline();
        const { fields, syntax, invertedFields } = parseRelationBody(keyword.line);
        return ast.createRelationDecl(name, fields, syntax, invertedFields, filePath, keyword.line);
    }

    // A relation body holds field declarations plus an optional `syntax "..."`
    // line. `source`, `target`, `inverted`, and `syntax` are contextual keywords:
    // they tokenize as IDENTs and are only special in these positions. A relation
    // must declare exactly one `source` and one `target` (its canonical endpoints);
    // a labelled field may carry a trailing `inverted` tag.
    function parseRelationBody(declLine) {
        expect("INDENT", "Expected an indented block");
        const fields = [];
        const invertedFields = [];
        let syntax = null;
        let sourceCount = 0;
        let targetCount = 0;
        while (!at("DEDENT")) {
            if (at("IDENT") && peek().value === "syntax" && peek(1).type === "STRING") {
                next();
                const template = expect("STRING", "Expected syntax template string");
                expectNewline();
                syntax = template.value;
                continue;
            }
            const fieldType = parseFieldType();
            const fieldName = plainName("field name");
            if (at("IDENT") && peek().value === "inverted") {
                next();
                invertedFields.push(fieldName);
            }
            expectNewline();
            if (fieldName === "source") sourceCount += 1;
            if (fieldName === "target") targetCount += 1;
            fields.push(ast.createFieldDecl(fieldType, fieldName));
        }
        next();
        if (sourceCount !== 1 || targetCount !== 1) {
            throw err("a relation must declare exactly one 'source' and one 'target'", declLine);
        }
        return { fields, syntax, invertedFields };
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
            node = parseCustomSyntaxAssert(relationTemplates.get(token.value));
        } else {
            throw err(`'${token.value}' is not a relation`, token.line);
        }
        node.bidi = true;
        return node;
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

    // Counts tokens on the current logical line (until NEWLINE/COLON), used to
    // tell a named custom-syntax assertion (one extra leading identifier) from
    // an anonymous one by arity.
    function countLineTokens() {
        let count = 0;
        let i = pos;
        while (tokens[i] && tokens[i].type !== "NEWLINE" && tokens[i].type !== "COLON" && tokens[i].type !== "EOF") {
            count += 1;
            i += 1;
        }
        return count;
    }

    // Custom-syntax assertion driven by a relation's `syntax` template. Literal
    // parts must match verbatim (IDENT or KEYWORD tokens both allowed, so a
    // reserved word like `to` may appear as a literal); slot parts consume one
    // simple value. Produces the same RelationAssert node as the block form.
    function parseCustomSyntaxAssert(template) {
        const headToken = peek();
        const expected = template.parts.length;
        const actual = countLineTokens();

        next(); // leading literal (matched by dispatch)

        let instanceName = null;
        if (actual === expected + 1) {
            instanceName = coercedName("relation instance name");
        } else if (actual !== expected) {
            throw err(`wrong number of values in ${template.relationName} assertion`, headToken.line);
        }

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
                const value = parseSimpleValue();
                fields.push(ast.createFieldAssign(part.field, value, filePath, valueToken.line));
            }
        }
        expectNewline();
        return ast.createRelationAssert(template.relationName, fields, instanceName, filePath, headToken.line);
    }

    // A relation query in expression position. The leading literal has already
    // been consumed by parseNud. Each slot is an atom (`_` wildcard, literal,
    // object name, variable/global, or property-access chain) — not a full
    // expression — so operators and indexing terminate the slot naturally and
    // function calls are explicitly rejected.
    function parseRelationQuery(template, localNames, headLine) {
        const fields = [];
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
                fields.push({ fieldName: part.field, value: parseRelationSlot(localNames, template.relationName) });
            }
        }
        return ast.createRelationQuery(template.relationName, fields, filePath, headLine);
    }

    function parseRelationSlot(localNames, relationName) {
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
        throw err(`Expected a value or '_' in ${relationName} query`, token.line);
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
                case "break":
                    next();
                    expectNewline();
                    return ast.createBreakStatement();
                default: throw err(`Unexpected '${token.value}' in statement`);
            }
        }
        if (token.type === "IDENT") {
            if (relationNames.has(token.value) && peek(1).type === "COLON") return parseRelationAssert();
            if (relationTemplates.has(token.value)) return parseCustomSyntaxAssert(relationTemplates.get(token.value));
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

    function parseLet(localNames) {
        const keyword = peek();
        expectKeyword("let");
        const name = plainName("variable name");
        expect("EQUALS");
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
            return ast.createCallExpr(raw, args);
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
