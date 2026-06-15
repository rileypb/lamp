#!/usr/bin/env node
// Focused unit tests for src/lamplighter/sandbox/worker.js and host.js.
//
// Worker tests spawn the worker directly via worker_threads and assert on
// the message stream. Host tests call playFile() with mock streams. Run with:
//   npm run test:sandbox

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Worker } = require("worker_threads");
const { playFile } = require("../../src/lamplighter/sandbox/host");

const workerPath = path.join(__dirname, "../../src/lamplighter/sandbox/worker.js");

let failures = 0;

// ── helpers ──────────────────────────────────────────────────────────────────

function writeTempGame(code) {
    const name = `sandbox-test-${process.pid}-${Math.random().toString(36).slice(2)}.js`;
    const file = path.join(os.tmpdir(), name);
    fs.writeFileSync(file, code, "utf8");
    return file;
}

// Spawn the worker directly. Handles readline messages if inputLines is
// provided; all other messages are collected and returned on exit.
function runWorker(generatedPath, { inputLines = null } = {}) {
    return new Promise((resolve) => {
        const msgs = [];
        const inputBuffer = inputLines !== null ? new SharedArrayBuffer(64 * 1024) : null;

        const worker = new Worker(workerPath, {
            workerData: { generatedPath, inputBuffer },
        });

        if (inputBuffer) {
            const ctrl = new Int32Array(inputBuffer, 0, 2);
            const data = new Uint8Array(inputBuffer, 8);
            const encoder = new TextEncoder();
            let idx = 0;

            worker.on("message", (msg) => {
                if (msg.type === "readline") {
                    const line = (inputLines[idx++]) ?? "";
                    const bytes = encoder.encode(line);
                    const len = Math.min(bytes.length, 64 * 1024 - 8);
                    data.set(bytes.subarray(0, len), 0);
                    Atomics.store(ctrl, 1, len);
                    Atomics.store(ctrl, 0, 1);
                    Atomics.notify(ctrl, 0);
                } else {
                    msgs.push(msg);
                }
            });
        } else {
            worker.on("message", (msg) => msgs.push(msg));
        }

        worker.on("error", (err) => msgs.push({ type: "_workerError", message: err.message }));
        worker.on("exit", () => resolve(msgs));
    });
}

function mockStream() {
    const chunks = [];
    return {
        write(chunk) { chunks.push(String(chunk)); },
        get output() { return chunks.join(""); },
    };
}

async function run(name, fn) {
    try {
        await fn();
        console.log(`  ok  ${name}`);
    } catch (err) {
        failures += 1;
        console.log(`FAIL  ${name}`);
        console.log(`      ${err.message}`);
    }
}

// ── worker tests ─────────────────────────────────────────────────────────────

