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

// Read one line from the host's stdin, character by character. The host is
// trusted and owns fd 0; the sandboxed game cannot touch it directly. The
// terminal's own cooked mode handles echo and line editing on a TTY.
function readStdinLine(fs) {
    const buf = Buffer.alloc(1);
    let line = "";
    while (true) {
        let n;
        try {
            n = fs.readSync(0, buf, 0, 1);
        } catch (err) {
            if (err.code === "EAGAIN") continue;
            throw err;
        }
        if (n === 0) break;
        const ch = buf.toString("utf8", 0, 1);
        if (ch === "\n") break;
        line += ch;
    }
    return line;
}

function createPlainBackend({ out, err, fs }) {
    return {
        start() {},
        stop() {},
        write(value, styles) {
            out.write(renderStyledSegment(value, styles, out.isTTY));
        },
        log(value) {
            err.write(`${value}\n`);
        },
        setStatus() {
            // Plain stdio has no status region; the status update is ignored.
        },
        requestLine(prompt, deliver) {
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
