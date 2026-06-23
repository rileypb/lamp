// decode reverses Lantern's optional build-time string encoding (--encode-strings);
// the emitter wraps player-facing literals as lamplighter.decode("..."). The same
// reversible codec (encode) also obfuscates save files. See src/strcodec.js.
const { encode: encodeText, decode } = require("../strcodec");

const typeRegistry = new Map();
// World objects only. Relation edges live in relationInstanceRegistry so that
// world-iterating consumers (scopeOf, buildVocabIndex) never walk graph edges.
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
//   - field `holder`     — an object's container. scopeOf walks reachability over
//                          it; an object with no `holder` is out of scope.
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
// The commanding actor is NOT in this contract — it is passed into run_command
// explicitly (no `player` global is assumed). Each site that depends on a contract
// name is tagged "world-model contract" below.

// All game output flows through the output-stream manager (paragraph control,
// text.md H) to this raw sink, which owns newlines. The sandbox worker swaps it for
// a message poster via setWrite; print no longer has its own channel.
let writeImpl = (value) => {
    process.stdout.write(String(value));
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

function collectDefaults(typeName) {
    const typeInfo = typeRegistry.get(typeName);
    if (!typeInfo) return {};
    const result = {};
    for (const parent of typeInfo.parents) {
        Object.assign(result, collectDefaults(parent));
    }
    Object.assign(result, typeInfo.defaults);
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
function defineRelation(name, fields, syntaxTemplate = null, invertedFields = [], sourceField = "source", targetField = "target") {
    defineType(name, [], fields);
    instanceRegistry.delete(name);
    relationInstanceRegistry.set(name, []);
    relationRegistry.set(name, {
        name,
        fields: { ...fields },
        syntax: syntaxTemplate,
        invertedFields: [...invertedFields],
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
// and the actor's own contents, plus anything transitively held by those objects
// (items resting on surfaces, contents of containers, etc.), via `holder`.
// World-model contract: reachability is computed over the `holder` field.
function scopeOf(actor) {
    const location = actor.holder;
    const inScope = new Set();

    for (const instances of instanceRegistry.values()) {
        for (const inst of instances) {
            if (inst.holder === location || inst.holder === actor) {
                inScope.add(inst);
            }
        }
    }

    // Expand to fixpoint: if an item's holder is in scope, the item is too.
    let changed = true;
    while (changed) {
        changed = false;
        for (const instances of instanceRegistry.values()) {
            for (const inst of instances) {
                if (!inScope.has(inst) && inst.holder && inScope.has(inst.holder)) {
                    inScope.add(inst);
                    changed = true;
                }
            }
        }
    }

    return [...inScope];
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

const ARTICLES = new Set(["a", "an", "the", "some"]);

// Pronouns the player may use in place of a noun. v1 supports only "it"
// (him/her/them are deferred — see devdocs/game_parser.md). A pronoun span
// resolves to the antecedent tracked in `pronounIt`, not via the vocab index.
const PRONOUNS = new Set(["it"]);

// The antecedent for "it": the last single object the player referred to.
// Updated whenever a noun phrase binds to exactly one physical object.
let pronounIt = null;

// "it" refers to things in the world, not to non-physical referents such as
// directions, so only physical objects become antecedents. A game without a
// `physical` type treats every object as eligible (matching resolvePool).
// World-model contract: antecedent eligibility is gated on the `physical` type.
function canBeAntecedent(obj) {
    if (!typeRegistry.has("physical")) return true;
    return isTypeOrSubtype(obj.type, "physical");
}

function noteAntecedent(obj) {
    if (canBeAntecedent(obj)) pronounIt = obj;
}

// The player's phrase tokens for a noun span: the span with leading/internal
// articles dropped (but never reduced to nothing — a bare article stays).
function strippedPhraseTokens(span) {
    const stripped = span.filter((t) => !ARTICLES.has(t));
    return stripped.length > 0 ? stripped : span;
}

// The pronoun word if `span` is exactly one pronoun (e.g. "it"), else null.
function pronounOf(span) {
    const tokens = strippedPhraseTokens(span);
    return tokens.length === 1 && PRONOUNS.has(tokens[0]) ? tokens[0] : null;
}

// A pronoun used among `spans` that has no antecedent yet, else null. This is
// the "never bound" case — distinct from a bound pronoun whose referent has
// left scope (pronounIt is set) — so it gets its own message.
function unboundPronounIn(spans) {
    if (pronounIt) return null;
    for (const span of spans) {
        const word = pronounOf(span);
        if (word) return word;
    }
    return null;
}

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
    const phraseTokens = strippedPhraseTokens(span);
    const scopeSet = new Set(scope);
    if (pronounOf(span)) {
        if (pronounIt && scopeSet.has(pronounIt) && (!slotType || isTypeOrSubtype(pronounIt.type, slotType))) {
            return [pronounIt];
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

// Resolve [field, span] slot pairs onto `instance`. Returns one of:
//   "ok"          — every slot filled with a single candidate.
//   "ambiguous"   — a slot matched multiple candidates; a disambiguation prompt
//                   was shown and pendingDisambiguation set (terminal — a match
//                   awaiting clarification, not a failure).
//   "unresolved"  — a slot had no candidate. No message is printed: the caller
//                   decides whether to backtrack to another grammar or report
//                   the failure, so overlapping syntaxes (e.g. `go [way]` vs
//                   `go to [room]`) can each get a chance to match.
function resolveSlots(slots, instance, scope, slotTypes) {
    const directSlot = (typeRegistry.get(instance.type) || {}).directSlot || null;
    for (let i = 0; i < slots.length; i++) {
        const [field, span] = slots[i];
        const candidates = resolveCandidates(span, resolvePool(slotTypes[field], scope), slotTypes[field]);
        if (candidates.length === 0) {
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
            };
            return "ambiguous";
        }
    }
    return "ok";
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

function runCommand(line, actor) {
    lastCommand = String(line).trim();
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
            const directSlotForDisambig = (typeRegistry.get(actionName) || {}).directSlot || null;
            if (field === directSlotForDisambig) noteAntecedent(narrowed[0]);
            const status = resolveSlots(remainingSlots, instance, scope, slotTypes);
            if (status === "ok") {
                runAction(actionName, instance);
            } else if (status === "unresolved") {
                // Already committed to this action — no backtracking here.
                const unbound = unboundPronounIn(remainingSlots.map(([, span]) => span));
                print(unbound ? `I don't know what "${unbound}" refers to.` : "You can't see any such thing.");
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

    // Out-of-world verbs (undo; later save/restore) bypass the turn and take no
    // checkpoint. Otherwise checkpoint the pre-turn state so `undo` can revert
    // this command. See devdocs/state.md.
    if (tokens.length === 1 && outOfWorldCommands.has(tokens[0])) {
        outOfWorldCommands.get(tokens[0])();
        return;
    }
    checkpoint();
    advanceTurn();

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
    const unresolvedSpans = [];
    for (const entry of grammarRegistry) {
        const matched = matchGrammar(entry.parts, tokens);
        if (!matched) continue;
        const scope = scopeOf(actor);
        const slotTypes = (typeRegistry.get(entry.actionName) || {}).fields || {};
        const instance = { type: entry.actionName, action: entry.actionName, actor };
        const status = resolveSlots(Object.entries(matched), instance, scope, slotTypes);
        if (status === "ok") {
            runAction(entry.actionName, instance);
            return;
        }
        if (status === "ambiguous") {
            return;
        }
        unresolvedSpans.push(...Object.values(matched));
        if (entry.parts.some((part) => part.kind === "literal")) {
            sawVerbMatch = true;
        }
    }
    // An unbound pronoun (the player said "it" before referring to anything) gets
    // its own message ahead of the generic scope/grammar failures.
    const unbound = unboundPronounIn(unresolvedSpans);
    if (unbound) {
        print(`I don't know what "${unbound}" refers to.`);
        return;
    }
    print(sawVerbMatch ? "You can't see any such thing." : "I don't understand that.");
}

// World-model contract: fires the `startup` event, which the world library hooks
// to build the world and drive the command loop.
function run() {
    pronounIt = null;
    buildVocabIndex();
    fireEvent("startup");
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
// are orthogonal to the break sentinels above. PUA block \uE010-\uE015.
const STYLE_ORDER = ["bold", "italic", "fixed"];
const STYLE_PUSH_CHAR = { bold: "\uE010", italic: "\uE012", fixed: "\uE014" };
const STYLE_POP_CHAR = { bold: "\uE011", italic: "\uE013", fixed: "\uE015" };
const STYLE_PUSH_BY_CHAR = { "\uE010": "bold", "\uE012": "italic", "\uE014": "fixed" };
const STYLE_POP_BY_CHAR = { "\uE011": "bold", "\uE013": "italic", "\uE015": "fixed" };

// Any in-band control char (breaks or style push/pop) \u2014 the fast-path test that
// lets a plain run skip the char-by-char scan.
const STREAM_CONTROL = /[\uE000-\uE003\uE010-\uE015]/;

const styleDepth = { bold: 0, italic: 0, fixed: 0 };

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
            writeImpl("\n".repeat(need));
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
    writeImpl(run, styles && styles.length ? styles : undefined);
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

// Player input is a brokered host capability. The host owns stdin and the worker
// installs an input channel via setInputChannel; readLine blocks on that channel.
// A game run outside the sandbox has no channel and cannot read input — the
// sandbox launcher is the only supported run path. See devdocs/sandbox.md.
let requestLineImpl = null;
let promptLineImpl = null;

function setInputChannel(requestLine) {
    requestLineImpl = requestLine;
}

function setPromptChannel(requestPromptLine) {
    promptLineImpl = requestPromptLine;
}

function readLine() {
    if (!requestLineImpl) {
        throw new Error("no input channel installed; run the game through the sandbox launcher");
    }
    streamFlushPending();
    const line = requestLineImpl();
    streamNoteInputLine();
    return line;
}

// Like readLine but also writes `promptText` to the output before blocking,
// and echoes the input line in piped/non-TTY mode. Use this instead of
// write()+readLine() for interactive prompts.
function promptLine(promptText) {
    if (!promptLineImpl) {
        throw new Error("no prompt channel installed; run the game through the sandbox launcher");
    }
    streamFlushPending();
    const line = promptLineImpl(promptText);
    streamNoteInputLine();
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
    renderContextStack.push({ subject: null, agreement: null, count: null });
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
        // display only (the registry key stays `name`). See devdocs/text.md B2.
        const printed = value.printed_name;
        return typeof printed === "string" && printed.length > 0 ? printed : value.name;
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
    // A `text` thunk is a transient/computed value, not a member of the closed
    // save algebra (like a function). Freeze it to its current rendered string at
    // capture, so a field holding a template is still saveable. For Slice 1 (no
    // context-dependent substitution) this is lossless. See devdocs/state.md.
    if (isTextValue(value)) return renderTextValue(value);
    if (isListValue(value)) return { $list: value.items.map(encodeValue) };
    if (typeof value === "object") {
        if (typeof value.name === "string" && nameRegistry.get(value.name) === value) {
            return { $ref: value.name };
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
        fields[key] = encodeValue(record[key]);
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
        for (const [name, value] of globalRegistry) out[name] = encodeValue(value);
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
        return pronounIt ? pronounIt.name : null;
    },
    restore(data) {
        pronounIt = data ? (nameRegistry.get(data) ?? null) : null;
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
function performUndo() {
    if (undoStack.length === 0) {
        print("You can't undo any further.");
        return;
    }
    restoreState(undoStack.pop());
    print("[Previous turn undone.]");
}

// Out-of-world verbs bypass the turn clock and take no undo checkpoint. An
// interim hook until parser-v2 out-of-world actions land; `undo` is the first.
const outOfWorldCommands = new Map();
function registerOutOfWorld(word, handler) {
    outOfWorldCommands.set(word, handler);
}
registerOutOfWorld("undo", performUndo);

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
// unobfuscated metadata sidecar (see performSave); read(key) returns text or null.
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

function performSave() {
    if (!saveChannel) {
        print("Saving isn't available here.");
        return;
    }
    const slot = promptLine("Name for saved game: ");
    if (!slot || !slot.trim()) {
        print("Save cancelled.");
        return;
    }
    try {
        const save = captureSave();
        // Obfuscate the blob so a casual peeker can't read or hand-edit the save.
        // Same reversible XOR+base64 codec as --encode-strings: it discourages
        // snooping, it is not security (the key ships in the runtime).
        // The metadata rides alongside *unobfuscated* so a save picker can label
        // slots without decoding the blob (devdocs/sandbox.md → "Save/restore
        // broker protocol"): name is the player's slot name (the faithful display
        // label, not the sanitized key), savedAt mirrors the blob header, turns is
        // the count at save time.
        const meta = { name: slot.trim(), savedAt: save.savedAt, turns: turnsTaken() };
        saveChannel.write(saveSlotKey(slot), encodeText(JSON.stringify(save)), meta);
        print("Game saved.");
    } catch (err) {
        print("Save failed.");
    }
}

function performRestore() {
    if (!saveChannel) {
        print("Restoring isn't available here.");
        return;
    }
    const slot = promptLine("Name of saved game: ");
    if (!slot || !slot.trim()) {
        print("Restore cancelled.");
        return;
    }
    const stored = saveChannel.read(saveSlotKey(slot));
    if (stored == null) {
        print("There is no saved game by that name.");
        return;
    }
    let save;
    try {
        save = JSON.parse(decode(stored));
    } catch (err) {
        print("That saved game is corrupted.");
        return;
    }
    const result = restoreSave(save);
    if (result.ok) {
        print("Game restored.");
    } else if (result.reason === "game") {
        print("That saved game is for a different game.");
    } else if (result.reason === "version") {
        print("That saved game is from a different version of this game.");
    } else {
        print("That saved game is in an unrecognized format.");
    }
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

registerOutOfWorld("save", performSave);
registerOutOfWorld("restore", performRestore);

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
    renderTemplate,
    makeText,
    renderText,
    renderSubject,
    renderSetSubject,
    renderAgreement,
    renderSetAgreement,
    renderCount,
    renderSetCount,
    interp,
    variationAdvance,
    variationPick,
    pick,
    seedRandom,
    randomizeRng,
    divide,
    onEvent,
    registerActionRule,
    runAction,
    registerRulebookRule,
    runRulebook,
    HALT,
    registerGrammar,
    setDirectSlot,
    runCommand,
    playerCommand,
    registerChangeHandler,
    registerRelationAddHandler,
    registerRelationRemoveHandler,
    setField,
    dispatch: fireEvent,
    run,
    print,
    write,
    setWrite,
    outputMarker,
    styled,
    flushOutput,
    setPromptChannel,
    promptLine,
    setInputChannel,
    readLine,
    error,
    makeList,
    listItems,
    setListFormatter,
    decode,
    captureState,
    restoreState,
    registerStateProvider,
    advanceTurn,
    turnsTaken,
    registerOutOfWorld,
    clearUndoHistory,
    setBuildId,
    getBuildId,
    captureSave,
    restoreSave,
    setSaveChannel,
    listSaves,
};
