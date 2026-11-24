// `sk ... | head` closes the pipe early; `sk` must not crash then, and must
// still exit with the code its work earned. Its stdout must also carry only
// the result records, even when a connector prints to the console. These
// tests break the pipe on purpose (EPIPE) and route console noise to stderr.
// Fake streams; no node. Output contract: ADR-0002.
import { EventEmitter } from "node:events";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createProcessIo, EXIT_OK, EXIT_USAGE, runCli } from "../cli.ts";
import { collect } from "./helpers.ts";

/** A minimal `NodeJS.WritableStream` double whose `write()` throws a coded
 * error synchronously — the shape a broken pipe's `write()` call can take. */
function throwingStream(code: string, message = `write ${code}`): NodeJS.WritableStream {
	const emitter = new EventEmitter() as unknown as NodeJS.WritableStream & EventEmitter;
	emitter.write = (() => {
		const err = new Error(message) as NodeJS.ErrnoException;
		err.code = code;
		throw err;
	}) as NodeJS.WritableStream["write"];
	return emitter;
}

/** A double that counts calls instead of throwing — for the "no more writes
 * after EPIPE" assertion. */
function countingEpipeStream(): { stream: NodeJS.WritableStream; calls: number } {
	const counter = { calls: 0 };
	const emitter = new EventEmitter() as unknown as NodeJS.WritableStream & EventEmitter;
	emitter.write = (() => {
		counter.calls += 1;
		const err = new Error("write EPIPE") as NodeJS.ErrnoException;
		err.code = "EPIPE";
		throw err;
	}) as NodeJS.WritableStream["write"];
	return { stream: emitter, calls: counter.calls };
}

describe("createProcessIo", () => {
	it("swallows a synchronous EPIPE write instead of throwing", () => {
		const io = createProcessIo(throwingStream("EPIPE"), throwingStream("EPIPE"));
		expect(() => io.out("line")).not.toThrow();
		expect(() => io.err("line")).not.toThrow();
	});

	it("swallows an asynchronous EPIPE 'error' event instead of crashing the process", () => {
		const stdout = new EventEmitter() as unknown as NodeJS.WritableStream & EventEmitter;
		stdout.write = (() => true) as NodeJS.WritableStream["write"];
		const stderr = new EventEmitter() as unknown as NodeJS.WritableStream & EventEmitter;
		stderr.write = (() => true) as NodeJS.WritableStream["write"];
		createProcessIo(stdout, stderr);

		const err = new Error("write EPIPE") as NodeJS.ErrnoException;
		err.code = "EPIPE";
		// A real broken pipe surfaces as an `'error'` EVENT (not necessarily a
		// throw from `write()` itself) — Node's default behavior for an
		// unlistened `'error'` event IS the crash this guard exists to avoid.
		expect(() => stdout.emit("error", err)).not.toThrow();
	});

	it("re-throws a non-EPIPE write error — this only special-cases the broken-pipe case", () => {
		const io = createProcessIo(
			throwingStream("EACCES", "permission denied"),
			throwingStream("EPIPE"),
		);
		expect(() => io.out("line")).toThrow("permission denied");
	});

	it("stops writing to a stream once it has gone EPIPE, without re-attempting", () => {
		const { stream } = countingEpipeStream();
		const io = createProcessIo(stream, stream);
		io.out("a");
		io.out("b");
		io.out("c");
		// The double increments its own counter before throwing each call, but
		// `createProcessIo` should short-circuit after the FIRST EPIPE — assert
		// via a fresh double that would reveal a second `write()` attempt.
		let calls = 0;
		const guarded = new EventEmitter() as unknown as NodeJS.WritableStream & EventEmitter;
		guarded.write = (() => {
			calls += 1;
			const e = new Error("write EPIPE") as NodeJS.ErrnoException;
			e.code = "EPIPE";
			throw e;
		}) as NodeJS.WritableStream["write"];
		const guardedIo = createProcessIo(guarded, guarded);
		guardedIo.out("a");
		guardedIo.out("b");
		expect(calls).toBe(1);
	});

	it("keeps stdout and stderr independently guarded", () => {
		const stdout = throwingStream("EPIPE");
		let stderrCalls = 0;
		const stderr = new EventEmitter() as unknown as NodeJS.WritableStream & EventEmitter;
		stderr.write = (() => {
			stderrCalls += 1;
			return true;
		}) as NodeJS.WritableStream["write"];
		const io = createProcessIo(stdout, stderr);

		io.out("broken");
		io.err("still fine");

		expect(stderrCalls).toBe(1);
	});
});

