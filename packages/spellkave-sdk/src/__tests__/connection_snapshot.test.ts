// Cover the live-binding adapter shape inside `snapshot()` directly,
// not via injected mock readers further upstream. The verifier (2026-05-02)
// flagged that the actor / edge readers were never tested against the
// generated-binding row keys (camelCase `entityId`, `placeNodeId`, etc.) —
// only against pre-shaped mock readers. This file closes that gap.

import type { DbConnection } from "@spellkave/bindings";
import { describe, expect, it } from "vitest";

import type { ReaderManifest, RequiredTables, TableName } from "../connection";
import {
	buildSubscribeSet,
	CACHE_APPLIED_MARKER,
	CONNECTION_BASELINE,
	captureSnapshotFrame,
	defaultReaderManifest,
	getRegisteredReaderTables,
	installRefreshHooks,
	READER_SCOPED_TABLES,
	registerReaderManifest,
	SUBSCRIBED_TABLES,
	snapshotDbFromCaptureFrame,
	snapshotDbFromFixture,
	snapshotFromDb,
} from "../connection";

// Compile-time evidence: known retained factual surfaces are admissible.
const _goodManifest: RequiredTables<["visible_manipulation_context", "visible_world_event"]> = [
	"visible_manipulation_context",
	"visible_world_event",
];
const _scopedEntry: TableName = "visible_manipulation_context";

import { resolveActor } from "../core/actor";
import { asEntityId } from "../core/ids";
import { listAdjacentMoves, validateMove } from "../core/movement";
import { readRecentEvents } from "../core/readers/world_events";
import { readManipulationContextRequiredTables } from "../readers";

interface FakeRow {
	[k: string]: unknown;
}

function fakeHandle(rows: FakeRow[]): {
	iter(): Iterable<FakeRow>;
} {
	return { iter: () => rows };
}

