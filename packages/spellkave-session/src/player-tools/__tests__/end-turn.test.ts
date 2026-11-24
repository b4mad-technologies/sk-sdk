import type { SnapshotDb } from "@spellkave/sdk";
import { describe, expect, it, vi } from "vitest";

import { createEndTurnTool, createSpellkaveTools } from "../tools";

const db: SnapshotDb = {};

function makeDb(parts: Record<string, Array<Record<string, unknown>>>): SnapshotDb {
	const out: SnapshotDb = {
		visible_entity_tag: { iter: () => [] },
		visible_entity_tag_coverage: { iter: () => [{ status: "complete", projectionVersion: 1 }] },
	};
	for (const [name, rows] of Object.entries(parts)) out[name] = { iter: () => rows.values() };
	return out;
}

describe("spellkave_end_turn", () => {
	it("is constructible in the general registry with no model arguments", async () => {
		const endTurn = vi.fn(async () => ({ status: "success" as const, sessionId: 7n }));
		const context = { db, act: { actorId: "1", actorClient: { endTurn } } };
		const tool = createEndTurnTool(context);

		expect(tool.name).toBe("spellkave_end_turn");
		expect(tool.parameters).toMatchObject({ type: "object", properties: {} });
		expect(createSpellkaveTools(context).map((candidate) => candidate.name)).toContain(
			"spellkave_end_turn",
		);
		await expect(tool.execute("end", {})).resolves.toMatchObject({
			// #1932 (audit row 60): end_turn used to have no top-level status field
			// at all, not even "dispatched" — a caller had to inspect advance.status
			// with zero signal that anything could fail.
			// #1921: the reducer receipt now nests under `receipt`, sibling to the
			// `observation` register — a fixed, always-true bookkeeping line since
			// ending one's own turn needs no authored/perceived content.
			details: {
				receipt: {
					status: "dispatched",
					outcome: "accepted",
					advance: { status: "success", sessionId: "7" },
				},
				observation: "Your turn ends.",
			},
		});
		expect(endTurn).toHaveBeenCalledOnce();
	});

	// Commit 1 follow-up (U3, T5/B1-adjacent, operator review 2026-08-04): a
	// successful advance now piggybacks the NEW session state — read fresh
	// (post-advance) from the same snapshot, same shape as the affordance
	// tools' own `session` block.
	it("piggybacks the new session state on a successful advance", async () => {
		const endTurn = vi.fn(async () => ({ status: "success" as const, sessionId: 7n }));
		const piggybackDb = makeDb({
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
		const tool = createEndTurnTool({
			db: piggybackDb,
			act: { actorId: "core/hero", actorClient: { endTurn } },
		});
		await expect(tool.execute("end", {})).resolves.toMatchObject({
			details: {
				receipt: { status: "dispatched" },
				session: { in_session: true, current_actor: "20", my_turn: false },
			},
		});
	});

	it("carries no session field when the advance was rejected — nothing fresh to report", async () => {
		const endTurn = vi.fn(async () => ({
			status: "rejected" as const,
			sessionId: 7n,
			reason: "not your turn",
		}));
		const tool = createEndTurnTool({ db, act: { actorId: "1", actorClient: { endTurn } } });
		const result = await tool.execute("end", {});
		expect((result.details as { session?: unknown }).session).toBeUndefined();
	});

	it("surfaces SDK precheck rejections without invoking another path", async () => {
		const endTurn = vi.fn(async () => ({
			status: "rejected" as const,
			sessionId: 7n,
			reason: "not your turn",
		}));
		const tool = createEndTurnTool({ db, act: { actorId: "1", actorClient: { endTurn } } });

		await expect(tool.execute("end", {})).resolves.toMatchObject({
			details: {
				receipt: {
					status: "rejected",
					outcome: "rejected",
					advance: { status: "rejected", reason: "not your turn" },
					reason: expect.stringContaining("spellkave_session_status"),
				},
				// #1921: a rejected outcome perceives no world-state change — an
				// honest, non-fabricated fallback, not a missing field.
				observation: "Nothing happens.",
			},
		});
	});
});
