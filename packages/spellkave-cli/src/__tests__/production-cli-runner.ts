// Runs `sk` commands for applyset-drift.live.test.ts in one child process that loads the
// production CLI once (fixtures/cli-runner.ts under tsx), so each command
// is a real `runCli` call with its own real connection, without paying a
// cold start per command.
import { fork } from "node:child_process";
import { once } from "node:events";
import { createRequire } from "node:module";

interface CommandResult {
	exit: number;
	stdout: string;
	stderr: string;
}

/** One module load; runCli still owns a new real connection for every command. */
export function createProductionCliRunner(cwd: string, env: NodeJS.ProcessEnv) {
	const started = performance.now();
	const child = fork(new URL("./fixtures/cli-runner.ts", import.meta.url), [], {
		cwd,
		env,
		execArgv: ["--import", createRequire(import.meta.url).resolve("tsx")],
		stdio: ["ignore", "pipe", "pipe", "ipc"],
	});
	let diagnostics = "";
	child.stdout?.on("data", (data) => {
		diagnostics += String(data);
	});
	child.stderr?.on("data", (data) => {
		diagnostics += String(data);
	});
	let pending:
		| {
				resolve: (result: CommandResult) => void;
				reject: (error: Error) => void;
		  }
		| undefined;
	let stopped: Error | undefined;
	let startupMs = 0;
	const ready = new Promise<void>((resolve, reject) => {
		child.on("message", (message: CommandResult & { ready?: boolean; error?: string }) => {
			if (message.ready) {
				startupMs = Math.round(performance.now() - started);
				resolve();
				return;
			}
			const request = pending;
			pending = undefined;
			if (message.error) request?.reject(new Error(message.error));
			else request?.resolve({ ...message, stderr: message.stderr + diagnostics });
			diagnostics = "";
		});
		const fail = (error: Error) => {
			stopped = error;
			reject(error);
			pending?.reject(error);
			pending = undefined;
		};
		child.on("error", fail);
		child.on("exit", (code, signal) =>
			fail(new Error(`CLI runner exited (${code ?? signal}): ${diagnostics}`)),
		);
	});
	return {
		ready,
		get startupMs() {
			return startupMs;
		},
		invoke(argv: string[], credential: string): Promise<CommandResult> {
			if (stopped) return Promise.reject(stopped);
			if (pending) return Promise.reject(new Error("CLI runner commands must be sequential"));
			return new Promise((resolve, reject) => {
				pending = { resolve, reject };
				child.send({ argv, credential }, (error) => {
					if (error) {
						pending = undefined;
						reject(error);
					}
				});
			});
		},
		async close() {
			if (child.exitCode !== null || child.signalCode !== null) return;
			const exited = once(child, "exit");
			child.kill();
			await exited;
		},
	};
}