describe("snapshotFromDb live-binding adapter", () => {
	it("subscribes the visible captured trace when only the manipulation-context reader is selected", () => {
		expect(
			buildSubscribeSet([{ requiredTables: readManipulationContextRequiredTables }]),
		).toContain("visible_trace");
	});
	it("subscribes to actor concept tables for the actors_and_bodies reader", () => {
		expect((SUBSCRIBED_TABLES as readonly string[]).includes("actor")).toBe(true);
		// `actor_identity` is private (#915 PR-5); this is its self-only view.
		expect((SUBSCRIBED_TABLES as readonly string[]).includes("visible_actor_identity")).toBe(true);
		expect(
			(SUBSCRIBED_TABLES as readonly string[]).includes("visible_actor_spatial_location"),
		).toBe(true);
		expect(
			(SUBSCRIBED_TABLES as readonly string[]).includes(
				"directly_controlled_actor_spatial_location",
			),
		).toBe(true);
	});

	it("contains exactly 78 entries including public session definitions, factored manipulation facts, and paired authored mapping coverage", () => {
		expect(SUBSCRIBED_TABLES.length).toBe(78);
		const tables = SUBSCRIBED_TABLES as readonly string[];
		expect(tables).toContain("visible_manifest_authored_entity");
		expect(tables).toContain("visible_prompt_occurrence");
		expect(tables).toContain("visible_manifest_authored_entity_coverage");
		expect(tables).not.toContain("manifest_authored_entity");
		// `pending_resolution` and its reactor working-set are private (ADR-0120);
		// the per-caller views are subscribed.
		expect(tables).toContain("visible_pending_resolution");
		expect(tables).toContain("visible_pending_resolution_reactor");
		// The frozen stochastic-draw extension row for a parked pending_resolution
		// (post-roll intervention windows, #2058).
		expect(tables).toContain("visible_pending_stochastic_resolution");
		expect(tables).toContain("reservation");
		expect(tables).toContain("visible_session");
		expect(tables).toContain("session_definition");
		expect(tables).toContain("action_definition");
		expect(tables).toContain("visible_manipulation_context");
		expect(tables).toContain("visible_manipulation_observed_target");
		expect(tables).toContain("visible_manipulation_participant_context");
		expect(tables).toContain("visible_manipulation_participant_binding");
		// `trace` is private (ADR-0120, #915); the per-caller view is subscribed.
		expect(tables).toContain("visible_trace");
		expect(tables).toContain("capability_definition");
		// Derived self capabilities join authored identity bridges (ADR-0155 D-2).
		expect(tables).toContain("tag_capability_grant");
		// `capability` is private (ADR-0120); the per-caller view is subscribed
		// so a player can perceive their own trained capabilities (finding #11).
		expect(tables).toContain("visible_capability");
		expect(tables).toContain("visible_entity_equipment_slot");
		expect(tables).toContain("equipment_slot_definition");
		expect(tables).toContain("resource_definition");
		expect(tables).toContain("event_channel_spend");
		expect(tables).toContain("event_boundary_fired");
		expect(tables).toContain("event_channel_window_refresh");
		expect(tables).toContain("event_action_recharge_fired");
		expect(tables).toContain("visible_condition_boundary_expiry");
		// `visible_economy_channel_spend`: current-window spend standing view
		// (ADR-0120, #915), typed reader home added #2083/#2096.
		expect(tables).toContain("visible_economy_channel_spend");
		expect(tables).toContain("visible_economy_channel_budget");
		// `metadata_attachment` is private (ADR-0130); these two play views
		// back `readSurfaceMembership`'s `ui.self_summary` join (#2119).
		expect(tables).toContain("public_metadata_attachment");
		expect(tables).toContain("visible_metadata_attachment");
		// `tag_value_definition`: public bundle-authored catalog rows backing
		// `readSelfIdentity`'s prefix/description enrichment (#2119 follow-up).
		expect(tables).toContain("tag_value_definition");
		// ADR-0149: the public export table leaves the reader baseline. The
		// view is subscribed only when the module lists it.
		expect(tables).not.toContain("manifest_export");
		expect(tables).not.toContain("visible_manifest_export_result");
		// `event_condition_delta` is private (ADR-0120, K-B Part B); the
		// per-caller view is subscribed (same shape as event_resource_delta).
		expect(tables).toContain("visible_event_condition_delta");
		// `niche_definition` is public (actor-carried-verbs D1/D2); the
		// affordances reader joins it for `provider` (W1).
		expect(tables).toContain("niche_definition");
	});

	it("CONNECTION_BASELINE has 3 entries and READER_SCOPED_TABLES has 75; sets are disjoint", () => {
		expect(CONNECTION_BASELINE.length).toBe(3);
		expect(READER_SCOPED_TABLES.length).toBe(75);
		const baseline = new Set<string>(CONNECTION_BASELINE);
		const scoped = new Set<string>(READER_SCOPED_TABLES);
		for (const t of baseline) {
			expect(scoped.has(t)).toBe(false);
		}
		// Union equals SUBSCRIBED_TABLES
		expect(SUBSCRIBED_TABLES.length).toBe(CONNECTION_BASELINE.length + READER_SCOPED_TABLES.length);
	});

	it("derives actor existence + current node from camelCase actor_spatial_location rows", () => {
		const snap = snapshotFromDb({
			visibleActorSpatialLocation: fakeHandle([
				// shape mirrors `@spellkave/bindings`: `actor_spatial_location_table.ts`
				{ entityId: 1n, placeNodeId: "tavern", updatedAtTick: 7n },
				{ entityId: 2n, placeNodeId: "study", updatedAtTick: 7n },
			]),
		});
		const a = resolveActor("1", snap.actors);
		expect(a.current_node_id).toBe("tavern");
		expect(() => resolveActor("ghost", snap.actors)).toThrow(/not found/);
	});

	it("keeps broad visibility separate from server-attested direct control", () => {
		const snap = snapshotFromDb({
			visibleActorSpatialLocation: fakeHandle([
				{ entityId: 1n, placeNodeId: "near" },
				{ entityId: 2n, placeNodeId: "near" },
				{ entityId: 3n, placeNodeId: "extent" },
			]),
			directlyControlledActorSpatialLocation: fakeHandle([{ entityId: 1n, placeNodeId: "near" }]),
		});

		expect(resolveActor("2", snap.actors).body_entity_id).toBe("2");
		expect(resolveActor("3", snap.actors).body_entity_id).toBe("3");
		expect(() => resolveActor("2", snap.controlledActors)).toThrow(/not found/);
		expect(() => resolveActor("3", snap.controlledActors)).toThrow(/not found/);
		expect(resolveActor("1", snap.controlledActors).body_entity_id).toBe("1");
	});

	it("stringifies u64 edgeId so the LLM tool / r_move share one identifier shape", () => {
		// place_edge.edgeId is u64 in the generated table; r_move accepts string.
		// The adapter must coerce so the widget, the tool, and the reducer all
		// see the same value form.
		const snap = snapshotFromDb({
			visiblePlaceEdge: fakeHandle([
				{
					edgeId: 42n,
					fromNodeId: "tavern",
					toNodeId: "square",
				},
			]),
			visiblePlaceNode: fakeHandle([{ nodeId: "square" }, { nodeId: "tavern" }]),
		});
		const adjacent = listAdjacentMoves(
			{ body_entity_id: asEntityId("scout-01"), current_node_id: "tavern" },
			snap.movement,
		);
		expect(adjacent).toEqual([{ edge_id: "42", to_node: "square" }]);

		const call = validateMove(
			{ body_entity_id: asEntityId("scout-01"), current_node_id: "tavern" },
			"42",
			snap.movement,
		);
		expect(call).toEqual({
			actor_id: "scout-01",
			from_node: "tavern",
			to_node: "square",
			edge_id: "42",
		});
	});

	it("skips edges that are not outgoing from the actor's node (no bidirectional shortcut)", () => {
		// The schema has no `bidirectional` column on place_edge; the adapter
		// must not invent one.
		const snap = snapshotFromDb({
			visiblePlaceEdge: fakeHandle([
				// only the `bidirectional` field would matter if we still honored it
				{
					edgeId: 1n,
					fromNodeId: "square",
					toNodeId: "tavern",
					bidirectional: true,
				},
			]),
			visiblePlaceNode: fakeHandle([{ nodeId: "tavern" }, { nodeId: "square" }]),
		});
		const adjacent = listAdjacentMoves(
			{ body_entity_id: asEntityId("scout-01"), current_node_id: "tavern" },
			snap.movement,
		);
		expect(adjacent).toEqual([]);
	});

	it("returns empty iterables when accessors are missing entirely", () => {
		const snap = snapshotFromDb({});
		expect(Array.from(snap.actors.locations())).toEqual([]);
		expect(Array.from(snap.movement.edges())).toEqual([]);
		expect(Array.from(snap.movement.nodes())).toEqual([]);
	});

	it("treats null/empty place_node_id as undefined (actor exists but unplaced)", () => {
		// Boundary: an actor row may exist with a null current node — the adapter
		// must surface `current_node_id: undefined` (not the string "null"), so
		// resolveActor still considers the actor present.
		const snap = snapshotFromDb({
			visibleActorSpatialLocation: fakeHandle([
				{ entityId: 1n, placeNodeId: null },
				{ entityId: 2n, placeNodeId: "" },
			]),
		});
		const locations = Array.from(snap.actors.locations());
		expect(locations).toEqual([
			{ entity_id: "1", node_id: undefined },
			{ entity_id: "2", node_id: undefined },
		]);
	});
});

