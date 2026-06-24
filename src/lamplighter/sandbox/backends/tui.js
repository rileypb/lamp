// Interactive TUI render backend (hand-rolled, dependency-free).
//
// The interactive-terminal alternative to backends/plain.js, selected by the host
// when stdout/stdin are a TTY (and LAMP_NO_TUI is unset). Implements the same
// render-backend interface (see plain.js): a pinned top status row, a scrollable
// transcript, and a bottom input line, on the alternate screen in raw mode.
//
// Input: printable + Backspace/Delete + Enter, in-line cursor editing (←/→, Home/
// End), and ↑/↓ command history; PageUp/PageDown and mouse-wheel scrollback; Ctrl-C
// quits. The transcript carries bold/italic styling. Deferred: batched redraws,
// preserving the transcript on exit. The terminal is always restored on
// exit/error/signal. See devdocs/windows.md, devdocs/sandbox.md.
//
// Enabling mouse reporting captures clicks/drags too, so the terminal's native
// click-to-select is suppressed while running (hold Shift to bypass and select). We
// use it only for the wheel; other mouse events are ignored.

const ALT_ON = "\x1b[?1049h";
const ALT_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h"; // button tracking + SGR coordinates
const MOUSE_OFF = "\x1b[?1006l\x1b[?1000l";
const CLEAR_LINE = "\x1b[2K";
const REVERSE = "\x1b[7m";
const RESET = "\x1b[0m";
const moveTo = (row, col) => `\x1b[${row};${col}H`;

// A transcript line is an array of spans: { text, bold, italic }. "fixed" needs no
// SGR (a terminal is already monospace), so only bold/italic affect rendering.
function spanSgr(span) {
    const codes = [];
    if (span.bold) codes.push("1");
    if (span.italic) codes.push("3");
    return codes.length ? `\x1b[${codes.join(";")}m` : "";
}

// Render one wrapped row (array of spans) to a string, truncated to `cols` visible
// columns. Each styled span self-closes, so rows need no cross-row SGR state.
function rowToString(row, cols) {
    let s = "";
    let vis = 0;
    for (const span of row) {
        if (vis >= cols) break;
        let text = span.text;
        if (vis + text.length > cols) text = text.slice(0, cols - vis);
        vis += text.length;
        const open = spanSgr(span);
        s += open ? open + text + RESET : text;
    }
    return s;
}

// Wrap a line (array of spans) to `cols`, breaking at the last space within the
// window (hard break for an over-long word). Expands to styled chars, wraps by
// position so intentional spacing survives, then regroups runs back into spans. An
// empty line yields one blank row so paragraph spacing is preserved.
function wrapSpans(spans, cols) {
    const chars = [];
    for (const sp of spans) for (const ch of sp.text) chars.push({ ch, bold: sp.bold, italic: sp.italic });
    if (chars.length === 0) return [[]];
    const rows = [];
    let i = 0;
    while (i < chars.length) {
        let end = Math.min(i + cols, chars.length);
        if (end < chars.length) {
            let sp = -1;
            for (let j = end; j > i; j -= 1) {
                if (chars[j].ch === " ") { sp = j; break; }
            }
            if (sp > i) end = sp;
        }
        const rowChars = chars.slice(i, end);
        const row = [];
        for (const c of rowChars) {
            const last = row[row.length - 1];
            if (last && last.bold === c.bold && last.italic === c.italic) last.text += c.ch;
            else row.push({ text: c.ch, bold: c.bold, italic: c.italic });
        }
        rows.push(row);
        i = end;
        if (chars[i] && chars[i].ch === " ") i += 1; // consume the break space
    }
    return rows;
}

// Wrap a line (array of spans) to `cols` by column position — a hard break every
// `cols` chars, never at spaces. Used for the command echo so it breaks exactly
// where the live input row did (word-wrap would orphan the prompt on its own row,
// since the space after "> " is a break point). Regroups runs back into spans.
function hardWrapSpans(spans, cols) {
    const chars = [];
    for (const sp of spans) for (const ch of sp.text) chars.push({ ch, bold: sp.bold, italic: sp.italic });
    if (chars.length === 0) return [[]];
    const rows = [];
    for (let i = 0; i < chars.length; i += cols) {
        const row = [];
        for (const c of chars.slice(i, i + cols)) {
            const last = row[row.length - 1];
            if (last && last.bold === c.bold && last.italic === c.italic) last.text += c.ch;
            else row.push({ text: c.ch, bold: c.bold, italic: c.italic });
        }
        rows.push(row);
    }
    return rows;
}

