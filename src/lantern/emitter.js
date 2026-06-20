const { encode } = require("../strcodec");

// Expressions whose emitted form is already self-delimiting (literals, variable
// names, property-access chains, function calls) and never need extra parens.
const SAFE_ATOM = new Set([
    "StringLiteral", "NumberLiteral", "BooleanLiteral", "NoneLiteral",
    "VariableExpr", "PropertyAccess", "GlobalExpr", "ParenNameExpr", "Concat", "DivideExpr", "CallExpr", "FunctionRefExpr", "FollowExpr", "IndexExpr",
]);

// JS operator precedence for the binary/unary expression kinds we emit.
const EXPR_JS_PREC = {
    PowerExpr: 15,
    MultiplyExpr: 14,
    SubtractExpr: 13,
    LessThanExpr: 12,
    LessOrEqualExpr: 12,
    EqualsExpr: 11,
};

// Emits `expr` wrapped in parens when JS precedence requires it.
//   rightOperand: true when this is the right side of a left-associative op
//     (same precedence also needs parens: `a-(b-c)` ≠ `a-b-c`).
//   leftOfPower: true when this is the left side of `**`; JS disallows any
//     unparenthesized non-atom there, so wrap everything that isn't an atom.
function wrapIfNeeded(expr, parentPrec, globalNames, { rightOperand = false, leftOfPower = false } = {}) {
    if (leftOfPower) {
        // JS forbids an unparenthesized non-atom left of **: -2**n is a SyntaxError.
        const unsafeLeft = !SAFE_ATOM.has(expr.kind)
            || (expr.kind === "NumberLiteral" && expr.value < 0);
        if (unsafeLeft) return `(${emitExpression(expr, globalNames)})`;
    }
    const childPrec = EXPR_JS_PREC[expr.kind];
    if (childPrec === undefined) return emitExpression(expr, globalNames);
    const needsParens = rightOperand ? childPrec <= parentPrec : childPrec < parentPrec;
    return needsParens ? `(${emitExpression(expr, globalNames)})` : emitExpression(expr, globalNames);
}

// Set once at the start of emitProgram and read from statement/expression
// emitters, so they aren't threaded through every emitting function: relation
// field schemas (name -> { fieldName: typeName }), the set of kind names, and
// function parameter types (name -> [typeName]).
let relationFieldSchemas = new Map();
let emitKindNames = new Set();
let functionParamTypes = new Map();
let actionSlotTypes = new Map();
let knownObjectNames = new Set();
// All declared action names (selector universe) and tag -> action-name sets,
// used to resolve a multi-action rule's selector. See devdocs/rulebooks.md.
let allActionNames = [];
let actionTagMembers = new Map();
// Rulebook name -> ordered parameter names, so a `rule RULEBOOK:` contribution
// emits a rule function with the rulebook's parameters in scope.
let rulebookParamNames = new Map();
// Absolute path of the author's game file; phase rules from it sort ahead of
// library rules (order 0 vs 1). See devdocs/rulebooks.md.
let mainFilePath = null;
// When true, player-facing string literals are emitted as lamplighter.decode("…")
// over an encoded payload instead of a plain JS string. Set per build from the
// --encode-strings option; structural strings (names, labels, object refs) are
// never routed through here. See src/strcodec.js.
let encodeStrings = false;

// Emits a player-facing string value, encoded when the build opts in. Used only
// for prose/value literals — not for identifiers, object references, or other
// strings that participate in lookups.
function emitStringLiteral(value) {
    return encodeStrings
        ? `lamplighter.decode(${JSON.stringify(encode(value))})`
        : JSON.stringify(value);
}

// Object and global names are registry keys, but encoding them is still
// behavior-preserving as long as every definition and reference site goes
// through here: decode runs at load, so the runtime key is identical to the
// plaintext build. Used only for object names and global names (--encode-strings
// scope); type/relation/action names and field keys stay plaintext.
function emitName(name) {
    return emitStringLiteral(name);
}

// Emits a `{ fieldName: typeName }` schema, encoding the type-name *values* while
// leaving field-name keys plaintext. Falls back to verbatim JSON in plaintext
// mode so generated output is byte-identical to an unencoded build.
function emitFieldSchema(fields) {
    if (!encodeStrings) return JSON.stringify(fields);
    const pairs = Object.entries(fields).map(([key, typeName]) => `${JSON.stringify(key)}: ${emitName(typeName)}`);
    return `{ ${pairs.join(", ")} }`;
}

// Emits an array of names (e.g. parent type names), each encoded. Same
// plaintext-identical fallback as emitFieldSchema.
function emitNameList(names) {
    const list = names || [];
    if (!encodeStrings) return JSON.stringify(list);
    return `[${list.map((name) => emitName(name)).join(", ")}]`;
}

