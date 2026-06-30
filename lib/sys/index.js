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

function split_on(s, sep) {
    const parts = String(s).split(sep).map((p) => p.trim()).filter((p) => p.length > 0);
    return lamplighter.makeList(parts);
}

function map_strings(xs, fn) {
    return lamplighter.makeList(lamplighter.listItems(xs).map((x) => fn(x)));
}

function to_lower(input) {
    return input.toLowerCase();
}

// String-character primitives (codepoint-based, 0-indexed). Array.from splits a string
// into code points (so astral characters count as one), keeping length/index/code/slice
// consistent. These are the building blocks text algorithms need in Lamp.
function length(s) {
    return Array.from(String(s)).length;
}

function char_at(s, i) {
    const ch = Array.from(String(s))[i];
    return ch === undefined ? "" : ch;
}

function code_at(s, i) {
    const ch = Array.from(String(s))[i];
    return ch === undefined ? -1 : ch.codePointAt(0);
}

function substring(s, start, end) {
    return Array.from(String(s)).slice(start, end).join("");
}

function run_command(line, actor) {
    return lamplighter.runCommand(line, actor);
}

function player_command() {
    return lamplighter.playerCommand();
}

function turns_taken() {
    return lamplighter.turnsTaken();
}

function status_line(left, right) {
    lamplighter.setStatusLine(left, right);
}

// Transcript (scripting) primitives — thin pass-throughs to the runtime mechanism. The
// runtime captures output/input and brokers the file; the library verb (lib/advent)
// supplies the prompt and wording. See devdocs/state.md → Transcript (scripting).
function transcript_start(name) {
    return lamplighter.transcriptStart(name);
}

function transcript_stop() {
    lamplighter.transcriptStop();
}

function transcript_running() {
    return lamplighter.transcriptRunning();
}

function transcript_available() {
    return lamplighter.transcriptAvailable();
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

// Type-style wrappers (text.md I3, Slice 7). Each wraps its content in the matching
// style; the runtime carries the active style set out-of-band on every output
// segment (structured-segment transport) and each host renders it or silently drops
// it (fail-silently). They compose and nest — bold(italic(x)). Style names are
// language-agnostic, so they live here in lib/sys, not in the locale pack. The
// paired-marker sugar ([b]…[/b], …) is the next follow-up and will desugar to these.
function bold(value) {
    return lamplighter.styled("bold", value);
}

function italic(value) {
    return lamplighter.styled("italic", value);
}

function fixed(value) {
    return lamplighter.styled("fixed", value);
}

// RNG control for randomized text variation (text.md F8). seed_random reseeds
// reproducibly from an integer; randomize draws a fresh seed from entropy.
function seed_random(n) {
    lamplighter.seedRandom(n);
}

function randomize() {
    lamplighter.randomizeRng();
}

// A uniform random integer in [0, n), from the same save/undo-captured stream as
// randomized text. The general randomness primitive.
function random(n) {
    return lamplighter.randomInt(n);
}

// Fisher-Yates (Durstenfeld) shuffle, in place, drawing from the same save/undo-captured
// RNG as `random`. Mutates the list's backing array (listItems returns it live), so the
// reshuffle reproduces across restore. A native because it is generic over element type.
function shuffle(xs) {
    const items = lamplighter.listItems(xs);
    for (let i = items.length - 1; i > 0; i -= 1) {
        const j = random(i + 1);
        const tmp = items[i];
        items[i] = items[j];
        items[j] = tmp;
    }
}

// NOTE: list-to-prose rendering (the "and"/serial-comma formatter installed via
// setListFormatter) is English *language data*, so it now lives in the locale
// pack lib/en-US, not here. lib/sys holds only language-agnostic mechanism.
// See devdocs/text.md (three-layer split).
