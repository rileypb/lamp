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

function player_command() {
    return lamplighter.playerCommand();
}

// Paragraph-control markers (text.md H1/H2/H3). Each returns a private-use sentinel
// the output stream interprets in place: line_break / paragraph request a break,
// no_break cancels a pending one (the [run on] mechanism), par_if_printed requests a
// paragraph break only if text was printed since the last break. The bare-word sugar
// [line break] / [par] / [no break] / [run on] / [par if printed] desugars to these.
function line_break() {
    return lamplighter.outputMarker("line");
}

function paragraph() {
    return lamplighter.outputMarker("par");
}

function no_break() {
    return lamplighter.outputMarker("nobreak");
}

function par_if_printed() {
    return lamplighter.outputMarker("parif");
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
