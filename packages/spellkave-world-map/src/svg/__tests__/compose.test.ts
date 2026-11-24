// A session grid or an inner place drawn over its parent must land where the
// server says it is: anchor-centred, at the right scale and bearing, with the
// metres-per-cell taken from the parent's own backdrop grid. Pure math.
// keep-file(K1): rule cases of the pure composition helpers; the CLI renders no SVG
import { describe, expect, it } from "vitest";
import {
	composeChildLocalToParentFrame,
	isEphemeralInstanceGraph,
	localBoundsCenter,
	metresPerParentLocalUnit,
	resolveGraphAncestorChain,
} from "../compose.ts";

describe("localBoundsCenter", () => {
	it("returns the midpoint of a node set's own bounds", () => {
		expect(
			localBoundsCenter([
				{ x: 0, y: 0 },
				{ x: 2, y: 0 },
				{ x: 0, y: 4 },
				{ x: 2, y: 4 },
			]),
		).toEqual({ x: 1, y: 2 });
	});

	it("origin for an empty node set", () => {
		expect(localBoundsCenter([])).toEqual({ x: 0, y: 0 });
	});

	it("a single node is its own centre", () => {
		expect(localBoundsCenter([{ x: 7, y: -3 }])).toEqual({ x: 7, y: -3 });
	});
});

describe("composeChildLocalToParentFrame (anchor-centring math)", () => {
	it("bearing=0, matched scales: pure centre-then-translate", () => {
		// 3x3 grid, local coords 0..2 on each axis -> centre (1,1). Anchor at
		// the parent's (10, 10). childMetresPerUnit === parentMetresPerUnit =>
		// 1:1 unit ratio.
		const params = {
			childMetresPerUnit: 5,
			parentMetresPerUnit: 5,
			bearingDeg: 0,
			anchor: { x: 10, y: 10 },
			center: { x: 1, y: 1 },
		};
		// The cell mapped onto the local centre lands exactly on the anchor.
		expect(composeChildLocalToParentFrame(1, 1, params)).toEqual({ x: 10, y: 10 });
		// A corner cell offsets by (local - centre) in parent units (ratio 1).
		expect(composeChildLocalToParentFrame(0, 0, params)).toEqual({ x: 9, y: 9 });
		expect(composeChildLocalToParentFrame(2, 2, params)).toEqual({ x: 11, y: 11 });
	});

	it("scales by childMetresPerUnit/parentMetresPerUnit when the two graphs' real-world-metres-per-unit differ", () => {
		// Child cell = 5 m per combat cell, parent cell = 10 m per parent-local
		// unit -> one child cell spans half a parent unit.
		const params = {
			childMetresPerUnit: 5,
			parentMetresPerUnit: 10,
			bearingDeg: 0,
			anchor: { x: 0, y: 0 },
			center: { x: 0, y: 0 },
		};
		expect(composeChildLocalToParentFrame(2, 0, params)).toEqual({ x: 1, y: 0 });
	});

	it("falls back to a 1:1 ratio when either metres-per-unit value is non-positive (defensive default)", () => {
		const params = {
			childMetresPerUnit: 0,
			parentMetresPerUnit: 5,
			bearingDeg: 0,
			anchor: { x: 0, y: 0 },
			center: { x: 0, y: 0 },
		};
		expect(composeChildLocalToParentFrame(3, 0, params)).toEqual({ x: 3, y: 0 });
	});

	it("bearing rotates clockwise — matches projection.rs's own K-5 fixture numbers", () => {
		const params = {
			childMetresPerUnit: 2,
			parentMetresPerUnit: 1,
			bearingDeg: 90,
			anchor: { x: 0, y: 0 },
			center: { x: 0, y: 0 },
		};
		const a = composeChildLocalToParentFrame(1, 0, params);
		expect(a.x).toBeCloseTo(0, 9);
		expect(a.y).toBeCloseTo(-2, 9);
		const b = composeChildLocalToParentFrame(0, 1, params);
		expect(b.x).toBeCloseTo(2, 9);
		expect(b.y).toBeCloseTo(0, 9);
	});
});