describe("snapshot capture frames", () => {
	it("captures selected binding-backed tables into a replayable checkpoint", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			// `world_event` is private (#915 PR-8); a live connection populates
			// `visible_world_event` instead. The two rows are arbitrary filler
			// for the capture/replay mechanism under test, not a claim about
			// which kinds a live server emits — deliberately `manual` and
			// `intent` rather than `tick`, since the server no longer admits
			// `EventKind::Tick` to this view at all (scope-tick-event-visibility).
			visible_world_event: [
				{ id: 1n, tick: 1n, kind: { tag: "manual" }, summary: { some: "World tick 1" } },
				{ id: 2n, tick: 2n, kind: { tag: "intent" }, summary: { some: "Player looked" } },
			],
			visible_place_node: [{ nodeId: "ignored" }],
		});

		const frame = captureSnapshotFrame(db, { tick: 2, tables: ["visible_world_event"] });

		expect(frame).toEqual({
			kind: "spellkave.snapshot_frame",
			version: 1,
			tick: 2,
			tables: {
				visible_world_event: [
					{ id: 1, tick: 1, kind: { tag: "manual" }, summary: { some: "World tick 1" } },
					{ id: 2, tick: 2, kind: { tag: "intent" }, summary: { some: "Player looked" } },
				],
			},
		});
		expect(readRecentEvents(snapshotDbFromCaptureFrame(frame), 5)).toEqual([
			{ id: "2", tick: 2, kind: "intent", summary: "Player looked" },
			{ id: "1", tick: 1, kind: "manual", summary: "World tick 1" },
		]);
	});

	it("keeps oversized bigint ids JSON-representable without losing precision", () => {
		const large = 9_007_199_254_740_993n;
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_world_event: [{ id: large, tick: 1n, kind: { tag: "manual" } }],
		});

		const frame = captureSnapshotFrame(db, { tick: 1, tables: ["visible_world_event"] });

		expect(frame.tables.visible_world_event?.[0]?.id).toBe(large.toString());
	});
});

