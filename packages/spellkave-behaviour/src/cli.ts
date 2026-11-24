// Runs a real command-line tool as a black box: argv in, stdout/stderr/exit
// code out. Nothing of the tool is imported. Every run a step attaches becomes
// a transcript in the results, with machine paths replaced so it can be
// published.

import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

import * as allure from "allure-js-commons";

export type Run = { argv: string[]; stdout: string; stderr: string; exit: number };
export type Env = Record<string, string>;

export interface RunOptions {
	readonly env?: Env;
	/** Working directory; the runner's default when absent. */
	readonly cwd?: string;
	/**
	 * Milliseconds. `run` defaults to 60 s. `runAsync` has no default; with one
	 * it ends the child (SIGTERM, SIGKILL 5 s later) and answers exit -1 with
	 * the output so far. Set it below the step timeout: a step that times out
	 * abandons its promise but not its child.
	 */
	readonly timeout?: number;
}

export interface CliRunner {
	/** How a person types the tool: the transcript prefix and attachment name (`sk`, `skgate`). */
	readonly name: string;
	/** For quick probes in setup and assertions. Blocks the worker; keep it short. */
	run(argv: string[], options?: RunOptions): Run;
	/**
	 * For the user's steps. Does not block the worker: Vitest's worker RPC
	 * times out when a synchronous child runs for minutes.
	 */
	runAsync(argv: string[], options?: RunOptions): Promise<Run>;
	transcript(run: Run, env?: Env): string;
	/** `role` "setup" marks runs that only prepare a scenario's precondition. */
	attach(run: Run, role?: "setup", env?: Env): Promise<void>;
	redact(text: string): string;
}

export interface CliRunnerOptions {
	readonly name: string;
	/** Absolute path of the executable, or of the script when `node` is set. */
	readonly bin: string;
	/** Run `bin` with this process's node: a bundle from `bundleCli` (setup.ts). */
	readonly node?: boolean;
	readonly cwd: string;
	/**
	 * The environment every run starts from; `process.env` when absent. A
	 * suite that runs inside a git hook passes one without GIT_* variables.
	 */
	readonly baseEnv?: Readonly<Record<string, string | undefined>>;
	/** Paths shortened in transcripts, longest first: e.g. a temp repo, then the real one. */
	readonly redactions?: readonly (readonly [string, string])[];
}

export function cliRunner(options: CliRunnerOptions): CliRunner {
	const redactions = [...(options.redactions ?? []), [homedir(), "~"] as const];
	const redact = (text: string) =>
		redactions.reduce((out, [path, label]) => out.replaceAll(path, label), text);
	const transcript = (run: Run, env: Env = {}) => {
		const prefix = Object.entries(env)
			.map(([k, v]) => `${k}=${v} `)
			.join("");
		const lines = [`$ ${prefix}${options.name} ${run.argv.join(" ")}`, run.stdout.trimEnd()];
		if (run.stderr.trim()) lines.push(`[stderr]\n${run.stderr.trimEnd()}`);
		lines.push(`[exit ${run.exit}]`);
		return redact(lines.filter(Boolean).join("\n"));
	};
	// With `node`, the script is node's first argument; the transcript still shows the tool's argv.
	const [command, lead] = options.node
		? [process.execPath, [options.bin]]
		: [options.bin, [] as string[]];
	return {
		name: options.name,
		redact,
		transcript,
		run(argv, { env = {}, cwd = options.cwd, timeout = 60_000 } = {}) {
			const out = spawnSync(command, [...lead, ...argv], {
				cwd,
				encoding: "utf8",
				env: { ...(options.baseEnv ?? process.env), ...env },
				timeout,
			});
			return { argv, stdout: out.stdout, stderr: out.stderr, exit: out.status ?? -1 };
		},
		runAsync(argv, { env = {}, cwd = options.cwd, timeout } = {}) {
			return new Promise((done) => {
				const child = spawn(command, [...lead, ...argv], {
					cwd,
					env: { ...(options.baseEnv ?? process.env), ...env },
				});
				let stdout = "";
				let stderr = "";
				let timedOut = false;
				let kill: NodeJS.Timeout | undefined;
				const timer =
					timeout === undefined
						? undefined
						: setTimeout(() => {
								timedOut = true;
								child.kill("SIGTERM");
								kill = setTimeout(() => child.kill("SIGKILL"), 5_000);
							}, timeout);
				const finish = (run: Run) => {
					clearTimeout(timer);
					clearTimeout(kill);
					done(run);
				};
				child.stdout.on("data", (chunk) => {
					stdout += chunk;
				});
				child.stderr.on("data", (chunk) => {
					stderr += chunk;
				});
				// A child that never starts (no such file, not executable) emits no "close".
				child.on("error", (err) =>
					finish({ argv, stdout, stderr: `${stderr}${err.message}\n`, exit: -1 }),
				);
				child.on("close", (code) =>
					timedOut
						? finish({
								argv,
								stdout,
								stderr: `${stderr}killed after ${timeout} ms (runner timeout)\n`,
								exit: -1,
							})
						: finish({ argv, stdout, stderr, exit: code ?? -1 }),
				);
			});
		},
		async attach(run, role, env = {}) {
			const name = redact(`${role ? `${role}: ` : ""}${options.name} ${run.argv.join(" ")}`);
			await allure.attachment(name, transcript(run, env), "text/plain");
		},
	};
}

/** Parse JSONL stdout; a non-JSON line on stdout is a contract break, not noise. */
export function records(run: Run): Record<string, unknown>[] {
	return run.stdout
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Split a command a person would type into argv, dropping the tool's own name. */
export function argvOf(command: string, name: string): string[] {
	const words = command.split(/\s+/).filter(Boolean);
	const tool = name.split(/\s+/);
	return tool.every((word, i) => words[i] === word) ? words.slice(tool.length) : words;
}
