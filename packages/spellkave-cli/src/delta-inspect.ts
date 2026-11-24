// Offline author preflight. Validation deliberately uses the same concatenated
// dependency context as `sk validate --bundle --dep`; this is not a live apply
// simulation, and a root match is evidence of authored presence, not live state.
import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { identityFieldsOf, parseSchemaManifestToml, rowIdentityKey } from "@spellkave/world-author";
import { readMergedManifest, validateBundle } from "./bundle.ts";

type Row = Record<string, unknown>;
type Manifest = Record<string, unknown>;
const exec = promisify(execFile);
const HEADERS = new Set(["bundles", "include", "retractions"]);

// These are advisory risk categories, not a second schema or admission policy.
// ADR-0085 (including its object_state postscript) and ADR-0094 define the
// preservation boundary; unknown live presence always requires operator review.
const SENSITIVE: Readonly<Record<string, string>> = {
	object_state:
		"Player progress/resource values: use observable ModifyResource consequences for already-live entities (ADR-0085).",
	actor_identities: "Player/DM seat identity binding; review takeover and continuity.",
	role_bindings: "Seat authority, extent and expiry; review existing access.",
	role_definitions: "Seat capability policy can affect existing bindings.",
	role_aggregations: "Seat capability policy can affect existing bindings.",
	actors: "Placed actor identity and existing player instance continuity.",
	entities: "Placed entity identity and existing instance continuity.",
	actor_capabilities: "Player progress and grants on an instance.",
	actor_equipment_slots: "Existing inventory and equipment placement.",
	entity_containment: "Existing inventory and contained instance placement.",
	actor_spatial_locations: "Existing actor placement and player position.",
	entity_tag: "Existing instance classification and available actions.",
	entity_resource_bound: "Existing instance resource bounds and progress.",
	target_conditions: "Existing instance conditions and progress.",
	place_graph_instances: "Existing world instance topology and placement.",
	place_seals: "Existing traversal state and progress.",
	session_definitions: "Session references can affect existing seats and instances.",
	retractions:
		"Deletion can cascade through existing instances, grants or seats; review preservation before apply.",
};

function rows(value: unknown): Row[] {
	return Array.isArray(value)
		? value.filter(
				(row): row is Row => row !== null && typeof row === "object" && !Array.isArray(row),
			)
		: [];
}

export function analyzeDeltaRows(delta: Manifest, context: Manifest) {
	const sensitiveRows: Array<{
		rowKind: string;
		index: number;
		key: string | null;
		presentInRoots: boolean | null;
		reason: string;
		row: Row;
	}> = [];
	const unkeyedKinds: Array<{ rowKind: string; count: number; testToAdd: string }> = [];
	const additions: Array<{
		rowKind: string;
		count: number;
		certainty: "absent_from_roots" | "unkeyed";
	}> = [];
	for (const [kind, value] of Object.entries(delta).sort(([a], [b]) => a.localeCompare(b))) {
		const own = rows(value);
		if (own.length === 0 || kind === "include" || kind === "bundles") continue;
		const keyed = identityFieldsOf(kind) !== undefined;
		const existing = new Set(rows(context[kind]).map((row) => rowIdentityKey(kind, row)));
		if (!HEADERS.has(kind)) {
			if (!keyed) {
				unkeyedKinds.push({
					rowKind: kind,
					count: own.length,
					testToAdd:
						kind === "consequence_frame_writes"
							? "Add a generator drift test comparing the complete frame-write list per template_id in ordinal order (including removals/reordering), plus a behaviour scenario proving the intended consequence. A keyed .expected.toml sibling can cover the other rows; it cannot prove ordered writes."
							: "Add a generator drift test comparing the complete owned row set and a behaviour scenario for its effect; use a keyed .expected.toml sibling for the subset-checkable rows.",
				});
			}
			const added = keyed
				? own.filter((row) => !existing.has(rowIdentityKey(kind, row))).length
				: own.length;
			if (added > 0)
				additions.push({
					rowKind: kind,
					count: added,
					certainty: keyed ? "absent_from_roots" : "unkeyed",
				});
		}
		const reason = SENSITIVE[kind];
		if (reason)
			own.forEach((row, index) => {
				const key = rowIdentityKey(kind, row) ?? null;
				sensitiveRows.push({
					rowKind: kind,
					index,
					key,
					presentInRoots: keyed ? existing.has(key ?? undefined) : null,
					reason,
					row,
				});
			});
	}
	return { sensitiveRows, unkeyedKinds, additions };
}

