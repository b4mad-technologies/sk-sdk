// The website shows public worlds' transcripts of play, recorded without private data and
// only for worlds marked public. If it breaks, private play leaks or public transcripts
// go missing. Runs against a temp directory and an injected session client.

// keep-file(K2): the recorder needs a seated player's tool call

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PLAYER_WORLD_CATALOG_VERSION } from "@spellkave/gateway-identity";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSessionToolHandler, type PlayerSessionClient } from "../daemon-handler.ts";
import { withRemoteMcpRequestContext, withRemoteMcpRequestSubject } from "../observability.ts";
import {
	createPublicTranscriptRecorder,
	hashTranscriptSubject,
	PUBLIC_TRANSCRIPT_FILENAME,
	PUBLIC_TRANSCRIPT_MAX_TEXT_CHARS,
	publicWorldSlugs,
} from "../transcript.ts";

const PUBLIC_SLUGS = new Set(["elven-mini-1"]);
const SUBJECT = "player:workos-sub-demo";

function worlds(map: Record<string, { slug: string; actorId: string }>) {
	return (subject: string) => map[subject];
}

describe("public transcript recorder", () => {
	let root = "";
	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "spellkave-public-transcript-"));
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("appends one canonical tool_call line per public-world call and skips private worlds", async () => {
		const recorder = createPublicTranscriptRecorder({
			directory: root,
			publicSlugs: PUBLIC_SLUGS,
			worldForSubject: worlds({
				[SUBJECT]: { slug: "elven-mini-1", actorId: "elven_mini/adventure/hero_1" },
				"player:private": { slug: "invite-only", actorId: "elven_mini/adventure/hero_2" },
			}),
			now: () => new Date("2026-08-18T20:00:00.000Z"),
		});
		const call = {
			toolName: "spellkave_scene",
			params: { cursor: null },
			result: {
				content: [{ type: "text" as const, text: "You stand in the inn." }],
				structuredContent: { items: [], rev: "r1" },
			},
			durationMs: 12,
			correlationId: "corr-1",
		};
		withRemoteMcpRequestSubject(SUBJECT, () => recorder.record(call));
		withRemoteMcpRequestSubject("player:private", () => recorder.record(call));
		recorder.record(call);

		const file = join(root, "elven-mini-1", PUBLIC_TRANSCRIPT_FILENAME);
		const lines = (await readFile(file, "utf8")).trimEnd().split("\n");
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0]!)).toEqual({
			v: "agent-run-events/v1",
			run_id: "public-elven-mini-1",
			run_kind: "public_transcript",
			actor_id: "elven_mini/adventure/hero_1",
			role: "PLAYER",
			controller_kind: "llm_player",
			driver: "remote-mcp",
			seed: "",
			ts: "2026-08-18T20:00:00.000Z",
			type: "tool_call",
			data: {
				tool_name: "spellkave_scene",
				correlation_id: "corr-1",
				params: { cursor: null },
				text: "You stand in the inn.",
				observation: { items: [], rev: "r1" },
				is_error: false,
				duration_ms: 12,
				player: hashTranscriptSubject(SUBJECT),
			},
		});
		expect(lines[0]).not.toContain(SUBJECT);
		expect((await stat(file)).mode & 0o777).toBe(0o644);
		expect((await stat(join(root, "elven-mini-1"))).mode & 0o777).toBe(0o755);
		await expect(stat(join(root, "invite-only"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	// keep(K1): pure slug filter
	it("publicWorldSlugs keeps only visibility=public", () => {
		const slugs = publicWorldSlugs({
			v: PLAYER_WORLD_CATALOG_VERSION,
			worlds: [
				{
					slug: "elven-mini-1",
					display_name: "Elven Mini",
					adventure: "elven-mini",
					db: "spellkave-elven-mini-1",
					status: "running",
					visibility: "public",
					owner: "user_operator",
					members: [],
					join_policy: "invite",
				},
				{
					slug: "invite-only",
					display_name: "Invite",
					adventure: "elven-mini",
					db: "spellkave-invite",
					status: "running",
					visibility: "private",
					owner: "user_operator",
					members: [],
					join_policy: "invite",
				},
			],
		});
		expect([...slugs]).toEqual(["elven-mini-1"]);
	});

	it("drops a line that would leak the raw subject", () => {
		const lines: string[] = [];
		const recorder = createPublicTranscriptRecorder({
			directory: root,
			publicSlugs: PUBLIC_SLUGS,
			worldForSubject: () => ({ slug: "elven-mini-1", actorId: SUBJECT }),
			append: (_file, line) => lines.push(line),
		});
		withRemoteMcpRequestSubject(SUBJECT, () =>
			recorder.record({
				toolName: "spellkave_scene",
				params: {},
				result: { content: [{ type: "text", text: "ok" }] },
				durationMs: 1,
				correlationId: "c",
			}),
		);
		expect(lines).toEqual([]);
	});

	it("bounds the recorded text and never throws into the tool call", async () => {
		const recorder = createPublicTranscriptRecorder({
			directory: root,
			publicSlugs: PUBLIC_SLUGS,
			worldForSubject: () => ({ slug: "elven-mini-1", actorId: "a" }),
			append: () => {
				throw new Error("disk full");
			},
		});
		expect(() =>
			withRemoteMcpRequestSubject(SUBJECT, () =>
				recorder.record({
					toolName: "spellkave_scene",
					params: {},
					result: { content: [{ type: "text", text: "x" }] },
					durationMs: 1,
					correlationId: "c",
				}),
			),
		).not.toThrow();

		const lines: string[] = [];
		const bounded = createPublicTranscriptRecorder({
			directory: root,
			publicSlugs: PUBLIC_SLUGS,
			worldForSubject: () => ({ slug: "elven-mini-1", actorId: "a" }),
			append: (_file, line) => lines.push(line),
		});
		withRemoteMcpRequestSubject(SUBJECT, () =>
			bounded.record({
				toolName: "spellkave_scene",
				params: {},
				result: {
					isError: true,
					content: [
						{ type: "image", data: "AAAA", mimeType: "image/jpeg" },
						{ type: "text", text: "a".repeat(PUBLIC_TRANSCRIPT_MAX_TEXT_CHARS + 50) },
					],
				},
				durationMs: 3,
				correlationId: "c",
			}),
		);
		const data = JSON.parse(lines[0]!).data as Record<string, unknown>;
		expect(String(data.text)).toMatch(/^\[image\]\na+\n…\[truncated \d+ chars\]$/);
		expect(String(data.text)).not.toContain("AAAA");
		expect(data.observation).toBeNull();
		expect(data.is_error).toBe(true);
	});

	// keep(K1): pure slug validator
	it("rejects unsafe public slugs", () => {
		expect(() =>
			createPublicTranscriptRecorder({
				directory: root,
				publicSlugs: new Set(["../etc"]),
				worldForSubject: () => undefined,
			}),
		).toThrow("slug");
	});

	it("records through the session tool handler with the request correlation id", async () => {
		const lines: string[] = [];
		const recorder = createPublicTranscriptRecorder({
			directory: root,
			publicSlugs: PUBLIC_SLUGS,
			worldForSubject: () => ({ slug: "elven-mini-1", actorId: "hero" }),
			append: (_file, line) => lines.push(line),
		});
		const client: PlayerSessionClient = {
			async invoke(tool, args) {
				return {
					ok: true,
					result: {
						content: [{ type: "text", text: `${tool}:${JSON.stringify(args)}` }],
						details: { ok: 1 },
					},
				} as never;
			},
		};
		const handler = createSessionToolHandler(client, undefined, recorder, () => 5);
		await withRemoteMcpRequestContext("corr-handler", async () =>
			withRemoteMcpRequestSubject(SUBJECT, () => handler("spellkave_move", { to: "inn/door" })),
		);
		expect(lines).toHaveLength(1);
		expect(JSON.parse(lines[0]!).data).toMatchObject({
			tool_name: "spellkave_move",
			correlation_id: "corr-handler",
			params: { to: "inn/door" },
			text: 'spellkave_move:{"to":"inn/door"}',
			observation: { ok: 1 },
			is_error: false,
			duration_ms: 0,
			player: hashTranscriptSubject(SUBJECT),
		});
		expect(lines[0]).not.toContain(SUBJECT);
	});
});
