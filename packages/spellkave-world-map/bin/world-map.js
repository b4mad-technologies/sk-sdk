#!/usr/bin/env tsx
// Thin launcher — run the TypeScript CLI entry. Missing workspace deps surface
// as an actionable sentence rather than a raw ESM resolution stack.
try {
	const { runCli } = await import("../src/cli.ts");
	process.exitCode = await runCli(process.argv.slice(2));
} catch (err) {
	if (err?.code === "ERR_MODULE_NOT_FOUND" && String(err?.message).includes("@spellkave/")) {
		process.stderr.write(
			"world-map: workspace dependency not installed. Run `just bootstrap` (or `pnpm install` at the repo root) once, then retry.\n",
		);
		process.exitCode = 1;
	} else {
		throw err;
	}
}
