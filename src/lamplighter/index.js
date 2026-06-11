const typeRegistry = new Map();
const instanceRegistry = new Map();
const eventRegistry = new Map();
const kindRegistry = new Map();

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
    return instance;
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
    printImpl(value);
}

function setPrint(nextPrintImpl) {
    printImpl = nextPrintImpl;
}

function error(message) {
    throw new Error(String(message));
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
    createObject,
    type,
    defineKind,
    enum: enumKind,
    kind,
    onEvent,
    run,
    print,
    setPrint,
    error,
};
