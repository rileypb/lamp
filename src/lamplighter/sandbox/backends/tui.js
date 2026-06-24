// Interactive TUI render backend (hand-rolled, dependency-free).
//
// The interactive-terminal alternative to backends/plain.js, selected by the host
// when stdout/stdin are a TTY (and LAMP_NO_TUI is unset). Implements the same
// render-backend interface (see plain.js): a pinned top status row, a scrollable
// transcript, and a bottom input line, on the alternate screen in raw mode.
//
// Lean v1 scope: printable + Backspace + Enter input; PageUp/PageDown scrollback;
// Ctrl-C quits. Deferred (Phase 3): in-line cursor movement, command history,
// mouse-wheel scroll, styled transcript text, and batched redraws. The terminal is
// always restored on exit/error/signal. See devdocs/windows.md, devdocs/sandbox.md.

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const CLEAR_LINE = "\x1b[2K";
const REVERSE = "\x1b[7m";
const RESET = "\x1b[0m";
const moveTo = (row, col) => `\x1b[${row};${col}H`;

// Wrap one logical line to `cols`, breaking at the last space within the window
// (falling back to a hard break for an over-long word). Slices by position so
// intentional internal spacing/indentation is preserved. An empty line yields one
// blank display line so paragraph spacing survives.
function wrapLine(text, cols) {
    if (text.length === 0) return [""];
    const result = [];
    let i = 0;
    while (i < text.length) {
        let end = Math.min(i + cols, text.length);
        if (end < text.length) {
            const lastSpace = text.lastIndexOf(" ", end);
            if (lastSpace > i) end = lastSpace;
        }
        result.push(text.slice(i, end));
        i = end;
        if (text[i] === " ") i += 1; // consume the break space
    }
    return result;
}

