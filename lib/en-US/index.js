// en-US locale pack (native implementations).
//
// English language data for the text-substitution layer: case transforms,
// articles, and list prose. This is the swappable *language* layer — a different
// locale library (en-GB, fr-FR) replaces it without touching the engine, lib/sys
// mechanism, or the world model. See devdocs/text.md (three-layer split).

function cap(s) {
    s = String(s);
    return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function upper(s) {
    return String(s).toUpperCase();
}

function lower(s) {
    return String(s).toLowerCase();
}

function title(s) {
    return String(s).replace(/\b\w/g, (c) => c.toUpperCase());
}

// World-model -> locale contract: an object exposes a display name
// (`printed_name`, else its `name`), boolean `proper` / `plural` flags, and an
// optional `plural_name`. For back-compat with lib/advent's enum-object model, an
// `article` whose `.name` is "proper"/"plural" is also honored. Reads are
// defensive, so a world model that supplies none still gets sensible output.
function display_name(x) {
    if (x && x.printed_name) return String(x.printed_name);
    return String(x && x.name != null ? x.name : x).replace(/_/g, " ");
}

function is_proper(x) {
    return Boolean(x && x.proper);
}

function is_plural(x) {
    return Boolean(x && x.plural);
}

// Naming a thing makes it the render-context subject AND switches the verb
// agreement onto it — so a following [They]/[them] refers to it and a following
// verb agrees with it: "[We] [take] [the cloak] and [drop] it" -> "You take the
// velvet cloak and drops it" (the second verb has switched to the cloak). This
// matches Inform; the author overrides it with [regarding the player] (or any
// [regarding]) to put the agreement back. note_subject() is the shared hook; it is
// a no-op outside a render. See text.md D, render-context (engine).
function note_subject(x) {
    lamplighter.renderSetSubject(x);
    lamplighter.renderSetAgreement(descriptor_of(x));
}

function the(x) {
    note_subject(x);
    const name = display_name(x);
    return is_proper(x) ? name : "the " + name;
}

function indefinite(x) {
    note_subject(x);
    const name = display_name(x);
    if (is_proper(x)) return name;
    if (is_plural(x)) return "some " + name;
    return (/^[aeiou]/i.test(name) ? "an " : "a ") + name;
}

function an(x) {
    note_subject(x);
    const name = display_name(x);
    return is_proper(x) ? name : "an " + name;
}

// Irregular plurals, keyed by the lowercase head (last) word. An author overrides
// per object with a `plural_name` field; this table is the locale default.
const IRREGULAR_PLURALS = {
    sheep: "sheep", fish: "fish", deer: "deer", moose: "moose", series: "series",
    child: "children", person: "people", man: "men", woman: "women",
    foot: "feet", tooth: "teeth", goose: "geese", mouse: "mice", ox: "oxen",
};

function pluralize_word(word) {
    const irregular = IRREGULAR_PLURALS[word.toLowerCase()];
    if (irregular) {
        // Preserve a capitalized head word ("Child" -> "Children").
        return word[0] === word[0].toUpperCase()
            ? irregular[0].toUpperCase() + irregular.slice(1)
            : irregular;
    }
    if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
    if (/(s|x|z|ch|sh)$/i.test(word)) return word + "es";
    return word + "s";
}

// Plural display name: an author-set `plural_name` wins; otherwise pluralize the
// head (last) word of the display name via the irregular table + regular rules.
function pluralize(x) {
    if (x && x.plural_name) return String(x.plural_name);
    const parts = display_name(x).split(" ");
    parts[parts.length - 1] = pluralize_word(parts[parts.length - 1]);
    return parts.join(" ");
}

// --- Adaptive pronouns and verbs (text.md D) --------------------------------
// Two distinct referents. [We]/[us]/[our]/[ours] are the PLAYER, rendered by the
// story viewpoint (person + number) — never the actor or a [regarding] target.
// [They]/[them]/[their]/[theirs]/[themself] are the render-context SUBJECT (a
// third-person referent set by [regarding] or by naming a thing). Verbs agree with
// the current "agreement" descriptor — {person, plural} — set by [We] (to the
// viewpoint), [They] (to the subject), or [regarding].

// Grammatical person of an object: the player object marks itself
// `grammatical_person 2` (you), a first-person speaker 1; default third (3).
function grammatical_person(x) {
    const p = x && x.grammatical_person;
    return p === 1 || p === 2 || p === 3 ? p : 3;
}

// Pronoun sets — the inclusive replacement for a gender enum. An object carries its
// `pronouns` as data (a preset key, or a full custom set), and the [they]/[we]
// families read the set directly, so any pronouns work — she/he/they/it and
// neopronouns alike. The preset also records whether verbs agree plural (singular
// "they" takes "they are").
const PRONOUN_PRESETS = {
    she:  { subject: "she",  object: "her",  det: "her",   pron: "hers",   reflexive: "herself",    plural: false },
    he:   { subject: "he",   object: "him",  det: "his",   pron: "his",    reflexive: "himself",    plural: false },
    they: { subject: "they", object: "them", det: "their", pron: "theirs", reflexive: "themselves", plural: true },
    it:   { subject: "it",   object: "it",   det: "its",   pron: "its",    reflexive: "itself",     plural: false },
};

// Resolve an object's `pronouns` spec to a full set: a preset key ("she"/"he"/"they"/
// "it"), or a custom slash-set "subject/object/det/pron/reflexive" (e.g.
// "xe/xem/xyr/xyrs/xemself"; verbs agree singular). Empty/unrecognized → null, so the
// caller falls back.
function resolve_pronouns(spec) {
    if (!spec) return null;
    const key = String(spec).trim().toLowerCase();
    if (PRONOUN_PRESETS[key]) return PRONOUN_PRESETS[key];
    const parts = String(spec).split("/").map((s) => s.trim());
    if (parts.length === 5 && parts.every(Boolean)) {
        return { subject: parts[0], object: parts[1], det: parts[2], pron: parts[3], reflexive: parts[4], plural: false };
    }
    return null;
}

// The pronoun set for a third-person object: its explicit `pronouns` when set, else
// "they" for a grammatically `plural` thing ("some coins are"), else "it".
function object_pronouns(x) {
    return resolve_pronouns(x && x.pronouns) || (is_plural(x) ? PRONOUN_PRESETS.they : PRONOUN_PRESETS.it);
}

// The story viewpoint: how the player is addressed. Person and number are narration
// choices (globals `viewpoint_person` 1/2/3 default 2 — "you", and `viewpoint_plural`
// default false); the third-person pronoun set is the *player object's* own
// `pronouns`, so it follows the main character. Globals are saved.
function viewpoint() {
    const p = lamplighter.getGlobal("viewpoint person");
    return {
        person: p === 1 || p === 2 || p === 3 ? p : 2,
        plural: Boolean(lamplighter.getGlobal("viewpoint plural")),
        forms: object_pronouns(lamplighter.getGlobal("player")),
    };
}

// The person/number/pronoun descriptor of an object — what a verb agrees with and
// which pronoun set surfaces. `plural` (verb agreement) comes from the pronoun set, so
// a singular "they" agrees plural.
function descriptor_of(x) {
    const forms = object_pronouns(x);
    return { person: grammatical_person(x), plural: forms.plural, forms };
}

// The pronoun set for a descriptor. First and second person are fixed (I/we, you);
// third person uses the descriptor's own set.
function pronoun_forms(d) {
    if (d.person === 1) {
        return d.plural
            ? { subject: "we", object: "us", det: "our", pron: "ours", reflexive: "ourselves" }
            : { subject: "I", object: "me", det: "my", pron: "mine", reflexive: "myself" };
    }
    if (d.person === 2) {
        return { subject: "you", object: "you", det: "your", pron: "yours", reflexive: d.plural ? "yourselves" : "yourself" };
    }
    return d.forms;
}

// Player pronouns (viewpoint). [We] also sets the verb agreement to the viewpoint,
// so a following bare verb conjugates for the player; the object/possessive forms
// only read, leaving agreement alone.
function viewpoint_forms() { return pronoun_forms(viewpoint()); }
// [We]/[we]: the player as subject. Verbs agree with the viewpoint. In a *named* third-person
// viewpoint (`viewpoint_named`), the first reference in a render emits the player's name ("Galaxy")
// and the render-context flag makes later references in that same render fall back to the pronoun
// ("she"); the object/possessive forms (us/our/ours) always pronominalize.
function we() {
    const vp = viewpoint();
    lamplighter.renderSetAgreement(vp);
    if (vp.person === 3 && lamplighter.getGlobal("viewpoint named") && !lamplighter.renderViewpointNamed()) {
        lamplighter.renderSetViewpointNamed(true);
        // A dedicated narration name (`viewpoint_name`) lets the player's display name stay the full
        // identification name (e.g. "Galaxy Jones") while narration uses a short form ("Galaxy").
        const vpName = lamplighter.getGlobal("viewpoint name");
        if (vpName) return String(vpName);
        return display_name(lamplighter.getGlobal("player"));
    }
    return viewpoint_forms().subject;
}
function us() { return viewpoint_forms().object; }
function our() { return viewpoint_forms().det; }
function ours() { return viewpoint_forms().pron; }

// Subject (third-person) pronouns. Absent a subject, a neutral third-person
// singular ("it"). [They] sets the agreement to the subject; the others only read.
function subject_descriptor() {
    const s = lamplighter.renderSubject();
    return s == null ? { person: 3, plural: false, forms: PRONOUN_PRESETS.it } : descriptor_of(s);
}
function subject_forms() { return pronoun_forms(subject_descriptor()); }
function they() { lamplighter.renderSetAgreement(subject_descriptor()); return subject_forms().subject; }
function them() { return subject_forms().object; }
function their() { return subject_forms().det; }
function theirs() { return subject_forms().pron; }
function themself() { return subject_forms().reflexive; }

// [regarding EXPR] sets the third-person subject and makes following verbs agree
// with it; renders empty. Same hook as naming a thing — the explicit override the
// author reaches for when auto-switching put the agreement on the wrong thing.
function regarding(x) {
    note_subject(x);
    return "";
}

// [those] — the demonstrative that agrees in number with the context subject (set by
// [regarding X] or by naming a thing): "those" when plural, "that" otherwise. Reads the
// agreement descriptor like the verb/pronoun family; falls back to singular ("that").
function those() {
    const agreement = lamplighter.renderAgreement() || viewpoint();
    return agreement.plural ? "those" : "that";
}

// Verb conjugation. The be/have/do/go auxiliaries are irregular (am/is/are,
// has/have, does/do, goes/go); every other verb is regular (base form, with the
// third-person singular adding -s/-es/-ies). The author writes any inflected form
// in a template (`[are]`, `[has]`) — VERB_LEMMAS maps it back to the lemma.
const IRREGULAR_VERBS = {
    be: { first: "am", second: "are", third: "is", plural: "are", base: "are" },
    have: { third: "has", base: "have" },
    do: { third: "does", base: "do" },
    go: { third: "goes", base: "go" },
};

const VERB_LEMMAS = {
    is: "be", are: "be", am: "be", be: "be", was: "be", were: "be",
    has: "have", have: "have", does: "do", do: "do", goes: "go", go: "go",
};

function regular_third(word) {
    if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + "ies";
    if (/(s|x|z|ch|sh|o)$/i.test(word)) return word + "es";
    return word + "s";
}

function conjugate(word) {
    // The agreement descriptor is set by [We]/[They]/[regarding]; absent any, a
    // verb agrees with the player (the viewpoint), the implicit narrator subject.
    const agreement = lamplighter.renderAgreement() || viewpoint();
    const person = agreement.person;
    const plural = Boolean(agreement.plural);
    const thirdSingular = person === 3 && !plural;
    const lemma = VERB_LEMMAS[word.toLowerCase()] || word.toLowerCase();
    const irregular = IRREGULAR_VERBS[lemma];
    if (irregular) {
        if (lemma === "be") {
            if (plural) return irregular.plural;
            if (person === 1) return irregular.first;
            if (person === 2) return irregular.second;
            return irregular.third;
        }
        return thirdSingular ? irregular.third : irregular.base;
    }
    return thirdSingular ? regular_third(word) : word;
}

// List prose. Moved here from lib/sys: the conjunction "and" and the serial
// (Oxford) comma are English. The Oxford comma is the author-settable
// `oxford_comma` global (set `oxford_comma = true` in a game to enable it).
function format_list(strings) {
    // Accept either a Lamp list value (the Lamp-facing `format_list(list<string>)`)
    // or a plain array (a_list/the_list pass the already-articled array); listItems
    // passes a raw array through unchanged.
    const arr = lamplighter.listItems(strings);
    if (arr.length === 0) return "nothing";
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr[0] + " and " + arr[1];
    const conjunction = lamplighter.getGlobal("oxford comma") ? ", and " : " and ";
    return arr.slice(0, -1).join(", ") + conjunction + arr[arr.length - 1];
}

lamplighter.setListFormatter(format_list);

// The nested-contents parenthetical (text.md G / nested listings): "(in which is
// a marble)" for a container, "(on which are ...)" for a supporter. The relative
// clause's preposition follows the container's `supporter` flag; the copula
// agrees with the item count via are(). Language assembly, so it lives here and
// not in the world model; the leading space lets it append after the head name.
function contained_phrase(container, inner, count) {
    const prep = container && container.supporter ? "on" : "in";
    return " (" + prep + " which " + are(count) + " " + inner + ")";
}

// Locale prose for a scenery supporter's visible contents — "On the hook is a
// cloak." / "On the shelf are a ball and a trumpet." Assembled in the locale (not
// the world model) so it localizes; advent's describe_supporters calls it with
// the supporter and the items resting on it.
function supporter_phrase(supporter, contents) {
    const items = lamplighter.listItems(contents);
    const verb = items.length === 1 ? "is" : "are";
    return "On " + the(supporter) + " " + verb + " " + format_list(items.map(indefinite)) + ".";
}

// Article-prefixed list rendering (G1) and the empty test (G6). a_list / the_list
// run each element through the indefinite / definite article, then the serial-comma
// formatter; an empty list yields "nothing" (format_list's empty word).
function a_list(xs) {
    return format_list(lamplighter.listItems(xs).map(indefinite));
}

function the_list(xs) {
    return format_list(lamplighter.listItems(xs).map(the));
}

function is_empty(xs) {
    return lamplighter.listItems(xs).length === 0;
}

// Count-driven copula agreement (G3). are(n) agrees by the grammatical number of a
// raw count: singular only when n is exactly 1 ("is 1 bullet" / "are 0 bullets" /
// "are 3 bullets"). The [is LIST] sugar uses the list-specific rule instead — an
// empty list is singular because it prints "nothing" ("is nothing"), so the verb is
// "is" for size 0 or 1 and "are" for 2+. The three list forms prefix that verb to
// the list rendered with no / definite / indefinite articles.
function are(n) {
    return Number(n) === 1 ? "is" : "are";
}

function list_copula(size) {
    return size <= 1 ? "is" : "are";
}

function is_are_list(xs) {
    const items = lamplighter.listItems(xs);
    return list_copula(items.length) + " " + format_list(items.map(display_name));
}

function is_are_the_list(xs) {
    return list_copula(lamplighter.listItems(xs).length) + " " + the_list(xs);
}

function is_are_a_list(xs) {
    return list_copula(lamplighter.listItems(xs).length) + " " + a_list(xs);
}

// Numbers in words (G4), American English (no "and"). in_words(1234) ->
// "one thousand two hundred thirty-four".
const NUMBER_ONES = [
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
];
const NUMBER_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const NUMBER_SCALES = [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]];

