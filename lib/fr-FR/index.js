// fr-FR locale pack (native implementations).
//
// French language data for the text-substitution layer: case transforms,
// gendered articles with elision, French list prose and number words. A worked
// translation of lib/en-US, selected at compile time (--locale fr-FR or a
// `locale "fr-FR"` declaration). See devdocs/i18n.md and devdocs/text.md.

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

// World-model -> locale contract (identical to lib/en-US): display name from
// `printed_name` else `name`; `proper`/`plural` flags (also honored on an
// `article` enum object for advent back-compat), plus `pronouns` (the free-text
// pronoun set, as in en-US). French additionally reads a `grammatical_gender` field
// ("feminine"/"masculine"; default masculine) for article agreement — a language
// property of the noun, distinct from `pronouns`.
function display_name(x) {
    if (x && x.printed_name) return String(x.printed_name);
    return String(x && x.name != null ? x.name : x).replace(/_/g, " ");
}

function is_proper(x) {
    return Boolean(x && (x.proper || (x.article && x.article.name === "proper")));
}

function is_plural(x) {
    return Boolean(x && (x.plural || (x.article && x.article.name === "plural")));
}

function is_feminine(x) {
    // Grammatical gender for article/agreement (the noun's language property, distinct
    // from `pronouns`) — carried on `grammatical_gender`.
    const g = x && x.grammatical_gender;
    return g === "feminine" || g === "female" || g === "f";
}

// Elision: le/la contract to l' before a vowel or (approximated) h. The mute vs
// aspirated h distinction is lexical and not modeled here — all h elides, which
// is correct for the common case (l'hôtel) and wrong for a few aspirated words
// (le héros). Accented vowels count.
function elides(name) {
    return /^[aeiouàâäéèêëîïôöûüùAEIOUÀÂÄÉÈÊËÎÏÔÖÛÜÙhH]/.test(name);
}

function note_subject(x) {
    lamplighter.renderSetSubject(x);
    lamplighter.renderSetAgreement(descriptor_of(x));
}

function the(x) {
    note_subject(x);
    const name = display_name(x);
    if (is_proper(x)) return name;
    if (is_plural(x)) return "les " + name;
    if (elides(name)) return "l'" + name;
    return (is_feminine(x) ? "la " : "le ") + name;
}

function indefinite(x) {
    note_subject(x);
    const name = display_name(x);
    if (is_proper(x)) return name;
    if (is_plural(x)) return "des " + name;
    return (is_feminine(x) ? "une " : "un ") + name;
}

// French has no separate "an"; `[an X]` falls back to the indefinite.
function an(x) {
    return indefinite(x);
}

// French plural of a head word: -s/-x/-z invariable; -au/-eau/-eu add -x; -al
// becomes -aux; otherwise add -s. (Lexical exceptions exist; this is the regular
// rule, as the en-US pack likewise covers the regular cases.)
function pluralize_word(word) {
    if (/(s|x|z)$/i.test(word)) return word;
    if (/(au|eu)$/i.test(word)) return word + "x";
    if (/al$/i.test(word)) return word.slice(0, -2) + "aux";
    return word + "s";
}

function pluralize(x) {
    if (x && x.plural_name) return String(x.plural_name);
    const parts = display_name(x).split(" ");
    parts[parts.length - 1] = pluralize_word(parts[parts.length - 1]);
    return parts.join(" ");
}

// --- Adaptive pronouns and verbs --------------------------------------------
// Parallel to lib/en-US, with French forms. The player viewpoint defaults to
// "vous" (grammatical person 2). French verb conjugation is out of scope (see
// conjugate); a translation pack spells verbs out in its overrides.

function grammatical_person(x) {
    const p = x && x.grammatical_person;
    return p === 1 || p === 2 || p === 3 ? p : 3;
}

