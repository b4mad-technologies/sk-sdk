// Ported from packages/spellkave-srd-cc/src/test/srd-coverage/check.ts
// (authoring-doc-evidence D1/D3) — same temp-dir regen + byte-compare shape,
// against `DOC_EVIDENCE_OUTPUT_ROOT` instead of `SRD_COVERAGE_OUTPUT_ROOT`.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GENERATED_MARKER =
	"GENERATED from Vitest results by `src/test/doc-evidence/reporter.ts` — DO NOT EDIT BY HAND.";

function markdownFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const files: string[] = [];
	for (const entry of readdirSync(root)) {
		const path = join(root, entry);
		if (statSync(path).isDirectory()) files.push(...markdownFiles(path));
		else if (entry.endsWith(".md")) files.push(path);
	}
	return files;
}

function generatedPaths(root: string): Set<string> {
	return new Set(
		markdownFiles(join(root, "ledger")).map((path) => relative(root, path).replaceAll("\\", "/")),
	);
}

function managedWorkingPaths(root: string): Set<string> {
	const candidates = markdownFiles(join(root, "ledger")).filter(existsSync);
	return new Set(
		candidates
			.filter((path) => readFileSync(path, "utf8").includes(GENERATED_MARKER))
			.map((path) => relative(root, path).replaceAll("\\", "/")),
	);
}

export function compareGeneratedReports(generatedRoot: string, workingRoot: string): string[] {
	const generated = generatedPaths(generatedRoot);
	const working = managedWorkingPaths(workingRoot);
	const paths = [...new Set([...generated, ...working])].sort();
	const differences: string[] = [];
	for (const path of paths) {
		if (!generated.has(path)) {
			differences.push(`${path}: committed generated report is no longer produced`);
			continue;
		}
		if (!working.has(path)) {
			differences.push(`${path}: generated report is missing from the working tree`);
			continue;
		}
		const actual = readFileSync(join(generatedRoot, path));
		const expected = readFileSync(join(workingRoot, path));
		if (!actual.equals(expected)) differences.push(`${path}: committed report is stale`);
	}
	return differences;
}

export function checkGeneratedReports(): number {
	const generatedRoot = mkdtempSync(join(tmpdir(), "spellkave-doc-evidence-"));
	try {
		const env: NodeJS.ProcessEnv = {
			...process.env,
			DOC_EVIDENCE_OUTPUT_ROOT: generatedRoot,
		};
		delete env.SPELLKAVE_LOCAL_NODE;
		const run = spawnSync("pnpm", ["run", "test:doc-evidence"], {
			cwd: PACKAGE_DIR,
			env,
			stdio: "inherit",
		});
		if (run.status !== 0) {
			console.error(`Doc-evidence generation failed with status ${run.status ?? "unknown"}.`);
			return 1;
		}
		const differences = compareGeneratedReports(generatedRoot, PACKAGE_DIR);
		if (differences.length > 0) {
			console.error("Generated doc-evidence reports differ:");
			for (const difference of differences) console.error(`- ${difference}`);
			console.error(
				"Run `pnpm --filter @spellkave/world-author run test:doc-evidence` to update them.",
			);
			return 1;
		}
		console.log("Generated doc-evidence reports are current.");
		return 0;
	} finally {
		rmSync(generatedRoot, { recursive: true, force: true });
	}
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	process.exitCode = checkGeneratedReports();
}
