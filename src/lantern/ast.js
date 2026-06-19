function createProgram(nodes) {
    return { kind: "Program", nodes };
}

function createTypeDecl(name, parents, fields, filePath, lineNumber) {
    return { kind: "TypeDecl", name, parents, fields, filePath, lineNumber };
}

function createObjectDecl(typeName, objectName, fields) {
    return { kind: "ObjectDecl", typeName, objectName, fields };
}

function createRelationDecl(name, fields, syntax, invertedFields, sourceField, targetField, filePath, lineNumber) {
    return { kind: "RelationDecl", name, fields, syntax, invertedFields, sourceField, targetField, filePath, lineNumber };
}

function createRelationAssert(relationName, fields, instanceName, filePath, lineNumber) {
    return { kind: "RelationAssert", relationName, fields, instanceName, bidi: false, filePath, lineNumber };
}

function createRelationQuery(relationName, fields, outputField, outputMode, filePath, lineNumber) {
    return { kind: "RelationQuery", relationName, fields, outputField, outputMode, filePath, lineNumber };
}

function createRelationRemove(relationName, fields, filePath, lineNumber) {
    return { kind: "RelationRemove", relationName, fields, filePath, lineNumber };
}

function createDisconnectStatement(instanceName, filePath, lineNumber) {
    return { kind: "DisconnectStatement", instanceName, filePath, lineNumber };
}

function createWildcardExpr() {
    return { kind: "WildcardExpr" };
}

// Transient parse-only node for a `?`/`?all`/`?first`/`?only` output slot.
function createOutputSlot(mode) {
    return { kind: "OutputSlot", mode };
}

function createGlobalDecl(name, typeName, value, filePath, lineNumber) {
    return { kind: "GlobalDecl", name, typeName, value, filePath, lineNumber };
}

function createGlobalAssign(name, value, filePath, lineNumber) {
    return { kind: "GlobalAssign", name, value, filePath, lineNumber };
}

function createEventHandler(eventName, body) {
    return { kind: "EventHandler", eventName, body };
}

function createLetStatement(name, expr, filePath, lineNumber) {
    return { kind: "LetStatement", name, expr, filePath, lineNumber };
}

function createPrintStatement(expr) {
    return { kind: "PrintStatement", expr };
}

function createAssignStatement(targetChain, expr, filePath, lineNumber) {
    return { kind: "AssignStatement", targetChain, expr, filePath, lineNumber };
}

function createErrorStatement(expr) {
    return { kind: "ErrorStatement", expr };
}

function createIfStatement(condition, thenBody, elseBody) {
    return { kind: "IfStatement", condition, thenBody, elseBody };
}

function createFieldDecl(typeName, fieldName, defaultValue = null) {
    return { kind: "FieldDecl", typeName, fieldName, defaultValue };
}

function createFieldAssign(fieldName, value, filePath, lineNumber) {
    return { kind: "FieldAssign", fieldName, value, filePath, lineNumber };
}

function createStringLiteral(value) {
    return { kind: "StringLiteral", value };
}

function createVariableExpr(name) {
    return { kind: "VariableExpr", name };
}

function createNumberLiteral(value) {
    return { kind: "NumberLiteral", value };
}

function createBooleanLiteral(value) {
    return { kind: "BooleanLiteral", value };
}

function createPropertyAccess(chain) {
    return { kind: "PropertyAccess", chain };
}

function createIndexExpr(target, index) {
    return { kind: "IndexExpr", target, index };
}

function createConcat(left, right) {
    return { kind: "Concat", left, right };
}

function createEqualsExpr(left, right) {
    return { kind: "EqualsExpr", left, right };
}

function createKindDecl(name, kindExpr) {
    return { kind: "KindDecl", name, kindExpr };
}

function createEnumExpr(labels) {
    return { kind: "EnumExpr", labels };
}

function createMultiplyExpr(left, right) {
    return { kind: "MultiplyExpr", left, right };
}

function createGlobalExpr(name) {
    return { kind: "GlobalExpr", name };
}

function createParenNameExpr(objectName, fieldChain) {
    return { kind: "ParenNameExpr", objectName, fieldChain };
}

function createNoneLiteral() {
    return { kind: "NoneLiteral" };
}

function createLibImport(name) {
    return { kind: "LibImport", name };
}

function createDispatchStatement(eventName) {
    return { kind: "DispatchStatement", eventName };
}

function createWhileStatement(condition, body) {
    return { kind: "WhileStatement", condition, body };
}

function createBreakStatement() {
    return { kind: "BreakStatement" };
}

function createForStatement(varName, start, finish, step, body, filePath, lineNumber) {
    return { kind: "ForStatement", varName, start, finish, step, body, filePath, lineNumber };
}

function createForEachStatement(varName, listExpr, body, filePath, lineNumber) {
    return { kind: "ForEachStatement", varName, listExpr, body, filePath, lineNumber };
}

function createChangeHandler(typeName, fieldName, body) {
    return { kind: "ChangeHandler", typeName, fieldName, body };
}

function createRelationAddHandler(relationName, body) {
    return { kind: "RelationAddHandler", relationName, body };
}

function createRelationRemoveHandler(relationName, body) {
    return { kind: "RelationRemoveHandler", relationName, body };
}

function createLessThanExpr(left, right) {
    return { kind: "LessThanExpr", left, right };
}

function createLessOrEqualExpr(left, right) {
    return { kind: "LessOrEqualExpr", left, right };
}

function createNegateExpr(expr) {
    return { kind: "NegateExpr", expr };
}

function createSubtractExpr(left, right) {
    return { kind: "SubtractExpr", left, right };
}

function createDivideExpr(left, right) {
    return { kind: "DivideExpr", left, right };
}

