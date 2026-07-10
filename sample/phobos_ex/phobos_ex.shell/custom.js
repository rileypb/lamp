// Phobos EX — the KIM hacking simulator (devdocs/custom-shells.md; the first
// real custom-shell consumer). Renders the "kim" events from
// lib/phobos/kim_shell.lamp as a bottom-strip device: the fiction's featureless
// black slab, lit with red/blue buttons and Siriusian glyphs. Every click
// synthesizes the same PRESS command the player could type (LampShell.command),
// so the game's real puzzle rules adjudicate it and the transcript stays a
// complete record. The panel is pure presentation: all state arrives whole from
// the game each turn, so UNDO/RESTORE just repaint it.
(function () {
    "use strict";

    const screen = document.getElementById("screen");
    const moreBar = document.getElementById("more-bar");
    if (!screen || !window.LampShell) return;

    const panel = document.createElement("div");
    panel.id = "kim-panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "KIM hacking interface");
    screen.insertBefore(panel, moreBar);

    const TARGET_LABELS = {
        yellow: "YELLOW SCANNER",
        red: "RED SCANNER",
        blue: "BLUE SCANNER",
        purple: "PURPLE SCANNER",
        locker: "LOCKER",
    };

    let lastPayload = null;
    let lastFlash = false;
    let retractTimer = null;

    function press(cmd) {
        return () => window.LampShell.command(cmd);
    }

    function makeButton(labelHtmlParts, lit, cmd) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `kim-btn ${lit ? "kim-lit" : "kim-dark"}`;
        for (const part of labelHtmlParts) b.appendChild(part);
        b.addEventListener("click", (e) => {
            b.classList.add("kim-pressed");
            press(cmd)();
        });
        return b;
    }

    function span(cls, text) {
        const el = document.createElement("span");
        el.className = cls;
        el.textContent = text;
        return el;
    }

    function render(payload) {
        const fields = payload.split("|");
        const kind = fields[0];
        const target = fields[1];
        const states = fields[2] || "";
        const flash = fields[fields.length - 1] === "flash";

        panel.textContent = "";
        panel.classList.remove("kim-solved");

        const header = document.createElement("div");
        header.className = "kim-header";
        header.appendChild(span("kim-name", "K I M"));
        header.appendChild(span("kim-target", TARGET_LABELS[target] || ""));
        panel.appendChild(header);

        const grid = document.createElement("div");
        grid.className = `kim-grid kim-grid-${kind}`;

        const lit = (i) => states[i] === "B";

        if (kind === "blue") {
            const labels = (fields[3] || "").split(",");
            for (let i = 0; i < 9; i += 1) {
                grid.appendChild(makeButton(
                    [span("kim-glyph", labels[i] || "?"), span("kim-pos", String(i + 1))],
                    lit(i), `press ${i + 1}`));
            }
        } else if (kind === "16") {
            const glyphs = (fields[3] || "").split(",");
            for (let i = 0; i < 16; i += 1) {
                grid.appendChild(makeButton(
                    [span("kim-num", String(i + 1)), span("kim-glyph", glyphs[i] || "?")],
                    lit(i), `press ${i + 1}`));
            }
        } else {
            const count = kind === "4" ? 4 : 9;
            for (let i = 0; i < count; i += 1) {
                grid.appendChild(makeButton(
                    [span("kim-num", String(i + 1))],
                    lit(i), `press ${i + 1}`));
            }
        }
        panel.appendChild(grid);

        // The blue door's sort-by-swap keypad has no RESET, matching the fiction.
        if (kind !== "blue") {
            const reset = document.createElement("button");
            reset.type = "button";
            reset.className = "kim-btn kim-reset";
            reset.textContent = "RESET";
            reset.addEventListener("click", press("reset"));
            panel.appendChild(reset);
        }

        show();
        // The wrong-five reset (purple door): shake once when the flag first
        // appears; identical payloads are skipped upstream, and the flag clears
        // on the next press, so this fires exactly once per beep.
        if (flash && !lastFlash) {
            panel.classList.remove("kim-shake");
            void panel.offsetWidth; // restart the animation
            panel.classList.add("kim-shake");
        }
        lastFlash = flash;
    }

    function show() {
        if (retractTimer) {
            clearTimeout(retractTimer);
            retractTimer = null;
        }
        panel.classList.add("kim-open");
    }

    function hide() {
        panel.classList.remove("kim-open", "kim-solved", "kim-shake");
        lastFlash = false;
    }

    // Solve: the payload carries the FINAL board (the solving press's state never
    // reaches a normal refresh — the KIM detaches the same turn), so the last
    // lights visibly complete, then the slab pulses and retracts.
    function solvePulse(boardFields) {
        if (boardFields) render(boardFields);
        panel.classList.add("kim-solved");
        retractTimer = setTimeout(hide, 1400);
    }

    window.LampShell.on("kim", (payload) => {
        if (payload === lastPayload) return;
        lastPayload = payload;
        if (payload === "off") hide();
        else if (payload.startsWith("solved")) solvePulse(payload.slice("solved|".length));
        else render(payload);
    });
})();
