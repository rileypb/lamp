const PRIMITIVE_TYPES = new Set(["string", "int", "bool", "real"]);

function checkProgram(programAst) {
    const typeSchema = buildTypeSchema(programAst.nodes);
    const kindSchema = buildKindSchema(programAst.nodes);

    for (const node of programAst.nodes) {
        if (node.kind === "ObjectDecl") {
            checkObjectDecl(node, typeSchema, kindSchema);
        } else if (node.kind === "EventHandler") {
            checkStatements(node.body, typeSchema, kindSchema, new Map());
        }
    }
}

function buildTypeSchema(nodes) {
    const typeFields = new Map();
    const typeParents = new Map();

    for (const node of nodes) {
        if (node.kind === "TypeDecl") {
            const fields = new Map();
            for (const f of node.fields) {
                fields.set(f.fieldName, f.typeName);
            }
            typeFields.set(node.name, fields);
            typeParents.set(node.name, node.parents || []);
        }
    }

    return { typeFields, typeParents };
}

function buildKindSchema(nodes) {
    const kindSchema = new Map();
    for (const node of nodes) {
        if (node.kind === "KindDecl") {
            kindSchema.set(node.name, node.kindExpr);
        }
    }
    return kindSchema;
}

function getAllFields(typeName, typeSchema) {
    const { typeFields, typeParents } = typeSchema;
    const result = new Map();
    const visited = new Set();

    function collect(name) {
        if (visited.has(name)) {
            return;
        }
        visited.add(name);
        for (const parent of (typeParents.get(name) || [])) {
            collect(parent);
        }
        for (const [fieldName, fieldType] of (typeFields.get(name) || new Map())) {
            result.set(fieldName, fieldType);
        }
    }

    collect(typeName);
    return result;
}

function checkObjectDecl(node, typeSchema, kindSchema) {
    const allFields = getAllFields(node.typeName, typeSchema);
    for (const fieldAssign of node.fields) {
        const fieldTypeName = allFields.get(fieldAssign.fieldName);
        if (!fieldTypeName) {
            continue;
        }
        checkValueCompatibility(
            fieldAssign.value,
            fieldTypeName,
            typeSchema,
            kindSchema,
            fieldAssign.filePath,
            fieldAssign.lineNumber,
            `field "${fieldAssign.fieldName}"`,
        );
    }
}

function checkStatements(statements, typeSchema, kindSchema, localTypes) {
    for (const stmt of statements) {
        if (stmt.kind === "LetStatement") {
            const varType = inferExprType(stmt.expr, typeSchema, localTypes);
            if (varType) {
                localTypes.set(stmt.name, varType);
            }
        } else if (stmt.kind === "AssignStatement") {
            checkAssignStatement(stmt, typeSchema, kindSchema, localTypes);
        } else if (stmt.kind === "IfStatement") {
            checkStatements(stmt.thenBody, typeSchema, kindSchema, new Map(localTypes));
            if (stmt.elseBody) {
                checkStatements(stmt.elseBody, typeSchema, kindSchema, new Map(localTypes));
            }
        }
    }
}

function checkAssignStatement(stmt, typeSchema, kindSchema, localTypes) {
    const chain = stmt.targetChain;
    if (chain.length < 2) {
        return;
    }

    const objectChain = chain.slice(0, -1);
    const fieldName = chain[chain.length - 1];
    const containerType = resolveObjectType(objectChain, typeSchema, localTypes);

    if (!containerType) {
        return;
    }

    const allFields = getAllFields(containerType, typeSchema);
    const fieldTypeName = allFields.get(fieldName);
    if (!fieldTypeName) {
        return;
    }

    checkValueCompatibility(
        stmt.expr,
        fieldTypeName,
        typeSchema,
        kindSchema,
        stmt.filePath,
        stmt.lineNumber,
        `field "${fieldName}"`,
    );
}

function inferExprType(expr, typeSchema, localTypes) {
    if (expr.kind === "PropertyAccess") {
        return resolveObjectType(expr.chain, typeSchema, localTypes);
    }
    if (expr.kind === "VariableExpr") {
        return localTypes.get(expr.name) || null;
    }
    return null;
}

function resolveObjectType(chain, typeSchema, localTypes) {
    const { typeFields, typeParents } = typeSchema;
    let currentType = null;

    for (const token of chain) {
        if (currentType === null) {
            if (typeFields.has(token) || typeParents.has(token)) {
                currentType = token;
            } else if (localTypes.has(token)) {
                currentType = localTypes.get(token);
            } else {
                return null;
            }
        } else {
            if (token === "all" || token === "first") {
                continue;
            }
            const allFields = getAllFields(currentType, typeSchema);
            const fieldType = allFields.get(token);
            if (!fieldType) {
                return null;
            }
            if (typeFields.has(fieldType) || typeParents.has(fieldType)) {
                currentType = fieldType;
            } else {
                return null;
            }
        }
    }

    return currentType;
}

function checkValueCompatibility(valueNode, fieldTypeName, typeSchema, kindSchema, filePath, lineNumber, context) {
    // Only check literal values — complex expressions are not statically typed yet.
    const isLiteral = valueNode.kind === "StringLiteral" || valueNode.kind === "NumberLiteral";
    if (!isLiteral) {
        return;
    }

    if (fieldTypeName === "string") {
        if (valueNode.kind !== "StringLiteral") {
            throw typeError(filePath, lineNumber, `${context} expects string, got ${describeValue(valueNode)}`);
        }
        return;
    }

    if (fieldTypeName === "int" || fieldTypeName === "real") {
        if (valueNode.kind !== "NumberLiteral") {
            throw typeError(filePath, lineNumber, `${context} expects ${fieldTypeName}, got ${describeValue(valueNode)}`);
        }
        return;
    }

    if (kindSchema.has(fieldTypeName)) {
        const kindDef = kindSchema.get(fieldTypeName);
        if (kindDef.kind === "EnumExpr") {
            if (valueNode.kind !== "StringLiteral" || !kindDef.labels.includes(valueNode.value)) {
                const got = valueNode.kind === "StringLiteral" ? `"${valueNode.value}"` : describeValue(valueNode);
                throw typeError(
                    filePath,
                    lineNumber,
                    `${context} expects one of (${kindDef.labels.join(", ")}), got ${got}`,
                );
            }
        }
        return;
    }
}

function describeValue(valueNode) {
    if (valueNode.kind === "StringLiteral") {
        return `string ("${valueNode.value}")`;
    }
    if (valueNode.kind === "NumberLiteral") {
        return `number (${valueNode.value})`;
    }
    return `(${valueNode.kind})`;
}

function typeError(filePath, lineNumber, message) {
    return new Error(`${filePath}:${lineNumber}: type error: ${message}`);
}

module.exports = { checkProgram };
