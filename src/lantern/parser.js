const {
    createProgram,
    createTypeDecl,
    createObjectDecl,
    createGlobalDecl,
    createGlobalAssign,
    createEventHandler,
    createLetStatement,
    createPrintStatement,
    createAssignStatement,
    createErrorStatement,
    createIfStatement,
    createFieldDecl,
    createFieldAssign,
    createStringLiteral,
    createVariableExpr,
    createNumberLiteral,
    createBooleanLiteral,
    createPropertyAccess,
    createConcat,
    createEqualsExpr,
    createKindDecl,
    createEnumExpr,
    createMultiplyExpr,
    createGlobalExpr,
    createParenNameExpr,
} = require("./ast");

function parseSource(sourceText, filePath, globalNames = new Set()) {
    const lines = preprocessLines(sourceText);
    const { nodes } = parseNodes(lines, 0, 0, filePath, globalNames);
    return createProgram(nodes);
}

function preprocessLines(sourceText) {
    return sourceText.split(/\r?\n/).map((raw, idx) => {
        const withoutComment = stripComment(raw);
        const trimmedRight = withoutComment.replace(/\s+$/, "");
        return {
            lineNumber: idx + 1,
            raw,
            text: trimmedRight,
            indent: computeIndent(raw),
        };
    });
}

function stripComment(line) {
    let inString = false;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === '"' && line[i - 1] !== "\\") {
            inString = !inString;
        }
        if (!inString && ch === "#") {
            return line.slice(0, i);
        }
    }
    return line;
}

function computeIndent(line) {
    let count = 0;
    for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (ch === " ") {
            count += 1;
        } else if (ch === "\t") {
            count += 4;
        } else {
            break;
        }
    }
    return count;
}

function parseNodes(lines, startIndex, baseIndent, filePath, globalNames = new Set()) {
    const nodes = [];
    let index = startIndex;

    while (index < lines.length) {
        const line = lines[index];
        const content = line.text.trim();
        if (content === "") {
            index += 1;
            continue;
        }
        if (line.indent < baseIndent) {
            break;
        }
        if (line.indent > baseIndent) {
            throw syntaxError(filePath, line.lineNumber, "Unexpected indentation");
        }

        if (content.startsWith("kind ")) {
            const { node, nextIndex } = parseKindDecl(lines, index, filePath);
            nodes.push(node);
            index = nextIndex;
            continue;
        }

        if (content.startsWith("global ")) {
            const { node, nextIndex } = parseGlobalDecl(lines, index, filePath);
            nodes.push(node);
            index = nextIndex;
            continue;
        }

        if (isTopLevelGlobalAssign(content)) {
            const { node, nextIndex } = parseGlobalAssign(lines, index, filePath);
            nodes.push(node);
            index = nextIndex;
            continue;
        }

        if (content.startsWith("type ")) {
            const { node, nextIndex } = parseTypeDecl(lines, index, filePath);
            nodes.push(node);
            index = nextIndex;
            continue;
        }

        if (content.startsWith("on ")) {
            const { node, nextIndex } = parseEventHandler(lines, index, filePath, globalNames);
            nodes.push(node);
            index = nextIndex;
            continue;
        }

        const { node, nextIndex } = parseObjectDecl(lines, index, filePath);
        nodes.push(node);
        index = nextIndex;
    }

    return { nodes, nextIndex: index };
}

function parseTypeDecl(lines, index, filePath) {
    const line = lines[index];
    const content = line.text.trim();

    const fullMatch = content.match(/^type\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:<\s*([^:]+?))?\s*:?$/);
    if (!fullMatch) {
        throw syntaxError(filePath, line.lineNumber, "Invalid type declaration");
    }

    const name = fullMatch[1];
    const parents = parseParentTypeList(fullMatch[2], filePath, line.lineNumber);
    const hasBody = content.endsWith(":");
    let fields = [];
    let nextIndex = index + 1;

    if (hasBody) {
        const block = parseChildBlock(lines, index, filePath);
        fields = parseTypeFields(block.lines, filePath);
        nextIndex = block.nextIndex;
    }

    return {
        node: createTypeDecl(name, parents, fields),
        nextIndex,
    };
}

