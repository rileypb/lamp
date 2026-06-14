const PRIMITIVE_TYPES = new Set(["string", "int", "bool", "real"]);

function checkProgram(programAst, options = {}) {
    const nativeFunctionNames = options.nativeFunctionNames || new Set();
    const typeSchema = buildTypeSchema(programAst.nodes);
    const kindSchema = buildKindSchema(programAst.nodes);
    const globalTypes = buildGlobalTypeSchema(programAst.nodes);
    const functionSchema = buildFunctionSchema(programAst.nodes);
    const globalNames = new Set(globalTypes.keys());

    checkNativeVsLampConflicts(programAst.nodes);
    checkNativeFunctions(programAst.nodes, nativeFunctionNames);
    checkFunctionOverloads(programAst.nodes, typeSchema, kindSchema, functionSchema);

    for (const node of programAst.nodes) {
        if (node.kind === "ObjectDecl") {
            checkObjectDecl(node, typeSchema, kindSchema);
        } else if (node.kind === "GlobalAssign") {
            checkGlobalAssign(node, globalTypes, typeSchema, kindSchema);
        } else if (node.kind === "EventHandler") {
            checkStatements(node.body, typeSchema, kindSchema, new Map(), functionSchema, null, globalNames);
        } else if (node.kind === "ChangeHandler") {
            const localTypes = new Map([["self", node.typeName]]);
            checkStatements(node.body, typeSchema, kindSchema, localTypes, functionSchema, null, globalNames);
        } else if (node.kind === "FunctionDecl") {
            for (const p of node.params) {
                if (globalNames.has(p.name)) {
                    throw typeError(node.filePath, node.lineNumber, `parameter "${p.name}" shadows global "${p.name}"`);
                }
            }
            const localTypes = new Map(node.params.map((p) => [p.name, p.typeName]));
            const expectedReturn = node.returnType === "void" ? null : node.returnType;
            checkStatements(node.body, typeSchema, kindSchema, localTypes, functionSchema, expectedReturn, globalNames);
        }
    }
}

function checkNativeFunctions(nodes, nativeFunctionNames) {
    for (const node of nodes) {
        if (node.kind !== "NativeFunctionDecl") continue;
        if (!nativeFunctionNames.has(node.name)) {
            throw new Error(`${node.filePath}:${node.lineNumber}: type error: native function "${node.name}" has no JavaScript implementation`);
        }
    }
}

function checkNativeVsLampConflicts(nodes) {
    const lampNames = new Set(
        nodes.filter((n) => n.kind === "FunctionDecl").map((n) => n.name)
    );
    for (const node of nodes) {
        if (node.kind === "NativeFunctionDecl" && lampNames.has(node.name)) {
            throw new Error(`${node.filePath}:${node.lineNumber}: type error: "${node.name}" is declared as both a native function and a Lamp function`);
        }
    }
}

function checkFunctionOverloads(nodes, typeSchema, kindSchema, functionSchema) {
    const groups = new Map();
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.kind !== "FunctionDecl") continue;
        if (!groups.has(node.name)) groups.set(node.name, []);
        groups.get(node.name).push({ node, index: i });
    }

    for (const [name, overloads] of groups) {
        for (const { node } of overloads) {
            if (node.whenExpr !== null) {
                checkWhenExprRestrictions(node.whenExpr, name, node.filePath, node.lineNumber);
                const whenType = inferExprType(node.whenExpr, typeSchema, kindSchema, new Map(), functionSchema);
                if (whenType !== null && whenType !== "bool") {
                    throw new Error(`${node.filePath}:${node.lineNumber}: type error: when condition of "${name}" must be boolean`);
                }
            }
        }

        if (overloads.length === 1) continue;

        const base = overloads[0].node;

        for (const { node } of overloads) {
            if (node.params.length !== base.params.length || node.returnType !== base.returnType) {
                throw new Error(`${node.filePath}:${node.lineNumber}: type error: all overloads of "${name}" must have the same signature`);
            }
            for (let i = 0; i < node.params.length; i++) {
                if (node.params[i].name !== base.params[i].name || node.params[i].typeName !== base.params[i].typeName) {
                    throw new Error(`${node.filePath}:${node.lineNumber}: type error: all overloads of "${name}" must use the same parameter names and types`);
                }
            }
        }
    }
}

