// The start of a behaviour run, called from a package's Vitest globalSetup:
// one run, one result set, so the documents are generated from exactly this
// run. It records the commit the run tests (not the commit the documents are
// later generated at) and whether the code it depends on had local changes.
// A suite whose tool starts through tsx also bundles it here, once per run.

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { buildSync } from "esbuild";

export interface RunRecord {
	readonly commit: string;
	readonly dirty: boolean;
}

/**
 * @param results the package's results directory (cleared)
 * @param repo the repository root
 * @param watched repository paths whose local changes make the run "dirty"
 */
export function startRun(results: string, repo: string, watched: readonly string[]): RunRecord {
	rmSync(results, { recursive: true, force: true });
	mkdirSync(results, { recursive: true });
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 1 << 30 }).trim();
	const run = {
		commit: git("rev-parse", "--short", "HEAD"),
		dirty: git("status", "--porcelain", "--", ...watched) !== "",
	};
	writeFileSync(join(results, "run.json"), JSON.stringify(run));
	return run;
}

/**
 * Bundles a TypeScript CLI entry into one ESM file that plain node runs, for
 * `cliRunner({ bin: out, node: true })`. A tsx start costs about 250 ms per
 * spawn; the bundle starts in about 35 ms and builds in milliseconds. Put
 * `out` inside the checkout (and gitignore it) when the tool finds the repo
 * from its own path. Keep one scenario on the real front door, so the
 * launcher stays covered. `external` names packages the bundle leaves as
 * imports, for a native module (a `.node` file) that the tool loads only
 * on a path the scenarios never take. `assets` are files copied next to
 * `out`, for a bundled module that reads a file beside itself through
 * `__dirname` (a wasm-pack `_bg.wasm`); in the bundle `__dirname` is the
 * folder of `out`.
 */
export function bundleCli(
	entry: string,
	out: string,
	options: { external?: string[]; assets?: string[] } = {},
): string {
	buildSync({
		entryPoints: [entry],
		outfile: out,
		bundle: true,
		platform: "node",
		format: "esm",
		target: `node${process.versions.node.split(".")[0]}`,
		// Bundled CommonJS dependencies use require() and __dirname, which ESM
		// lacks. The alias keeps clear of a bundled module's own
		// `createRequire` import.
		banner: {
			js: [
				"import { createRequire as __bundleRequire } from 'node:module';",
				"const require = __bundleRequire(import.meta.url);",
				"const __dirname = import.meta.dirname;",
				"const __filename = import.meta.filename;",
			].join(" "),
		},
		external: options.external ?? [],
		logLevel: "warning",
	});
	const names = (options.assets ?? []).map((asset) => basename(asset));
	const twice = names.find((name, index) => names.indexOf(name) !== index);
	if (twice !== undefined) throw new Error(`bundleCli assets: two files named ${twice}`);
	for (const asset of options.assets ?? [])
		copyFileSync(asset, join(dirname(out), basename(asset)));
	return out;
}
