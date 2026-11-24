#!/usr/bin/env node
// Thin launcher, mirroring `packages/spellkave-author-cli/bin/spellkave-author.js`:
// the ONE job here is turning a missing workspace install into an actionable
// sentence rather than a raw ESM resolution stack.
try {
	const { tsImport } = await import("tsx/esm/api");
	const { runCli } = await tsImport("../src/cli.ts", {
		parentURL: import.meta.url,
		tsconfig: false,
	});
	process.exitCode = await runCli(process.argv.slice(2));
} catch (err) {
	if (err?.code === "ERR_MODULE_NOT_FOUND") {
		process.stderr.write(
			"sk: CLI installation is incomplete. Reinstall the matching CLI distribution. Repository users can run `just bootstrap`, then retry.\n",
		);
		process.exitCode = 1;
	} else {
		throw err;
	}
}
