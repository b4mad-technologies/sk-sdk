// Node-only surface: the CANONICAL JSONL file sink and the run index over a
// directory tree (ADR-0074 S2). Kept out of the browser-safe barrel — the
// gateway sink and readers over in-memory text need no fs.
//
// Layout contract: the sink writes ONE standard-named file per run,
// `agent-run-events.jsonl`, INSIDE a run directory the host already owns
// (today: the retained-run structure under `.local/campaign-runs`, owned by
// world-explorer's CampaignArtifactStore). The host owns the tree; this
// package owns only the file name and its line format — that is what keeps
// progress-explorer's existing artifact walking working mid-migration.
import type { Dirent } from "node:fs";
import {
	appendFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";

export * from "./node-memory.ts";
export * from "./node-metrics.ts";
export {
	describeExportError,
	IMAGE_TAG_ENV,
	logSinkResourceAttributesFromEnv,
	parseOtelPairs,
	serviceVersionFromEnv,
} from "./node-resource.ts";
export * from "./node-traces.ts";

import { dirname, join } from "node:path";
import type { AgentRunSink } from "./emit.ts";
import type { AgentRunEvent } from "./events.ts";
import {
	aggregateRunTotals,
	classifyTerminal,
	parseRunEvents,
	type RunTotals,
	type TerminalClassification,
} from "./reader.ts";

/** The one canonical per-run events file name. */
export const AGENT_RUN_EVENTS_FILENAME = "agent-run-events.jsonl";

/** Matches the campaign store's private-artifact posture (0600 files). */
const PRIVATE_FILE_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;

export interface JsonlFileSinkOptions {
	/**
	 * When true, truncate the file on first write of this sink instance so a
	 * re-run owns a clean artifact (commit-stable playthroughs). Default false
	 * — append remains the historical campaign/session behavior.
	 */
	truncate?: boolean;
	/**
	 * Byte cap for the live file. Once a write would take it past the cap the
	 * file is rotated to `<path>.1` (replacing any previous generation) and a
	 * fresh file starts, so a long-lived appender occupies at most
	 * `2 * maxBytes` on disk, except for an event larger than the cap. The default leaves rotation disabled.
	 *
	 * A single line larger than the cap is still written whole; the sink never
	 * splits or drops an event, it only decides where the file boundary falls.
	 */
	maxBytes?: number;
	/**
	 * Directory the volume budget is measured over — the root every seat's run
	 * directory lives under. Only
	 * meaningful together with {@link rootMaxBytes}.
	 */
	rootDir?: string;
	/**
	 * Byte budget for the WHOLE tree under {@link rootDir}, enforced on every
	 * rotation by deleting rotated generations oldest-first (sk-jay0.6.15.40).
	 *
	 * A per-seat bound leaves total disk use dependent on the number of
	 * seats. Use a shared volume budget to bound retained generations.
	 *
	 * Live files are counted but never deleted: a live file is an in-flight run
	 * and the sink's byte counter would be wrong afterwards. When the live set
	 * alone exceeds the budget there is nothing left to prune, and
	 * {@link pruneRotatedTranscripts} says so in its result rather than
	 * pretending it succeeded — that is the signal that `maxBytes` or the PVC
	 * needs revisiting, not a condition this sink can fix.
	 *
	 * Default: `undefined` (no volume bound) — existing behavior.
	 */
	rootMaxBytes?: number;
}

/** What one budget enforcement pass did. */
export interface TranscriptPruneResult {
	/** Bytes under the root before pruning (live + rotated). */
	bytesBefore: number;
	/** Bytes under the root after pruning. */
	bytesAfter: number;
	/** Rotated files deleted, oldest first. */
	deleted: string[];
	/**
	 * True when the budget is still exceeded with every rotated generation
	 * gone, i.e. the LIVE files alone do not fit. Nothing more can be pruned
	 * safely; `maxBytes` is too high for this seat count, or the volume is too
	 * small.
	 */
	overBudget: boolean;
}

/**
 * Delete rotated run-event generations under `rootDir`, oldest first, until the
 * whole tree fits in `budgetBytes`. Live `agent-run-events.jsonl` files are
 * counted toward the budget and never deleted.
 *
 * Exported for the tests and for an operator one-shot; the sink calls it on
 * rotation.
 */
export function pruneRotatedTranscripts(
	rootDir: string,
	budgetBytes: number,
): TranscriptPruneResult {
	const live: number[] = [];
	const rotated: { path: string; size: number; mtimeMs: number }[] = [];
	walkTranscripts(rootDir, (path, stat) => {
		const name = path.slice(path.lastIndexOf("/") + 1);
		if (name === AGENT_RUN_EVENTS_FILENAME) live.push(stat.size);
		else if (name.startsWith(`${AGENT_RUN_EVENTS_FILENAME}.`))
			rotated.push({ path, size: stat.size, mtimeMs: stat.mtimeMs });
	});
	const liveBytes = live.reduce((sum, size) => sum + size, 0);
	let total = liveBytes + rotated.reduce((sum, file) => sum + file.size, 0);
	const bytesBefore = total;
	const deleted: string[] = [];
	// Oldest first: the newest generation is the one most likely to still be
	// worth reading next to its live file.
	rotated.sort((a, b) => a.mtimeMs - b.mtimeMs);
	for (const file of rotated) {
		if (total <= budgetBytes) break;
		try {
			rmSync(file.path, { force: true });
		} catch {
			continue;
		}
		total -= file.size;
		deleted.push(file.path);
	}
	return { bytesBefore, bytesAfter: total, deleted, overBudget: total > budgetBytes };
}

/** Depth-first walk of `rootDir`, visiting every regular file. */
function walkTranscripts(
	rootDir: string,
	visit: (path: string, stat: { size: number; mtimeMs: number }) => void,
): void {
	let entries: Dirent[];
	try {
		entries = readdirSync(rootDir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const path = join(rootDir, entry.name);
		if (entry.isDirectory()) {
			walkTranscripts(path, visit);
			continue;
		}
		if (!entry.isFile()) continue;
		try {
			const stat = statSync(path);
			visit(path, { size: stat.size, mtimeMs: stat.mtimeMs });
		} catch {
			// Raced with another host's rotation; the next pass sees the truth.
		}
	}
}

/**
 * Canonical sink: append one JSON line per event. Writes are synchronous —
 * an emitting run must never lose its tail on process exit, and event volume
 * is tiny (tens of lines per run).
 */
export function createJsonlFileSink(
	filePath: string,
	options: JsonlFileSinkOptions = {},
): AgentRunSink {
	let directoryReady = false;
	let truncated = false;
	const truncate = options.truncate === true;
	const maxBytes =
		options.maxBytes !== undefined && options.maxBytes > 0 ? options.maxBytes : undefined;
	const rootDir = options.rootDir;
	const rootMaxBytes =
		rootDir !== undefined && options.rootMaxBytes !== undefined && options.rootMaxBytes > 0
			? options.rootMaxBytes
			: undefined;
	// Tracked in-process: `statSync` per line would be a syscall per event, and
	// this sink is the hot path of a 24/7 host. Seeded once from the file left
	// by the previous process so a restart cannot reset the budget to zero.
	let liveBytes: number | undefined;
	// True when the file this sink opened was ALREADY over the cap: written by a
	// build that had no rotation, so its size was never part of anyone's budget.
	// Retiring it into `.1` would pin that size on the disk indefinitely, which
	// is the very state this option exists to clear, so it is dropped once.
	// A file WE wrote is always retained, even if one huge line overshot.
	let legacyOversized = false;

	function rotate(): void {
		if (legacyOversized) {
			rmSync(filePath, { force: true });
			legacyOversized = false;
		} else {
			// POSIX rename replaces `.1` atomically: exactly one old generation.
			renameSync(filePath, `${filePath}.1`);
		}
		liveBytes = 0;
		// Rotation is the only moment this tree grows by a whole generation, so
		// it is the right and cheapest place to enforce the volume budget: once
		// per maxBytes written, never per line.
		if (rootMaxBytes !== undefined && rootDir !== undefined) {
			try {
				const pruned = pruneRotatedTranscripts(rootDir, rootMaxBytes);
				if (pruned.overBudget) {
					// ADR-0002: say it, do not swallow it. Nothing else observes
					// this — the volume filling is exactly the silent failure
					// sk-jay0.6.15.40 records.
					process.stderr.write(
						`${JSON.stringify({
							v: "agent-run-events-prune/v1",
							kind: "transcript_budget_exceeded",
							root: rootDir,
							budget_bytes: rootMaxBytes,
							bytes_after: pruned.bytesAfter,
							deleted: pruned.deleted.length,
							detail:
								"live transcripts alone exceed the budget; lower SPELLKAVE_RUN_EVENTS_MAX_BYTES or grow the volume",
						})}\n`,
					);
				}
			} catch {
				// A failed prune must never take the host down: the write that
				// triggered it still has to land.
			}
		}
	}

	return {
		write(event: AgentRunEvent) {
			if (!directoryReady) {
				mkdirSync(dirname(filePath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
				directoryReady = true;
			}
			const line = `${JSON.stringify(event)}\n`;
			if (truncate && !truncated) {
				writeFileSync(filePath, line, { mode: PRIVATE_FILE_MODE });
				truncated = true;
				liveBytes = Buffer.byteLength(line);
				return;
			}
			if (maxBytes !== undefined) {
				if (liveBytes === undefined) {
					liveBytes = existingSize(filePath);
					legacyOversized = liveBytes > maxBytes;
				}
				// Rotate only a non-empty file: a line bigger than the whole cap
				// would otherwise rotate on every write and never make progress.
				if (liveBytes > 0 && liveBytes + Buffer.byteLength(line) > maxBytes) rotate();
			}
			appendFileSync(filePath, line, { mode: PRIVATE_FILE_MODE });
			if (liveBytes !== undefined) liveBytes += Buffer.byteLength(line);
		},
	};
}

/** Size of an existing file, or 0 when it is absent/unreadable. */
function existingSize(filePath: string): number {
	try {
		return statSync(filePath).size;
	} catch {
		return 0;
	}
}

/** Read + tolerantly parse one run's events file. */
export function readRunEventsFile(filePath: string): ReturnType<typeof parseRunEvents> {
	return parseRunEvents(readFileSync(filePath, "utf8"));
}

/** One run as the index sees it. */
export interface RunIndexEntry {
	/** Absolute path of the run's events file. */
	file: string;
	run_id: string;
	run_kind: string;
	actor_id: string;
	role: string;
	controller_kind: string;
	driver: string;
	model?: string;
	seed: string;
	/** ts of the first event (run start ordering key). */
	first_ts: string;
	/** ts of the last event. */
	last_ts: string;
	totals: RunTotals;
	terminal: TerminalClassification;
	/** Lines skipped by the tolerant parser. */
	skipped_lines: number;
}

/**
 * Run index: walk `root` recursively for `agent-run-events.jsonl` files and
 * summarise each run PER ACTOR — the single consumption path for
 * progress-explorer's index build and the playtest judge (S5). One run's
 * timeline may carry several actors (the LLM player plus deterministic
 * NPC/companion emitters share the run_id and sink); each actor gets its own
 * summary so per-actor totals never bleed into each other.
 */
export function buildRunIndex(root: string): RunIndexEntry[] {
	const entries: RunIndexEntry[] = [];
	for (const file of walkForEventFiles(root)) {
		const { events, skipped } = readRunEventsFile(file);
		const byRunActor = new Map<string, AgentRunEvent[]>();
		for (const event of events) {
			const key = `${event.run_id}\u0000${event.actor_id}`;
			const bucket = byRunActor.get(key);
			if (bucket === undefined) byRunActor.set(key, [event]);
			else bucket.push(event);
		}
		for (const runEvents of byRunActor.values()) {
			const first = runEvents[0] as AgentRunEvent;
			const last = runEvents[runEvents.length - 1] as AgentRunEvent;
			entries.push({
				file,
				run_id: first.run_id,
				run_kind: first.run_kind,
				actor_id: first.actor_id,
				role: first.role,
				controller_kind: first.controller_kind,
				driver: first.driver,
				...(first.model !== undefined ? { model: first.model } : {}),
				seed: first.seed,
				first_ts: first.ts,
				last_ts: last.ts,
				totals: aggregateRunTotals(runEvents),
				terminal: classifyTerminal(runEvents),
				skipped_lines: skipped,
			});
		}
	}
	entries.sort((a, b) => a.first_ts.localeCompare(b.first_ts) || a.run_id.localeCompare(b.run_id));
	return entries;
}

function walkForEventFiles(root: string): string[] {
	const files: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const dir = stack.pop() as string;
		let names: string[];
		try {
			names = readdirSync(dir);
		} catch {
			continue; // unreadable/removed directory — the index is best-effort
		}
		for (const name of names) {
			const path = join(dir, name);
			let stats: ReturnType<typeof statSync>;
			try {
				stats = statSync(path);
			} catch {
				continue;
			}
			if (stats.isDirectory()) stack.push(path);
			else if (name === AGENT_RUN_EVENTS_FILENAME) files.push(path);
		}
	}
	return files;
}
