function createProgram(nodes) {
    return { kind: "Program", nodes };
}

function createTypeDecl(name, parents, fields, filePath, lineNumber) {
    return { kind: "TypeDecl", name, parents, fields, filePath, lineNumber };
}

function createObjectDecl(typeName, objectName, fields) {
    return { kind: "ObjectDecl", typeName, objectName, fields };
}

function createRelationDecl(name, fields, syntax, filePath, lineNumber) {
    return { kind: "RelationDecl", name, fields, syntax, filePath, lineNumber };
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

function createFieldDecl(typeName, fieldName) {
    return { kind: "FieldDecl", typeName, fieldName };
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

function createChangeHandler(typeName, fieldName, body) {
    return { kind: "ChangeHandler", typeName, fieldName, body };
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

function createCallExpr(name, args) {
    return { kind: "CallExpr", name, args };
}

function createReturnStatement(expr) {
    return { kind: "ReturnStatement", expr };
}

function createFunctionRefExpr(name) {
    return { kind: "FunctionRefExpr", name };
}

module.exports = {
    createProgram,
    createTypeDecl,
    createObjectDecl,
    createRelationDecl,
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
    createChangeHandler,
    createFunctionDecl,
    createNativeFunctionDecl,
    createCallStatement,
    createCallExpr,
    createReturnStatement,
    createFunctionRefExpr,
    createAndExpr,
    createOrExpr,
    createNotExpr,
    createIndexExpr,
};
