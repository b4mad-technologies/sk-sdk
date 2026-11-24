import { describe, expect, it } from "vitest";

import type { SnapshotDb } from "../connection";
import {
	readSpatialNodeStateBool,
	resolveEffectiveSpatialEnvironmentStates,
} from "../core/readers/spatial_environment_state";

interface FakeRow {
	[k: string]: unknown;
}

function table(rows: FakeRow[]): { iter: () => Iterable<FakeRow> } {
	return { iter: () => rows };
}

function makeDb(rows: FakeRow[]): SnapshotDb {
	return {
		visible_spatial_environment_state: table(rows),
	};
}

describe("spatial_environment_state reader", () => {
	it("reads a tagged Bool DslValue row by place node and state id", () => {
		const db = makeDb([
			{
				placeNodeId: "cragmaw_hideout/guard_post",
				stateId: "phandelver/cragmaw/hideout_alarm",
				value: { tag: "Bool", value: true },
			},
		]);

		expect(
			readSpatialNodeStateBool(db, {
				placeNodeId: "cragmaw_hideout/guard_post",
				stateId: "phandelver/cragmaw/hideout_alarm",
			}),
		).toBe(true);
	});

	it("returns null when no row exists for the (node, state) pair", () => {
		const db = makeDb([
			{
				placeNodeId: "cragmaw_hideout/guard_post",
				stateId: "phandelver/cragmaw/hideout_alarm",
				value: { tag: "Bool", value: true },
			},
		]);

		expect(
			readSpatialNodeStateBool(db, {
				placeNodeId: "region/phandalin_village",
				stateId: "phandelver/cragmaw/hideout_alarm",
			}),
		).toBeNull();
	});

	it("returns null for a non-Bool DslValue carrier", () => {
		const db = makeDb([
			{
				placeNodeId: "cragmaw_hideout/guard_post",
				stateId: "srd/some-int-state",
				value: { tag: "Int", value: 3n },
			},
		]);

		expect(
			readSpatialNodeStateBool(db, {
				placeNodeId: "cragmaw_hideout/guard_post",
				stateId: "srd/some-int-state",
			}),
		).toBeNull();
	});
});

describe("effective environment state precedence", () => {
	const row = (bundleId: string, updatedTick: bigint, stateRowId: bigint) => ({
		bundleId,
		updatedTick,
		stateRowId,
		stateId: "test/open",
		placeNodeId: "test/root",
		value: { tag: "Bool", value: bundleId === "" },
	});
	it("old world override wins over a newer baseline in either order", () => {
		const override = row("", 0n, 1n),
			baseline = row("test", 1000n, 2n);
		for (const rows of [
			[override, baseline],
			[baseline, override],
		]) {
			expect(resolveEffectiveSpatialEnvironmentStates(rows)).toEqual([override]);
			expect(
				readSpatialNodeStateBool(makeDb(rows), { placeNodeId: "test/root", stateId: "test/open" }),
			).toBe(true);
		}
	});
	it("ties use the larger row id regardless of iteration order", () => {
		const a = row("a", 10n, 4n),
			b = row("b", 10n, 5n),
			c = row("c", 9n, 6n);
		expect(resolveEffectiveSpatialEnvironmentStates([a, b, c])).toEqual([b]);
		expect(resolveEffectiveSpatialEnvironmentStates([c, b, a])).toEqual([b]);
	});
	it("absent state has no effective row", () => {
		expect(resolveEffectiveSpatialEnvironmentStates([])).toEqual([]);
	});
	it("each target is resolved separately", () => {
		const a = row("", 0n, 1n),
			b = { ...row("test", 1000n, 2n), placeNodeId: "test/other" };
		expect(resolveEffectiveSpatialEnvironmentStates([a, b])).toHaveLength(2);
	});
});

describe("logical environment targets", () => {
	it("projection changes do not split one edge's baseline and override", () => {
		const baseline = {
			stateId: "test/open",
			targetKind: "place_edge",
			placeEdgeId: 7n,
			cellRes4: 100n,
			bundleId: "test",
			updatedTick: 100n,
			stateRowId: 2n,
		};
		const override = { ...baseline, cellRes4: 200n, bundleId: "", updatedTick: 0n, stateRowId: 1n };
		expect(resolveEffectiveSpatialEnvironmentStates([baseline, override])).toEqual([override]);
	});
	it("distinct coarse H3 references remain distinct when ancestor columns are zero", () => {
		const a = {
			stateId: "test/value",
			targetKind: "h3_cell",
			targetRef: { tag: "H3Cell", value: { cell: 1n } },
			bundleId: "",
			stateRowId: 1n,
		};
		const b = { ...a, targetRef: { tag: "H3Cell", value: { cell: 2n } }, stateRowId: 2n };
		expect(resolveEffectiveSpatialEnvironmentStates([a, b])).toHaveLength(2);
	});
});
