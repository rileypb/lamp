const typeRegistry = new Map();
const instanceRegistry = new Map();
const nameRegistry = new Map();
const eventRegistry = new Map();
const kindRegistry = new Map();
const globalRegistry = new Map();
const changeHandlerRegistry = new Map();
const relationAddHandlerRegistry = new Map();
const relationRemoveHandlerRegistry = new Map();
const relationRegistry = new Map();
// actionName -> { before: [], instead: [], check: [], do: [], after: [], report: [] }
const actionRuleRegistry = new Map();
const ACTION_BANDS = ["before", "instead", "check", "do", "after", "report"];

// Wildcard sentinel for relation queries: matches any value in a slot. Distinct
// from null/none (which match only an unset field).
const ANY = Symbol("relation-wildcard");

let printImpl = (value) => {
    console.log(String(value));
};

let builtinsInitialized = false;

function bootstrapBuiltins() {
    if (builtinsInitialized) {
        return;
    }

    defineType("object", [], {});
    defineType("type", ["object"], {});
    defineType("event", ["object"], {});
    defineType("string", ["object"], {});
    defineType("int", ["object"], {});
    defineType("bool", ["object"], {});
    defineType("real", ["object"], {});
    defineType("list", ["object"], {});
    // Built-in parent of every `action` declaration. Bootstrapped here (not as a
    // `type action` in lib/sys) because `action` is a reserved keyword.
    defineType("action", ["object"], {});

    builtinsInitialized = true;
}

function defineType(name, parents, fields) {
    if (typeRegistry.has(name)) {
        throw new Error(`Type already defined: ${name}`);
    }

    const normalizedParents = normalizeParentList(parents);
    for (const parentName of normalizedParents) {
        if (!typeRegistry.has(parentName)) {
            throw new Error(`Parent type is not defined: ${parentName}`);
        }
    }

    typeRegistry.set(name, {
        name,
        parents: normalizedParents,
        fields: { ...fields },
    });

    if (!instanceRegistry.has(name)) {
        instanceRegistry.set(name, []);
    }
}

// A relation type is registered as an ordinary type (so `TYPE.all` and the
// instance registry work) plus a relation-specific record carrying the field
// schema and optional syntax template for later phases (assertion, querying).
function defineRelation(name, fields, syntaxTemplate = null, invertedFields = []) {
    defineType(name, [], fields);
    relationRegistry.set(name, {
        name,
        fields: { ...fields },
        syntax: syntaxTemplate,
        invertedFields: [...invertedFields],
    });
}

// Asserts a relation instance. Deduplicates by field values (object fields by
// identity, value fields by ===), returning the existing instance on a match so
// that asserting the same edge twice is a no-op. Instances live in the type's
// instance list so that `TYPE.all` includes them.
function addRelation(typeName, fields, options = {}) {
    if (!relationRegistry.has(typeName)) {
        throw new Error(`Cannot assert unknown relation: ${typeName}`);
    }

    const existing = findMatchingRelation(typeName, fields);
    if (existing) {
        if (options.name && !existing.name) {
            existing.name = options.name;
            nameRegistry.set(options.name, existing);
        }
        if (options.bidi) {
            existing.bidi = true;
        }
        return existing;
    }

    const instance = {
        name: options.name ?? null,
        type: typeName,
        bidi: Boolean(options.bidi),
        ...fields,
    };

    instanceRegistry.get(typeName).push(instance);
    if (options.name) {
        nameRegistry.set(options.name, instance);
    }
    for (const handler of (relationAddHandlerRegistry.get(typeName) || [])) {
        handler(instance);
    }
    return instance;
}

// An instance matches `fields` if its own field values match, or — for a
// bidirectional instance — if its mechanically computed inverse matches (so the
// reverse edge of a `bidi` deduplicates against it).
function findMatchingRelation(typeName, fields) {
    const keys = Object.keys(relationRegistry.get(typeName).fields);
    const matches = (mapping) => keys.every((key) => mapping[key] === fields[key]);
    for (const instance of (instanceRegistry.get(typeName) || [])) {
        if (matches(instance)) {
            return instance;
        }
        if (instance.bidi && matches(relationInverse(typeName, instance))) {
            return instance;
        }
    }
    return null;
}

