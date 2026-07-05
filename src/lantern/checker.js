const { coerceName } = require("./tokenizer");
const { resolveSelector } = require("./selector");

const PRIMITIVE_TYPES = new Set(["string", "int", "bool", "real", "text"]);

// Runtime-bootstrapped types (bootstrapBuiltins) that are not declared as TypeDecl
// nodes, so buildTypeSchema never sees them — but they are still valid targets for
// an `is` type test.
const BUILTIN_TYPES = new Set(["object", "type", "event", "string", "int", "bool", "real", "list", "action"]);

// Relation field schemas (relationName -> Map(fieldName -> typeName)), set at the
// start of checkProgram so inferExprType can type value queries by their output
// slot. Module-scoped to avoid threading it through every inference call.
let relationSchema = new Map();

// Rulebook signatures (name -> { params, returnType }), set at the start of
// checkProgram so inferExprType can type a `follow` expression by the rulebook's
// result type. Module-scoped, mirroring relationSchema.
let rulebookSchema = new Map();

// Action slot schemas (actionName -> Map(slotName -> typeName)), set at the start
// of checkProgram for `try` and phase-rule validation. Module-scoped, mirroring
// relationSchema/rulebookSchema.
let actionSchema = new Map();

// Tag -> Set(actionName), built alongside actionSchema, for resolving and
// validating multi-action rule selectors. See devdocs/rulebooks.md.
let actionTagSchema = new Map();

// Every declared object name (coerced), used to flag a bare name that resolves to an
// object reference but names no declared object — e.g. a mistyped `stop failed` reason
// (reasons are auto-created singletons, so a typo silently mints a distinct one).
let declaredObjectNames = new Set();

function buildActionTagSchema(nodes) {
    const schema = new Map();
    for (const node of nodes) {
        if (node.kind !== "ActionDecl") continue;
        for (const tag of node.tags || []) {
            if (!schema.has(tag)) schema.set(tag, new Set());
            schema.get(tag).add(node.name);
        }
    }
    return schema;
}

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

function buildActionSchema(nodes) {
    const schema = new Map();
    for (const node of nodes) {
        if (node.kind !== "ActionDecl") continue;
        schema.set(node.name, new Map(node.slots.map((s) => [s.fieldName, s.typeName])));
    }
    return schema;
}

function checkProgram(programAst, options = {}) {
    const nativeFunctionNames = options.nativeFunctionNames || new Set();
    relationSchema = buildRelationSchema(programAst.nodes);
    rulebookSchema = buildRulebookSchema(programAst.nodes);
    actionSchema = buildActionSchema(programAst.nodes);
    actionTagSchema = buildActionTagSchema(programAst.nodes);
    declaredObjectNames = new Set(programAst.nodes.filter((n) => n.kind === "ObjectDecl").map((n) => n.objectName));
    const kindSchema = buildKindSchema(programAst.nodes);
    const typeSchema = buildTypeSchema(programAst.nodes, kindSchema);
    const globalTypes = buildGlobalTypeSchema(programAst.nodes);
    const functionSchema = buildFunctionSchema(programAst.nodes);
    const globalNames = new Set(globalTypes.keys());

    // Implicit `reason` slot: when the program defines the magic `stop_reason`
    // type (as `outcome` is the magic phase-rule result kind), every action gains
    // a `reason` slot of that type so `stop failed REASON` and `self.reason` in
    // `report failed` rules type-check. Conditional so programs without reasons
    // are unaffected.
    if (typeSchema.typeFields.has("stop_reason")) {
        for (const [actionName, slots] of actionSchema) {
            slots.set("reason", "stop_reason");
            typeSchema.typeFields.get(actionName).set("reason", "stop_reason");
        }
    }

    checkNativeVsLampConflicts(programAst.nodes);
    checkNativeFunctions(programAst.nodes, nativeFunctionNames);
    checkFunctionOverloads(programAst.nodes, typeSchema, kindSchema, functionSchema);
    checkRelationDecls(programAst.nodes, typeSchema);
    checkMessageCompleteness(programAst.nodes);

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
                if (globalNames.has(coerceName(p.name))) {
                    throw typeError(node.filePath, node.lineNumber, `parameter "${p.name}" shadows global "${p.name}"`);
                }
            }
            const localTypes = new Map(node.params.map((p) => [p.name, p.typeName]));
            const expectedReturn = node.returnType === "void" ? null : node.returnType;
            checkStatements(node.body, typeSchema, kindSchema, localTypes, functionSchema, expectedReturn, globalNames);
        } else if (node.kind === "RulebookDecl") {
            checkRulebookDecl(node, typeSchema, kindSchema, functionSchema, globalNames);
        } else if (node.kind === "RulebookRule") {
            checkRulebookRule(node, typeSchema, kindSchema, functionSchema, globalNames);
        } else if (node.kind === "PhaseRule") {
            checkPhaseRule(node, typeSchema, kindSchema, functionSchema, globalNames);
        } else if (node.kind === "ActionDecl") {
            checkActionDecl(node);
        } else if (node.kind === "UnderstandDecl") {
            checkUnderstandDecl(node);
        }
    }
}