function createPowerExpr(left, right) {
    return { kind: "PowerExpr", left, right };
}

function createFunctionDecl(name, returnType, params, whenExpr, body, filePath, lineNumber) {
    return { kind: "FunctionDecl", name, returnType, params, whenExpr, body, filePath, lineNumber };
}

function createNativeFunctionDecl(name, returnType, params, filePath, lineNumber) {
    return { kind: "NativeFunctionDecl", name, returnType, params, filePath, lineNumber };
}

function createAndExpr(left, right) {
    return { kind: "AndExpr", left, right };
}

function createOrExpr(left, right) {
    return { kind: "OrExpr", left, right };
}

function createNotExpr(expr) {
    return { kind: "NotExpr", expr };
}

function createCallStatement(name, args, filePath, lineNumber) {
    return { kind: "CallStatement", name, args, filePath, lineNumber };
}

function createCallExpr(name, args, filePath, lineNumber) {
    return { kind: "CallExpr", name, args, filePath, lineNumber };
}

function createReturnStatement(expr) {
    return { kind: "ReturnStatement", expr };
}

function createFunctionRefExpr(name) {
    return { kind: "FunctionRefExpr", name };
}

// A rulebook: a typed, ordered, short-circuiting pipeline. `rules` is an ordered
// list of { whenExpr, body }; `defaultExpr` is the value yielded when no rule
// stops. See devdocs/specs.md, Rulebooks.
function createRulebookDecl(name, resultType, params, rules, defaultExpr, filePath, lineNumber) {
    return { kind: "RulebookDecl", name, resultType, params, rules, defaultExpr, filePath, lineNumber };
}

function createStopStatement(expr, reason, filePath, lineNumber) {
    return { kind: "StopStatement", expr, reason, filePath, lineNumber };
}

// An action type: a subtype of the built-in `action` type whose fields are its
// named slots. `templates` are the `syntax` surface forms (raw strings) the Game
// Parser matches player input against. The six-band rulebook is built from
// PhaseRule nodes.
function createActionDecl(name, slots, templates, filePath, lineNumber, tags = []) {
    return { kind: "ActionDecl", name, slots, templates, filePath, lineNumber, tags };
}

// One rule in an action's rulebook, attached to a band (before/instead/check/
// do/after/report). `self` inside the body is the action instance. Exactly one of
// `actionName` (single-action rule) or `selector` (multi-action rule, a SelNode
// boolean tree) is non-null; see ast.SelNode constructors and devdocs/rulebooks.md.
function createPhaseRule(band, actionName, whenExpr, body, filePath, lineNumber, selector = null) {
    return { kind: "PhaseRule", band, actionName, whenExpr, body, filePath, lineNumber, selector };
}

// Action-selector AST: a boolean tree over atoms (action names / tags / `any`).
// Resolved to a concrete action-name set at check/emit time.
function createSelAtom(name, filePath, lineNumber) {
    return { kind: "SelAtom", name, filePath, lineNumber };
}
function createSelAny(filePath, lineNumber) {
    return { kind: "SelAny", filePath, lineNumber };
}
function createSelNot(operand, filePath, lineNumber) {
    return { kind: "SelNot", operand, filePath, lineNumber };
}
function createSelAnd(left, right, filePath, lineNumber) {
    return { kind: "SelAnd", left, right, filePath, lineNumber };
}
function createSelOr(left, right, filePath, lineNumber) {
    return { kind: "SelOr", left, right, filePath, lineNumber };
}

// Imperatively run an action: construct an instance with the given slot values
// and drive it through its rulebook bands.
function createTryStatement(actionName, fields, filePath, lineNumber, silent = false) {
    return { kind: "TryStatement", actionName, fields, filePath, lineNumber, silent };
}

// Expression form of `try`: runs the action and yields its `outcome`. Produced
// when a `try` appears as the value of a `let`.
function createTryExpr(actionName, fields, filePath, lineNumber, silent = false) {
    return { kind: "TryExpr", actionName, fields, filePath, lineNumber, silent };
}

function createFollowStatement(name, args, filePath, lineNumber) {
    return { kind: "FollowStatement", name, args, filePath, lineNumber };
}

function createFollowExpr(name, args, filePath, lineNumber) {
    return { kind: "FollowExpr", name, args, filePath, lineNumber };
}

module.exports = {
    createProgram,
    createTypeDecl,
    createObjectDecl,
    createRelationDecl,
    createRelationAssert,
    createRelationQuery,
    createRelationRemove,
    createDisconnectStatement,
    createWildcardExpr,
    createOutputSlot,
    createGlobalDecl,
    createGlobalAssign,
    createKindDecl,
    createEnumExpr,
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
    createMultiplyExpr,
    createGlobalExpr,
    createParenNameExpr,
    createNoneLiteral,
    createLibImport,
    createDispatchStatement,
    createWhileStatement,
    createLessThanExpr,
    createLessOrEqualExpr,
    createNegateExpr,
    createSubtractExpr,
    createDivideExpr,
    createPowerExpr,
    createBreakStatement,
    createForStatement,
    createForEachStatement,
    createChangeHandler,
    createRelationAddHandler,
    createRelationRemoveHandler,
    createFunctionDecl,
    createNativeFunctionDecl,
    createCallStatement,
    createCallExpr,
    createReturnStatement,
    createFunctionRefExpr,
    createRulebookDecl,
    createStopStatement,
    createFollowStatement,
    createFollowExpr,
    createActionDecl,
    createPhaseRule,
    createSelAtom,
    createSelAny,
    createSelNot,
    createSelAnd,
    createSelOr,
    createTryStatement,
    createTryExpr,
    createAndExpr,
    createOrExpr,
    createNotExpr,
    createIndexExpr,
};
