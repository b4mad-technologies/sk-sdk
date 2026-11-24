import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { captureSnapshot, unknownContractFields } from "../contract-guard";
import { TOOL_CONTRACTS, TOOL_ROLE_ROSTERS } from "../metadata";
import {
	contractSnapshotFiles,
	readContractSnapshot,
	SNAPSHOT_DIRECTORY,
} from "../snapshot-storage";

// keep-file(K1): committed baseline integrity and descriptor-schema drift checks.

const snapshotPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("committed contract snapshot tracks the live contracts (VISIBLE drift)", () => {
	it("matches `pnpm --filter @spellkave/tool-contracts run capture-contracts` output exactly", () => {
		const committed = readContractSnapshot((path) => {
			const target = join(snapshotPath, path);
			return existsSync(target) ? readFileSync(target, "utf8") : null;
		});
		const live = captureSnapshot(TOOL_CONTRACTS, TOOL_ROLE_ROSTERS);
		expect(
			committed,
			"src/tool-contracts.snapshot/ is stale. Run `pnpm --filter @spellkave/tool-contracts run capture-contracts` and commit the result — every contract change (new tool, new optional parameter, description text) must show up as a reviewable diff.",
		).toEqual(live);
		const files = readdirSync(join(snapshotPath, SNAPSHOT_DIRECTORY), {
			recursive: true,
			withFileTypes: true,
		})
			.filter((entry) => entry.isFile())
			.map((entry) => join(entry.parentPath, entry.name).slice(snapshotPath.length + 1));
		expect(files.sort()).toEqual([...contractSnapshotFiles(live).keys()].sort());
	});

	// Guards the untyped JSON cast in contract-data.ts: a stray field on a raw
	// contract object would pass `as ToolContractDataFile` silently.
	it("keeps every contract to known descriptor fields", () => {
		const offenders = TOOL_CONTRACTS.filter(
			(contract) => unknownContractFields(contract).length > 0,
		).map((contract) => ({ name: contract.name, fields: unknownContractFields(contract) }));
		expect(offenders).toEqual([]);
	});
});
