import type { SnapshotDb } from "@spellkave/sdk";
import { SESSION_STATUS_PARAMS } from "@spellkave/tool-contracts/schemas";
import { describe, expect, it } from "vitest";
import { createSessionStatusTool } from "../tools";

function makeDb(parts: Record<string, Array<Record<string, unknown>>>): SnapshotDb {
	const db: SnapshotDb = {};
	for (const [name, rows] of Object.entries(parts)) db[name] = { iter: () => rows.values() };
	return db;
}

describe("spellkave_session_status", () => {
	it("pages authorized ongoing sessions and rejects a cursor after a terminal transition", async () => {
		const sessions = [12n, 1n, 7n].map((sessionId) => ({
			sessionId,
			sessionDefId: "test/work",
			lifecycle: "active",
			originatingAction: "",
		}));
		const tool = createSessionStatusTool({
			db: makeDb({
				visible_session: sessions,
				visible_session_participant: sessions.map(({ sessionId }) => ({
					sessionId,
					actorId: sessionId === 1n ? "11" : "10",
				})),
			}),
			act: { actorId: "10" },
		});
		const first = (await tool.execute("first", { limit: 1 })).details as {
			ongoing: { matched: number; items: { session_id: string }[]; next_cursor: string };
		};
		expect(first.ongoing.matched).toBe(2);
		expect(first.ongoing.items.map((row) => row.session_id)).toEqual(["7"]);
		const cursor = first.ongoing.next_cursor;
		expect((await tool.execute("next", { limit: 1, cursor })).details).toMatchObject({
			ongoing: { items: [{ session_id: "12" }], next_cursor: null },
		});
		const terminalSession = sessions.find((session) => session.sessionId === 7n);
		if (!terminalSession) throw new Error("Missing session fixture 7");
		terminalSession.lifecycle = "completed";
		expect((await tool.execute("changed", { cursor })).details).toMatchObject({
			status: "stale_cursor",
		});
		expect((await tool.execute("terminal", { session_id: "7" })).details).toMatchObject({
			session: { session_id: "7", lifecycle: "completed" },
			ongoing: { matched: 1, items: [{ session_id: "12" }] },
		});
	});
	it("resolves an implicit authored actor alias and returns compact active-session status", async () => {
		const db = makeDb({
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "core:core/hero", bundleId: "core", entityId: 10n },
			],
			session: [
				{
					sessionId: 7n,
					sessionDefId: "core/combat",
					lifecycle: "active",
					currentActor: "20",
					stateJson: "{}",
				},
			],
			session_participant: [
				{ sessionId: 7n, actorId: "10", ordinal: 1, joinedAt: 0n },
				{ sessionId: 7n, actorId: "20", ordinal: 0, joinedAt: 0n },
			],
		});
		const result = await createSessionStatusTool({ db, act: { actorId: "core/hero" } }).execute(
			"session-status",
			{},
		);
		expect(result.details).toEqual({
			status: "active",
			session: {
				in_session: true,
				session_id: "7",
				session_definition_id: "core/combat",
				lifecycle: "active",
				current_actor: "20",
				my_turn: false,
				participant_count: 2,
				roster: [
					{ actor_id: "20", name: null, ordinal: 0 },
					{ actor_id: "10", name: null, ordinal: 1 },
				],
				roster_total: 2,
				roster_shown: 2,
				roster_truncated: false,
			},
		});
	});

	it("caps large rosters with truthful overflow metadata", async () => {
		const participants = Array.from({ length: 14 }, (_, ordinal) => ({
			sessionId: 9n,
			actorId: String(ordinal + 1),
			ordinal,
			joinedAt: 0n,
		}));
		const result = await createSessionStatusTool({
			db: makeDb({
				visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
				visible_manifest_authored_entity: [],
				session: [
					{
						sessionId: 9n,
						sessionDefId: "core/large",
						lifecycle: "active",
						currentActor: "1",
						stateJson: "{}",
					},
				],
				session_participant: participants,
			}),
			act: { actorId: "1" },
		}).execute("large-roster", {});
		expect(result.details).toMatchObject({
			session: { roster_total: 14, roster_shown: 12, roster_truncated: true },
		});
		expect((result.details as { session: { roster: unknown[] } }).session.roster).toHaveLength(12);
	});

	it("bounds a detailed participant roster with explicit overflow metadata", async () => {
		const tool = createSessionStatusTool({
			db: makeDb({
				visible_session: [{ sessionId: 9n, sessionDefId: "test/work", lifecycle: "active" }],
				visible_session_participant: Array.from({ length: 14 }, (_, ordinal) => ({
					sessionId: 9n,
					actorId: String(ordinal + 1),
					ordinal,
				})),
			}),
			act: { actorId: "1" },
		});
		const result = (await tool.execute("detail-roster", { detail: true })).details as {
			session: { roster: unknown[] };
		};
		expect(result).toMatchObject({
			session: { roster_total: 14, roster_shown: 12, roster_truncated: true },
		});
		expect(result.session.roster).toHaveLength(12);
	});

	it("returns an explicit no-session result", async () => {
		const result = await createSessionStatusTool({
			db: makeDb({ session: [], session_participant: [] }),
			act: { actorId: "10" },
		}).execute("session-status", {});
		expect(result.details).toEqual({ status: "no_session", session: null });
		expect(result.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "text",
					text: expect.stringContaining("does not establish whether another operation is pending"),
				}),
			]),
		);
	});

	it("fails closed when the implicit authored alias is unresolved", async () => {
		const result = await createSessionStatusTool({
			db: makeDb({
				visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
				visible_manifest_authored_entity: [],
				session: [
					{
						sessionId: 7n,
						sessionDefId: "core/combat",
						lifecycle: "active",
						currentActor: "10",
						stateJson: "{}",
					},
				],
				session_participant: [{ sessionId: 7n, actorId: "10", ordinal: 0, joinedAt: 0n }],
			}),
			act: { actorId: "core/missing" },
		}).execute("session-status", {});
		// #1932 (audit row 53): identity-binding failure must not collapse into the
		// same shape as a legitimate empty session (that regression is proven
		// below in "returns an explicit no-session result", which resolves the
		// actor fine and stays "no_session").
		expect(result.details).toEqual({
			status: "actor_unresolved",
			session: null,
			reason:
				"The connected actor id did not resolve; this is a host identity-binding problem, not an absence of session.",
		});
	});

	it("keeps a resolved actor with zero active sessions as the legitimate no_session shape", async () => {
		// Positive control distinguishing "resolved actor, zero rows" (legitimate
		// empty) from "actor never resolved" (actor_unresolved, above) — both
		// numeric ids, both empty session tables, so resolution success/failure is
		// the only variable.
		const result = await createSessionStatusTool({
			db: makeDb({ visible_manifest_authored_entity: [], session: [], session_participant: [] }),
			act: { actorId: "10" },
		}).execute("session-status", {});
		expect(result.details).toEqual({ status: "no_session", session: null });
		expect(result.content).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "text",
					text: expect.stringContaining("does not establish whether another operation is pending"),
				}),
			]),
		);
	});

	it("accepts detail selection without allowing an arbitrary actor", () => {
		expect(Object.keys(SESSION_STATUS_PARAMS.properties)).toEqual([
			"limit",
			"cursor",
			"detail",
			"session_id",
		]);
	});

	it("follows a participating external-wait session only through the detail route", async () => {
		const tool = createSessionStatusTool({
			db: makeDb({
				visible_session: [
					{
						sessionId: 7n,
						sessionDefId: "test/work",
						lifecycle: "waiting-on-external",
						currentActor: "",
						openedAt: 4n,
						lastAdvancedAt: 4n,
						promotedDurationTicks: 5n,
						originatingAction: "",
					},
				],
				visible_session_participant: [{ sessionId: 7n, actorId: "10", ordinal: 0, joinedAt: 4n }],
				world_time: [{ tick: 6n }],
			}),
			act: { actorId: "10" },
		});
		expect((await tool.execute("compact", {})).details).toEqual({
			status: "no_session",
			session: null,
		});
		expect((await tool.execute("detail", { detail: true })).details).toMatchObject({
			status: "session_detail",
			session: { lifecycle: "waiting-on-external", timing: { estimated_remaining_ticks: "3" } },
		});
		expect((await tool.execute("missing", { session_id: "8" })).details).toMatchObject({
			status: "no_session_detail",
			session: null,
		});
	});
});
