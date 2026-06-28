function createProgram(nodes) {
    return { kind: "Program", nodes };
}

function createTypeDecl(name, parents, fields, filePath, lineNumber) {
    return { kind: "TypeDecl", name, parents, fields, filePath, lineNumber };
}

function createObjectDecl(typeName, objectName, fields, filePath, lineNumber) {
    return { kind: "ObjectDecl", typeName, objectName, fields, filePath, lineNumber };
}

function createRelationDecl(name, fields, syntax, invertedFields, sourceField, targetField, uniqueFields, filePath, lineNumber) {
    return { kind: "RelationDecl", name, fields, syntax, invertedFields, sourceField, targetField, uniqueFields, filePath, lineNumber };
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

function createMoveStatement(contained, container, filePath, lineNumber) {
    return { kind: "MoveStatement", contained, container, filePath, lineNumber };
}

// Named message: `NAME:"DEFAULT"`. Evaluates to the override registered for NAME,
// else the inline default. The override (a top-level `NAME: "TEXT"`) is the
// MessageOverride below.
function createMessageExpr(name, defaultExpr, filePath, lineNumber) {
    return { kind: "MessageExpr", name, defaultExpr, filePath, lineNumber };
}

function createMessageOverride(name, overrideExpr, filePath, lineNumber) {
    return { kind: "MessageOverride", name, overrideExpr, filePath, lineNumber };
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

function createAssignStatement(targetChain, expr, filePath, lineNumber, index = null) {
    return { kind: "AssignStatement", targetChain, expr, filePath, lineNumber, index };
}
function createListLiteral(elements, filePath, lineNumber) {
    return { kind: "ListLiteral", elements, filePath, lineNumber };
}

function createErrorStatement(expr) {
    return { kind: "ErrorStatement", expr };
}

function createIfStatement(condition, thenBody, elseBody) {
    return { kind: "IfStatement", condition, thenBody, elseBody };
}

function createFieldDecl(typeName, fieldName, defaultValue = null, direct = false) {
    return { kind: "FieldDecl", typeName, fieldName, defaultValue, direct };
}

function createFieldAssign(fieldName, value, filePath, lineNumber) {
    return { kind: "FieldAssign", fieldName, value, filePath, lineNumber };
}

function createStringLiteral(value) {
    return { kind: "StringLiteral", value };
}

// A string literal carrying `[expr]` substitutions. `parts` is an ordered mix of
// { kind: "text", value } literal segments and { kind: "expr", expr } embedded
// expressions; rendering interleaves them, formatting each expression as the
// runtime would `print` it. A literal with no substitutions stays a plain
// StringLiteral, so this node only appears when at least one `[…]` is present.
// A TemplateLiteral evaluates to a lazy `text` value (re-rendered each time it is
// printed); `freeze` forces it to a concrete `string`. See devdocs/text.md K2.
function createTemplateLiteral(parts) {
    return { kind: "TemplateLiteral", parts };
}

// `freeze EXPR` forces a lazy `text` value to a concrete `string` (rendering its
// substitutions now). A no-op stringification on a value that is already a string.
function createFreezeExpr(expr) {
    return { kind: "FreezeExpr", expr };
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

// Postfix field access on a computed (non-name) expression — e.g. a parenthesized
// query `(connects foyer _ ?all).size`. The plain `name.field` chain is a
// PropertyAccess; this is its analogue when the head is an arbitrary expression.
// `fields` is the trailing dotted names (usually one). See devdocs/text.md G2.
function createMemberAccess(object, fields) {
    return { kind: "MemberAccess", object, fields };
}

function createConcat(left, right) {
    return { kind: "Concat", left, right };
}

function createEqualsExpr(left, right, filePath, lineNumber) {
    return { kind: "EqualsExpr", left, right, filePath, lineNumber };
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

function createModExpr(left, right) {
    return { kind: "ModExpr", left, right };
}

function createDivExpr(left, right) {
    return { kind: "DivExpr", left, right };
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

// A compile-time directive selecting the locale pack (e.g. `locale "fr-FR"`).
// Carries no runtime effect: the emitter filters by node kind and never selects
// it. The compiler reads the tag in a pre-pass to choose the locale dir; the
// --locale flag overrides this declaration.
function createLocaleDecl(tag) {
    return { kind: "LocaleDecl", tag };
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
function createActionDecl(name, slots, templates, filePath, lineNumber, tags = [], outOfWorld = false, worldScope = false) {
    return { kind: "ActionDecl", name, slots, templates, filePath, lineNumber, tags, outOfWorld, worldScope };
}

// `verb a, b, c` — registers conjugation-sugar words. A declaration-only node
// with no runtime effect: the parser uses the prescanned word set to rewrite
// `[drop]` template slots into conjugate() calls, and the checker/emitter skip
// this node. The conjugation rules live in the locale's conjugate(). See text.md D3.
function createVerbDecl() {
    return { kind: "VerbDecl" };
}

// `understand "TEMPLATE" as ACTION` — contributes one extra grammar phrasing to
// an already-declared action without redeclaring it (so a game can add a verb
// for a library action). Emits a single registerGrammar call.
function createUnderstandDecl(template, actionName, filePath, lineNumber) {
    return { kind: "UnderstandDecl", template, actionName, filePath, lineNumber };
}

// One rule in an action's rulebook, attached to a band (before/instead/check/
// do/after/report). `self` inside the body is the action instance. Exactly one of
// `actionName` (single-action rule) or `selector` (multi-action rule, a SelNode
// boolean tree) is non-null; see ast.SelNode constructors and devdocs/rulebooks.md.
function createPhaseRule(band, actionName, whenExpr, body, filePath, lineNumber, selector = null) {
    return { kind: "PhaseRule", band, actionName, whenExpr, body, filePath, lineNumber, selector };
}

// A rule contributed to an existing named rulebook from anywhere (`rule RULEBOOK
// [when COND]:`). The rulebook's parameters are in scope in the guard and body.
function createRulebookRule(rulebookName, whenExpr, body, filePath, lineNumber) {
    return { kind: "RulebookRule", rulebookName, whenExpr, body, filePath, lineNumber };
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
    createMoveStatement,
    createMessageExpr,
    createMessageOverride,
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
    createTemplateLiteral,
    createFreezeExpr,
    createVariableExpr,
    createNumberLiteral,
    createBooleanLiteral,
    createPropertyAccess,
    createMemberAccess,
    createConcat,
    createEqualsExpr,
    createMultiplyExpr,
    createModExpr,
    createDivExpr,
    createGlobalExpr,
    createParenNameExpr,
    createNoneLiteral,
    createLibImport,
    createLocaleDecl,
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
    createVerbDecl,
    createUnderstandDecl,
    createPhaseRule,
    createRulebookRule,
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
    createListLiteral,
};