// `understand "TEMPLATE" as ACTION` must name a declared action, and each `[slot]`
// in the template must be one of that action's slots.
// Two slots with no literal word between them can never match at runtime: the grammar matcher
// fills the first slot greedily up to the next literal, so it swallows the whole span and the
// second slot gets nothing. (Relation `syntax` templates are exempt — those are parsed at
// compile time for assertions, not matched at play time.) Reject the silently-dead grammar; a
// literal word between the slots fixes it ("give [gift] to [recipient]", not "give [x] [y]").
function checkNoAdjacentSlots(template, label, filePath, lineNumber) {
    const isSlotWord = (w) => /^\[[A-Za-z_][A-Za-z0-9_]*\]$/.test(w);
    const words = template.trim().split(/\s+/);
    for (let i = 1; i < words.length; i += 1) {
        if (isSlotWord(words[i]) && isSlotWord(words[i - 1])) {
            throw typeError(filePath, lineNumber,
                `${label} has adjacent slots "${words[i - 1]} ${words[i]}" with no word between them, which can never match (the first slot would consume the rest of the command). Separate them with a literal word.`);
        }
    }
}

function checkUnderstandDecl(node) {
    const slots = actionSchema.get(node.actionName);
    if (!slots) {
        throw typeError(node.filePath, node.lineNumber, `understand references unknown action "${node.actionName}"`);
    }
    for (const match of node.template.matchAll(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g)) {
        if (!slots.has(match[1])) {
            throw typeError(node.filePath, node.lineNumber, `understand template for action "${node.actionName}" references unknown slot "${match[1]}"`);
        }
    }
    checkNoAdjacentSlots(node.template, `understand template for action "${node.actionName}"`, node.filePath, node.lineNumber);
}

// Each `[slot]` in an action's syntax templates must name a declared slot, and no two slots
// may be adjacent (the runtime grammar matcher can't split them).
function checkActionDecl(node) {
    const slotNames = new Set(node.slots.map((s) => s.fieldName));
    for (const template of (node.templates || [])) {
        for (const match of template.matchAll(/\[([A-Za-z_][A-Za-z0-9_]*)\]/g)) {
            if (!slotNames.has(match[1])) {
                throw typeError(node.filePath, node.lineNumber, `syntax template of action "${node.name}" references unknown slot "${match[1]}"`);
            }
        }
        checkNoAdjacentSlots(template, `syntax template of action "${node.name}"`, node.filePath, node.lineNumber);
    }
}