function parseParentTypeList(rawParentList, filePath, lineNumber) {
    if (!rawParentList) {
        return [];
    }

    return rawParentList
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((parentName) => {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(parentName)) {
                throw syntaxError(filePath, lineNumber, `Invalid parent type name: ${parentName}`);
            }
            return parentName;
        });
}

function parseTypeFields(lines, filePath) {
    const fields = [];
    for (const line of lines) {
        const content = line.text.trim();
        if (content === "") {
            continue;
        }
        const match = content.match(/^([A-Za-z_][A-Za-z0-9_<>]*)\s+([A-Za-z_][A-Za-z0-9_]*)$/);
        if (!match) {
            throw syntaxError(filePath, line.lineNumber, "Invalid field declaration");
        }
        fields.push(createFieldDecl(match[1], match[2]));
    }
    return fields;
}

function parseObjectDecl(lines, index, filePath) {
    const line = lines[index];
    const content = line.text.trim();
    const headerMatch = content.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+):$/);
    if (!headerMatch) {
        throw syntaxError(filePath, line.lineNumber, "Invalid object declaration");
    }

    const typeName = headerMatch[1];
    const objectName = headerMatch[2].trim();

    const block = parseChildBlock(lines, index, filePath);
    const fields = parseObjectFields(block.lines, filePath);

    return {
        node: createObjectDecl(typeName, objectName, fields),
        nextIndex: block.nextIndex,
    };
}

function parseObjectFields(lines, filePath) {
    const fields = [];
    for (const line of lines) {
        const content = line.text.trim();
        if (content === "") {
            continue;
        }
        const match = content.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(.+)$/);
        if (!match) {
            throw syntaxError(filePath, line.lineNumber, "Invalid object field assignment");
        }
        fields.push(createFieldAssign(match[1], parseSimpleValue(match[2]), filePath, line.lineNumber));
    }
    return fields;
}

function parseSimpleValue(rawValue) {
    const value = rawValue.trim();
    if (value === "true") {
        return createBooleanLiteral(true);
    }
    if (value === "false") {
        return createBooleanLiteral(false);
    }
    if (/^-?\d+\.\d+$/.test(value)) {
        return createNumberLiteral(parseFloat(value));
    }
    if (/^-?\d+$/.test(value)) {
        return createNumberLiteral(Number(value));
    }
    if (value.startsWith('"') && value.endsWith('"')) {
        return createStringLiteral(value.slice(1, -1));
    }
    return createStringLiteral(value);
}

function parseEventHandler(lines, index, filePath, globalNames = new Set()) {
    const line = lines[index];
    const content = line.text.trim();
    const match = content.match(/^on\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
    if (!match) {
        throw syntaxError(filePath, line.lineNumber, "Invalid event handler declaration");
    }

    const blockStart = findFirstBlockLineIndex(lines, index, filePath);
    const blockIndent = lines[blockStart].indent;
    const parsed = parseStatementBlock(lines, blockStart, blockIndent, filePath, new Set(), globalNames);

    return {
        node: createEventHandler(match[1], parsed.statements),
        nextIndex: parsed.nextIndex,
    };
}

function parseStatementBlock(lines, startIndex, baseIndent, filePath, localNames, globalNames = new Set()) {
    const statements = [];
    let index = startIndex;

    while (index < lines.length) {
        const line = lines[index];
        const content = line.text.trim();

        if (content === "") {
            index += 1;
            continue;
        }

        if (line.indent < baseIndent) {
            break;
        }

        if (line.indent > baseIndent) {
            throw syntaxError(filePath, line.lineNumber, "Unexpected indentation inside block");
        }

        if (content.startsWith("if ")) {
            const parsedIf = parseIfStatement(lines, index, baseIndent, filePath, localNames, globalNames);
            statements.push(parsedIf.statement);
            index = parsedIf.nextIndex;
            continue;
        }

        if (content.startsWith("let ")) {
            const match = content.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
            if (!match) {
                throw syntaxError(filePath, line.lineNumber, "Invalid let statement");
            }
            statements.push(createLetStatement(match[1], parseExpression(match[2], filePath, line.lineNumber, localNames, globalNames)));
            localNames.add(match[1]);
            index += 1;
            continue;
        }

        if (content.startsWith("print ")) {
            statements.push(createPrintStatement(parseExpression(content.slice(6), filePath, line.lineNumber, localNames, globalNames)));
            index += 1;
            continue;
        }

        if (content.startsWith("error ")) {
            statements.push(createErrorStatement(parseExpression(content.slice(6), filePath, line.lineNumber, localNames, globalNames)));
            index += 1;
            continue;
        }

        const assignMatch = content.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*=\s*(.+)$/);
        if (assignMatch) {
            statements.push(
                createAssignStatement(assignMatch[1].split("."), parseExpression(assignMatch[2], filePath, line.lineNumber, localNames, globalNames), filePath, line.lineNumber),
            );
            index += 1;
            continue;
        }

        throw syntaxError(filePath, line.lineNumber, "Unsupported statement");
    }

    return { statements, nextIndex: index };
}

