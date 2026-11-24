// CI gate: every READER_SCOPED_TABLE must be declared by at least one
// registered reader manifest, OR appear in KNOWN_LATE_BINDING.
// Phase 2 flips the gate on by default; importing readers.ts triggers the
// six registerReaderManifest calls before evaluation.

import { describe, expect, it } from "vitest";

import {
	findUndeclaredBaselineTables,
	getRegisteredReaderTables,
	READER_SCOPED_TABLES,
} from "../src/connection";

// Import each reader to trigger the registerReaderManifest calls.
import "../src/core/readers/world_status";
import "../src/core/readers/world_events";
import "../src/core/readers/apply_consequences";
import "../src/core/readers/actor_body_swaps";
import "../src/core/readers/action_economy_events";
import "../src/core/readers/actor_snapshot";
import "../src/core/readers/location_snapshot";
import "../src/core/readers/manifest_export";
// scene.ts (U4): the only declaring reader for `entity_description` — every
// other table it requires is already covered by a reader imported above.
import "../src/core/readers/scene";
import "../src/core/readers/outcome_template";
import "../src/core/readers/manipulation_context";
import "../src/core/readers/suggest_next_action";
import "../src/core/readers/observer_knowledge";
import "../src/core/readers/observer_place_knowledge";
import "../src/core/readers/seats";
import "../src/core/readers/observer_trace_knowledge";
import "../src/core/readers/resource_deltas";
import "../src/core/readers/condition_deltas";
import "../src/core/readers/traces";
import "../src/core/readers/entity_containment";
import "../src/core/readers/actors_and_bodies";
import "../src/core/readers/bundle_entities";
import "../src/core/readers/bundle_definitions";
import "../src/core/readers/equipment";
import "../src/core/readers/session";
import "../src/core/readers/spatial_environment_state";
import "../src/core/readers/spatial_niche_attachments";
import "../src/core/readers/tag_reads";
import "../src/core/readers/self_capabilities";
import "../src/core/readers/self_economy";
import "../src/core/readers/self_evaluations";
import "../src/core/readers/self_identity";
import "../src/core/readers/intervention_windows";
import "../src/core/readers/turn_state";
// sk-adr8.7: spatial geometry via visible_* views (place_topology / map_layers).
import "../src/core/readers/place_topology";
import "../src/core/readers/map_layers";
import "../src/core/readers/substrate_definitions";
import "../src/provenance";

// Tables that have no Phase 2 reader yet and will gain one in a later phase.
// - visible_pending_resolution / reservation / visible_session: tasks.md Phase 7
//   (reducer-helpers) and Phase 9.2 (acceptance scenario A r_session_open).
//   `pending_resolution` is private (ADR-0120); the subscribed surface is the
//   per-caller `visible_pending_resolution` view, so the late-binding
//   exemption tracks the view name.
// - visible_pending_resolution_reactor: ADR-0120 per-caller view over the now
//   private `pending_resolution_reactor` working-set. Subscribed so the surface
//   mirrors the Rust client (which reads it for the `pending-reactor` triplet);
//   the TS SDK has no reader yet, so it is late-binding like its parent view.
// - item / item_location / entity_inventory / manifest_authored_item: Phase 7
//   D4 (r_manipulate helper, inventory readers).
const KNOWN_LATE_BINDING = new Set([
	"action_definition",
	"visible_pending_resolution",
	"visible_pending_resolution_reactor",
	"reservation",
	"visible_session",
]);

describe("baseline-consumer gate", () => {
	it("READER_SCOPED_TABLES is non-empty (sanity)", () => {
		expect(READER_SCOPED_TABLES.length).toBeGreaterThan(0);
	});

	it("findUndeclaredBaselineTables returns empty set when all tables declared", () => {
		const allDeclared = new Set<string>(READER_SCOPED_TABLES);
		const missing = findUndeclaredBaselineTables(allDeclared);
		expect(missing).toHaveLength(0);
	});

	it("findUndeclaredBaselineTables names the missing table for a partial manifest", () => {
		// Declare all but one table — the gate must name the missing entry.
		const partial = new Set<string>(READER_SCOPED_TABLES.slice(1));
		const missing = findUndeclaredBaselineTables(partial);
		expect(missing).toHaveLength(1);
		expect(missing[0]).toBe(READER_SCOPED_TABLES[0]);
	});

	it("findUndeclaredBaselineTables returns all tables when nothing declared", () => {
		const missing = findUndeclaredBaselineTables(new Set());
		expect(missing).toEqual([...READER_SCOPED_TABLES]);
	});

	it("gate: no reader-scoped table outside KNOWN_LATE_BINDING has no consumer", () => {
		const declared = getRegisteredReaderTables();
		const allOrphans = findUndeclaredBaselineTables(declared);
		const orphans = allOrphans.filter((t) => !KNOWN_LATE_BINDING.has(t));
		if (orphans.length > 0) {
			throw new Error(orphans.map((t) => `table in baseline has no consumer: ${t}`).join("\n"));
		}
	});
});
