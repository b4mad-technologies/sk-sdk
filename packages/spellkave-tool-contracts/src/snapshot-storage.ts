import { TOOL_ROLES } from "./contract-data";
import {
	CONTRACT_SNAPSHOT_FORMAT,
	type ContractSnapshotFile,
	type SerialisedContract,
} from "./contract-guard";

export { gitBatchInput, parseGitBatch } from "./git-batch";

/** Paths are package-relative so the same reader works with Git and an in-memory tree. */
export const LEGACY_SNAPSHOT_PATH = "src/tool-contracts.snapshot.json";
export const SNAPSHOT_DIRECTORY = "src/tool-contracts.snapshot";
export const SNAPSHOT_INDEX_PATH = `${SNAPSHOT_DIRECTORY}/index.json`;
const STORAGE_FORMAT = "spellkave-tool-contracts/snapshot-storage/v1";

type ReadSnapshotFile = (path: string) => string | null;

function object(value: unknown, path: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`invalid snapshot object: ${path}`);
	}
	return value as Record<string, unknown>;
}

function parse(raw: string, path: string): unknown {
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error(`invalid snapshot JSON: ${path}`);
	}
}

function names(value: unknown, path: string): string[] {
	if (
		!Array.isArray(value) ||
		!value.every((name) => typeof name === "string" && /^[a-z][a-z0-9_]*$/.test(name)) ||
		new Set(value).size !== value.length
	) {
		throw new Error(`invalid or duplicate snapshot names: ${path}`);
	}
	return value as string[];
}

function validate(value: unknown, path: string): ContractSnapshotFile {
	const snapshot = object(value, path);
	if (snapshot.format !== CONTRACT_SNAPSHOT_FORMAT || !Array.isArray(snapshot.tools)) {
		throw new Error(`invalid snapshot format: ${path}`);
	}
	const toolNames = names(
		snapshot.tools.map((tool) => object(tool, path).name),
		path,
	);
	for (const tool of snapshot.tools) {
		const row = object(tool, path);
		object(row.parameters, path);
		if (typeof row.executionMode !== "string") throw new Error(`invalid snapshot tool: ${path}`);
	}
	const rosters = object(snapshot.rosters, path);
	if (Object.keys(rosters).length !== TOOL_ROLES.length)
		throw new Error(`invalid snapshot rosters: ${path}`);
	for (const role of TOOL_ROLES) {
		if (names(rosters[role], path).some((name) => !toolNames.includes(name))) {
			throw new Error(`unknown tool in snapshot roster: ${path}`);
		}
	}
	return snapshot as unknown as ContractSnapshotFile;
}

/** Load every fragment from one accepted Git ref; never fall back to the candidate tree. */
export function readContractSnapshot(
	read: ReadSnapshotFile,
	readMany?: (paths: readonly string[]) => ReadonlyMap<string, string | null>,
): ContractSnapshotFile | null {
	const indexRaw = read(SNAPSHOT_INDEX_PATH);
	const legacyRaw = read(LEGACY_SNAPSHOT_PATH);
	if (indexRaw === null) {
		return legacyRaw === null
			? null
			: validate(parse(legacyRaw, LEGACY_SNAPSHOT_PATH), LEGACY_SNAPSHOT_PATH);
	}
	if (legacyRaw !== null)
		throw new Error("ambiguous snapshot: legacy and split baselines both exist");
	const index = object(parse(indexRaw, SNAPSHOT_INDEX_PATH), SNAPSHOT_INDEX_PATH);
	if (index.format !== STORAGE_FORMAT)
		throw new Error(`invalid snapshot index: ${SNAPSHOT_INDEX_PATH}`);
	const toolNames = names(index.tools, SNAPSHOT_INDEX_PATH);
	if (JSON.stringify(index.roles) !== JSON.stringify(TOOL_ROLES))
		throw new Error("invalid snapshot index roles");
	const paths = [
		...toolNames.map((name) => `${SNAPSHOT_DIRECTORY}/tools/${name}.json`),
		...TOOL_ROLES.map((role) => `${SNAPSHOT_DIRECTORY}/rosters/${role}.json`),
	];
	const fragments = readMany?.(paths);
	function required(path: string): unknown {
		const raw = fragments === undefined ? read(path) : (fragments.get(path) ?? null);
		if (raw === null) throw new Error(`missing snapshot fragment: ${path}`);
		return parse(raw, path);
	}
	const tools = toolNames.map((name) => {
		const path = `${SNAPSHOT_DIRECTORY}/tools/${name}.json`;
		const tool = object(required(path), path);
		if (tool.name !== name) throw new Error(`snapshot tool name mismatch: ${path}`);
		return tool as unknown as SerialisedContract;
	});
	const rosters = Object.fromEntries(
		TOOL_ROLES.map((role) => [role, required(`${SNAPSHOT_DIRECTORY}/rosters/${role}.json`)]),
	);
	return validate({ format: CONTRACT_SNAPSHOT_FORMAT, tools, rosters }, SNAPSHOT_INDEX_PATH);
}

/** Stable index order preserves the historical wire snapshot exactly; tools edit independently. */
export function contractSnapshotFiles(snapshot: ContractSnapshotFile): ReadonlyMap<string, string> {
	validate(snapshot, SNAPSHOT_INDEX_PATH);
	const json = (value: unknown) => `${JSON.stringify(value, null, "\t")}\n`;
	return new Map([
		[
			SNAPSHOT_INDEX_PATH,
			json({
				format: STORAGE_FORMAT,
				tools: snapshot.tools.map((tool) => tool.name),
				roles: TOOL_ROLES,
			}),
		],
		...snapshot.tools.map((tool): [string, string] => [
			`${SNAPSHOT_DIRECTORY}/tools/${tool.name}.json`,
			json(tool),
		]),
		...TOOL_ROLES.map((role): [string, string] => [
			`${SNAPSHOT_DIRECTORY}/rosters/${role}.json`,
			json(snapshot.rosters[role]),
		]),
	]);
}
