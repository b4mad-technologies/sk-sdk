// keep-file(K2): a tool that cannot start or never exits is an injected fault no suite meets on purpose.
// What this proves: runAsync answers at once, with exit -1 and the reason on
// stderr, when the executable does not exist; before, the run waited for the
// step timeout (60 s) because a child that never starts emits no "close".
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { it } from "vitest";

import { cliRunner } from "./cli.ts";

it("runAsync answers exit -1 with the reason when the tool cannot start", async () => {
	const tool = cliRunner({ name: "nope", bin: join(tmpdir(), "no-such-tool"), cwd: tmpdir() });
	const run = await tool.runAsync(["--help"]);
	assert.deepEqual(
		{ exit: run.exit, enoent: run.stderr.includes("ENOENT") },
		{ exit: -1, enoent: true },
	);
}, 5_000);

// What this proves: with a timeout, runAsync ends a child that never exits
// and answers with the stderr it wrote so far; before, a step timeout
// abandoned the promise and left the child running (sk-jay0.7.296).
it("runAsync with a timeout kills a hanging tool and keeps its stderr", async () => {
	const dir = mkdtempSync(join(tmpdir(), "cli-runner-"));
	const script = join(dir, "hang.mjs");
	writeFileSync(
		script,
		'console.error("pid " + process.pid + " waiting"); setInterval(() => {}, 1000);\n',
	);
	try {
		const tool = cliRunner({ name: "hang", bin: script, node: true, cwd: dir });
		const run = await tool.runAsync([], { timeout: 1_000 });
		const pid = Number(/pid (\d+)/.exec(run.stderr)?.[1]);
		const alive = (() => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		})();
		assert.deepEqual(
			{
				exit: run.exit,
				waiting: run.stderr.includes("waiting"),
				timeout: run.stderr.includes("runner timeout"),
				alive,
			},
			{ exit: -1, waiting: true, timeout: true, alive: false },
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}, 10_000);
