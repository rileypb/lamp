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
// (`printed_name`, else its `name`) and an optional `article` whose `.name` is
// one of "proper" | "plural" | "definite" | "count". Reads are defensive, so a
// world model that supplies neither still gets sensible output.
function display_name(x) {
    if (x && x.printed_name) return String(x.printed_name);
    return String(x && x.name != null ? x.name : x).replace(/_/g, " ");
}

function article_kind(x) {
    return x && x.article && x.article.name ? x.article.name : null;
}

function the(x) {
    const name = display_name(x);
    if (article_kind(x) === "proper") return name;
    return "the " + name;
}

function indefinite(x) {
    const name = display_name(x);
    const kind = article_kind(x);
    if (kind === "proper") return name;
    if (kind === "plural") return "some " + name;
    return (/^[aeiou]/i.test(name) ? "an " : "a ") + name;
}

function an(x) {
    const name = display_name(x);
    if (article_kind(x) === "proper") return name;
    return "an " + name;
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
