// Plain stdio render backend (the default / fallback).
//
// One of two interchangeable host render backends behind a common interface
// (see below); this one reproduces the original scrolling-stdio behavior and is
// used whenever stdout/stdin are not a TTY — pipes, redirection, the golden test
// harness — so captured output stays plain and deterministic. The TUI backend
// (backends/tui.js) is the interactive-terminal alternative. See devdocs/sandbox.md.
//
// Render-backend interface (both backends implement it; the host drives it):
//   start()                  set up the display (no-op here)
//   stop()                   restore the terminal (no-op here); must be idempotent
//   write(value, styles)     render one game output segment
//   log(value)               render a bridged console/diagnostic line
//   setStatus(left, right)   update the status line (no status region here → ignored)
//   requestLine(prompt, deliver)
//                            obtain one line of input. `prompt` is a string to show
//                            first, or null for a bare read. Call deliver(line) when
//                            the line is ready — synchronously here; an event-driven
//                            backend may call it later.

// Type-style → ANSI SGR mapping (text.md I3). Only applied to a TTY; piped output
// (tests, redirection) stays plain so styling is never baked into captured text.
// Fixed-width has no SGR code — a terminal is already monospace, so it is a no-op
// (fail-silently). An unknown style maps to nothing and is dropped.
const ANSI_SGR = { bold: 1, italic: 3 };
function renderStyledSegment(value, styles, isTty) {
    if (!isTty || !styles || styles.length === 0) return value;
    const codes = styles.map((s) => ANSI_SGR[s]).filter((c) => c != null);
    if (codes.length === 0) return value;
    return `\x1b[${codes.join(";")}m${value}\x1b[0m`;
}

// Read one line from the host's stdin, byte by byte. The host is trusted and
// owns fd 0; the sandboxed game cannot touch it directly. The terminal's own
// cooked mode handles echo and line editing on a TTY. Bytes are accumulated and
// decoded as UTF-8 once at end of line — decoding each byte alone would mangle a
// multi-byte character (e.g. "é"). A newline (0x0A) never occurs inside a UTF-8
// multi-byte sequence (continuation bytes are 0x80-0xBF), so scanning for it
// byte-wise is safe.
function readStdinLine(fs) {
    const byte = Buffer.alloc(1);
    const bytes = [];
    while (true) {
        let n;
        try {
            n = fs.readSync(0, byte, 0, 1);
        } catch (err) {
            if (err.code === "EAGAIN") continue;
            throw err;
        }
        if (n === 0) break;
        if (byte[0] === 0x0a) break;
        bytes.push(byte[0]);
    }
    return Buffer.from(bytes).toString("utf8");
}

function createPlainBackend({ out, err, fs }) {
    // Paginate ("[more]") only on an interactive terminal. Piped/redirected/test runs
    // (no TTY on either side) stream straight through, so captured output is unchanged
    // and nothing blocks waiting for a keypress.
    const paginate = !!(out.isTTY && process.stdin.isTTY);
    // Track the cursor's screen position so the page counter reflects *wrapped* rows,
    // not just newlines — phobos's paragraphs are single long lines that wrap to many
    // rows, so counting newlines alone wildly overshoots a screen.
    let col = 0;
    let rowsOnPage = 0;

    function pageLimit() {
        // Reserve two rows: one for the [more] line, one for the scroll the bottom-row
        // Enter causes in cooked mode (otherwise the first content row scrolls off).
        return Math.max(1, (out.rows || 24) - 2);
    }

    // Wait at a full page: show [more], block for Enter (cooked mode — no raw keypress
    // on this path), then erase the prompt line and reset the page counter. `freshLine`
    // is true when the cursor already sits at the start of a blank row (after a "\n");
    // when false (we paused at a wrap boundary, cursor at the row's end) emit the break
    // first — it lands exactly where the terminal would have wrapped, so it is invisible.
    function morePause(freshLine) {
        if (!freshLine) out.write("\n");
        out.write("[more]");
        readStdinLine(fs);
        out.write("\x1b[1A\r\x1b[2K"); // up over the echoed newline, clear the [more] line
        col = 0;
        rowsOnPage = 0;
    }

    function endRow(freshLine) {
        rowsOnPage += 1;
        col = 0;
        if (rowsOnPage >= pageLimit()) morePause(freshLine);
    }

    function writePaged(value, styles) {
        if (!paginate) {
            out.write(renderStyledSegment(value, styles, out.isTTY));
            return;
        }
        const cols = Math.max(1, out.columns || 80);
        const s = String(value);
        let chunkStart = 0;
        const flush = (end) => {
            if (end > chunkStart) out.write(renderStyledSegment(s.slice(chunkStart, end), styles, out.isTTY));
            chunkStart = end;
        };
        for (let i = 0; i < s.length; i += 1) {
            if (s[i] === "\n") {
                flush(i + 1); // include the newline; cursor is now at a fresh row start
                endRow(true);
            } else {
                if (col >= cols) { // the terminal will autowrap before this char
                    flush(i);
                    endRow(false);
                }
                col += 1;
            }
        }
        flush(s.length);
    }

    return {
        start() {},
        stop() {},
        write(value, styles) {
            writePaged(value, styles);
        },
        log(value) {
            err.write(`${value}\n`);
        },
        setStatus() {
            // Plain stdio has no status region; the status update is ignored.
        },
        requestLine(prompt, deliver) {
            col = 0; // the prompt/echo leaves the cursor on a fresh line
            rowsOnPage = 0; // a new turn starts a fresh page budget
            if (prompt != null) {
                out.write(prompt);
                const line = readStdinLine(fs);
                // Echo the typed line only when input is not a TTY (piped/test): a
                // real terminal already echoes it, but a captured run must record it.
                if (!process.stdin.isTTY) out.write(`${line}\n`);
                deliver(line);
            } else {
                deliver(readStdinLine(fs));
            }
        },
    };
}

module.exports = { createPlainBackend };
