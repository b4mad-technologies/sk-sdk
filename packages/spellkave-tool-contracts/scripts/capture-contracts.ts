// Regenerates the committed contract snapshot from the live TypeBox
// schemas/descriptors and, when a breaking change against the PREVIOUS
// on-disk snapshot is found, optionally records an explicit acknowledgement.
//
// This is a LOCAL EARLY WARNING only — it compares against whatever is
// already in the working tree / git index, which after you commit is no
// longer a useful "before" state (see `readCommittedSnapshot` in
// `git-baseline.ts`). The AUTHORITATIVE compatibility check is the PR gate:
// the `tool-contract-compat` registry gate (ADR-0135, `packages/
// spellkave-gates/src/gates/tool-contract-compat.ts`, run via `bin/skgate`),
// which always compares against the PR's merge-base commit. Run this script
// to update the snapshot and to catch an obvious break before you push; the
// PR gate is what actually blocks a breaking merge.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	ACKNOWLEDGEMENTS_FORMAT,
	type AcknowledgementsFile,
	captureSnapshot,
	computeBreakingChanges,
	formatBreakingChange,
} from "../src/contract-guard.ts";
import { TOOL_CONTRACTS, TOOL_ROLE_ROSTERS } from "../src/metadata.ts";
import {
	contractSnapshotFiles,
	LEGACY_SNAPSHOT_PATH,
	SNAPSHOT_DIRECTORY,
} from "../src/snapshot-storage.ts";
import { readCommittedSnapshot } from "./git-baseline.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = join(packageRoot, SNAPSHOT_DIRECTORY);
const acknowledgementsPath = join(packageRoot, "src", "tool-contracts.breaking-acknowledged.json");

function parseArgs(argv: readonly string[]): {
	acknowledgeBreaking: boolean;
	reason: string | null;
} {
	let acknowledgeBreaking = false;
	let reason: string | null = null;
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--acknowledge-breaking") {
			acknowledgeBreaking = true;
		} else if (arg === "--reason") {
			reason = argv[index + 1] ?? null;
			index += 1;
		} else if (arg?.startsWith("--reason=")) {
			reason = arg.slice("--reason=".length);
		}
	}
	return { acknowledgeBreaking, reason };
}

function readAcknowledgements(): AcknowledgementsFile {
	if (!existsSync(acknowledgementsPath)) {
		return { format: ACKNOWLEDGEMENTS_FORMAT, entries: [] };
	}
	return JSON.parse(readFileSync(acknowledgementsPath, "utf8")) as AcknowledgementsFile;
}

function main(): void {
	const { acknowledgeBreaking, reason } = parseArgs(process.argv.slice(2));
	if (acknowledgeBreaking && (reason === null || reason.trim().length === 0)) {
		console.error(
			'capture-contracts: --acknowledge-breaking requires --reason "<why this is safe>".',
		);
		process.exitCode = 1;
		return;
	}

	const liveSnapshot = captureSnapshot(TOOL_CONTRACTS, TOOL_ROLE_ROSTERS);
	const committedBaseline = readCommittedSnapshot(packageRoot);
	const breakingChanges = computeBreakingChanges(committedBaseline, liveSnapshot);

	const files = contractSnapshotFiles(liveSnapshot);
	rmSync(snapshotPath, { recursive: true, force: true });
	for (const [path, content] of files) {
		const target = join(packageRoot, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content);
	}
	rmSync(join(packageRoot, LEGACY_SNAPSHOT_PATH), { force: true });
	console.log(
		`tool-contracts: captured ${liveSnapshot.tools.length} contracts to ${snapshotPath}.`,
	);

	if (breakingChanges.length === 0) {
		console.log("tool-contracts: no breaking changes against the committed baseline.");
		return;
	}

	if (!acknowledgeBreaking) {
		console.error(
			`tool-contracts: ${breakingChanges.length} breaking change(s) against the committed baseline:`,
		);
		for (const change of breakingChanges) console.error(`  - ${formatBreakingChange(change)}`);
		console.error(
			'tool-contracts: re-run with --acknowledge-breaking --reason "<why this is safe>" ' +
				"to accept them explicitly, or revert the change. (This is a local early warning; " +
				"the PR gate — the tool-contract-compat registry gate — is authoritative and " +
				"compares against the PR's merge base, not this working tree.)",
		);
		process.exitCode = 1;
		return;
	}

	const acknowledgements = readAcknowledgements();
	const existingKeys = new Set(
		acknowledgements.entries.map((entry) =>
			JSON.stringify([entry.tool, entry.field, entry.from, entry.to]),
		),
	);
	const acknowledgedAt = new Date().toISOString();
	const newEntries = breakingChanges
		.filter(
			(change) =>
				!existingKeys.has(JSON.stringify([change.tool, change.field, change.from, change.to])),
		)
		.map((change) => ({
			tool: change.tool,
			field: change.field,
			from: change.from,
			to: change.to,
			// biome-ignore lint/style/noNonNullAssertion: guarded above
			reason: reason!,
			acknowledgedAt,
		}));

	const merged: AcknowledgementsFile = {
		format: ACKNOWLEDGEMENTS_FORMAT,
		entries: [...acknowledgements.entries, ...newEntries],
	};
	writeFileSync(acknowledgementsPath, `${JSON.stringify(merged, null, "\t")}\n`);
	console.log(
		`tool-contracts: recorded ${newEntries.length} new breaking-change acknowledgement(s) to ${acknowledgementsPath}.`,
	);
}

main();
