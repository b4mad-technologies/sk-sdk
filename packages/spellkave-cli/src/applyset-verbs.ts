// `sk diff -k <dir>` / `sk apply -k <dir>` (ADR-0144 D-2, ADR-0145): thin
// projections of the `spellkave_applyset_diff` / `spellkave_applyset_apply`
// registry tools. This module maps `-k` onto the tools' `dir` parameter and
// renders what the tools return: unified row diffs, `SK_EXTERNAL_DIFF`, hints
// and the diff exit code. It computes no difference itself.

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UsageError } from "./args.ts";
import type { RecordIo } from "./output.ts";

/** `sk diff` exits 3 when it finds differences (kubectl diff exits 1). */
export const EXIT_DIFFERENCES = 3;

export interface ApplysetVerb {
	verb: "diff" | "apply";
	/** Registry tool name without the `spellkave_` prefix. */
	tool: "applyset_diff" | "applyset_apply";
	/** The tool's argv: `--dir <dir>` plus the remaining flags. */
	argv: string[];
}

/**
 * Recognise `sk diff -k <dir> ...` / `sk apply -k <dir> ...`. `sk diff`
 * without `-k` stays the two-file `spellkave_diff` (returns `undefined`);
 * `sk apply` always needs `-k`.
 */
export function applysetVerbArgs(verb: "diff" | "apply", argv: string[]): ApplysetVerb | undefined {
	const at = argv.indexOf("-k");
	if (at < 0) {
		if (verb === "diff") return undefined;
		throw new UsageError(
			"usage: sk apply -k <dir> [--prune] [--dry-run] [--force] [--dep <manifest>]...",
		);
	}
	const dir = argv[at + 1];
	if (dir === undefined || dir.startsWith("-")) {
		throw new UsageError(`usage: sk ${verb} -k <dir> — -k takes the applyset root directory`);
	}
	const rest = [...argv.slice(0, at), ...argv.slice(at + 2)];
	return {
		verb,
		tool: verb === "diff" ? "applyset_diff" : "applyset_apply",
		argv: ["--dir", dir, ...rest],
	};
}

interface RowValues {
	kind: string;
	key: string;
	part: string;
	live: string;
	file: string;
}

interface Row {
	kind: string;
	key: string;
	class: string;
	part: string;
	live?: string;
}

interface WorldAddedLists {
	taken?: Array<{ table?: string; key?: string }>;
	left_behind?: Array<{ table?: string; key?: string }>;
}

interface ApplysetDetails {
	conflicts?: Array<{ kind: string; key: string; part: string }>;
	not_checked?: Array<{ kind: string; key: string; reason: string }>;
	authority_verdicts?: Array<{
		kind: string;
		key: string;
		code: string | null;
		reason: string;
		binding_id: string | null;
		extent_ref: string | null;
	}>;
	refused_by_extent?: Array<{ kind: string; key: string; code: string; owners: string[] }>;
	placement_server_decides?: Array<{ kind: string; key: string }>;
	ok?: boolean;
	differences?: boolean;
	rows?: Row[];
	values?: RowValues[];
	prune_candidates?: Array<{ kind: string; key: string; part: string }>;
	sent?: boolean;
	dry_run?: boolean;
	code?: string;
	error?: string;
	world_added_rows?: Record<string, WorldAddedLists>;
	results?: Array<{ key?: string; kind?: string; world_added_rows?: WorldAddedLists }>;
}

/**
 * A unified diff of two texts (longest common subsequence over lines, whole
 * row as one hunk). Rows are small, so the quadratic table is fine.
 */
export function unifiedDiff(
	liveLabel: string,
	fileLabel: string,
	live: string,
	file: string,
): string {
	const a = live.split("\n");
	const b = file.split("\n");
	const width = b.length + 1;
	// lcs[i * width + j]: length of the longest common subsequence of a[i..] and b[j..].
	const lcs = new Array<number>((a.length + 1) * width).fill(0);
	const at = (i: number, j: number): number => lcs[i * width + j] ?? 0;
	for (let i = a.length - 1; i >= 0; i -= 1) {
		for (let j = b.length - 1; j >= 0; j -= 1) {
			lcs[i * width + j] =
				a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1));
		}
	}
	const lines = [`--- ${liveLabel}`, `+++ ${fileLabel}`, `@@ -1,${a.length} +1,${b.length} @@`];
	let i = 0;
	let j = 0;
	while (i < a.length || j < b.length) {
		if (i < a.length && j < b.length && a[i] === b[j]) {
			lines.push(` ${a[i]}`);
			i += 1;
			j += 1;
		} else if (i < a.length && (j >= b.length || at(i + 1, j) >= at(i, j + 1))) {
			lines.push(`-${a[i]}`);
			i += 1;
		} else {
			lines.push(`+${b[j]}`);
			j += 1;
		}
	}
	return lines.join("\n");
}

function fileName(value: RowValues): string {
	return `${value.kind}/${value.key.replace(/[^A-Za-z0-9._-]+/g, "_")}.json`;
}

/**
 * `SK_EXTERNAL_DIFF` (like `KUBECTL_EXTERNAL_DIFF`): write the live and file
 * values into two directories and run the program on them. The variable may
 * carry arguments (`"diff -u -N"`); the two directories come last.
 */
export function runExternalDiff(command: string, values: readonly RowValues[]): number | null {
	const [program, ...args] = command.trim().split(/\s+/);
	if (program === undefined || program.length === 0) return null;
	const base = mkdtempSync(join(tmpdir(), "sk-diff-"));
	try {
		const liveDir = join(base, "LIVE");
		const fileDir = join(base, "FILES");
		for (const value of values) {
			for (const [dir, text] of [
				[liveDir, value.live],
				[fileDir, value.file],
			] as const) {
				const path = join(dir, fileName(value));
				mkdirSync(join(path, ".."), { recursive: true });
				writeFileSync(path, `${text}\n`);
			}
		}
		const run = spawnSync(program, [...args, liveDir, fileDir], { stdio: "inherit" });
		return run.status;
	} finally {
		rmSync(base, { recursive: true, force: true });
	}
}

