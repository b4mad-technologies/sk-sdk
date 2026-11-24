// sk-jay0.7.171.1: every `sk --live apply_manifest_delta` leaves a record.
//
// The live patch loop (`sandbox/live-patch-loop/README.md`,
// `.agents/skills/sk-playtest/workflows/live-patch-local.md`) proves a
// content fix on a running node with a delta, and the delta is then the
// author's spec for the generator edit. Until now the DM copied the TOML by
// hand into `.local/live-deltas/`; a forgotten copy left the proof only in
// the node's memory. This module writes the applied TOML and one journal
// line per attempt, failures included (a drain-time `MF-APPLY-029` is still
// a record of what was tried).
//
// Journal, not gate: nothing here judges a delta. The subset gate that turns
// an accepted delta into a regression spec is sk-jay0.7.171.2.

import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** Default journal directory under the caller's cwd, beside the scratch bundle. */
export const LIVE_DELTA_JOURNAL_DIR = join(".local", "live-deltas");
export const LIVE_DELTA_JOURNAL_FILE = "journal.jsonl";
/** `SPELLKAVE_LIVE_DELTA_JOURNAL=0` turns the journal off; any other value keeps it on. */
export const LIVE_DELTA_JOURNAL_ENABLED_ENV = "SPELLKAVE_LIVE_DELTA_JOURNAL";
/** `SPELLKAVE_LIVE_DELTA_JOURNAL_DIR=<dir>` relocates the journal. */
export const LIVE_DELTA_JOURNAL_DIR_ENV = "SPELLKAVE_LIVE_DELTA_JOURNAL_DIR";

export interface LiveDeltaJournalEntry {
	seq: number;
	at: string;
	url: string;
	db: string;
	source: "toml" | "scratch";
	ok: boolean;
	detail?: string;
	duration_ms: number;
	lines: number;
	sha256: string;
	path: string;
}

export interface RecordLiveDeltaInput {
	dir: string;
	toml: string;
	source: "toml" | "scratch";
	url: string;
	db: string;
	ok: boolean;
	detail?: string;
	durationMs: number;
	now?: Date;
}

/** Resolve the journal directory from the environment, or `undefined` when the journal is off. */
export function resolveLiveDeltaJournalDir(
	env: NodeJS.ProcessEnv = process.env,
	cwd: string = process.cwd(),
): string | undefined {
	if (env[LIVE_DELTA_JOURNAL_ENABLED_ENV] === "0") return undefined;
	const override = env[LIVE_DELTA_JOURNAL_DIR_ENV];
	return resolve(
		cwd,
		override !== undefined && override.length > 0 ? override : LIVE_DELTA_JOURNAL_DIR,
	);
}

function nextSeq(dir: string): number {
	let max = 0;
	for (const name of readdirSync(dir)) {
		const match = /^(\d{3,})-.*\.toml$/.exec(name);
		if (match !== null) max = Math.max(max, Number(match[1]));
	}
	return max + 1;
}

/** Write `NNN-<utc>.toml` and append the journal line; returns the entry as written. */
export function recordLiveDelta(input: RecordLiveDeltaInput): LiveDeltaJournalEntry {
	mkdirSync(input.dir, { recursive: true });
	const seq = nextSeq(input.dir);
	const now = input.now ?? new Date();
	const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "z");
	const fileName = `${String(seq).padStart(3, "0")}-${stamp}.toml`;
	const path = join(input.dir, fileName);
	writeFileSync(path, input.toml.endsWith("\n") ? input.toml : `${input.toml}\n`, "utf8");
	const entry: LiveDeltaJournalEntry = {
		seq,
		at: now.toISOString(),
		url: input.url,
		db: input.db,
		source: input.source,
		ok: input.ok,
		...(input.detail === undefined ? {} : { detail: input.detail }),
		duration_ms: Math.max(0, Math.round(input.durationMs)),
		lines: input.toml.split("\n").filter((line) => line.length > 0).length,
		sha256: createHash("sha256").update(input.toml).digest("hex"),
		path,
	};
	appendFileSync(join(input.dir, LIVE_DELTA_JOURNAL_FILE), `${JSON.stringify(entry)}\n`, "utf8");
	return entry;
}