function emitProgram(programAst, options = {}) {
    const nativeJsContents = options.nativeJsContents || [];
    const globalDeclNodes = programAst.nodes.filter((node) => node.kind === "GlobalDecl");
    const globalAssignNodes = programAst.nodes.filter((node) => node.kind === "GlobalAssign");
    const kindNodes = programAst.nodes.filter((node) => node.kind === "KindDecl");
    const typeNodes = programAst.nodes.filter((node) => node.kind === "TypeDecl");
    const relationNodes = programAst.nodes.filter((node) => node.kind === "RelationDecl");
    const objectNodes = programAst.nodes.filter((node) => node.kind === "ObjectDecl");
    const eventNodes = programAst.nodes.filter((node) => node.kind === "EventHandler");
    const functionNodes = programAst.nodes.filter((node) => node.kind === "FunctionDecl");

    const kindNames = new Set(kindNodes.map((n) => n.name));

    knownObjectNames = new Set(objectNodes.map((n) => n.objectName));
    emitKindNames = kindNames;
    mainFilePath = options.mainFilePath || null;
    encodeStrings = options.encodeStrings === true;
    functionParamTypes = new Map();
    rulebookParamNames = new Map();
    for (const node of programAst.nodes) {
        if (node.kind === "FunctionDecl" || node.kind === "NativeFunctionDecl" || node.kind === "RulebookDecl") {
            functionParamTypes.set(node.name, node.params.map((p) => p.typeName));
        }
        if (node.kind === "RulebookDecl") {
            rulebookParamNames.set(node.name, node.params.map((p) => p.name));
        }
    }
    relationFieldSchemas = new Map();
    for (const relationNode of relationNodes) {
        const schema = {};
        for (const field of relationNode.fields) {
            schema[field.fieldName] = field.typeName;
        }
        relationFieldSchemas.set(relationNode.name, schema);
    }
    const actionNodes = programAst.nodes.filter((node) => node.kind === "ActionDecl");
    actionSlotTypes = new Map();
    allActionNames = actionNodes.map((n) => n.name);
    actionTagMembers = new Map();
    for (const actionNode of actionNodes) {
        actionSlotTypes.set(actionNode.name, new Map(actionNode.slots.map((s) => [s.fieldName, s.typeName])));
        for (const tag of actionNode.tags || []) {
            if (!actionTagMembers.has(tag)) actionTagMembers.set(tag, new Set());
            actionTagMembers.get(tag).add(actionNode.name);
        }
    }

    // Body-only module: no shebang and no runtime require. The sandbox launcher
    // injects `lamplighter` as a context global and is the only supported run
    // path (see devdocs/sandbox.md).
    const lines = [];
    lines.push("/* Generated by Lantern */");
    lines.push("lamplighter.bootstrapBuiltins();");

    for (const jsContent of nativeJsContents) {
        const trimmed = jsContent.trimEnd();
        if (trimmed) {
            lines.push("");
            lines.push(trimmed);
        }
    }

    lines.push("");

    for (const kindNode of kindNodes) {
        lines.push(emitKindDecl(kindNode));
    }

    if (kindNodes.length > 0) {
        lines.push("");
    }

    for (const kindNode of kindNodes) {
        lines.push(`const ${kindNode.name} = lamplighter.kind(${JSON.stringify(kindNode.name)});`);
    }

    if (kindNodes.length > 0) {
        lines.push("");
    }

    // Merge reopened type declarations: multiple TypeDecl nodes with the same name → one defineType call
    const mergedTypes = new Map();
    for (const typeNode of typeNodes) {
        if (!mergedTypes.has(typeNode.name)) {
            mergedTypes.set(typeNode.name, { ...typeNode, fields: [...typeNode.fields] });
        } else {
            mergedTypes.get(typeNode.name).fields.push(...typeNode.fields);
        }
    }

    // An action declaration emits as a type whose parent is the built-in `action`
    // type and whose fields are its slots.
    for (const actionNode of actionNodes) {
        mergedTypes.set(actionNode.name, {
            kind: "TypeDecl",
            name: actionNode.name,
            parents: ["action"],
            fields: [...actionNode.slots],
        });
    }

    for (const typeNode of mergedTypes.values()) {
        lines.push(emitTypeDecl(typeNode));
    }

    if (mergedTypes.size > 0) {
        lines.push("");
    }

    for (const typeNode of mergedTypes.values()) {
        lines.push(`const ${typeNode.name} = lamplighter.type(${emitName(typeNode.name)});`);
    }

    if (mergedTypes.size > 0) {
        lines.push("");
    }

    for (const relationNode of relationNodes) {
        lines.push(emitRelationDecl(relationNode));
    }

    if (relationNodes.length > 0) {
        lines.push("");
    }

    for (const relationNode of relationNodes) {
        lines.push(`const ${relationNode.name} = lamplighter.type(${emitName(relationNode.name)});`);
    }

    if (relationNodes.length > 0) {
        lines.push("");
    }

    for (const objectNode of objectNodes) {
        lines.push(emitObjectDecl(objectNode, mergedTypes));
    }

    // Set object-typed fields after all objects exist so forward references work
    const objectFieldInits = objectNodes.flatMap((n) => emitObjectFieldInits(n, mergedTypes));
    for (const init of objectFieldInits) {
        lines.push(init);
    }

    if (objectNodes.length > 0) {
        lines.push("");
    }

    const relationAssertNodes = programAst.nodes.filter((node) => node.kind === "RelationAssert");
    for (const assertNode of relationAssertNodes) {
        lines.push(emitRelationAssert(assertNode));
    }

    if (relationAssertNodes.length > 0) {
        lines.push("");
    }

    const topLevelRemoveNodes = programAst.nodes.filter(
        (node) => node.kind === "RelationRemove" || node.kind === "DisconnectStatement"
    );
    for (const removeNode of topLevelRemoveNodes) {
        lines.push(
            removeNode.kind === "RelationRemove"
                ? emitRelationRemove(removeNode)
                : emitDisconnect(removeNode)
        );
    }
    if (topLevelRemoveNodes.length > 0) {
        lines.push("");
    }

    for (const globalDeclNode of globalDeclNodes) {
        lines.push(emitGlobalDecl(globalDeclNode));
    }

    if (globalDeclNodes.length > 0) {
        lines.push("");
    }

    for (const globalAssignNode of globalAssignNodes) {
        lines.push(emitGlobalAssign(globalAssignNode));
    }

    if (globalAssignNodes.length > 0) {
        lines.push("");
    }

    const changeHandlerNodes = programAst.nodes.filter((node) => node.kind === "ChangeHandler");
    const relationAddHandlerNodes = programAst.nodes.filter((node) => node.kind === "RelationAddHandler");
    const relationRemoveHandlerNodes = programAst.nodes.filter((node) => node.kind === "RelationRemoveHandler");
    const globalNames = new Set(globalDeclNodes.map((n) => n.name));

    const functionGroups = new Map();
    for (let i = 0; i < functionNodes.length; i++) {
        const node = functionNodes[i];
        if (!functionGroups.has(node.name)) functionGroups.set(node.name, []);
        functionGroups.get(node.name).push({ node, definitionIndex: i });
    }

    for (const [name, overloads] of functionGroups) {
        lines.push(emitFunctionGroup(name, overloads, globalNames));
        lines.push("");
    }

    for (const node of programAst.nodes) {
        if (node.kind !== "RulebookDecl") continue;
        lines.push(emitRulebookDecl(node, globalNames));
        lines.push("");
    }

    for (const eventNode of eventNodes) {
        lines.push(emitEventHandler(eventNode, globalNames));
    }

    for (const changeNode of changeHandlerNodes) {
        lines.push(emitChangeHandler(changeNode, globalNames));
    }

    for (const node of programAst.nodes) {
        if (node.kind !== "PhaseRule") continue;
        lines.push(emitPhaseRule(node, globalNames));
    }

    for (const node of programAst.nodes) {
        if (node.kind !== "RulebookRule") continue;
        lines.push(emitRulebookRule(node, globalNames));
    }

    for (const actionNode of actionNodes) {
        for (const template of (actionNode.templates || [])) {
            // The grammar template (the player-visible command phrasing) is the
            // strongest puzzle spoiler; encode it. Parsed at runtime from the
            // decoded string, so behavior is unchanged.
            lines.push(`lamplighter.registerGrammar(${emitName(actionNode.name)}, ${emitStringLiteral(template)});`);
        }
        const directSlot = actionNode.slots.find((s) => s.direct);
        if (directSlot) {
            lines.push(`lamplighter.setDirectSlot(${emitName(actionNode.name)}, ${JSON.stringify(directSlot.fieldName)});`);
        }
    }

    // `understand "TEMPLATE" as ACTION` — an extra grammar phrasing for an action
    // declared anywhere. Emits the same registerGrammar call an action's own
    // syntax line does (template encoded as a puzzle-phrasing spoiler).
    for (const node of programAst.nodes) {
        if (node.kind !== "UnderstandDecl") continue;
        lines.push(`lamplighter.registerGrammar(${emitName(node.actionName)}, ${emitStringLiteral(node.template)});`);
    }

    for (const node of relationAddHandlerNodes) {
        lines.push(emitRelationAddHandler(node, globalNames));
    }

    for (const node of relationRemoveHandlerNodes) {
        lines.push(emitRelationRemoveHandler(node, globalNames));
    }

    lines.push("");
    lines.push("lamplighter.run();");
    lines.push("");

    return `${lines.join("\n")}`;
}

