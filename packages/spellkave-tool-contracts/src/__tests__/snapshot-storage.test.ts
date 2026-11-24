// keep-file(K1): historical baseline storage corruption and exact-order integrity rules.

import { describe, expect, it } from "vitest";
import { captureSnapshot } from "../contract-guard";
import { TOOL_CONTRACTS, TOOL_ROLE_ROSTERS } from "../metadata";
import {
	contractSnapshotFiles,
	LEGACY_SNAPSHOT_PATH,
	readContractSnapshot,
	SNAPSHOT_DIRECTORY,
	SNAPSHOT_INDEX_PATH,
} from "../snapshot-storage";

const snapshot = captureSnapshot(TOOL_CONTRACTS, TOOL_ROLE_ROSTERS);
const read = (files: ReadonlyMap<string, string>) => (path: string) => files.get(path) ?? null;

describe("historical contract snapshot storage", () => {
	it("round trips the legacy baseline and every split fragment without changing content or order", () => {
		const files = contractSnapshotFiles(snapshot);
		expect(files.size).toBe(snapshot.tools.length + 4);
		expect(JSON.stringify(readContractSnapshot(read(files)))).toBe(JSON.stringify(snapshot));
		expect(
			readContractSnapshot(read(new Map([[LEGACY_SNAPSHOT_PATH, JSON.stringify(snapshot)]]))),
		).toEqual(snapshot);
		expect(readContractSnapshot(() => null)).toBeNull();
	});
	it("fails closed for missing fragments and malformed or ambiguous historical storage", () => {
		const files = new Map(contractSnapshotFiles(snapshot));
		const first = `${SNAPSHOT_DIRECTORY}/tools/${snapshot.tools[0]?.name}.json`;
		files.delete(first);
		expect(() => readContractSnapshot(read(files))).toThrow("missing snapshot fragment");
		files.set(first, "{");
		expect(() => readContractSnapshot(read(files))).toThrow("invalid snapshot JSON");
		files.set(LEGACY_SNAPSHOT_PATH, JSON.stringify(snapshot));
		expect(() => readContractSnapshot(read(files))).toThrow("ambiguous snapshot");
	});
	it("rejects duplicate, unsafe or mismatched names before they can hide removed tools", () => {
		for (const tools of [["../escape"], [snapshot.tools[0]?.name, snapshot.tools[0]?.name]]) {
			const files = new Map(contractSnapshotFiles(snapshot));
			const index = JSON.parse(files.get(SNAPSHOT_INDEX_PATH) ?? "{}");
			files.set(SNAPSHOT_INDEX_PATH, JSON.stringify({ ...index, tools }));
			expect(() => readContractSnapshot(read(files))).toThrow("snapshot names");
		}
		const files = new Map(contractSnapshotFiles(snapshot));
		files.set(
			`${SNAPSHOT_DIRECTORY}/tools/${snapshot.tools[0]?.name}.json`,
			JSON.stringify(snapshot.tools[1]),
		);
		expect(() => readContractSnapshot(read(files))).toThrow("name mismatch");
	});
	it("keeps independent edits to existing tools in separate files with a stable index and rosters", () => {
		const original = contractSnapshotFiles(snapshot);
		for (const selected of [0, 1]) {
			const changed = contractSnapshotFiles({
				...snapshot,
				tools: snapshot.tools.map((tool, index) =>
					index === selected
						? { ...tool, description: `${tool.description} Independent edit.` }
						: tool,
				),
			});
			expect(
				[...changed]
					.filter(([path, content]) => original.get(path) !== content)
					.map(([path]) => path),
			).toEqual([`${SNAPSHOT_DIRECTORY}/tools/${snapshot.tools[selected]?.name}.json`]);
		}
	});
});