// A phase rule's body runs with `self` bound to the action instance; a `stop`
// value is checked against the `outcome` kind (succeeded/failed).
function checkPhaseRule(node, typeSchema, kindSchema, functionSchema, globalNames) {
    // A multi-action selector rule resolves to a set of actions; `self` is bound to
    // a representative for typing (only slots common to the whole set are allowed —
    // see checkSelectorSlotSafety). A single-action rule binds `self` to its action.
    let selfType = node.actionName;
    let label = `"${node.actionName}"`;
    if (node.selector) {
        const targets = resolveSelector(node.selector, actionSchema.keys(), actionTagSchema, typeError);
        checkSelectorSlotSafety(node, targets);
        selfType = targets[0];
        label = "selector rule";
    } else if (!actionSchema.has(node.actionName)) {
        throw typeError(node.filePath, node.lineNumber, `unknown action "${node.actionName}"`);
    }
    const localTypes = new Map([["self", selfType]]);
    if (node.whenExpr) {
        checkExprCalls(node.whenExpr, typeSchema, kindSchema, localTypes, functionSchema);
        const guardType = inferExprType(node.whenExpr, typeSchema, kindSchema, localTypes, functionSchema);
        if (guardType !== null && guardType !== "bool") {
            throw typeError(node.filePath, node.lineNumber, `guard of ${node.band} rule for ${label} must be boolean`);
        }
    }
    checkStatements(node.body, typeSchema, kindSchema, localTypes, functionSchema, "outcome", globalNames);
}

// Slots available on every action instance regardless of declaration, so a
// multi-action rule may always reference them.
const UNIVERSAL_SLOTS = new Set(["actor", "action", "reason"]);

// In a multi-action rule, `self.SLOT` is only valid for a universal slot or a slot
// every targeted action declares — otherwise the slot may be absent at runtime.
function checkSelectorSlotSafety(node, targets) {
    const accesses = [];
    collectPropertyAccess(node.whenExpr, accesses);
    for (const stmt of node.body) collectPropertyAccess(stmt, accesses);
    for (const access of accesses) {
        const { chain } = access;
        if (chain.length < 2 || chain[0] !== "self") continue;
        const slot = chain[1];
        if (UNIVERSAL_SLOTS.has(slot)) continue;
        const missing = targets.filter((a) => !(actionSchema.get(a) || new Map()).has(slot));
        if (missing.length > 0) {
            throw typeError(node.filePath, node.lineNumber,
                `selector rule reads "self.${slot}", but action "${missing[0]}" has no slot "${slot}" (a multi-action rule may only use slots common to every targeted action, or actor/action/reason)`);
        }
    }
}

// Deep-walks any AST node/array, pushing every PropertyAccess node into `acc`.
function collectPropertyAccess(node, acc) {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
        for (const item of node) collectPropertyAccess(item, acc);
        return;
    }
    if (node.kind === "PropertyAccess" && Array.isArray(node.chain)) {
        acc.push(node);
    }
    for (const key of Object.keys(node)) {
        if (key === "kind" || key === "filePath" || key === "lineNumber") continue;
        collectPropertyAccess(node[key], acc);
    }
}

