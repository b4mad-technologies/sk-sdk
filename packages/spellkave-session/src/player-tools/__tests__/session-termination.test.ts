import type { SnapshotDb } from "@spellkave/sdk";
import { describe, expect, it, vi } from "vitest";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";

import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

// U2 (BL-2, tool-ux-decision-log.md): `withSessionTermination` composes a
// non-silent session-end line from channels a co-located actor already sees
// — a roster captured while `spellkave_session_status` still reports the
// session active, plus each former roster-mate's own `visible_target_
// condition` (the SAME channel U1's `target_conditions` field reads) once
// the session's own row disappears. Mutable `parts` + a `SnapshotDb` that
// reads it lazily on every `.iter()` call lets one test drive the SAME
// wrapped tool instance (and its one persistent closure state) across a
// active -> closed transition, mirroring the real world's own subscription
// update between two tool calls.
type TableRows = Record<string, Array<Record<string, unknown>>>;

function makeMutableDb(initial: TableRows): { db: SnapshotDb; set: (next: TableRows) => void } {
	let parts = initial;
	const db = new Proxy({} as SnapshotDb, {
		get(_target, prop: string) {
			const rows =
				prop === "visible_entity_tag_coverage"
					? [{ status: "complete", projectionVersion: 1 }]
					: parts[prop];
			return rows ? { iter: () => rows.values() } : { iter: () => [].values() };
		},
	});
	return { db, set: (next) => (parts = next) };
}

function toolByName(context: SpellkaveToolContext, name: string): AgentTool {
	const tool = createSpellkaveTools(context).find((t) => t.name === name);
	if (!tool) throw new Error(`tool not found: ${name}`);
	return tool as AgentTool;
}

const ACTIVE_SESSION: TableRows = {
	session: [
		{
			sessionId: 7n,
			sessionDefId: "test/combat",
			lifecycle: "active",
			currentActor: "1",
			stateJson: "{}",
		},
	],
	session_participant: [
		{ sessionId: 7n, actorId: "1", ordinal: 0, joinedAt: 0n },
		{ sessionId: 7n, actorId: "9", ordinal: 1, joinedAt: 0n },
	],
};

function closedSessionWithOpponentCondition(conditionDefinitionId: string | undefined): TableRows {
	return conditionDefinitionId === undefined
		? { session: [], session_participant: [] }
		: {
				session: [],
				session_participant: [],
				visible_actor_spatial_location: [{ entityId: 9n, placeNodeId: "arena" }],
				entity: [{ entityId: 9n, entityDefId: "srd/monster", name: "Slime Scout" }],
				visible_target_condition: [
					{
						rowId: 1n,
						targetKind: "entity",
						targetId: 9n,
						conditionDefinitionId,
						sourceId: "test",
						appliedAtTick: 2n,
						stackCount: 1,
						bundleId: "srd",
					},
				],
			};
}

describe("session termination (U2)", () => {
	it("reports victory on the first session_status call that observes the closed session", async () => {
		const { db, set } = makeMutableDb(ACTIVE_SESSION);
		const context = { db, act: { actorId: "1" } };
		const sessionStatus = toolByName(context, "spellkave_session_status");

		const active = await sessionStatus.execute("poll-active", {});
		expect(active.details).not.toHaveProperty("session_ended");

		set(closedSessionWithOpponentCondition("srd/condition/dead"));
		const closed = await sessionStatus.execute("poll-closed", {});
		expect(closed.details).toMatchObject({
			status: "no_session",
			session_ended: {
				session_id: "7",
				outcome: "victory",
				defeated: [{ actor_id: "9", name: "Slime Scout" }],
			},
		});

		// Reported exactly once — a later poll of the same already-closed
		// session carries no repeat note (U2's own "last receipt" framing).
		const stillClosed = await sessionStatus.execute("poll-still-closed", {});
		expect(stillClosed.details).not.toHaveProperty("session_ended");
	});

	it("reports defeat when the connected actor's own body carries the lethal condition", async () => {
		const { db, set } = makeMutableDb(ACTIVE_SESSION);
		const context = { db, act: { actorId: "1" } };
		const sessionStatus = toolByName(context, "spellkave_session_status");
		await sessionStatus.execute("poll-active", {});

		set({
			session: [],
			session_participant: [],
			visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "arena" }],
			entity: [{ entityId: 1n, entityDefId: "srd/hero", name: "Hero" }],
			visible_target_condition: [
				{
					rowId: 1n,
					targetKind: "entity",
					targetId: 1n,
					conditionDefinitionId: "srd/condition/dead",
					sourceId: "test",
					appliedAtTick: 2n,
					stackCount: 1,
					bundleId: "srd",
				},
			],
		});
		const closed = await sessionStatus.execute("poll-closed", {});
		expect(closed.details).toMatchObject({
			session_ended: { outcome: "defeat", defeated: [] },
		});
	});

	it("stays honest about an unknown termination reason — no fabricated verdict", async () => {
		const { db, set } = makeMutableDb(ACTIVE_SESSION);
		const context = { db, act: { actorId: "1" } };
		const sessionStatus = toolByName(context, "spellkave_session_status");
		await sessionStatus.execute("poll-active", {});

		set(closedSessionWithOpponentCondition(undefined));
		const closed = await sessionStatus.execute("poll-closed", {});
		expect(closed.details).toMatchObject({
			session_ended: { outcome: "unknown", defeated: [] },
		});
	});

	it("surfaces the same closing line on the end_turn receipt that first observes the closure", async () => {
		const { db, set } = makeMutableDb(ACTIVE_SESSION);
		const endTurn = vi.fn(async () => ({ status: "success" as const, sessionId: 7n }));
		const context = { db, act: { actorId: "1", actorClient: { endTurn } } };
		// One shared registry build: `createSpellkaveTools` constructs its
		// per-context `SessionTerminationState` ONCE per call (same D-5 discipline
		// `DeltaTracker` already documents) — two separate `toolByName` calls would
		// each build a FRESH, independent closure, so the roster session_status
		// captures below would never reach end_turn's own check.
		const tools = createSpellkaveTools(context);
		const find = (name: string): AgentTool => {
			const tool = tools.find((t) => t.name === name);
			if (!tool) throw new Error(`tool not found: ${name}`);
			return tool as AgentTool;
		};
		const sessionStatus = find("spellkave_session_status");
		const endTurnTool = find("spellkave_end_turn");

		// Prime the roster while the session is still active (session_status is
		// the only tool with a full roster — see the module-level comment).
		await sessionStatus.execute("poll-active", {});

		set(closedSessionWithOpponentCondition("srd/condition/dead"));
		const advanced = await endTurnTool.execute("end", {});
		expect(advanced.details).toMatchObject({
			receipt: { status: "dispatched" },
			session_ended: { outcome: "victory", defeated: [{ actor_id: "9", name: "Slime Scout" }] },
		});
	});
});
