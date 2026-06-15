const PRIMITIVE_TYPES = new Set(["string", "int", "bool", "real"]);

// Relation field schemas (relationName -> Map(fieldName -> typeName)), set at the
// start of checkProgram so inferExprType can type value queries by their output
// slot. Module-scoped to avoid threading it through every inference call.
let relationSchema = new Map();

// Rulebook signatures (name -> { params, returnType }), set at the start of
// checkProgram so inferExprType can type a `follow` expression by the rulebook's
// result type. Module-scoped, mirroring relationSchema.
let rulebookSchema = new Map();

function buildRelationSchema(nodes) {
    const schema = new Map();
    for (const node of nodes) {
        if (node.kind !== "RelationDecl") continue;
        schema.set(node.name, new Map(node.fields.map((f) => [f.fieldName, f.typeName])));
    }
    return schema;
}

function buildRulebookSchema(nodes) {
    const schema = new Map();
    for (const node of nodes) {
        if (node.kind !== "RulebookDecl") continue;
        schema.set(node.name, { params: node.params, returnType: node.resultType });
    }
    return schema;
}

function checkProgram(programAst, options = {}) {
    const nativeFunctionNames = options.nativeFunctionNames || new Set();
    relationSchema = buildRelationSchema(programAst.nodes);
    rulebookSchema = buildRulebookSchema(programAst.nodes);
    const typeSchema = buildTypeSchema(programAst.nodes);
    const kindSchema = buildKindSchema(programAst.nodes);
    const globalTypes = buildGlobalTypeSchema(programAst.nodes);
    const functionSchema = buildFunctionSchema(programAst.nodes);
    const globalNames = new Set(globalTypes.keys());

    checkNativeVsLampConflicts(programAst.nodes);
    checkNativeFunctions(programAst.nodes, nativeFunctionNames);
    checkFunctionOverloads(programAst.nodes, typeSchema, kindSchema, functionSchema);
    checkRelationDecls(programAst.nodes, typeSchema);

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
        } else if (node.kind === "RelationAddHandler" || node.kind === "RelationRemoveHandler") {
            const localTypes = new Map([["self", node.relationName]]);
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
        } else if (node.kind === "RulebookDecl") {
            checkRulebookDecl(node, typeSchema, kindSchema, functionSchema, globalNames);
        }
    }
}

function checkRulebookDecl(node, typeSchema, kindSchema, functionSchema, globalNames) {
    for (const p of node.params) {
        if (globalNames.has(p.name)) {
            throw typeError(node.filePath, node.lineNumber, `parameter "${p.name}" shadows global "${p.name}"`);
        }
    }
    const paramTypes = new Map(node.params.map((p) => [p.name, p.typeName]));

    checkExprCalls(node.defaultExpr, typeSchema, kindSchema, paramTypes, functionSchema);
    checkValueCompatibility(
        node.defaultExpr,
        node.resultType,
        typeSchema,
        kindSchema,
        node.filePath,
        node.lineNumber,
        `default of rulebook "${node.name}"`,
        paramTypes,
        functionSchema,
    );

    // Each rule's guard must be boolean; its body may `stop` a value, which is
    // checked against the result type (expectedReturnType) by checkStatements.
    for (const rule of node.rules) {
        checkExprCalls(rule.whenExpr, typeSchema, kindSchema, paramTypes, functionSchema);
        const guardType = inferExprType(rule.whenExpr, typeSchema, kindSchema, paramTypes, functionSchema);
        if (guardType !== null && guardType !== "bool") {
            throw typeError(node.filePath, node.lineNumber, `rule guard in rulebook "${node.name}" must be boolean`);
        }
        checkStatements(rule.body, typeSchema, kindSchema, new Map(paramTypes), functionSchema, node.resultType, globalNames);
    }
}

function checkRelationDecls(nodes, typeSchema) {
    for (const node of nodes) {
        if (node.kind !== "RelationDecl") continue;
        const fieldTypeByName = new Map(node.fields.map((f) => [f.fieldName, f.typeName]));
        for (const invertedName of (node.invertedFields || [])) {
            const fieldType = fieldTypeByName.get(invertedName);
            if (getAllFields(fieldType, typeSchema).get("inverse") !== fieldType) {
                throw typeError(
                    node.filePath,
                    node.lineNumber,
                    `inverted field "${invertedName}" requires type "${fieldType}" to declare an "inverse" field of type "${fieldType}"`,
                );
            }
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
    if (expr.kind === "WildcardExpr") return "_";
    if (expr.kind === "RelationQuery") {
        const slots = expr.fields.map((f) => `${f.fieldName}:${serializeWhenExpr(f.value)}`).join(",");
        return `query:${expr.relationName}(${slots})`;
    }
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
        for (const subExpr of directSubExprs(stmt)) {
            checkExprCalls(subExpr, typeSchema, kindSchema, localTypes, functionSchema);
        }
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
        } else if (stmt.kind === "FollowStatement") {
            checkFollowCall(stmt, typeSchema, kindSchema, localTypes, functionSchema);
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
        } else if (stmt.kind === "StopStatement") {
            if (stmt.expr !== null && expectedReturnType !== null) {
                checkValueCompatibility(
                    stmt.expr,
                    expectedReturnType,
                    typeSchema,
                    kindSchema,
                    stmt.filePath,
                    stmt.lineNumber,
                    "stop value",
                    localTypes,
                    functionSchema,
                );
            }
        }
    }
}

