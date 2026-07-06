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
//
// Multi-byte input: a StringDecoder reassembles UTF-8 sequences split across stdin
// chunks; editing and the caret work in code points (so an emoji/surrogate pair is
// one unit); and column math uses an approximate East-Asian/emoji display width
// (wide = 2 cols, combining/zero-width = 0) so wrapping and the caret stay aligned
// with what the terminal actually draws.

const { StringDecoder } = require("string_decoder");

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

// Approximate terminal display width of a code point: 0 for control/combining/
// zero-width marks, 2 for East-Asian-wide and emoji, 1 otherwise. A compact stand-in
// for a full wcwidth table — covers the common CJK/Hangul/fullwidth/emoji ranges so
// the caret and wrapping line up with the terminal without an external dependency.
function charWidth(cp) {
    if (cp === 0) return 0;
    if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0; // C0/C1 controls
    if (
        (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
        (cp >= 0x200b && cp <= 0x200f) || // zero-width space / directional marks
        (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
        cp === 0xfeff // zero-width no-break space (BOM)
    ) return 0;
    if (
        (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
        (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals, Kangxi, punctuation
        (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana … CJK compatibility
        (cp >= 0x3400 && cp <= 0x4dbf) || // CJK extension A
        (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
        (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
        (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
        (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
        (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
        (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
        (cp >= 0xffe0 && cp <= 0xffe6) ||
        (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & pictographs
        (cp >= 0x20000 && cp <= 0x3fffd) // CJK extensions B+
    ) return 2;
    return 1;
}

// Sum of display widths over the code points of a string.
function textWidth(str) {
    let w = 0;
    for (const ch of str) w += charWidth(ch.codePointAt(0));
    return w;
}

// Truncate a string to at most `max` display columns (never splitting a code point;
// a wide char that would straddle the edge is dropped).
function truncateToWidth(str, max) {
    let out = "";
    let w = 0;
    for (const ch of str) {
        const cw = charWidth(ch.codePointAt(0));
        if (w + cw > max) break;
        out += ch;
        w += cw;
    }
    return out;
}

// A transcript line is an array of spans: { text, bold, italic }. "fixed" needs no
// SGR (a terminal is already monospace), so only bold/italic affect rendering.
function spanSgr(span) {
    const codes = [];
    if (span.bold) codes.push("1");
    if (span.italic) codes.push("3");
    return codes.length ? `\x1b[${codes.join(";")}m` : "";
}

// Regroup a run of styled chars ({ ch, bold, italic }) back into spans.
function charsToRow(chars) {
    const row = [];
    for (const c of chars) {
        const last = row[row.length - 1];
        if (last && last.bold === c.bold && last.italic === c.italic) last.text += c.ch;
        else row.push({ text: c.ch, bold: c.bold, italic: c.italic });
    }
    return row;
}

// Explode spans into styled code points, each carrying its display width.
function spansToChars(spans) {
    const chars = [];
    for (const sp of spans) for (const ch of sp.text) chars.push({ ch, w: charWidth(ch.codePointAt(0)), bold: sp.bold, italic: sp.italic });
    return chars;
}

// Render one wrapped row (array of spans) to a string, truncated to `cols` display
// columns. Each styled span self-closes, so rows need no cross-row SGR state.
function rowToString(row, cols) {
    let s = "";
    let vis = 0;
    for (const span of row) {
        if (vis >= cols) break;
        let text = "";
        for (const ch of span.text) {
            const cw = charWidth(ch.codePointAt(0));
            if (vis + cw > cols) break;
            text += ch;
            vis += cw;
        }
        const open = spanSgr(span);
        s += open ? open + text + RESET : text;
        if (vis >= cols) break;
    }
    return s;
}

// Wrap a line (array of spans) to `cols` display columns, breaking at the last space
// within the window (hard break for an over-long word). Works in code points carrying
// display width, so wide chars count as 2; intentional spacing survives; runs are
// regrouped back into spans. An empty line yields one blank row so paragraph spacing
// is preserved.
function wrapSpans(spans, cols) {
    const chars = spansToChars(spans);
    if (chars.length === 0) return [[]];
    const rows = [];
    let i = 0;
    while (i < chars.length) {
        let end = i;
        let w = 0;
        while (end < chars.length && w + chars[end].w <= cols) { w += chars[end].w; end += 1; }
        if (end === i) end = i + 1; // a single char wider than the row: take it anyway
        if (end < chars.length) {
            for (let j = end; j > i; j -= 1) {
                if (chars[j].ch === " ") { end = j; break; }
            }
        }
        rows.push(charsToRow(chars.slice(i, end)));
        i = end;
        if (chars[i] && chars[i].ch === " ") i += 1; // consume the break space
    }
    return rows;
}

// Wrap a line (array of spans) by column position — a hard break at `cols` display
// columns, never at spaces. Used for the command echo so it breaks exactly where the
// live input row did (word-wrap would orphan the prompt on its own row, since the
// space after "> " is a break point).
function hardWrapSpans(spans, cols) {
    const chars = spansToChars(spans);
    if (chars.length === 0) return [[]];
    const rows = [];
    let i = 0;
    while (i < chars.length) {
        let end = i;
        let w = 0;
        while (end < chars.length && w + chars[end].w <= cols) { w += chars[end].w; end += 1; }
        if (end === i) end = i + 1; // a single char wider than the row: take it anyway
        rows.push(charsToRow(chars.slice(i, end)));
        i = end;
    }
    return rows;
}

// Lay out the live input line (prompt + buffer) into hard-wrapped rows by display
// width, and locate the caret. `cursorPos` is a code-point index into `buf`. Walks
// code points so wide chars take 2 columns and surrogate pairs stay intact; wraps
// before a char (or the end-caret) that would overflow, so a caret resting one past a
// full row appears at the start of the next row.
function layoutInput(prompt, buf, cursorPos, cols) {
    const full = Array.from(prompt + buf);
    const caretAbs = Array.from(prompt).length + cursorPos;
    const rows = [""];
    let r = 0;
    let w = 0;
    let caretRow = 0;
    let caretCol = 0;
    for (let k = 0; k <= full.length; k += 1) {
        const cw = k < full.length ? charWidth(full[k].codePointAt(0)) : 1;
        if (w + cw > cols) { rows.push(""); r += 1; w = 0; } // wrap before this char/end-caret
        if (k === caretAbs) { caretRow = r; caretCol = w; }
        if (k === full.length) break;
        rows[r] += full[k];
        w += cw;
    }
    return { rows, caretRow, caretCol };
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

    // Pagination ("[more]"): when a turn's output exceeds the game area, pause and
    // reveal it a screenful at a time. `seenRows` is how many wrapped content rows the
    // player has acknowledged; `more` is the paused state; an input request that
    // arrives mid-page is held in `pendingPrompt` until the player catches up.
    let seenRows = 0;
    let more = false;
    let pendingPrompt = null;

    let awaiting = false; // an input request is open
    let inputBuf = "";
    let cursorPos = 0; // caret position as a code-point index into inputBuf
    let currentPrompt = "";
    let deliverCb = null;

    const history = []; // submitted command lines
    let historyIdx = 0; // cursor into history; === history.length means "current draft"
    let draft = ""; // the in-progress line, stashed while browsing history

    const decoder = new StringDecoder("utf8"); // reassembles UTF-8 split across chunks
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
        if (textWidth(l) + textWidth(r) + 1 > cols) l = truncateToWidth(l, Math.max(0, cols - textWidth(r) - 1));
        const gap = Math.max(1, cols - textWidth(l) - textWidth(r));
        let bar = l + " ".repeat(gap) + r;
        if (textWidth(bar) > cols) bar = truncateToWidth(bar, cols);
        return bar + " ".repeat(Math.max(0, cols - textWidth(bar)));
    }

    // --- Text-window panes (top/bottom docks; devdocs/text-windows.md) ------
    // A visible pane reserves `size` rows outside the scroll region: top panes
    // right under the status row + spacer, bottom panes on the last rows. Content
    // is a repaint block of run-encoded lines (styles/align/fill); lines beyond
    // the reserved rows are clipped (the declared size is a reservation, not a
    // scroll area). Left/right docks are unsupported on a terminal — the
    // capability handshake says so — and are ignored if a game sends them anyway.
    const panes = new Map(); // id → { dock, size, priority, visible, lines }

    function panesFor(dock) {
        const list = [];
        for (const p of panes.values()) {
            if (p.visible && p.dock === dock && p.size > 0) list.push(p);
        }
        list.sort((a, b) => a.priority - b.priority); // lower = nearer the screen edge
        return list;
    }

    function paneRowCount(dock) {
        let n = 0;
        for (const p of panesFor(dock)) n += p.size;
        return n;
    }

    // Screen geometry with panes reserved: row 1 status, row 2 spacer, top panes,
    // the game area (viewH rows), then bottom panes on the last rows.
    function geometry() {
        const cols = out.columns || 80;
        const rows = out.rows || 24;
        const topRows = paneRowCount("top");
        const bottomRows = paneRowCount("bottom");
        const gameTop = 3 + topRows;
        const viewH = Math.max(1, rows - 2 - topRows - bottomRows);
        return { cols, rows, gameTop, viewH };
    }

    function runSgr(styles) {
        const codes = [];
        if (styles && styles.includes("bold")) codes.push("1");
        if (styles && styles.includes("italic")) codes.push("3");
        return codes.length ? `\x1b[${codes.join(";")}m` : "";
    }

    // Render one pane line to at most `cols` columns: alignment materializes as
    // implicit space fills, then the slack is split across the fill runs (each
    // fill's char repeated to its share) — the terminal mirror of the web shell's
    // flex layout, so rules and the left/right split render the same way.
    function paneLineString(line, cols) {
        const runs = [];
        for (const run of line) {
            if (!run.fill && (run.align === "right" || run.align === "center")) runs.push({ text: " ", fill: true });
            runs.push(run);
            if (!run.fill && run.align === "center") runs.push({ text: " ", fill: true });
        }
        let fixed = 0;
        let fills = 0;
        for (const r of runs) {
            if (r.fill) fills += 1;
            else fixed += textWidth(String(r.text));
        }
        const slack = Math.max(0, cols - fixed);
        const base = fills > 0 ? Math.floor(slack / fills) : 0;
        let extra = fills > 0 ? slack % fills : 0;
        let s = "";
        let vis = 0;
        for (const r of runs) {
            let text = String(r.text);
            if (r.fill) {
                const ch = text || " ";
                let share = base;
                if (extra > 0) { share += 1; extra -= 1; }
                const w = Math.max(1, textWidth(ch));
                text = ch.repeat(Math.floor(share / w)) + " ".repeat(share % w);
            }
            text = truncateToWidth(text, Math.max(0, cols - vis));
            if (text.length === 0) continue;
            vis += textWidth(text);
            const open = runSgr(r.styles);
            s += open ? open + text + RESET : text;
            if (vis >= cols) break;
        }
        return s;
    }

    // Draw a dock's panes starting at `startRow`. Bottom panes draw in reverse
    // priority order so a lower priority lands nearer the bottom edge.
    function paneBlock(dock, startRow, cols) {
        let list = panesFor(dock);
        if (dock === "bottom") list = list.slice().reverse();
        let buf = "";
        let row = startRow;
        for (const p of list) {
            for (let i = 0; i < p.size; i += 1) {
                buf += moveTo(row, 1) + CLEAR_LINE;
                if (p.lines[i]) buf += paneLineString(p.lines[i], cols);
                row += 1;
            }
        }
        return buf;
    }

    // Wrapped content rows (committed lines + the partial pending line), the unit both
    // the viewport and the pager measure in. The live input row is added separately.
    function contentRows(cols) {
        const rows = [];
        for (const ln of lines) {
            const wrapped = ln.hardWrap ? hardWrapSpans(ln, cols) : wrapSpans(ln, cols);
            for (const r of wrapped) rows.push(r);
        }
        if (pending.length > 0) for (const r of wrapSpans(pending, cols)) rows.push(r);
        return rows;
    }

    // After new output, pause if more than a screenful is unseen. The runtime sends a
    // turn's output before it blocks for input, so the host has it all; we reveal it a
    // page at a time. No-op while an input prompt is showing (we don't paginate input).
    function maybePage() {
        if (!awaiting) {
            const g = geometry();
            if (contentRows(g.cols).length - seenRows > g.viewH) more = true;
        }
        render();
    }

    // Advance one screenful at a [more] pause. When the player catches up, leave paged
    // mode and, if an input request was deferred, show it now.
    function advancePage() {
        const g = geometry();
        seenRows += Math.max(1, g.viewH - 1);
        const total = contentRows(g.cols).length;
        if (total - seenRows > g.viewH) {
            render();
            return;
        }
        more = false;
        seenRows = total;
        if (pendingPrompt) activatePendingPrompt();
        else render();
    }

    function activatePendingPrompt() {
        const p = pendingPrompt;
        pendingPrompt = null;
        currentPrompt = p.prompt;
        deliverCb = p.deliver;
        inputBuf = "";
        cursorPos = 0;
        awaiting = true;
        scrollOffset = 0;
        historyIdx = history.length;
        draft = "";
        seenRows = contentRows(out.columns || 80).length; // everything output is now seen
        render();
    }

    // Paged view: one screenful of unseen content from `seenRows`, with a reverse-video
    // [more] pinned on the bottom game row (no input row, cursor hidden). `chrome` is
    // the already-drawn status/spacer/pane rows.
    function renderMore(chrome, displayRows, cols, gameTop, viewH) {
        const pageRows = displayRows.slice(seenRows, seenRows + Math.max(0, viewH - 1));
        let buf = chrome;
        for (let i = 0; i < viewH; i += 1) {
            buf += moveTo(gameTop + i, 1) + CLEAR_LINE;
            if (i < viewH - 1) {
                if (pageRows[i] != null) buf += rowToString(pageRows[i], cols);
            } else {
                buf += REVERSE + "[more]" + RESET;
            }
        }
        out.write(buf);
    }

    function render() {
        if (stopped) return;
        const { cols, gameTop, viewH } = geometry();

        const displayRows = contentRows(cols);

        // Screen chrome shared by both views: status row, spacer, and the reserved
        // pane rows (top under the spacer, bottom under the game area).
        let chrome = CURSOR_HIDE;
        chrome += moveTo(1, 1) + CLEAR_LINE + REVERSE + statusBar(cols) + RESET;
        chrome += moveTo(2, 1) + CLEAR_LINE; // blank spacer between status and transcript
        chrome += paneBlock("top", 3, cols);
        chrome += paneBlock("bottom", gameTop + viewH, cols);

        if (more) {
            renderMore(chrome, displayRows, cols, gameTop, viewH);
            return;
        }

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
            const lay = layoutInput(currentPrompt, inputBuf, cursorPos, cols);
            caretRow = lay.caretRow;
            caretCol = lay.caretCol;
            for (const rs of lay.rows) inputRows.push([{ text: rs, bold: false, italic: false }]);
        }
        const combined = awaiting ? displayRows.concat(inputRows) : displayRows;

        const maxOffset = Math.max(0, combined.length - viewH);
        if (scrollOffset > maxOffset) scrollOffset = maxOffset;
        const startIdx = Math.max(0, combined.length - viewH - scrollOffset);
        const slice = combined.slice(startIdx, startIdx + viewH);

        let buf = chrome;
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

    // Editing works in code points (Array.from splits on code-point boundaries, so a
    // surrogate-pair emoji is one element), keeping inputBuf valid and cursorPos a
    // code-point index.
    const cpLen = (s) => Array.from(s).length;

    function insertChar(c) {
        const a = Array.from(inputBuf);
        a.splice(cursorPos, 0, c);
        inputBuf = a.join("");
        cursorPos += 1;
        afterEdit();
    }
    function backspace() {
        if (cursorPos > 0) {
            const a = Array.from(inputBuf);
            a.splice(cursorPos - 1, 1);
            inputBuf = a.join("");
            cursorPos -= 1;
        }
        afterEdit();
    }
    function deleteChar() {
        const a = Array.from(inputBuf);
        if (cursorPos < a.length) { a.splice(cursorPos, 1); inputBuf = a.join(""); }
        afterEdit();
    }
    function cursorLeft() { if (cursorPos > 0) cursorPos -= 1; afterEdit(); }
    function cursorRight() { if (cursorPos < cpLen(inputBuf)) cursorPos += 1; afterEdit(); }
    function cursorHome() { cursorPos = 0; afterEdit(); }
    function cursorEnd() { cursorPos = cpLen(inputBuf); afterEdit(); }

    function historyPrev() {
        if (historyIdx > 0) {
            if (historyIdx === history.length) draft = inputBuf; // stash the draft
            historyIdx -= 1;
            inputBuf = history[historyIdx];
            cursorPos = cpLen(inputBuf);
            afterEdit();
        }
    }
    function historyNext() {
        if (historyIdx < history.length) {
            historyIdx += 1;
            inputBuf = historyIdx === history.length ? draft : history[historyIdx];
            cursorPos = cpLen(inputBuf);
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
        const s = decoder.write(chunk); // holds back any incomplete trailing bytes
        if (more) {
            // At a [more] pause: any key advances one page; Ctrl-C still quits; mouse
            // events are ignored so the wheel doesn't accidentally page.
            if (s.indexOf("\x03") !== -1) { stop(); doExit(130); return; }
            if (/^\x1b\[<\d+;\d+;\d+[Mm]/.test(s)) return;
            advancePage();
            return;
        }
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
            const cp = s.codePointAt(i);
            if (cp >= 0x20) { // printable: take the whole code point (emoji = 2 units)
                const ch = String.fromCodePoint(cp);
                insertChar(ch);
                i += ch.length;
                continue;
            }
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
        // Window capability handshake: the host forwards this to the worker before
        // the game starts, so window_available reflects what this backend renders.
        capabilities: { windows: { docks: ["top", "bottom"] } },
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
            maybePage();
        },
        log(value) {
            appendOutput(`${value}\n`);
            maybePage();
        },
        setStatus(left, right) {
            statusLeft = String(left == null ? "" : left);
            statusRight = String(right == null ? "" : right);
            render();
        },
        windowSet(msg) {
            const p = panes.get(msg.id) || { lines: [] };
            p.dock = String(msg.dock);
            p.size = Math.max(0, msg.size | 0);
            p.priority = msg.priority | 0;
            p.visible = !!msg.visible;
            panes.set(msg.id, p);
            render();
        },
        windowUpdate(msg) {
            const p = panes.get(msg.id);
            // An update for an undeclared pane is dropped (window_set always
            // precedes window_update in a sync).
            if (!p) return;
            p.lines = msg.lines || [];
            render();
        },
        requestLine(prompt, deliver) {
            pendingPrompt = { prompt: prompt == null ? "" : String(prompt), deliver };
            // If the turn's output is still being paged through, hold the prompt until
            // the player catches up; otherwise show it immediately.
            if (more) render();
            else activatePendingPrompt();
        },
    };
}

module.exports = { createTuiBackend, wrapLine, textWidth };
