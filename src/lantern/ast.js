function createProgram(nodes) {
    return { kind: "Program", nodes };
}

function createTypeDecl(name, parents, fields) {
    return { kind: "TypeDecl", name, parents, fields };
}

function createObjectDecl(typeName, objectName, fields) {
    return { kind: "ObjectDecl", typeName, objectName, fields };
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

function createAssignStatement(targetChain, expr) {
    return { kind: "AssignStatement", targetChain, expr };
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

function createFieldAssign(fieldName, value) {
    return { kind: "FieldAssign", fieldName, value };
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

module.exports = {
    createProgram,
    createTypeDecl,
    createObjectDecl,
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
    createPropertyAccess,
    createConcat,
    createEqualsExpr,
};
