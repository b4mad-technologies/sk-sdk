// The rules under the OSM export that the `world-map export` scenarios cannot
// reach from outside: the id hash's edge cases and its collision refusal, how
// a substrate is classed indoor or outdoor, the storey height, the projection
// helpers the SVG renderer and map-canvas share, and the GeoJSON writer that
// only the tile gateway calls. What an export writes is proved by the
// behaviour scenarios in behaviour/export-*.feature. Reads the committed
// kavemouth bundle; no node. Spec: ADR-0123 (D-1 to D-5).
import { describe, expect, it } from "vitest";

import {
	cellRes10ToHex,
	latLngToPlane,
	METRES_PER_DEG_LAT,
	worldOffsetToPlane,
} from "../coords.ts";
import { exportWorld, LEVEL_HEIGHT_M, nodeLevelIndex } from "../export.ts";
import { fnv1a63, IdRegistry, OsmIdCollision } from "../ids.ts";
import {
	buildCoordinateKindMap,
	CORE_SUBSTRATE_KINDS,
	levelIndex,
	spatialClassOf,
} from "../tags.ts";
import { renderGeoJson } from "../writers/geojson.ts";

const FIXED_TS = "2026-08-22T00:00:00Z";

describe("FNV-1a-64 → 63-bit ids (D-3)", () => {
	// keep(K1): the 0 -> 1 remap is an edge of the pure hash no real key reaches
	it("remaps 0 to 1 (mask edge)", () => {
		for (const k of ["", "a", "node_id", "extent:x:0"]) {
			expect(fnv1a63(k)).not.toBe(0n);
		}
	});

	// keep(K2): a collision needs an injected hasher; FNV-1a never collides on a real world
	it("throws OsmIdCollision on hash collision within a type", () => {
		const reg = new IdRegistry(() => "42");
		expect(reg.id("alpha")).toBe("42");
		expect(() => reg.id("beta")).toThrow(OsmIdCollision);
		try {
			reg.id("beta");
		} catch (e) {
			expect(e).toBeInstanceOf(OsmIdCollision);
			const c = e as OsmIdCollision;
			expect(c.id).toBe("42");
			expect(c.keys).toEqual(["alpha", "beta"]);
		}
	});

	// keep(K1): asking twice for one key inside one registry is not visible in an export
	it("returns same id for same key", () => {
		const reg = new IdRegistry();
		const id = reg.id("alpha");
		expect(reg.id("alpha")).toBe(id);
		expect(reg.id("beta")).not.toBe(id);
	});
});

describe("coordinate_kind_id class resolution", () => {
	// keep(K1): rule space of the pure substrate classifier (a modder's `cave` on graph_local is indoor)
	it("classifies via coordinate_kind_id, never substrate_id string alone", () => {
		const { kindBySubstrate } = buildCoordinateKindMap([
			{ substrate_id: "cave", coordinate_kind_id: "graph_local" },
			{ substrate_id: "outdoor", coordinate_kind_id: "h3_cell" },
		]);
		expect(spatialClassOf("cave", kindBySubstrate)).toBe("indoor");
		expect(spatialClassOf("outdoor", kindBySubstrate)).toBe("outdoor");
		expect(spatialClassOf("tactical", kindBySubstrate)).toBe("tactical");
	});

	// keep(K1): the bootstrap kinds themselves; the scenario only sees the diagnostic
	it("falls back to kernel bootstrap seed when substrate_definitions absent", () => {
		const { kindBySubstrate, usedBootstrapFallback } = buildCoordinateKindMap([]);
		expect(usedBootstrapFallback).toBe(true);
		expect(kindBySubstrate.get("indoor")).toBe(CORE_SUBSTRATE_KINDS.indoor);
		expect(kindBySubstrate.get("outdoor")).toBe(CORE_SUBSTRATE_KINDS.outdoor);
		expect(kindBySubstrate.get("tactical")).toBe(CORE_SUBSTRATE_KINDS.tactical);
	});
});

describe("storey height (D-2)", () => {
	// keep(K1): kavemouth's -3/0/3 m round to the same levels at other storey heights; this pins 3 m
	it("a level is round(elevation / 3 m)", () => {
		expect(LEVEL_HEIGHT_M).toBe(3.0);
		expect(levelIndex(true, -3, "indoor")).toBe(-1);
		expect(
			nodeLevelIndex(
				{
					pose_elevation_present: true,
					pose_elevation: 3,
				} as never,
				"indoor",
			),
		).toBe(1);
	});
});

describe("GeoJSON writer", () => {
	// keep(K5): string feature ids are the contract with geojson-vt and MapLibre; the CLI writes no GeoJSON
	it("GeoJSON ids are strings", async () => {
		const result = exportWorld({
			place_graphs: [{ place_graph_id: "demo", display_name: "Demo", substrate_id: "outdoor", origin_cell_res10: "622215095455449087" }],
			place_nodes: [{ node_id: "demo/start", place_graph_id: "demo", cell_res10: "622215095455449087", display_name: "Start" }],
		}, { timestamp: FIXED_TS, tick: 0 });
		const gj = renderGeoJson(result.doc);
		expect(gj.type).toBe("FeatureCollection");
		expect(gj.features.length).toBeGreaterThan(0);
		for (const f of gj.features) {
			expect(typeof f.id).toBe("string");
			// Must not be a finite number-like coercion target only — string id.
			expect(Number.isNaN(Number(f.id)) || f.id.length > 15).toBe(true);
		}
	});
});

describe("projection constants and plane helpers", () => {
	// keep(K5): spellkave-map-canvas/src/place.ts hard-codes the same 111 320 m per degree
	it("exposes METRES_PER_DEG_LAT = 111320", () => {
		expect(METRES_PER_DEG_LAT).toBe(111_320);
	});

	// keep(K1): pure projection helper the SVG renderer uses; the CLI never prints plane coordinates
	it("latLngToPlane projects lat/lng to SVG y-down plane", () => {
		const originLat = 0;
		const originLng = 0;
		const p = latLngToPlane(1, 1, originLat, originLng);
		expect(p.x).toBeCloseTo(METRES_PER_DEG_LAT, 1);
		expect(p.y).toBeCloseTo(-METRES_PER_DEG_LAT, 1);
	});

	// keep(K1): pure projection helper the SVG renderer uses; the CLI never prints plane coordinates
	it("worldOffsetToPlane converts world offset to SVG y-down plane", () => {
		const plane = worldOffsetToPlane({ east_m: 10, north_m: 20 }, 0, 0);
		expect(plane).toEqual({ x: 10, y: -20 });
		const shifted = worldOffsetToPlane({ east_m: 10, north_m: 20 }, 5, 5);
		expect(shifted).toEqual({ x: 5, y: -15 });
	});
});

describe("refuse unsafe JS numbers for H3 cells", () => {
	// keep(K1): a lossy JS number needs a library caller; the scenarios pass cell ids as strings
	it("cellRes10ToHex rejects non-safe integers", () => {
		// Build a number > MAX_SAFE_INTEGER without a precision-loss literal.
		const asNumber = Number("622215095455449087");
		expect(Number.isSafeInteger(asNumber)).toBe(false);
		expect(cellRes10ToHex(asNumber)).toBeNull();
		// String form is accepted.
		expect(cellRes10ToHex("622215095455449087")).toBeTruthy();
	});
});