const PRIMITIVE_TYPES = new Set(["bool", "int", "real", "string"]);

function resolveFieldType(typeName, fieldName, mergedTypes) {
    const visited = new Set();
    function search(name) {
        if (visited.has(name)) return null;
        visited.add(name);
        const typeNode = mergedTypes.get(name);
        if (!typeNode) return null;
        for (const f of typeNode.fields) {
            if (f.fieldName === fieldName) return f.typeName;
        }
        for (const parent of (typeNode.parents || [])) {
            const result = search(parent);
            if (result !== null) return result;
        }
        return null;
    }
    return search(typeName);
}

function isObjectTypedField(field, typeName, mergedTypes) {
    const fieldType = resolveFieldType(typeName, field.fieldName, mergedTypes);
    return fieldType !== null && valueIsObjectRef(field.value, fieldType);
}

function objectRef(objectName) {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(objectName)
        ? objectName
        : `lamplighter.getObject(${emitName(objectName)})`;
}

// Emits getObject for a string-literal object reference, with a compile-time
// check that the name is a declared object.
function checkedGetObject(name, filePath, lineNumber) {
    if (!knownObjectNames.has(name)) {
        throw new Error(`${filePath}:${lineNumber}: unknown object "${name}"`);
    }
    return `lamplighter.getObject(${emitName(name)})`;
}

// A bare object name and a quoted string both parse to a StringLiteral; they are
// told apart by the declared type at the use site. A StringLiteral standing in a
// position whose declared type is an *object* type (not a primitive, kind, list,
// or function) is an object reference. This predicate is the single source of
// that decision — see devdocs/architecture.md ("Known Architectural Issues" → D).
function valueIsObjectRef(valueNode, declaredType) {
    return valueNode.kind === "StringLiteral"
        && declaredType !== undefined
        && declaredType !== "function"
        && !PRIMITIVE_TYPES.has(declaredType)
        && !emitKindNames.has(declaredType)
        && !declaredType.startsWith("list<");
}