describe("installRefreshHooks", () => {
	it("CACHE_APPLIED_MARKER is never a subscribed table name", () => {
		expect(CACHE_APPLIED_MARKER).toBe("__applied");
		expect((SUBSCRIBED_TABLES as readonly string[]).includes(CACHE_APPLIED_MARKER)).toBe(false);
	});

	interface FakeTable {
		iter(): Iterable<FakeRow>;
		onInsert?: (cb: () => void) => void;
		onUpdate?: (cb: () => void) => void;
		onDelete?: (cb: () => void) => void;
	}

	function fakeTable(): FakeTable & {
		fired: { insert: number; update: number; delete: number };
		inserts: Array<() => void>;
		updates: Array<() => void>;
		deletes: Array<() => void>;
	} {
		const inserts: Array<() => void> = [];
		const updates: Array<() => void> = [];
		const deletes: Array<() => void> = [];
		return {
			iter: () => [],
			onInsert: (cb) => {
				inserts.push(cb);
			},
			onUpdate: (cb) => {
				updates.push(cb);
			},
			onDelete: (cb) => {
				deletes.push(cb);
			},
			get fired() {
				return {
					insert: inserts.length,
					update: updates.length,
					delete: deletes.length,
				};
			},
			inserts,
			updates,
			deletes,
		};
	}

	function fakeConn(db: Record<string, FakeTable | undefined>): DbConnection {
		return { db } as unknown as DbConnection;
	}

	it("forwards apply seals and failures outside the PLAYER subscription baseline", () => {
		const digest = fakeTable();
		const outcome = fakeTable();
		const notifications: string[] = [];
		installRefreshHooks(
			fakeConn({ manifestApplyDigest: digest, manifestApplyOutcome: outcome }),
			(table) => notifications.push(table),
		);
		for (const callback of digest.inserts) callback();
		for (const callback of outcome.inserts) callback();
		expect(notifications).toEqual(["manifest_apply_digest", "manifest_apply_outcome"]);
		// Hooks do not widen the default PLAYER subscriptions.
		expect(SUBSCRIBED_TABLES).not.toContain("manifest_apply_digest");
		expect(SUBSCRIBED_TABLES).not.toContain("manifest_apply_outcome");
	});

	it("subscribes onInsert/onUpdate/onDelete on every camelCased subscribed table", () => {
		const tables: Record<string, ReturnType<typeof fakeTable>> = {};
		const db: Record<string, FakeTable> = {};
		for (const t of SUBSCRIBED_TABLES) {
			const camel = t.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
			const h = fakeTable();
			tables[camel] = h;
			db[camel] = h;
		}
		const onUpdate = (): void => {};
		installRefreshHooks(fakeConn(db), onUpdate);
		for (const t of SUBSCRIBED_TABLES) {
			const camel = t.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
			const h = tables[camel];
			// biome-ignore lint/style/noNonNullAssertion: test-local map
			expect(h!.fired).toEqual({ insert: 1, update: 1, delete: 1 });
		}
	});

	it("dispatches the same onUpdate callback on insert/update/delete events", () => {
		const handle = fakeTable();
		const db = { worldTime: handle };
		const tables: string[] = [];
		installRefreshHooks(fakeConn(db), (table) => {
			tables.push(table);
		});
		// Simulate the SDK firing each event once.
		for (const cb of handle.inserts) cb();
		for (const cb of handle.updates) cb();
		for (const cb of handle.deletes) cb();
		expect(tables).toEqual(["world_time", "world_time", "world_time"]);
	});

	it("passes the snake_case table name, not the SDK callback args", () => {
		const handle = fakeTable();
		const db = { worldTime: handle, config: fakeTable() };
		const tables: string[] = [];
		installRefreshHooks(fakeConn(db), (table) => {
			tables.push(table);
		});
		// SpacetimeDB invokes onInsert(ctx, row) — those args must not leak.
		for (const cb of handle.inserts)
			(cb as (ctx: unknown, row: unknown) => void)({ ctx: true }, { row: true });
		expect(tables).toEqual(["world_time"]);
	});

	it("falls back to the snake_case accessor when camelCase is missing", () => {
		const handle = fakeTable();
		// place_edge has the most camel→snake distance among subscribed names.
		const db = { visible_place_edge: handle };
		installRefreshHooks(fakeConn(db), () => {});
		expect(handle.fired).toEqual({ insert: 1, update: 1, delete: 1 });
	});

	it("skips tables that the bindings did not expose", () => {
		// No accessor at all → must not throw.
		expect(() => installRefreshHooks(fakeConn({}), () => {})).not.toThrow();
	});

	it("tolerates accessors that omit some of the on* callbacks", () => {
		// Defensive: a future binding revision may stop emitting onUpdate for a
		// particular component table. The hook installer must not blow up.
		const partial: FakeTable = {
			iter: () => [],
			onInsert: (cb) => cb(),
		};
		let calls = 0;
		installRefreshHooks(fakeConn({ worldTime: partial }), () => {
			calls += 1;
		});
		expect(calls).toBe(1);
	});
});