function parseIfStatement(lines, index, baseIndent, filePath, localNames, globalNames = new Set()) {
    const line = lines[index];
    const content = line.text.trim();
    const ifMatch = content.match(/^if\s+(.+)\s*:\s*$/);
    if (!ifMatch) {
        throw syntaxError(filePath, line.lineNumber, "Invalid if statement");
    }

    const condition = parseExpression(ifMatch[1], filePath, line.lineNumber, localNames, globalNames);
    const thenStart = findFirstBlockLineIndex(lines, index, filePath);
    const thenIndent = lines[thenStart].indent;
    const parsedThen = parseStatementBlock(lines, thenStart, thenIndent, filePath, new Set(localNames), globalNames);

    let elseBody = null;
    let nextIndex = parsedThen.nextIndex;
    const elseIndex = findNextNonEmptyIndex(lines, nextIndex);

    if (elseIndex !== null) {
        const elseLine = lines[elseIndex];
        const elseContent = elseLine.text.trim();
        if (elseLine.indent === baseIndent && elseContent === "else:") {
            const elseStart = findFirstBlockLineIndex(lines, elseIndex, filePath);
            const elseIndent = lines[elseStart].indent;
            const parsedElse = parseStatementBlock(lines, elseStart, elseIndent, filePath, new Set(localNames), globalNames);
            elseBody = parsedElse.statements;
            nextIndex = parsedElse.nextIndex;
        }
    }

    return {
        statement: createIfStatement(condition, parsedThen.statements, elseBody),
        nextIndex,
    };
}

function tokenizeExpression(raw, filePath, lineNumber) {
    const tokens = [];
    let i = 0;

    function prevIsValue() {
        if (tokens.length === 0) return false;
        const t = tokens[tokens.length - 1].type;
        return t === "NUMBER" || t === "STRING" || t === "IDENT" || t === "RPAREN";
    }

    while (i < raw.length) {
        const ch = raw[i];
        if (ch === " " || ch === "\t") { i += 1; continue; }
        if (ch === '"') {
            let j = i + 1;
            while (j < raw.length && raw[j] !== '"') {
                if (raw[j] === "\\") j += 1;
                j += 1;
            }
            tokens.push({ type: "STRING", value: raw.slice(i + 1, j) });
            i = j + 1;
            continue;
        }
        if (ch === "+") { tokens.push({ type: "PLUS" }); i += 1; continue; }
        if (ch === "*") { tokens.push({ type: "STAR" }); i += 1; continue; }
        if (ch === "(") { tokens.push({ type: "LPAREN" }); i += 1; continue; }
        if (ch === ")") { tokens.push({ type: "RPAREN" }); i += 1; continue; }
        if (ch === ".") { tokens.push({ type: "DOT" }); i += 1; continue; }
        if (ch === "=" && raw[i + 1] === "=") { tokens.push({ type: "EQEQ" }); i += 2; continue; }
        if (ch === "-" && !prevIsValue() && i + 1 < raw.length && /\d/.test(raw[i + 1])) {
            let j = i + 1;
            while (j < raw.length && /\d/.test(raw[j])) j += 1;
            if (j < raw.length && raw[j] === "." && j + 1 < raw.length && /\d/.test(raw[j + 1])) {
                j += 1;
                while (j < raw.length && /\d/.test(raw[j])) j += 1;
                tokens.push({ type: "NUMBER", value: parseFloat(raw.slice(i, j)) });
            } else {
                tokens.push({ type: "NUMBER", value: Number(raw.slice(i, j)) });
            }
            i = j;
            continue;
        }
        if (/\d/.test(ch)) {
            let j = i;
            while (j < raw.length && /\d/.test(raw[j])) j += 1;
            if (j < raw.length && raw[j] === "." && j + 1 < raw.length && /\d/.test(raw[j + 1])) {
                j += 1;
                while (j < raw.length && /\d/.test(raw[j])) j += 1;
                tokens.push({ type: "NUMBER", value: parseFloat(raw.slice(i, j)) });
            } else {
                tokens.push({ type: "NUMBER", value: Number(raw.slice(i, j)) });
            }
            i = j;
            continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
            let j = i;
            while (j < raw.length && /[A-Za-z0-9_]/.test(raw[j])) j += 1;
            tokens.push({ type: "IDENT", value: raw.slice(i, j) });
            i = j;
            continue;
        }
        throw syntaxError(filePath, lineNumber, `Unexpected character in expression: ${JSON.stringify(ch)}`);
    }
    tokens.push({ type: "EOF" });
    return tokens;
}