// Shared argument-count and per-argument-type check for a function call or a
// rulebook `follow`. `kindLabel` ("function"/"rulebook") shapes the message.
function checkCallArgs(name, args, sig, kindLabel, filePath, lineNumber, typeSchema, kindSchema, localTypes, functionSchema) {
    if (args.length !== sig.params.length) {
        throw typeError(
            filePath,
            lineNumber,
            `${kindLabel} "${name}" expects ${sig.params.length} argument(s), got ${args.length}`,
        );
    }
    for (let i = 0; i < sig.params.length; i++) {
        checkValueCompatibility(
            args[i],
            sig.params[i].typeName,
            typeSchema,
            kindSchema,
            filePath,
            lineNumber,
            `argument ${i + 1} of "${name}"`,
            localTypes,
            functionSchema,
        );
    }
}

function checkFollowCall(stmt, typeSchema, kindSchema, localTypes, functionSchema) {
    const rb = rulebookSchema.get(stmt.name);
    if (!rb) {
        throw typeError(stmt.filePath, stmt.lineNumber, `unknown rulebook "${stmt.name}"`);
    }
    checkCallArgs(stmt.name, stmt.args, rb, "rulebook", stmt.filePath, stmt.lineNumber, typeSchema, kindSchema, localTypes, functionSchema);
}

function checkCallStatement(stmt, typeSchema, kindSchema, localTypes, functionSchema) {
    const fn = functionSchema.get(stmt.name);
    if (!fn) return;
    checkCallArgs(stmt.name, stmt.args, fn, "function", stmt.filePath, stmt.lineNumber, typeSchema, kindSchema, localTypes, functionSchema);
}

// Recursively validates every call/follow embedded in an expression — the
// expression-position counterpart to the statement-level checks above, so
// `print follow f(1, 2)` and `x == g(a)` are checked the same as `f(...)` and
// `follow f(...)` statements. Unknown function names stay lenient (natives,
// forward refs); an unknown rulebook is an error, matching follow-statement
// behavior.
function checkExprCalls(expr, typeSchema, kindSchema, localTypes, functionSchema) {
    if (!expr || typeof expr !== "object") return;
    if (expr.kind === "CallExpr") {
        const fn = functionSchema.get(expr.name);
        if (fn) {
            checkCallArgs(expr.name, expr.args, fn, "function", expr.filePath, expr.lineNumber, typeSchema, kindSchema, localTypes, functionSchema);
        }
    } else if (expr.kind === "FollowExpr") {
        const rb = rulebookSchema.get(expr.name);
        if (!rb) {
            throw typeError(expr.filePath, expr.lineNumber, `unknown rulebook "${expr.name}"`);
        }
        checkCallArgs(expr.name, expr.args, rb, "rulebook", expr.filePath, expr.lineNumber, typeSchema, kindSchema, localTypes, functionSchema);
    }
    for (const key of ["left", "right", "expr", "target", "index"]) {
        if (expr[key]) checkExprCalls(expr[key], typeSchema, kindSchema, localTypes, functionSchema);
    }
    if (Array.isArray(expr.args)) {
        for (const arg of expr.args) checkExprCalls(arg, typeSchema, kindSchema, localTypes, functionSchema);
    }
    if (Array.isArray(expr.fields)) {
        for (const field of expr.fields) {
            if (field && field.value) checkExprCalls(field.value, typeSchema, kindSchema, localTypes, functionSchema);
        }
    }
}

// The immediate expression children of a statement (not its nested statement
// blocks, which checkStatements recurses into separately).
function directSubExprs(stmt) {
    switch (stmt.kind) {
        case "LetStatement":
        case "PrintStatement":
        case "AssignStatement":
        case "ErrorStatement":
            return [stmt.expr];
        case "ReturnStatement":
        case "StopStatement":
            return stmt.expr ? [stmt.expr] : [];
        case "IfStatement":
        case "WhileStatement":
            return [stmt.condition];
        case "ForStatement":
            return [stmt.start, stmt.finish, stmt.step];
        case "CallStatement":
        case "FollowStatement":
            return stmt.args;
        default:
            return [];
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
    if (expr.kind === "RelationQuery") {
        if (!expr.outputField) {
            return "bool";
        }
        const fields = relationSchema.get(expr.relationName);
        const fieldType = fields ? fields.get(expr.outputField) : null;
        if (!fieldType) {
            return null;
        }
        return expr.outputMode === "all" ? `list<${fieldType}>` : fieldType;
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
    if (expr.kind === "FollowExpr") {
        const rb = rulebookSchema.get(expr.name);
        return rb ? rb.returnType : null;
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