describe("metresPerParentLocalUnit (the single metres -> pixels/parent-cell conversion boundary)", () => {
	it("prefers the parent's own map_layer.grid_distance_m, used as-is (no conversion)", () => {
		// 1.524 m/backdrop-square — the 5 ft SRD square, stored in metres since
		// sk-yze renamed grid_distance_ft -> grid_distance_m and converted the
		// values. place_graph.metres_per_unit is deliberately a DIFFERENT,
		// wrong-looking value here to prove it is ignored whenever a
		// map_layer row exists.
		expect(metresPerParentLocalUnit({ grid_distance_m: 1.524 }, 999)).toBeCloseTo(1.524, 3);
	});

	it("does NOT reapply a feet conversion to an already-metric column", () => {
		// Regression guard for the sk-yze rename: a bare 5 in grid_distance_m
		// means 5 METRES and must come back as 5, not 1.524. If someone
		// reintroduces a x0.3048 at this boundary, this fails loudly.
		expect(metresPerParentLocalUnit({ grid_distance_m: 5 }, 999)).toBe(5);
	});

	it("falls back to the parent's place_graph_definition.metres_per_unit when it authors no backdrop", () => {
		expect(metresPerParentLocalUnit(undefined, 2.5)).toBe(2.5);
	});

	it("falls back to place_graph_definition.metres_per_unit when the map_layer row carries no usable grid_distance_m", () => {
		expect(metresPerParentLocalUnit({}, 3)).toBe(3);
		expect(metresPerParentLocalUnit({ grid_distance_m: 0 }, 3)).toBe(3);
		expect(metresPerParentLocalUnit({ grid_distance_m: "5" }, 3)).toBe(3);
	});

	it("falls back to 1 as a last resort when place_graph_definition.metres_per_unit is itself non-positive", () => {
		expect(metresPerParentLocalUnit(undefined, 0)).toBe(1);
	});

	it("matches the real elven-mini tomb/inn fixture shape: an unmaintained metres_per_unit=1.0 next to a real 5ft grid", () => {
		// packages/spellkave-srd-cc/fixtures/elven-mini/tomb.manifest.toml:
		// place_graph_definition.metres_per_unit = 1.0 (unmaintained default);
		// the SAME graph's own map_layer row (adventure.manifest.toml:1016-1037)
		// declares grid_distance_m = 1.524 (the 5 ft square, stored in metres
		// since sk-yze) — the real per-cell size its pos_x/pos_y (0..54) are
		// authored against. Composing against the raw metres_per_unit=1.0
		// would place a metre-native session grid at roughly 1/1.524 of its
		// correct size. The metres_per_unit=1.0 is itself a live gameplay
		// defect, filed as sk-j1a.
		const tombScale = 1.0;
		const tombMapLayer = {
			place_graph_id: "elven_mini/tomb",
			grid_distance_m: 1.5240000486373901,
		};
		expect(metresPerParentLocalUnit(tombMapLayer, tombScale)).toBeCloseTo(1.524, 3);
		expect(metresPerParentLocalUnit(tombMapLayer, tombScale)).not.toBe(tombScale);
	});
});

describe("resolveGraphAncestorChain", () => {
	const graphRows = [
		{ place_graph_id: "region", parent_graph_id: "" },
		{ place_graph_id: "hamlet", parent_graph_id: "region" },
		{ place_graph_id: "tomb", parent_graph_id: "hamlet" },
	];

	it("walks parent_graph_id child-first up to the root", () => {
		expect(resolveGraphAncestorChain(graphRows, "tomb")).toEqual(["tomb", "hamlet", "region"]);
	});

	it("a root graph (empty parent_graph_id) is a chain of one", () => {
		expect(resolveGraphAncestorChain(graphRows, "region")).toEqual(["region"]);
	});

	it("an unresolvable graph id is a chain of just itself", () => {
		expect(resolveGraphAncestorChain(graphRows, "session_grid_1")).toEqual(["session_grid_1"]);
	});

	it("guards against a parent_graph_id cycle instead of looping forever", () => {
		const cyclic = [
			{ place_graph_id: "a", parent_graph_id: "b" },
			{ place_graph_id: "b", parent_graph_id: "a" },
		];
		expect(resolveGraphAncestorChain(cyclic, "a")).toEqual(["a", "b"]);
	});
});

describe("isEphemeralInstanceGraph", () => {
	it("trusts an explicit boolean column when present (AUTHOR's workspace-manifest rows)", () => {
		expect(isEphemeralInstanceGraph({ is_ephemeral_instance: true }, "anything")).toBe(true);
		// elven-mini's tomb/inn: parent_graph_id set, is_ephemeral_instance
		// explicitly false — must never be treated as a session grid.
		expect(isEphemeralInstanceGraph({ is_ephemeral_instance: false }, "elven_mini/tomb")).toBe(
			false,
		);
	});

	it("falls back to the deterministic session_grid_<id> shape when the column is absent", () => {
		// @spellkave/sdk's readPlaceTopology (the PLAYER spellkave_map row
		// source) does not project is_ephemeral_instance today.
		expect(isEphemeralInstanceGraph({}, "session_grid_42")).toBe(true);
		expect(isEphemeralInstanceGraph({}, "elven_mini/tomb")).toBe(false);
	});
});
