// AUTHORITATIVE compatibility gate for @spellkave/tool-contracts.
//
// Compares the LIVE contracts (current TypeBox schemas + descriptors) against
// the committed snapshot as it existed AT THE PR's MERGE-BASE COMMIT — never
// HEAD or the working tree. By the time a PR has regenerated its own
// snapshot, HEAD already holds the new value, so a HEAD/working-tree
// comparison would compare new against new and always pass; the merge base
// is the only state neither side of the diff can silently update.
//
// Invoked as `pnpm --filter @spellkave/tool-contracts run check-compat`
// (manual/local use). The authoritative PR gate is the `tool-contract-compat`
// registry gate (ADR-0135, `packages/spellkave-gates/src/gates/
// tool-contract-compat.ts`), which reimplements this comparison directly
// against `ctx.git.showFiles`/`ctx.fs.readFile` instead of shelling out here
// — this CLI stays for ad hoc local runs against an explicit `--base-commit`.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	ACKNOWLEDGEMENTS_FORMAT,
	type AcknowledgementsFile,
	captureSnapshot,
	computeBreakingChanges,
	formatBreakingChange,
	unacknowledgedBreakingChanges,
} from "../src/contract-guard.ts";
import { TOOL_CONTRACTS, TOOL_ROLE_ROSTERS } from "../src/metadata.ts";
import { readSnapshotAtCommit } from "./git-baseline.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const acknowledgementsPath = join(packageRoot, "src", "tool-contracts.breaking-acknowledged.json");

function parseBaseCommit(argv: readonly string[]): string {
	const index = argv.indexOf("--base-commit");
	const value = index === -1 ? undefined : argv[index + 1];
	if (value === undefined || value.trim().length === 0) {
		console.error("check-contract-compat: --base-commit <sha> is required.");
		process.exit(1);
	}
	return value;
}

function readAcknowledgements(): AcknowledgementsFile {
	if (!existsSync(acknowledgementsPath)) return { format: ACKNOWLEDGEMENTS_FORMAT, entries: [] };
	return JSON.parse(readFileSync(acknowledgementsPath, "utf8")) as AcknowledgementsFile;
}

function main(): void {
	const baseCommit = parseBaseCommit(process.argv.slice(2));

	const previous = readSnapshotAtCommit(baseCommit, packageRoot);
	if (previous === null) {
		console.log(
			`check-contract-compat: no snapshot at merge base ${baseCommit} — this is the first ` +
				"committed snapshot, nothing to break yet.",
		);
		return;
	}
	const current = captureSnapshot(TOOL_CONTRACTS, TOOL_ROLE_ROSTERS);
	const breakingChanges = computeBreakingChanges(previous, current);
	if (breakingChanges.length === 0) {
		console.log(`check-contract-compat: no breaking changes against merge base ${baseCommit}.`);
		return;
	}

	const acknowledgements = readAcknowledgements();
	const unacknowledged = unacknowledgedBreakingChanges(breakingChanges, acknowledgements);
	if (unacknowledged.length === 0) {
		console.log(
			`check-contract-compat: ${breakingChanges.length} breaking change(s) against merge base ` +
				`${baseCommit}, all acknowledged in tool-contracts.breaking-acknowledged.json.`,
		);
		return;
	}

	console.error(
		`check-contract-compat: ${unacknowledged.length} unacknowledged breaking change(s) against ` +
			`merge base ${baseCommit}:`,
	);
	for (const change of unacknowledged) console.error(`  - ${formatBreakingChange(change)}`);
	console.error(
		"check-contract-compat: accept deliberately with `pnpm --filter @spellkave/tool-contracts " +
			'run capture-contracts -- --acknowledge-breaking --reason "<why this is safe>"`, commit ' +
			"the updated snapshot + acknowledgement together, or revert the change.",
	);
	process.exitCode = 2;
}

main();
