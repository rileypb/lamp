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

// NOTE: list-to-prose rendering (the "and"/serial-comma formatter installed via
// setListFormatter) is English *language data*, so it now lives in the locale
// pack lib/en-US, not here. lib/sys holds only language-agnostic mechanism.
// See devdocs/text.md (three-layer split).