// Pronoun sets — parallel to lib/en-US, with French forms. An object carries its
// `pronouns` (a preset key or a full custom set), read by the [they]/[we] families, so
// il/elle/iel and custom neopronouns all render. When `pronouns` is empty, the set
// falls back to grammatical gender + number (il/elle/ils/elles) — so a game that sets
// only `grammatical_gender` is unchanged.
const PRONOUN_PRESETS = {
    il:    { subject: "il",    object: "le",  det: "son",  pron: "le sien", reflexive: "se", plural: false },
    elle:  { subject: "elle",  object: "la",  det: "sa",   pron: "le sien", reflexive: "se", plural: false },
    ils:   { subject: "ils",   object: "les", det: "leur", pron: "le leur", reflexive: "se", plural: true },
    elles: { subject: "elles", object: "les", det: "leur", pron: "le leur", reflexive: "se", plural: true },
    // iel: the recognized French nonbinary pronoun. Its non-subject forms are still
    // emerging; a game needing different ones supplies a full custom set.
    iel:   { subject: "iel",   object: "iel", det: "son",  pron: "le sien", reflexive: "se", plural: false },
};

// Resolve a `pronouns` spec: a preset key (il/elle/iel/…) or a custom slash-set
// "subject/object/det/pron/reflexive". Empty/unrecognized → null (caller falls back).
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

// The pronoun set for a third-person object: its explicit `pronouns`, else derived from
// grammatical gender + number (the noun's language property) — il/elle/ils/elles.
function object_pronouns(x) {
    const explicit = resolve_pronouns(x && x.pronouns);
    if (explicit) return explicit;
    const fem = is_feminine(x);
    if (is_plural(x)) return fem ? PRONOUN_PRESETS.elles : PRONOUN_PRESETS.ils;
    return fem ? PRONOUN_PRESETS.elle : PRONOUN_PRESETS.il;
}

// Person/number are narration globals; the third-person pronoun set is the player
// object's own `pronouns` (else its grammatical gender), so it tracks the main character.
function viewpoint() {
    const p = lamplighter.getGlobal("viewpoint person");
    return {
        person: p === 1 || p === 2 || p === 3 ? p : 2,
        plural: Boolean(lamplighter.getGlobal("viewpoint plural")),
        forms: object_pronouns(lamplighter.getGlobal("player")),
    };
}

function descriptor_of(x) {
    const forms = object_pronouns(x);
    return { person: grammatical_person(x), plural: forms.plural, forms };
}

// First and second person are fixed (je/nous, tu/vous); third person uses the
// descriptor's own set.
function pronoun_forms(d) {
    if (d.person === 1) {
        return d.plural
            ? { subject: "nous", object: "nous", det: "notre", pron: "le nôtre", reflexive: "nous" }
            : { subject: "je", object: "me", det: "mon", pron: "le mien", reflexive: "me" };
    }
    if (d.person === 2) {
        return d.plural
            ? { subject: "vous", object: "vous", det: "votre", pron: "le vôtre", reflexive: "vous" }
            : { subject: "tu", object: "te", det: "ton", pron: "le tien", reflexive: "te" };
    }
    return d.forms;
}

function viewpoint_forms() { return pronoun_forms(viewpoint()); }
// Named third-person viewpoint (viewpoint_named): first [We] in a render emits the player's name,
// later references pronominalize. Parallel to lib/en-US.
function we() {
    const vp = viewpoint();
    lamplighter.renderSetAgreement(vp);
    if (vp.person === 3 && lamplighter.getGlobal("viewpoint named") && !lamplighter.renderViewpointNamed()) {
        lamplighter.renderSetViewpointNamed(true);
        const vpName = lamplighter.getGlobal("viewpoint name");
        if (vpName) return String(vpName);
        return display_name(lamplighter.getGlobal("player"));
    }
    return viewpoint_forms().subject;
}
function us() { return viewpoint_forms().object; }
function our() { return viewpoint_forms().det; }
function ours() { return viewpoint_forms().pron; }