describe("runCli survives a broken output pipe", () => {
	it("returns the completed work's own exit code instead of throwing when stdout is EPIPE", async () => {
		const io = createProcessIo(throwingStream("EPIPE"), throwingStream("EPIPE"));
		const code = await runCli(["list"], io);
		expect(code).toBe(EXIT_OK);
	});

	it("stops a multi-line human render cleanly after EPIPE", async () => {
		const io = createProcessIo(throwingStream("EPIPE"), throwingStream("EPIPE"));
		const code = await runCli(["--format", "human", "list"], io);
		expect(code).toBe(EXIT_OK);
	});

	it("still returns EXIT_USAGE for a genuine usage error even when stdout cannot receive it", async () => {
		const io = createProcessIo(throwingStream("EPIPE"), throwingStream("EPIPE"));
		const code = await runCli(["definitely_not_a_tool"], io);
		expect(code).toBe(EXIT_USAGE);
	});
});

describe("sk --live keeps stdout pure JSONL", () => {
	const savedUrl = process.env.SPELLKAVE_URL;

	afterEach(() => {
		vi.restoreAllMocks();
		if (savedUrl === undefined) delete process.env.SPELLKAVE_URL;
		else process.env.SPELLKAVE_URL = savedUrl;
	});

	it("silences known connect progress and routes other connector noise to stderr", async () => {
		// `--live`'s own ladder (#2002 follow-up, `resolveLiveConnection`)
		// resolves url/db/token BEFORE ever calling `connectLive` (even an
		// injected fake), so a resolvable env is required here even though
		// this case only cares about where a connector's console noise lands.
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		// `console.error`/`console.log` are process-global — `collect()`'s
		// `CliIo` (the app-level `io.out`/`io.err` writers) is a SEPARATE
		// concern from what a dependency writes straight to the console, so
		// this spies on the real global rather than asserting on `io.err`.
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const io = collect();
		const connectLive = async () => {
			// Stands in for what the underlying `spacetimedb` package's own
			// logger does mid-connect (`stdbLogger` → `console.log`, no public
			// redirect hook — see `withConsoleLogOnStderr`'s header comment):
			// `sk` cannot control what a dependency logs, only where it lands.
			console.log(JSON.stringify({ kind: "binding_drift_additive", additions: {} }));
			console.log("ℹ️ INFO Connecting to SpacetimeDB WS...");
			console.log("%cℹ️ INFO%c Connecting to SpacetimeDB WS...", "color: blue", "color: inherit");
			console.log("Different progress message");
			return {
				target: {
					kind: "live" as const,
					resolveRef: () => false,
					lookup: () => [],
					applyBatch: async () => ({ ok: true }),
				},
				readsAsPublisher: true,
				connectedIdentity: "publisher",
				close: () => {},
			};
		};

		const code = await runCli(
			["--live", "apply_manifest_delta", "--toml", 'schema_version = "1.0.0"\n'],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_OK);
		expect(io.out).toHaveLength(1);
		const payload = JSON.parse(io.out[0] as string) as { kind: string };
		expect(payload.kind).toBe("tool_result");
		const errorLines = errorSpy.mock.calls.map((call) => call.join(" "));
		expect(errorLines.some((line) => line.includes("binding_drift_additive"))).toBe(true);
		expect(errorLines.some((line) => line.includes("Connecting to SpacetimeDB"))).toBe(false);
		expect(errorLines).toContain("Different progress message");
	});

	it("restores console.log once the call completes, so it does not leak into unrelated code", async () => {
		const original = console.log;
		const io = collect();
		await runCli(["list"], io.io);
		expect(console.log).toBe(original);
	});

	it("restores console.log even when the invocation throws", async () => {
		const original = console.log;
		const io = collect();
		await runCli(["--live", "--target", "irrelevant", "list"], io.io);
		expect(console.log).toBe(original);
	});
});