function createTuiBackend({ out, err, input, exit } = {}) {
    // `input` and `exit` are injectable for testing; they default to the real
    // process stdin and process.exit in production.
    const stdin = input || process.stdin;
    const doExit = exit || ((code) => process.exit(code));

    const lines = []; // committed transcript lines (no embedded newlines)
    let pending = ""; // partial output line not yet terminated by "\n"
    let statusLeft = "";
    let statusRight = "";
    let scrollOffset = 0; // lines scrolled up from the bottom (0 = at bottom)

    let awaiting = false; // an input request is open
    let inputBuf = "";
    let currentPrompt = "";
    let deliverCb = null;

    let started = false;
    let stopped = false;
    let onResize = null;
    let onExit = null;
    let onSignal = null;

    function flushPending() {
        if (pending.length > 0) {
            lines.push(pending);
            pending = "";
        }
    }

    function appendOutput(value) {
        const parts = (pending + String(value)).split("\n");
        pending = parts.pop();
        for (const p of parts) lines.push(p);
    }

    function statusBar(cols) {
        let l = statusLeft || "";
        const r = statusRight || "";
        if (l.length + r.length + 1 > cols) l = l.slice(0, Math.max(0, cols - r.length - 1));
        const gap = Math.max(1, cols - l.length - r.length);
        let bar = l + " ".repeat(gap) + r;
        bar = bar.length > cols ? bar.slice(0, cols) : bar + " ".repeat(cols - bar.length);
        return bar;
    }

    function render() {
        if (stopped) return;
        const cols = out.columns || 80;
        const rows = out.rows || 24;
        const gameTop = 3; // after status (1) + blank spacer (2)
        const viewH = Math.max(1, rows - 2); // game area: rows 3..rows

        const display = [];
        for (const ln of lines) for (const w of wrapLine(ln, cols)) display.push(w);
        if (pending.length > 0) for (const w of wrapLine(pending, cols)) display.push(w);

        // The input line flows as the last line of the content, so it sits right
        // below the text while the area isn't full and only pins to the bottom once
        // the transcript fills it. The whole stack is bottom-anchored.
        const inputText = awaiting ? currentPrompt + inputBuf : null;
        const combined = inputText != null ? display.concat([inputText]) : display;

        const maxOffset = Math.max(0, combined.length - viewH);
        if (scrollOffset > maxOffset) scrollOffset = maxOffset;
        const startIdx = Math.max(0, combined.length - viewH - scrollOffset);
        const slice = combined.slice(startIdx, startIdx + viewH);

        let buf = CURSOR_HIDE;
        buf += moveTo(1, 1) + CLEAR_LINE + REVERSE + statusBar(cols) + RESET;
        buf += moveTo(2, 1) + CLEAR_LINE; // blank spacer between status and transcript
        for (let i = 0; i < viewH; i += 1) {
            buf += moveTo(gameTop + i, 1) + CLEAR_LINE + (slice[i] != null ? slice[i].slice(0, cols) : "");
        }
        // Place the cursor on the input line when it is on screen (not scrolled away).
        const inputVis = awaiting ? combined.length - 1 - startIdx : -1;
        if (inputVis >= 0 && inputVis < viewH) {
            buf += moveTo(gameTop + inputVis, Math.min(cols, currentPrompt.length + inputBuf.length + 1));
            buf += CURSOR_SHOW;
        }
        out.write(buf);
    }

    function submit() {
        const line = inputBuf;
        flushPending();
        lines.push(currentPrompt + line); // echo the command into the transcript
        const deliver = deliverCb;
        awaiting = false;
        inputBuf = "";
        deliverCb = null;
        currentPrompt = "";
        scrollOffset = 0;
        render();
        deliver(line); // release the worker (blocked on Atomics.wait)
    }

    function pageUp() {
        const viewH = Math.max(1, (out.rows || 24) - 2);
        scrollOffset += Math.max(1, viewH - 1);
        render();
    }

    function pageDown() {
        const viewH = Math.max(1, (out.rows || 24) - 2);
        scrollOffset = Math.max(0, scrollOffset - Math.max(1, viewH - 1));
        render();
    }

    function onData(chunk) {
        const s = chunk.toString("utf8");
        let i = 0;
        while (i < s.length) {
            const c = s[i];
            if (c === "\x03") { // Ctrl-C
                stop();
                doExit(130);
                return;
            }
            if (c === "\x1b") { // escape sequence
                const rest = s.slice(i);
                if (rest.startsWith("\x1b[5~")) { pageUp(); i += 4; continue; }
                if (rest.startsWith("\x1b[6~")) { pageDown(); i += 4; continue; }
                const m = rest.match(/^\x1b\[[0-9;]*[A-Za-z~]/); // consume any other CSI
                i += m ? m[0].length : 1;
                continue;
            }
            if (!awaiting) { i += 1; continue; } // ignore typing until input is requested
            if (c === "\r" || c === "\n") { submit(); i += 1; continue; }
            if (c === "\x7f" || c === "\b") { inputBuf = inputBuf.slice(0, -1); scrollOffset = 0; render(); i += 1; continue; }
            if (c === "\x04") { // Ctrl-D at empty input = quit
                if (inputBuf.length === 0) { stop(); doExit(0); return; }
                i += 1;
                continue;
            }
            if (c >= " ") { inputBuf += c; scrollOffset = 0; render(); i += 1; continue; } // typing snaps to bottom
            i += 1; // ignore other control characters
        }
    }

    function stop() {
        if (!started || stopped) return;
        stopped = true;
        stdin.removeListener("data", onData);
        if (stdin.setRawMode) stdin.setRawMode(false);
        // Release stdin: start() resumed it (flowing TTY), which keeps the event loop
        // alive. Without this the process hangs after a clean QUIT. See devdocs/windows.md.
        if (stdin.pause) stdin.pause();
        if (stdin.unref) stdin.unref();
        if (onResize) out.removeListener("resize", onResize);
        if (onExit) process.removeListener("exit", onExit);
        if (onSignal) {
            process.removeListener("SIGINT", onSignal);
            process.removeListener("SIGTERM", onSignal);
        }
        out.write(CURSOR_SHOW + ALT_OFF);
    }

    return {
        start() {
            if (started) return;
            started = true;
            if (stdin.setRawMode) stdin.setRawMode(true);
            stdin.resume();
            stdin.on("data", onData);
            out.write(ALT_ON + CURSOR_HIDE);
            onResize = () => render();
            out.on("resize", onResize);
            onExit = () => stop(); // safety net: always restore the terminal
            process.on("exit", onExit);
            onSignal = () => { stop(); doExit(130); };
            process.on("SIGINT", onSignal);
            process.on("SIGTERM", onSignal);
            render();
        },
        stop,
        write(value) {
            appendOutput(value); // styles dropped in v1 (Phase 3 restores them)
            scrollOffset = 0; // snap to bottom on new output
            render();
        },
        log(value) {
            appendOutput(`${value}\n`);
            render();
        },
        setStatus(left, right) {
            statusLeft = String(left == null ? "" : left);
            statusRight = String(right == null ? "" : right);
            render();
        },
        requestLine(prompt, deliver) {
            currentPrompt = prompt == null ? "" : String(prompt);
            deliverCb = deliver;
            inputBuf = "";
            awaiting = true;
            scrollOffset = 0;
            render();
        },
    };
}

module.exports = { createTuiBackend, wrapLine };