function subject_descriptor() {
    const s = lamplighter.renderSubject();
    return s == null ? { person: 3, plural: false, forms: PRONOUN_PRESETS.il } : descriptor_of(s);
}
function subject_forms() { return pronoun_forms(subject_descriptor()); }
function they() { lamplighter.renderSetAgreement(subject_descriptor()); return subject_forms().subject; }
function them() { return subject_forms().object; }
function their() { return subject_forms().det; }
function theirs() { return subject_forms().pron; }
function themself() { return subject_forms().reflexive; }

function regarding(x) {
    note_subject(x);
    return "";
}

// French conjugation is not modeled in this worked pack: a translation pack
// writes the conjugated verb directly in its override, so this returns the word
// unchanged. The verb vocabulary in functions.lamp exists only to keep a world
// model's English default templates (`[take]`) parsing under this locale.
function conjugate(word) {
    return word;
}

// List prose. French joins with " et " and does not use a serial comma:
// "a et b", "a, b et c"; an empty list is "rien".
function format_list(strings) {
    const arr = lamplighter.listItems(strings);
    if (arr.length === 0) return "rien";
    if (arr.length === 1) return arr[0];
    if (arr.length === 2) return arr[0] + " et " + arr[1];
    return arr.slice(0, -1).join(", ") + " et " + arr[arr.length - 1];
}

lamplighter.setListFormatter(format_list);

// The nested-contents parenthetical, in French: "(dans laquelle se trouve une
// bille)". The preposition follows the container's `supporter` flag (sur vs
// dans); the relative pronoun agrees in gender with the container (lequel /
// laquelle); the verb "se trouve(nt)" agrees with the item count. The leading
// space lets it append after the container's name.
function contained_phrase(container, inner, count) {
    const prep = container && container.supporter ? "sur" : "dans";
    const pronoun = is_feminine(container) ? "laquelle" : "lequel";
    const verb = Number(count) === 1 ? "se trouve" : "se trouvent";
    return " (" + prep + " " + pronoun + " " + verb + " " + inner + ")";
}

// French prose for a scenery supporter's visible contents — "Sur la table se
// trouve un livre." / "Sur l'étagère se trouvent une balle et une trompette." The
// definite article agrees in gender and elides (the/le/la handled by the()); the
// verb agrees with the item count.
function supporter_phrase(supporter, contents) {
    const items = lamplighter.listItems(contents);
    const verb = items.length === 1 ? "se trouve" : "se trouvent";
    return "Sur " + the(supporter) + " " + verb + " " + format_list(items.map(indefinite)) + ".";
}

function a_list(xs) {
    return format_list(lamplighter.listItems(xs).map(indefinite));
}

function the_list(xs) {
    return format_list(lamplighter.listItems(xs).map(the));
}

function is_empty(xs) {
    return lamplighter.listItems(xs).length === 0;
}

// Copula agreement: "est" for exactly one, else "sont". The list sugar treats an
// empty list as singular ("est rien"), matching the en-US "is nothing" rule.
function are(n) {
    return Number(n) === 1 ? "est" : "sont";
}

