// Resolves an action-selector AST (SelAny/SelAtom/SelNot/SelAnd/SelOr) to a
// sorted array of concrete action names. The action universe and the tag ->
// members map are passed in so the checker and emitter passes share one copy of
// the set algebra. `makeError(filePath, lineNumber, message)` builds the Error
// to throw, letting each caller keep its own diagnostic format.
function resolveSelector(node, actionNames, tagMembers, makeError) {
    const universe = new Set(actionNames);
    function resolveSet(n) {
        if (n.kind === "SelAny") return new Set(universe);
        if (n.kind === "SelAtom") {
            if (universe.has(n.name)) return new Set([n.name]);
            if (tagMembers.has(n.name)) return new Set(tagMembers.get(n.name));
            throw makeError(n.filePath, n.lineNumber, `unknown action or tag "${n.name}"`);
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
        throw makeError(node.filePath, node.lineNumber, "action selector matches no actions");
    }
    return [...result].sort();
}

module.exports = { resolveSelector };