// Returns the matching edges as **oriented** field-mappings: a direct match
// yields the instance itself; a bidirectional instance matched via its inverse
// yields the inverse mapping, so reading a field reflects the queried direction.
// A slot holding ANY matches any value; other slots match by identity/value.
function queryRelation(typeName, query) {
    if (!relationRegistry.has(typeName)) {
        throw new Error(`Cannot query unknown relation: ${typeName}`);
    }
    const keys = Object.keys(relationRegistry.get(typeName).fields);
    const matches = (mapping) => keys.every((key) => query[key] === ANY || mapping[key] === query[key]);
    const results = [];
    for (const instance of (instanceRegistry.get(typeName) || [])) {
        if (matches(instance)) {
            results.push(instance);
        } else if (instance.bidi) {
            const inverse = relationInverse(typeName, instance);
            if (matches(inverse)) {
                results.push(inverse);
            }
        }
    }
    return results;
}

// Removes all instances matching `query` (using ANY as wildcard). For `bidi`
// instances, a match via the mechanical inverse also triggers removal of the
// underlying instance (both index entries go away together).
function removeRelation(typeName, query) {
    if (!relationRegistry.has(typeName)) {
        throw new Error(`Cannot remove unknown relation: ${typeName}`);
    }
    const keys = Object.keys(relationRegistry.get(typeName).fields);
    const matches = (mapping) => keys.every((key) => query[key] === ANY || mapping[key] === query[key]);
    const instances = instanceRegistry.get(typeName) || [];
    const toRemove = new Set();
    for (const instance of instances) {
        if (matches(instance) || (instance.bidi && matches(relationInverse(typeName, instance)))) {
            toRemove.add(instance);
        }
    }
    for (const instance of toRemove) {
        const idx = instances.indexOf(instance);
        if (idx !== -1) instances.splice(idx, 1);
        if (instance.name) {
            nameRegistry.delete(instance.name);
        }
        for (const handler of (relationRemoveHandlerRegistry.get(typeName) || [])) {
            handler(instance);
        }
    }
}

// Removes the relation instance registered under `name`. Runtime error if no
// such instance exists or if the name refers to a non-relation object.
function removeRelationByName(name) {
    const instance = nameRegistry.get(name);
    if (!instance || !relationRegistry.has(instance.type)) {
        throw new Error(`No relation instance named '${name}'`);
    }
    const typeName = instance.type;
    const instances = instanceRegistry.get(typeName) || [];
    const idx = instances.indexOf(instance);
    if (idx !== -1) instances.splice(idx, 1);
    nameRegistry.delete(name);
    for (const handler of (relationRemoveHandlerRegistry.get(typeName) || [])) {
        handler(instance);
    }
}

// Value query: returns the `outputField` of matching (oriented) edges.
//   "all"   -> a list of the values
//   "first" -> the first value, or none if no match
//   "only"  -> the single value, none if no match, runtime error if more than one
function queryRelationValue(typeName, query, outputField, mode) {
    const values = queryRelation(typeName, query).map((mapping) => mapping[outputField]);
    if (mode === "all") {
        return makeList(values);
    }
    if (mode === "first") {
        return values.length > 0 ? values[0] : null;
    }
    if (values.length > 1) {
        throw new Error(`relation query expected at most one ${typeName} but matched ${values.length}`);
    }
    return values.length === 1 ? values[0] : null;
}

// The mechanical inverse mapping: swap source/target, replace each `inverted`
// field with its value's own inverse, copy everything else.
function relationInverse(typeName, src) {
    const rel = relationRegistry.get(typeName);
    const inverted = new Set(rel.invertedFields || []);
    const out = {};
    for (const key of Object.keys(rel.fields)) {
        if (key === "source") {
            out.target = src.source;
        } else if (key === "target") {
            out.source = src.target;
        } else {
            out[key] = inverted.has(key) ? (src[key] == null ? null : src[key].inverse) : src[key];
        }
    }
    return out;
}

function createObject(typeName, objectName, fieldValues) {
    if (!typeRegistry.has(typeName)) {
        throw new Error(`Cannot create object of unknown type: ${typeName}`);
    }

    const instance = {
        name: objectName,
        type: typeName,
        ...fieldValues,
    };

    instanceRegistry.get(typeName).push(instance);
    nameRegistry.set(objectName, instance);
    return instance;
}