function in_words(n) {
    n = Math.trunc(Number(n));
    if (!Number.isFinite(n)) return String(n);
    if (n < 0) return "minus " + in_words(-n);
    if (n < 20) return NUMBER_ONES[n];
    if (n < 100) {
        const r = n % 10;
        return NUMBER_TENS[Math.floor(n / 10)] + (r ? "-" + NUMBER_ONES[r] : "");
    }
    if (n < 1000) {
        const r = n % 100;
        return NUMBER_ONES[Math.floor(n / 100)] + " hundred" + (r ? " " + in_words(r) : "");
    }
    for (const [value, name] of NUMBER_SCALES) {
        if (n >= value) {
            const r = n % value;
            return in_words(Math.floor(n / value)) + " " + name + (r ? " " + in_words(r) : "");
        }
    }
    return NUMBER_ONES[0];
}

// Ordinals (G4): ordinalize the last word of the cardinal — "twenty-one" ->
// "twenty-first", "one hundred" -> "one hundredth".
const ORDINAL_IRREGULAR = {
    one: "first", two: "second", three: "third", five: "fifth",
    eight: "eighth", nine: "ninth", twelve: "twelfth",
};

function ordinal_word(word) {
    if (ORDINAL_IRREGULAR[word]) return ORDINAL_IRREGULAR[word];
    if (/y$/.test(word)) return word.slice(0, -1) + "ieth";
    return word + "th";
}