function parseExpression(raw, filePath, lineNumber, localNames = new Set(), globalNames = new Set()) {
    const tokens = tokenizeExpression(raw, filePath, lineNumber);
    let pos = 0;

    const peek = () => tokens[pos];
    const consume = () => tokens[pos++];
    const expect = (type) => {
        const t = peek();
        if (t.type !== type) throw syntaxError(filePath, lineNumber, `Expected ${type}, got ${t.type}`);
        return consume();
    };

    // Binding powers (left-associative: right side parses at same bp, so same-level op binds left)
    const BP = { EQEQ: 5, PLUS: 10, STAR: 20 };

    function parse(minBP) {
        const tok = consume();
        let left = nud(tok);
        while (true) {
            const t = peek();
            const bp = BP[t.type];
            if (bp === undefined || bp <= minBP) break;
            consume();
            left = led(t, left);
        }
        return left;
    }

    function nud(tok) {
        if (tok.type === "STRING") return createStringLiteral(tok.value);
        if (tok.type === "NUMBER") return createNumberLiteral(tok.value);
        if (tok.type === "IDENT") {
            const name = tok.value;
            if (name === "true") return createBooleanLiteral(true);
            if (name === "false") return createBooleanLiteral(false);
            // Eagerly consume .field.field... chain
            const chain = [name];
            while (peek().type === "DOT") {
                consume();
                if (peek().type !== "IDENT") throw syntaxError(filePath, lineNumber, "Expected identifier after '.'");
                chain.push(consume().value);
            }
            if (chain.length > 1) return createPropertyAccess(chain);
            if (localNames.has(name)) return createVariableExpr(name);
            if (globalNames.has(name)) return createGlobalExpr(name);
            return createStringLiteral(name);
        }
        if (tok.type === "LPAREN") {
            // (Object Name).field — parens delimit multi-word object names, not grouping
            const nameParts = [];
            while (peek().type === "IDENT") nameParts.push(consume().value);
            if (peek().type !== "RPAREN") throw syntaxError(filePath, lineNumber, "Expected object name inside '(...)'");
            consume();
            const fieldChain = [];
            while (peek().type === "DOT") {
                consume();
                if (peek().type !== "IDENT") throw syntaxError(filePath, lineNumber, "Expected field name after '.'");
                fieldChain.push(consume().value);
            }
            return createParenNameExpr(nameParts.join(" "), fieldChain);
        }
        throw syntaxError(filePath, lineNumber, `Unexpected token in expression: ${tok.type}`);
    }

    function led(op, left) {
        if (op.type === "PLUS") return createConcat(left, parse(BP.PLUS));
        if (op.type === "STAR") return createMultiplyExpr(left, parse(BP.STAR));
        if (op.type === "EQEQ") return createEqualsExpr(left, parse(BP.EQEQ));
        throw syntaxError(filePath, lineNumber, `Unexpected operator: ${op.type}`);
    }

    const result = parse(0);
    const trailing = peek();
    if (trailing.type === "DOT") {
        throw syntaxError(filePath, lineNumber, "property access '.' requires a variable or object reference, not a literal value");
    }
    if (trailing.type !== "EOF") {
        throw syntaxError(filePath, lineNumber, `Unexpected token in expression: ${trailing.type}`);
    }
    return result;
}

