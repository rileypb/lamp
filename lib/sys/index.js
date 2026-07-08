function readline() {
    return lamplighter.readLine();
}

function prompt(s) {
    return lamplighter.promptLine(s);
}

function pause(prompt_text) {
    lamplighter.pauseForInput(prompt_text);
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

// Append an item to a list, in place — mutating the list's backing array (like
// shuffle), so a list held in a global/field grows durably and the new element is
// captured by undo/save (encodeValue snapshots list items). With map_strings and a
// `for` loop this covers filter/collect, which Lamp has no literal syntax for. A
// native because it is generic over the element type.
function append(xs, item) {
    lamplighter.listItems(xs).push(item);
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

function run_meta_command(line, actor) {
    return lamplighter.runMetaCommand(line, actor);
}

function set_all_filter(fn) {
    lamplighter.setAllFilter(fn);
}

function player_command() {
    return lamplighter.playerCommand();
}

function turns_taken() {
    return lamplighter.turnsTaken();
}

// Text-window primitives — thin pass-throughs to the runtime's window buffer + wire
// messages (devdocs/text-windows.md). The runtime owns the mechanism, the library
// (lib/advent) owns the per-turn refresh cadence, the host renders (or ignores) panes.
function window_line(w, text) {
    lamplighter.windowLine(w, text);
}

function window_line_split(w, left, right) {
    lamplighter.windowLineSplit(w, left, right);
}

function window_rule(w, ch) {
    lamplighter.windowRule(w, ch);
}

function window_clear(w) {
    lamplighter.windowClear(w);
}

function window_sync() {
    lamplighter.windowSync();
}

function window_available(dock) {
    return lamplighter.windowAvailable(dock);
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

// SAVE / RESTORE primitives — thin pass-throughs to the runtime blob lifecycle + the
// host save seam. The library verb (lib/advent/save.lamp) supplies the verb words, the
// text-host prompt, and the wording. See devdocs/state.md → Save/restore UX: a host seam.
function save_available() {
    return lamplighter.saveAvailable();
}

function save_has_picker() {
    return lamplighter.saveHasPicker();
}

function save_pick_name() {
    return lamplighter.savePickName();
}

function save_to_slot(name) {
    return lamplighter.saveToSlot(name);
}

function restore_has_picker() {
    return lamplighter.restoreHasPicker();
}

function restore_pick_blob() {
    return lamplighter.restorePickBlob();
}

function restore_read_slot(name) {
    return lamplighter.restoreReadSlot(name);
}

function restore_apply_blob(blob) {
    return lamplighter.restoreApplyBlob(blob);
}

// UNDO primitive — pop+restore the last turn checkpoint, true if one was undone. The
// runtime owns the stack; the lib/advent `undo` verb owns the wording.
function undo_turn() {
    return lamplighter.undoTurn();
}

// RESTART primitives — restart_available reports whether a pre-startup baseline was
// captured; request_restart arms a restart (true) or reports it unavailable (false). The
// runtime owns the baseline + restore-and-re-fire; the lib/advent command loop recognizes
// the RESTART command and owns the wording.
function restart_available() {
    return lamplighter.restartAvailable();
}

function request_restart() {
    return lamplighter.requestRestart();
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

// Color styles: the ANSI/Z-machine 16 (8 classic names + bright variants),
// foreground only. Terminal hosts map them to SGR codes (the user's terminal
// theme picks the shades); the web shell maps them to CSS classes; a plain host
// drops them (fail-silently, like the type styles). `colored(name, value)` is
// the computed-name escape hatch — an unknown name degrades to plain text.
function colored(color_name, value) {
    return lamplighter.styled(String(color_name), value);
}

function black(value) { return lamplighter.styled("black", value); }
function red(value) { return lamplighter.styled("red", value); }
function green(value) { return lamplighter.styled("green", value); }
function yellow(value) { return lamplighter.styled("yellow", value); }
function blue(value) { return lamplighter.styled("blue", value); }
function magenta(value) { return lamplighter.styled("magenta", value); }
function cyan(value) { return lamplighter.styled("cyan", value); }
function white(value) { return lamplighter.styled("white", value); }
function bright_black(value) { return lamplighter.styled("bright_black", value); }
function bright_red(value) { return lamplighter.styled("bright_red", value); }
function bright_green(value) { return lamplighter.styled("bright_green", value); }
function bright_yellow(value) { return lamplighter.styled("bright_yellow", value); }
function bright_blue(value) { return lamplighter.styled("bright_blue", value); }
function bright_magenta(value) { return lamplighter.styled("bright_magenta", value); }
function bright_cyan(value) { return lamplighter.styled("bright_cyan", value); }
function bright_white(value) { return lamplighter.styled("bright_white", value); }

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