async function gitStatus(path: string) {
	const absolute = resolve(path);
	try {
		const { stdout } = await exec("git", ["-C", dirname(absolute), "rev-parse", "--show-toplevel"]);
		const repo = stdout.trim();
		const repoPath = relative(repo, absolute).split("\\").join("/");
		const { stdout: tracked } = await exec("git", [
			"--literal-pathspecs",
			"-C",
			repo,
			"ls-files",
			"-z",
			"--",
			repoPath,
		]);
		return { status: "known" as const, tracked: tracked.split("\0").includes(repoPath), repoPath };
	} catch (error) {
		return {
			status: "unknown" as const,
			tracked: null,
			repoPath: null,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function inspectDelta(path: string, roots: string[]) {
	const against = await Promise.all(
		roots.map(async (root) =>
			(await stat(root)).isDirectory() ? join(root, "manifest.toml") : root,
		),
	);
	const validation = await validateBundle(path, against, true);
	const delta = (await readMergedManifest(path, [], true)).manifest;
	const context: Manifest = {};
	for (const root of against) {
		const part = (await readMergedManifest(root, [], true)).manifest;
		for (const [kind, value] of Object.entries(part)) {
			if (Array.isArray(value)) context[kind] = [...rows(context[kind]), ...rows(value)];
		}
	}
	const analysis = analyzeDeltaRows(delta, context);
	const git = await gitStatus(path);
	const expectedPath = path.endsWith(".toml")
		? path.replace(/\.toml$/, ".expected.toml")
		: `${path}.expected.toml`;
	let expected: Manifest | undefined;
	try {
		expected = parseSchemaManifestToml(await readFile(expectedPath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const expectedGit = expected === undefined ? null : await gitStatus(expectedPath);
	const gatePath =
		git.repoPath !== null &&
		/^packages\/[^/]+\/fixtures\/live-deltas\/[^/]+\.toml$/.test(git.repoPath) &&
		!git.repoPath.endsWith(".expected.toml");
	return {
		path,
		against,
		validation,
		preservation: {
			basis:
				"Offline risk review only: roots describe authored rows, not live state or player ownership. Absence here does not establish a new live instance. Review preserve/reset/rollback before applying.",
			rows: analysis.sensitiveRows,
		},
		git: {
			...git,
			warning:
				git.tracked === true
					? null
					: "The gate enumerates tracked files; a green gate does not cover an untracked delta. Add the delta to git before running the gate.",
		},
		regression: {
			gate: "live-delta-subset",
			gatePath,
			discoverable: gatePath && git.tracked === true,
			specPath: expected === undefined ? path : expectedPath,
			expectedGit,
			unkeyedKinds: analysis.unkeyedKinds,
			specUnkeyedKinds: analyzeDeltaRows(expected ?? delta, {}).unkeyedKinds,
			includesNeedExplicitSpec: rows(delta.include).length > 0,
			note: "Gate discovery requires a tracked packages/*/fixtures/live-deltas/*.toml delta. A sibling .expected.toml replaces the gate's subset claim; commit it too. The gate does not expand delta/spec includes. This report does not run the subset gate or prove fixture parity.",
		},
		census: {
			regenerationNeeded: analysis.additions.length > 0 || rows(delta.retractions).length > 0,
			potentialAdditions: analysis.additions,
			command: "just website-census",
			note: "Advisory: regenerate and commit website census snapshots when these additions reach SRD-CC or a census-projected adventure fixture. Unkeyed rows cannot be counted as definite additions. Description changes can also require recapture; docs-census-pairing is authoritative for the final git range.",
		},
	};
}