// Emits a value appearing in a typed position (field, argument, slot, return).
// Resolves a bare object name to a validated getObject; everything else emits as
// an ordinary expression. The one place the object-vs-string dispatch lives.
function emitObjectOrValue(valueNode, declaredType, filePath, lineNumber, globalNames) {
    if (valueIsObjectRef(valueNode, declaredType)) {
        return checkedGetObject(valueNode.value, filePath, lineNumber);
    }
    return emitExpression(valueNode, globalNames);
}

function emitGlobalDecl(node) {
    const valueExpr = emitObjectOrValue(node.value, node.typeName, node.filePath, node.lineNumber, new Set());
    return `lamplighter.defineGlobal(${emitName(node.name)}, ${valueExpr});`;
}

function emitGlobalAssign(node) {
    return `lamplighter.setGlobal(${emitName(node.name)}, ${emitValue(node.value)});`;
}

function emitKindDecl(node) {
    return `lamplighter.defineKind(${JSON.stringify(node.name)}, ${emitKindExpr(node.kindExpr)});`;
}

function emitKindExpr(expr) {
    if (expr.kind === "EnumExpr") {
        const labelArgs = expr.labels.map((l) => JSON.stringify(l)).join(", ");
        return `lamplighter.enum(${labelArgs})`;
    }
    throw new Error(`Unsupported kind expression kind: ${expr.kind}`);
}

function emitTypeDecl(node) {
    const fields = {};
    const defaultPairs = [];
    for (const field of node.fields) {
        fields[field.fieldName] = field.typeName;
        if (field.defaultValue !== null) {
            // emitValue (not raw JSON) so string defaults honor --encode-strings;
            // behavior is identical in plaintext mode (decode runs at define time).
            defaultPairs.push(`${JSON.stringify(field.fieldName)}: ${emitValue(field.defaultValue)}`);
        }
    }
    const defaultsArg = defaultPairs.length > 0 ? `, { ${defaultPairs.join(", ")} }` : "";
    return `lamplighter.defineType(${emitName(node.name)}, ${emitNameList(node.parents)}, ${emitFieldSchema(fields)}${defaultsArg});`;
}

function emitRelationDecl(node) {
    const fields = {};
    for (const field of node.fields) {
        fields[field.fieldName] = field.typeName;
    }
    const syntaxArg = node.syntax === null ? "null" : emitStringLiteral(node.syntax);
    return `lamplighter.defineRelation(${emitName(node.name)}, ${emitFieldSchema(fields)}, ${syntaxArg}, ${JSON.stringify(node.invertedFields || [])}, ${JSON.stringify(node.sourceField)}, ${JSON.stringify(node.targetField)});`;
}

function emitRelationAssert(node, globalNames = new Set()) {
    const schema = relationFieldSchemas.get(node.relationName) || {};
    const pairs = node.fields.map((field) => {
        const valueExpr = emitObjectOrValue(field.value, schema[field.fieldName], field.filePath, field.lineNumber, globalNames);
        return `${JSON.stringify(field.fieldName)}: ${valueExpr}`;
    });
    const opts = [];
    if (node.instanceName) opts.push(`name: ${JSON.stringify(node.instanceName)}`);
    if (node.bidi) opts.push("bidi: true");
    const optionsArg = opts.length > 0 ? `, { ${opts.join(", ")} }` : "";
    return `lamplighter.addRelation(${emitName(node.relationName)}, { ${pairs.join(", ")} }${optionsArg});`;
}

function emitRelationRemove(node, globalNames = new Set()) {
    const schema = relationFieldSchemas.get(node.relationName) || {};
    const specified = new Map(node.fields.map((f) => [f.fieldName, f]));
    const pairs = Object.keys(schema).map((fieldName) => {
        const field = specified.get(fieldName);
        const valueExpr = (!field || field.value.kind === "WildcardExpr")
            ? "lamplighter.ANY"
            : emitObjectOrValue(field.value, schema[fieldName], field.filePath, field.lineNumber, globalNames);
        return `${JSON.stringify(fieldName)}: ${valueExpr}`;
    });
    return `lamplighter.removeRelation(${emitName(node.relationName)}, { ${pairs.join(", ")} });`;
}

function emitDisconnect(node) {
    return `lamplighter.removeRelationByName(${JSON.stringify(node.instanceName)});`;
}

// Emits a call's argument list. A bare object name parses to a StringLiteral
// (indistinguishable from a quoted string in the AST), so — as with object field
// values — when the parameter is object-typed it is resolved via getObject.
function emitCallArgs(functionName, args, globalNames, filePath, lineNumber) {
    const paramTypes = functionParamTypes.get(functionName) || [];
    return args
        .map((arg, i) => emitObjectOrValue(arg, paramTypes[i], filePath, lineNumber, globalNames))
        .join(", ");
}

function emitRelationQuery(node, globalNames) {
    const schema = relationFieldSchemas.get(node.relationName) || {};
    const pairs = node.fields.map((field) => {
        const valueExpr = field.value.kind === "WildcardExpr"
            ? "lamplighter.ANY"
            : emitObjectOrValue(field.value, schema[field.fieldName], node.filePath, node.lineNumber, globalNames);
        return `${JSON.stringify(field.fieldName)}: ${valueExpr}`;
    });
    const mapping = `{ ${pairs.join(", ")} }`;
    if (!node.outputField) {
        return `(lamplighter.queryRelation(${emitName(node.relationName)}, ${mapping}).length > 0)`;
    }
    return `lamplighter.queryRelationValue(${emitName(node.relationName)}, ${mapping}, ${JSON.stringify(node.outputField)}, ${JSON.stringify(node.outputMode)})`;
}

