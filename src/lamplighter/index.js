// decode reverses Lantern's optional build-time string encoding (--encode-strings);
// the emitter wraps player-facing literals as lamplighter.decode("..."). The same
// reversible codec (encode) also obfuscates save files. See src/strcodec.js.
const { encode: encodeText, decode } = require("../strcodec");

const typeRegistry = new Map();
// World objects only. Relation edges live in relationInstanceRegistry, kept out
// of this registry so that world iteration (buildVocabIndex, and scopeOf's
// instance sweep) never accidentally walks graph edges. scopeOf does consult
// containment via an explicit `contains` query (containerOf) — a targeted lookup,
// not edge-iteration of this registry.
const instanceRegistry = new Map();
// relationTypeName -> edge instances. Kept separate from instanceRegistry; the
// only place the two are unioned is getInstancesForTypeAndSubtypes (so a
// relation's `.all` still returns its edges).
const relationInstanceRegistry = new Map();
const nameRegistry = new Map();
const eventRegistry = new Map();
const kindRegistry = new Map();
const globalRegistry = new Map();
const changeHandlerRegistry = new Map();
const relationAddHandlerRegistry = new Map();
const relationRemoveHandlerRegistry = new Map();
const relationRegistry = new Map();
// actionName -> { before: [], instead: [], check: [], do: [], after: [], report: [], report_failed: [] }
// Each band holds { rule, order } entries; `order` (0 author, 1 library) sorts
// author rules ahead of library rules so an author rule can run first and halt
// the band. See devdocs/rulebooks.md, "Cross-rule override suppression".
const actionRuleRegistry = new Map();
const ACTION_BANDS = ["before", "instead", "check", "do", "after", "report"];

// Rules contributed to a named (user-defined) rulebook, keyed by rulebook name.
// Like actions, rulebook rules are registry-backed so a game file can add rules
// to a library rulebook; the emitted dispatcher consults this via runRulebook.
const rulebookRuleRegistry = new Map();

// Sentinel returned by a bare `stop`: halt the band/pipeline without deciding an
// outcome (distinct from `undefined`, which falls through to the next rule, and
// from an outcome value, which stops and decides). See devdocs/rulebooks.md.
const HALT = Symbol("halt");

// Wildcard sentinel for relation queries: matches any value in a slot. Distinct
// from null/none (which match only an unset field).
const ANY = Symbol("relation-wildcard");

// --- Runtime ↔ world-model contract -----------------------------------------
// Lamplighter is a parser-IF runtime, so a few world-model names are baked into
// the engine rather than configured (see devdocs/world-model.md, decision D1). A
// world library (e.g. lib/advent) must provide them; the engine references them
// by these exact names:
//
//   - relation `contains` — an object's container is the source of its `contains`
//                          edge (the object is the target; the `to` endpoint is
//                          `unique`, so each object is in at most one place).
//                          scopeOf walks reachability over it (containerOf); an
//                          uncontained object is out of scope.
//                          `moveObject`/`move X to Y` asserts a `contains` edge.
//   - type  `physical`   — the scope-root type. Only `physical` objects are
//                          scoped by location and can be pronoun antecedents;
//                          non-physical nameables (e.g. directions) are global.
//                          If no `physical` type exists, everything is in scope.
//   - outcomes `succeeded` / `failed` — the action-pipeline result values (see
//                          the `outcome` kind in lib/sys/kinds.lamp). runAction
//                          runs the `report failed` band on a `failed` outcome.
//   - event `startup`    — fired once by run(); the world library hooks it to set
//                          up the world and drive the command loop.
//
// A few more names are hardcoded, historically documented only at their use sites.
// They follow the same D1 "IF runtime by design" decision; enumerated here so a
// world-library author sees the whole surface in one place:
//
//   - object fields: `understand` (extra vocabulary tokens, `/`-separated) and
//                    `private_name` (suppress the identifier tokens, Inform's
//                    "privately-named") — both read by buildVocabIndex/objectVocab;
//                    `printed_name` (display override for the canonical name) —
//                    read by objectDisplayName/formatValue.
//   - globals: `act` (the running action instance; bound transiently by runAction
//                    and skipped by the globals state provider — execution state,
//                    not world state) and `undo limit` (the undo-stack depth,
//                    read by undoLimit).
//   - type `game` with fields `name`/`author` — read by gameInfo for the save
//                    header and the web page title.
//
// The commanding actor is NOT in this contract — it is passed into run_command
// explicitly (no `player` global is assumed). Proper/plural naming is likewise NOT
// here: it is locale presentation policy (the `proper`/`plural` fields the locale
// packs read, see lib/en-US/index.js), installed via setParserLanguage, not engine
// contract. Each site that depends on a contract name is tagged "world-model
// contract" below.

// All game output flows through the output-stream manager (paragraph control,
// text.md H) to this raw sink, which owns newlines. The sandbox worker swaps it for
// a message poster via setWrite; print no longer has its own channel.
let writeImpl = (value) => {
    process.stdout.write(String(value));
};

// The single chokepoint every output run passes through: it forwards to the host
// sink and, when a transcript is open, mirrors the plain text into it. The stream
// manager calls this instead of writeImpl directly so SCRIPT/TRANSCRIPT capture is
// transparent to it. Styles ride only to the host; the transcript stays plain text.
// See devdocs/state.md → Transcript (scripting).
function hostWrite(text, styles) {
    writeImpl(text, styles);
    transcriptCapture(text);
}

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

// A field's zero value by primitive type. A declared field with no author
// default reads as its zero (not undefined), so an unset string prints "" rather
// than the literal "undefined". Reference-typed fields (object/other types) are
// left unset — their absence is meaningful "none", and the convention is to
// declare an explicit `= none` where that matters (e.g. `room start = none`).
// `text`'s zero is the empty string (a string satisfies a text position), so an
// unset text field renders as "" like an unset string field.
const PRIMITIVE_ZEROS = { string: "", int: 0, real: 0, bool: false, text: "" };

// The merged field->type schema for a type, including inherited fields.
function collectFieldSchema(typeName) {
    const typeInfo = typeRegistry.get(typeName);
    if (!typeInfo) return {};
    const result = {};
    for (const parent of typeInfo.parents) {
        Object.assign(result, collectFieldSchema(parent));
    }
    Object.assign(result, typeInfo.fields);
    return result;
}

// Author-declared defaults only (own + inherited), nearest definition winning.
function collectAuthorDefaults(typeName) {
    const typeInfo = typeRegistry.get(typeName);
    if (!typeInfo) return {};
    const result = {};
    for (const parent of typeInfo.parents) {
        Object.assign(result, collectAuthorDefaults(parent));
    }
    Object.assign(result, typeInfo.defaults);
    return result;
}

function collectDefaults(typeName) {
    const result = collectAuthorDefaults(typeName);
    // Backfill a primitive zero for any declared field the author left without a
    // default, so unset primitives are well-defined values rather than undefined.
    for (const [field, fieldType] of Object.entries(collectFieldSchema(typeName))) {
        if (!(field in result) && Object.prototype.hasOwnProperty.call(PRIMITIVE_ZEROS, fieldType)) {
            result[field] = PRIMITIVE_ZEROS[fieldType];
        }
    }
    return result;
}

function defineType(name, parents, fields, defaults = {}) {
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
        defaults: { ...defaults },
    });

    if (!instanceRegistry.has(name)) {
        instanceRegistry.set(name, []);
    }
}

