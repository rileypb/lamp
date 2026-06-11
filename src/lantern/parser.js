const {
    createProgram,
    createTypeDecl,
    createObjectDecl,
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
    createPropertyAccess,
    createConcat,
    createEqualsExpr,
    createKindDecl,
    createEnumExpr,
} = require("./ast");

function parseSource(sourceText, filePath) {
    const lines = preprocessLines(sourceText);
    const { nodes } = parseNodes(lines, 0, 0, filePath);
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

function parseNodes(lines, startIndex, baseIndent, filePath) {
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

        if (content.startsWith("type ")) {
            const { node, nextIndex } = parseTypeDecl(lines, index, filePath);
            nodes.push(node);
            index = nextIndex;
            continue;
        }

        if (content.startsWith("on ")) {
            const { node, nextIndex } = parseEventHandler(lines, index, filePath);
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
    if (/^-?\d+$/.test(value)) {
        return createNumberLiteral(Number(value));
    }
    if (value.startsWith('"') && value.endsWith('"')) {
        return createStringLiteral(value.slice(1, -1));
    }
    return createStringLiteral(value);
}

function parseEventHandler(lines, index, filePath) {
    const line = lines[index];
    const content = line.text.trim();
    const match = content.match(/^on\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/);
    if (!match) {
        throw syntaxError(filePath, line.lineNumber, "Invalid event handler declaration");
    }

    const blockStart = findFirstBlockLineIndex(lines, index, filePath);
    const blockIndent = lines[blockStart].indent;
    const parsed = parseStatementBlock(lines, blockStart, blockIndent, filePath, new Set());

    return {
        node: createEventHandler(match[1], parsed.statements),
        nextIndex: parsed.nextIndex,
    };
}

function parseStatementBlock(lines, startIndex, baseIndent, filePath, localNames) {
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
            const parsedIf = parseIfStatement(lines, index, baseIndent, filePath, localNames);
            statements.push(parsedIf.statement);
            index = parsedIf.nextIndex;
            continue;
        }

        if (content.startsWith("let ")) {
            const match = content.match(/^let\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
            if (!match) {
                throw syntaxError(filePath, line.lineNumber, "Invalid let statement");
            }
            statements.push(createLetStatement(match[1], parseExpression(match[2], filePath, line.lineNumber, localNames)));
            localNames.add(match[1]);
            index += 1;
            continue;
        }

        if (content.startsWith("print ")) {
            statements.push(createPrintStatement(parseExpression(content.slice(6), filePath, line.lineNumber, localNames)));
            index += 1;
            continue;
        }

        if (content.startsWith("error ")) {
            statements.push(createErrorStatement(parseExpression(content.slice(6), filePath, line.lineNumber, localNames)));
            index += 1;
            continue;
        }

        const assignMatch = content.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)\s*=\s*(.+)$/);
        if (assignMatch) {
            statements.push(
                createAssignStatement(assignMatch[1].split("."), parseExpression(assignMatch[2], filePath, line.lineNumber, localNames), filePath, line.lineNumber),
            );
            index += 1;
            continue;
        }

        throw syntaxError(filePath, line.lineNumber, "Unsupported statement");
    }

    return { statements, nextIndex: index };
}

function parseIfStatement(lines, index, baseIndent, filePath, localNames) {
    const line = lines[index];
    const content = line.text.trim();
    const ifMatch = content.match(/^if\s+(.+)\s*:\s*$/);
    if (!ifMatch) {
        throw syntaxError(filePath, line.lineNumber, "Invalid if statement");
    }

    const condition = parseExpression(ifMatch[1], filePath, line.lineNumber, localNames);
    const thenStart = findFirstBlockLineIndex(lines, index, filePath);
    const thenIndent = lines[thenStart].indent;
    const parsedThen = parseStatementBlock(lines, thenStart, thenIndent, filePath, new Set(localNames));

    let elseBody = null;
    let nextIndex = parsedThen.nextIndex;
    const elseIndex = findNextNonEmptyIndex(lines, nextIndex);

    if (elseIndex !== null) {
        const elseLine = lines[elseIndex];
        const elseContent = elseLine.text.trim();
        if (elseLine.indent === baseIndent && elseContent === "else:") {
            const elseStart = findFirstBlockLineIndex(lines, elseIndex, filePath);
            const elseIndent = lines[elseStart].indent;
            const parsedElse = parseStatementBlock(lines, elseStart, elseIndent, filePath, new Set(localNames));
            elseBody = parsedElse.statements;
            nextIndex = parsedElse.nextIndex;
        }
    }

    return {
        statement: createIfStatement(condition, parsedThen.statements, elseBody),
        nextIndex,
    };
}

function parseExpression(raw, filePath, lineNumber, localNames = new Set()) {
    const eqParts = splitOnTopLevelEquals(raw);
    if (eqParts.length > 1) {
        let expr = parseExpression(eqParts[0], filePath, lineNumber, localNames);
        for (let i = 1; i < eqParts.length; i += 1) {
            expr = createEqualsExpr(expr, parseExpression(eqParts[i], filePath, lineNumber, localNames));
        }
        return expr;
    }

    const parts = splitOnTopLevelPlus(raw);
    if (parts.length > 1) {
        let expr = parseExpression(parts[0], filePath, lineNumber, localNames);
        for (let i = 1; i < parts.length; i += 1) {
            expr = createConcat(expr, parseExpression(parts[i], filePath, lineNumber, localNames));
        }
        return expr;
    }

    const text = raw.trim();
    if (text.startsWith('"') && text.endsWith('"')) {
        return createStringLiteral(text.slice(1, -1));
    }
    if (/^-?\d+$/.test(text)) {
        return createNumberLiteral(Number(text));
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(text)) {
        if (text.includes(".")) {
            return createPropertyAccess(text.split("."));
        }
        if (localNames.has(text)) {
            return createVariableExpr(text);
        }
        return createStringLiteral(text);
    }

    throw syntaxError(filePath, lineNumber, "Unsupported expression");
}

function splitOnTopLevelPlus(raw) {
    const parts = [];
    let current = "";
    let inString = false;

    for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];
        if (ch === '"' && raw[i - 1] !== "\\") {
            inString = !inString;
            current += ch;
            continue;
        }
        if (!inString && ch === "+") {
            parts.push(current.trim());
            current = "";
            continue;
        }
        current += ch;
    }

    if (current.trim() !== "") {
        parts.push(current.trim());
    }

    return parts;
}

function splitOnTopLevelEquals(raw) {
    const parts = [];
    let current = "";
    let inString = false;

    for (let i = 0; i < raw.length; i += 1) {
        const ch = raw[i];
        const next = raw[i + 1];

        if (ch === '"' && raw[i - 1] !== "\\") {
            inString = !inString;
            current += ch;
            continue;
        }

        if (!inString && ch === "=" && next === "=") {
            parts.push(current.trim());
            current = "";
            i += 1;
            continue;
        }

        current += ch;
    }

    if (current.trim() !== "") {
        parts.push(current.trim());
    }

    return parts.length > 1 ? parts : [raw.trim()];
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