function emitObjectDecl(node, mergedTypes = new Map()) {
    const fields = {};
    for (const field of node.fields) {
        if (!isObjectTypedField(field, node.typeName, mergedTypes)) {
            fields[field.fieldName] = emitValue(field.value);
        }
    }

    const pairs = Object.entries(fields).map(([key, value]) => `${JSON.stringify(key)}: ${value}`);
    const call = `lamplighter.createObject(${emitName(node.typeName)}, ${emitName(node.objectName)}, { ${pairs.join(", ")} })`;

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(node.objectName)) {
        return `const ${node.objectName} = ${call};`;
    }
    return `${call};`;
}

function emitObjectFieldInits(node, mergedTypes) {
    return node.fields
        .filter((field) => isObjectTypedField(field, node.typeName, mergedTypes))
        .map((field) => `${objectRef(node.objectName)}.${field.fieldName} = ${checkedGetObject(field.value.value, field.filePath, field.lineNumber)};`);
}

function emitValue(valueNode) {
    if (valueNode.kind === "StringLiteral") {
        return emitStringLiteral(valueNode.value);
    }
    if (valueNode.kind === "BooleanLiteral") {
        return valueNode.value ? "true" : "false";
    }
    if (valueNode.kind === "NumberLiteral") {
        return String(valueNode.value);
    }
    if (valueNode.kind === "NoneLiteral") {
        return "null";
    }
    throw new Error(`Unsupported value kind: ${valueNode.kind}`);
}

function emitFunctionDecl(node, globalNames = new Set()) {
    const paramList = node.params.map((p) => p.name).join(", ");
    const bodyLines = emitStatementList(node.body, 1, globalNames);
    return [
        `function ${node.name}(${paramList}) {`,
        ...bodyLines,
        "}",
    ].join("\n");
}

function computeSpecificity(expr) {
    if (expr.kind === "AndExpr") return computeSpecificity(expr.left) + computeSpecificity(expr.right);
    if (expr.kind === "OrExpr") return Math.max(computeSpecificity(expr.left), computeSpecificity(expr.right));
    if (expr.kind === "NotExpr") return computeSpecificity(expr.expr);
    if (expr.kind === "RelationQuery") return expr.fields.filter((f) => f.value.kind !== "WildcardExpr").length;
    return 1;
}

function emitFunctionGroup(name, overloads, globalNames) {
    const unconditional = overloads.find((o) => o.node.whenExpr === null);
    const conditionals = overloads
        .filter((o) => o.node.whenExpr !== null)
        .map((o) => ({ node: o.node, index: o.definitionIndex, specificity: computeSpecificity(o.node.whenExpr) }))
        .sort((a, b) => b.specificity !== a.specificity ? b.specificity - a.specificity : b.index - a.index);

    const referenceNode = (unconditional || conditionals[0]).node;
    const paramList = referenceNode.params.map((p) => p.name).join(", ");

    const lines = [];
    lines.push(`function ${name}(${paramList}) {`);

    if (conditionals.length === 0) {
        lines.push(...emitStatementList(referenceNode.body, 1, globalNames));
    } else {
        const [first, ...rest] = conditionals;
        lines.push(`    if (${emitExpression(first.node.whenExpr, globalNames)}) {`);
        lines.push(...emitStatementList(first.node.body, 2, globalNames));
        for (const cond of rest) {
            lines.push(`    } else if (${emitExpression(cond.node.whenExpr, globalNames)}) {`);
            lines.push(...emitStatementList(cond.node.body, 2, globalNames));
        }
        lines.push(`    } else {`);
        if (unconditional) {
            lines.push(...emitStatementList(unconditional.node.body, 2, globalNames));
        } else {
            lines.push(`        throw new Error(\`no matching version of ${name} for current game state\`);`);
        }
        lines.push(`    }`);
    }

    lines.push("}");
    return lines.join("\n");
}

// A rulebook compiles to a plain (hoisted) JS function: each rule is an
// A named rulebook compiles to (1) a `registerRulebookRule` call per `when` rule
// in its declaration block, and (2) a dispatcher function that runs the registry
// (`runRulebook`) and falls back to the default. Routing every rule through the
// registry lets a game file contribute rules to a library rulebook via
// `rule RULEBOOK:` (see emitRulebookRule). `stop EXPR` in a rule emits a `return
// EXPR` (stop with that value); a bare `stop` emits `return HALT` (fall back to
// the default). `follow NAME(args)` is an ordinary call to the dispatcher.
function emitRulebookDecl(node, globalNames = new Set()) {
    const order = node.filePath === mainFilePath ? 0 : 1;
    const paramNames = node.params.map((p) => p.name);
    const lines = [];
    for (const rule of node.rules) {
        lines.push(emitRulebookRuleFn(node.name, paramNames, rule.whenExpr, rule.body, order, globalNames));
    }
    const defaultExpr = emitExpression(node.defaultExpr, globalNames);
    lines.push(`function ${node.name}(${paramNames.join(", ")}) {`);
    lines.push(`    const __r = lamplighter.runRulebook(${JSON.stringify(node.name)}, [${paramNames.join(", ")}]);`);
    lines.push(`    if (__r.stopped) return __r.value;`);
    lines.push(`    return ${defaultExpr};`);
    lines.push("}");
    return lines.join("\n");
}