function ordinal(n) {
    const words = in_words(n);
    const cut = Math.max(words.lastIndexOf(" "), words.lastIndexOf("-"));
    return cut === -1
        ? ordinal_word(words)
        : words.slice(0, cut + 1) + ordinal_word(words.slice(cut + 1));
}

// Plural suffix (G7): the `[s]` sugar's target. Returns the word's plural via the
// K5 pluralizer unless the governing count (the most recently interpolated number)
// is exactly 1. A null count (no number interpolated) reads as plural, matching
// Inform's "[s] prints 's' unless the count is 1".
function plural_suffix(word) {
    return lamplighter.renderCount() === 1 ? word : pluralize_word(word);
}

// Grouped/qualified lists (G5): collapse indistinguishable objects — same display
// name — into one counted entry, preserving first-seen order. A singleton keeps its
// article (indefinite for a_group, definite for the_group); a group of n renders the
// count in words plus the plural name ("two brass lanterns"). The grouped entries
// then run through the ordinary serial-comma formatter.
function group_entries(xs, singletonArticle, groupPrefix) {
    const groups = [];
    const indexByName = new Map();
    for (const item of lamplighter.listItems(xs)) {
        const key = display_name(item);
        if (indexByName.has(key)) {
            groups[indexByName.get(key)].count += 1;
        } else {
            indexByName.set(key, groups.length);
            groups.push({ rep: item, count: 1 });
        }
    }
    return groups.map((g) => (g.count === 1
        ? singletonArticle(g.rep)
        : groupPrefix + in_words(g.count) + " " + pluralize(g.rep)));
}

function a_group(xs) {
    return format_list(group_entries(xs, indefinite, ""));
}

function the_group(xs) {
    return format_list(group_entries(xs, the, "the "));
}

// --- Parser language (installed into the engine) ----------------------------
// The Game Parser's noun-phrase vocabulary and its failure/disambiguation prose
// are language data, so they live here, not in the runtime (which holds only
// neutral fallbacks). Installed via setParserLanguage, mirroring setListFormatter.
// The disambiguation prompt renders each candidate through `the()`, so proper
// names take no article ("Alice") and ordinary ones do ("the alice band").
function disambiguation_prompt(candidates) {
    const names = lamplighter.listItems(candidates).map((o) => the(o));
    if (names.length === 2) {
        return `Which do you mean: ${names[0]} or ${names[1]}?`;
    }
    const last = names[names.length - 1];
    return `Which do you mean: ${names.slice(0, -1).join(", ")}, or ${last}?`;
}

lamplighter.setParserLanguage({
    articles: ["a", "an", "the", "some"],
    pronouns: ["it"],
    selfWords: ["me", "myself"],
    disambiguation: disambiguation_prompt,
    unknownReference: (word) => `I don't know what "${word}" refers to.`,
});
