const PRIMITIVE_TYPES = new Set(["string", "int", "bool", "real"]);

function checkProgram(programAst) {
    const typeSchema = buildTypeSchema(programAst.nodes);
    const kindSchema = buildKindSchema(programAst.nodes);
    const globalTypes = buildGlobalTypeSchema(programAst.nodes);
    const functionSchema = buildFunctionSchema(programAst.nodes);

    for (const node of programAst.nodes) {
        if (node.kind === "ObjectDecl") {
            checkObjectDecl(node, typeSchema, kindSchema);
        } else if (node.kind === "GlobalAssign") {
            checkGlobalAssign(node, globalTypes, typeSchema, kindSchema);
        } else if (node.kind === "EventHandler") {
            checkStatements(node.body, typeSchema, kindSchema, new Map(), functionSchema);
        } else if (node.kind === "ChangeHandler") {
            const localTypes = new Map([["self", node.typeName]]);
            checkStatements(node.body, typeSchema, kindSchema, localTypes, functionSchema);
        } else if (node.kind === "FunctionDecl") {
            const localTypes = new Map(node.params.map((p) => [p.name, p.typeName]));
            checkStatements(node.body, typeSchema, kindSchema, localTypes, functionSchema);
        }
    }
}

function buildFunctionSchema(nodes) {
    const functionSchema = new Map();
    for (const node of nodes) {
        if (node.kind === "FunctionDecl") {
            functionSchema.set(node.name, node.params);
        }
    }
    return functionSchema;
}