describe("ReaderManifest registry", () => {
	it("getRegisteredReaderTables reflects a registered stub manifest", () => {
		const before = new Set(getRegisteredReaderTables());
		registerReaderManifest({ requiredTables: ["visible_world_event", "visible_target_condition"] });
		const after = getRegisteredReaderTables();
		expect(after.has("visible_world_event")).toBe(true);
		expect(after.has("visible_target_condition")).toBe(true);
		// entries present before are still there (union, no eviction)
		for (const t of before) {
			expect(after.has(t)).toBe(true);
		}
	});

	it("unions tables from multiple registered manifests", () => {
		registerReaderManifest({ requiredTables: ["visible_place_node"] });
		registerReaderManifest({ requiredTables: ["visible_place_edge", "visible_place_node"] });
		const result = getRegisteredReaderTables();
		expect(result.has("visible_place_node")).toBe(true);
		expect(result.has("visible_place_edge")).toBe(true);
	});
});

describe("buildSubscribeSet", () => {
	it("always includes every CONNECTION_BASELINE entry", () => {
		const set = buildSubscribeSet();
		for (const t of CONNECTION_BASELINE) {
			expect(set).toContain(t);
		}
	});

	it("result is deduplicated (no duplicate entries)", () => {
		const set = buildSubscribeSet();
		expect(set.length).toBe(new Set(set).size);
	});

	it("produces SELECT * FROM queries for every table in the set", () => {
		const set = buildSubscribeSet();
		// ci-allow-start(raw-sql): asserts buildSubscribeSet()'s output shape - expected values, not subscription calls
		const queries = set.map((t) => `SELECT * FROM ${t}`);
		for (const t of CONNECTION_BASELINE) {
			expect(queries).toContain(`SELECT * FROM ${t}`);
		}
		// ci-allow-end(raw-sql)
	});

	it("uses the full baseline when no explicit reader manifests are passed", () => {
		// The no-manifest fallback is a union over MODULE-LOAD registrations
		// (`registerReaderManifest`, called at import time by each reader), so
		// what it returns depends on the caller's import graph — this test pins
		// it from a deliberately NARROW one (it imports `../connection` plus a
		// few named readers, never the `../readers` barrel).
		//
		// Slice B2 (session-owns-the-world-event-cursor.md) made `connection.ts`
		// import `./world-events/builder.ts`, which needs `readCurrentScene` and
		// therefore loads `core/readers/scene.ts`, whose registration declares
		// `visible_entity_location` and `place_edge_affordance`. That is why THIS
		// test's expectation grew.
		//
		// It is NOT a wire change for any deployed connection. Every production
		// caller that omits `readerManifests` already loaded scene.ts before B2:
		// the daemon, Pi, Play and `sk` all reach it through the PLAYER tools,
		// and `gateway-identity/world-router.ts` imports the `@spellkave/sdk/
		// readers` barrel directly. The paths that genuinely widen are local
		// setup/seed connections (`connectSetupSession`) and this test. The
		// curated static `READER_SCOPED_TABLES` baseline is untouched either way.
		//
		// A session that advertises `worldEvents` must subscribe to what that
		// cursor reads: subscriptions are fixed at connect() and cannot be
		// widened later, so a lazily-accessible cursor has to be paid for
		// eagerly. That is the honest price of the field, not an accident.
		expect(buildSubscribeSet()).toEqual(
			[
				...CONNECTION_BASELINE,
				...READER_SCOPED_TABLES,
				"visible_entity_location",
				"place_edge_affordance",
				// Item detail joins public authored descriptions and state labels.
				"entity_definition",
				"object_state_definition",
				"condition_definition",
			].filter((t) => !["evaluation_provenance", "object_state", "target_condition"].includes(t)),
		);
	});

	it("narrows explicit reader manifests while preserving baseline and private-table filters", () => {
		const set = buildSubscribeSet([
			{
				requiredTables: [
					"visible_place_edge",
					"visible_actor_spatial_location",
					"target_condition",
				],
			} as unknown as ReaderManifest,
			{ requiredTables: ["visible_place_node", "visible_place_edge"] },
		]);
		expect(set).toEqual([
			"config",
			"world_time",
			"directly_controlled_actor_spatial_location",
			"visible_place_edge",
			"visible_actor_spatial_location",
			"visible_place_node",
		]);
		expect(set).not.toContain("target_condition");
	});

	// sk-jay0.1.1.14 (#3487 root cause): `defaultReaderManifest()` exists so a
	// caller that needs its OWN `readerManifests` (to add a few extra tables on
	// top of the default) does not silently narrow its whole subscription to
	// only those extra tables — passing `[defaultReaderManifest()]` here must
	// be indistinguishable from passing no manifests at all.
	it("defaultReaderManifest() reproduces buildSubscribeSet()'s own no-manifest default exactly", () => {
		expect(buildSubscribeSet([defaultReaderManifest()])).toEqual(buildSubscribeSet());
	});

	it("defaultReaderManifest() plus extra tables subscribes the default union AND the extras (the Play/watch-buffer shape)", () => {
		const set = buildSubscribeSet([
			{
				requiredTables: [...defaultReaderManifest().requiredTables, "visible_entity_location"],
			},
		]);
		// Everything the no-manifest default carries...
		for (const t of buildSubscribeSet()) expect(set).toContain(t);
		// ...plus explicitly widened tables, without duplicates.
		expect(set).toContain("visible_entity_location");
		expect(set.length).toBe(new Set(set).size);
	});
});
