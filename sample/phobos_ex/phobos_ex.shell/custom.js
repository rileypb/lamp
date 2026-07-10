// Phobos EX custom shell (devdocs/custom-shells.md): the responsive bottom-strip
// UI — the DECK PLAN map and the KIM hacking simulator, stacked under the
// transcript, which contracts/expands to make room. Both are pure presentation:
// whole state arrives from the game each turn ("map" / "kim" events), so
// UNDO/RESTORE just repaint, and every click synthesizes a command the player
// could type (LampShell.command), so the real game rules adjudicate it and the
// transcript stays a complete record. While the KIM is adhered the map collapses
// to a slim header bar (tap to peek); it re-expands when the KIM retracts.
(function () {
    "use strict";

    const screen = document.getElementById("screen");
    if (!screen || !window.LampShell) return;

    // --- DECK PLAN (fog-of-war map) -----------------------------------------
    // Payload: "hc,hr|c,r,flags,cmd,label;...|c1,r1,c2,r2;..." (map.lamp).
    // Rooms render as cells in a CSS grid; corridors as thin connector divs
    // spanning the cells they join (grid placement does the geometry). Frontier
    // cells (adjacent, unseen) are dashed "?" cells — clickable, label-less.

    const mapPanel = document.createElement("div");
    mapPanel.id = "map-panel";
    mapPanel.hidden = true;
    screen.appendChild(mapPanel);

    const mapHeader = document.createElement("div");
    mapHeader.className = "map-header";
    mapHeader.textContent = "DECK PLAN";
    mapHeader.addEventListener("click", () => {
        // While collapsed under an open KIM, tapping the header peeks the map.
        if (mapPanel.classList.contains("map-collapsed")) {
            mapPanel.classList.toggle("map-peek");
        }
    });
    mapPanel.appendChild(mapHeader);

    const mapGrid = document.createElement("div");
    mapGrid.className = "map-grid";
    mapPanel.appendChild(mapGrid);

    let lastMapPayload = null;

    function renderMap(payload) {
        const [, roomsField, edgesField] = payload.split("|");
        mapGrid.textContent = "";
        const rooms = roomsField ? roomsField.split(";") : [];
        if (rooms.length === 0) {
            mapPanel.hidden = true;
            return;
        }
        mapPanel.hidden = false;

        // Corridors first, so cells paint over their ends.
        for (const e of (edgesField ? edgesField.split(";") : [])) {
            const [c1, r1, c2, r2] = e.split(",").map(Number);
            const seg = document.createElement("div");
            seg.className = c1 === c2 ? "map-edge map-edge-v" : "map-edge map-edge-h";
            seg.style.gridColumn = `${Math.min(c1, c2) + 1} / ${Math.max(c1, c2) + 2}`;
            seg.style.gridRow = `${Math.min(r1, r2) + 1} / ${Math.max(r1, r2) + 2}`;
            mapGrid.appendChild(seg);
        }

        for (const roomSpec of rooms) {
            // label is last and may contain nothing; split with a limit-safe slice.
            const parts = roomSpec.split(",");
            const c = Number(parts[0]);
            const r = Number(parts[1]);
            const flags = parts[2];
            const cmd = parts[3];
            const label = parts.slice(4).join(",");
            const cell = document.createElement(cmd ? "button" : "div");
            if (cmd) {
                cell.type = "button";
                cell.addEventListener("click", () => window.LampShell.command(cmd));
                cell.setAttribute("aria-label", `walk ${cmd}`);
            }
            cell.className = `map-cell map-${flags === "h" ? "here" : flags === "s" ? "seen" : "frontier"}`;
            cell.style.gridColumn = String(c + 1);
            cell.style.gridRow = String(r + 1);
            cell.textContent = flags === "f" ? "?" : label;
            if (flags === "h") {
                const dot = document.createElement("span");
                dot.className = "map-you";
                cell.appendChild(dot);
            }
            mapGrid.appendChild(cell);
        }
    }

    window.LampShell.on("map", (payload) => {
        if (payload === lastMapPayload) return;
        lastMapPayload = payload;
        renderMap(payload);
    });

    // --- KIM hacking simulator ----------------------------------------------
    // Payload protocol in lib/phobos/kim_shell.lamp. The solving press's final
    // board rides the "solved|" transient so the last lights visibly complete
    // before the pulse and retract.

    const panel = document.createElement("div");
    panel.id = "kim-panel";
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "KIM hacking interface");
    screen.appendChild(panel);

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

    function span(cls, text) {
        const el = document.createElement("span");
        el.className = cls;
        el.textContent = text;
        return el;
    }

    function makeButton(labelParts, lit, cmd) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `kim-btn ${lit ? "kim-lit" : "kim-dark"}`;
        for (const part of labelParts) b.appendChild(part);
        b.addEventListener("click", () => {
            b.classList.add("kim-pressed");
            window.LampShell.command(cmd);
        });
        return b;
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
            reset.addEventListener("click", () => window.LampShell.command("reset"));
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
        // The map yields to the KIM: collapse to the header bar while hacking.
        mapPanel.classList.add("map-collapsed");
        mapPanel.classList.remove("map-peek");
    }

    function hide() {
        panel.classList.remove("kim-open", "kim-solved", "kim-shake");
        mapPanel.classList.remove("map-collapsed", "map-peek");
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