function checkRulebookDecl(node, typeSchema, kindSchema, functionSchema, globalNames) {
    for (const p of node.params) {
        if (globalNames.has(coerceName(p.name))) {
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

// A `rule RULEBOOK [when]:` contribution: the rulebook must exist; the guard must
// be boolean and the body's `stop` values must match the rulebook's result type.
// The rulebook's parameters are in scope.
function checkRulebookRule(node, typeSchema, kindSchema, functionSchema, globalNames) {
    const schema = rulebookSchema.get(node.rulebookName);
    if (!schema) {
        throw typeError(node.filePath, node.lineNumber, `unknown rulebook "${node.rulebookName}"`);
    }
    const paramTypes = new Map(schema.params.map((p) => [p.name, p.typeName]));
    if (node.whenExpr) {
        checkExprCalls(node.whenExpr, typeSchema, kindSchema, paramTypes, functionSchema);
        const guardType = inferExprType(node.whenExpr, typeSchema, kindSchema, paramTypes, functionSchema);
        if (guardType !== null && guardType !== "bool") {
            throw typeError(node.filePath, node.lineNumber, `rule guard for rulebook "${node.rulebookName}" must be boolean`);
        }
    }
    checkStatements(node.body, typeSchema, kindSchema, new Map(paramTypes), functionSchema, schema.returnType, globalNames);
}

// A default-less message reference (`message NAME`) has no fallback text: some
// loaded file — normally the active locale pack — must register `NAME: "…"`.
// Enforced program-wide so a missing translation is a compile error, not silent
// empty output or another language's text bleeding through (devdocs/messages.md).
// Generic deep walk: message references sit at arbitrary expression depth.
function checkMessageCompleteness(nodes) {
    const registered = new Set(nodes.filter((n) => n.kind === "MessageOverride").map((n) => n.name));
    const walk = (value) => {
        if (!value || typeof value !== "object") return;
        if (Array.isArray(value)) {
            for (const item of value) walk(item);
            return;
        }
        if (value.kind === "MessageExpr" && value.defaultExpr === null && !registered.has(value.name)) {
            throw typeError(value.filePath, value.lineNumber,
                `message "${value.name}" has no text: no loaded file registers '${value.name}: "…"' (is the active locale pack missing this message?)`);
        }
        for (const key of Object.keys(value)) walk(value[key]);
    };
    walk(nodes);
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

function buildTypeSchema(nodes, kindSchema = new Map()) {
    const typeFields = new Map();
    const typeParents = new Map();

    for (const rawNode of nodes) {
        // An action declaration is a type whose parent is `action` and whose
        // fields are its slots, so field-chain resolution (self.taken) works.
        const node = rawNode.kind === "ActionDecl"
            ? { kind: "TypeDecl", name: rawNode.name, parents: ["action"], fields: rawNode.slots, filePath: rawNode.filePath, lineNumber: rawNode.lineNumber }
            : rawNode;
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
            if (f.defaultValue !== null) {
                const defaultType = inferLiteralType(f.defaultValue);
                // A string-literal default naming a valid label of an enum-kind
                // field is accepted (mirrors enum-label field values elsewhere).
                const kindDef = kindSchema.get(f.typeName);
                const isEnumLabel = f.defaultValue.kind === "StringLiteral"
                    && kindDef && kindDef.kind === "EnumExpr"
                    && kindDef.labels.includes(f.defaultValue.value);
                // text and string interoperate: a `text` field accepts any
                // renderable literal default, and a `string` field accepts a text.
                const stringTextOk = (f.typeName === "text" && isStringCompatible(defaultType, kindSchema))
                    || (f.typeName === "string" && defaultType === "text");
                if (defaultType !== null && defaultType !== f.typeName && !isEnumLabel && !stringTextOk) {
                    throw typeError(
                        node.filePath,
                        node.lineNumber,
                        `default value for "${node.name}.${f.fieldName}" has type "${defaultType}" but field is declared "${f.typeName}"`,
                    );
                }
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

// The directional fields of an advent-style door (mirrors lib/advent directions).
// A door is identified by carrying all of these as `room` fields, so the door
// consistency check below keys on structure, not the type name.
const DOOR_DIRECTION_FIELDS = ["north", "northeast", "east", "southeast", "south",
                               "southwest", "west", "northwest", "up", "down"];

function checkObjectDecl(node, typeSchema, kindSchema) {
    // An object's declared type must exist (a builtin, or a declared `type`); otherwise
    // every field below would spuriously read as unknown.
    if (!typeSchema.typeFields.has(node.typeName) && !BUILTIN_TYPES.has(node.typeName)) {
        throw typeError(node.filePath, node.lineNumber,
            `unknown type "${node.typeName}" for object "${node.objectName}"`);
    }
    const allFields = getAllFields(node.typeName, typeSchema);
    for (const fieldAssign of node.fields) {
        const fieldTypeName = allFields.get(fieldAssign.fieldName);
        if (!fieldTypeName) {
            // A field the type never declares: a typo silently no-op'd before this check.
            throw typeError(fieldAssign.filePath, fieldAssign.lineNumber,
                `object "${node.objectName}" of type "${node.typeName}" has no field "${fieldAssign.fieldName}"`);
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

    // Consistency check: an advent-style door connects exactly two rooms. A door is
    // a type carrying all ten directional `room` fields; it declares its two sides as
    // `<direction> <room>` lines (those fields), so require exactly two set. Keyed on
    // field structure, not the type name, so an unrelated user type named `door` is
    // unaffected. (The accepted "option A" trade-off — a general library-contributed
    // consistency pass would own this rule; see TODO "Door subsystem".)
    if (DOOR_DIRECTION_FIELDS.every((d) => allFields.get(d) === "room")) {
        const sides = node.fields.filter((f) =>
            DOOR_DIRECTION_FIELDS.includes(f.fieldName) && f.value.kind !== "NoneLiteral");
        if (sides.length !== 2) {
            throw typeError(node.filePath, node.lineNumber,
                `door "${node.objectName}" must connect exactly two rooms (found ${sides.length})`);
        }
    }
}

function checkStatements(statements, typeSchema, kindSchema, localTypes, functionSchema = new Map(), expectedReturnType = null, globalNames = new Set()) {
    for (const stmt of statements) {
        for (const subExpr of directSubExprs(stmt)) {
            checkExprCalls(subExpr, typeSchema, kindSchema, localTypes, functionSchema);
        }
        if (stmt.kind === "LetStatement") {
            if (globalNames.has(coerceName(stmt.name))) {
                throw typeError(stmt.filePath, stmt.lineNumber, `local "${stmt.name}" shadows global "${stmt.name}"`);
            }
            const varType = inferExprType(stmt.expr, typeSchema, kindSchema, localTypes, functionSchema);
            // Register the local even when its type can't be inferred (null), so a later
            // assignment to it isn't misreported as undeclared; a null type reads as
            // "unknown" everywhere localTypes is consulted.
            localTypes.set(stmt.name, varType || null);
        } else if (stmt.kind === "AssignStatement") {
            const head = stmt.targetChain[0];
            if (stmt.targetChain.length === 1 && !localTypes.has(head) && !globalNames.has(coerceName(head))) {
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
            if (globalNames.has(coerceName(stmt.varName))) {
                throw typeError(stmt.filePath, stmt.lineNumber, `for loop variable "${stmt.varName}" shadows global "${stmt.varName}"`);
            }
            const bodyTypes = new Map(localTypes);
            bodyTypes.set(stmt.varName, "int");
            checkStatements(stmt.body, typeSchema, kindSchema, bodyTypes, functionSchema, expectedReturnType, globalNames);
        } else if (stmt.kind === "ForEachStatement") {
            if (globalNames.has(coerceName(stmt.varName))) {
                throw typeError(stmt.filePath, stmt.lineNumber, `for loop variable "${stmt.varName}" shadows global "${stmt.varName}"`);
            }
            const listType = inferExprType(stmt.listExpr, typeSchema, kindSchema, localTypes, functionSchema);
            let elementType = null;
            if (listType !== null) {
                const listMatch = listType.match(/^list<(.+)>$/);
                if (!listMatch) {
                    throw typeError(stmt.filePath, stmt.lineNumber, `for ... in expects a list, but got "${listType}"`);
                }
                elementType = listMatch[1];
            }
            const bodyTypes = new Map(localTypes);
            bodyTypes.set(stmt.varName, elementType);
            checkStatements(stmt.body, typeSchema, kindSchema, bodyTypes, functionSchema, expectedReturnType, globalNames);
        } else if (stmt.kind === "CallStatement") {
            checkCallStatement(stmt, typeSchema, kindSchema, localTypes, functionSchema);
        } else if (stmt.kind === "FollowStatement") {
            checkFollowCall(stmt, typeSchema, kindSchema, localTypes, functionSchema);
        } else if (stmt.kind === "TryStatement") {
            checkTryStatement(stmt, typeSchema, kindSchema, localTypes, functionSchema);
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
            if (stmt.reason !== null) {
                checkValueCompatibility(
                    stmt.reason,
                    "stop_reason",
                    typeSchema,
                    kindSchema,
                    stmt.filePath,
                    stmt.lineNumber,
                    "stop reason",
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

// Every name callable as NAME(...) at compile time: a declared function or native
// (functionSchema), a rulebook dispatcher (rulebookSchema), the built-in `pick`, or
// a `function`-typed local/parameter holding a first-class function (e.g. the `fn`
// passed to map_strings). Natives must be declared and functions/rulebooks are
// collected up front, so an unknown name is a typo that would be a runtime
// ReferenceError — reject it now.
function isKnownCallable(name, functionSchema, localTypes) {
    return name === "pick"
        || functionSchema.has(name)
        || rulebookSchema.has(name)
        || (localTypes ? localTypes.get(name) === "function" : false);
}

function checkCallStatement(stmt, typeSchema, kindSchema, localTypes, functionSchema) {
    if (!isKnownCallable(stmt.name, functionSchema, localTypes)) {
        throw typeError(stmt.filePath, stmt.lineNumber, `call to undefined function "${stmt.name}"`);
    }
    const fn = functionSchema.get(stmt.name);
    if (!fn) return;
    checkCallArgs(stmt.name, stmt.args, fn, "function", stmt.filePath, stmt.lineNumber, typeSchema, kindSchema, localTypes, functionSchema);
}

function checkTryStatement(stmt, typeSchema, kindSchema, localTypes, functionSchema) {
    const slots = actionSchema.get(stmt.actionName);
    if (!slots) {
        throw typeError(stmt.filePath, stmt.lineNumber, `unknown action "${stmt.actionName}"`);
    }
    for (const field of stmt.fields) {
        const slotType = slots.get(field.fieldName);
        if (!slotType) {
            // `actor` is an implicit field on every action instance (set by run_command),
            // so it can be overridden in a try block without being declared as a slot.
            if (field.fieldName === "actor") continue;
            throw typeError(field.filePath, field.lineNumber, `action "${stmt.actionName}" has no slot "${field.fieldName}"`);
        }
        checkValueCompatibility(
            field.value,
            slotType,
            typeSchema,
            kindSchema,
            field.filePath,
            field.lineNumber,
            `slot "${field.fieldName}"`,
            localTypes,
            functionSchema,
        );
    }
}

// `typeName` names a declared object type (something with instances), as opposed
// to a primitive or a kind/enum.
function isDeclaredObjectType(typeName, typeSchema, kindSchema) {
    return typeof typeName === "string"
        && typeSchema.typeFields.has(typeName)
        && !PRIMITIVE_TYPES.has(typeName)
        && !kindSchema.has(typeName);
}

// A bare name compared (`==`) against an object-typed expression that is not a
// declared object is a typo: the parser fell back to a string literal that can
// never equal an object, so the comparison is silently always false. Flag it.
function checkObjectNameComparison(expr, typeSchema, kindSchema, localTypes, functionSchema) {
    for (const [nameSide, otherSide] of [[expr.left, expr.right], [expr.right, expr.left]]) {
        // A bare name compared against an object-typed value: a single-word name falls back to
        // a string literal, a multi-word (or otherwise-non-JS-ident) one to an object reference.
        // Either way, if it names no declared object it can never match — a typo. This is what
        // catches a mistyped `stop failed`/`self.reason ==` reason now that reasons are
        // auto-created from use (a produced reason IS a declared object; a typo'd one is not).
        let badName = null;
        if (nameSide.kind === "StringLiteral" && !declaredObjectNames.has(nameSide.value)) {
            badName = nameSide.value;
        } else if (nameSide.kind === "ParenNameExpr" && nameSide.fieldChain.length === 0
                && !declaredObjectNames.has(nameSide.objectName)) {
            badName = nameSide.objectName;
        }
        if (badName === null) continue;
        const otherType = inferExprType(otherSide, typeSchema, kindSchema, localTypes, functionSchema);
        if (isDeclaredObjectType(otherType, typeSchema, kindSchema)) {
            throw typeError(expr.filePath, expr.lineNumber, `unknown object "${badName}" compared with a value of type "${otherType}"`);
        }
    }
}

// Recursively validates every call/follow embedded in an expression — the
// expression-position counterpart to the statement-level checks above, so
// `print follow f(1, 2)` and `x == g(a)` are checked the same as `f(...)` and
// `follow f(...)` statements. An unknown function name (or rulebook) is a compile
// error, matching checkCallStatement — natives are declared and functions/rulebooks
// are collected up front, so the callable set is fully known.
function checkExprCalls(expr, typeSchema, kindSchema, localTypes, functionSchema) {
    if (!expr || typeof expr !== "object") return;
    if (expr.kind === "EqualsExpr") {
        checkObjectNameComparison(expr, typeSchema, kindSchema, localTypes, functionSchema);
    }
    if (expr.kind === "IsExpr") {
        if (!typeSchema.typeFields.has(expr.typeName) && !BUILTIN_TYPES.has(expr.typeName)) {
            throw typeError(expr.filePath, expr.lineNumber, `unknown type "${expr.typeName}" in 'is' expression`);
        }
    }
    if (expr.kind === "CallExpr") {
        if (expr.name === "pick") {
            if (expr.args.length < 1 || expr.args.length > 2) {
                throw typeError(expr.filePath, expr.lineNumber, `"pick" expects 1 or 2 arguments (a list and an optional mode), got ${expr.args.length}`);
            }
        } else if (!isKnownCallable(expr.name, functionSchema, localTypes)) {
            throw typeError(expr.filePath, expr.lineNumber, `call to undefined function "${expr.name}"`);
        } else {
            const fn = functionSchema.get(expr.name);
            if (fn) {
                checkCallArgs(expr.name, expr.args, fn, "function", expr.filePath, expr.lineNumber, typeSchema, kindSchema, localTypes, functionSchema);
            }
        }
    } else if (expr.kind === "FollowExpr") {
        const rb = rulebookSchema.get(expr.name);
        if (!rb) {
            throw typeError(expr.filePath, expr.lineNumber, `unknown rulebook "${expr.name}"`);
        }
        checkCallArgs(expr.name, expr.args, rb, "rulebook", expr.filePath, expr.lineNumber, typeSchema, kindSchema, localTypes, functionSchema);
    } else if (expr.kind === "TryExpr") {
        checkTryStatement(expr, typeSchema, kindSchema, localTypes, functionSchema);
    }
    // Recurse into every child expression generically, so a call nested anywhere —
    // a member-access object, a list element, a template substitution/branch — is
    // still validated (a hand-kept key list silently missed those). Skips the
    // non-expression bookkeeping keys; AST nodes are acyclic, so this terminates.
    for (const key of Object.keys(expr)) {
        if (key === "kind" || key === "filePath" || key === "lineNumber") continue;
        const child = expr[key];
        if (Array.isArray(child)) {
            for (const item of child) checkExprCalls(item, typeSchema, kindSchema, localTypes, functionSchema);
        } else if (child && typeof child === "object") {
            checkExprCalls(child, typeSchema, kindSchema, localTypes, functionSchema);
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
        case "ForEachStatement":
            return [stmt.listExpr];
        case "CallStatement":
        case "FollowStatement":
            return stmt.args;
        case "MoveStatement":
            return [stmt.contained, stmt.container];
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
    if (expr.kind === "TemplateLiteral") {
        return "text";
    }
    if (expr.kind === "MessageExpr") {
        if (expr.defaultExpr === null) return "text";
        return inferExprType(expr.defaultExpr, typeSchema, kindSchema, localTypes, functionSchema);
    }
    if (expr.kind === "FreezeExpr") {
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
    if (expr.kind === "MemberAccess") {
        let t = inferExprType(expr.object, typeSchema, kindSchema, localTypes, functionSchema);
        for (const field of expr.fields) {
            if (t === null) return null;
            t = applyFieldToType(t, field, typeSchema);
        }
        return t;
    }
    if (expr.kind === "Concat") {
        const leftType = inferExprType(expr.left, typeSchema, kindSchema, localTypes, functionSchema);
        const rightType = inferExprType(expr.right, typeSchema, kindSchema, localTypes, functionSchema);
        return inferConcatType(leftType, rightType, kindSchema);
    }
    if (expr.kind === "EqualsExpr") {
        return "bool";
    }
    if (expr.kind === "IsExpr") {
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
    if (expr.kind === "ModExpr" || expr.kind === "DivExpr") {
        // Integer remainder / floored integer division: numeric operands, int result.
        const leftType = inferExprType(expr.left, typeSchema, kindSchema, localTypes, functionSchema);
        const rightType = inferExprType(expr.right, typeSchema, kindSchema, localTypes, functionSchema);
        if (leftType === null || rightType === null) {
            return null;
        }
        return (isNumericType(leftType) && isNumericType(rightType)) ? "int" : null;
    }
    if (expr.kind === "GlobalExpr") {
        return null;
    }
    if (expr.kind === "ParenNameExpr") {
        return null;
    }
    if (expr.kind === "CallExpr") {
        if (expr.name === "pick") {
            // pick(LIST, ...) returns one element of the list (its element type).
            const listType = inferExprType(expr.args[0], typeSchema, kindSchema, localTypes, functionSchema);
            const m = listType && listType.match(/^list<(.+)>$/);
            return m ? m[1] : null;
        }
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
    if (expr.kind === "TryExpr") {
        return "outcome";
    }
    if (expr.kind === "IndexExpr") {
        const targetType = inferExprType(expr.target, typeSchema, kindSchema, localTypes, functionSchema);
        const listMatch = targetType && targetType.match(/^list<(.+)>$/);
        return listMatch ? listMatch[1] : null;
    }
    if (expr.kind === "ListLiteral") {
        // Element type from the first element whose type is inferable; an empty or
        // all-unknown literal is `list<unknown>` (still a list, so a let-binding
        // registers and indexing/iteration resolve leniently).
        let elemType = "unknown";
        for (const el of expr.elements) {
            const t = inferExprType(el, typeSchema, kindSchema, localTypes, functionSchema);
            if (t) { elemType = t; break; }
        }
        return `list<${elemType}>`;
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
    if (type === "string" || type === "text" || type === "int" || type === "real") {
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
                // An unknown-typed local (registered by `let` without an inferable type)
                // can't anchor a field chain — same outcome as before it was registered.
                if (currentType === null) return null;
            } else {
                return null;
            }
        } else {
            currentType = applyFieldToType(currentType, token, typeSchema);
            if (currentType === null) return null;
        }
    }

    return currentType;
}

// Applies one field/accessor token to a known type, returning the resulting type
// or null. Shared by the `name.field` chain (resolveChainType) and the computed
// `(expr).field` member access (MemberAccess inference). Handles the list
// pseudo-fields `.all` / `.first` and the G2 quantity accessors `.size` / `.count`.
function applyFieldToType(currentType, token, typeSchema) {
    if (token === "all") return `list<${currentType}>`;
    const listMatch = currentType.match(/^list<(.+)>$/);
    if (token === "first") return listMatch ? listMatch[1] : null;
    if (token === "size" || token === "count") return listMatch ? "int" : null;
    if (listMatch) return null;
    return getAllFields(currentType, typeSchema).get(token) || null;
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
        // text and string interoperate: a `text` renders to a string (so a text
        // value satisfies a string position), and any renderable value satisfies a
        // `text` position. `freeze` is the explicit text -> string form.
        if (fieldTypeName === "string" && inferredType === "text") {
            return;
        }
        if (fieldTypeName === "text" && isStringCompatible(inferredType, kindSchema)) {
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