function getObject(name) {
    if (!nameRegistry.has(name)) {
        throw new Error(`Unknown object: ${name}`);
    }
    return nameRegistry.get(name);
}

function type(name) {
    if (!typeRegistry.has(name)) {
        throw new Error(`Unknown type: ${name}`);
    }

    return {
        get all() {
            const allInstances = getInstancesForTypeAndSubtypes(name);
            return makeList(allInstances);
        },
    };
}

function registerRelationAddHandler(relationName, handler) {
    if (!relationAddHandlerRegistry.has(relationName)) {
        relationAddHandlerRegistry.set(relationName, []);
    }
    relationAddHandlerRegistry.get(relationName).push(handler);
}

function registerRelationRemoveHandler(relationName, handler) {
    if (!relationRemoveHandlerRegistry.has(relationName)) {
        relationRemoveHandlerRegistry.set(relationName, []);
    }
    relationRemoveHandlerRegistry.get(relationName).push(handler);
}

function registerChangeHandler(typeName, fieldName, handler) {
    const key = `${typeName}\x00${fieldName}`;
    if (!changeHandlerRegistry.has(key)) {
        changeHandlerRegistry.set(key, []);
    }
    changeHandlerRegistry.get(key).push(handler);
}

function setField(instance, fieldName, value) {
    instance[fieldName] = value;
    const visited = new Set();
    function fireForType(typeName) {
        if (visited.has(typeName)) return;
        visited.add(typeName);
        const handlers = changeHandlerRegistry.get(`${typeName}\x00${fieldName}`) || [];
        for (const handler of handlers) {
            handler(instance);
        }
        for (const parent of (typeRegistry.get(typeName)?.parents || [])) {
            fireForType(parent);
        }
    }
    fireForType(instance.type);
}

function onEvent(eventName, handler) {
    if (!eventRegistry.has(eventName)) {
        eventRegistry.set(eventName, []);
    }
    eventRegistry.get(eventName).push(handler);
}

function registerActionRule(actionName, band, rule) {
    if (!actionRuleRegistry.has(actionName)) {
        actionRuleRegistry.set(actionName, { before: [], instead: [], check: [], do: [], after: [], report: [] });
    }
    actionRuleRegistry.get(actionName)[band].push(rule);
}

// Runs an action instance through its rulebook bands in fixed order. A rule that
// returns a value (a `stop`) ends the action with that outcome; a rule that
// returns undefined (falls through) continues to the next rule. With no stop the
// action succeeds. See devdocs/rulebooks.md.
function runAction(actionName, instance) {
    const bands = actionRuleRegistry.get(actionName);
    if (!bands) {
        return "succeeded";
    }
    for (const band of ACTION_BANDS) {
        for (const rule of bands[band]) {
            const outcome = rule(instance);
            if (outcome !== undefined) {
                return outcome;
            }
        }
    }
    return "succeeded";
}

// --- Game Parser (v0) -------------------------------------------------------
// A grammar entry maps an action to one parsed surface template. Templates are
// literal tokens plus `[slot]` markers; see devdocs/game_parser.md.
const grammarRegistry = [];

function parseGrammarTemplate(template) {
    return template.trim().split(/\s+/).filter(Boolean).map((part) => {
        const slot = part.match(/^\[([A-Za-z_][A-Za-z0-9_]*)\]$/);
        return slot ? { kind: "slot", field: slot[1] } : { kind: "literal", text: part.toLowerCase() };
    });
}

function registerGrammar(actionName, template) {
    grammarRegistry.push({ actionName, parts: parseGrammarTemplate(template) });
}

// Matches a token list against one template's parts. Literals must match
// verbatim; a slot captures the run of tokens up to the next literal (or the
// end). Returns a field -> token-span map, or null if the template does not
// match the whole input.
function matchGrammar(parts, tokens) {
    const slots = {};
    let ti = 0;
    for (let pi = 0; pi < parts.length; pi += 1) {
        const part = parts[pi];
        if (part.kind === "literal") {
            if (tokens[ti] !== part.text) return null;
            ti += 1;
        } else {
            const nextLiteral = parts[pi + 1] && parts[pi + 1].kind === "literal" ? parts[pi + 1].text : null;
            const span = [];
            while (ti < tokens.length && tokens[ti] !== nextLiteral) {
                span.push(tokens[ti]);
                ti += 1;
            }
            if (span.length === 0) return null;
            slots[part.field] = span;
        }
    }
    return ti === tokens.length ? slots : null;
}

