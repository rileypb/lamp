function createProgram(nodes) {
    return { kind: "Program", nodes };
}

function createTypeDecl(name, parent, fields) {
    return { kind: "TypeDecl", name, parent, fields };
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

function createFieldDecl(typeName, fieldName) {
    return { kind: "FieldDecl", typeName, fieldName };
}

function createFieldAssign(fieldName, value) {
    return { kind: "FieldAssign", fieldName, value };
}

function createStringLiteral(value) {
    return { kind: "StringLiteral", value };
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
    createFieldDecl,
    createFieldAssign,
    createStringLiteral,
    createNumberLiteral,
    createPropertyAccess,
    createConcat,
};
