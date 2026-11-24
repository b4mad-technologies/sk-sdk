import { startPlayerMcpRuntime } from "./runtime.ts";

const runtime = await startPlayerMcpRuntime();
process.stderr.write(
	`spellkave-player-mcp: ready (trust-boundary=${runtime.config.trustBoundary})\n`,
);

let closing = false;
async function close(signal: string): Promise<void> {
	if (closing) return;
	closing = true;
	process.stderr.write(`spellkave-player-mcp: stopping after ${signal}\n`);
	try {
		await runtime.close();
		process.exitCode = 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		process.stderr.write(`spellkave-player-mcp: shutdown failed: ${message}\n`);
		process.exitCode = 1;
	}
}

process.once("SIGINT", () => void close("SIGINT"));
process.once("SIGTERM", () => void close("SIGTERM"));
