// Browser host shell (main thread).
//
// The browser counterpart of the stdio host (src/lamplighter/sandbox/host.js).
// It spawns the bundled game worker, hands it the shared input buffer via an
// `init` message, relays the worker's channels to the page, and services input
// requests by capturing one line from the player and filling the shared buffer.
//
// The host never blocks: the worker blocks on `Atomics.wait` for input while the
// main thread stays responsive and resolves the request asynchronously when the
// player submits. The host contains no game logic. See devdocs/sandbox.md.

(function () {
    "use strict";

    // Shared input buffer, byte-for-byte identical to the stdio host: 8-byte
    // header (ctrl[0] ready flag, ctrl[1] byte length) then UTF-8 line data.
    const INPUT_BUFFER_BYTES = 64 * 1024;
    const INPUT_DATA_OFFSET = 8;
    // Save transport buffer (host→worker replies): sized for whole save blobs.
    const SAVE_BUFFER_BYTES = 4 * 1024 * 1024;
    // localStorage key prefix; the runtime already namespaces the key by game.
    const SAVE_KEY_PREFIX = "lamp:save:";
    const WORKER_URL = "./game.worker.js";

    const transcript = document.getElementById("transcript");
    const inputLine = document.getElementById("input-line");
    const statusBar = document.getElementById("status-bar");
    const statusLeft = document.getElementById("status-left");
    const statusRight = document.getElementById("status-right");
    const moreBar = document.getElementById("more-bar");
    const winContainers = {
        top: document.getElementById("win-top"),
        bottom: document.getElementById("win-bottom"),
        left: document.getElementById("win-left"),
        right: document.getElementById("win-right"),
    };

    const encoder = new TextEncoder();

    // Pagination ("[more]"): when a turn's output overflows the transcript viewport,
    // pause and reveal it a screenful at a time. `ackHeight` is the content height (px)
    // the player has acknowledged seeing; `paged` is the paused state; an input request
    // arriving mid-page is held until the player catches up. Output keeps appending to
    // the DOM below the fold while paused — paging only controls scroll + the prompt.
    let ackHeight = 0;
    let paged = false;
    let promptDeferred = false;
    let deferredPromptText = null;

    // The input element is the permanent tail of the transcript; all output is
    // inserted before it so the input always sits inline after the last output.
    // Output renders as text nodes only — never innerHTML — even though the text
    // is the author's own. Defense in depth, per the sandbox output channel rule.
    function appendText(value) {
        insertOutput(document.createTextNode(value));
    }

    // Game output carrying type styles (text.md I3). Each style maps to a CSS class
    // on a span; textContent only, never innerHTML (the styles are a closed set the
    // runtime names, not author markup). Unknown styles yield an unmatched class and
    // render plain (fail-silently). Plain text takes the text-node fast path.
    function appendStyled(value, styles) {
        if (!styles || styles.length === 0) {
            appendText(value);
            return;
        }
        const span = document.createElement("span");
        span.className = styles.map((s) => `style-${s}`).join(" ");
        span.textContent = value;
        insertOutput(span);
    }

    // Insert one run of game output, then decide whether to keep scrolling to the
    // bottom or pause: if more than a viewport of output is unseen (and we are not
    // awaiting input), enter the [more] pause. While paused, output keeps appending
    // below the fold — the player scrolls down through it a page at a time.
    function insertOutput(node) {
        transcript.insertBefore(node, inputLine);
        if (paged) return;
        if (!awaitingInput && transcript.scrollHeight - ackHeight > transcript.clientHeight) {
            enterPaged();
        } else {
            scrollToBottom();
        }
    }

    function appendClassed(value, className) {
        const span = document.createElement("span");
        span.className = className;
        transcript.insertBefore(span, inputLine);
        span.textContent = value;
        if (!paged) scrollToBottom();
    }

    function scrollToBottom() {
        transcript.scrollTop = transcript.scrollHeight;
    }

    // Mobile virtual keyboard: iOS (and Androids ignoring the interactive-widget
    // viewport hint) overlays the keyboard without shrinking the layout viewport,
    // so the transcript tail — newest output, prompt, input — sits behind it, and
    // the browser's own pan to the focused field snaps away on blur (Enter disables
    // the input). Compensate by pinning #screen to the visual viewport: size it to
    // the visible height and translate it to the visible region, so the transcript's
    // scroll bottom lands above the keyboard. Re-pin the scroll only if it was
    // already at the bottom — a resize must not yank a player reading scrollback
    // (same rule as the transcript click handler). Skipped while pinch-zoomed:
    // offsetTop then reflects the player's panning, not the keyboard.
    const screenEl = document.getElementById("screen");
    if (window.visualViewport) {
        const vv = window.visualViewport;
        const syncToVisualViewport = () => {
            const wasAtBottom =
                transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 2;
            const layoutHeight = document.documentElement.clientHeight;
            if (vv.scale > 1.01 || layoutHeight - vv.height < 1) {
                screenEl.style.height = "";
                screenEl.style.transform = "";
            } else {
                screenEl.style.height = `${vv.height}px`;
                screenEl.style.transform = `translateY(${vv.offsetTop}px)`;
            }
            if (wasAtBottom && !paged) scrollToBottom();
        };
        vv.addEventListener("resize", syncToVisualViewport);
        vv.addEventListener("scroll", syncToVisualViewport);
    }

    // Show the [more] bar and scroll so the first unseen page sits at the top of the
    // viewport. Showing the bar shrinks the scroll area, so read the viewport after.
    function enterPaged() {
        paged = true;
        moreBar.hidden = false;
        transcript.scrollTop = ackHeight;
    }

    // Advance one screenful at a [more] pause. When the player catches up, leave paged
    // mode and, if an input request was deferred, show it now.
    function advancePage() {
        if (!paged) return;
        ackHeight = Math.min(transcript.scrollHeight, ackHeight + transcript.clientHeight);
        if (transcript.scrollHeight - ackHeight > transcript.clientHeight) {
            transcript.scrollTop = ackHeight; // next page
        } else {
            resumeFromPager();
        }
    }

    // Leave paged mode: hide [more], mark everything seen, and release any deferred
    // input request. Called when the player advances to the end or scrolls there.
    function resumeFromPager() {
        paged = false;
        moreBar.hidden = true;
        ackHeight = transcript.scrollHeight;
        scrollToBottom();
        if (promptDeferred) {
            promptDeferred = false;
            if (deferredPromptText != null) appendClassed(deferredPromptText, "prompt-text");
            deferredPromptText = null;
            ackHeight = transcript.scrollHeight;
            requestInput();
        }
    }

    // Show an input request, unless the turn's output is still being paged through — in
    // that case hold it until the player catches up. `promptText` is the prompt string
    // to echo (prompt_readline) or null (bare readline).
    function requestInputPaged(promptText) {
        if (paged) {
            promptDeferred = true;
            deferredPromptText = promptText;
            return;
        }
        if (promptText != null) appendClassed(promptText, "prompt-text");
        ackHeight = transcript.scrollHeight; // everything shown is now seen
        requestInput();
    }

    // Cross-origin isolation is required for SharedArrayBuffer. Without it (no
    // service worker yet, or a host that strips the headers) there is no
    // synchronous input channel, so refuse to start rather than fail obscurely.
    if (!self.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") {
        appendClassed(
            "This page is not cross-origin isolated, so the game cannot run. " +
                "Serve it with COOP/COEP headers (the bundled service worker " +
                "provides these once installed).\n",
            "shell-error"
        );
        return;
    }

    const inputBuffer = new SharedArrayBuffer(INPUT_BUFFER_BYTES);
    const ctrl = new Int32Array(inputBuffer, 0, 2);
    const data = new Uint8Array(inputBuffer, INPUT_DATA_OFFSET);
    const dataCapacity = INPUT_BUFFER_BYTES - INPUT_DATA_OFFSET;

    // At most one input request is outstanding at a time (the worker blocks until
    // it is satisfied). `awaitingInput` gates the submit handler so stray keypresses
    // before a request are ignored.
    let awaitingInput = false;

    function requestInput() {
        awaitingInput = true;
        inputLine.disabled = false;
        // Scrolling is owned by the explicit scrollToBottom calls (the prompt/output
        // that precede this already scrolled); focus itself must never move the view.
        inputLine.focus({ preventScroll: true });
    }

    function deliverLine(line) {
        const bytes = encoder.encode(line);
        const len = Math.min(bytes.length, dataCapacity);
        data.set(bytes.subarray(0, len), 0);
        Atomics.store(ctrl, 1, len);
        Atomics.store(ctrl, 0, 1);
        Atomics.notify(ctrl, 0);
    }

    // Save storage: a second shared buffer for the worker's brokered save/restore.
    // localStorage is synchronous, so a request is satisfied inline and the worker
    // (blocked on Atomics.wait) is released immediately. A length of -1 is the
    // "no such save" sentinel; the blob is opaque (obfuscated by the runtime).
    const saveBuffer = new SharedArrayBuffer(SAVE_BUFFER_BYTES);
    const sctrl = new Int32Array(saveBuffer, 0, 2);
    const sdata = new Uint8Array(saveBuffer, INPUT_DATA_OFFSET);
    const saveCapacity = SAVE_BUFFER_BYTES - INPUT_DATA_OFFSET;

    function replySave(text) {
        if (text === null) {
            Atomics.store(sctrl, 1, -1);
        } else {
            const bytes = encoder.encode(text);
            const len = Math.min(bytes.length, saveCapacity);
            sdata.set(bytes.subarray(0, len), 0);
            Atomics.store(sctrl, 1, len);
        }
        Atomics.store(sctrl, 0, 1);
        Atomics.notify(sctrl, 0);
    }

    // Transcript (SCRIPT/TRANSCRIPT): the browser has no working directory to drop a
    // file into, so the shell accumulates the mirrored text in memory and offers it as
    // a .txt download when the transcript closes (SCRIPT OFF, or the game ending with
    // one still open — the parity of the CLI host closing its stream on worker exit).
    // A page closed mid-transcript loses the accumulation; documented limitation.
    let transcriptName = null;
    let transcriptText = "";

    function downloadTranscript() {
        if (transcriptName === null) return;
        const blob = new Blob([transcriptText], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${transcriptName}.txt`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        transcriptName = null;
        transcriptText = "";
    }

    // Enumerate this game's saved slots from the metadata sidecars (keys
    // "<prefix>…#meta"), newest first. Reads only the unobfuscated meta, never the
    // blobs. Each row carries the blob storage key (the sidecar key minus the prefix
    // and the "#meta" suffix) so the restore picker can fetch the chosen blob.
    function listLocalSaves(prefix) {
        const metaPrefix = SAVE_KEY_PREFIX + prefix;
        const rows = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith(metaPrefix) || !k.endsWith("#meta")) continue;
            try {
                const meta = JSON.parse(localStorage.getItem(k));
                rows.push({ key: k.slice(SAVE_KEY_PREFIX.length, -"#meta".length), meta });
            } catch (e) {
                // Skip a corrupt sidecar rather than fail the whole list.
            }
        }
        rows.sort((a, b) => String(b.meta.savedAt).localeCompare(String(a.meta.savedAt)));
        return rows;
    }

    // --- Text-window panes (devdocs/text-windows.md) -----------------------
    // The game composes pane content; the shell only docks, sizes, and paints it.
    // window_set is idempotent (re-sent each sync) and carries the arrangement;
    // window_update replaces the pane's whole content. Everything renders via
    // textContent — pane text is game output and follows the same no-innerHTML
    // rule as the transcript.
    const panes = new Map(); // id → { el, titleEl, content }
    // A fill run's single char repeated enough to cross any pane; .pane-fill clips
    // the excess, so the run visually fills the line's slack (rules, dot leaders,
    // the left/right split).
    const FILL_REPEAT = 256;

    function paneFor(id) {
        let pane = panes.get(id);
        if (pane) return pane;
        const el = document.createElement("div");
        el.className = "pane";
        el.setAttribute("role", "complementary");
        const titleEl = document.createElement("div");
        titleEl.className = "pane-title";
        titleEl.hidden = true;
        const content = document.createElement("div");
        content.className = "pane-content";
        el.appendChild(titleEl);
        el.appendChild(content);
        pane = { el, titleEl, content };
        panes.set(id, pane);
        return pane;
    }

    function applyWindowSet(msg) {
        const pane = paneFor(msg.id);
        const container = winContainers[msg.dock];
        if (!container) return; // unknown dock: leave the pane unattached (fail-silently)
        if (pane.el.parentElement !== container) container.appendChild(pane.el);
        // Priority orders panes within a dock via flex `order`; the right/bottom
        // containers reverse their flex direction, so lower is nearer the edge on
        // every dock without re-sorting the DOM.
        pane.el.style.order = String(msg.priority || 0);
        pane.el.hidden = !msg.visible;
        const sideways = msg.dock === "left" || msg.dock === "right";
        pane.el.classList.toggle("pane-side", sideways);
        if (sideways) {
            // size = columns of the pane's own (monospace) text, plus its padding.
            pane.el.style.width = `calc(${msg.size}ch + 1rem)`;
            pane.el.style.height = "";
        } else {
            // size = rows at the pane line-height (1.4), plus vertical padding.
            pane.el.style.height = `calc(${msg.size * 1.4}em + 0.5rem)`;
            pane.el.style.width = "";
        }
        // The title renders as a header on side panes only — top/bottom rows are
        // reserved by `size`, and a header there would eat declared content rows.
        pane.titleEl.textContent = sideways ? msg.title || "" : "";
        pane.titleEl.hidden = !(sideways && msg.title);
        pane.el.setAttribute("aria-label", msg.title || msg.id);
        // Widen the play area while any side pane is visible, so the pane extends
        // the layout instead of eating the transcript's width (see shell.css).
        let anySide = false;
        for (const p of panes.values()) {
            if (!p.el.hidden && p.el.classList.contains("pane-side") && p.el.parentElement) anySide = true;
        }
        screenEl.classList.toggle("has-side-panes", anySide);
    }

    function applyWindowUpdate(msg) {
        const pane = paneFor(msg.id);
        pane.content.textContent = "";
        for (const line of msg.lines || []) {
            const lineEl = document.createElement("div");
            lineEl.className = "pane-line";
            for (const run of line) {
                const span = document.createElement("span");
                let cls = "pane-run";
                for (const s of run.styles || []) cls += ` style-${s}`;
                if (run.fill) cls += " pane-fill";
                else if (run.align === "right") cls += " pane-align-right";
                else if (run.align === "center") cls += " pane-align-center";
                span.className = cls;
                span.textContent = run.fill ? String(run.text).repeat(FILL_REPEAT) : run.text;
                lineEl.appendChild(span);
            }
            pane.content.appendChild(lineEl);
        }
    }

    const worker = new Worker(WORKER_URL);

    worker.addEventListener("message", (event) => {
        const msg = event.data;
        if (!msg) return;
        switch (msg.type) {
            case "write":
                appendStyled(msg.value, msg.styles);
                break;
            case "status":
                // Runtime-composed content; the shell only lays it out (left/right
                // in a fixed-width reverse bar). textContent only, never innerHTML.
                statusLeft.textContent = msg.left || "";
                statusRight.textContent = msg.right || "";
                statusBar.hidden = !(msg.left || msg.right);
                break;
            case "window_set":
                applyWindowSet(msg);
                break;
            case "window_update":
                applyWindowUpdate(msg);
                break;
            case "log":
                console.log(msg.value);
                break;
            case "readline":
                requestInputPaged(null);
                break;
            case "prompt_readline":
                requestInputPaged(msg.prompt);
                break;
            case "save_write":
                try {
                    localStorage.setItem(SAVE_KEY_PREFIX + msg.key, msg.data);
                    // Unobfuscated metadata sidecar: a save picker reads it to label
                    // slots without decoding the blob. See devdocs/sandbox.md.
                    if (msg.meta) {
                        localStorage.setItem(SAVE_KEY_PREFIX + msg.key + "#meta", JSON.stringify(msg.meta));
                    }
                    replySave("ok");
                } catch (e) {
                    replySave(`error: ${e && e.message ? e.message : "save failed"}`);
                }
                break;
            case "save_read":
                replySave(localStorage.getItem(SAVE_KEY_PREFIX + msg.key));
                break;
            case "save_list":
                replySave(JSON.stringify(listLocalSaves(msg.prefix).map((r) => r.meta)));
                break;
            case "save_prompt":
                showSaveModal(msg.prefix);
                break;
            case "restore_prompt":
                showRestoreModal(msg.prefix);
                break;
            case "transcript_start":
                transcriptName = msg.key;
                transcriptText = "";
                replySave("ok");
                break;
            case "transcript_write":
                if (transcriptName !== null) transcriptText += msg.data;
                break;
            case "transcript_stop":
                downloadTranscript();
                break;
            case "done":
                endGame(null);
                break;
            case "error":
                endGame(msg.message);
                break;
            default:
                break;
        }
    });

    worker.addEventListener("error", (event) => {
        endGame(event.message || "worker error");
    });

    inputLine.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        if (!awaitingInput) return;
        const line = inputLine.value;
        awaitingInput = false;
        inputLine.value = "";
        inputLine.disabled = true;
        // Echo the player's command onto the prompt line, then a newline, as a
        // parser game records the typed command above its response.
        appendClassed(`${line}\n`, "player-echo");
        deliverLine(line);
    });

    // At a [more] pause, any key advances a page (the input field is disabled then, so
    // a document-level listener is needed). A modal owns its own keys, so ignore keys
    // while one is open.
    document.addEventListener("keydown", (event) => {
        if (!paged || activeModal) return;
        event.preventDefault();
        advancePage();
    });
    moreBar.addEventListener("click", advancePage);

    // If the player scrolls (wheel/drag) to the very bottom on their own, they've seen
    // it all — dismiss [more]. While paged the auto-scroll always leaves the content
    // bottom below the viewport, so only a deliberate scroll-to-end trips this.
    transcript.addEventListener("scroll", () => {
        if (!paged) return;
        if (transcript.scrollTop + transcript.clientHeight >= transcript.scrollHeight - 2) {
            resumeFromPager();
        }
    });

    // Clicking the transcript advances the pager while paused, otherwise focuses the
    // input while it is awaited (so the player need not aim for the inline field).
    // preventScroll: the click routes keystrokes to the input, it must not yank a
    // player who scrolled up back to the bottom (submitting a line still does, via
    // the echo's scrollToBottom).
    transcript.addEventListener("click", () => {
        if (paged) {
            advancePage();
        } else if (awaitingInput && window.getSelection().isCollapsed) {
            inputLine.focus({ preventScroll: true });
        }
    });

    function endGame(errorMessage) {
        // A transcript still open when the game ends is delivered rather than lost —
        // the same closure the CLI host does on worker exit.
        downloadTranscript();
        // Drop any [more] pause so the final message is shown, not hidden below a fold.
        paged = false;
        promptDeferred = false;
        moreBar.hidden = true;
        awaitingInput = false;
        inputLine.disabled = true;
        if (errorMessage) {
            appendClassed(`\n[error: ${errorMessage}]\n`, "shell-error");
        } else {
            appendClassed("\n[The game has ended.]\n", "shell-notice");
        }
    }

    // --- Save / restore modals (deferred-reply host UX) ---------------------
    // The worker blocks on Atomics.wait while a modal is open; we replySave only
    // when the player resolves it (confirm → payload, cancel → null sentinel). At
    // most one save-channel request is outstanding, so a single modal suffices.
    let activeModal = null;

    function closeModal() {
        if (activeModal) {
            activeModal.remove();
            activeModal = null;
        }
    }

    function resolveModal(payload) {
        closeModal();
        // preventScroll for the same reason as the transcript click handler: closing
        // an overlay must not move the view the player had.
        if (awaitingInput) inputLine.focus({ preventScroll: true });
        replySave(payload);
    }

    function fmtMeta(meta) {
        let when = meta.savedAt;
        try {
            when = new Date(meta.savedAt).toLocaleString();
        } catch (e) {
            // Fall back to the raw ISO string.
        }
        const turns = meta.turns;
        return `${when} · ${turns} turn${turns === 1 ? "" : "s"}`;
    }

    function buildDialog(titleText) {
        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        const dialog = document.createElement("div");
        dialog.className = "modal-dialog";
        dialog.setAttribute("role", "dialog");
        dialog.setAttribute("aria-modal", "true");
        const title = document.createElement("h2");
        title.textContent = titleText;
        dialog.appendChild(title);
        overlay.appendChild(dialog);
        return { overlay, dialog };
    }

    function slotRow(row, onSelect, onDelete) {
        const item = document.createElement("div");
        item.className = "modal-slot";
        const name = document.createElement("span");
        name.className = "slot-name";
        name.textContent = row.meta.name;
        const meta = document.createElement("span");
        meta.className = "slot-meta";
        meta.textContent = fmtMeta(row.meta);
        item.appendChild(name);
        item.appendChild(meta);
        item.addEventListener("click", (e) => {
            if (e.target.closest(".slot-del")) return;
            onSelect();
        });
        if (onDelete) {
            const del = document.createElement("button");
            del.className = "slot-del";
            del.type = "button";
            del.title = "Delete save";
            del.setAttribute("aria-label", `Delete save ${row.meta.name}`);
            del.textContent = "🗑";
            del.addEventListener("click", (e) => {
                e.stopPropagation();
                onDelete();
            });
            item.appendChild(del);
        }
        return item;
    }

    function presentModal(overlay, onEscape, focusEl) {
        overlay.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onEscape();
            }
        });
        document.body.appendChild(overlay);
        activeModal = overlay;
        if (focusEl) focusEl.focus();
    }

    function showSaveModal(prefix) {
        closeModal();
        const existing = listLocalSaves(prefix);
        const { overlay, dialog } = buildDialog("Save game");

        const field = document.createElement("input");
        field.type = "text";
        field.className = "modal-field";
        field.setAttribute("aria-label", "Name for this save");
        field.autocomplete = "off";
        field.spellcheck = false;
        dialog.appendChild(field);

        const actions = document.createElement("div");
        actions.className = "modal-actions";
        const cancel = document.createElement("button");
        cancel.className = "modal-btn";
        cancel.type = "button";
        cancel.textContent = "Cancel";
        const confirm = document.createElement("button");
        confirm.className = "modal-btn primary";
        confirm.type = "button";

        function syncLabel() {
            const typed = field.value.trim().toLowerCase();
            const overwrite = existing.some((r) => String(r.meta.name).trim().toLowerCase() === typed);
            confirm.textContent = overwrite ? "Overwrite" : "Save";
        }

        if (existing.length) {
            const label = document.createElement("div");
            label.className = "modal-list-label";
            label.textContent = "Existing saves — click to overwrite:";
            dialog.appendChild(label);
            const list = document.createElement("div");
            list.className = "modal-slots";
            for (const row of existing) {
                list.appendChild(slotRow(row, () => {
                    field.value = row.meta.name;
                    syncLabel();
                    field.focus();
                }));
            }
            dialog.appendChild(list);
        }

        actions.appendChild(cancel);
        actions.appendChild(confirm);
        dialog.appendChild(actions);

        function submit() {
            const name = field.value.trim();
            if (!name) {
                field.focus();
                return;
            }
            resolveModal(JSON.stringify({ name }));
        }
        confirm.addEventListener("click", submit);
        cancel.addEventListener("click", () => resolveModal(null));
        field.addEventListener("input", syncLabel);
        field.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                submit();
            }
        });

        syncLabel();
        presentModal(overlay, () => resolveModal(null), field);
    }

    function showRestoreModal(prefix) {
        closeModal();
        const existing = listLocalSaves(prefix);
        const { overlay, dialog } = buildDialog("Restore game");

        const actions = document.createElement("div");
        actions.className = "modal-actions";
        const cancel = document.createElement("button");
        cancel.className = "modal-btn";
        cancel.type = "button";

        if (!existing.length) {
            const empty = document.createElement("div");
            empty.className = "modal-empty";
            empty.textContent = "No saved games for this story yet.";
            dialog.appendChild(empty);
            cancel.textContent = "OK";
            cancel.className = "modal-btn primary";
            cancel.addEventListener("click", () => resolveModal(null));
            actions.appendChild(cancel);
            dialog.appendChild(actions);
            presentModal(overlay, () => resolveModal(null), cancel);
            return;
        }

        let selected = existing[0];
        const rowEls = new Map();
        const list = document.createElement("div");
        list.className = "modal-slots";

        function select(row) {
            selected = row;
            for (const [r, el] of rowEls) el.classList.toggle("selected", r === row);
        }
        function deleteRow(row) {
            localStorage.removeItem(SAVE_KEY_PREFIX + row.key);
            localStorage.removeItem(SAVE_KEY_PREFIX + row.key + "#meta");
            // Rebuild from the now-smaller store (falls to the empty state if last).
            showRestoreModal(prefix);
        }
        for (const row of existing) {
            const el = slotRow(row, () => select(row), () => deleteRow(row));
            rowEls.set(row, el);
            list.appendChild(el);
        }
        dialog.appendChild(list);

        const confirm = document.createElement("button");
        confirm.className = "modal-btn primary";
        confirm.type = "button";
        confirm.textContent = "Restore";
        cancel.textContent = "Cancel";

        function submit() {
            if (!selected) return;
            resolveModal(localStorage.getItem(SAVE_KEY_PREFIX + selected.key));
        }
        confirm.addEventListener("click", submit);
        cancel.addEventListener("click", () => resolveModal(null));
        list.addEventListener("dblclick", (e) => {
            if (e.target.closest(".slot-del")) return;
            if (e.target.closest(".modal-slot")) submit();
        });

        actions.appendChild(cancel);
        actions.appendChild(confirm);
        dialog.appendChild(actions);

        select(selected);
        presentModal(overlay, () => resolveModal(null), confirm);
    }

    // Hand the worker the shared buffers; the bootstrap starts the game on receipt.
    // Capabilities ride the init message (the pre-loop delivery, so it never races
    // the worker blocking on input): this shell docks text-window panes on all four
    // edges. See devdocs/text-windows.md.
    worker.postMessage({
        type: "init",
        inputBuffer,
        saveBuffer,
        capabilities: { windows: { docks: ["top", "bottom", "left", "right"] } },
    });
})();
