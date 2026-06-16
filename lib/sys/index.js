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

function run_command(line) {
    lamplighter.runCommand(line, lamplighter.getGlobal("player"));
}