// A relation type is registered as an ordinary type (so `TYPE.all` and
// `isTypeOrSubtype` dispatch work) plus a relation-specific record carrying the
// field schema and optional syntax template for later phases (assertion,
// querying). Its edges live in relationInstanceRegistry, not the world-object
// instance registry, so we drop the empty instance list defineType created.
function defineRelation(name, fields, syntaxTemplate = null, invertedFields = [], sourceField = "source", targetField = "target", uniqueFields = []) {
    defineType(name, [], fields);
    instanceRegistry.delete(name);
    relationInstanceRegistry.set(name, []);
    relationRegistry.set(name, {
        name,
        fields: { ...fields },
        syntax: syntaxTemplate,
        invertedFields: [...invertedFields],
        uniqueFields: [...uniqueFields],
        sourceField,
        targetField,
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

    // Cardinality: a field tagged `unique` is a key — at most one edge per distinct
    // value of that field. Asserting an edge that shares its value in a unique field
    // evicts the prior edge (each unique field is an independent key). Eviction goes
    // through removeRelation so remove-handlers fire and any name is unregistered.
    const relationDef = relationRegistry.get(typeName);
    for (const uniqueField of relationDef.uniqueFields) {
        if (!(uniqueField in fields)) continue;
        const evictQuery = {};
        for (const key of Object.keys(relationDef.fields)) {
            evictQuery[key] = key === uniqueField ? fields[uniqueField] : ANY;
        }
        removeRelation(typeName, evictQuery);
    }

    const instance = {
        name: options.name ?? null,
        type: typeName,
        bidi: Boolean(options.bidi),
        ...fields,
    };

    relationInstanceRegistry.get(typeName).push(instance);
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
// `move X to Y` desugars here: assert the containment relation with Y as the
// container (source/`from` endpoint) and X as the contained (target/`to`
// endpoint). The relation's `unique` target evicts X's prior container, so a move
// is a single assertion. `contains` is the world-model containment contract (see
// devdocs/world-model.md); its endpoint field names are read from the registry so
// the world library is free to name them.
function moveObject(contained, container) {
    const def = relationRegistry.get("contains");
    if (!def) {
        throw new Error("Cannot 'move': the world model declares no 'contains' relation.");
    }
    return addRelation("contains", { [def.sourceField]: container, [def.targetField]: contained });
}

function findMatchingRelation(typeName, fields) {
    const keys = Object.keys(relationRegistry.get(typeName).fields);
    const matches = (mapping) => keys.every((key) => mapping[key] === fields[key]);
    for (const instance of (relationInstanceRegistry.get(typeName) || [])) {
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
    for (const instance of (relationInstanceRegistry.get(typeName) || [])) {
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
    const instances = relationInstanceRegistry.get(typeName) || [];
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
    const instances = relationInstanceRegistry.get(typeName) || [];
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

// The mechanical inverse mapping: swap source/target endpoints, replace each
// `inverted` field with its value's own inverse, copy everything else.
function relationInverse(typeName, src) {
    const rel = relationRegistry.get(typeName);
    const inverted = new Set(rel.invertedFields || []);
    const sf = rel.sourceField;
    const tf = rel.targetField;
    const out = {};
    for (const key of Object.keys(rel.fields)) {
        if (key === sf) {
            out[tf] = src[sf];
        } else if (key === tf) {
            out[sf] = src[tf];
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
        ...collectDefaults(typeName),
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

function registerActionRule(actionName, band, rule, order = 1) {
    if (!actionRuleRegistry.has(actionName)) {
        actionRuleRegistry.set(actionName, { before: [], instead: [], check: [], do: [], after: [], report: [], report_failed: [] });
    }
    actionRuleRegistry.get(actionName)[band].push({ rule, order });
}

// Author rules (order 0) before library rules (order 1); stable so source order
// is preserved within a tier.
function orderedRules(entries) {
    return [...entries].sort((a, b) => a.order - b.order);
}

function registerRulebookRule(name, rule, order = 1) {
    if (!rulebookRuleRegistry.has(name)) {
        rulebookRuleRegistry.set(name, []);
    }
    rulebookRuleRegistry.get(name).push({ rule, order });
}

// Runs a named rulebook's registered rules in order, each called with the
// rulebook's argument values. A rule returns an outcome value (`stop EXPR`) to
// stop with that value, `HALT` (a bare `stop`) to stop and fall back to the
// default, or `undefined` to continue. The emitted dispatcher supplies the
// default (it may depend on the args), so this reports only what happened:
// `{ stopped, value }`, with `stopped` false when every rule fell through.
function runRulebook(name, args) {
    for (const { rule } of orderedRules(rulebookRuleRegistry.get(name) || [])) {
        const result = rule(...args);
        if (result === HALT) {
            return { stopped: false };
        }
        if (result !== undefined) {
            return { stopped: true, value: result };
        }
    }
    return { stopped: false };
}

// Runs an action instance through its rulebook bands in fixed order. A rule
// returns one of: an outcome value (a `stop EXPR`) — end the pipeline with that
// outcome; `HALT` (a bare `stop`) — halt the band/pipeline keeping the current
// outcome; or `undefined` (fall through) — continue to the next rule. With no
// stop the action succeeds. On a `failed` outcome the `report_failed` band then
// runs to render the failure (self.reason is available); a bare `stop` there
// halts it, letting an author rule suppress a library one. See
// devdocs/rulebooks.md.
//
// World-model contract: the outcome values `succeeded`/`failed` are runtime-owned
// (mirrored by the `outcome` kind in lib/sys/kinds.lamp); `failed` triggers the
// `report failed` band.
// Action-pipeline nesting depth, so paragraph breaking only fires for the top-level
// command, not for implicit/nested `try` actions (whose output is part of the same
// paragraph). See devdocs/text.md H6 (rule B, per-band).
let actionDepth = 0;

function runAction(actionName, instance, opts = {}) {
    const bands = actionRuleRegistry.get(actionName);
    if (!bands) {
        return "succeeded";
    }
    actionDepth += 1;
    // Expose the running action as the `act` global for the duration of the action
    // (saved/restored so a nested `try` leaves `act` at the innermost action and
    // pops back). Direct registry access — `act` is transient execution state.
    const hasAct = globalRegistry.has("act");
    const savedAct = hasAct ? globalRegistry.get("act") : undefined;
    if (hasAct) globalRegistry.set("act", instance);
    try {
        let outcome = "succeeded";
        outer: for (const band of ACTION_BANDS) {
            if (opts.silent && band === "report") break outer;
            const printsBefore = streamMark();
            for (const { rule } of orderedRules(bands[band])) {
                const result = rule(instance);
                if (result === HALT) {
                    break outer;
                }
                if (result !== undefined) {
                    outcome = result;
                    break outer;
                }
            }
            // Rule B (H6): a paragraph break after a top-level action's `after` band,
            // but only if that band itself printed — separates its output from the
            // `report` band without intruding on `do`-band parentheticals.
            if (band === "after" && actionDepth === 1 && streamMark() > printsBefore) {
                streamRequestBreak(2);
            }
        }
        if (outcome === "failed" && !opts.silent) {
            for (const { rule } of orderedRules(bands.report_failed)) {
                const result = rule(instance);
                if (result === HALT || result !== undefined) {
                    break;
                }
            }
        }
        return outcome;
    } finally {
        if (hasAct) globalRegistry.set("act", savedAct);
        actionDepth -= 1;
    }
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

function setDirectSlot(actionName, fieldName) {
    const type = typeRegistry.get(actionName);
    if (!type) throw new Error(`setDirectSlot: unknown action type "${actionName}"`);
    type.directSlot = fieldName;
}

// Mark an action `out of world`: it runs normally (its bands fire) but bypasses the turn
// clock — no undo checkpoint, no turn-count advance, and runCommand returns false so the
// caller's every-turn rules don't fire. For meta/debug verbs. See devdocs/specs.md.
function setOutOfWorld(actionName) {
    const type = typeRegistry.get(actionName);
    if (!type) throw new Error(`setOutOfWorld: unknown action type "${actionName}"`);
    type.outOfWorld = true;
}
function isOutOfWorld(actionName) {
    return !!(typeRegistry.get(actionName) || {}).outOfWorld;
}

// Mark an action `world_scope`: its object slots resolve against every object in the world
// (all `physical` instances) rather than the actor's scope, so a debug verb can reach a
// thing that is out of sight, sealed away, or in another room. See devdocs/specs.md.
function setWorldScope(actionName) {
    const type = typeRegistry.get(actionName);
    if (!type) throw new Error(`setWorldScope: unknown action type "${actionName}"`);
    type.worldScope = true;
}
function isWorldScope(actionName) {
    return !!(typeRegistry.get(actionName) || {}).worldScope;
}

// Mark an action's `slot` as scoped to the CONTENTS of another slot (`take X from Y`): the slot
// resolves within `fromSlot`'s contents rather than the actor's scope. This narrows a same-named
// noun and bounds `all` (`take all from coffer`) to the source; a closed/empty source yields
// nothing, so a wrong object falls through to the generic no-match (as in Inform). The world
// library declares the relationship (e.g. `take_from`.`taken` scoped by `source`).
function setSlotScopedByContents(actionName, slot, fromSlot) {
    const type = typeRegistry.get(actionName);
    if (!type) throw new Error(`setSlotScopedByContents: unknown action type "${actionName}"`);
    type.scopeSlotBy = { slot, from: fromSlot };
}

// Mark an action `multi`: its direct slot accepts a multiple-object noun phrase
// ("drop ball and umbrella"); the parser resolves the list and dispatches the action
// once per object, so rules always see a single object in the slot. Off by default —
// a non-multi action given a list refuses with parser_no_multi. See devdocs/game_parser.md.
function setMultiAction(actionName) {
    const type = typeRegistry.get(actionName);
    if (!type) throw new Error(`setMultiAction: unknown action type "${actionName}"`);
    type.multi = true;
}
function isMultiAction(actionName) {
    return !!(typeRegistry.get(actionName) || {}).multi;
}

// The "all includes" hook: a world-library-installed function (action instance,
// object) -> bool deciding whether `all` includes the object for this action
// (Inform's "deciding whether all includes" activity). lib/advent installs its
// policy at startup via the `set_all_filter` native (excluding scenery/people,
// take-all excluding what's carried, drop-all only what's carried); a game may
// install its own, delegating back for the defaults. Null means include every
// type-eligible object in scope. Program structure, not world state: not
// snapshotted, and RESTART re-fires startup which reinstalls it.
let allFilter = null;
function setAllFilter(fn) {
    allFilter = fn;
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

// A missing-noun PARTIAL match: the template's final part is a slot the player left empty, and the
// prefix (everything before it) contains a verb literal AND consumes ALL the typed tokens. Returns
// `{ field }` for that empty final slot, else null. The trailing preposition (if any) must have
// been TYPED — we never supply an un-typed literal, because that could switch verbs (bare "take"
// would otherwise "complete" to "take off"). See devdocs/missing_noun.md.
function matchGrammarPartial(parts, tokens) {
    if (parts.length < 2) return null;
    const last = parts[parts.length - 1];
    if (last.kind !== "slot") return null;
    const prefix = parts.slice(0, parts.length - 1);
    if (!prefix.some((p) => p.kind === "literal")) return null;
    if (matchGrammar(prefix, tokens) === null) return null;
    return { field: last.field };
}

// The unique missing-noun completion for `tokens`, or null when there are zero or several. A
// template that FULLY matches is skipped (a complete command wins; the noun wasn't omitted).
// Deduped by action+slot, so verb synonyms ("examine"/"x") count once; several distinct
// completions (`put lamp in` vs `put lamp on` — only when the preposition is typed) fall through.
function uniquePartialCompletion(tokens) {
    const found = new Map();
    for (const entry of grammarRegistry) {
        if (matchGrammar(entry.parts, tokens) !== null) continue;
        const partial = matchGrammarPartial(entry.parts, tokens);
        if (!partial) continue;
        const slotTypes = (typeRegistry.get(entry.actionName) || {}).fields || {};
        found.set(entry.actionName + "|" + partial.field, {
            actionName: entry.actionName,
            field: partial.field,
            slotType: slotTypes[partial.field],
        });
    }
    return found.size === 1 ? [...found.values()][0] : null;
}

// The interrogative for a missing slot's type: a person → "who", a direction → "which_way",
// anything else → "what". The locale's nounMissing renderer turns this into prose.
function missingNounKind(slotType) {
    if (slotType && typeRegistry.has("person") && isTypeOrSubtype(slotType, "person")) return "who";
    if (slotType && typeRegistry.has("direction") && isTypeOrSubtype(slotType, "direction")) return "which_way";
    return "what";
}

// An object's container — the world-model containment contract. The container is
// the source of the object's `contains` edge (the object is the target); the `to`
// endpoint is `unique`, so there is at most one. Returns null when uncontained (or
// when the world declares no `contains` relation). See devdocs/world-model.md.
// A `target -> container` index over the `contains` relation. Its `contained`
// (target) endpoint is `unique`, so each object has at most one container and a
// plain Map is exact. Returns null when the world declares no `contains` relation.
// Built fresh from the edge list by whoever needs O(1) lookups (scopeOf) rather
// than maintained across edge mutations, so it can never drift from the edges.
function buildContainmentIndex() {
    const def = relationRegistry.get("contains");
    if (!def) return null;
    const index = new Map();
    for (const edge of (relationInstanceRegistry.get("contains") || [])) {
        index.set(edge[def.targetField], edge[def.sourceField]);
    }
    return index;
}

// The object directly containing `inst`, or null. Pass a prebuilt containment
// index (buildContainmentIndex) for an O(1) answer — scopeOf does this to avoid a
// per-object relation scan in its hot loop; one-off callers omit it and pay a
// single query. A null index means "no `contains` relation", same as omitting it.
function containerOf(inst, index) {
    if (index !== undefined) {
        return index === null ? null : (index.get(inst) ?? null);
    }
    const def = relationRegistry.get("contains");
    if (!def) return null;
    const query = {};
    for (const key of Object.keys(def.fields)) query[key] = ANY;
    query[def.targetField] = inst;
    const edges = queryRelation("contains", query);
    return edges.length > 0 ? edges[0][def.sourceField] : null;
}

// Scope-provider registry. Containment (`contains`) is the runtime's only built-in
// notion of presence; a world library that has objects present without being
// contained — doors (in two rooms, contained in neither), backdrops, "place X in
// scope" — registers a provider that contributes extra in-scope objects for an
// actor. Providers run after the containment sweep and before the fixpoint
// expansion, so a provided object's contained parts (e.g. a door's handprint
// scanner) are pulled into scope too. Mirrors the state-provider registry.
const scopeProviders = [];
function registerScopeProvider(provider) {
    scopeProviders.push(provider);
}

// Scope-barrier registry: the complement of a scope provider. A barrier predicate is
// asked, for a container already in scope, whether scope should expand INTO its
// contents. Returning true seals the container — its contents stay out of scope even
// though the container itself is referable. A world library registers one for closed
// containers (a shut box's contents aren't reachable until opened); core stays
// generic and never names the `closed` field itself.
const scopeBarriers = [];
function registerScopeBarrier(barrier) {
    scopeBarriers.push(barrier);
}
function sealsContents(container) {
    for (const barrier of scopeBarriers) {
        if (barrier(container)) return true;
    }
    return false;
}

// The objects the actor can currently refer to: contents of the actor's location
// and the actor's own contents, plus anything transitively contained by those
// objects (items resting on surfaces, contents of containers, etc.), plus whatever
// registered scope providers contribute. Reachability is computed over containment
// (containerOf): the `contains` relation.
function scopeOf(actor) {
    const containment = buildContainmentIndex();
    // Reach out through open enclosing containers: an actor nested in an open box or enterable
    // (a chair, a closet, an undercloset) still sees the enclosing room and everything in it. Walk
    // up from the immediate holder while it is contained by something AND does not seal (a closed
    // container stops the walk — its interior is the scope). The top (a room) has no container.
    let location = containerOf(actor, containment);
    while (location && containerOf(location, containment) && !sealsContents(location)) {
        location = containerOf(location, containment);
    }
    const inScope = new Set();

    for (const instances of instanceRegistry.values()) {
        for (const inst of instances) {
            const container = containerOf(inst, containment);
            if (container === location || container === actor) {
                inScope.add(inst);
            }
        }
    }

    for (const provider of scopeProviders) {
        const extra = provider(actor, location);
        if (extra) for (const obj of extra) if (obj) inScope.add(obj);
    }

    // Expand to fixpoint: if an object's container is in scope, the object is too.
    let changed = true;
    while (changed) {
        changed = false;
        for (const instances of instanceRegistry.values()) {
            for (const inst of instances) {
                if (inScope.has(inst)) continue;
                const container = containerOf(inst, containment);
                if (container && inScope.has(container) && !sealsContents(container)) {
                    inScope.add(inst);
                    changed = true;
                }
            }
        }
    }

    return [...inScope];
}

// The objects reachable INSIDE a container/supporter instance, for a FROM-scoped slot
// (`take X from Y`): its direct contents, or none if it seals them (a closed container). Mirrors
// scope's containment, so a closed box yields nothing — a wrong object then falls through to the
// generic no-match, as in Inform. Works for supporters too (their held items have it as container).
function contentsScope(container) {
    if (!container || sealsContents(container)) return [];
    const containment = buildContainmentIndex();
    const out = [];
    for (const instances of instanceRegistry.values()) {
        for (const inst of instances) {
            if (containerOf(inst, containment) === container) out.push(inst);
        }
    }
    return out;
}

// The candidate objects for a slot. Physical objects must be in the actor's
// scope; non-physical objects (e.g. directions) are referable globally by name
// within their type. A game without a `physical` type keeps everything scoped.
// World-model contract: the scope-root type is named `physical`.
function resolvePool(slotType, scope) {
    if (slotType && typeRegistry.has("physical") && !isTypeOrSubtype(slotType, "physical")) {
        return getInstancesForTypeAndSubtypes(slotType);
    }
    return scope;
}

// token → Set<object>. Populated by buildVocabIndex() at run() time.
let vocabIndex = new Map();

// Parser language data — the noun-phrase vocabulary (articles, pronouns, self
// words) and the failure/disambiguation prose — is locale-owned, installed via
// setParserLanguage (below), mirroring setListFormatter. The engine ships only
// neutral fallbacks (empty vocab, article-less prose) so it holds no language
// policy of its own; lib/en-US installs the English set, lib/fr-FR the French.
// A locale-less program (no locale pack) simply doesn't strip articles.
let parserArticles = new Set();

// Pronouns the player may use in place of a noun. Antecedents are tracked PER
// PRONOUN WORD: binding a noun phrase files the object under the words the
// locale chooses (setParserLanguage's `antecedentWords` hook — en-US files the
// object form of the thing's own pronoun set, so "it" stays a singular
// non-sentient reference while a plural binds "them", a she-person "her", and
// a neopronoun person its own object word, e.g. "xem"). A locale without the
// hook files every referent under all of its static pronoun words — the old
// single-antecedent behavior (fr-FR's le/la/les/ça).
let parserPronouns = new Set();

// word -> the last object filed under that pronoun word. Dynamic words (a
// neopronoun's object form) are recognized once bound, without appearing in
// the static parserPronouns list.
// word -> antecedent referent. Value is a single object for an ordinary/plural noun, OR an
// ARRAY of objects for a group pronoun ("them" after a multiple-object command) — see
// noteGroupAntecedent / pronounGroupOf.
let pronounAntecedents = new Map();
let antecedentWordsImpl = null;
// The pronoun word(s) a multiple-object *group* files under ("them" in en-US). Locale data,
// distinct from antecedentWords (which files a single object under its own pronoun).
let groupAntecedentWordsImpl = null;

// Pronouns refer to things in the world, not to non-physical referents such as
// directions, so only physical objects become antecedents. A game without a
// `physical` type treats every object as eligible (matching resolvePool).
// World-model contract: antecedent eligibility is gated on the `physical` type.
function canBeAntecedent(obj) {
    if (!typeRegistry.has("physical")) return true;
    return isTypeOrSubtype(obj.type, "physical");
}

function noteAntecedent(obj) {
    if (!canBeAntecedent(obj)) return;
    const words = antecedentWordsImpl ? antecedentWordsImpl(obj) : [...parserPronouns];
    for (const word of words || []) {
        pronounAntecedents.set(String(word).toLowerCase(), obj);
    }
}

// File a multiple-object result (2+ objects) under the locale's GROUP pronoun word(s) — "them"
// in en-US — so a later "them" refers to the whole set, unified with a plural collective object
// (which files the same word via noteAntecedent). A single object is not a group and is left to
// noteAntecedent. The set is snapshotted, so it doesn't track later world changes.
function noteGroupAntecedent(objects) {
    if (!objects || !groupAntecedentWordsImpl) return;
    const eligible = objects.filter(canBeAntecedent);
    if (eligible.length < 2) return;
    for (const word of groupAntecedentWordsImpl() || []) {
        pronounAntecedents.set(String(word).toLowerCase(), eligible.slice());
    }
}

// Inform's "mentioned": flag an object the instant its name renders through a text
// substitution, so the room-contents listing can skip what the description already
// named. Called from the two name-rendering chokepoints — formatValue's bare-object
// branch (`[obj]`) and each locale's display_name (the article'd forms). Gated on the
// field existing so non-advent worlds (their own types, no `mentioned`) stay untouched;
// describe_room clears the marks before each room description, so a mark only counts
// within the description that set it.
function noteMentioned(obj) {
    if (obj && typeof obj === "object" && "mentioned" in obj) {
        obj.mentioned = true;
    }
}

// The player's phrase tokens for a noun span: the span with leading/internal
// articles dropped (but never reduced to nothing — a bare article stays).
function strippedPhraseTokens(span) {
    const stripped = span.filter((t) => !parserArticles.has(t));
    return stripped.length > 0 ? stripped : span;
}

// The pronoun word if `span` is exactly one pronoun (e.g. "it"), else null.
// A word counts if it is in the locale's static list OR currently bound (the
// dynamic path that admits a neopronoun's object word once its bearer has
// been referred to).
function pronounOf(span) {
    const tokens = strippedPhraseTokens(span);
    if (tokens.length !== 1) return null;
    const word = tokens[0];
    return parserPronouns.has(word) || pronounAntecedents.has(word) ? word : null;
}

// The object group a pronoun span refers to, if it is a pronoun currently bound to a
// multiple-object result ("them" after "take lamp and rope"); else null. A pronoun bound to a
// single object — including a plural collective — is not a group and returns null (it resolves
// as an ordinary single noun).
function pronounGroupOf(span) {
    const word = pronounOf(span);
    if (!word) return null;
    const bound = pronounAntecedents.get(word);
    return Array.isArray(bound) ? bound : null;
}

// Self words — "me"/"myself" — resolve to the commanding actor (the agent running
// the command), so an NPC actor's "me" is the NPC. For a player command the actor is
// the current `player` (the library passes it into run_command), so "me" still
// follows a reassigned protagonist. The player's own name synonyms (if any) stay
// object-bound. World-model contract: the engine reads no `player` global here.
// The words are locale data (English "me"/"myself"), installed via setParserLanguage.
let parserSelfWords = new Set();
function isSelfWord(span) {
    const tokens = strippedPhraseTokens(span);
    return tokens.length === 1 && parserSelfWords.has(tokens[0]);
}

// The whole command is a bare AGAIN word ("again" / "g"), articles aside.
function isAgainCommand(tokens) {
    const stripped = tokens.filter((t) => !parserArticles.has(t));
    return stripped.length === 1 && parserAgainWords.has(stripped[0]);
}

// Fold a disambiguation answer back into the command that prompted it, so AGAIN can
// replay the FULLY RESOLVED command and it resolves straight through without asking
// again: "take ball" + answer "red" -> "take red ball". The answer words the noun
// already carries are dropped (a full-name answer "red ball" doesn't duplicate "ball"),
// and the rest are inserted just before the noun's head word. Falls back to the
// unchanged command when the head word can't be located.
function spliceDisambiguation(commandText, spanTokens, answerTokens) {
    if (!commandText || !spanTokens || spanTokens.length === 0) return commandText;
    const spanSet = new Set(spanTokens.map((t) => t.toLowerCase()));
    const added = answerTokens.filter((t) => !spanSet.has(t.toLowerCase()));
    if (added.length === 0) return commandText;
    const head = spanTokens[spanTokens.length - 1].toLowerCase();
    const words = commandText.split(/\s+/);
    const idx = words.findIndex((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase() === head);
    if (idx < 0) return commandText;
    words.splice(idx, 0, ...added);
    return words.join(" ");
}

// Connector words that separate the items of a multiple-object noun phrase
// ("ball and umbrella", "ball, umbrella"). The comma is language-neutral (it is
// split into its own token at tokenization); a locale adds its conjunction
// ("and", "et") via setParserLanguage. Only consulted for the direct slot of a
// `multi` action — elsewhere a connector in a span is a refusal signal.
let parserConnectors = new Set([","]);

// Quantifier words for a multiple-object slot: `allWords` ("all"/"everything",
// "tout") stand for every eligible in-scope object; `exceptWords` ("but"/"except",
// "sauf") introduce exclusions ("take all but the sword"). Locale vocabulary,
// installed via setParserLanguage; empty by default so the engine holds no
// language policy.
let parserAllWords = new Set();
let parserExceptWords = new Set();

// Words that separate whole commands typed on one line ("take lamp then go north").
// English "then"; a locale installs its own via setParserLanguage. The full stop is
// language-neutral (handled structurally in splitCommands) and the conjunction is
// NOT a command separator — "take lamp and rope" is one command with two objects.
let parserSequenceWords = new Set();

// Words that replay the last command (Inform's AGAIN/G). English "again"/"g"; a locale
// installs its own via setParserLanguage. Recognized by runCommand ahead of the grammar,
// because AGAIN must return the REPLAYED command's turn result (so the loop's every-turn
// rules and undo behave as if the player retyped it) — a plain out-of-world action can't.
let parserAgainWords = new Set();

// Split one line of player input into the commands it holds, following the IF
// convention: a full stop or a sequence word ("then") ends a command, and no space
// is required after the stop ("n.e" is two commands). A period between two digits is
// a decimal point, not a separator, so a real-typed slot ("set dial to 3.5") survives.
// Empty commands are dropped, so "n. . e" is just "n" and "e".
function splitCommands(line) {
    const text = String(line);
    const sentences = [];
    let current = "";
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === "." && !(/[0-9]/.test(text[i - 1] || "") && /[0-9]/.test(text[i + 1] || ""))) {
            sentences.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    sentences.push(current);

    const commands = [];
    for (const sentence of sentences) {
        let words = [];
        const flush = () => {
            // A comma bordering a separator is punctuation of the split, not a noun-list
            // connector: "take lamp, then go north" leaves "take lamp".
            const command = words.join(" ").replace(/^[\s,]+|[\s,]+$/g, "");
            if (command) commands.push(command);
            words = [];
        };
        for (const word of sentence.split(/\s+/).filter(Boolean)) {
            if (parserSequenceWords.has(word.replace(/^,+|,+$/g, "").toLowerCase())) flush();
            else words.push(word);
        }
        flush();
    }
    return makeList(commands);
}

// Splits tokens into pieces at connector tokens, dropping empties (so "ball, and
// umbrella" yields two pieces).
function splitOnConnectors(tokens) {
    const pieces = [];
    let current = [];
    for (const token of tokens) {
        if (parserConnectors.has(token)) {
            if (current.length > 0) pieces.push(current);
            current = [];
        } else {
            current.push(token);
        }
    }
    if (current.length > 0) pieces.push(current);
    return pieces;
}

// A noun span as a multiple-object list: two or more connector-separated pieces,
// else null (a single piece is just a noun, not a list).
function splitMultiSpan(span) {
    const pieces = splitOnConnectors(span);
    return pieces.length >= 2 ? pieces : null;
}

function spanHasConnector(span) {
    return span.some((t) => parserConnectors.has(t));
}

// A noun span as an ALL phrase: a leading quantifier word, optionally followed by
// an except word and connector-separated exclusion pieces ("all", "all but the
// sword", "everything except ball and skull"). Returns { exceptPieces } or null
// (anything else after the quantifier — e.g. "all coins" — is not an ALL phrase).
function parseAllPhrase(span) {
    if (span.length === 0 || !parserAllWords.has(span[0])) return null;
    if (span.length === 1) return { exceptPieces: [] };
    if (!parserExceptWords.has(span[1])) return null;
    const exceptPieces = splitOnConnectors(span.slice(2));
    return exceptPieces.length > 0 ? { exceptPieces } : null;
}

// A pronoun used among `spans` whose WORD has no antecedent yet, else null.
// Per-word: "x her" with only a rock referred to is unbound even though "it"
// is. This is the "never bound" case — distinct from a bound pronoun whose
// referent has left scope — so it gets its own message.
function unboundPronounIn(spans) {
    for (const span of spans) {
        const word = pronounOf(span);
        if (word && !pronounAntecedents.has(word)) return word;
    }
    return null;
}

function buildVocabIndex() {
    vocabIndex = new Map();
    for (const instances of instanceRegistry.values()) {
        for (const obj of instances) {
            const tokens = new Set();
            // A `private_name` object contributes no vocabulary from its identifier — only its
            // explicit `understand` words (Inform's "privately-named"). Lets a thing be referred to
            // by its synonyms without its internal name leaking colliding tokens (e.g. a sign object
            // named `locker_sign` must not answer to "locker").
            if (!obj.private_name) {
                for (const t of String(obj.name).toLowerCase().split(/[_\s]+/).filter(Boolean)) {
                    tokens.add(t);
                }
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
// `actor` is the commanding agent, so "me"/"myself" resolve to it (not a `player`
// global) — see the runtime↔world-model contract and parserSelfWords above.
function resolveCandidates(span, scope, slotType, actor) {
    const phraseTokens = strippedPhraseTokens(span);
    const scopeSet = new Set(scope);
    const pronounWord = pronounOf(span);
    if (pronounWord) {
        const bound = pronounAntecedents.get(pronounWord);
        if (bound && scopeSet.has(bound) && (!slotType || isTypeOrSubtype(bound.type, slotType))) {
            return [bound];
        }
        return [];
    }
    if (isSelfWord(span)) {
        if (actor && scopeSet.has(actor) && (!slotType || isTypeOrSubtype(actor.type, slotType))) {
            return [actor];
        }
        return [];
    }
    return objectsForTokens(phraseTokens).filter(
        (obj) => scopeSet.has(obj) && (!slotType || isTypeOrSubtype(obj.type, slotType)),
    );
}

// The vocabulary token set for a single object: identifier tokens + understand tokens.
function objectVocab(obj) {
    const vocab = new Set();
    // `private_name` suppresses the identifier tokens (see buildVocabIndex); only `understand` counts.
    if (!obj.private_name) {
        for (const t of String(obj.name).toLowerCase().split(/[_\s]+/).filter(Boolean)) vocab.add(t);
    }
    if (obj.understand) {
        for (const t of String(obj.understand).toLowerCase().split("/").map((s) => s.trim()).filter(Boolean)) vocab.add(t);
    }
    return vocab;
}

function objectDisplayName(obj) {
    // `printed_name` may hold a text template (a name with substitutions, e.g.
    // "wooden [slot(...)]"); renderText renders a thunk and passes strings through.
    if (obj.printed_name) return renderText(obj.printed_name);
    return String(obj.name).replace(/_/g, " ");
}

// Parser prose is locale-owned (see parserArticles above). The engine's fallbacks
// are deliberately crude and article-less — a locale (lib/en-US, lib/fr-FR) installs
// the real renderers via setParserLanguage, so proper-name handling and definite
// articles live in the locale's the(), not here.
//   disambiguationRenderer(candidates) -> the "Which do you mean" prompt string.
//   unknownReferenceRenderer(word)      -> the "I don't know what X refers to" string.
let disambiguationRenderer = (candidates) =>
    "Which do you mean: " + candidates.map(objectDisplayName).join(" or ") + "?";
let unknownReferenceRenderer = (word) => `I don't know what "${word}" refers to.`;
//   nounMissing(kind, phrase) -> the "What/Who/Which way do you want to <phrase>?" prompt, where
//   `kind` is "what"/"who"/"which_way" (from the missing slot's type) and `phrase` is the command
//   the player typed so far (the verb + any typed nouns/preposition).
let nounMissingRenderer = (kind, phrase) =>
    (kind === "who" ? "Who" : kind === "which_way" ? "Which way" : "What") + ` do you want to ${phrase}?`;

// The single seam a locale calls to own the parser's language: the noun-phrase
// vocabulary and the two prose renderers. Each key is optional (a partial install
// keeps the current value), so a locale can override only what it needs.
function setParserLanguage(spec) {
    if (spec.articles) parserArticles = new Set(spec.articles);
    if (spec.pronouns) parserPronouns = new Set(spec.pronouns);
    // antecedentWords(obj) -> the pronoun words to file obj under when it binds
    // (en-US: the object form of obj's own pronoun set). Absent, every referent
    // files under all static pronoun words (single-antecedent behavior).
    if (spec.antecedentWords) antecedentWordsImpl = spec.antecedentWords;
    if (spec.groupAntecedentWords) groupAntecedentWordsImpl = spec.groupAntecedentWords;
    if (spec.selfWords) parserSelfWords = new Set(spec.selfWords);
    // The comma stays a connector under every locale (it is structural, not vocabulary).
    if (spec.connectors) parserConnectors = new Set([",", ...spec.connectors]);
    if (spec.allWords) parserAllWords = new Set(spec.allWords);
    if (spec.exceptWords) parserExceptWords = new Set(spec.exceptWords);
    // The full stop separates commands under every locale; only the word form is data.
    if (spec.sequenceWords) parserSequenceWords = new Set(spec.sequenceWords);
    if (spec.againWords) parserAgainWords = new Set(spec.againWords);
    if (spec.disambiguation) disambiguationRenderer = spec.disambiguation;
    if (spec.unknownReference) unknownReferenceRenderer = spec.unknownReference;
    if (spec.nounMissing) nounMissingRenderer = spec.nounMissing;
}

function printDisambiguationPrompt(candidates) {
    print(disambiguationRenderer(candidates));
}

// Pending disambiguation: set when a slot matches multiple candidates.
// Cleared on the next runCommand call whether or not the answer resolves it.
let pendingDisambiguation = null;

// Pending missing-noun prompt: set when the input is a unique prefix of one template missing its
// final slot ("take" → "What do you want to take?"). The next line is spliced onto the command and
// re-parsed. Cleared as soon as it is consumed.
let pendingNoun = null;

// Resolve [field, span] slot pairs onto `instance`. Returns one of:
//   "ok"          — every slot filled with a single candidate.
//   "ambiguous"   — a slot matched multiple candidates; a disambiguation prompt
//                   was shown and pendingDisambiguation set (terminal — a match
//                   awaiting clarification, not a failure).
//   "unresolved"  — a slot had no candidate. No message is printed: the caller
//                   decides whether to backtrack to another grammar or report
//                   the failure, so overlapping syntaxes (e.g. `go [way]` vs
//                   `go to [room]`) can each get a chance to match.
// An action slot may be a primitive type (`int`/`real`/`string`/`text`) rather
// than an object type — `press [n]` with `int n`. Such a slot is filled from the
// matched input tokens directly, not resolved against scope. `int`/`real` require a
// single numeric token; a string/text slot takes the matched phrase verbatim.
// Returns `undefined` when the tokens don't fit, so the slot reads as "unresolved"
// and the parser falls through to the next grammar (game_parser.md typed tokens).
const PRIMITIVE_SLOT_TYPES = new Set(["int", "real", "string", "text"]);

function literalSlotValue(span, slotType) {
    if (slotType === "string" || slotType === "text") {
        // Tokenization isolates commas (for multiple-object lists); free text
        // re-attaches them so `say hello, sailor` reads back naturally.
        return span.join(" ").replace(/\s+,/g, ",");
    }
    const toks = strippedPhraseTokens(span);
    if (toks.length !== 1) return undefined;
    if (slotType === "int") {
        return /^-?\d+$/.test(toks[0]) ? parseInt(toks[0], 10) : undefined;
    }
    return /^-?\d+(\.\d+)?$/.test(toks[0]) ? parseFloat(toks[0]) : undefined;
}

// Reorder a slot list so `fromField` precedes `scopedField` (a FROM-scoped slot needs its source
// resolved first). No-op when either is absent (the source may already be resolved on the instance)
// or already in order.
function orderFromBefore(slots, fromField, scopedField) {
    const fromIdx = slots.findIndex(([f]) => f === fromField);
    const scopedIdx = slots.findIndex(([f]) => f === scopedField);
    if (fromIdx === -1 || scopedIdx === -1 || fromIdx < scopedIdx) return slots;
    const reordered = slots.slice();
    const [fromEntry] = reordered.splice(fromIdx, 1);
    reordered.splice(scopedIdx, 0, fromEntry);
    return reordered;
}

function resolveSlots(slots, instance, scope, slotTypes, multiOut = { field: null, objects: null }) {
    const meta = typeRegistry.get(instance.type) || {};
    const directSlot = meta.directSlot || null;
    const scopeCfg = meta.scopeSlotBy || null;
    if (scopeCfg) slots = orderFromBefore(slots, scopeCfg.from, scopeCfg.slot);
    for (let i = 0; i < slots.length; i++) {
        const [field, span] = slots[i];
        if (PRIMITIVE_SLOT_TYPES.has(slotTypes[field])) {
            const value = literalSlotValue(span, slotTypes[field]);
            if (value === undefined) {
                return "unresolved";
            }
            instance[field] = value;
            continue;
        }
        // A FROM-scoped slot resolves within its source's contents (`take X from Y`); everything
        // else against the action's scope.
        const fieldScope = (scopeCfg && field === scopeCfg.slot) ? contentsScope(instance[scopeCfg.from]) : scope;
        const candidates = resolveCandidates(span, resolvePool(slotTypes[field], fieldScope), slotTypes[field], instance.actor);
        if (candidates.length === 0) {
            // A multi action's direct slot accepts an ALL phrase ("all", "all but
            // the sword") or a connector-separated list ("ball and umbrella") —
            // tried only after the whole span fails as a single noun, so an object
            // whose vocabulary contains a connector or quantifier word ("salt and
            // pepper shaker") keeps resolving as one thing.
            if (field === directSlot && isMultiAction(instance.type)) {
                // "them" bound to a group ("take lamp and rope" → "drop them"): dispatch the
                // whole set through the multi path, scoped/typed to the slot. Empty after
                // filtering (all members gone) fails like an unresolvable noun.
                const group = pronounGroupOf(span);
                if (group) {
                    const st = slotTypes[field];
                    const pool = new Set(resolvePool(st, fieldScope));
                    const usable = group.filter((o) => pool.has(o) && (!st || isTypeOrSubtype(o.type, st)));
                    if (usable.length === 0) return "unresolved";
                    multiOut.field = field;
                    multiOut.objects = usable;
                    instance[field] = usable[0];
                    continue;
                }
                const all = parseAllPhrase(span);
                if (all) {
                    const status = resolveAllPhrase(all, instance, field, fieldScope, slotTypes, multiOut);
                    if (status === "ok") continue;
                    return status;
                }
                const pieces = splitMultiSpan(span);
                if (pieces) {
                    const status = resolveMultiPieces(pieces, 0, [], instance, field, slots.slice(i + 1), fieldScope, slotTypes, multiOut);
                    if (status === "ok") continue;
                    return status;
                }
            }
            return "unresolved";
        }
        if (candidates.length === 1) {
            instance[field] = candidates[0];
            if (field === directSlot) noteAntecedent(candidates[0]);
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
                multiOut,
                sourceCommand: repeatableSource,
                span,
            };
            return "ambiguous";
        }
    }
    return "ok";
}

// Resolves an ALL phrase for a multi action's direct slot: every in-scope object
// of the slot's type, filtered through the installed "all includes" hook, minus
// the exclusion pieces ("all but X"). An exclusion piece excludes *every* object
// it matches ("all but ball" excludes both balls — no disambiguation), and one
// that matches nothing is silently inert. Objects are visited in scope order. An
// empty result prints the nothing-available message and returns "nothing"
// (terminal: the command was understood, so no grammar backtracking and no
// "can't see any such thing"). ALL always announces — the player didn't name the
// objects, so even a single one gets its "objectname: " prefix.
function resolveAllPhrase(all, instance, field, scope, slotTypes, multiOut) {
    const slotType = slotTypes[field];
    const pool = resolvePool(slotType, scope).filter(
        (obj) => !slotType || isTypeOrSubtype(obj.type, slotType),
    );
    const excluded = new Set();
    for (const piece of all.exceptPieces) {
        for (const obj of resolveCandidates(piece, pool, slotType, instance.actor)) {
            excluded.add(obj);
        }
    }
    const objects = pool.filter(
        (obj) => !excluded.has(obj) && (!allFilter || Boolean(allFilter(instance, obj))),
    );
    if (objects.length === 0) {
        print(message("parser_nothing_all", "There's nothing available."));
        return "nothing";
    }
    multiOut.field = field;
    multiOut.objects = objects;
    multiOut.announce = true;
    noteAntecedent(objects[objects.length - 1]);
    noteGroupAntecedent(objects);
    return "ok";
}

// Resolves the pieces of a multiple-object noun phrase from `startIdx`,
// accumulating objects (deduplicated) into `resolved`. On success fills
// `multiOut` and returns "ok"; a piece nothing matches fails the whole grammar
// candidate ("unresolved", so overlapping syntaxes can still backtrack); an
// ambiguous piece prompts and parks the walk position in pendingDisambiguation
// so the player's answer resumes it.
function resolveMultiPieces(pieces, startIdx, resolved, instance, field, remainingSlots, scope, slotTypes, multiOut) {
    for (let i = startIdx; i < pieces.length; i++) {
        const candidates = resolveCandidates(pieces[i], resolvePool(slotTypes[field], scope), slotTypes[field], instance.actor);
        if (candidates.length === 0) {
            return "unresolved";
        }
        if (candidates.length > 1) {
            printDisambiguationPrompt(candidates);
            pendingDisambiguation = {
                actionName: instance.type,
                instance,
                field,
                candidates,
                remainingSlots,
                scope,
                slotTypes,
                multiOut,
                sourceCommand: repeatableSource,
                span: pieces[i],
                multiPieces: { pieces, nextIndex: i + 1, resolved },
            };
            return "ambiguous";
        }
        if (!resolved.includes(candidates[0])) resolved.push(candidates[0]);
    }
    multiOut.field = field;
    multiOut.objects = resolved;
    noteAntecedent(resolved[resolved.length - 1]);
    noteGroupAntecedent(resolved);
    return "ok";
}

// Runs a fully resolved action: one checkpoint + one turn advance for the whole
// command — a multiple-object command is a single turn, so undo reverts all of it
// and every-turn rules fire once. A multi resolution runs the action once per
// object on a fresh instance (indirect slots shared), each under an
// "objectname: " prefix so the single-object report rules compose into the
// IF-transcript convention ("chair: Taken." / "pc: Your load is too heavy.").
function dispatchResolvedAction(actionName, instance, multiOut) {
    lastCommandRan = true;
    const oow = isOutOfWorld(actionName);
    // Only an in-world command becomes the AGAIN target — repeating UNDO/SAVE/SCORE is
    // meaningless, and AGAIN never reaches here (it is intercepted in runCommand).
    if (!oow && repeatableSource) lastRepeatableCommand = repeatableSource;
    if (!oow) { checkpoint(); advanceTurn(); }
    const objects = (multiOut && multiOut.objects) || null;
    if (objects && (objects.length > 1 || multiOut.announce)) {
        for (const obj of objects) {
            const inst = { ...instance };
            inst[multiOut.field] = obj;
            streamRequestBreak(1);
            print(objectDisplayName(obj) + ": ");
            runAction(actionName, inst);
        }
    } else {
        // A list that collapsed to one object ("take ball and ball") runs the
        // plain single-object path, prefix-free. (An ALL phrase announces even a
        // single object — the player didn't name it.)
        if (objects && objects.length === 1) instance[multiOut.field] = objects[0];
        runAction(actionName, instance);
    }
    return !oow;
}

// Parses one line of player input and runs the matched action. If a pending
// disambiguation exists, tries to resolve it first; if the input doesn't match
// any candidate it is discarded and treated as a fresh command.
// The player's most recent raw input line (original casing, trimmed), exposed to
// templates as `[player_command()]` (J1). Transient narration state, not saved.
let lastCommand = "";

function playerCommand() {
    return lastCommand;
}

// Whether the last runCommand reached an action at all — false for a parse failure, an
// unresolved noun, or a disambiguation question. Distinct from runCommand's own return
// value, which reports only whether a TURN was spent (an out-of-world verb runs but
// spends none). The command loop reads it to decide whether the remaining commands on a
// multi-command line still stand: as in Inform, a command the parser could not run
// abandons the rest of the line.
let lastCommandRan = false;

function commandRan() {
    return lastCommandRan;
}

// The last in-world command the parser actually ran, replayed by AGAIN/G. It excludes
// AGAIN itself (intercepted before dispatch, never recorded) and out-of-world verbs
// (UNDO/SAVE/…); a disambiguated command is recorded FULLY RESOLVED ("take red ball",
// the answer folded in), so replaying it resolves straight through. Empty until the
// first in-world action runs.
let lastRepeatableCommand = "";

// The text dispatchResolvedAction records as the repeatable command for the action it is
// about to run: normally the command being parsed, but the answer-folded command while a
// disambiguation is being resolved (see spliceDisambiguation / pendingDisambiguation).
let repeatableSource = "";

// metaOnly restricts execution to out-of-world session verbs (QUIT/RESTART/RESTORE/…):
// an in-world or unrecognized command is silently ignored (returns false, prints nothing),
// which backs the restricted end-of-story RESTART/RESTORE/QUIT screen — the game is over,
// so LOOK/TAKE must not run, and unrecognized input just re-prompts.
function runCommand(line, actor, metaOnly = false) {
    lastCommand = String(line).trim();
    lastCommandRan = false;
    // The command AGAIN would record if it resolves to an in-world action; the
    // disambiguation branch below folds the answer into the command it is resolving.
    repeatableSource = lastCommand;
    // Commas become their own tokens: they separate the items of a multiple-object
    // noun phrase ("drop ball, umbrella") and never carry object vocabulary.
    const tokens = String(line).toLowerCase().replace(/,/g, " , ").trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return;

    if (pendingDisambiguation) {
        const pending = pendingDisambiguation;
        const { actionName, instance, field, candidates, remainingSlots, scope, slotTypes } = pending;
        const multiOut = pending.multiOut || { field: null, objects: null };
        const stripped = tokens.filter((t) => !parserArticles.has(t));
        const phraseTokens = stripped.length > 0 ? stripped : tokens;
        // The AGAIN target is the fully resolved command: fold this answer back into the
        // command that prompted ("take ball" + "red" -> "take red ball"), so replaying it
        // resolves straight through. A chained disambiguation splices onto this result.
        repeatableSource = spliceDisambiguation(pending.sourceCommand || repeatableSource, pending.span, phraseTokens);
        const narrowed = candidates.filter((obj) => phraseTokens.every((t) => objectVocab(obj).has(t)));
        if (narrowed.length === 1) {
            pendingDisambiguation = null;
            if (pending.multiPieces) {
                // The ambiguous phrase was one piece of a multiple-object list:
                // accept the answer into the list and resume walking the pieces
                // (which may prompt again and re-park itself).
                const { pieces, nextIndex, resolved } = pending.multiPieces;
                if (!resolved.includes(narrowed[0])) resolved.push(narrowed[0]);
                const pieceStatus = resolveMultiPieces(pieces, nextIndex, resolved, instance, field, remainingSlots, scope, slotTypes, multiOut);
                if (pieceStatus === "ambiguous") {
                    return false;
                }
                if (pieceStatus === "unresolved") {
                    print(message("parser_cant_see", "You can't see any such thing."));
                    return false;
                }
            } else {
                instance[field] = narrowed[0];
                const directSlotForDisambig = (typeRegistry.get(actionName) || {}).directSlot || null;
                if (field === directSlotForDisambig) noteAntecedent(narrowed[0]);
            }
            const status = resolveSlots(remainingSlots, instance, scope, slotTypes, multiOut);
            if (status === "ok") {
                // Checkpoint/advance happen in the dispatch (not on the original
                // ambiguous command, which only prompted) so undo reverts the
                // resolved action.
                return dispatchResolvedAction(actionName, instance, multiOut);
            }
            if (status === "unresolved") {
                // Already committed to this action — no backtracking here.
                const unbound = unboundPronounIn(remainingSlots.map(([, span]) => span));
                print(unbound ? unknownReferenceRenderer(unbound) : message("parser_cant_see", "You can't see any such thing."));
            }
            // No action ran (unresolved, or a fresh disambiguation) — no turn.
            return false;
        }
        if (narrowed.length > 1) {
            // Still ambiguous — re-prompt with the narrowed set, carrying this partial
            // answer forward (sourceCommand) so a second answer accumulates onto it.
            printDisambiguationPrompt(narrowed);
            pendingDisambiguation = { ...pendingDisambiguation, candidates: narrowed, sourceCommand: repeatableSource };
            return false;
        }
        // 0 matches — treat input as a fresh command.
        pendingDisambiguation = null;
    }

    if (pendingNoun) {
        const { commandSoFar } = pendingNoun;
        pendingNoun = null;
        // Splice the answer onto the command that prompted and re-parse the whole thing: the answer
        // fills the missing final slot, and re-running resolves everything fresh — chaining into
        // disambiguation, ALL/multi, and the AGAIN target, with no special case.
        return runCommand(commandSoFar + " " + String(line).trim(), actor, metaOnly);
    }

    // AGAIN / G — replay the last in-world command. Handled above the grammar because it
    // must return the REPLAYED command's turn result, so the loop fires every-turn rules and
    // takes an undo checkpoint exactly as if the player had retyped it. Each line is already
    // split into single commands (splitCommands), so AGAIN never replays a `then` sequence,
    // and it never records itself (the recursive call runs the stored command, not "again").
    // Not offered at the meta-only end-of-story prompt.
    if (!metaOnly && isAgainCommand(tokens)) {
        if (!lastRepeatableCommand) {
            print(message("parser_again_none", "You can't repeat a command you haven't yet given."));
            return false;
        }
        return runCommand(lastRepeatableCommand, actor, metaOnly);
    }

    // Every player command — including the meta-verbs UNDO/SAVE/RESTORE — resolves through
    // the single grammar path below; they are `out_of_world` Lamp actions (lib/advent) over
    // runtime primitives, so they bypass the turn clock without a separate dispatch table.
    // The checkpoint + turn advance happen only when an in-world action actually runs
    // (below), so a parse failure or an out-of-world action spends no turn.
    // Try each grammar whose structure matches. A grammar that matches
    // structurally but whose nouns don't resolve ("unresolved") is not the end
    // of the road — we backtrack and try the next, so overlapping syntaxes can
    // coexist (e.g. `go [way]` vs `go to [room]`). Only after every candidate
    // fails do we report.
    //
    // The message distinguishes two failures: a grammar with a literal verb that
    // matched but whose noun was missing → "You can't see any such thing." (we
    // understood the command, the thing isn't here); anything else, including a
    // bare pure-slot grammar like `[way]` matching an unknown word → "I don't
    // understand that." (no recognized command). So `take xyzzy` differs from a
    // lone `xyzzy`.
    let sawVerbMatch = false;
    // A noun list offered where none is allowed (a non-multi action, or any slot
    // but the direct one) gets its own refusal ahead of "can't see any such thing".
    let sawMultiAttempt = false;
    const unresolvedSpans = [];
    // The actor's scope is invariant across grammar candidates (no action runs, so
    // the world can't change, until a candidate resolves and we return), so compute
    // it once and reuse it — overlapping syntaxes like `go [way]`/`[way]` no longer
    // recompute the engine's hottest sweep per candidate. World-scope actions use
    // their own pool and never touch this.
    let actorScopeCache = null;
    const actorScope = () => (actorScopeCache ??= scopeOf(actor));
    for (const entry of grammarRegistry) {
        const matched = matchGrammar(entry.parts, tokens);
        if (!matched) continue;
        // A `world_scope` action resolves its object slots against the whole world (every
        // physical object), so a debug verb can name something out of scope.
        const scope = isWorldScope(entry.actionName)
            ? getInstancesForTypeAndSubtypes("physical")
            : actorScope();
        const slotTypes = (typeRegistry.get(entry.actionName) || {}).fields || {};
        const instance = { type: entry.actionName, action: entry.actionName, actor };
        const multiOut = { field: null, objects: null };
        const status = resolveSlots(Object.entries(matched), instance, scope, slotTypes, multiOut);
        if (status === "ok") {
            // A meta-only prompt skips in-world actions (treats them as unrecognized) so
            // the ended game stays ended.
            if (metaOnly && !isOutOfWorld(entry.actionName)) continue;
            return dispatchResolvedAction(entry.actionName, instance, multiOut);
        }
        // Both terminal: a prompt or the nothing-available message already printed,
        // and no turn is spent.
        if (status === "ambiguous" || status === "nothing") {
            return false;
        }
        unresolvedSpans.push(...Object.values(matched));
        if (entry.parts.some((part) => part.kind === "literal")) {
            sawVerbMatch = true;
            // A connector or leading quantifier in an object-slot span this grammar
            // couldn't resolve marks a multiple-object attempt ("x ball and lamp",
            // "examine all") — but only where a list is disallowed (the check is
            // syntactic, like Inform's). Primitive slots are exempt: free text may
            // legitimately contain commas ("say hello, sailor").
            const directSlot = (typeRegistry.get(entry.actionName) || {}).directSlot || null;
            for (const [field, span] of Object.entries(matched)) {
                if (PRIMITIVE_SLOT_TYPES.has(slotTypes[field])) continue;
                const listAllowed = field === directSlot && isMultiAction(entry.actionName);
                if (!listAllowed && (spanHasConnector(span) || parserAllWords.has(span[0]) || pronounGroupOf(span))) {
                    sawMultiAttempt = true;
                }
            }
        }
    }
    // An unbound pronoun (the player said "it" before referring to anything) gets
    // its own message ahead of the generic scope/grammar failures.
    const unbound = unboundPronounIn(unresolvedSpans);
    if (unbound) {
        if (metaOnly) return false;
        print(unknownReferenceRenderer(unbound));
        return false;
    }
    // A meta-only prompt swallows parser failures: unrecognized input silently re-prompts,
    // matching the traditional restricted end-of-story screen.
    if (metaOnly) return false;
    if (sawMultiAttempt) {
        print(message("parser_no_multi", "You can't use multiple objects with that verb."));
        return false;
    }
    // Missing noun: no complete template matched (sawVerbMatch false), but the input is a unique
    // prefix of one template with an empty final slot — ask for it instead of "I don't understand".
    // See devdocs/missing_noun.md.
    if (!sawVerbMatch) {
        const completion = uniquePartialCompletion(tokens);
        if (completion) {
            print(nounMissingRenderer(missingNounKind(completion.slotType), lastCommand));
            pendingNoun = { commandSoFar: lastCommand };
            return false;
        }
    }
    print(sawVerbMatch
        ? message("parser_cant_see", "You can't see any such thing.")
        : message("parser_no_understand", "I don't understand that."));
    return false;
}

// Runs LINE but executes only out-of-world session verbs; backs the restricted
// end-of-story prompt via the lib/sys `run_meta_command` primitive.
function runMetaCommand(line, actor) {
    return runCommand(line, actor, true);
}

// RESTART (Option C — in-process baseline). The world's post-construction, pre-startup
// state is captured once as `initialBaseline`; RESTART restores it and re-fires `startup`,
// yielding a fresh game (intro reprinted, startup randomness re-rolled) without re-executing
// construction or respawning the host. Capture is guarded: a game whose pre-startup templates
// can't render (a frozen-fallback template reading an uninitialized global) leaves the
// baseline null and RESTART reports unavailable rather than crashing at load. Because raw
// construction is deterministic (randomness is rolled in `startup`, not construction), the
// baseline needn't be persisted — a save gates on an identical build, and a fresh session's
// run() recaptures an identical baseline. See devdocs/state.md → RESTART.
let initialBaseline = null;
let restartRequested = false;

function restartAvailable() {
    return initialBaseline !== null;
}

// Arm a restart: the library command loop calls this on a RESTART command, then unwinds its
// loop so control returns to run(), which restores the baseline and re-fires startup. Returns
// false (unarmed) when no baseline was captured, so the library can report it unavailable.
function requestRestart() {
    if (initialBaseline === null) return false;
    restartRequested = true;
    return true;
}

// World-model contract: fires the `startup` event, which the world library hooks to build the
// world and drive the command loop. On RESTART the library unwinds that loop with the restart
// flag armed; here we restore the pre-startup baseline and re-fire startup for a fresh game.
function run() {
    pronounAntecedents = new Map();
    buildVocabIndex();
    try {
        initialBaseline = captureState();
    } catch (err) {
        initialBaseline = null;
    }
    fireEvent("startup");
    while (restartRequested) {
        restartRequested = false;
        pronounAntecedents = new Map();
        restoreState(initialBaseline);
        clearUndoHistory();
        fireEvent("startup");
    }
}

function fireEvent(eventName) {
    const handlers = eventRegistry.get(eventName) || [];
    for (const handler of handlers) {
        handler();
    }
}

// --- Output-stream paragraph control (text.md H) ----------------------------
// Newlines are owned here, not by the host: `print` output is written raw (via
// writeImpl, the "write" channel — the host/shell add no trailing newline) and this
// manager decides breaks. `streamPending` is the strongest break requested but not
// yet materialized — an "ensure at least N newlines before the next visible text"
// counter (1 = line break, 2 = paragraph break). `streamPrintedSinceBreak` gates the
// conditional boundary break (H3/H6). Inline markers in rendered text arrive as
// private-use sentinels and are processed in stream order. See devdocs/text.md H6.
const STREAM_LINE_BREAK = "\uE000";
const STREAM_PAR_BREAK = "\uE001";
const STREAM_NO_BREAK = "\uE002";
const STREAM_PAR_IF_PRINTED = "\uE003";

// Type-style sentinels (text.md I3, Slice 7). A style function wraps its content
// in a matched push/pop pair; the manager keeps a depth per style and tags each
// emitted run with the set of styles active over it (the structured-segment
// transport). Styles compose/nest via the depth counters (order-independent), and
// are orthogonal to the break sentinels above. PUA block \uE010-\uE035.
// The three type styles plus the ANSI/Z-machine color names (16, foreground
// only) \u2014 the closed style vocabulary. Push/pop sentinel pairs are assigned in
// order from \uE010 (bold \uE010/\uE011, italic \uE012/\uE013, fixed
// \uE014/\uE015 \u2014 unchanged \u2014 then the colors through \uE035). When two colors
// are active the one later in STYLE_ORDER wins on hosts that render a single
// color per run (nesting different colors is not a supported idiom).
const STYLE_ORDER = [
    "bold", "italic", "fixed",
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "bright_black", "bright_red", "bright_green", "bright_yellow",
    "bright_blue", "bright_magenta", "bright_cyan", "bright_white",
    // "fit" (devdocs/text.md I3): a column-true composition the web shell
    // shrinks to fit its width (one block, one scale ratio). TTY/plain/window
    // hosts ignore it — degradation-safe intent, the admission bar for any
    // stream-level layout style. Contract: one fit block = ONE print carrying
    // literal newlines with constant styling inside, so it reaches the host as
    // a single write segment (break sentinels and style changes split segments,
    // which would shear the block into independently-scaled pieces).
    "fit",
];
const STYLE_PUSH_CHAR = {};
const STYLE_POP_CHAR = {};
const STYLE_PUSH_BY_CHAR = {};
const STYLE_POP_BY_CHAR = {};
const styleDepth = {};
STYLE_ORDER.forEach((name, i) => {
    const push = String.fromCharCode(0xe010 + 2 * i);
    const pop = String.fromCharCode(0xe011 + 2 * i);
    STYLE_PUSH_CHAR[name] = push;
    STYLE_POP_CHAR[name] = pop;
    STYLE_PUSH_BY_CHAR[push] = name;
    STYLE_POP_BY_CHAR[pop] = name;
    styleDepth[name] = 0;
});

// Any in-band control char (breaks or style push/pop) \u2014 the fast-path test that
// lets a plain run skip the char-by-char scan.
const STREAM_CONTROL = /[\uE000-\uE003\uE010-\uE035]/;

// The styles currently in force, in a stable order so a run's style set is the
// same regardless of nesting order (bold(italic) and italic(bold) both \u2192 that
// pair). Returns a fresh array each call; empty for unstyled text.
function activeStyles() {
    const out = [];
    for (const name of STYLE_ORDER) {
        if (styleDepth[name] > 0) out.push(name);
    }
    return out;
}

let streamPending = 0;
let streamPrintedSinceBreak = false;
// Monotonic count of text runs emitted — lets a caller detect whether a span of code
// (e.g. one action band) produced any output, for finer breaking than the coarse
// `streamPrintedSinceBreak` flag.
let streamPrintCount = 0;
// Newlines already at the stream tail. A break "ensures at least N newlines" before
// the next text, so only `N - streamTrailingNewlines` are actually emitted — this is
// what lets a paragraph break after a prompt (whose echoed input already ended the
// line) add one blank line rather than two. Initialized high so leading breaks before
// any output emit nothing (no blank line at the very top).
let streamTrailingNewlines = 2;

// Rule A (auto line break): a run "ends a sentence" when its last non-space char,
// past any trailing closing quotes / parens / brackets, is `.` `?` or `!`.
const SENTENCE_END = /[.?!]['")\]’”]*\s*$/;

function outputMarker(kind) {
    return kind === "line" ? STREAM_LINE_BREAK
        : kind === "par" ? STREAM_PAR_BREAK
        : kind === "nobreak" ? STREAM_NO_BREAK
        : STREAM_PAR_IF_PRINTED;
}

function trailingNewlineCount(run) {
    let n = 0;
    for (let i = run.length - 1; i >= 0 && run[i] === "\n"; i -= 1) n += 1;
    return n;
}

function streamFlushPending() {
    if (streamPending > 0) {
        const need = streamPending - streamTrailingNewlines;
        if (need > 0) {
            hostWrite("\n".repeat(need));
            streamTrailingNewlines += need;
        }
        streamPending = 0;
        streamPrintedSinceBreak = false;
    }
}

function streamRequestBreak(n) {
    if (n > streamPending) streamPending = n;
}

function streamEmitRun(run, applyRuleA, styles) {
    if (run.length === 0) return;
    streamFlushPending();
    // styles ride out-of-band as a second arg (structured-segment transport); a
    // plain run passes undefined so unstyled output keeps the bare write contract.
    hostWrite(run, styles && styles.length ? styles : undefined);
    streamTrailingNewlines = trailingNewlineCount(run);
    streamPrintedSinceBreak = true;
    streamPrintCount += 1;
    if (applyRuleA && SENTENCE_END.test(run)) streamRequestBreak(1);
}

// Snapshot of the run counter, for "did this span print anything?" boundary checks.
function streamMark() {
    return streamPrintCount;
}

// The host writes the prompt and echoes the player's input directly, bypassing this
// manager; that input line ends with a newline (echoed in piped mode, or the user's
// Enter on a TTY), so the stream is at line-start afterward. Record that so the next
// break accounts for it. Called by promptLine / readLine.
function streamNoteInputLine() {
    streamTrailingNewlines = 1;
    streamPrintedSinceBreak = false;
}

// Emit a rendered string: split on break sentinels, writing text runs and applying
// each break request in order. `applyRuleA` is on for print (sentence-end auto line
// break), off for raw write.
function streamWrite(s, applyRuleA) {
    if (!STREAM_CONTROL.test(s)) {
        streamEmitRun(s, applyRuleA, activeStyles());
        return;
    }
    let run = "";
    for (const ch of s) {
        if (ch === STREAM_LINE_BREAK || ch === STREAM_PAR_BREAK || ch === STREAM_NO_BREAK || ch === STREAM_PAR_IF_PRINTED) {
            // Emit the pending run under the styles active *over it* before the break.
            streamEmitRun(run, applyRuleA, activeStyles());
            run = "";
            if (ch === STREAM_LINE_BREAK) streamRequestBreak(1);
            else if (ch === STREAM_PAR_BREAK) streamRequestBreak(2);
            else if (ch === STREAM_NO_BREAK) streamPending = 0;
            else if (streamPrintedSinceBreak) streamRequestBreak(2);
        } else if (STYLE_PUSH_BY_CHAR[ch] !== undefined) {
            streamEmitRun(run, applyRuleA, activeStyles());
            run = "";
            styleDepth[STYLE_PUSH_BY_CHAR[ch]] += 1;
        } else if (STYLE_POP_BY_CHAR[ch] !== undefined) {
            streamEmitRun(run, applyRuleA, activeStyles());
            run = "";
            const name = STYLE_POP_BY_CHAR[ch];
            styleDepth[name] = Math.max(0, styleDepth[name] - 1);
        } else {
            run += ch;
        }
    }
    streamEmitRun(run, applyRuleA, activeStyles());
}

// Wraps a value in a type style (text.md I3). Renders the content now and brackets
// it with the style's push/pop sentinels, so concatenation preserves the style run
// and styles nest (bold(italic(x))). An unknown style name renders bare
// (fail-silently). The lib/sys bold/italic/fixed functions are thin wrappers.
function styled(name, value) {
    const push = STYLE_PUSH_CHAR[name];
    if (!push) return renderText(value);
    return push + renderText(value) + STYLE_POP_CHAR[name];
}

// Materialize any pending break at program end so the final line is terminated.
function flushOutput() {
    streamFlushPending();
}

function print(value) {
    streamWrite(formatValue(value), true);
}

// Named messages (devdocs/messages.md): a localizable string whose default lives at
// the use site (`NAME:"DEFAULT"`) and whose override is registered at load time
// (`NAME: "TEXT"`, e.g. a translation pack). Stored as text values (lazy closures),
// so an override referencing the `act` global renders against the current action.
const messageOverrides = new Map();
function registerMessageOverride(name, textValue) {
    messageOverrides.set(name, textValue);
}
function message(name, defaultValue) {
    if (messageOverrides.has(name)) return messageOverrides.get(name);
    // A default-less reference (`message NAME`) is compile-checked for coverage,
    // so a miss here should be unreachable — fail loudly, not blank.
    return defaultValue !== undefined ? defaultValue : `[missing message: ${name}]`;
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

function write(value) {
    streamWrite(String(value), false);
}

function setWrite(nextWriteImpl) {
    writeImpl = nextWriteImpl;
}

// (The former status-line channel — setStatusChannel/setStatusLine and the
// `status` wire message — is retired: the status line is now an ordinary text
// window with `look "bar"`, composed by lib/advent/status.lamp. See
// devdocs/windows.md and devdocs/text-windows.md.)

// Text windows (devdocs/text-windows.md). The runtime owns the transient per-window
// line buffer (render state — deliberately not a state provider; content re-derives
// from world state at the next sync) and the two wire messages; the library owns the
// compose cadence (lib/advent window_refresh_rules); a host that renders panes
// installs a window channel (none ⇒ messages drop, so the plain host stays
// byte-invariant by construction). A window's *arrangement* lives in ordinary fields
// on `window`-typed instances (lib/sys), so it is snapshot-covered like any state.
let windowImpl = null;
function setWindowChannel(nextWindowImpl) {
    windowImpl = nextWindowImpl;
}

// Host capabilities, sent once by a host adapter before the game loop starts (so
// delivery never collides with the worker blocking on input). Only `windows.docks`
// is defined today.
let hostCapabilities = null;
function setHostCapabilities(caps) {
    hostCapabilities = caps || null;
}

function windowAvailable(dock) {
    const windows = hostCapabilities && hostCapabilities.windows;
    const docks = windows && windows.docks;
    return Array.isArray(docks) && docks.includes(String(dock));
}

// Content kinds (devdocs/freestyle-windows.md). An absent `kinds` on a host that
// declared window support means text-only — the shipped text-window hosts predate
// the field; a host with no window support at all has no kinds.
function windowKindAvailable(kind) {
    const windows = hostCapabilities && hostCapabilities.windows;
    if (!windows) return false;
    const kinds = Array.isArray(windows.kinds) ? windows.kinds : ["text"];
    return kinds.includes(String(kind));
}

// Custom-shell events (devdocs/custom-shells.md): the game's semantic events to an
// author-customized web shell. One generic fire-and-forget message — the protocol
// vocabulary is the author's own. No channel (plain, TUI, stock web shell without
// a custom layer) ⇒ drops silently, so golden output is byte-invariant by
// construction. Name and payload render through the text pipeline (substitutions
// work) and strip to plain strings, like canvas_text.
let shellImpl = null;
function setShellChannel(nextShellImpl) {
    shellImpl = nextShellImpl;
}

function shellSend(name, payload) {
    if (!shellImpl) return;
    const plain = (v) => parseStyledRuns(renderText(v)).map((r) => r.text).join("");
    shellImpl({ type: "shell_event", name: plain(name), payload: plain(payload) });
}

function shellAvailable() {
    return !!(hostCapabilities && hostCapabilities.shell);
}

// Split a rendered string into wire runs [{ text, styles? }], honoring the style
// push/pop sentinels with a local depth (independent of the main output stream's
// style state) and dropping break sentinels — a window line is exactly one line.
function parseStyledRuns(s) {
    const runs = [];
    const depth = { bold: 0, italic: 0, fixed: 0 };
    let run = "";
    const flush = () => {
        if (run.length === 0) return;
        const styles = [];
        for (const name of STYLE_ORDER) {
            if (depth[name] > 0) styles.push(name);
        }
        runs.push(styles.length ? { text: run, styles } : { text: run });
        run = "";
    };
    for (const ch of String(s)) {
        if (STYLE_PUSH_BY_CHAR[ch] !== undefined) {
            flush();
            depth[STYLE_PUSH_BY_CHAR[ch]] += 1;
        } else if (STYLE_POP_BY_CHAR[ch] !== undefined) {
            flush();
            if (depth[STYLE_POP_BY_CHAR[ch]] > 0) depth[STYLE_POP_BY_CHAR[ch]] -= 1;
        } else if (ch === STREAM_LINE_BREAK || ch === STREAM_PAR_BREAK
            || ch === STREAM_NO_BREAK || ch === STREAM_PAR_IF_PRINTED) {
            // Break markers are stream concerns; window content is line-structured.
        } else {
            run += ch;
        }
    }
    flush();
    return runs;
}

const windowBuffers = new Map();
const canvasBuffers = new Map();

// A pane holds one content kind: text lines or canvas ops, never both
// (devdocs/freestyle-windows.md). Each primitive checks the window's `content_kind`
// field (Lamp-side name; the wire carries it as `kind`) so a mismatch errors at the
// call, naming the window, instead of composing content the sync would have to drop.
function windowKindOf(w) {
    return String((w && w.content_kind) || "text");
}

function requireWindowKind(w, kind, prim) {
    if (!(w && w.name)) throw new Error("window primitive called with no window object");
    const actual = windowKindOf(w);
    if (actual !== kind) {
        throw new Error(`${prim} called on window "${w.name}" of kind "${actual}" (expected a "${kind}" window)`);
    }
}

function windowBufferFor(w) {
    const key = w && w.name;
    if (!key) throw new Error("window primitive called with no window object");
    let lines = windowBuffers.get(key);
    if (!lines) {
        lines = [];
        windowBuffers.set(key, lines);
    }
    return lines;
}

function windowLine(w, text) {
    requireWindowKind(w, "text", "window_line");
    windowBufferFor(w).push(parseStyledRuns(renderText(text)));
}

// One line: left segment, a space fill run consuming the slack, right segment —
// the status-line shape.
function windowLineSplit(w, left, right) {
    requireWindowKind(w, "text", "window_line_split");
    const line = parseStyledRuns(renderText(left));
    line.push({ text: " ", fill: true });
    for (const run of parseStyledRuns(renderText(right))) line.push(run);
    windowBufferFor(w).push(line);
}

// A full-width rule: one char the host repeats to fill the line.
function windowRule(w, ch) {
    requireWindowKind(w, "text", "window_rule");
    const c = Array.from(String(renderText(ch)))[0] || "-";
    windowBufferFor(w).push([{ text: c, fill: true }]);
}

function windowClear(w) {
    windowBuffers.delete(w && w.name);
    canvasBuffers.delete(w && w.name);
    hotspotBuffers.delete(w && w.name);
}

// Canvas ops (devdocs/freestyle-windows.md): a transient draw list per pane,
// flushed by windowSync as a whole-pane repaint, exactly like text lines.
// Coordinates are the pane's declared virtual units; the host scales. Colors are
// the closed color-style vocabulary or #rrggbb — validated here so a typo fails
// loudly at the call site rather than rendering nothing on a distant host.
const CANVAS_COLOR_NAMES = new Set(STYLE_ORDER.filter((s) => s !== "bold" && s !== "italic" && s !== "fixed" && s !== "fit"));

function canvasColor(color, prim) {
    const c = String(color);
    if (CANVAS_COLOR_NAMES.has(c) || /^#[0-9a-fA-F]{6}$/.test(c)) return c;
    throw new Error(`${prim}: unknown color "${c}" (expected a color style name or "#rrggbb")`);
}

function canvasBufferFor(w) {
    const key = w.name;
    let ops = canvasBuffers.get(key);
    if (!ops) {
        ops = [];
        canvasBuffers.set(key, ops);
    }
    return ops;
}

function canvasRect(w, color, x, y, wd, ht) {
    requireWindowKind(w, "canvas", "canvas_rect");
    canvasBufferFor(w).push({
        op: "rect", color: canvasColor(color, "canvas_rect"),
        x: Number(x) || 0, y: Number(y) || 0, w: Number(wd) || 0, h: Number(ht) || 0,
    });
}

function canvasLine(w, color, x1, y1, x2, y2) {
    requireWindowKind(w, "canvas", "canvas_line");
    canvasBufferFor(w).push({
        op: "line", color: canvasColor(color, "canvas_line"),
        x1: Number(x1) || 0, y1: Number(y1) || 0, x2: Number(x2) || 0, y2: Number(y2) || 0,
    });
}

// Text drawn into the canvas space is plain: substitutions render, but style
// wrappers are stripped (a canvas op has one color; there is no run model here).
function canvasText(w, color, x, y, size, text) {
    requireWindowKind(w, "canvas", "canvas_text");
    const plain = parseStyledRuns(renderText(text)).map((r) => r.text).join("");
    canvasBufferFor(w).push({
        op: "text", color: canvasColor(color, "canvas_text"),
        x: Number(x) || 0, y: Number(y) || 0, size: Number(size) || 0, text: plain,
    });
}

// Declared image assets (`image NAME: file "PATH"` emits defineImage at load;
// devdocs/freestyle-windows.md). The registry maps name → declared source-relative
// path. Definition-time state, like types and globals — never snapshotted.
const imageRegistry = new Map();

function defineImage(name, declaredPath) {
    imageRegistry.set(String(name), String(declaredPath));
}

function getImagePath(name) {
    return imageRegistry.get(String(name));
}

// `img` is a declared image's name (the wire carries the name; a host resolves it
// via the bundle's asset manifest). Validated against the registry so a typo'd
// name errors loudly at the call, even on a host that renders nothing.
// Width/height are mandatory: the game can't query intrinsic image size, so
// composition stays deterministic.
function canvasImage(w, img, x, y, wd, ht) {
    requireWindowKind(w, "canvas", "canvas_image");
    const name = String(img);
    if (!imageRegistry.has(name)) {
        throw new Error(`canvas_image: unknown image "${name}" (no such image declaration)`);
    }
    canvasBufferFor(w).push({
        op: "image", image: name,
        x: Number(x) || 0, y: Number(y) || 0, w: Number(wd) || 0, h: Number(ht) || 0,
    });
}

// Hotspots (devdocs/freestyle-windows.md, v1.1): a rectangle in the pane's
// virtual space carrying a parser command the host synthesizes on click, exactly
// as if typed. Buffered per turn beside the draw list — always as current as the
// drawing it overlays — and flushed on the canvas window_update. The command
// renders through the text pipeline (substitutions work), stripped to plain text
// like canvas_text.
const hotspotBuffers = new Map();

function hotspotBufferFor(w) {
    const key = w.name;
    let spots = hotspotBuffers.get(key);
    if (!spots) {
        spots = [];
        hotspotBuffers.set(key, spots);
    }
    return spots;
}

function canvasHotspot(w, x, y, wd, ht, command) {
    requireWindowKind(w, "canvas", "canvas_hotspot");
    const plain = parseStyledRuns(renderText(command)).map((r) => r.text).join("");
    hotspotBufferFor(w).push({
        x: Number(x) || 0, y: Number(y) || 0, w: Number(wd) || 0, h: Number(ht) || 0,
        command: plain,
    });
}

const WINDOW_DOCKS = new Set(["top", "bottom", "left", "right"]);
const WINDOW_KINDS = new Set(["text", "canvas"]);

// Emit one window's idempotent arrangement (window_set, read fresh from its fields —
// the host diffs) then its buffered content (window_update), draining that window's
// buffers. Shared by windowSync and windowSyncOne. Dock/kind validation happens here
// rather than in the checker because both are data a game may reassign at play time.
function emitWindow(inst) {
    const lines = windowBuffers.get(inst.name) || [];
    const ops = canvasBuffers.get(inst.name) || [];
    const hotspots = hotspotBuffers.get(inst.name) || [];
    windowBuffers.delete(inst.name);
    canvasBuffers.delete(inst.name);
    hotspotBuffers.delete(inst.name);
    if (!windowImpl || !typeRegistry.has("window")) return;
    const dock = String(inst.dock);
    if (!WINDOW_DOCKS.has(dock)) {
        throw new Error(`window "${inst.name}" has invalid dock "${dock}" (expected top, bottom, left, or right)`);
    }
    const kind = windowKindOf(inst);
    if (!WINDOW_KINDS.has(kind)) {
        throw new Error(`window "${inst.name}" has invalid content_kind "${kind}" (expected text or canvas)`);
    }
    const set = {
        type: "window_set",
        id: inst.name,
        dock,
        size: Number(inst.size) || 0,
        priority: Number(inst.priority) || 0,
        visible: !!inst.visible,
        title: String(inst.title == null ? "" : inst.title),
        // Visual identity: "pane" or "bar" (the status-line look). Hosts
        // treat an unknown look as "pane" (fail-silently).
        look: String(inst.look || "pane"),
        kind,
    };
    if (kind === "canvas") {
        const cw = Number(inst.canvas_w) || 0;
        const ch = Number(inst.canvas_h) || 0;
        if (cw <= 0 || ch <= 0) {
            throw new Error(`canvas window "${inst.name}" needs positive canvas_w and canvas_h (got ${cw}x${ch})`);
        }
        set.canvas = { w: cw, h: ch };
    }
    windowImpl(set);
    windowImpl(kind === "canvas"
        ? { type: "window_update", id: inst.name, kind, ops, hotspots }
        : { type: "window_update", id: inst.name, kind, lines });
}

// Flush every declared `window`-typed instance. Buffers drain even with no channel
// installed, so a pane recomposed every turn on a windowless host can't accumulate.
function windowSync() {
    if (!typeRegistry.has("window")) {
        windowBuffers.clear();
        canvasBuffers.clear();
        hotspotBuffers.clear();
        return;
    }
    for (const inst of getInstancesForTypeAndSubtypes("window")) {
        emitWindow(inst);
    }
}

// Flush a single window (its arrangement + buffered content). Used at startup to put
// the status bar on screen before startup_rules can block on a pause, without sending
// game panels whose arrangement startup_rules hasn't finalized yet (see startup.lamp).
function windowSyncOne(w) {
    if (w) emitWindow(w);
}

// Player input is a brokered host capability. The host owns stdin and the worker
// installs an input channel via setInputChannel; readLine blocks on that channel.
// A game run outside the sandbox has no channel and cannot read input — the
// sandbox launcher is the only supported run path. See devdocs/sandbox.md.
let requestLineImpl = null;
let promptLineImpl = null;

// Whether the most recent readLine/promptLine hit end-of-input (the input channel
// returned null: piped input exhausted, or the player sent EOF on the plain backend).
// The game reads it via the `input_ended` native to end the session instead of spinning
// on empty re-prompts. Refreshed on every read; a queued command clears it.
let inputEofFlag = false;

function inputEnded() {
    return inputEofFlag;
}

// A queue of pending input lines (used by the debug `test` runner — see lib/advent/debug.lamp).
// promptLine drains this before reading from the host, echoing each line like a typed command, so
// queued commands flow through the *real* command loop (every-turn rules, story checks, and all).
// queueCommands inserts at the FRONT, so a nested `test X` expands in place ahead of the
// remaining lines of the enclosing script.
let commandQueue = [];

function queueCommands(items) {
    commandQueue.unshift(...items);
}

function setInputChannel(requestLine) {
    requestLineImpl = requestLine;
}

function setPromptChannel(requestPromptLine) {
    promptLineImpl = requestPromptLine;
}

// Host interactivity: whether a real player is at the input — a TTY, or the
// browser shell — as opposed to piped/redirected input (goldens, `printf |`).
// Set per session by the worker from workerData; defaults interactive so hosts
// that never set it (the browser) behave as live sessions.
let hostInteractive = true;

function setHostInteractive(flag) {
    hostInteractive = Boolean(flag);
}

// Pause for the player (lib/sys `pause`): print `promptText` and wait for ENTER.
// Skipped outright when input is scripted — queued `test` commands pending, or a
// non-interactive host — so a pause never eats a queued command or a piped line,
// and non-interactive runs stay deterministic.
function pauseForInput(promptText) {
    if (!hostInteractive || commandQueue.length > 0) return;
    promptLine(promptText);
}

function readLine() {
    if (!requestLineImpl) {
        throw new Error("no input channel installed; run the game through the sandbox launcher");
    }
    streamFlushPending();
    const raw = requestLineImpl();
    inputEofFlag = raw === null;
    const line = inputEofFlag ? "" : raw;
    streamNoteInputLine();
    // The host (or terminal) echoes the typed line to the screen, bypassing the
    // output stream, so a transcript would miss it — record it here instead.
    transcriptCapture(line + "\n");
    return line;
}

// Like readLine but also writes `promptText` to the output before blocking,
// and echoes the input line in piped/non-TTY mode. Use this instead of
// write()+readLine() for interactive prompts.
function promptLine(promptText) {
    // Drain any queued commands first (the `test` runner), echoing each as if typed so the
    // transcript reads naturally and the real command loop drives them.
    if (commandQueue.length > 0) {
        const queued = commandQueue.shift();
        inputEofFlag = false;
        streamFlushPending();
        hostWrite(promptText + queued + "\n");
        streamNoteInputLine();
        return queued;
    }
    if (!promptLineImpl) {
        throw new Error("no prompt channel installed; run the game through the sandbox launcher");
    }
    streamFlushPending();
    const raw = promptLineImpl(promptText);
    inputEofFlag = raw === null;
    const line = inputEofFlag ? "" : raw;
    streamNoteInputLine();
    // The prompt and the typed line are written to the screen by the host, not
    // through the output stream, so mirror both into an open transcript.
    transcriptCapture(promptText + line + "\n");
    return line;
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

// Integer division and remainder (the `div` and `mod` operators). Floored division
// paired with a remainder that takes the divisor's sign, so the identity
// a == (a div b) * b + (a mod b) holds. Divide-by-zero yields 0 (keeping an int).
function intDivide(a, b) {
    const bi = Math.trunc(b);
    if (bi === 0) return 0;
    return Math.floor(Math.trunc(a) / bi);
}

function modulo(a, b) {
    const bi = Math.trunc(b);
    if (bi === 0) return 0;
    const ai = Math.trunc(a);
    return ai - bi * Math.floor(ai / bi);
}

// Renders a template literal's parts (text strings and embedded values) to a
// single string, formatting each part as `print` would. Emitter target for a
// TemplateLiteral; the eager-render form of text substitution. See devdocs/text.md.
function renderTemplate(parts) {
    let out = "";
    for (const part of parts) {
        out += String(formatValue(part));
    }
    return out;
}

// A `text` value is a lazy, branded thunk: calling it renders the template now.
// Laziness is what makes `text` worth a distinct type — it re-evaluates its
// substitutions each time it is printed/frozen. `makeText` brands the thunk so
// formatValue/encodeValue can recognize it; `isTextValue` tests the brand;
// `renderText` is the `freeze` primitive (force a text — or any value — to a
// string). See devdocs/text.md K2.
function makeText(thunk) {
    thunk.__lampText = true;
    return thunk;
}

function isTextValue(value) {
    return typeof value === "function" && value.__lampText === true;
}

// Persistable text templates (devdocs/text-persistence.md, Phase 1). Every compile-time
// template literal that captures no lexical binding is assigned a build-stable id by the
// emitter and registered here at module load. A `text`-valued field then serializes as
// `{$tmpl:id}` and is rebuilt on restore as a *live* thunk (instantiateTemplate), instead
// of being frozen to a dead string. The build id gates cross-build restores, so ids only
// need be stable within a build. Templates that capture `self`/a local/action context (or
// are runtime-composed) are emitted unbranded and still freeze on capture — the fallback.
const templateRegistry = new Map();
function registerTemplate(id, factory) {
    templateRegistry.set(id, factory);
}
// `env` supplies the template's captured object references (Phase 2b — currently just a
// captured `self`), in the order the factory's params expect; `[]` for a no-capture
// template. The produced text is branded with both, so encodeValue can re-serialize the env.
function instantiateTemplate(id, env = []) {
    const factory = templateRegistry.get(id);
    if (!factory) throw new Error(`no registered text template #${id}`);
    const value = factory(...env);
    value.__tmplId = id;
    value.__tmplEnv = env;
    return value;
}

function renderText(value) {
    return isTextValue(value) ? renderTextValue(value) : String(formatValue(value));
}

// --- Render context (text substitution, render-local) -----------------------
// Render-local state threaded through a single outermost render pass: the
// third-person `subject` that [They]/[them]/[their] refer to and that verbs agree
// with (set by [regarding] or by naming a thing); the verb `agreement`
// (person/number) currently in force; and the most-recent `count` for plural
// agreement (Slice 5). [We]/[us]/[our]/[ours] do NOT read this context — they are
// the player, rendered by the story viewpoint (a saved global) — so the context
// holds only third-person/agreement state. Created at the outermost render
// boundary (a print/freeze of a text value) and shared by every nested
// substitution, so a [regarding] early in a string governs the verbs after it.
// Reset per render and NEVER saved — render-local lifetime (devdocs/text.md
// "Render context"). The engine owns the object and lifetime; the locale's
// pronoun/verb functions read and write it through the accessors below, and own
// the language data (which person maps to which word).
const renderContextStack = [];

function currentRenderContext() {
    return renderContextStack.length > 0 ? renderContextStack[renderContextStack.length - 1] : null;
}

// Renders a text value, establishing a render context if none is active. A nested
// text (a substitution that itself yields a text) reuses the active context so a
// [regarding]/count set in the outer string governs the inner one. The single
// boundary formatValue/renderText/encodeValue route text rendering through.
function renderTextValue(textValue) {
    if (currentRenderContext() !== null) {
        return textValue();
    }
    renderContextStack.push({ subject: null, agreement: null, count: null, viewpointNamed: false });
    try {
        return textValue();
    } finally {
        renderContextStack.pop();
    }
}

// Render-context accessors exposed to the locale's pronoun/verb/regarding/count
// language data. `subject` is the current third-person referent ([They]/[them]),
// set by [regarding] and by the article functions when they name a thing.
// `agreement` is the opaque person/number descriptor a following verb conjugates
// against (set by [We]/[They]/[regarding]); the locale builds and reads it. Each
// returns null rather than throwing when no render is active, so a stray call
// outside a render degrades gracefully.
function renderSubject() {
    const ctx = currentRenderContext();
    return ctx ? ctx.subject : null;
}

function renderSetSubject(value) {
    const ctx = currentRenderContext();
    if (ctx) ctx.subject = value;
    return "";
}

function renderAgreement() {
    const ctx = currentRenderContext();
    return ctx ? ctx.agreement : null;
}

function renderSetAgreement(value) {
    const ctx = currentRenderContext();
    if (ctx) ctx.agreement = value;
    return "";
}

// Whether the player has already been rendered by *name* (rather than a pronoun) in this render —
// used by a named third-person viewpoint so the first [We] emits "Galaxy" and later references in
// the same render pronominalize ("she"). Per-render, so each message starts fresh.
function renderViewpointNamed() {
    const ctx = currentRenderContext();
    return ctx ? ctx.viewpointNamed : false;
}

function renderSetViewpointNamed(value) {
    const ctx = currentRenderContext();
    if (ctx) ctx.viewpointNamed = Boolean(value);
    return "";
}

function renderCount() {
    const ctx = currentRenderContext();
    return ctx ? ctx.count : null;
}

function renderSetCount(value) {
    const ctx = currentRenderContext();
    if (ctx) ctx.count = value;
    return value;
}

// Interpolation hook wrapped around every template value-substitution. Its only
// job is to record an interpolated *number* as the governing count (G3/G7), so a
// following `[s]` agrees with it; it returns the value unchanged for rendering.
// Template parts are array elements evaluated left-to-right, so the count is set
// before a later `[s]` (also an array element) reads it. See devdocs/text.md G7.
function interp(value) {
    if (typeof value === "number") renderSetCount(value);
    return value;
}

function formatValue(value) {
    if (isTextValue(value)) {
        return renderTextValue(value);
    }
    if (isListValue(value)) {
        return formatListValue(value.items);
    }
    if (value && typeof value === "object" && typeof value.name === "string") {
        // A `printed_name` field, when set, overrides the canonical `name` for
        // display only (the registry key stays `name`). It may hold a text
        // template (a name with substitutions). See devdocs/text.md B2.
        noteMentioned(value);
        const printed = value.printed_name;
        if (isTextValue(printed)) return renderTextValue(printed);
        return typeof printed === "string" && printed.length > 0 ? printed : value.name;
    }
    if (value && typeof value === "object" && relationRegistry.has(value.type)) {
        return formatRelationValue(value);
    }
    // Everything else (numbers, booleans) becomes a string here, so the stream layer's
    // "a run is a string" invariant holds deliberately rather than by JS coercion quirk.
    return String(value);
}

function formatRelationValue(instance) {
    const fieldNames = Object.keys(relationRegistry.get(instance.type).fields);
    const parts = fieldNames.map((fieldName) => String(formatValue(instance[fieldName])));
    return `${instance.type}(${parts.join(", ")})`;
}

function isListValue(value) {
    return Boolean(value) && typeof value === "object" && Array.isArray(value.items) && "first" in value;
}

// Rendering a list to prose ("a, b and c", the empty-list word, the serial
// comma) is presentation policy, which a library owns — it installs a formatter
// via setListFormatter (lib/sys does, honoring the author-settable `oxford_comma`
// global). The runtime's only fallback, used if nothing registers one, is a bare
// comma join, so the engine holds no English-prose policy of its own.
let listFormatter = (strings) => strings.join(", ");

function setListFormatter(formatter) {
    listFormatter = formatter;
}

function formatListValue(items) {
    return listFormatter(items.map((item) => String(formatValue(item))));
}

function makeList(items) {
    return {
        items,
        get first() {
            return items.length > 0 ? items[0] : null;
        },
        // List quantity accessors (G2): `.size` / `.count` both give the element
        // count. See devdocs/text.md G2.
        get size() {
            return items.length;
        },
        get count() {
            return items.length;
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

// The only place world objects and relation edges are unioned: a relation's
// `.all` returns its edges, while a world type's `.all` returns its objects.
function getInstancesForTypeAndSubtypes(typeName) {
    const results = [];
    for (const [registeredTypeName, instances] of instanceRegistry.entries()) {
        if (isTypeOrSubtype(registeredTypeName, typeName)) {
            results.push(...instances);
        }
    }
    for (const [registeredTypeName, instances] of relationInstanceRegistry.entries()) {
        if (isTypeOrSubtype(registeredTypeName, typeName)) {
            results.push(...instances);
        }
    }
    return results;
}

// Value-level type test behind the `x is TYPE` operator: true iff `value` is an
// object whose type is `typeName` or a subtype. Null-guarded (a `none` value is
// never a member), so `x is item` on an unset reference is false, not a crash.
function isType(value, typeName) {
    return Boolean(value && typeof value === "object" && isTypeOrSubtype(value.type, typeName));
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

// ====================================================================
// State snapshots — UNDO now, SAVE/RESTORE next. See devdocs/state.md.
// ====================================================================

// The value algebra is closed: scalar | object reference | list. encode/decode
// is the single place that changes if a new value kind is ever introduced; the
// `throw` surfaces any unrecognized value rather than silently dropping it.
function encodeValue(value) {
    if (value === null || value === undefined) return null;
    // A `text` thunk is program (a rendering rule), not a member of the closed save
    // algebra. A template with a build-stable id (assigned by the emitter to a no-capture
    // literal) serializes as a reference to it (`{$tmpl:id}`), so restore rebuilds a live
    // thunk — the field stays dynamic. A branded-less text (captures a lexical, or is
    // runtime-composed) has no id, so it falls back to freezing to its current rendered
    // string. See devdocs/text-persistence.md.
    if (isTextValue(value)) {
        if (value.__tmplId == null) return renderTextValue(value);
        const env = value.__tmplEnv || [];
        if (env.length === 0) return { $tmpl: value.__tmplId };
        try {
            // Serialize the captured refs (a named-instance self → {$ref}); on restore the
            // factory rebuilds a live thunk bound to them.
            return { $tmpl: value.__tmplId, env: env.map(encodeValue) };
        } catch (err) {
            // A capture that isn't a serializable named instance — a transient action `self`.
            // Freeze to the current render, like an unbranded template (what I7 also can't
            // persist). See devdocs/text-persistence.md.
            return renderTextValue(value);
        }
    }
    if (isListValue(value)) return { $list: value.items.map(encodeValue) };
    if (typeof value === "object") {
        if (typeof value.name === "string" && nameRegistry.get(value.name) === value) {
            return { $ref: value.name };
        }
        if (relationRegistry.has(value.type)) {
            throw new Error(`cannot snapshot an anonymous \`${value.type}\` relation edge: only a named edge survives save/undo/restore, so do not keep an unnamed relation-query result across a turn (see devdocs/state.md)`);
        }
        throw new Error("cannot snapshot value: unrecognized object (not a named instance or list)");
    }
    return value;
}

function decodeValue(data) {
    if (data === null || data === undefined) return null;
    if (typeof data === "object") {
        if ("$ref" in data) return nameRegistry.get(data.$ref) ?? null;
        if ("$list" in data) return makeList(data.$list.map(decodeValue));
        // A persistable text template: rebuild a fresh live thunk from the registry, binding
        // any captured refs from the env (devdocs/text-persistence.md). A plain string (a
        // frozen fallback text, or any old save) decodes below as itself.
        if ("$tmpl" in data) return instantiateTemplate(data.$tmpl, (data.env || []).map(decodeValue));
        throw new Error("cannot restore value: unrecognized encoded object");
    }
    return data;
}

// State providers own each slice of mutable game state. The snapshot core never
// hardcodes what to capture — new mutable state is captured by registering a
// provider, not by editing this file. See devdocs/state.md → State-provider
// registry.
const stateProviders = [];
function registerStateProvider(provider) {
    stateProviders.push(provider);
}

function captureState() {
    const snap = {};
    for (const provider of stateProviders) snap[provider.key] = provider.capture();
    return snap;
}

function restoreState(snap) {
    for (const provider of stateProviders) provider.restore(snap[provider.key]);
    buildVocabIndex();
}

// Own-field encode for a registry record, skipping the structural keys that
// identity (not state) is carried by.
function encodeFields(record, skip) {
    const fields = {};
    for (const key of Object.keys(record)) {
        if (skip.has(key)) continue;
        try {
            fields[key] = encodeValue(record[key]);
        } catch (err) {
            throw new Error(`${err.message} — held in field \`${key}\` of ${record.name || record.type}`);
        }
    }
    return fields;
}

// Built-in providers. Registration order matters on restore: instances first so
// that later providers' $refs resolve against the restored instance set.
const INSTANCE_SKIP = new Set(["name", "type"]);
registerStateProvider({
    key: "instances",
    capture() {
        const out = {};
        for (const instances of instanceRegistry.values()) {
            for (const inst of instances) {
                out[inst.name] = { type: inst.type, fields: encodeFields(inst, INSTANCE_SKIP) };
            }
        }
        return out;
    },
    restore(data) {
        const wanted = new Set(Object.keys(data));
        // Drop instances created since the snapshot.
        for (const instances of instanceRegistry.values()) {
            for (let i = instances.length - 1; i >= 0; i -= 1) {
                if (!wanted.has(instances[i].name)) {
                    nameRegistry.delete(instances[i].name);
                    instances.splice(i, 1);
                }
            }
        }
        // Recreate instances deleted since the snapshot (empty for now; fields
        // assigned in the second pass once every instance exists).
        for (const [name, rec] of Object.entries(data)) {
            if (!nameRegistry.has(name)) createObject(rec.type, name, {});
        }
        // Assign fields by direct write (never setField — no change handlers).
        for (const [name, rec] of Object.entries(data)) {
            const inst = nameRegistry.get(name);
            for (const key of Object.keys(inst)) {
                if (!INSTANCE_SKIP.has(key)) delete inst[key];
            }
            for (const [key, encoded] of Object.entries(rec.fields)) {
                inst[key] = decodeValue(encoded);
            }
        }
    },
});

registerStateProvider({
    key: "globals",
    capture() {
        const out = {};
        // `act` is transient execution state (the running action), not world state.
        for (const [name, value] of globalRegistry) {
            if (name === "act") continue;
            try {
                out[name] = encodeValue(value);
            } catch (err) {
                throw new Error(`${err.message} — held in global \`${name}\``);
            }
        }
        return out;
    },
    restore(data) {
        for (const [name, encoded] of Object.entries(data)) {
            globalRegistry.set(name, decodeValue(encoded));
        }
    },
});

const EDGE_SKIP = new Set(["name", "type", "bidi"]);
registerStateProvider({
    key: "relations",
    capture() {
        const out = {};
        for (const [typeName, edges] of relationInstanceRegistry) {
            out[typeName] = edges.map((edge) => ({
                name: edge.name ?? null,
                bidi: Boolean(edge.bidi),
                fields: encodeFields(edge, EDGE_SKIP),
            }));
        }
        return out;
    },
    restore(data) {
        // Edges are recreated wholesale (nothing holds edge identity across a
        // turn). Clear current edges and their name bindings first.
        for (const [typeName, edges] of relationInstanceRegistry) {
            for (const edge of edges) {
                if (edge.name) nameRegistry.delete(edge.name);
            }
            relationInstanceRegistry.set(typeName, []);
        }
        for (const [typeName, encodedEdges] of Object.entries(data)) {
            const list = relationInstanceRegistry.get(typeName) || [];
            for (const enc of encodedEdges) {
                const edge = { name: enc.name ?? null, type: typeName, bidi: enc.bidi };
                for (const [key, encoded] of Object.entries(enc.fields)) {
                    edge[key] = decodeValue(encoded);
                }
                list.push(edge);
                if (enc.name) nameRegistry.set(enc.name, edge);
            }
            relationInstanceRegistry.set(typeName, list);
        }
    },
});

registerStateProvider({
    key: "pronoun",
    capture() {
        const out = {};
        for (const [word, ref] of pronounAntecedents) {
            out[word] = Array.isArray(ref) ? ref.map((o) => o.name) : ref.name;
        }
        return out;
    },
    restore(data) {
        pronounAntecedents = new Map();
        if (data && typeof data === "object") {
            for (const [word, val] of Object.entries(data)) {
                if (Array.isArray(val)) {
                    const objs = val.map((n) => nameRegistry.get(n)).filter(Boolean);
                    if (objs.length) pronounAntecedents.set(word, objs);
                } else {
                    const obj = nameRegistry.get(val);
                    if (obj) pronounAntecedents.set(word, obj);
                }
            }
        }
    },
});

// Per-site variation state (the site-durable tier of the render context — see
// devdocs/text.md "Render context"). Each stateful text site ([first time], and
// the cycling/stopping modes in Slice 4c) is keyed by a compile-time site id and
// holds how many times it has been rendered. variationAdvance returns the count
// *before* this visit (0 on the first) and increments it. This must survive
// undo/save, or a restored game would re-show a [first time] block — hence the
// state provider. Unlike the render-local context, this is NOT reset per render.
// A site's value is a plain count for the sequential modes ([first time],
// cycling, stopping) or a small mode-specific record for the random modes
// ({ last } / { chosen } / { order, pos }). A site uses exactly one mode, so its
// value kind is consistent. Records are always replaced, never mutated in place,
// and capture deep-clones, so a snapshot is never aliased to live state.
const variationState = new Map();
function variationAdvance(siteId) {
    const count = variationState.get(siteId) || 0;
    variationState.set(siteId, count + 1);
    return count;
}

// Chooses an alternative index for a random text-variation mode (F1-F6). The
// sequential modes (cycling/stopping) don't come through here — the emitter
// derives their index from variationAdvance directly. Per-site state and the RNG
// draws are captured by state providers, so undo/restore reproduce the sequence.
function variationPick(siteId, n, mode) {
    if (n <= 0) return -1;
    if (mode === "purely") return rngInt(n);
    if (mode === "sticky") {
        const rec = variationState.get(siteId);
        if (rec && typeof rec.chosen === "number") return rec.chosen;
        const chosen = rngInt(n);
        variationState.set(siteId, { chosen });
        return chosen;
    }
    if (mode === "shuffled") {
        let rec = variationState.get(siteId);
        if (!rec || !Array.isArray(rec.order) || rec.pos >= rec.order.length) {
            rec = { order: shuffledIndices(n), pos: 0 };
        }
        const idx = rec.order[rec.pos];
        variationState.set(siteId, { order: rec.order, pos: rec.pos + 1 });
        return idx;
    }
    if (mode === "decreasing") {
        // F7: "decreasingly likely" — weight n for the first alternative down to 1
        // for the last; a weighted draw. Stateless (no per-site record).
        let r = rngInt((n * (n + 1)) / 2);
        for (let i = 0; i < n; i += 1) {
            const weight = n - i;
            if (r < weight) return i;
            r -= weight;
        }
        return n - 1;
    }
    // "random": uniform but never the immediately-previous index.
    const rec = variationState.get(siteId);
    const last = rec && typeof rec.last === "number" ? rec.last : -1;
    let idx;
    if (n > 1 && last >= 0) {
        idx = rngInt(n - 1);
        if (idx >= last) idx += 1;
    } else {
        idx = rngInt(n);
    }
    variationState.set(siteId, { last: idx });
    return idx;
}

registerStateProvider({
    key: "variation",
    capture() {
        const out = {};
        for (const [siteId, value] of variationState) out[siteId] = value;
        return JSON.parse(JSON.stringify(out));
    },
    restore(data) {
        variationState.clear();
        for (const [siteId, value] of Object.entries(data || {})) variationState.set(siteId, value);
    },
});

// Seeded RNG (F8) so randomized text is reproducible: deterministic from a fixed
// default seed (golden tests are stable) and its state is captured by a provider
// so undo/save/restore reproduce the same draws. mulberry32 — small, fast, decent
// distribution. A game seeding from entropy for cross-playthrough variety is a
// later nicety; today every fresh run draws the same sequence.
const DEFAULT_RNG_SEED = 0x9e3779b9 | 0;
let rngState = DEFAULT_RNG_SEED;
function rngNext() {
    rngState = (rngState + 0x6d2b79f5) | 0;
    let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function rngInt(n) {
    return Math.floor(rngNext() * n);
}
function shuffledIndices(n) {
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i -= 1) {
        const j = rngInt(i + 1);
        const tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
    }
    return order;
}

// Normalizes a pick() mode argument to the internal mode names, accepting the inline
// sugar phrasings too ("at random", "in random order", ...). Unknown/empty → the
// default "random" (no immediate repeat).
const PICK_MODE_ALIASES = {
    "": "random", random: "random", "at random": "random",
    purely: "purely", "purely at random": "purely",
    shuffled: "shuffled", "in random order": "shuffled",
    sticky: "sticky", "sticky random": "sticky",
    cycling: "cycling", stopping: "stopping",
    decreasing: "decreasing", "as decreasingly likely outcomes": "decreasing",
};
function normalizePickMode(mode) {
    return PICK_MODE_ALIASES[String(mode == null ? "" : mode).trim().toLowerCase()] || "random";
}

// The pick(LIST, MODE) function form (F1-F7) over a computed list. Like the inline
// [one of] sugar but choosing among list *elements*; the emitter injects a stable
// per-call-site id so the stateful modes (cycling/stopping/sticky/shuffled and
// no-repeat random) keep a cursor across calls. Returns the chosen element, or
// `none` for an empty list.
function pick(xs, mode, siteId) {
    const items = listItems(xs);
    const n = items.length;
    if (n === 0) return null;
    const normalized = normalizePickMode(mode);
    let idx;
    if (normalized === "cycling") idx = variationAdvance(siteId) % n;
    else if (normalized === "stopping") idx = Math.min(variationAdvance(siteId), n - 1);
    else idx = variationPick(siteId, n, normalized);
    return items[idx];
}

// RNG seeding (F8 follow-up). seedRandom makes the stream reproducible from an
// explicit integer; randomizeRng draws a fresh seed from entropy for
// cross-playthrough variety. Both update the saved `rng` provider state, so a
// game that seeds at startup still restores consistently. Golden tests call
// neither, so they keep the deterministic default seed.
function seedRandom(n) {
    rngState = (Number(n) | 0) || DEFAULT_RNG_SEED;
}
function randomizeRng() {
    rngState = (Date.now() ^ Math.floor(Math.random() * 0x100000000)) | 0;
}

// Lamp-facing bounded random: a uniform int in [0, n). Draws from the same seeded,
// save/undo-captured stream as randomized text (so a draw is reproducible across
// restore). n < 1 yields 0 (an empty range has no other sensible value).
function randomInt(n) {
    const bound = Number(n) | 0;
    return bound < 1 ? 0 : rngInt(bound);
}

registerStateProvider({
    key: "rng",
    capture() {
        return rngState;
    },
    restore(data) {
        rngState = typeof data === "number" ? data : DEFAULT_RNG_SEED;
    },
});

// Turn counter: how many fresh command turns have been taken. runCommand calls
// advanceTurn once per fresh turn, just after the undo checkpoint, so the
// checkpoint snapshot holds the pre-turn count and `undo` rolls it back with the
// rest of state. Out-of-world verbs and disambiguation continuations are not
// turns and do not advance it. Captured by its own state provider so a restore
// (and a SAVE blob's `turns` metadata) reflects the count at that point. This is a
// minimal forerunner of the Parser v2 turn clock, not the full clock — every-turn
// rules will build on this counter rather than introduce a second. See
// devdocs/state.md and devdocs/sandbox.md ("Save/restore broker protocol").
let turnCount = 0;
function advanceTurn() {
    turnCount += 1;
}
function turnsTaken() {
    return turnCount;
}
registerStateProvider({
    key: "turns",
    capture() {
        return turnCount;
    },
    restore(data) {
        turnCount = typeof data === "number" && Number.isFinite(data) ? data : 0;
    },
});

// Undo: a bounded stack of snapshots. runCommand checkpoints before each fresh
// turn mutates; `undo` pops and restores.
// The undo depth is an author-settable global (`undo_limit`, declared in
// lib/sys), read fresh each checkpoint like the `oxford_comma` presentation
// setting — so a game can change it at runtime. Falls back to the default when
// the global is absent (a program not using the standard library) or invalid.
const DEFAULT_UNDO_LIMIT = 32;
function undoLimit() {
    const value = getGlobal("undo limit");
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : DEFAULT_UNDO_LIMIT;
}
const undoStack = [];
function checkpoint() {
    undoStack.push(captureState());
    const limit = undoLimit();
    while (undoStack.length > limit) undoStack.shift();
}
function clearUndoHistory() {
    undoStack.length = 0;
}
// Pop the most recent checkpoint and restore it, returning true if a turn was undone or
// false if the undo stack was empty. The library `undo` verb (lib/advent/save.lamp) owns
// the wording; the stack itself + checkpointing stay engine-internal (driven by
// runCommand). This is the same mechanism/policy split as SAVE/RESTORE — there is no
// longer a separate native meta-verb dispatch table.
function undoTurn() {
    if (undoStack.length === 0) return false;
    restoreState(undoStack.pop());
    return true;
}

// ====================================================================
// SAVE / RESTORE — the snapshot plus a versioned header and a storage
// seam. See devdocs/state.md → Save versioning.
// ====================================================================

// Build identity, stamped into the module by Lantern (setBuildId). It gates save
// compatibility: a save records the build it was made with, and restore refuses
// any save whose build differs, because a cross-build restore can corrupt the
// world (the snapshot is keyed by names that may no longer line up).
let buildId = null;
function setBuildId(id) {
    buildId = id;
}
function getBuildId() {
    return buildId;
}

// The game's display identity, read from the game object at save time, so a save
// from a *different game* is distinguished from one from a different *build*.
function gameInfo() {
    if (!typeRegistry.has("game")) return { name: null, author: null };
    const game = getInstancesForTypeAndSubtypes("game")[0];
    return game ? { name: game.name, author: game.author ?? null } : { name: null, author: null };
}

const SAVE_FORMAT = 1;
function captureSave() {
    const info = gameInfo();
    return {
        format: SAVE_FORMAT,
        buildId,
        gameName: info.name,
        gameAuthor: info.author,
        savedAt: new Date().toISOString(),
        state: captureState(),
    };
}

// Never restores on a mismatch. Returns { ok: true } or { ok: false, reason }
// where reason is "format" | "game" | "version" (checked in that order, so a
// build mismatch within the same game reports "version", not "game").
function restoreSave(save) {
    if (!save || save.format !== SAVE_FORMAT) return { ok: false, reason: "format" };
    if (save.gameName !== gameInfo().name) return { ok: false, reason: "game" };
    if (save.buildId !== buildId) return { ok: false, reason: "version" };
    restoreState(save.state);
    clearUndoHistory();
    return { ok: true };
}

// Storage seam: the host injects a save channel so the engine stays
// host-agnostic. write(key, text, meta) persists the opaque blob plus an
// unobfuscated metadata sidecar (see saveToSlot); read(key) returns text or null.
let saveChannel = null;
function setSaveChannel(channel) {
    saveChannel = channel;
}

// A storage key namespaced by game so two games' identically-named slots don't
// collide; sanitized for use as a filename/key by the host.
function saveKeySafe(value, fallback) {
    return String(value).trim().replace(/[^A-Za-z0-9_-]+/g, "_") || fallback;
}
// The per-game key namespace. save_list filters the host store by this so one
// game's saves never appear in another's picker (devdocs/sandbox.md).
function gameKeyPrefix() {
    return `${saveKeySafe(gameInfo().name, "game")}__`;
}
function saveSlotKey(slot) {
    return `${gameKeyPrefix()}${saveKeySafe(slot, "save")}`;
}

// SAVE/RESTORE follow the same mechanism/policy split as transcript: the runtime owns
// the blob lifecycle, the storage seam, and the host-native-picker access (below); the
// library owns the verb words, the text-host prompt, and all wording (lib/advent/
// save.lamp). The browser's modal name-entry stays a *host* seam (promptSave/
// promptRestore) reached through these primitives — the lib only decides text-prompt vs.
// defer-to-host. See devdocs/state.md → Save/restore UX: a host seam.

// Whether a save host seam is installed at all (vs. the engine running outside a host).
// One predicate backs both verbs; each prints its own "unavailable" wording.
function saveAvailable() {
    return !!saveChannel;
}

// Whether the host renders its own save name-entry UI (the browser modal) rather than
// relying on the library's text prompt. The lib branches on this.
function saveHasPicker() {
    return !!(saveChannel && typeof saveChannel.promptSave === "function");
}

// Collect a slot name through the host's native save modal (showing this game's slots
// for overwrite). Returns the chosen name, or "" if the player dismissed it. Only valid
// when saveHasPicker() is true.
function savePickName() {
    if (!saveChannel || typeof saveChannel.promptSave !== "function") return "";
    const choice = saveChannel.promptSave(gameKeyPrefix());
    const name = choice && choice.name;
    return name ? String(name) : "";
}

// Capture, obfuscate, and persist the current game under slot `name`, with the
// unobfuscated metadata sidecar a picker reads to label slots. Returns true on success,
// false if there is no channel or the host write threw. The blob is obfuscated with the
// same reversible XOR+base64 codec as --encode-strings (discourages snooping; not
// security — the key ships in the runtime). `meta.name` is the player's faithful slot
// name (not the sanitized key); `savedAt` mirrors the blob header; `turns` is the count
// at save time. See devdocs/sandbox.md → "Save/restore broker protocol".
function saveToSlot(name) {
    if (!saveChannel) return false;
    try {
        const save = captureSave();
        const meta = { name: String(name).trim(), savedAt: save.savedAt, turns: turnsTaken() };
        saveChannel.write(saveSlotKey(name), encodeText(JSON.stringify(save)), meta);
        return true;
    } catch (err) {
        return false;
    }
}

// Whether the host renders its own restore picker (the browser modal of existing slots)
// rather than relying on the library's text prompt.
function restoreHasPicker() {
    return !!(saveChannel && typeof saveChannel.promptRestore === "function");
}

// Run the host's native restore picker, which returns the chosen blob *directly* (one
// round-trip — the host already holds it). Returns the blob, or "" if the player
// dismissed the picker. Only valid when restoreHasPicker() is true.
function restorePickBlob() {
    if (!saveChannel || typeof saveChannel.promptRestore !== "function") return "";
    const stored = saveChannel.promptRestore(gameKeyPrefix());
    return stored == null ? "" : String(stored);
}

// Read the stored blob for slot `name` from the host (text-host path). Returns the blob,
// or "" when there is no save by that name (a blob is never empty, so "" is unambiguous).
function restoreReadSlot(name) {
    if (!saveChannel) return "";
    const stored = saveChannel.read(saveSlotKey(name));
    return stored == null ? "" : String(stored);
}

// Decode a blob and apply it behind the build-compatibility gate. Returns a status the
// library maps to wording: "ok" | "corrupt" (decode/parse failed) | "game" | "version" |
// "format" (the restoreSave refusal reasons). Never restores on a mismatch.
function restoreApplyBlob(blob) {
    let save;
    try {
        save = JSON.parse(decode(blob));
    } catch (err) {
        return "corrupt";
    }
    const result = restoreSave(save);
    return result.ok ? "ok" : result.reason;
}

// Enumerate this game's saved slots via the host (which owns the store and reads
// the unobfuscated metadata sidecars). Returns the metadata rows
// (`{ name, savedAt, turns }`), most-recent first, filtered to this game by its key
// prefix; `[]` when no channel, no `list` support, or no saves. The reader behind a
// future restore picker / CLI `^L`-list. See devdocs/sandbox.md.
function listSaves() {
    if (!saveChannel || typeof saveChannel.list !== "function") return [];
    const rows = saveChannel.list(gameKeyPrefix());
    return Array.isArray(rows) ? rows : [];
}

// ====================================================================
// TRANSCRIPT (scripting) — the *mechanism* only: capture wiring + a host
// file seam + start/stop/query primitives. The verb words, the filename
// prompt, and the wording are library policy (lib/advent), not engine
// concerns, so a game can reword, localize, or omit them. The capture
// hooks must live here because output/input flow through the runtime's
// stream manager, which a Lamp game can't reach. See devdocs/state.md →
// Transcript (scripting).
// ====================================================================

// Storage seam: the host injects a transcript channel so the engine stays
// host-agnostic, mirroring the save channel. start(key) opens a file (returns a
// status string, "ok" on success); write(text) appends a chunk; stop() closes it.
// A host without file output installs nothing, so the feature reports unavailable.
let transcriptChannel = null;
function setTranscriptChannel(channel) {
    transcriptChannel = channel;
}

// Whether a transcript is currently open. hostWrite and the input-reading helpers
// consult this on every chunk, so it must be cheap.
let transcriptActive = false;

// Append plain output/input text to the open transcript. The single entry point the
// capture hooks call; a no-op (and swallows host errors) when no transcript is open
// so a failing transcript never disrupts gameplay.
function transcriptCapture(text) {
    if (!transcriptActive || !transcriptChannel) return;
    try {
        transcriptChannel.write(String(text));
    } catch (err) {
        // A write failure shouldn't crash the turn; drop the transcript silently.
        transcriptActive = false;
    }
}

// Whether a transcript host seam is installed at all (vs. merely not running). The
// library checks this to distinguish "transcripts unavailable here" from a failure.
function transcriptAvailable() {
    return !!transcriptChannel;
}

function transcriptRunning() {
    return transcriptActive;
}

// Open a transcript to a player-named file, returning true on success. The runtime
// owns the namespaced/sanitized storage key and the capture wiring; the caller (the
// library verb) owns the name prompt and all wording. False if unavailable, already
// running, or the host failed to open the file.
function transcriptStart(name) {
    if (!transcriptChannel || transcriptActive) return false;
    let status;
    try {
        status = transcriptChannel.start(transcriptKey(name));
    } catch (err) {
        status = "error";
    }
    if (status !== "ok") return false;
    transcriptActive = true;
    return true;
}

// Close the open transcript (a no-op if none). Capture stops immediately, so a
// closing message printed by the caller afterward is screen-only, not in the file.
function transcriptStop() {
    if (!transcriptActive) return;
    transcriptActive = false;
    try {
        transcriptChannel.stop();
    } catch (err) {
        // Already detached from the channel; nothing more to do.
    }
}

// A filesystem-safe stem for the transcript file, from the player's chosen name. Unlike
// saves, transcripts are NOT game-namespaced: a save is an opaque blob in a shared store
// (the prefix prevents cross-game collisions), but a transcript is a human-named artifact
// the host drops in the working directory — so the player gets a plain `<name>.txt`, not
// a `<game>__<name>` store key. The host adds the directory and extension.
function transcriptKey(slot) {
    return saveKeySafe(slot, "transcript");
}

module.exports = {
    bootstrapBuiltins,
    defineType,
    defineRelation,
    addRelation,
    removeRelation,
    removeRelationByName,
    moveObject,
    containerOf,
    scopeOf,
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
    renderTemplate,
    makeText,
    registerTemplate,
    instantiateTemplate,
    renderText,
    renderSubject,
    renderSetSubject,
    renderAgreement,
    renderSetAgreement,
    renderViewpointNamed,
    renderSetViewpointNamed,
    renderCount,
    renderSetCount,
    interp,
    variationAdvance,
    variationPick,
    pick,
    seedRandom,
    randomizeRng,
    randomInt,
    divide,
    intDivide,
    modulo,
    onEvent,
    registerActionRule,
    runAction,
    registerRulebookRule,
    runRulebook,
    HALT,
    registerGrammar,
    setDirectSlot,
    setOutOfWorld,
    setWorldScope,
    setSlotScopedByContents,
    setMultiAction,
    setAllFilter,
    runCommand,
    runMetaCommand,
    splitCommands,
    commandRan,
    inputEnded,
    playerCommand,
    registerChangeHandler,
    registerRelationAddHandler,
    registerRelationRemoveHandler,
    setField,
    dispatch: fireEvent,
    run,
    restartAvailable,
    requestRestart,
    print,
    message,
    registerMessageOverride,
    write,
    setWrite,
    outputMarker,
    styled,
    flushOutput,
    setPromptChannel,
    promptLine,
    setHostInteractive,
    pauseForInput,
    queueCommands,
    setInputChannel,
    readLine,
    error,
    makeList,
    listItems,
    setListFormatter,
    setParserLanguage,
    noteMentioned,
    isType,
    decode,
    captureState,
    restoreState,
    registerStateProvider,
    registerScopeProvider,
    registerScopeBarrier,
    isTypeOrSubtype,
    advanceTurn,
    turnsTaken,
    undoTurn,
    clearUndoHistory,
    setBuildId,
    getBuildId,
    captureSave,
    restoreSave,
    setSaveChannel,
    saveAvailable,
    saveHasPicker,
    savePickName,
    saveToSlot,
    restoreHasPicker,
    restorePickBlob,
    restoreReadSlot,
    restoreApplyBlob,
    listSaves,
    setTranscriptChannel,
    transcriptStart,
    transcriptStop,
    transcriptRunning,
    transcriptAvailable,
    setWindowChannel,
    setHostCapabilities,
    windowAvailable,
    windowKindAvailable,
    windowLine,
    windowLineSplit,
    windowRule,
    windowClear,
    windowSync,
    windowSyncOne,
    canvasRect,
    canvasLine,
    canvasText,
    canvasImage,
    canvasHotspot,
    defineImage,
    getImagePath,
    setShellChannel,
    shellSend,
    shellAvailable,
};
