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

// RNG control for randomized text variation (text.md F8). seed_random reseeds
// reproducibly from an integer; randomize draws a fresh seed from entropy.
function seed_random(n) {
    lamplighter.seedRandom(n);
}

function randomize() {
    lamplighter.randomizeRng();
}

// NOTE: list-to-prose rendering (the "and"/serial-comma formatter installed via
// setListFormatter) is English *language data*, so it now lives in the locale
// pack lib/en-US, not here. lib/sys holds only language-agnostic mechanism.
// See devdocs/text.md (three-layer split).
