// Entry for `bin/spellkave-player-mcp-local.js`: stdio transport, stderr for
// every human line (stdout is the MCP wire). `--profile <name>` picks the
// persona; otherwise `SPELLKAVE_PLAYER_PROFILE`, otherwise the single profile
// under the worktree's `.local/profiles/` (sk-jay0.7.170).

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createLocalPlayerMcp, LocalPlayerMcpUsageError } from "./local.ts";

function parseArgs(argv: readonly string[]): { profileName?: string } {
	const out: { profileName?: string } = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === "--profile") {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new LocalPlayerMcpUsageError("--profile needs a persona profile name");
			}
			out.profileName = value;
			i += 1;
		} else if (arg?.startsWith("--profile=")) {
			out.profileName = arg.slice("--profile=".length);
		} else {
			throw new LocalPlayerMcpUsageError(
				`unknown argument '${arg}' — usage: spellkave-player-mcp-local [--profile <name>]`,
			);
		}
	}
	return out;
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const { server, resolved, feedbackPath } = await createLocalPlayerMcp(args);
	process.stderr.write(
		`spellkave-player-mcp-local: profile '${resolved.profileName}' (${resolved.profilePath}) -> ` +
			`${resolved.binding.url} db=${resolved.binding.db} actor=${resolved.binding.actorId}; ` +
			`feedback -> ${feedbackPath}\n`,
	);
	await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`spellkave-player-mcp-local: ${message}\n`);
	process.exit(error instanceof LocalPlayerMcpUsageError ? 2 : 1);
});
