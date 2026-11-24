// A child owns its listening socket from bind until stop. Read its bound port
// from a complete readiness line; never reserve a port and release it before
// starting the real listener. Logs remain available after readiness and failure.
import { type SpawnOptionsWithoutStdio, spawn } from "node:child_process";

export interface EndpointProcess {
	readonly port: number;
	readonly url: string;
	log(): string;
	stop(): Promise<void>;
}

export async function startEndpointProcess(options: {
	command: string;
	args: string[];
	spawn?: SpawnOptionsWithoutStdio;
	/** A complete line whose first capture is the actual bound TCP port. */
	ready: RegExp;
	readyWithinMs: number;
}): Promise<EndpointProcess> {
	const child = spawn(options.command, options.args, {
		...options.spawn,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	let ready = false;
	let stopped: Promise<void> | undefined;
	const exited = new Promise<void>((resolve) => child.once("close", () => resolve()));
	const stop = (): Promise<void> => {
		stopped ??= (async () => {
			if (child.exitCode !== null || child.signalCode !== null) return exited;
			child.kill("SIGTERM");
			const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
			try {
				await exited;
			} finally {
				clearTimeout(timer);
			}
		})();
		return stopped;
	};
	try {
		const port = await new Promise<number>((resolve, reject) => {
			const finish = (result: Error | number) => {
				clearTimeout(timer);
				child.off("error", onError);
				child.off("close", onClose);
				if (typeof result === "number") resolve(result);
				else reject(result);
			};
			const onError = (error: Error) => finish(error);
			const onClose = (code: number | null) =>
				finish(new Error(`endpoint exited ${code} before readiness:\n${output}`));
			const timer = setTimeout(
				() =>
					finish(new Error(`endpoint not ready within ${options.readyWithinMs} ms:\n${output}`)),
				options.readyWithinMs,
			);
			const onData = (chunk: Buffer) => {
				output += chunk.toString("utf8");
				if (ready) return;
				const match = output.match(options.ready);
				if (!match) return;
				ready = true;
				const port = Number(match[1]);
				if (!Number.isInteger(port) || port < 1 || port > 65_535) {
					finish(new Error(`endpoint reported an invalid bound port:\n${output}`));
				} else finish(port);
			};
			child.stdout.on("data", onData);
			child.stderr.on("data", onData);
			child.once("error", onError);
			child.once("close", onClose);
		});
		return { port, url: `http://127.0.0.1:${port}`, log: () => output, stop };
	} catch (error) {
		await stop();
		throw error;
	}
}

/** A held local endpoint that resets every connection without answering HTTP. */
export function startUnreachableEndpoint(): Promise<EndpointProcess> {
	return startEndpointProcess({
		command: process.execPath,
		args: [
			"--input-type=module",
			"--eval",
			`
import { createServer } from "node:net";
const server = createServer(socket => socket.destroy());
server.listen(0, "127.0.0.1", () => {
  process.stdout.write("reset-endpoint: ready on 127.0.0.1:" + server.address().port + "\\n");
});
process.once("SIGTERM", () => server.close());
`,
		],
		ready: /^reset-endpoint: ready on 127\.0\.0\.1:(\d+)\r?\n/m,
		readyWithinMs: 30_000,
	});
}
