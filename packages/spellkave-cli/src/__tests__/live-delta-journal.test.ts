// Every manifest delta `sk --live apply_manifest_delta` sends is kept on
// disk, so an author can see later what was applied to a world and what was
// refused: the TOML as one numbered file and one JSONL line per attempt.
// These tests check the file names, the numbering after existing files, and
// where the journal goes (cwd, an override, or off). Temp directories; no node.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	LIVE_DELTA_JOURNAL_DIR,
	LIVE_DELTA_JOURNAL_FILE,
	type LiveDeltaJournalEntry,
	recordLiveDelta,
	resolveLiveDeltaJournalDir,
} from "../live-delta-journal.ts";

const DELTA = 'schema_version = "1.0.0"\n\n[[bundles]]\nbundle_id = "kavemouth"\n';

describe("live delta journal", () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "sk-live-deltas-"));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("writes the TOML under a sequence-and-time name and appends one journal line", () => {
		const entry = recordLiveDelta({
			dir,
			toml: DELTA,
			source: "toml",
			url: "http://127.0.0.1:11502",
			db: "spellkave-dev",
			ok: true,
			durationMs: 1287.4,
			now: new Date("2026-09-25T09:41:03.120Z"),
		});
		expect(entry.seq).toBe(1);
		expect(entry.path).toBe(join(dir, "001-2026-09-25T09-41-03-120z.toml"));
		expect(readFileSync(entry.path, "utf8")).toBe(DELTA);
		expect(entry).toMatchObject({
			ok: true,
			source: "toml",
			duration_ms: 1287,
			lines: 3,
			url: "http://127.0.0.1:11502",
			db: "spellkave-dev",
		});
		expect(entry).not.toHaveProperty("detail");
		const lines = readFileSync(join(dir, LIVE_DELTA_JOURNAL_FILE), "utf8").trim().split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0] as string)).toEqual(entry);
	});

	it("numbers later entries after the highest existing file and keeps failures", () => {
		recordLiveDelta({
			dir,
			toml: DELTA,
			source: "toml",
			url: "u",
			db: "d",
			ok: true,
			durationMs: 1,
		});
		const failed = recordLiveDelta({
			dir,
			toml: "bogus",
			source: "scratch",
			url: "u",
			db: "d",
			ok: false,
			detail: "MF-APPLY-026: unknown container_entity_key",
			durationMs: 90_000,
		});
		expect(failed.seq).toBe(2);
		expect(failed.detail).toContain("MF-APPLY-026");
		expect(readFileSync(failed.path, "utf8")).toBe("bogus\n");
		const files = readdirSync(dir).filter((name) => name.endsWith(".toml"));
		expect(files.map((name) => name.slice(0, 4))).toEqual(["001-", "002-"]);
		const entries = readFileSync(join(dir, LIVE_DELTA_JOURNAL_FILE), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as LiveDeltaJournalEntry);
		expect(entries.map((entry) => [entry.seq, entry.ok])).toEqual([
			[1, true],
			[2, false],
		]);
		expect(entries[0]?.sha256).not.toBe(entries[1]?.sha256);
	});

	it("resolves the directory from cwd, an override, or nothing when switched off", () => {
		expect(resolveLiveDeltaJournalDir({}, "/repo")).toBe(join("/repo", LIVE_DELTA_JOURNAL_DIR));
		expect(
			resolveLiveDeltaJournalDir({ SPELLKAVE_LIVE_DELTA_JOURNAL_DIR: "/elsewhere" }, "/repo"),
		).toBe("/elsewhere");
		expect(resolveLiveDeltaJournalDir({ SPELLKAVE_LIVE_DELTA_JOURNAL_DIR: "rel" }, "/repo")).toBe(
			join("/repo", "rel"),
		);
		expect(
			resolveLiveDeltaJournalDir({ SPELLKAVE_LIVE_DELTA_JOURNAL: "0" }, "/repo"),
		).toBeUndefined();
		expect(existsSync(join("/repo", LIVE_DELTA_JOURNAL_DIR))).toBe(false);
	});
});