// A `rule RULEBOOK [when COND]:` contribution from any file. Author-file rules
// register at order 0 (ahead of the library declaration's order-1 rules).
function emitRulebookRule(node, globalNames = new Set()) {
    const order = node.filePath === mainFilePath ? 0 : 1;
    const paramNames = rulebookParamNames.get(node.rulebookName) || [];
    return emitRulebookRuleFn(node.rulebookName, paramNames, node.whenExpr, node.body, order, globalNames);
}

// Shared emit for a single rulebook rule (declaration or contribution): a
// `registerRulebookRule` call wrapping the guard + body as a rule function.
function emitRulebookRuleFn(rulebookName, paramNames, whenExpr, body, order, globalNames) {
    const lines = [`lamplighter.registerRulebookRule(${JSON.stringify(rulebookName)}, (${paramNames.join(", ")}) => {`];
    if (whenExpr) {
        lines.push(`    if (!(${emitExpression(whenExpr, globalNames)})) return;`);
    }
    lines.push(...emitStatementList(body, 1, globalNames, "return lamplighter.HALT;"));
    lines.push(`}, ${order});`);
    return lines.join("\n");
}

function emitEventHandler(node, globalNames = new Set()) {
    const bodyLines = emitStatementList(node.body, 1, globalNames);
    return [
        `lamplighter.onEvent(${JSON.stringify(node.eventName)}, () => {`,
        ...bodyLines,
        "});",
    ].join("\n");
}

// A phase rule registers a function into the action's rulebook band. The
// function receives the action instance as `self`; a `stop EXPR` emits as
// `return EXPR` (stop with that outcome), a bare `stop` as `return
// lamplighter.HALT` (halt the band), and a fall-through (undefined) continues to
// the next rule. The trailing order arg (0 author, 1 library) sorts author rules
// first so they can suppress library ones.
function emitPhaseRule(node, globalNames = new Set()) {
    const order = node.filePath === mainFilePath ? 0 : 1;
    // A multi-action selector expands to one registration per resolved action;
    // the guard and body emit identically for each. See devdocs/rulebooks.md.
    const targets = node.selector
        ? resolveSelector(node.selector)
        : [node.actionName];
    const bodyLines = [];
    if (node.whenExpr) {
        bodyLines.push(`    if (!(${emitExpression(node.whenExpr, globalNames)})) return;`);
    }
    bodyLines.push(...emitStatementList(node.body, 1, globalNames, "return lamplighter.HALT;"));
    const lines = [];
    for (const actionName of targets) {
        lines.push(`lamplighter.registerActionRule(${emitName(actionName)}, ${JSON.stringify(node.band)}, (self) => {`);
        lines.push(...bodyLines);
        lines.push(`}, ${order});`);
    }
    return lines.join("\n");
}

// Resolves a selector AST to a sorted array of action names. Each atom denotes a
// set; `and`/`or`/`not` are set ops over the action universe. Throws a compile
// error on an unknown atom or an empty result.
function resolveSelector(node) {
    const universe = new Set(allActionNames);
    function resolveSet(n) {
        if (n.kind === "SelAny") return new Set(universe);
        if (n.kind === "SelAtom") {
            if (universe.has(n.name)) return new Set([n.name]);
            if (actionTagMembers.has(n.name)) return new Set(actionTagMembers.get(n.name));
            throw new Error(`${n.filePath}:${n.lineNumber}: unknown action or tag "${n.name}"`);
        }
        if (n.kind === "SelNot") {
            const inner = resolveSet(n.operand);
            return new Set([...universe].filter((a) => !inner.has(a)));
        }
        if (n.kind === "SelAnd") {
            const l = resolveSet(n.left);
            const r = resolveSet(n.right);
            return new Set([...l].filter((a) => r.has(a)));
        }
        if (n.kind === "SelOr") {
            return new Set([...resolveSet(n.left), ...resolveSet(n.right)]);
        }
        throw new Error(`Unsupported selector node: ${n.kind}`);
    }
    const result = resolveSet(node);
    if (result.size === 0) {
        throw new Error(`${node.filePath}:${node.lineNumber}: action selector matches no actions`);
    }
    return [...result].sort();
}

function emitChangeHandler(node, globalNames = new Set()) {
    const bodyLines = emitStatementList(node.body, 1, globalNames);
    return [
        `lamplighter.registerChangeHandler(${emitName(node.typeName)}, ${JSON.stringify(node.fieldName)}, (self) => {`,
        ...bodyLines,
        "});",
    ].join("\n");
}

function emitRelationAddHandler(node, globalNames = new Set()) {
    const bodyLines = emitStatementList(node.body, 1, globalNames);
    return [
        `lamplighter.registerRelationAddHandler(${emitName(node.relationName)}, (self) => {`,
        ...bodyLines,
        "});",
    ].join("\n");
}

function emitRelationRemoveHandler(node, globalNames = new Set()) {
    const bodyLines = emitStatementList(node.body, 1, globalNames);
    return [
        `lamplighter.registerRelationRemoveHandler(${emitName(node.relationName)}, (self) => {`,
        ...bodyLines,
        "});",
    ].join("\n");
}