function list_copula(size) {
    return size <= 1 ? "est" : "sont";
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

// Numbers in words (metropolitan French: soixante-dix / quatre-vingts /
// quatre-vingt-dix; "et un" at 21..61 and 71; no liaison "et" at 81/91).
const FR_ONES = [
    "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf",
    "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize",
    "dix-sept", "dix-huit", "dix-neuf",
];
const FR_TENS = { 20: "vingt", 30: "trente", 40: "quarante", 50: "cinquante", 60: "soixante" };

function fr_under_hundred(n) {
    if (n < 20) return FR_ONES[n];
    if (n < 70) {
        const tens = FR_TENS[Math.floor(n / 10) * 10];
        const r = n % 10;
        if (r === 0) return tens;
        if (r === 1) return tens + " et un";
        return tens + "-" + FR_ONES[r];
    }
    if (n < 80) {
        const r = n - 60;
        if (r === 11) return "soixante et onze";
        return "soixante-" + FR_ONES[r];
    }
    const r = n - 80;
    if (r === 0) return "quatre-vingts";
    return "quatre-vingt-" + FR_ONES[r];
}

function fr_under_thousand(n) {
    if (n < 100) return fr_under_hundred(n);
    const h = Math.floor(n / 100);
    const r = n % 100;
    const hundred = h === 1 ? "cent" : FR_ONES[h] + (r === 0 ? " cents" : " cent");
    return r === 0 ? hundred : hundred + " " + fr_under_hundred(r);
}

function in_words(n) {
    n = Math.trunc(Number(n));
    if (!Number.isFinite(n)) return String(n);
    if (n < 0) return "moins " + in_words(-n);
    if (n < 1000) return fr_under_thousand(n);
    const th = Math.floor(n / 1000);
    const r = n % 1000;
    // "mille" is invariable (no plural -s).
    const thousand = th === 1 ? "mille" : fr_under_thousand(th) + " mille";
    if (r === 0) return thousand;
    const million = Math.floor(n / 1e6);
    if (million >= 1) {
        const rem = n % 1e6;
        const millions = million === 1 ? "un million" : in_words(million) + " millions";
        return rem === 0 ? millions : millions + " " + in_words(rem);
    }
    return thousand + " " + fr_under_thousand(r);
}

// Ordinals: 1 -> "premier"; otherwise the last cardinal token takes -ième, with
// the common stem changes (cinq -> cinquième, neuf -> neuvième, final -e
// dropped). Rare compound forms (e.g. quatre-vingtième) are approximate.
function ordinal_word(word) {
    if (word === "un") return "unième";
    if (word === "cinq") return "cinquième";
    if (word === "neuf") return "neuvième";
    if (/e$/.test(word)) return word.slice(0, -1) + "ième";
    return word + "ième";
}

function ordinal(n) {
    if (Math.trunc(Number(n)) === 1) return "premier";
    const words = in_words(n);
    const cut = Math.max(words.lastIndexOf(" "), words.lastIndexOf("-"));
    return cut === -1
        ? ordinal_word(words)
        : words.slice(0, cut + 1) + ordinal_word(words.slice(cut + 1));
}

// Plural suffix (the `[s]` sugar): the word's French plural unless the governing
// count (the most recently interpolated number) is exactly 1.
function plural_suffix(word) {
    return lamplighter.renderCount() === 1 ? word : pluralize_word(word);
}

// Grouped lists: collapse same-named objects into a counted entry, preserving
// first-seen order; singletons keep their article, groups render the count in
// words plus the plural name ("deux lanternes de cuivre").
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

// Definite grouped: the count is preceded by the plural definite article "les".
function the_group(xs) {
    return format_list(group_entries(xs, the, "les "));
}

// --- Parser language (installed into the engine) ----------------------------
// French noun-phrase vocabulary + prose, the payoff of the locale-owned parser
// seam: a player types "le manteau" (the "le" is stripped) and gets French
// disambiguation/failure prose. Whole-word articles only — elided forms (l'/d')
// glue to the noun in a single input token, so they aren't separate words here.
// French lists put no comma before "ou". Disambiguation renders through the()
// (gendered le/la/l'/les).
function disambiguation_prompt(candidates) {
    const names = lamplighter.listItems(candidates).map((o) => the(o));
    if (names.length === 2) {
        return `Lequel voulez-vous dire : ${names[0]} ou ${names[1]} ?`;
    }
    const last = names[names.length - 1];
    return `Lequel voulez-vous dire : ${names.slice(0, -1).join(", ")} ou ${last} ?`;
}

lamplighter.setParserLanguage({
    articles: ["le", "la", "les", "un", "une", "des", "du", "de"],
    pronouns: ["le", "la", "les", "ça"],
    selfWords: ["moi", "me"],
    disambiguation: disambiguation_prompt,
    unknownReference: (word) => `Je ne sais pas à quoi « ${word} » fait référence.`,
});
