const typeRegistry = new Map();
const instanceRegistry = new Map();
const eventRegistry = new Map();

let printImpl = (value) => {
    console.log(String(value));
};

let builtinsInitialized = false;

function bootstrapBuiltins() {
    if (builtinsInitialized) {
        return;
    }

    defineType("object", null, {});
    defineType("type", "object", {});
    defineType("event", "object", {});
    defineType("string", "object", {});
    defineType("int", "object", {});
    defineType("bool", "object", {});
    defineType("real", "object", {});
    defineType("list", "object", {});

    builtinsInitialized = true;
}

function defineType(name, parent, fields) {
    if (typeRegistry.has(name)) {
        throw new Error(`Type already defined: ${name}`);
    }

    if (parent && !typeRegistry.has(parent)) {
        throw new Error(`Parent type is not defined: ${parent}`);
    }

    typeRegistry.set(name, {
        name,
        parent,
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
    let currentTypeName = candidateTypeName;
    while (currentTypeName) {
        if (currentTypeName === ancestorTypeName) {
            return true;
        }
        const currentType = typeRegistry.get(currentTypeName);
        currentTypeName = currentType ? currentType.parent : null;
    }
    return false;
}

module.exports = {
    bootstrapBuiltins,
    defineType,
    createObject,
    type,
    onEvent,
    run,
    print,
    setPrint,
    error,
};
