#!/usr/bin/env node
// Unit tests for the transcript (scripting) *mechanism* — the runtime half of the
// SCRIPT/TRANSCRIPT feature: the start/stop/query primitives, the host-channel seam,
// and the output/input capture hooks (devdocs/state.md → Transcript). The verb words,
// the filename prompt, and the wording live in lib/advent and are covered end-to-end by
// the `transcript1` golden; this file drives the primitives directly.
// Run with: node tests/transcript/run-transcript.js

const assert = require("assert");
const lamp = require("../../src/lamplighter");

let failures = 0;
function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (err) {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(`  ${err.stack || err.message}`);
    }
}

lamp.bootstrapBuiltins();
lamp.defineType("thing", ["object"], {});
lamp.defineType("game", ["object"], {});
lamp.createObject("game", "ScriptDemo", { author: "Me" });

// A recording transcript channel, reset before each scenario. `start` can be made to
// fail by passing a non-"ok" status; the host write/stop are captured.
let recorder;
function install({ startStatus = "ok" } = {}) {
    // Force a clean off-state: transcriptActive is module-global and persists across
    // tests in this process, so a prior scenario could leave a transcript open.
    lamp.transcriptStop();
    recorder = { started: null, chunks: [], stopped: false };
    lamp.setWrite(() => {});
    lamp.setTranscriptChannel({
        start(key) { recorder.started = key; return startStatus; },
        write(text) { recorder.chunks.push(text); },
        stop() { recorder.stopped = true; },
    });
}

test("transcriptStart opens the channel with a game-namespaced key and reports running", () => {
    install();
    assert.strictEqual(lamp.transcriptRunning(), false);
    assert.strictEqual(lamp.transcriptStart("myfile"), true);
    assert.strictEqual(recorder.started, "ScriptDemo__myfile");
    assert.strictEqual(lamp.transcriptRunning(), true);
});

test("output is mirrored into the transcript while running, and not after stop", () => {
    install();
    lamp.transcriptStart("f");
    lamp.print("hello world");
    lamp.flushOutput();
    assert.ok(recorder.chunks.join("").includes("hello world"), "output captured while running");
    lamp.transcriptStop();
    assert.strictEqual(recorder.stopped, true);
    const before = recorder.chunks.length;
    lamp.print("after off");
    lamp.flushOutput();
    assert.strictEqual(recorder.chunks.length, before, "no capture after stop");
});

test("the player's prompt and typed line are mirrored (input bypasses the output stream)", () => {
    install();
    lamp.setPromptChannel(() => "take coin");
    lamp.transcriptStart("f");
    lamp.promptLine("> ");
    assert.ok(recorder.chunks.join("").includes("> take coin\n"), "prompt + input captured");
});

test("transcriptStart returns false when already running (channel untouched)", () => {
    install();
    lamp.transcriptStart("first");
    recorder.started = null;
    assert.strictEqual(lamp.transcriptStart("second"), false);
    assert.strictEqual(recorder.started, null, "no re-open");
});

test("transcriptStop on a stopped transcript is a no-op", () => {
    install();
    lamp.transcriptStop();
    assert.strictEqual(recorder.stopped, false);
    assert.strictEqual(lamp.transcriptRunning(), false);
});

test("a host start error reports false and leaves capture off", () => {
    install({ startStatus: "error: disk full" });
    assert.strictEqual(lamp.transcriptStart("f"), false);
    assert.strictEqual(lamp.transcriptRunning(), false);
    const before = recorder.chunks.length;
    lamp.print("nope");
    lamp.flushOutput();
    assert.strictEqual(recorder.chunks.length, before, "no capture after a failed open");
});

test("a write failure mid-session drops the transcript silently", () => {
    install();
    lamp.setTranscriptChannel({
        start() { return "ok"; },
        write() { throw new Error("disk gone"); },
        stop() {},
    });
    lamp.transcriptStart("f");
    assert.strictEqual(lamp.transcriptRunning(), true);
    lamp.print("triggers the failing write");
    lamp.flushOutput();
    assert.strictEqual(lamp.transcriptRunning(), false, "capture turned off after a write error");
});

test("transcriptAvailable reflects whether a channel is installed", () => {
    install();
    assert.strictEqual(lamp.transcriptAvailable(), true);
    lamp.setTranscriptChannel(null);
    assert.strictEqual(lamp.transcriptAvailable(), false);
    assert.strictEqual(lamp.transcriptStart("f"), false, "no channel → start fails");
});

if (failures === 0) {
    console.log("\nAll transcript tests passed.");
} else {
    console.error(`\n${failures} transcript test(s) failed.`);
    process.exit(1);
}