async function workerTests() {
    console.log("\nworker:");

    await run("clean game sends done", async () => {
        const f = writeTempGame("/* no-op */");
        const msgs = await runWorker(f);
        assert.deepStrictEqual(msgs, [{ type: "done" }]);
    });

    await run("lamplighter.print() sends print message", async () => {
        const f = writeTempGame('lamplighter.print("hello sandbox");');
        const msgs = await runWorker(f);
        assert.deepStrictEqual(msgs, [
            { type: "print", value: "hello sandbox" },
            { type: "done" },
        ]);
    });

    await run("game error sends error message", async () => {
        const f = writeTempGame('throw new Error("something broke");');
        const msgs = await runWorker(f);
        assert.strictEqual(msgs.length, 1);
        assert.strictEqual(msgs[0].type, "error");
        assert.ok(msgs[0].message.includes("something broke"), `message: ${msgs[0].message}`);
    });

    await run("require() is blocked", async () => {
        const f = writeTempGame('require("fs");');
        const msgs = await runWorker(f);
        assert.strictEqual(msgs[0].type, "error");
        assert.ok(
            msgs[0].message.includes("not available in the game sandbox"),
            `message: ${msgs[0].message}`,
        );
    });

    await run("process is withheld from game context", async () => {
        // If process leaked, this game would not throw; it would exit cleanly.
        // We rely on the done message arriving only if the guard passes.
        const f = writeTempGame(
            'if (typeof process !== "undefined") throw new Error("process leaked");',
        );
        const msgs = await runWorker(f);
        assert.deepStrictEqual(msgs, [{ type: "done" }]);
    });

    await run("Buffer is withheld from game context", async () => {
        const f = writeTempGame(
            'if (typeof Buffer !== "undefined") throw new Error("Buffer leaked");',
        );
        const msgs = await runWorker(f);
        assert.deepStrictEqual(msgs, [{ type: "done" }]);
    });

    await run("fetch is withheld from game context", async () => {
        const f = writeTempGame(
            'if (typeof fetch !== "undefined") throw new Error("fetch leaked");',
        );
        const msgs = await runWorker(f);
        assert.deepStrictEqual(msgs, [{ type: "done" }]);
    });

    await run("setTimeout is withheld from game context", async () => {
        const f = writeTempGame(
            'if (typeof setTimeout !== "undefined") throw new Error("setTimeout leaked");',
        );
        const msgs = await runWorker(f);
        assert.deepStrictEqual(msgs, [{ type: "done" }]);
    });

    await run("console.log is bridged as log message", async () => {
        const f = writeTempGame('console.log("debug info");');
        const msgs = await runWorker(f);
        assert.deepStrictEqual(msgs, [
            { type: "log", value: "debug info" },
            { type: "done" },
        ]);
    });

    await run("console.error is bridged as log message", async () => {
        const f = writeTempGame('console.error("err detail");');
        const msgs = await runWorker(f);
        assert.deepStrictEqual(msgs, [
            { type: "log", value: "err detail" },
            { type: "done" },
        ]);
    });

    await run("lamplighter.readLine() returns value provided by host via SAB", async () => {
        const f = writeTempGame('lamplighter.print(lamplighter.readLine());');
        const msgs = await runWorker(f, { inputLines: ["player typed this"] });
        assert.deepStrictEqual(msgs, [
            { type: "print", value: "player typed this" },
            { type: "done" },
        ]);
    });

    await run("multiple readline calls consume lines in order", async () => {
        const code = [
            'lamplighter.print(lamplighter.readLine());',
            'lamplighter.print(lamplighter.readLine());',
        ].join("\n");
        const f = writeTempGame(code);
        const msgs = await runWorker(f, { inputLines: ["first", "second"] });
        assert.deepStrictEqual(msgs, [
            { type: "print", value: "first" },
            { type: "print", value: "second" },
            { type: "done" },
        ]);
    });

    await run("lamplighter.readLine() throws when no input channel installed", async () => {
        // No inputBuffer → no channel installed → readLine() should throw.
        const f = writeTempGame('lamplighter.readLine();');
        const msgs = await runWorker(f);
        assert.strictEqual(msgs[0].type, "error");
        assert.ok(
            msgs[0].message.includes("no input channel installed"),
            `message: ${msgs[0].message}`,
        );
    });
}

// ── host tests ───────────────────────────────────────────────────────────────

async function hostTests() {
    console.log("\nhost:");

    await run("print output goes to out stream", async () => {
        const f = writeTempGame('lamplighter.print("host output test");');
        const out = mockStream();
        const err = mockStream();
        await playFile(f, { out, err });
        assert.strictEqual(out.output, "host output test\n");
        assert.strictEqual(err.output, "");
    });

    await run("multiple prints are ordered and newline-terminated", async () => {
        const code = ['lamplighter.print("line one");', 'lamplighter.print("line two");'].join("\n");
        const f = writeTempGame(code);
        const out = mockStream();
        await playFile(f, { out, err: mockStream() });
        assert.strictEqual(out.output, "line one\nline two\n");
    });

    await run("log output goes to err stream", async () => {
        const f = writeTempGame('console.log("side channel");');
        const out = mockStream();
        const err = mockStream();
        await playFile(f, { out, err });
        assert.strictEqual(out.output, "");
        assert.strictEqual(err.output, "side channel\n");
    });

    await run("game error rejects the promise", async () => {
        const f = writeTempGame('throw new Error("host sees this");');
        await assert.rejects(
            () => playFile(f, { out: mockStream(), err: mockStream() }),
            /host sees this/,
        );
    });

    await run("capability denial (require) rejects with sandbox message", async () => {
        const f = writeTempGame('require("path");');
        await assert.rejects(
            () => playFile(f, { out: mockStream(), err: mockStream() }),
            /not available in the game sandbox/,
        );
    });

    await run("playFile resolves on clean exit", async () => {
        const f = writeTempGame('lamplighter.print("done");');
        await assert.doesNotReject(
            () => playFile(f, { out: mockStream(), err: mockStream() }),
        );
    });
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
    await workerTests();
    await hostTests();

    if (failures > 0) {
        console.error(`\n${failures} sandbox test(s) failed.`);
        process.exit(1);
    }
    console.log("\nAll sandbox tests passed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