// `bareStop` is the JS a bare `stop` emits, which depends on the enclosing
// construct: `return lamplighter.HALT;` inside a phase/rulebook rule, and a plain
// `return;` elsewhere. It is threaded as a parameter (rather than module state)
// so emission has no hidden context to save and restore.
function emitStatementList(statements, indentLevel, globalNames = new Set(), bareStop = "return;") {
    return statements.flatMap((statement) => emitStatementLines(statement, indentLevel, globalNames, bareStop));
}

function emitStatementLines(statement, indentLevel, globalNames = new Set(), bareStop = "return;") {
    const indent = "    ".repeat(indentLevel);

    if (statement.kind === "LetStatement") {
        return [`${indent}let ${statement.name} = ${emitExpression(statement.expr, globalNames)};`];
    }
    if (statement.kind === "PrintStatement") {
        return [`${indent}lamplighter.print(${emitExpression(statement.expr, globalNames)});`];
    }
    if (statement.kind === "AssignStatement") {
        const [head, ...tail] = statement.targetChain;
        const valueExpr = emitExpression(statement.expr, globalNames);
        if (tail.length === 0 && globalNames.has(head)) {
            return [`${indent}lamplighter.setGlobal(${emitName(head)}, ${valueExpr});`];
        }
        const headExpr = globalNames.has(head) ? `lamplighter.getGlobal(${emitName(head)})` : head;
        if (tail.length === 0) {
            return [`${indent}${head} = ${valueExpr};`];
        }
        const objExpr = tail.length === 1 ? headExpr : `${headExpr}.${tail.slice(0, -1).join(".")}`;
        const fieldName = tail[tail.length - 1];
        return [`${indent}lamplighter.setField(${objExpr}, ${JSON.stringify(fieldName)}, ${valueExpr});`];
    }
    if (statement.kind === "ErrorStatement") {
        return [`${indent}lamplighter.error(${emitExpression(statement.expr, globalNames)});`];
    }
    if (statement.kind === "DispatchStatement") {
        return [`${indent}lamplighter.dispatch(${JSON.stringify(statement.eventName)});`];
    }
    if (statement.kind === "IfStatement") {
        const lines = [`${indent}if (${emitExpression(statement.condition, globalNames)}) {`];
        lines.push(...emitStatementList(statement.thenBody, indentLevel + 1, globalNames, bareStop));
        lines.push(`${indent}}`);

        if (statement.elseBody) {
            lines[lines.length - 1] = `${indent}} else {`;
            lines.push(...emitStatementList(statement.elseBody, indentLevel + 1, globalNames, bareStop));
            lines.push(`${indent}}`);
        }

        return lines;
    }
    if (statement.kind === "BreakStatement") {
        return [`${indent}break;`];
    }
    if (statement.kind === "ForStatement") {
        const start = emitExpression(statement.start, globalNames);
        const finish = emitExpression(statement.finish, globalNames);
        const step = emitExpression(statement.step, globalNames);
        const v = statement.varName;
        const lines = [`${indent}for (let ${v} = ${start}; ${v} <= ${finish}; ${v} += ${step}) {`];
        lines.push(...emitStatementList(statement.body, indentLevel + 1, globalNames, bareStop));
        lines.push(`${indent}}`);
        return lines;
    }
    if (statement.kind === "ForEachStatement") {
        const listExpr = emitExpression(statement.listExpr, globalNames);
        const v = statement.varName;
        const lines = [`${indent}for (const ${v} of lamplighter.listItems(${listExpr})) {`];
        lines.push(...emitStatementList(statement.body, indentLevel + 1, globalNames, bareStop));
        lines.push(`${indent}}`);
        return lines;
    }
    if (statement.kind === "WhileStatement") {
        const lines = [`${indent}while (${emitExpression(statement.condition, globalNames)}) {`];
        lines.push(...emitStatementList(statement.body, indentLevel + 1, globalNames, bareStop));
        lines.push(`${indent}}`);
        return lines;
    }
    if (statement.kind === "RelationAssert") {
        return [`${indent}${emitRelationAssert(statement, globalNames)}`];
    }
    if (statement.kind === "RelationRemove") {
        return [`${indent}${emitRelationRemove(statement, globalNames)}`];
    }
    if (statement.kind === "DisconnectStatement") {
        return [`${indent}${emitDisconnect(statement)}`];
    }
    if (statement.kind === "CallStatement") {
        const argExprs = emitCallArgs(statement.name, statement.args, globalNames, statement.filePath, statement.lineNumber);
        return [`${indent}${statement.name}(${argExprs});`];
    }
    if (statement.kind === "ReturnStatement") {
        if (statement.expr === null) return [`${indent}return;`];
        return [`${indent}return ${emitExpression(statement.expr, globalNames)};`];
    }
    if (statement.kind === "StopStatement") {
        if (statement.expr === null) return [`${indent}${bareStop}`];
        if (statement.reason) {
            return [
                `${indent}self.reason = ${emitExpression(statement.reason, globalNames)};`,
                `${indent}return ${emitExpression(statement.expr, globalNames)};`,
            ];
        }
        return [`${indent}return ${emitExpression(statement.expr, globalNames)};`];
    }
    if (statement.kind === "FollowStatement") {
        const argExprs = emitCallArgs(statement.name, statement.args, globalNames, statement.filePath, statement.lineNumber);
        return [`${indent}${statement.name}(${argExprs});`];
    }
    if (statement.kind === "TryStatement") {
        return [`${indent}${emitTryCall(statement, globalNames)};`];
    }
    throw new Error(`Unsupported statement kind: ${statement.kind}`);
}