function checkWhenExprRestrictions(expr, funcName, filePath, lineNumber) {
    if (expr.kind === "CallExpr") {
        throw new Error(`${filePath}:${lineNumber}: type error: when condition of "${funcName}" may not contain function calls`);
    }
    if (expr.kind === "FunctionRefExpr") {
        throw new Error(`${filePath}:${lineNumber}: type error: when condition of "${funcName}" may not reference functions`);
    }
    for (const key of ["left", "right", "expr"]) {
        if (expr[key]) checkWhenExprRestrictions(expr[key], funcName, filePath, lineNumber);
    }
}

function serializeWhenExpr(expr) {
    if (expr.kind === "AndExpr") return `(${serializeWhenExpr(expr.left)} and ${serializeWhenExpr(expr.right)})`;
    if (expr.kind === "OrExpr") return `(${serializeWhenExpr(expr.left)} or ${serializeWhenExpr(expr.right)})`;
    if (expr.kind === "NotExpr") return `(not ${serializeWhenExpr(expr.expr)})`;
    if (expr.kind === "EqualsExpr") return `(${serializeWhenExpr(expr.left)} == ${serializeWhenExpr(expr.right)})`;
    if (expr.kind === "LessThanExpr") return `(${serializeWhenExpr(expr.left)} < ${serializeWhenExpr(expr.right)})`;
    if (expr.kind === "LessOrEqualExpr") return `(${serializeWhenExpr(expr.left)} <= ${serializeWhenExpr(expr.right)})`;
    if (expr.kind === "GlobalExpr") return `g:${expr.name}`;
    if (expr.kind === "NumberLiteral") return String(expr.value);
    if (expr.kind === "StringLiteral") return JSON.stringify(expr.value);
    if (expr.kind === "BooleanLiteral") return String(expr.value);
    if (expr.kind === "NegateExpr") return `(-${serializeWhenExpr(expr.expr)})`;
    return expr.kind;
}

