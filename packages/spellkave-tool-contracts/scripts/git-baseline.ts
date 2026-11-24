import { execFileSync } from "node:child_process";
import { relative, sep } from "node:path";
import { TextDecoder } from "node:util";
import {
	gitBatchInput,
	LEGACY_SNAPSHOT_PATH,
	parseGitBatch,
	readContractSnapshot,
	SNAPSHOT_INDEX_PATH,
} from "../src/snapshot-storage.ts";

function reader(packageRoot: string) {
	const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
	const prefix = relative(root, packageRoot).split(sep).join("/");
	return (ref: string, paths: readonly string[]) => {
		if (paths.length === 0) return new Map<string, string | null>();
		const specs = paths.map((path) => `${ref}:${prefix}/${path}`);
		const output = execFileSync("git", ["cat-file", "--batch"], {
			cwd: root,
			input: gitBatchInput(specs),
			maxBuffer: 64 * 1024 * 1024,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const decoder = new TextDecoder("utf-8", { fatal: true });
		const files = parseGitBatch(specs, output, (bytes) => decoder.decode(bytes));
		return new Map(paths.map((path, index) => [path, files.get(specs[index] ?? "") ?? null]));
	};
}

/** Local early warning: choose the whole INDEX or HEAD tree, never mix fragments. */
export function readCommittedSnapshot(packageRoot: string) {
	const readMany = reader(packageRoot);
	const initial = readMany("", [LEGACY_SNAPSHOT_PATH, SNAPSHOT_INDEX_PATH]);
	if ([...initial.values()].every((value) => value === null)) {
		return readSnapshotAtCommit("HEAD", packageRoot);
	}
	return readContractSnapshot(
		(path) => initial.get(path) ?? null,
		(paths) => readMany("", paths),
	);
}

/** Authoritative baseline: every fragment comes from exactly the requested merge base. */
export function readSnapshotAtCommit(commit: string, packageRoot: string) {
	const readMany = reader(packageRoot);
	const initial = readMany(commit, [LEGACY_SNAPSHOT_PATH, SNAPSHOT_INDEX_PATH]);
	return readContractSnapshot(
		(path) => initial.get(path) ?? null,
		(paths) => readMany(commit, paths),
	);
}
