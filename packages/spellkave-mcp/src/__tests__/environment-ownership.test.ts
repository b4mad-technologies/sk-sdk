// A world map shows each environment feature exactly once: a world-specific override
// replaces the baseline row it shadows, and a newer baseline does not resurrect it.
// If it breaks, maps show stale or doubled features. Pure model, no setup.

// keep-file(K1): pure OSM model rule

import { describe, expect, it } from "vitest";
import { effectiveOsmEnvironmentRows } from "../osm-model";

describe("OSM model environment ownership", () => {
	it("renders a world override and excludes its newer baseline", () => {
		const baseline = {
			bundleId: "adventure",
			placeEdgeId: 7n,
			cellRes4: 100n,
			stateId: "open",
			stateRowId: 2n,
			updatedTick: 99n,
			value: { tag: "Bool", value: false },
		};
		const override = {
			...baseline,
			bundleId: "",
			cellRes4: 200n,
			stateRowId: 1n,
			updatedTick: 0n,
			value: { tag: "Bool", value: true },
		};
		for (const input of [
			[override, baseline],
			[baseline, override],
		]) {
			const effective = effectiveOsmEnvironmentRows(input);
			expect(effective).toHaveLength(1);
			expect(effective[0]).toMatchObject(override);
		}
	});
});
