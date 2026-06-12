function createProgram(nodes) {
    return { kind: "Program", nodes };
}

function createTypeDecl(name, parents, fields, filePath, lineNumber) {
    return { kind: "TypeDecl", name, parents, fields, filePath, lineNumber };
}

function createObjectDecl(typeName, objectName, fields) {
    return { kind: "ObjectDecl", typeName, objectName, fields };
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

function createLetStatement(name, expr) {
    return { kind: "LetStatement", name, expr };
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

function createLessThanExpr(left, right) {
    return { kind: "LessThanExpr", left, right };
}

module.exports = {
    createProgram,
    createTypeDecl,
    createObjectDecl,
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
    createBreakStatement,
};