// The objects the actor can currently refer to: contents of the actor's location
// and the actor's own contents, via the `holder` containment field.
function scopeOf(actor) {
    const location = actor.holder;
    const results = [];
    for (const instances of instanceRegistry.values()) {
        for (const inst of instances) {
            if (inst.holder === location || inst.holder === actor) {
                results.push(inst);
            }
        }
    }
    return results;
}

// The candidate objects for a slot. Physical objects must be in the actor's
// scope; non-physical objects (e.g. directions) are referable globally by name
// within their type. A game without a `physical` type keeps everything scoped.
function resolvePool(slotType, scope) {
    if (slotType && typeRegistry.has("physical") && !isTypeOrSubtype(slotType, "physical")) {
        return getInstancesForTypeAndSubtypes(slotType);
    }
    return scope;
}

// token → Set<object>. Populated by buildVocabIndex() at run() time.
let vocabIndex = new Map();

const ARTICLES = new Set(["a", "an", "the", "some"]);

function buildVocabIndex() {
    vocabIndex = new Map();
    for (const instances of instanceRegistry.values()) {
        for (const obj of instances) {
            const tokens = new Set();
            for (const t of String(obj.name).toLowerCase().split(/[_\s]+/).filter(Boolean)) {
                tokens.add(t);
            }
            if (obj.understand) {
                for (const t of String(obj.understand).toLowerCase().split("/").map((s) => s.trim()).filter(Boolean)) {
                    tokens.add(t);
                }
            }
            for (const token of tokens) {
                if (!vocabIndex.has(token)) vocabIndex.set(token, new Set());
                vocabIndex.get(token).add(obj);
            }
        }
    }
}

// Objects whose vocabulary is a superset of every token in `tokens`.
function objectsForTokens(tokens) {
    if (tokens.length === 0) return [];
    let candidates = null;
    for (const token of tokens) {
        const matches = vocabIndex.get(token) || new Set();
        if (candidates === null) {
            candidates = new Set(matches);
        } else {
            for (const obj of candidates) {
                if (!matches.has(obj)) candidates.delete(obj);
            }
        }
    }
    return candidates ? [...candidates] : [];
}

// All in-scope objects of the slot's type whose vocabulary matches the noun span.
function resolveCandidates(span, scope, slotType) {
    const stripped = span.filter((t) => !ARTICLES.has(t));
    const phraseTokens = stripped.length > 0 ? stripped : span;
    const scopeSet = new Set(scope);
    return objectsForTokens(phraseTokens).filter(
        (obj) => scopeSet.has(obj) && (!slotType || isTypeOrSubtype(obj.type, slotType)),
    );
}

// The vocabulary token set for a single object: identifier tokens + understand tokens.
function objectVocab(obj) {
    const vocab = new Set();
    for (const t of String(obj.name).toLowerCase().split(/[_\s]+/).filter(Boolean)) vocab.add(t);
    if (obj.understand) {
        for (const t of String(obj.understand).toLowerCase().split("/").map((s) => s.trim()).filter(Boolean)) vocab.add(t);
    }
    return vocab;
}

function objectDisplayName(obj) {
    if (obj.printed_name) return String(obj.printed_name);
    return String(obj.name).replace(/_/g, " ");
}

function printDisambiguationPrompt(candidates) {
    const names = candidates.map((obj) => "the " + objectDisplayName(obj));
    if (names.length === 2) {
        print(`Which do you mean: ${names[0]} or ${names[1]}?`);
    } else {
        const last = names[names.length - 1];
        print(`Which do you mean: ${names.slice(0, -1).join(", ")}, or ${last}?`);
    }
}

// Pending disambiguation: set when a slot matches multiple candidates.
// Cleared on the next runCommand call whether or not the answer resolves it.
let pendingDisambiguation = null;

