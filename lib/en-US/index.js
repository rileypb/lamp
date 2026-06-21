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
    return Boolean(x && (x.proper || (x.article && x.article.name === "proper")));
}

function is_plural(x) {
    return Boolean(x && (x.plural || (x.article && x.article.name === "plural")));
}

function the(x) {
    const name = display_name(x);
    return is_proper(x) ? name : "the " + name;
}

function indefinite(x) {
    const name = display_name(x);
    if (is_proper(x)) return name;
    if (is_plural(x)) return "some " + name;
    return (/^[aeiou]/i.test(name) ? "an " : "a ") + name;
}

function an(x) {
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

// List prose. Moved here from lib/sys: the conjunction "and" and the serial
// (Oxford) comma are English. The Oxford comma is the author-settable
// `oxford_comma` global (set `oxford_comma = true` in a game to enable it).
function format_list(strings) {
    if (strings.length === 0) return "nothing";
    if (strings.length === 1) return strings[0];
    if (strings.length === 2) return strings[0] + " and " + strings[1];
    const conjunction = lamplighter.getGlobal("oxford comma") ? ", and " : " and ";
    return strings.slice(0, -1).join(", ") + conjunction + strings[strings.length - 1];
}

lamplighter.setListFormatter(format_list);
