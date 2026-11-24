#!/usr/bin/env tsx
// Thin launcher: runs the generator under tsx, so it can import the package's
// TypeScript docs config and sources directly.
try {
	const { main } = await import("../src/docs/main.ts");
	process.exitCode = await main(process.argv.slice(2));
} catch (err) {
	process.stderr.write(`behaviour-docs: ${err instanceof Error ? err.message : String(err)}\n`);
	process.exitCode = 1;
}
