import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readSelfEconomyBudget } from "../core/readers/self_economy_budget";

interface BudgetRowOverrides {
	actorId?: bigint;
	channelId?: string;
	resetsOn?: string;
	currentWindowStartMs?: bigint;
	spentMs?: bigint;
	grantMs?: bigint;
	effectivePoolMs?: bigint;
	remainingMs?: bigint;
	remainingDisclosed?: boolean;
	status?: string;
}

function budgetRow(overrides: BudgetRowOverrides = {}) {
	return {
		actorId: 1n,
		channelId: "proof/economy/primary",
		poolMsPerRound: 6_000n,
		resetsOn: "turn_start",
		offTurnEligible: false,
		currentWindowStartMs: 12_000n,
		spentMs: 1_000n,
		grantMs: 0n,
		effectivePoolMs: 6_000n,
		remainingMs: 5_000n,
		remainingDisclosed: true,
		status: "ok",
		...overrides,
	};
}

function fixture(rows = [budgetRow()], controlled = [1n], withWorldTime = true) {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		world_time: withWorldTime ? [{ tick: 12n }] : [],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "proof:owner", entityId: 1n },
			{ manifestKey: "proof:peer", entityId: 2n },
		],
		directly_controlled_actor_spatial_location: controlled.map((entityId) => ({
			entityId,
			placeNodeId: "proof/cell",
		})),
		visible_economy_channel_budget: rows,
	});
}

describe("readSelfEconomyBudget", () => {
	it("returns authoritative disclosed capacity in catalog order", () => {
		const db = fixture([
			budgetRow({ channelId: "proof/economy/reaction", remainingMs: 6_000n }),
			budgetRow({ channelId: "proof/economy/primary" }),
		]);

		expect(readSelfEconomyBudget(db, asEntityRef("1"))).toEqual({
			status: "ok",
			channels: [
				expect.objectContaining({
					channel_id: "proof/economy/primary",
					effective_pool_ms: "6000",
					remaining_ms: "5000",
				}),
				expect.objectContaining({
					channel_id: "proof/economy/reaction",
					remaining_ms: "6000",
				}),
			],
		});
	});

	it("keeps pending capacity unknown when remaining is not disclosed", () => {
		const result = readSelfEconomyBudget(
			fixture([
				budgetRow({
					status: "pending_boundary",
					remainingDisclosed: false,
					effectivePoolMs: 0n,
					remainingMs: 0n,
				}),
			]),
			asEntityRef("1"),
		);

		expect(result.status).toBe("pending_boundary");
		expect(result.channels[0]).toMatchObject({
			status: "pending_boundary",
			spent_ms: "1000",
			grant_ms: "0",
		});
		expect(result.channels[0]).not.toHaveProperty("effective_pool_ms");
		expect(result.channels[0]).not.toHaveProperty("remaining_ms");
	});

	it("does not disclose numeric capacity when a row marks it unknown", () => {
		const result = readSelfEconomyBudget(
			fixture([budgetRow({ remainingDisclosed: false, status: "unknown_channel" })]),
			asEntityRef("1"),
		);

		expect(result).toEqual({
			status: "ok",
			channels: [
				expect.not.objectContaining({
					effective_pool_ms: expect.anything(),
					remaining_ms: expect.anything(),
				}),
			],
		});
		expect(result.channels[0]?.status).toBe("unknown_channel");
	});

	it("preserves never-reset stored spend and grant values from the server projection", () => {
		const result = readSelfEconomyBudget(
			fixture([
				budgetRow({
					resetsOn: "never",
					currentWindowStartMs: 0n,
					spentMs: 2_000n,
					grantMs: 1_500n,
					effectivePoolMs: 7_500n,
					remainingMs: 5_500n,
				}),
			]),
			asEntityRef("1"),
		);

		expect(result.channels[0]).toMatchObject({
			resets_on: "never",
			current_window_start_ms: "0",
			spent_ms: "2000",
			grant_ms: "1500",
			effective_pool_ms: "7500",
			remaining_ms: "5500",
		});
	});

	it("returns unavailable without world time instead of treating an empty view as capacity", () => {
		expect(readSelfEconomyBudget(fixture([], [1n], false), asEntityRef("1"))).toEqual({
			status: "unavailable",
			reason: "world_time",
			channels: [],
		});
	});

	it("does not reveal visible rows for a body the caller does not directly control", () => {
		const db = fixture([budgetRow({ actorId: 2n, remainingMs: 4_000n })], [1n]);

		expect(readSelfEconomyBudget(db, asEntityRef("2"))).toEqual({ status: "ok", channels: [] });
	});
});
