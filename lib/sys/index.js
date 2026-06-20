function readline() {
    return lamplighter.readLine();
}

function prompt(s) {
    return lamplighter.promptLine(s);
}

function write(s) {
    lamplighter.write(s);
}

function split(input) {
    const words = input.trim().split(/\s+/).filter((w) => w.length > 0);
    return lamplighter.makeList(words);
}

function to_lower(input) {
    return input.toLowerCase();
}

function run_command(line, actor) {
    lamplighter.runCommand(line, actor);
}

// Renders a list of already-formatted strings to prose. Presentation policy
// lives here in the base library, not in the runtime. The serial (Oxford) comma
// is the author-settable `oxford_comma` global (set `oxford_comma = true` in a
// game to enable it).
function format_list(strings) {
    if (strings.length === 0) return "nothing";
    if (strings.length === 1) return strings[0];
    if (strings.length === 2) return strings[0] + " and " + strings[1];
    const conjunction = lamplighter.getGlobal("oxford comma") ? ", and " : " and ";
    return strings.slice(0, -1).join(", ") + conjunction + strings[strings.length - 1];
}

lamplighter.setListFormatter(format_list);