function buildFunctionSchema(nodes) {
    const functionSchema = new Map();
    for (const node of nodes) {
        if (node.kind === "FunctionDecl" || node.kind === "NativeFunctionDecl") {
            functionSchema.set(node.name, { params: node.params, returnType: node.returnType });
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

function checkStatements(statements, typeSchema, kindSchema, localTypes, functionSchema = new Map(), expectedReturnType = null, globalNames = new Set()) {
    for (const stmt of statements) {
        if (stmt.kind === "LetStatement") {
            if (globalNames.has(stmt.name)) {
                throw typeError(stmt.filePath, stmt.lineNumber, `local "${stmt.name}" shadows global "${stmt.name}"`);
            }
            const varType = inferExprType(stmt.expr, typeSchema, kindSchema, localTypes, functionSchema);
            if (varType) {
                localTypes.set(stmt.name, varType);
            }
        } else if (stmt.kind === "AssignStatement") {
            const head = stmt.targetChain[0];
            if (stmt.targetChain.length === 1 && !localTypes.has(head) && !globalNames.has(head)) {
                throw typeError(stmt.filePath, stmt.lineNumber, `assignment to undeclared name "${head}"`);
            }
            checkAssignStatement(stmt, typeSchema, kindSchema, localTypes);
        } else if (stmt.kind === "IfStatement") {
            checkStatements(stmt.thenBody, typeSchema, kindSchema, new Map(localTypes), functionSchema, expectedReturnType, globalNames);
            if (stmt.elseBody) {
                checkStatements(stmt.elseBody, typeSchema, kindSchema, new Map(localTypes), functionSchema, expectedReturnType, globalNames);
            }
        } else if (stmt.kind === "WhileStatement") {
            checkStatements(stmt.body, typeSchema, kindSchema, new Map(localTypes), functionSchema, expectedReturnType, globalNames);
        } else if (stmt.kind === "ForStatement") {
            if (globalNames.has(stmt.varName)) {
                throw typeError(stmt.filePath, stmt.lineNumber, `for loop variable "${stmt.varName}" shadows global "${stmt.varName}"`);
            }
            const bodyTypes = new Map(localTypes);
            bodyTypes.set(stmt.varName, "int");
            checkStatements(stmt.body, typeSchema, kindSchema, bodyTypes, functionSchema, expectedReturnType, globalNames);
        } else if (stmt.kind === "CallStatement") {
            checkCallStatement(stmt, typeSchema, kindSchema, localTypes, functionSchema);
        } else if (stmt.kind === "ReturnStatement") {
            if (stmt.expr !== null && expectedReturnType !== null) {
                checkValueCompatibility(
                    stmt.expr,
                    expectedReturnType,
                    typeSchema,
                    kindSchema,
                    null,
                    null,
                    "return value",
                    localTypes,
                    functionSchema,
                );
            }
        }
    }
}

function checkCallStatement(stmt, typeSchema, kindSchema, localTypes, functionSchema) {
    const fn = functionSchema.get(stmt.name);
    if (!fn) return;
    if (stmt.args.length !== fn.params.length) {
        throw typeError(
            stmt.filePath,
            stmt.lineNumber,
            `function "${stmt.name}" expects ${fn.params.length} argument(s), got ${stmt.args.length}`,
        );
    }
    for (let i = 0; i < fn.params.length; i++) {
        checkValueCompatibility(
            stmt.args[i],
            fn.params[i].typeName,
            typeSchema,
            kindSchema,
            stmt.filePath,
            stmt.lineNumber,
            `argument ${i + 1} of "${stmt.name}"`,
            localTypes,
            functionSchema,
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

function inferExprType(expr, typeSchema, kindSchema, localTypes, functionSchema = new Map()) {
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
        const leftType = inferExprType(expr.left, typeSchema, kindSchema, localTypes, functionSchema);
        const rightType = inferExprType(expr.right, typeSchema, kindSchema, localTypes, functionSchema);
        return inferConcatType(leftType, rightType, kindSchema);
    }
    if (expr.kind === "EqualsExpr") {
        return "bool";
    }
    if (expr.kind === "LessThanExpr") {
        return "bool";
    }
    if (expr.kind === "LessOrEqualExpr") {
        return "bool";
    }
    if (expr.kind === "AndExpr") {
        return "bool";
    }
    if (expr.kind === "OrExpr") {
        return "bool";
    }
    if (expr.kind === "NotExpr") {
        return "bool";
    }
    if (expr.kind === "MultiplyExpr") {
        const leftType = inferExprType(expr.left, typeSchema, kindSchema, localTypes, functionSchema);
        const rightType = inferExprType(expr.right, typeSchema, kindSchema, localTypes, functionSchema);
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
    if (expr.kind === "CallExpr") {
        const fn = functionSchema.get(expr.name);
        if (!fn || fn.returnType === "void") return null;
        return fn.returnType;
    }
    if (expr.kind === "FunctionRefExpr") {
        return "function";
    }
    if (expr.kind === "IndexExpr") {
        const targetType = inferExprType(expr.target, typeSchema, kindSchema, localTypes, functionSchema);
        const listMatch = targetType && targetType.match(/^list<(.+)>$/);
        return listMatch ? listMatch[1] : null;
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

function checkValueCompatibility(valueNode, fieldTypeName, typeSchema, kindSchema, filePath, lineNumber, context, localTypes = new Map(), functionSchema = new Map()) {
    const inferredType = inferExprType(valueNode, typeSchema, kindSchema, localTypes, functionSchema);

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

module.exports = { checkProgram, serializeWhenExpr };
