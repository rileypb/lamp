const typeRegistry = new Map();
const instanceRegistry = new Map();
const nameRegistry = new Map();
const eventRegistry = new Map();
const kindRegistry = new Map();
const globalRegistry = new Map();
const changeHandlerRegistry = new Map();
const relationRegistry = new Map();

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

function run() {
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
            return items[0];
        },
    };
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
    registerChangeHandler,
    setField,
    dispatch: fireEvent,
    run,
    print,
    setPrint,
    error,
    makeList,
};
