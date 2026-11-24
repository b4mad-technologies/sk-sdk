// Process entry point for the session daemon (#1990). Spawned by
// `spawn.ts`'s `ensureDaemon` (default command) via
// `bin/spellkave-session-daemon.js`. Reads its binding from the ENVIRONMENT,
// never argv — `spawn.ts` sets these vars itself, so a token never appears in
// a `ps`-visible command line.

import type { SessionBinding } from "../binding.ts";
import { startDaemon } from "./daemon.ts";
import { DAEMON_ENV } from "./spawn.ts";

function readBinding(): SessionBinding {
	const raw = process.env[DAEMON_ENV.binding];
	if (raw === undefined || raw.length === 0) {
		throw new Error(`${DAEMON_ENV.binding} is required to start the session daemon`);
	}
	return JSON.parse(raw) as SessionBinding;
}

async function main(): Promise<void> {
	const binding = readBinding();
	const socketPath = process.env[DAEMON_ENV.socket];
	const token = process.env[DAEMON_ENV.token];
	const idleTimeoutRaw = process.env[DAEMON_ENV.idleTimeoutMs];
	const handle = await startDaemon({
		binding,
		...(socketPath === undefined ? {} : { socketPath }),
		...(token === undefined ? {} : { token }),
		...(idleTimeoutRaw === undefined ? {} : { idleTimeoutMs: Number(idleTimeoutRaw) }),
		// sk-uglp: the daemon already closed its socket + session; nothing
		// useful is left in this process. Exit so the next attach spawns fresh.
		onWorldConnectionLost: () => {
			process.stderr.write(
				"spellkave-session-daemon: world connection lost (reset/redeploy?) — exiting so the next attach starts fresh\n",
			);
			process.exit(0);
		},
	});

	// #2003: a run observer opened by `startDaemon` must get a terminal
	// "error" status even when the daemon dies from something neither the
	// `shutdown` op nor the idle-check loop caught — a crash, not a clean
	// lifecycle end. Best-effort: `handle.close` never throws (its own
	// `observability.end`/`onClose` swallow their own failures).
	function crash(kind: string, err: unknown): void {
		const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
		process.stderr.write(`spellkave-session-daemon: ${kind}: ${message}\n`);
		void handle.close("error").finally(() => process.exit(1));
	}
	process.on("uncaughtException", (err) => crash("uncaught exception", err));
	process.on("unhandledRejection", (reason) => crash("unhandled rejection", reason));
}

main().catch((err: unknown) => {
	const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
	process.stderr.write(`spellkave-session-daemon: ${message}\n`);
	process.exitCode = 1;
});