function headingLines(
	title: string,
	rows: Array<{ table?: string; key?: string }> | undefined,
): string[] {
	const list = rows ?? [];
	const lines = [`  ${title}:`];
	if (list.length === 0) {
		lines.push("    (none)");
		return lines;
	}
	for (const row of list) {
		lines.push(`    ${row.table ?? "?"} ${row.key ?? ""}`.trimEnd());
	}
	return lines;
}

function worldAddedBlocks(details: ApplysetDetails): string[] {
	const byEntity = new Map<string, WorldAddedLists>();
	for (const [key, lists] of Object.entries(details.world_added_rows ?? {})) {
		byEntity.set(key, lists);
	}
	for (const row of details.results ?? []) {
		if (row.key !== undefined && row.world_added_rows !== undefined && !byEntity.has(row.key)) {
			byEntity.set(row.key, row.world_added_rows);
		}
	}
	const blocks: string[] = [];
	for (const [key, lists] of byEntity) {
		blocks.push(
			[
				`World-added rows on ${key}:`,
				...headingLines("taken with the entity", lists.taken),
				...headingLines("left behind", lists.left_behind),
			].join("\n"),
		);
	}
	return blocks;
}

/**
 * Render what the tool returned beyond its record, and pick the exit code.
 * `toolExit` is `runTool`'s code (0 or 2).
 */
export function finishApplysetVerb(
	io: RecordIo,
	verb: ApplysetVerb,
	details: unknown,
	toolExit: number,
	env: Record<string, string | undefined> = process.env,
): number {
	const d = (details ?? {}) as ApplysetDetails;
	const values = d.values ?? [];
	const conflicts = d.conflicts ?? [];
	const conflictKeys = new Set(conflicts.map((row) => JSON.stringify([row.kind, row.key])));
	for (const row of d.not_checked ?? [])
		io.rawHuman(`not checked: ${row.reason} (${row.kind} ${row.key})`);
	const external = env.SK_EXTERNAL_DIFF;
	if (values.length > 0) {
		if (external !== undefined && external.trim().length > 0) {
			runExternalDiff(external, values);
		} else {
			for (const value of values.filter(
				(row) => !conflictKeys.has(JSON.stringify([row.kind, row.key])),
			)) {
				io.rawHuman(
					unifiedDiff(
						`live ${value.kind} ${value.key}`,
						`${value.part} ${value.kind} ${value.key}`,
						value.live,
						value.file,
					),
				);
			}
		}
	}
	const unreadable = (d.rows ?? []).filter(
		(row) => row.class === "configure" && row.live !== "same" && row.live !== "drift",
	);
	const hints: string[] = [];
	if (unreadable.length > 0) {
		hints.push(
			`${unreadable.length} changed row(s) cannot be compared live; the previous content is not stored. ` +
				"See the change with git diff on the part file:",
			...unreadable.slice(0, 10).map((row) => `  ${row.part}: ${row.kind} ${row.key}`),
		);
		if (unreadable.length > 10) hints.push(`  … ${unreadable.length - 10} more`);
	}
	const candidates = d.prune_candidates ?? [];
	if (verb.verb === "apply" && candidates.length > 0) {
		hints.push(
			`${candidates.length} row(s) are in no file any more and stay on the world; ` +
				"pass --prune to retract them.",
		);
	}
	const refused = d.refused_by_extent ?? [];
	if (refused.length > 0)
		io.rawHuman(
			[
				"Refused by extent:",
				...refused.map(
					(row) => `  ${row.code} ${row.kind} ${row.key} owners=${row.owners.join(",")}`,
				),
			].join("\n"),
		);
	const placement = d.placement_server_decides ?? [];
	const authority = d.authority_verdicts ?? [];
	if (authority.length > 0)
		io.rawHuman(
			[
				"Authority:",
				...authority.map(
					(row) =>
						`  ${row.code ?? "server decides"} ${row.kind} ${row.key}: ${row.reason}${row.binding_id ? ` binding=${row.binding_id} extent=${row.extent_ref}` : ""}`,
				),
			].join("\n"),
		);
	if (placement.length > 0)
		io.rawHuman(
			["Placement: server decides", ...placement.map((row) => `  ${row.kind} ${row.key}`)].join(
				"\n",
			),
		);
	const worldAdded = worldAddedBlocks(d);
	if (worldAdded.length > 0) io.rawHuman(worldAdded.join("\n"));
	if (conflicts.length > 0) {
		io.rawHuman("authored, changed in the world since the last apply:");
		if (external === undefined || external.trim().length === 0) {
			for (const value of values.filter((row) =>
				conflictKeys.has(JSON.stringify([row.kind, row.key])),
			)) {
				io.rawHuman(
					unifiedDiff(
						`live ${value.kind} ${value.key}`,
						`${value.part} ${value.kind} ${value.key}`,
						value.live,
						value.file,
					),
				);
			}
		}
	}

	if (verb.verb === "diff" && d.differences === true && refused.length === 0) {
		hints.push("Next: sk apply -k <dir> — send these differences");
	}
	if (hints.length > 0) io.hint(hints.join("\n"));
	if (refused.length > 0) return 2;
	// `--dry-run` behaves as `sk diff`, exit code included.
	if (verb.verb === "diff" || d.dry_run === true) {
		return d.differences === true ? EXIT_DIFFERENCES : toolExit;
	}
	return toolExit;
}