function findFirstBlockLineIndex(lines, headerIndex, filePath) {
    const headerLine = lines[headerIndex];
    const nextNonEmpty = findNextNonEmptyIndex(lines, headerIndex + 1);

    if (nextNonEmpty === null || lines[nextNonEmpty].indent <= headerLine.indent) {
        throw syntaxError(filePath, headerLine.lineNumber, "Expected an indented block");
    }

    return nextNonEmpty;
}

function findNextNonEmptyIndex(lines, startIndex) {
    let index = startIndex;
    while (index < lines.length) {
        if (lines[index].text.trim() !== "") {
            return index;
        }
        index += 1;
    }
    return null;
}

function parseChildBlock(lines, headerIndex, filePath) {
    const headerLine = lines[headerIndex];
    let index = headerIndex + 1;

    while (index < lines.length && lines[index].text.trim() === "") {
        index += 1;
    }

    if (index >= lines.length || lines[index].indent <= headerLine.indent) {
        throw syntaxError(filePath, headerLine.lineNumber, "Expected an indented block");
    }

    const blockIndent = lines[index].indent;
    const blockLines = [];

    while (index < lines.length) {
        const line = lines[index];
        if (line.text.trim() === "") {
            blockLines.push(line);
            index += 1;
            continue;
        }
        if (line.indent < blockIndent) {
            break;
        }
        if (line.indent > blockIndent) {
            throw syntaxError(filePath, line.lineNumber, "Unexpected indentation inside block");
        }
        blockLines.push(line);
        index += 1;
    }

    return { lines: blockLines, nextIndex: index };
}

function parseKindDecl(lines, index, filePath) {
    const line = lines[index];
    const content = line.text.trim();
    const match = content.match(/^kind\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!match) {
        throw syntaxError(filePath, line.lineNumber, "Invalid kind declaration");
    }
    const name = match[1];
    const kindExpr = parseKindExpr(match[2].trim(), filePath, line.lineNumber);
    return { node: createKindDecl(name, kindExpr), nextIndex: index + 1 };
}

function parseGlobalDecl(lines, index, filePath) {
    const line = lines[index];
    const content = line.text.trim();
    const match = content.match(/^global\s+([A-Za-z_][A-Za-z0-9_<>]*)\s+(.+?)\s*=\s*(.+)$/);
    if (!match) {
        throw syntaxError(filePath, line.lineNumber, "Invalid global declaration");
    }
    return {
        node: createGlobalDecl(match[2].trim(), match[1].trim(), parseSimpleValue(match[3]), filePath, line.lineNumber),
        nextIndex: index + 1,
    };
}

function parseGlobalAssign(lines, index, filePath) {
    const line = lines[index];
    const content = line.text.trim();
    const match = content.match(/^(.+?)\s*=\s*(.+)$/);
    if (!match) {
        throw syntaxError(filePath, line.lineNumber, "Invalid global assignment");
    }
    return {
        node: createGlobalAssign(match[1].trim(), parseSimpleValue(match[2]), filePath, line.lineNumber),
        nextIndex: index + 1,
    };
}

function isTopLevelGlobalAssign(content) {
    return content.includes("=")
        && !content.includes(":")
        && !content.startsWith("let ")
        && !content.startsWith("print ")
        && !content.startsWith("error ")
        && !content.startsWith("if ")
        && !content.startsWith("type ")
        && !content.startsWith("kind ")
        && !content.startsWith("on ");
}

function parseKindExpr(raw, filePath, lineNumber) {
    const enumMatch = raw.match(/^enum\((.+)\)$/);
    if (enumMatch) {
        const labels = enumMatch[1].split(",").map((s) => s.trim()).filter(Boolean);
        return createEnumExpr(labels);
    }
    throw syntaxError(filePath, lineNumber, `Unsupported kind expression: ${raw}`);
}

function syntaxError(filePath, lineNumber, message) {
    return new Error(`${filePath}:${lineNumber}: ${message}`);
}

module.exports = {
    parseSource,
};