// Emits the `runAction(name, instance)` call for a `try`, shared by the
// statement form (outcome discarded) and the `let x = try` expression form
// (outcome captured).
function emitTryCall(node, globalNames = new Set()) {
    const slotTypes = actionSlotTypes.get(node.actionName) || new Map();
    const pairs = node.fields.map((field) => {
        const valueExpr = emitObjectOrValue(field.value, slotTypes.get(field.fieldName), field.filePath, field.lineNumber, globalNames);
        return `${JSON.stringify(field.fieldName)}: ${valueExpr}`;
    });
    const instance = `{ "type": ${emitName(node.actionName)}, "action": ${emitName(node.actionName)}${pairs.length ? ", " + pairs.join(", ") : ""} }`;
    const opts = node.silent ? `, { silent: true }` : ``;
    return `lamplighter.runAction(${emitName(node.actionName)}, ${instance}${opts})`;
}

function emitExpression(expr, globalNames = new Set()) {
    if (expr.kind === "StringLiteral") {
        return emitStringLiteral(expr.value);
    }
    if (expr.kind === "VariableExpr") {
        return expr.name;
    }
    if (expr.kind === "BooleanLiteral") {
        return expr.value ? "true" : "false";
    }
    if (expr.kind === "NumberLiteral") {
        return String(expr.value);
    }
    if (expr.kind === "IndexExpr") {
        return `${emitExpression(expr.target, globalNames)}.items[${emitExpression(expr.index, globalNames)}]`;
    }
    if (expr.kind === "PropertyAccess") {
        const [head, ...tail] = expr.chain;
        const headExpr = globalNames.has(head) ? `lamplighter.getGlobal(${emitName(head)})` : head;
        return tail.length === 0 ? headExpr : `${headExpr}.${tail.join(".")}`;
    }
    if (expr.kind === "Concat") {
        return `lamplighter.concat(${emitExpression(expr.left, globalNames)}, ${emitExpression(expr.right, globalNames)})`;
    }
    if (expr.kind === "EqualsExpr") {
        return `${emitExpression(expr.left, globalNames)} === ${emitExpression(expr.right, globalNames)}`;
    }
    if (expr.kind === "LessThanExpr") {
        return `${emitExpression(expr.left, globalNames)} < ${emitExpression(expr.right, globalNames)}`;
    }
    if (expr.kind === "LessOrEqualExpr") {
        return `${emitExpression(expr.left, globalNames)} <= ${emitExpression(expr.right, globalNames)}`;
    }
    if (expr.kind === "MultiplyExpr") {
        return `${wrapIfNeeded(expr.left, 14, globalNames)} * ${wrapIfNeeded(expr.right, 14, globalNames, { rightOperand: true })}`;
    }
    if (expr.kind === "NegateExpr") {
        return `-(${emitExpression(expr.expr, globalNames)})`;
    }
    if (expr.kind === "SubtractExpr") {
        return `${wrapIfNeeded(expr.left, 13, globalNames)} - ${wrapIfNeeded(expr.right, 13, globalNames, { rightOperand: true })}`;
    }
    if (expr.kind === "DivideExpr") {
        return `lamplighter.divide(${emitExpression(expr.left, globalNames)}, ${emitExpression(expr.right, globalNames)})`;
    }
    if (expr.kind === "PowerExpr") {
        return `${wrapIfNeeded(expr.left, 15, globalNames, { leftOfPower: true })} ** ${wrapIfNeeded(expr.right, 15, globalNames)}`;
    }
    if (expr.kind === "NoneLiteral") {
        return "null";
    }
    if (expr.kind === "GlobalExpr") {
        return `lamplighter.getGlobal(${emitName(expr.name)})`;
    }
    if (expr.kind === "ParenNameExpr") {
        const base = `lamplighter.getObject(${emitName(expr.objectName)})`;
        return expr.fieldChain.length === 0 ? base : `${base}.${expr.fieldChain.join(".")}`;
    }
    if (expr.kind === "CallExpr") {
        return `${expr.name}(${emitCallArgs(expr.name, expr.args, globalNames, expr.filePath, expr.lineNumber)})`;
    }
    if (expr.kind === "FunctionRefExpr") {
        return expr.name;
    }
    if (expr.kind === "FollowExpr") {
        return `${expr.name}(${emitCallArgs(expr.name, expr.args, globalNames, expr.filePath, expr.lineNumber)})`;
    }
    if (expr.kind === "TryExpr") {
        return emitTryCall(expr, globalNames);
    }
    if (expr.kind === "AndExpr") {
        return `(${emitExpression(expr.left, globalNames)} && ${emitExpression(expr.right, globalNames)})`;
    }
    if (expr.kind === "OrExpr") {
        return `(${emitExpression(expr.left, globalNames)} || ${emitExpression(expr.right, globalNames)})`;
    }
    if (expr.kind === "NotExpr") {
        return `!(${emitExpression(expr.expr, globalNames)})`;
    }
    if (expr.kind === "RelationQuery") {
        return emitRelationQuery(expr, globalNames);
    }
    throw new Error(`Unsupported expression kind: ${expr.kind}`);
}

module.exports = {
    emitProgram,
};