// Resolve [field, span] slot pairs onto `instance`. Returns true when all
// slots are filled; false if a slot fails (message already printed) or
// disambiguation is needed (pendingDisambiguation is set).
function resolveSlots(slots, instance, scope, slotTypes) {
    for (let i = 0; i < slots.length; i++) {
        const [field, span] = slots[i];
        const candidates = resolveCandidates(span, resolvePool(slotTypes[field], scope), slotTypes[field]);
        if (candidates.length === 0) {
            print("You can't see any such thing.");
            return false;
        }
        if (candidates.length === 1) {
            instance[field] = candidates[0];
        } else {
            printDisambiguationPrompt(candidates);
            pendingDisambiguation = {
                actionName: instance.type,
                instance,
                field,
                candidates,
                remainingSlots: slots.slice(i + 1),
                scope,
                slotTypes,
            };
            return false;
        }
    }
    return true;
}

// Parses one line of player input and runs the matched action. If a pending
// disambiguation exists, tries to resolve it first; if the input doesn't match
// any candidate it is discarded and treated as a fresh command.
function runCommand(line, actor) {
    const tokens = String(line).toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;

    if (pendingDisambiguation) {
        const { actionName, instance, field, candidates, remainingSlots, scope, slotTypes } = pendingDisambiguation;
        const stripped = tokens.filter((t) => !ARTICLES.has(t));
        const phraseTokens = stripped.length > 0 ? stripped : tokens;
        const narrowed = candidates.filter((obj) => phraseTokens.every((t) => objectVocab(obj).has(t)));
        if (narrowed.length === 1) {
            pendingDisambiguation = null;
            instance[field] = narrowed[0];
            if (resolveSlots(remainingSlots, instance, scope, slotTypes)) {
                runAction(actionName, instance);
            }
            return;
        }
        if (narrowed.length > 1) {
            // Still ambiguous — re-prompt with the narrowed set.
            printDisambiguationPrompt(narrowed);
            pendingDisambiguation = { ...pendingDisambiguation, candidates: narrowed };
            return;
        }
        // 0 matches — treat input as a fresh command.
        pendingDisambiguation = null;
    }

    for (const entry of grammarRegistry) {
        const matched = matchGrammar(entry.parts, tokens);
        if (!matched) continue;
        const scope = scopeOf(actor);
        const slotTypes = (typeRegistry.get(entry.actionName) || {}).fields || {};
        const instance = { type: entry.actionName, actor };
        if (resolveSlots(Object.entries(matched), instance, scope, slotTypes)) {
            runAction(entry.actionName, instance);
        }
        return;
    }
    print("I don't understand that.");
}

function run() {
    buildVocabIndex();
    fireEvent("startup");
}

function fireEvent(eventName) {
    const handlers = eventRegistry.get(eventName) || [];
    for (const handler of handlers) {
        handler();
    }
}

function print(value) {
    printImpl(formatValue(value));
}

function defineGlobal(name, value) {
    if (globalRegistry.has(name)) {
        throw new Error(`Global already defined: ${name}`);
    }
    globalRegistry.set(name, value);
}

function setGlobal(name, value) {
    if (!globalRegistry.has(name)) {
        throw new Error(`Unknown global: ${name}`);
    }
    globalRegistry.set(name, value);
}

function getGlobal(name) {
    return globalRegistry.get(name);
}

function setPrint(nextPrintImpl) {
    printImpl = nextPrintImpl;
}

// Player input is a brokered host capability. The host owns stdin and the worker
// installs an input channel via setInputChannel; readLine blocks on that channel.
// A game run outside the sandbox has no channel and cannot read input — the
// sandbox launcher is the only supported run path. See devdocs/sandbox.md.
let requestLineImpl = null;

function setInputChannel(requestLine) {
    requestLineImpl = requestLine;
}

function readLine() {
    if (!requestLineImpl) {
        throw new Error("no input channel installed; run the game through the sandbox launcher");
    }
    return requestLineImpl();
}

function error(message) {
    throw new Error(String(message));
}

function concat(left, right) {
    if (typeof left === "number" && typeof right === "number") {
        return left + right;
    }
    return String(formatValue(left)) + String(formatValue(right));
}

function divide(a, b) {
    return b === 0 ? NaN : a / b;
}