function buildTypeSchema(nodes) {
    const typeFields = new Map();
    const typeParents = new Map();

    for (const node of nodes) {
        if (node.kind !== "TypeDecl") {
            continue;
        }

        const isReopen = typeFields.has(node.name);

        if (!isReopen) {
            typeFields.set(node.name, new Map());
            typeParents.set(node.name, node.parents || []);
        } else if (node.parents && node.parents.length > 0) {
            throw typeError(
                node.filePath,
                node.lineNumber,
                `type "${node.name}" reopens but specifies parents; parents may only be set in the original declaration`,
            );
        }

        const existingFields = typeFields.get(node.name);
        for (const f of node.fields) {
            if (existingFields.has(f.fieldName)) {
                throw typeError(
                    node.filePath,
                    node.lineNumber,
                    `type "${node.name}" reopens but field "${f.fieldName}" is already declared`,
                );
            }
            existingFields.set(f.fieldName, f.typeName);
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

function buildGlobalTypeSchema(nodes) {
    const globalTypes = new Map();
    for (const node of nodes) {
        if (node.kind === "GlobalDecl") {
            globalTypes.set(node.name, node.typeName || inferLiteralType(node.value));
        }
    }
    return globalTypes;
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

function checkStatements(statements, typeSchema, kindSchema, localTypes, functionSchema = new Map()) {
    for (const stmt of statements) {
        if (stmt.kind === "LetStatement") {
            const varType = inferExprType(stmt.expr, typeSchema, kindSchema, localTypes);
            if (varType) {
                localTypes.set(stmt.name, varType);
            }
        } else if (stmt.kind === "AssignStatement") {
            checkAssignStatement(stmt, typeSchema, kindSchema, localTypes);
        } else if (stmt.kind === "IfStatement") {
            checkStatements(stmt.thenBody, typeSchema, kindSchema, new Map(localTypes), functionSchema);
            if (stmt.elseBody) {
                checkStatements(stmt.elseBody, typeSchema, kindSchema, new Map(localTypes), functionSchema);
            }
        } else if (stmt.kind === "WhileStatement") {
            checkStatements(stmt.body, typeSchema, kindSchema, new Map(localTypes), functionSchema);
        } else if (stmt.kind === "ForStatement") {
            const bodyTypes = new Map(localTypes);
            bodyTypes.set(stmt.varName, "int");
            checkStatements(stmt.body, typeSchema, kindSchema, bodyTypes, functionSchema);
        } else if (stmt.kind === "CallStatement") {
            checkCallStatement(stmt, typeSchema, kindSchema, localTypes, functionSchema);
        }
    }
}

function checkCallStatement(stmt, typeSchema, kindSchema, localTypes, functionSchema) {
    const params = functionSchema.get(stmt.name);
    if (!params) return;
    if (stmt.args.length !== params.length) {
        throw typeError(
            stmt.filePath,
            stmt.lineNumber,
            `function "${stmt.name}" expects ${params.length} argument(s), got ${stmt.args.length}`,
        );
    }
    for (let i = 0; i < params.length; i++) {
        checkValueCompatibility(
            stmt.args[i],
            params[i].typeName,
            typeSchema,
            kindSchema,
            stmt.filePath,
            stmt.lineNumber,
            `argument ${i + 1} of "${stmt.name}"`,
            localTypes,
        );
    }
}

function checkGlobalAssign(node, globalTypes, typeSchema, kindSchema) {
    const globalType = globalTypes.get(node.name);
    if (!globalType) {
        throw typeError(node.filePath, node.lineNumber, `unknown global "${node.name}"`);
    }
    checkValueCompatibility(node.value, globalType, typeSchema, kindSchema, node.filePath, node.lineNumber, `global "${node.name}"`);
}

function checkAssignStatement(stmt, typeSchema, kindSchema, localTypes) {
    const chain = stmt.targetChain;
    if (chain.length < 2) {
        return;
    }

    const objectChain = chain.slice(0, -1);
    const fieldName = chain[chain.length - 1];
    const containerType = resolveChainType(objectChain, typeSchema, kindSchema, localTypes);

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
        localTypes,
    );
}

function inferExprType(expr, typeSchema, kindSchema, localTypes) {
    if (expr.kind === "BooleanLiteral") {
        return "bool";
    }
    if (expr.kind === "StringLiteral") {
        return "string";
    }
    if (expr.kind === "NumberLiteral") {
        return Number.isInteger(expr.value) ? "int" : "real";
    }
    if (expr.kind === "NoneLiteral") {
        return null;
    }
    if (expr.kind === "VariableExpr") {
        return localTypes.get(expr.name) || null;
    }
    if (expr.kind === "PropertyAccess") {
        return resolveChainType(expr.chain, typeSchema, kindSchema, localTypes);
    }
    if (expr.kind === "Concat") {
        const leftType = inferExprType(expr.left, typeSchema, kindSchema, localTypes);
        const rightType = inferExprType(expr.right, typeSchema, kindSchema, localTypes);
        return inferConcatType(leftType, rightType, kindSchema);
    }
    if (expr.kind === "EqualsExpr") {
        return "bool";
    }
    if (expr.kind === "LessThanExpr") {
        return "bool";
    }
    if (expr.kind === "MultiplyExpr") {
        const leftType = inferExprType(expr.left, typeSchema, kindSchema, localTypes);
        const rightType = inferExprType(expr.right, typeSchema, kindSchema, localTypes);
        if (leftType === null || rightType === null) {
            return null;
        }
        if (isNumericType(leftType) && isNumericType(rightType)) {
            return (leftType === "real" || rightType === "real") ? "real" : "int";
        }
        return null;
    }
    if (expr.kind === "GlobalExpr") {
        return null;
    }
    if (expr.kind === "ParenNameExpr") {
        return null;
    }
    return null;
}

function inferConcatType(leftType, rightType, kindSchema) {
    if (leftType === null || rightType === null) {
        return null;
    }
    if (isNumericType(leftType) && isNumericType(rightType)) {
        return (leftType === "real" || rightType === "real") ? "real" : "int";
    }
    if (isStringCompatible(leftType, kindSchema) && isStringCompatible(rightType, kindSchema)) {
        return "string";
    }
    return null;
}

function isNumericType(type) {
    return type === "int" || type === "real";
}

function isStringCompatible(type, kindSchema) {
    if (type === "string" || type === "int" || type === "real") {
        return true;
    }
    return kindSchema.has(type);
}

function resolveChainType(chain, typeSchema, kindSchema, localTypes) {
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
            if (token === "all") {
                currentType = `list<${currentType}>`;
                continue;
            }
            if (token === "first") {
                const listMatch = currentType.match(/^list<(.+)>$/);
                if (listMatch) {
                    currentType = listMatch[1];
                } else {
                    return null;
                }
                continue;
            }
            const listMatch = currentType.match(/^list<(.+)>$/);
            if (listMatch) {
                return null;
            }
            const allFields = getAllFields(currentType, typeSchema);
            const fieldType = allFields.get(token);
            if (!fieldType) {
                return null;
            }
            currentType = fieldType;
        }
    }

    return currentType;
}

function checkValueCompatibility(valueNode, fieldTypeName, typeSchema, kindSchema, filePath, lineNumber, context, localTypes = new Map()) {
    const inferredType = inferExprType(valueNode, typeSchema, kindSchema, localTypes);

    if (inferredType === null) {
        return;
    }

    if (kindSchema.has(fieldTypeName)) {
        const kindDef = kindSchema.get(fieldTypeName);
        if (kindDef.kind === "EnumExpr") {
            if (valueNode.kind === "StringLiteral") {
                if (!kindDef.labels.includes(valueNode.value)) {
                    throw typeError(
                        filePath,
                        lineNumber,
                        `${context} expects one of (${kindDef.labels.join(", ")}), got "${valueNode.value}"`,
                    );
                }
                return;
            }
            if (inferredType !== fieldTypeName) {
                throw typeError(filePath, lineNumber, `${context} expects kind "${fieldTypeName}", got "${inferredType}"`);
            }
        }
        return;
    }

    if (PRIMITIVE_TYPES.has(fieldTypeName)) {
        if (inferredType === fieldTypeName) {
            return;
        }
        if (fieldTypeName === "real" && inferredType === "int") {
            return;
        }
        throw typeError(filePath, lineNumber, `${context} expects ${fieldTypeName}, got ${inferredType}`);
    }
}

function inferLiteralType(valueNode) {
    if (valueNode.kind === "BooleanLiteral") {
        return "bool";
    }
    if (valueNode.kind === "StringLiteral") {
        return "string";
    }
    if (valueNode.kind === "NumberLiteral") {
        return Number.isInteger(valueNode.value) ? "int" : "real";
    }
    if (valueNode.kind === "NoneLiteral") {
        return null;
    }
    return null;
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