// Plain-text convenience used by tests: wrap a string to an array of strings.
function wrapLine(text, cols) {
    return wrapSpans([{ text, bold: false, italic: false }], cols).map((row) => rowToString(row, cols));
}

function createTuiBackend({ out, err, input, exit } = {}) {
    // `input` and `exit` are injectable for testing; they default to the real
    // process stdin and process.exit in production.
    const stdin = input || process.stdin;
    const doExit = exit || ((code) => process.exit(code));

    const lines = []; // committed transcript lines, each an array of spans
    let pending = []; // spans of the partial line not yet terminated by "\n"
    let statusLeft = "";
    let statusRight = "";
    let scrollOffset = 0; // lines scrolled up from the bottom (0 = at bottom)

    let awaiting = false; // an input request is open
    let inputBuf = "";
    let cursorPos = 0; // caret index within inputBuf
    let currentPrompt = "";
    let deliverCb = null;

    const history = []; // submitted command lines
    let historyIdx = 0; // cursor into history; === history.length means "current draft"
    let draft = ""; // the in-progress line, stashed while browsing history

    let started = false;
    let stopped = false;
    let onResize = null;
    let onExit = null;
    let onSignal = null;

    function flushPending() {
        if (pending.length > 0) {
            lines.push(pending);
            pending = [];
        }
    }

    function appendOutput(value, styles) {
        const bold = !!(styles && styles.includes("bold"));
        const italic = !!(styles && styles.includes("italic"));
        const push = (text) => { if (text.length > 0) pending.push({ text, bold, italic }); };
        const parts = String(value).split("\n");
        push(parts[0]);
        for (let k = 1; k < parts.length; k += 1) {
            lines.push(pending);
            pending = [];
            push(parts[k]);
        }
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

        const displayRows = [];
        for (const ln of lines) {
            const wrapped = ln.hardWrap ? hardWrapSpans(ln, cols) : wrapSpans(ln, cols);
            for (const r of wrapped) displayRows.push(r);
        }
        if (pending.length > 0) for (const r of wrapSpans(pending, cols)) displayRows.push(r);

        // The input line flows as the last line(s) of the content, so it sits right
        // below the text while the area isn't full and only pins to the bottom once
        // the transcript fills it. The whole stack is bottom-anchored. A command
        // longer than the terminal width hard-wraps across rows — by column, not at
        // spaces — so the caret maps cleanly to a (row, col), and a caret resting one
        // past a full row opens the next row to hold it.
        const inputRows = [];
        let caretRow = 0;
        let caretCol = 0;
        if (awaiting) {
            const full = currentPrompt + inputBuf;
            const caretAbs = currentPrompt.length + cursorPos;
            caretRow = Math.floor(caretAbs / cols);
            caretCol = caretAbs % cols;
            const textRows = full.length === 0 ? 1 : Math.ceil(full.length / cols);
            const nRows = Math.max(textRows, caretRow + 1);
            for (let r = 0; r < nRows; r += 1) {
                inputRows.push([{ text: full.slice(r * cols, r * cols + cols), bold: false, italic: false }]);
            }
        }
        const combined = awaiting ? displayRows.concat(inputRows) : displayRows;

        const maxOffset = Math.max(0, combined.length - viewH);
        if (scrollOffset > maxOffset) scrollOffset = maxOffset;
        const startIdx = Math.max(0, combined.length - viewH - scrollOffset);
        const slice = combined.slice(startIdx, startIdx + viewH);

        let buf = CURSOR_HIDE;
        buf += moveTo(1, 1) + CLEAR_LINE + REVERSE + statusBar(cols) + RESET;
        buf += moveTo(2, 1) + CLEAR_LINE; // blank spacer between status and transcript
        for (let i = 0; i < viewH; i += 1) {
            buf += moveTo(gameTop + i, 1) + CLEAR_LINE + (slice[i] != null ? rowToString(slice[i], cols) : "");
        }
        const caretVis = awaiting ? displayRows.length + caretRow - startIdx : -1;
        if (caretVis >= 0 && caretVis < viewH) {
            buf += moveTo(gameTop + caretVis, Math.min(cols, caretCol + 1));
            buf += CURSOR_SHOW;
        }
        out.write(buf);
    }

    function afterEdit() {
        scrollOffset = 0; // editing snaps the view back to the input line
        render();
    }

    function insertChar(c) {
        inputBuf = inputBuf.slice(0, cursorPos) + c + inputBuf.slice(cursorPos);
        cursorPos += c.length;
        afterEdit();
    }
    function backspace() {
        if (cursorPos > 0) {
            inputBuf = inputBuf.slice(0, cursorPos - 1) + inputBuf.slice(cursorPos);
            cursorPos -= 1;
        }
        afterEdit();
    }
    function deleteChar() {
        if (cursorPos < inputBuf.length) inputBuf = inputBuf.slice(0, cursorPos) + inputBuf.slice(cursorPos + 1);
        afterEdit();
    }
    function cursorLeft() { if (cursorPos > 0) cursorPos -= 1; afterEdit(); }
    function cursorRight() { if (cursorPos < inputBuf.length) cursorPos += 1; afterEdit(); }
    function cursorHome() { cursorPos = 0; afterEdit(); }
    function cursorEnd() { cursorPos = inputBuf.length; afterEdit(); }

    function historyPrev() {
        if (historyIdx > 0) {
            if (historyIdx === history.length) draft = inputBuf; // stash the draft
            historyIdx -= 1;
            inputBuf = history[historyIdx];
            cursorPos = inputBuf.length;
            afterEdit();
        }
    }
    function historyNext() {
        if (historyIdx < history.length) {
            historyIdx += 1;
            inputBuf = historyIdx === history.length ? draft : history[historyIdx];
            cursorPos = inputBuf.length;
            afterEdit();
        }
    }

    function submit() {
        const line = inputBuf;
        flushPending();
        const echo = [{ text: currentPrompt + line, bold: false, italic: false }]; // echo
        echo.hardWrap = true; // break by column like the live input row, not at spaces
        lines.push(echo);
        if (line.length > 0 && history[history.length - 1] !== line) history.push(line);
        historyIdx = history.length;
        draft = "";
        const deliver = deliverCb;
        awaiting = false;
        inputBuf = "";
        cursorPos = 0;
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
    function scrollLines(n) {
        scrollOffset = Math.max(0, scrollOffset + n); // render() clamps the top
        render();
    }

    function handleEscape(params, final) {
        if (final === "~" && params === "5") { pageUp(); return; } // PageUp
        if (final === "~" && params === "6") { pageDown(); return; } // PageDown
        if (!awaiting) return; // the rest edit the input line
        switch (final) {
            case "D": cursorLeft(); break; // ←
            case "C": cursorRight(); break; // →
            case "A": historyPrev(); break; // ↑
            case "B": historyNext(); break; // ↓
            case "H": cursorHome(); break;
            case "F": cursorEnd(); break;
            case "~":
                if (params === "1" || params === "7") cursorHome();
                else if (params === "4" || params === "8") cursorEnd();
                else if (params === "3") deleteChar();
                break;
            default: break;
        }
    }

    function onData(chunk) {
        const s = chunk.toString("utf8");
        let i = 0;
        while (i < s.length) {
            const c = s[i];
            if (c === "\x03") { stop(); doExit(130); return; } // Ctrl-C
            if (c === "\x1b") {
                const rest = s.slice(i);
                const mouse = rest.match(/^\x1b\[<(\d+);\d+;\d+[Mm]/); // SGR mouse
                if (mouse) {
                    i += mouse[0].length;
                    const b = parseInt(mouse[1], 10);
                    if (b === 64) scrollLines(3); // wheel up
                    else if (b === 65) scrollLines(-3); // wheel down
                    continue; // other mouse events ignored
                }
                const m = rest.match(/^\x1b(\[|O)([0-9;]*)([A-Za-z~])/);
                if (!m) { i += 1; continue; } // lone/unknown ESC
                i += m[0].length;
                handleEscape(m[2], m[3]);
                continue;
            }
            if (!awaiting) { i += 1; continue; } // ignore typing until input is requested
            if (c === "\r" || c === "\n") { submit(); i += 1; continue; }
            if (c === "\x7f" || c === "\b") { backspace(); i += 1; continue; }
            if (c === "\x04") { // Ctrl-D at empty input = quit
                if (inputBuf.length === 0) { stop(); doExit(0); return; }
                i += 1;
                continue;
            }
            if (c >= " ") { insertChar(c); i += 1; continue; }
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
        out.write(MOUSE_OFF + CURSOR_SHOW + ALT_OFF);
    }

    return {
        start() {
            if (started) return;
            started = true;
            if (stdin.setRawMode) stdin.setRawMode(true);
            stdin.resume();
            stdin.on("data", onData);
            out.write(ALT_ON + CURSOR_HIDE + MOUSE_ON);
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
        write(value, styles) {
            appendOutput(value, styles);
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
            cursorPos = 0;
            awaiting = true;
            scrollOffset = 0;
            historyIdx = history.length;
            draft = "";
            render();
        },
    };
}

module.exports = { createTuiBackend, wrapLine };