function formatValue(value) {
    if (isListValue(value)) {
        return formatListValue(value.items);
    }
    if (value && typeof value === "object" && typeof value.name === "string") {
        return value.name;
    }
    if (value && typeof value === "object" && relationRegistry.has(value.type)) {
        return formatRelationValue(value);
    }
    return value;
}

function formatRelationValue(instance) {
    const fieldNames = Object.keys(relationRegistry.get(instance.type).fields);
    const parts = fieldNames.map((fieldName) => String(formatValue(instance[fieldName])));
    return `${instance.type}(${parts.join(", ")})`;
}

function isListValue(value) {
    return Boolean(value) && typeof value === "object" && Array.isArray(value.items) && "first" in value;
}

function formatListValue(items) {
    const formattedItems = items.map((item) => String(formatValue(item)));
    const useOxfordComma = Boolean(getGlobal("USE OXFORD COMMA"));

    if (formattedItems.length === 0) {
        return "nothing";
    }
    if (formattedItems.length === 1) {
        return formattedItems[0];
    }
    if (formattedItems.length === 2) {
        return `${formattedItems[0]} and ${formattedItems[1]}`;
    }

    if (useOxfordComma) {
        return `${formattedItems.slice(0, -1).join(", ")}, and ${formattedItems[formattedItems.length - 1]}`;
    }
    return `${formattedItems.slice(0, -1).join(", ")} and ${formattedItems[formattedItems.length - 1]}`;
}

function makeList(items) {
    return {
        items,
        get first() {
            return items.length > 0 ? items[0] : null;
        },
    };
}

// Normalizes any list-valued expression to a plain array for `for ... in`
// iteration. `none` iterates as empty; raw arrays pass through.
function listItems(value) {
    if (value == null) {
        return [];
    }
    if (isListValue(value)) {
        return value.items;
    }
    if (Array.isArray(value)) {
        return value;
    }
    throw new Error("for ... in expected a list");
}

function getInstancesForTypeAndSubtypes(typeName) {
    const results = [];
    for (const [registeredTypeName, instances] of instanceRegistry.entries()) {
        if (isTypeOrSubtype(registeredTypeName, typeName)) {
            results.push(...instances);
        }
    }
    return results;
}

function isTypeOrSubtype(candidateTypeName, ancestorTypeName) {
    const stack = [candidateTypeName];
    const visited = new Set();

    while (stack.length > 0) {
        const currentTypeName = stack.pop();
        if (!currentTypeName || visited.has(currentTypeName)) {
            continue;
        }
        visited.add(currentTypeName);

        if (currentTypeName === ancestorTypeName) {
            return true;
        }

        const currentType = typeRegistry.get(currentTypeName);
        const parents = currentType ? currentType.parents || [] : [];
        for (const parentName of parents) {
            stack.push(parentName);
        }
    }

    return false;
}

function normalizeParentList(parents) {
    if (parents == null) {
        return [];
    }
    if (Array.isArray(parents)) {
        return [...parents];
    }
    if (typeof parents === "string") {
        return [parents];
    }
    throw new Error("Invalid parent type list");
}

function defineKind(name, kindDef) {
    if (kindRegistry.has(name)) {
        throw new Error(`Kind already defined: ${name}`);
    }
    kindRegistry.set(name, kindDef);
}

function enumKind(...labels) {
    return { kindType: "enum", labels };
}

function kind(name) {
    if (!kindRegistry.has(name)) {
        throw new Error(`Unknown kind: ${name}`);
    }
    return kindRegistry.get(name);
}

module.exports = {
    bootstrapBuiltins,
    defineType,
    defineRelation,
    addRelation,
    removeRelation,
    removeRelationByName,
    queryRelation,
    queryRelationValue,
    ANY,
    createObject,
    getObject,
    defineGlobal,
    setGlobal,
    getGlobal,
    type,
    defineKind,
    enum: enumKind,
    kind,
    concat,
    divide,
    onEvent,
    registerActionRule,
    runAction,
    registerGrammar,
    runCommand,
    registerChangeHandler,
    registerRelationAddHandler,
    registerRelationRemoveHandler,
    setField,
    dispatch: fireEvent,
    run,
    print,
    setPrint,
    setInputChannel,
    readLine,
    error,
    makeList,
    listItems,
};
