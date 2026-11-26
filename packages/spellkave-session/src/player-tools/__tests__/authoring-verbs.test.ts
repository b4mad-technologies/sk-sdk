// embedded-manifest: {"category": "exact_text_oracle", "rationale": "pass-through and partial-scratch cases pin authoring verb boundary behaviour exactly"}
// embedded-manifest: {"category": "schema_object_oracle", "rationale": "typed schema objects are direct row-composition and verb-validation test inputs"}
// Offline acceptance proof for the VERB-AUTHORING-TOOLS PoC (#1968 "Design:
// verb-based authoring tools"). No fs, no live node, no model — a fake
// in-memory workspace drives the tool bodies directly, exactly like the
// AUTHOR-facing subset's own test (`author-facing-tools.test.ts`).
//
// EMPTY-WORKSPACE NOTE (#1968 ergonomics-fix round): the sequence below starts
// from a workspace with NO scratch manifest at all — no pre-seeded
// `spellkave_write_manifest_toml` scaffold call. Every write verb now
// self-scaffolds its own `[[bundles]]` header the first time it sees a new
// `bundle` (FIX②b); `spellkave_define_resource` (FIX②a) is the new verb that
// authors the `aoe_blast/hp` resource pool the worked example itself
// hand-authors with bespoke bounds (`spellkave_define_behavior` has no bounds/
// seed params, so it REQUIRES `effect.write.resource` to already exist rather
// than fabricate numbers). The sequence therefore lands at exactly FOUR write
// calls — `spellkave_author_place` → `spellkave_define_resource` →
// `spellkave_place_entity` / `spellkave_place_actor` (using the FIX① `placements` shape to reproduce the
// example's 3-at-center + 1-at-fringe split in ONE call) →
// `spellkave_define_behavior` — plus the existing
// `spellkave_apply_manifest_delta`, matching the original "259 lines → 4
// calls" framing even after adding a resource-scaffolding verb.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthorToolContext, AuthorWorkspace } from "@spellkave/tool-authoring";
import {
	type AuthorTarget,
	annotatePlaceToolDef,
	attachMapLayerToolDef,
	authorPlaceToolDef,
	bindActorToolDef,
	bindEdgeAffordanceToolDef,
	defineActionToolDef,
	defineActionVerbToolDef,
	defineAffordanceToolDef,
	defineBehaviorToolDef,
	defineBundleToolDef,
	defineCapabilityToolDef,
	defineConditionToolDef,
	defineConsequenceToolDef,
	defineEntityTypeToolDef,
	defineNicheToolDef,
	defineResourceToolDef,
	defineRollTableToolDef,
	defineSessionToolDef,
	defineTraceKindToolDef,
	equipItemToolDef,
	linkPlacesToolDef,
	mapGraphToolDef,
	placeEntityToolDef,
	QUERY_LIST_PREFERRED_FIELDS,
	type QueryDetailResult,
	type QueryListResult,
	type QueryNotFoundResult,
	type QuerySchemaIndexResult,
	type QuerySchemaKindResult,
	type QuerySchemaNotFoundResult,
	type QuerySummaryResult,
	queryToolDef,
	placeActorToolDef as rawPlaceActorToolDef,
	setMovementDefaultToolDef,
	stowItemToolDef,
	tagEntityToolDef,
	type VerbResult,
	writeRowsToolDef,
} from "@spellkave/tool-authoring";
import { nodeToolCapability } from "@spellkave/tool-node";
import { createLocalAuthorTarget } from "@spellkave/tool-node/authoring";
import {
	type ActorBehavior,
	assertIdentityStable,
	type BehaviorConfig,
	clusterRows,
	getAuthoringExample,
	identityOf,
	inspectManifest,
	type RefTagFamily,
	refTagOutboundRefs,
	renderSchemaManifest,
	writeOutputs,
} from "@spellkave/world-author";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveAuthorTarget } from "../../authoring";

// Keep the older actor-placement scenarios readable while the focused tests
// below exercise the new explicit `kind` contract directly.
const spawnToolDef = {
	...rawPlaceActorToolDef,
	run: (
		context: AuthorToolContext,
		params: Record<string, unknown>,
		callId?: string,
	): ReturnType<typeof rawPlaceActorToolDef.run> => {
		const entityDef = params.entity_def;
		const qualified = typeof entityDef === "string" && entityDef.includes("/");
		return rawPlaceActorToolDef.run(
			context,
			{
				...params,
				kind: (qualified ? "npc" : String(entityDef)) as "player" | "npc" | "item" | "place",
				...(qualified ? {} : { entity_def: undefined }),
			},
			callId ?? "legacy-actor-placement-test",
		);
	},
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function fakeWorkspace(
	initial: string | null = null,
): AuthorWorkspace & { current(): string | null } {
	let current = initial;
	return {
		readToml: () => current,
		writeToml: (toml: string) => {
			current = toml;
			return "/scratch/authoring-verbs-test";
		},
		current: () => current,
	};
}

function contextWith(overrides: Partial<AuthorToolContext> = {}): AuthorToolContext {
	return { workspace: fakeWorkspace(), ...overrides };
}

/**
 * A "connected, nothing subscribed yet" live db fake for `createLiveAuthorTarget`
 * tests below (ledger finding #5): a REAL live `DbConnection.db` always exposes
 * an accessor for every schema table (possibly empty, never absent — table
 * existence and subscription/row-count are independent), so `commitOrReport`'s
 * `augmentForValidation` unconditionally `lookup()`s every `VALIDATION_AUGMENT_
 * KINDS` entry regardless of which row kind a given test actually cares about.
 * `liveTable`/`liveTableRows` now throw on a genuinely absent accessor (never
 * silently empty), so a bare `{}` fake — which no real connection would ever
 * produce — would misfire that throw. `extra` layers in whatever table(s) a
 * specific test needs populated.
 */
function emptyLiveDb(extra: Record<string, { iter(): Iterable<Record<string, unknown>> }> = {}) {
	return {
		resource_definition: { iter: () => [] },
		object_state_definition: { iter: () => [] },
		// Finite tag selections now consult the public live vocabulary during
		// validation, even when the delta under test contains no selection.
		tag_value_definition: { iter: () => [] },
		entity_definition: { iter: () => [] },
		capability_definition: { iter: () => [] },
		dsl_macro_definition: { iter: () => [] },
		// Must mirror every LIVE_TABLE_ACCESSORS entry used by VALIDATION_AUGMENT_KINDS
		// (live lookup throws if the accessor table handle is absent — #2092).
		modifier_target_definition: { iter: () => [] },
		// sk-9ll.3 added `equipment_slot_definitions` to VALIDATION_AUGMENT_KINDS
		// without updating this mirror — every prior live-target test silently
		// fell back to closed-world validation (augmentForValidation's own
		// catch/fallback in commitOrReport) once it reached this kind, unnoticed
		// because none of them asserted on an augmentation this specific miss
		// would have broken.
		equipment_slot_definition: { iter: () => [] },
		...extra,
	};
}

/** Drive the exact 4-call sequence against a genuinely EMPTY workspace; returns the final TOML + call results. */
async function runFireballSequence(withDescriptions: boolean) {
	const workspace = fakeWorkspace(null);
	const applyDelta = async (toml: string) => {
		applied = toml;
		return { ok: true };
	};
	let applied: string | undefined;
	const context = contextWith({ workspace, applyDelta });

	const placeResult = await authorPlaceToolDef.run(
		context,
		{
			bundle: "aoe_blast",
			nodes: [
				{ id: "aoe_blast/arena/center", name: "Arena Center" },
				{ id: "aoe_blast/arena/fringe", name: "Arena Fringe" },
			],
			edges: [],
			...(withDescriptions
				? {
						description:
							"Blast arena: center holds the caster + targets, fringe proves the radius-0 boundary.",
					}
				: {}),
		},
		"call-1",
	);

	const resourceResult = await defineResourceToolDef.run(
		context,
		{
			bundle: "aoe_blast",
			id: "hp",
			display_name: "Hit Points",
			min_value: 0,
			max_value: 30,
			recovery_rule: "long_rest",
			initial_value: 30,
		},
		"call-2",
	);

	// FIX① (#1968): ONE spawn call, `placements` splitting the batch across the
	// example's two nodes — 3 npcs at the center (the caster + two targets), 1 at
	// the fringe (the bystander the radius-0 selector must exclude).
	const spawnResult = await spawnToolDef.run(
		context,
		{
			bundle: "aoe_blast",
			entity_def: "npc",
			placements: [
				{ at: "aoe_blast/arena/center", count: 3 },
				{ at: "aoe_blast/arena/fringe", count: 1 },
			],
			...(withDescriptions
				? {
						description:
							"Fireball proof cast: npc_1 is the caster (mage); npc_2/npc_3 stand in for the two " +
							"goblin targets at center; npc_4 is the bystander control at the fringe.",
					}
				: {}),
		},
		"call-3",
	);
	const entityKeys = (spawnResult.details as VerbResult).entity_keys as string[];

	const behaviorResult = await defineBehaviorToolDef.run(
		context,
		{
			bundle: "aoe_blast",
			id: "firebloom",
			grant_to: entityKeys[0] as string,
			offered_when: { reach: "same_node" },
			action_class: "spell",
			effect: {
				primitive: "ForEachActorInRadius",
				shape: { id: "core/area/node_ball", radius: 0 },
				per_target_gate: "d20 < 13",
				write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d6" },
			},
			...(withDescriptions
				? {
						description:
							"Firebloom: AoE blast, flat DEX save DC13 negates, 1d6 damage on a failed save.",
					}
				: {}),
		},
		"call-4",
	);

	const finalToml = workspace.current();
	if (finalToml === null) throw new Error("expected a persisted manifest after the 4 write calls");

	const deltaResult = await defineBehaviorApplyDelta(context, finalToml);
	void deltaResult;

	return {
		placeResult,
		resourceResult,
		spawnResult,
		behaviorResult,
		entityKeys,
		finalToml,
		applied: () => applied,
	};
}

// `spellkave_apply_manifest_delta` itself isn't part of this PoC's assigned
// scope (it already exists, #1968 phase 3) — call the wired `applyDelta` port
// directly, exactly as that tool's own `run` body does.
async function defineBehaviorApplyDelta(context: AuthorToolContext, toml: string) {
	if (context.applyDelta === undefined) throw new Error("no applyDelta port wired");
	return context.applyDelta(toml);
}

// ---------------------------------------------------------------------------
// Normalized structural comparison (parse BOTH sides via the wasm parse path;
// compare field-by-field, tolerating JSON-string formatting noise and row
// ordering, per the assignment's acceptance bar).
// ---------------------------------------------------------------------------

function looksLikeJson(s: string): boolean {
	const t = s.trim();
	return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

/** Recursively parse any JSON-looking string field so e.g. `{"ball_radius": 0}` == `{"ball_radius":0}`. */
function normalize(value: unknown): unknown {
	if (typeof value === "string" && looksLikeJson(value)) {
		try {
			return normalize(JSON.parse(value));
		} catch {
			return value;
		}
	}
	if (Array.isArray(value)) return value.map(normalize);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = normalize(v);
		return out;
	}
	return value;
}

function tableRows(manifest: Record<string, unknown>, table: string): Record<string, unknown>[] {
	return Array.isArray(manifest[table]) ? (manifest[table] as Record<string, unknown>[]) : [];
}

function rowByKey(
	manifest: Record<string, unknown>,
	table: string,
	keyOf: (row: Record<string, unknown>) => string,
): Map<string, Record<string, unknown>> {
	return new Map(tableRows(manifest, table).map((row) => [keyOf(row), row]));
}

/** Field-by-field equal, modulo row ordering, JSON-string formatting, and an explicit `omit` list. */
function expectRowsMatch(
	actualManifest: Record<string, unknown>,
	expectedManifest: Record<string, unknown>,
	table: string,
	keyOf: (row: Record<string, unknown>) => string,
	omit: string[] = [],
) {
	const actual = rowByKey(actualManifest, table, keyOf);
	const expected = rowByKey(expectedManifest, table, keyOf);
	expect(new Set(actual.keys()), `${table} key set`).toEqual(new Set(expected.keys()));
	for (const [key, expectedRow] of expected) {
		const actualRow = actual.get(key);
		expect(actualRow, `${table}[${key}] present`).toBeDefined();
		const a = normalize(actualRow) as Record<string, unknown>;
		const e = normalize(expectedRow) as Record<string, unknown>;
		for (const field of omit) {
			delete a[field];
			delete e[field];
		}
		expect(a, `${table}[${key}]`).toEqual(e);
	}
}

// ---------------------------------------------------------------------------
// 1. The acceptance proof: 4 calls → validates clean → semantically equivalent.
// ---------------------------------------------------------------------------

describe("the fireball 4-call sequence reproduces the aoe-damage-spell worked example (#1968 PoC acceptance)", () => {
	it("validates with zero diagnostics after all 4 write calls, starting from an EMPTY workspace", async () => {
		const { placeResult, resourceResult, spawnResult, behaviorResult } =
			await runFireballSequence(false);
		expect((placeResult.details as VerbResult).ok, JSON.stringify(placeResult.details)).toBe(true);
		expect((resourceResult.details as VerbResult).ok, JSON.stringify(resourceResult.details)).toBe(
			true,
		);
		expect((spawnResult.details as VerbResult).ok, JSON.stringify(spawnResult.details)).toBe(true);
		expect((behaviorResult.details as VerbResult).ok, JSON.stringify(behaviorResult.details)).toBe(
			true,
		);
	});

	it("dispatches the final manifest through spellkave_apply_manifest_delta (the port, mocked — offline)", async () => {
		const { applied, finalToml } = await runFireballSequence(false);
		expect(applied()).toBe(finalToml);
	});

	it("is semantically equivalent to docs/examples/aoe-damage-spell.toml on the spell-cluster rows (field-by-field, modulo generated ids/comments)", async () => {
		const { finalToml } = await runFireballSequence(false);
		const actual = inspectManifest(finalToml).manifest as Record<string, unknown>;

		const example = getAuthoringExample("aoe-damage-spell");
		expect(example).toBeDefined();
		const expected = inspectManifest(example?.toml ?? "").manifest as Record<string, unknown>;

		// capability_definitions: ids/actor_kind/display_name/default_visibility all
		// reproduce exactly (id="firebloom" was chosen to match the example's own
		// "firebloom" spell name) — `description` is a DOCUMENTED divergence ONLY
		// because this particular `runFireballSequence(false)` call passes no
		// description at all (`define_behavior`'s `description` param DOES land on
		// this exact row now — #1968's description decision — see the
		// description-persistence test below for the positive proof).
		expectRowsMatch(actual, expected, "capability_definitions", (r) => String(r.capability_id), [
			"description",
		]);

		expectRowsMatch(actual, expected, "action_definitions", (r) => String(r.action_id));
		expectRowsMatch(actual, expected, "action_definition_tag", (r) => `${r.action_id}:${r.tag}`);
		// outcome_templates: `clusterRows` sets `display_name` to the ACTION id
		// (matching the real SRD generator convention, e.g.
		// archive/world-fixtures/srd/base/spell-actions.toml's `display_name = "srd/cast_*"`
		// rows) rather than the human-readable text the hand-authored worked example
		// uses ("Cast Firebloom") — a documented divergence (FIX③ de-fork: this verb
		// now drives the SAME builder those fixtures come from, so it inherits that
		// builder's own convention rather than reinventing a nicer one).
		expectRowsMatch(actual, expected, "outcome_templates", (r) => String(r.outcome_template_id), [
			"display_name",
		]);
		expectRowsMatch(actual, expected, "affordance_templates", (r) => String(r.template_id));
		expectRowsMatch(actual, expected, "consequence_templates", (r) => String(r.template_id));
		expectRowsMatch(
			actual,
			expected,
			"consequence_frame_writes",
			(r) => `${r.template_id}:${r.ordinal}`,
		);
		// resource_definitions: authored identically via spellkave_define_resource
		// (call-2 in runFireballSequence), so this matches exactly too.
		expectRowsMatch(actual, expected, "resource_definitions", (r) =>
			String(r.resource_definition_id),
		);

		// entity/place rows: compared on count + kind + key fields only (per the
		// assignment), NOT field-by-field — generated entity_keys diverge from the
		// example's hand-picked ones. The PLACEMENT split itself, though, now matches
		// the example exactly (FIX①, #1968): 3 npcs at the center, 1 at the fringe —
		// the boundary a radius-0 node_ball selector must exclude.
		expect(tableRows(actual, "entities")).toHaveLength(tableRows(expected, "entities").length);
		expect(tableRows(actual, "entities").every((r) => r.kind === "npc")).toBe(true);
		expect(
			tableRows(actual, "entities").filter((r) => r.place_node_id === "aoe_blast/arena/center"),
		).toHaveLength(3);
		expect(
			tableRows(actual, "entities").filter((r) => r.place_node_id === "aoe_blast/arena/fringe"),
		).toHaveLength(1);
		expect(tableRows(actual, "actors")).toHaveLength(tableRows(expected, "actors").length);
		expect(tableRows(actual, "actor_spatial_locations")).toHaveLength(
			tableRows(expected, "actor_spatial_locations").length,
		);
		expect(
			tableRows(actual, "actor_spatial_locations").filter(
				(r) => r.place_node_id === "aoe_blast/arena/center",
			),
		).toHaveLength(3);
		expect(
			tableRows(actual, "actor_spatial_locations").filter(
				(r) => r.place_node_id === "aoe_blast/arena/fringe",
			),
		).toHaveLength(1);
		expect(tableRows(actual, "place_graphs")).toHaveLength(
			tableRows(expected, "place_graphs").length,
		);
		expect(tableRows(actual, "place_graphs").map((r) => r.place_graph_id)).toEqual(
			tableRows(expected, "place_graphs").map((r) => r.place_graph_id),
		);
		expect(tableRows(actual, "place_nodes")).toHaveLength(
			tableRows(expected, "place_nodes").length,
		);
		expect(new Set(tableRows(actual, "place_nodes").map((r) => r.node_id))).toEqual(
			new Set(tableRows(expected, "place_nodes").map((r) => r.node_id)),
		);
		expect(tableRows(actual, "place_edges")).toHaveLength(
			tableRows(expected, "place_edges").length,
		);
	});

	it("carries NO metadata_attachments/metadata_namespaces rows when descriptions are passed — the #1968 divergence DISSOLVED, not merely tolerated", async () => {
		const withoutDescriptions = await runFireballSequence(false);
		const withDescriptions = await runFireballSequence(true);
		const bare = inspectManifest(withoutDescriptions.finalToml).manifest as Record<string, unknown>;
		const described = inspectManifest(withDescriptions.finalToml).manifest as Record<
			string,
			unknown
		>;

		// The worked example has NEITHER table at all — and NEITHER does a run
		// with descriptions passed, now that `description` is a first-class
		// column instead of a metadata_attachments detour (#1968 decision).
		expect(tableRows(bare, "metadata_attachments")).toHaveLength(0);
		expect(tableRows(bare, "metadata_namespaces")).toHaveLength(0);
		expect(tableRows(described, "metadata_attachments")).toHaveLength(0);
		expect(tableRows(described, "metadata_namespaces")).toHaveLength(0);

		// author_place's description lands on place_graphs.description; spawn's on
		// every entities.description; define_behavior's on the ONE
		// capability_definitions row it emits (its natural authoring-identity
		// anchor). All three are non-empty when passed, empty when not.
		expect(tableRows(bare, "place_graphs")[0]?.description).toBeFalsy();
		expect(tableRows(described, "place_graphs")[0]?.description).toBe(
			"Blast arena: center holds the caster + targets, fringe proves the radius-0 boundary.",
		);
		expect(tableRows(bare, "entities").every((r) => !r.description)).toBe(true);
		expect(
			tableRows(described, "entities").every(
				(r) =>
					r.description ===
					"Fireball proof cast: npc_1 is the caster (mage); npc_2/npc_3 stand in for the two " +
						"goblin targets at center; npc_4 is the bystander control at the fringe.",
			),
		).toBe(true);
		expect(tableRows(bare, "capability_definitions")[0]?.description).toBeFalsy();
		expect(tableRows(described, "capability_definitions")[0]?.description).toBe(
			"Firebloom: AoE blast, flat DEX save DC13 negates, 1d6 damage on a failed save.",
		);

		// Every OTHER field on those three tables, and every OTHER table entirely,
		// is byte-for-byte identical whether or not `description` was passed —
		// the guardrail that `description` is never load-bearing.
		for (const table of ["place_graphs", "entities", "capability_definitions"]) {
			const stripDescription = (rows: Record<string, unknown>[]) =>
				rows.map((row) => {
					const { description: _description, ...rest } = row;
					return rest;
				});
			expect(
				normalize(stripDescription(tableRows(described, table))),
				`${table} (minus description) unaffected by description`,
			).toEqual(normalize(stripDescription(tableRows(bare, table))));
		}
		for (const table of [
			"affordance_templates",
			"action_definitions",
			"action_definition_tag",
			"outcome_templates",
			"consequence_templates",
			"consequence_frame_writes",
			"resource_definitions",
			"actors",
			"actor_spatial_locations",
			"place_nodes",
			"place_edges",
			"actor_capabilities",
			"spatial_niche_attachments",
		]) {
			expect(normalize(tableRows(described, table)), `${table} unaffected by description`).toEqual(
				normalize(tableRows(bare, table)),
			);
		}
	});

	// T5 follow-up (#1968 pattern, operator review 2026-08-04): a node's OWN
	// description is a separate opt-in field from the fireball sequence's
	// graph-level one above — proven with its own minimal place_graph rather
	// than layered onto runFireballSequence, so the "place_nodes unaffected
	// by description" assertion just above stays true for that unrelated
	// sequence (it never passes nodes[].description at all).
	it("spellkave_author_place's nodes[].description lands on that node's OWN place_nodes.description column, independent of the graph-level description", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const result = await authorPlaceToolDef.run(
			context,
			{
				bundle: "node_desc_proof",
				description: "Graph-level blurb.",
				nodes: [
					{
						id: "node_desc_proof/inn/common_room",
						name: "Common Room",
						description: "Low-beamed ceiling, smoke-stained.",
					},
					{ id: "node_desc_proof/inn/loft", name: "Loft" },
				],
				edges: [["node_desc_proof/inn/common_room", "node_desc_proof/inn/loft"]],
			},
			"call-node-desc",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const finalToml = workspace.current();
		expect(finalToml).not.toBeNull();
		const manifest = inspectManifest(finalToml ?? "").manifest as Record<string, unknown>;
		const nodes = rowByKey(manifest, "place_nodes", (r) => String(r.node_id));
		expect(nodes.get("node_desc_proof/inn/common_room")?.description).toBe(
			"Low-beamed ceiling, smoke-stained.",
		);
		// The second node omitted `description` entirely — empty, not a
		// fabricated copy of the first node's or the graph's own prose.
		expect(nodes.get("node_desc_proof/inn/loft")?.description ?? "").toBe("");
		expect(tableRows(manifest, "place_graphs")[0]?.description).toBe("Graph-level blurb.");
		// No metadata_attachments detour either, same #1968 first-class-column
		// invariant the graph-level description test above already covers.
		expect(tableRows(manifest, "metadata_attachments")).toHaveLength(0);
	});

	it("spellkave_define_behavior's description lands on the generated capability_definitions row", async () => {
		const { behaviorResult, finalToml } = await runFireballSequence(true);
		const details = behaviorResult.details as VerbResult;
		expect(details.ok).toBe(true);
		expect(details.description_gap).toBeUndefined();
		const manifest = inspectManifest(finalToml).manifest as Record<string, unknown>;
		const capability = tableRows(manifest, "capability_definitions").find(
			(r) => r.capability_id === "aoe_blast/spell/firebloom",
		);
		expect(capability?.description).toBe(
			"Firebloom: AoE blast, flat DEX save DC13 negates, 1d6 damage on a failed save.",
		);
	});
});

// ---------------------------------------------------------------------------
// 2. Ergonomics negatives — the core deliverable: errors name the offending param.
// ---------------------------------------------------------------------------

describe("ergonomics negatives — errors name the offending parameter, never a TOML line number", () => {
	it("spellkave_place_entity: a dangling entity_def names the `entity_def` param", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				nodes: [{ id: "aoe_blast/arena/center" }],
				edges: [],
			},
			"place",
		);

		await expect(
			spawnToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					entity_def: "aoe_blast/monster/nonexistent",
					at: "aoe_blast/arena/center",
				},
				"spawn",
			),
		).rejects.toThrow(/`entity_def`/);
	});

	it("spellkave_place_entity: a dangling `at` names the `at` param", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			spawnToolDef.run(
				contextWith({ workspace }),
				{ bundle: "aoe_blast", entity_def: "npc", at: "aoe_blast/nowhere" },
				"spawn",
			),
		).rejects.toThrow(/`at`/);
	});

	it("spellkave_place_*: both `at` and `placements` set is rejected, naming both shapes", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			spawnToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					entity_def: "npc",
					at: "aoe_blast/arena/center",
					placements: [{ at: "aoe_blast/arena/fringe" }],
				},
				"spawn",
			),
		).rejects.toThrow(/`placements`/);
	});

	it("spellkave_place_*: neither `at` nor `placements` set is rejected", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			spawnToolDef.run(
				contextWith({ workspace }),
				{ bundle: "aoe_blast", entity_def: "npc" },
				"spawn",
			),
		).rejects.toThrow(/`at`/);
	});

	it("spellkave_place_entity: `placements` splits ONE call across multiple nodes (FIX①, #1968)", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				nodes: [{ id: "aoe_blast/arena/center" }, { id: "aoe_blast/arena/fringe" }],
				edges: [],
			},
			"place",
		);
		const result = await spawnToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				entity_def: "npc",
				placements: [
					{ at: "aoe_blast/arena/center", count: 3 },
					{ at: "aoe_blast/arena/fringe", count: 1 },
				],
			},
			"spawn",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const toml = workspace.current();
		expect(toml).not.toBeNull();
		const manifest = inspectManifest(toml ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "entities").filter((r) => r.place_node_id === "aoe_blast/arena/center"),
		).toHaveLength(3);
		expect(
			tableRows(manifest, "entities").filter((r) => r.place_node_id === "aoe_blast/arena/fringe"),
		).toHaveLength(1);
	});

	it("spellkave_define_behavior: an unsupported effect.primitive fails loudly naming the PoC boundary", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "other",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						// biome-ignore lint/suspicious/noExplicitAny: exercising the closed-enum boundary from outside its type
						primitive: "SomeOtherPrimitive" as any,
						shape: { id: "core/area/node_ball", radius: 0 },
						write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d4" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/PoC boundary/);
	});

	it("spellkave_define_behavior: an unsupported write.primitive fails loudly naming the PoC boundary", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "other",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/node_ball", radius: 0 },
						write: {
							// biome-ignore lint/suspicious/noExplicitAny: exercising the closed-enum boundary from outside its type
							primitive: "SomeOtherWrite" as any,
							resource: "aoe_blast/hp",
							delta: "-d4",
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/PoC boundary/);
	});

	it("spellkave_define_behavior: invalid DSL in effect.write.delta maps the diagnostic to `effect.write.delta`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "broken",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					shape: { id: "core/area/node_ball", radius: 0 },
					write: {
						primitive: "ModifyResource",
						resource: "aoe_blast/hp",
						delta: "not dsl at all !!!",
					},
				},
			},
			"behavior",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(details.diagnostics?.length ?? 0).toBeGreaterThan(0);
		const mapped = details.diagnostics?.find((d) => d.param === "effect.write.delta");
		expect(mapped, JSON.stringify(details.diagnostics)).toBeDefined();
		// NOT persisted.
		expect(workspace.current()).toBe(finalToml);
	});

	it("spellkave_define_behavior: effect.write.resource must already exist — never auto-created, error names the param", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "other",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/node_ball", radius: 0 },
						write: { primitive: "ModifyResource", resource: "aoe_blast/mana", delta: "-d4" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.resource`/);
	});

	it("spellkave_define_behavior: an unsupported offered_when.reach fails loudly naming the PoC boundary", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "other",
					grant_to: entityKeys[0] as string,
					// biome-ignore lint/suspicious/noExplicitAny: exercising the closed-enum boundary from outside its type
					offered_when: { reach: "ranged" as any },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/node_ball", radius: 0 },
						write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d4" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/PoC boundary/);
	});

	it("spellkave_author_place: nodes sharing no common place_graph fails loudly naming `nodes`", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			authorPlaceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					nodes: [{ id: "aoe_blast/arena/center" }, { id: "aoe_blast/other/fringe" }],
					edges: [],
				},
				"place",
			),
		).rejects.toThrow(/`nodes`/);
	});
});

// ---------------------------------------------------------------------------
// 3. spellkave_define_resource (FIX②a, #1968) — a bare resource_definitions row.
// ---------------------------------------------------------------------------

describe("spellkave_define_resource", () => {
	it("authors a resource_definitions row and self-scaffolds the [[bundles]] header from an EMPTY workspace", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineResourceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "hp",
				display_name: "Hit Points",
				min_value: 0,
				max_value: 30,
				recovery_rule: "long_rest",
				initial_value: 30,
			},
			"resource",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const toml = workspace.current();
		expect(toml).not.toBeNull();
		const manifest = inspectManifest(toml ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "bundles").map((r) => r.bundle_id)).toContain("aoe_blast");
		const row = tableRows(manifest, "resource_definitions").find(
			(r) => r.resource_definition_id === "aoe_blast/hp",
		);
		expect(row).toMatchObject({
			resource_definition_id: "aoe_blast/hp",
			bundle_id: "aoe_blast",
			display_name: "Hit Points",
			value_kind: "int",
			min_value: 0,
			max_value: 30,
			recovery_rule: "long_rest",
			initial_value: 30,
		});
	});

	it("is idempotent against an already-scaffolded bundle — no duplicate [[bundles]] header", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const before = inspectManifest(finalToml).manifest as Record<string, unknown>;
		expect(tableRows(before, "bundles")).toHaveLength(1);

		await defineResourceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "mana",
				display_name: "Mana",
				min_value: 0,
				max_value: 10,
			},
			"resource",
		);
		const after = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(after, "bundles")).toHaveLength(1);
	});

	it("persists `description` on the generated resource_definitions row (#1968 — a first-class column, no gap)", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineResourceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "hp",
				display_name: "Hit Points",
				min_value: 0,
				max_value: 30,
				description: "The blast target's hit points.",
			},
			"resource",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(true);
		expect(details.description_gap).toBeUndefined();
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const row = tableRows(manifest, "resource_definitions").find(
			(r) => r.resource_definition_id === "aoe_blast/hp",
		);
		expect(row?.description).toBe("The blast target's hit points.");
	});

	it("tags folding (#1968 verb-UX round 2): N tags become N resource_definition_tag rows in ONE call, zero tags means zero rows", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineResourceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "hp",
				display_name: "Hit Points",
				min_value: 0,
				max_value: 30,
				tags: ["aoe_blast.core", "aoe_blast.actor_health"],
			},
			"resource",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "resource_definition_tag")
				.filter((r) => r.resource_definition_id === "aoe_blast/hp")
				.map((r) => r.tag)
				.sort(),
		).toEqual(["aoe_blast.actor_health", "aoe_blast.core"]);

		const bare = await defineResourceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "aoe_blast", id: "mana", display_name: "Mana", min_value: 0, max_value: 10 },
			"resource-no-tags",
		);
		expect((bare.details as VerbResult).ok, JSON.stringify(bare.details)).toBe(true);
		const manifestAfter = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;
		expect(
			tableRows(manifestAfter, "resource_definition_tag").filter(
				(r) => r.resource_definition_id === "aoe_blast/mana",
			),
		).toHaveLength(0);
	});

	it("workspace idempotency: a re-run with FEWER tags drops the stale ones (satellite shrink, mirrors spellkave_define_entity_type)", async () => {
		const workspace = fakeWorkspace(null);
		const params = {
			bundle: "aoe_blast",
			id: "hp",
			display_name: "Hit Points",
			min_value: 0,
			max_value: 30,
		};
		await defineResourceToolDef.run(
			contextWith({ workspace }),
			{ ...params, tags: ["aoe_blast.core", "aoe_blast.actor_health", "aoe_blast.extra"] },
			"run-1",
		);
		const second = await defineResourceToolDef.run(
			contextWith({ workspace }),
			{ ...params, tags: ["aoe_blast.core"] },
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "resource_definitions")).toHaveLength(1);
		expect(
			tableRows(manifest, "resource_definition_tag")
				.filter((r) => r.resource_definition_id === "aoe_blast/hp")
				.map((r) => r.tag),
		).toEqual(["aoe_blast.core"]);
	});
});

// ---------------------------------------------------------------------------
// 4. spellkave_lookup — offline (workspace-only) and the entity_defs read-side
//    description round trip.
// ---------------------------------------------------------------------------

describe("spellkave_query — kind-only list shape (former spellkave_lookup)", () => {
	it("is workspace-only offline (no db wired) and says so via `source`", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definitions" },
			"query",
		);
		const details = result.details as QueryListResult;
		expect(details.shape).toBe("list");
		expect(details.source).toBe("workspace");
		expect(details.items.some((i) => i.id === "aoe_blast/hp")).toBe(true);
	});

	it("economy_channel_definitions lists empty when none are authored in this fixture", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const actionClasses = (
			(
				await queryToolDef.run(
					contextWith({ workspace }),
					{ kind: "economy_channel_definitions" },
					"query",
				)
			).details as QueryListResult
		).items;
		expect(actionClasses).toEqual([]);
	});

	it("bundle/pattern filters narrow the result", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definitions", pattern: "nonexistent" },
			"query",
		);
		expect((result.details as QueryListResult).items).toHaveLength(0);
	});

	it("an unknown kind throws, naming the offending param", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			queryToolDef.run(contextWith({ workspace }), { kind: "not_a_real_kind" }, "query"),
		).rejects.toThrow(/`kind`/);
	});

	it("default list stays ids-only (no fields param)", async () => {
		const workspace = fakeWorkspace(
			renderSchemaManifest({
				schema_version: "1.0.0",
				bundles: [
					{
						bundle_id: "demo",
						display_name: "Demo",
						author: "test",
						version: "1.0.0",
						depends_on: [],
						description: "x",
					},
				],
				entities: [
					{
						bundle_id: "demo",
						entity_key: "demo/hero",
						kind: "npc",
						name: "Hero",
						place_node_id: "demo/cell",
					},
				],
			}),
		);
		const details = (
			await queryToolDef.run(contextWith({ workspace }), { kind: "entities" }, "query")
		).details as QueryListResult;
		expect(details.fields).toBeUndefined();
		expect(details.items).toEqual([{ id: "demo/hero", bundle_id: "demo" }]);
		expect(details.items[0]).not.toHaveProperty("name");
		expect(details.items[0]).not.toHaveProperty("place_node_id");
	});

	it("fields: preferred projects kind defaults (entities → who-is-where in one call)", async () => {
		const workspace = fakeWorkspace(
			renderSchemaManifest({
				schema_version: "1.0.0",
				bundles: [
					{
						bundle_id: "demo",
						display_name: "Demo",
						author: "test",
						version: "1.0.0",
						depends_on: [],
						description: "x",
					},
				],
				entities: [
					{
						bundle_id: "demo",
						entity_key: "demo/hero",
						kind: "npc",
						name: "Hero",
						place_node_id: "demo/cell_a",
						entity_def_id: "demo/hero_def",
					},
					{
						bundle_id: "demo",
						entity_key: "demo/plate",
						kind: "npc",
						name: "Plate",
						place_node_id: "demo/pressure",
						entity_def_id: "demo/plate_def",
					},
				],
			}),
		);
		const details = (
			await queryToolDef.run(
				contextWith({ workspace }),
				{ kind: "entities", fields: "preferred" },
				"query",
			)
		).details as QueryListResult;
		expect(details.fields).toBe("preferred");
		expect(details.items).toEqual([
			{
				id: "demo/hero",
				bundle_id: "demo",
				name: "Hero",
				place_node_id: "demo/cell_a",
				kind: "npc",
				entity_def_id: "demo/hero_def",
			},
			{
				id: "demo/plate",
				bundle_id: "demo",
				name: "Plate",
				place_node_id: "demo/pressure",
				kind: "npc",
				entity_def_id: "demo/plate_def",
			},
		]);
		// preferred column set is documented for agents
		expect([...(QUERY_LIST_PREFERRED_FIELDS.entities ?? [])]).toEqual([
			"name",
			"place_node_id",
			"kind",
			"entity_def_id",
		]);
	});

	it("fields: explicit array projects only requested scalars", async () => {
		const workspace = fakeWorkspace(
			renderSchemaManifest({
				schema_version: "1.0.0",
				bundles: [
					{
						bundle_id: "demo",
						display_name: "Demo",
						author: "test",
						version: "1.0.0",
						depends_on: [],
						description: "x",
					},
				],
				place_nodes: [
					{
						bundle_id: "demo",
						node_id: "demo/cell",
						local_id: "cell",
						place_graph_id: "demo/g",
						display_name: "Cell",
						substrate_id: "outdoor",
						pos_present: true,
						pos_x: 1,
						pos_y: 2,
					},
				],
			}),
		);
		const details = (
			await queryToolDef.run(
				contextWith({ workspace }),
				{ kind: "place_nodes", fields: ["display_name", "pos_x", "missing_col"] },
				"query",
			)
		).details as QueryListResult;
		expect(details.fields).toEqual(["display_name", "pos_x", "missing_col"]);
		expect(details.items).toEqual([
			{ id: "demo/cell", bundle_id: "demo", display_name: "Cell", pos_x: 1 },
		]);
	});
});

describe("spellkave_query — kind+id detail shape (#1968 definition-lookup gap, the NEW capability)", () => {
	it("returns the full authored row (including a description the list shape never surfaced) plus refs by default", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);

		await defineResourceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "mana",
				display_name: "Mana",
				min_value: 0,
				max_value: 10,
				description: "The blast's arcane reserve.",
			},
			"resource",
		);

		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definitions", id: "aoe_blast/mana" },
			"query",
		);
		const details = result.details as QueryDetailResult;
		expect(details.shape).toBe("detail");
		expect(details.found).toBe(true);
		expect(details.source).toBe("workspace");
		expect(details.row.description).toBe("The blast's arcane reserve.");
		expect(details.row.resource_definition_id).toBe("aoe_blast/mana");
		expect(details.outbound_refs).toBeDefined();
		expect(details.inbound_refs).toBeDefined();
	});

	// `entity_definitions.description` (#1968 — a first-class column, not a
	// metadata_attachments detour). None of this PoC's write verbs create an
	// `entity_definitions` (catalog) row, so this test seeds the column
	// directly to prove the READ mechanism, the honest way to prove it works
	// without inventing a write path this PoC's verbs don't have.
	it("surfaces an authored entity_definitions.description directly (read-mechanism proof, no verb write path exists yet)", async () => {
		const seeded = renderSchemaManifest({
			schema_version: "1.0.0",
			metadata: { profile: "aoe_blast" },
			bundles: [
				{
					bundle_id: "aoe_blast",
					display_name: "x",
					author: "x",
					version: "1.0.0",
					depends_on: [],
					description: "x",
				},
			],
			entity_definitions: [
				{
					entity_def_id: "aoe_blast/monster/imp",
					bundle_id: "aoe_blast",
					display_name: "Imp",
					description: "A minor devilkin used in the imp-swarm encounter.",
				},
			],
		});
		const workspace = fakeWorkspace(seeded);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "entity_definitions", id: "aoe_blast/monster/imp" },
			"query",
		);
		const details = result.details as QueryDetailResult;
		expect(details.found).toBe(true);
		expect(details.row.description).toBe("A minor devilkin used in the imp-swarm encounter.");
	});

	it("an id that does not exist reports found: false, not a throw", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definitions", id: "aoe_blast/does_not_exist" },
			"query",
		);
		expect(result.details as QueryNotFoundResult).toEqual({
			shape: "detail",
			kind: "resource_definitions",
			id: "aoe_blast/does_not_exist",
			found: false,
		});
	});

	it("`refs: 'outbound'` omits inbound_refs; `refs: 'none'` omits both", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);

		const outboundOnly = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definitions", id: "aoe_blast/hp", refs: "outbound" },
			"query",
		);
		const outboundDetails = outboundOnly.details as QueryDetailResult;
		expect(outboundDetails.outbound_refs).toBeDefined();
		expect(outboundDetails.inbound_refs).toBeUndefined();

		const none = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definitions", id: "aoe_blast/hp", refs: "none" },
			"query",
		);
		const noneDetails = none.details as QueryDetailResult;
		expect(noneDetails.outbound_refs).toBeUndefined();
		expect(noneDetails.inbound_refs).toBeUndefined();
	});

	it("a live-target row reports its outbound refs under refs 'outbound' without materialising the whole target (sk-jay0.2.34 closure-walk speed-up)", async () => {
		// `refs: "outbound"` must not build the full target manifest (the fake db has
		// only the one table, so any full-manifest read would throw on the others).
		const target = createLiveAuthorTarget({
			db: () =>
				emptyLiveDb({
					affordance_template: {
						iter: () => [
							{
								templateId: "core/inspect/affordance",
								bundleId: "core",
								nicheId: "core/inspect",
								capabilityId: "core/inspect",
								displayName: "Core Inspect",
								predicateSource: "",
								outcomeTemplateId: "core/inspect/outcome",
								rangeM: 0,
								localityClass: "",
								consumesActionClass: "",
								rechargesOn: "",
								composes: [],
								readsOccupancy: false,
								description: "",
							},
						],
					},
				}),
		});
		const result = await queryToolDef.run(
			contextWith({ target }),
			{
				kind: "affordance_templates",
				id: "core/inspect/affordance",
				target: "live",
				refs: "outbound",
			},
			"query",
		);
		const details = result.details as QueryDetailResult;
		expect(details.outbound_refs).toEqual(
			expect.arrayContaining([
				{ field: "niche_id", value: "core/inspect" },
				{ field: "capability_id", value: "core/inspect" },
				{ field: "outcome_template_id", value: "core/inspect/outcome" },
			]),
		);
		expect(details.outbound_refs?.some((r) => r.field === "template_id")).toBe(false);
		expect(details.inbound_refs).toBeUndefined();
	});

	it("`id` requires `kind` — throws naming it when omitted", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			queryToolDef.run(contextWith({ workspace }), { id: "aoe_blast/hp" }, "query"),
		).rejects.toThrow(/`kind`/);
	});
});

// Finding #9 (srd-cc finding ledger, 2026-07-26): `resource_definition_tag`/
// `capability_definition_tag`/every other `*_tag` satellite kind used to be
// COMPLETELY INVISIBLE to spellkave_query — `kind`+`id`/list dispatch only
// resolved kinds present in `ROW_KIND_NATURAL_KEY` (a single-column natural
// key), and these have a composite one (parent field + "tag") instead. This
// closes that gap generically (`ROW_KIND_COMPOSITE_KEY`, `compositeQueryId`/
// `parseCompositeQueryId`), proven here against a workspace-authored tag
// satellite (the same `resource_definition_tag` shape the srd-cc offline
// author-tool test proves against COMMITTED fixtures, not a scratch
// workspace — see that package's `fixtures-author-tool.test.ts`).
describe("spellkave_query — composite-key satellite kinds (finding #9, the `*_tag` gap)", () => {
	async function seedTaggedResource(): Promise<{ workspace: ReturnType<typeof fakeWorkspace> }> {
		const workspace = fakeWorkspace(null);
		const result = await defineResourceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "hp",
				display_name: "Hit Points",
				min_value: 0,
				max_value: 30,
				tags: ["aoe_blast.core", "aoe_blast.actor_health"],
			},
			"resource",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		return { workspace };
	}

	it("lists every resource_definition_tag row, id = '::'-joined {resource_definition_id, tag}", async () => {
		const { workspace } = await seedTaggedResource();
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definition_tag" },
			"query",
		);
		const details = result.details as QueryListResult;
		expect(details.shape).toBe("list");
		expect(details.items.map((i) => i.id).sort()).toEqual([
			"aoe_blast/hp::aoe_blast.actor_health",
			"aoe_blast/hp::aoe_blast.core",
		]);
		expect(details.items.every((i) => i.bundle_id === "aoe_blast")).toBe(true);
	});

	it("`pattern` narrows composite-id list results the same as a natural-key kind", async () => {
		const { workspace } = await seedTaggedResource();
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definition_tag", pattern: "aoe_blast.actor_health" },
			"query",
		);
		const details = result.details as QueryListResult;
		expect(details.items).toHaveLength(1);
		expect(details.items[0]?.id).toBe("aoe_blast/hp::aoe_blast.actor_health");
	});

	it("kind+id detail resolves ONE composite-keyed row, outbound refs excluding BOTH key fields (not just one)", async () => {
		const { workspace } = await seedTaggedResource();
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definition_tag", id: "aoe_blast/hp::aoe_blast.core" },
			"query",
		);
		const details = result.details as QueryDetailResult;
		expect(details.found).toBe(true);
		expect(details.source).toBe("workspace");
		expect(details.row).toMatchObject({
			resource_definition_id: "aoe_blast/hp",
			tag: "aoe_blast.core",
			bundle_id: "aoe_blast",
		});
		// Neither `resource_definition_id` nor `tag` count as a ref — both are
		// this row's OWN composite identity, never a pointer elsewhere.
		expect(details.outbound_refs?.some((r) => r.field === "resource_definition_id")).toBe(false);
		expect(details.outbound_refs?.some((r) => r.field === "tag")).toBe(false);
		// Inbound-ref discovery is not generalized to composite-keyed kinds yet
		// (see QueryDetailResult.inbound_refs' own doc comment) — absent, never
		// a misleadingly-empty array standing in for "computed, none found".
		expect(details.inbound_refs).toBeUndefined();
	});

	// `@spellkave/world-author` no longer seeds ANY ref-tag family vocabulary
	// (2026-07-27 rename, `ref-tags.ts`'s header) — the family list is CALLER-
	// SUPPLIED, and `resolveQueryDetail`'s composite-key detail path (this
	// file's own `authoring-verbs.ts`) now derives it from the resolved
	// bundle's own manifest via `manifestTagPrefixFamilies`
	// (`tag-vocabulary-declaration` change, Slice A task 2.2/2.3) — a bundle
	// that hasn't declared a `[[bundle.tag_prefixes]]` ref-semantics entry
	// still gets an empty family list, exactly the prior zero-default
	// behavior. The next two tests prove that unchanged no-declaration case;
	// the one after proves a manifest-DECLARED family now resolves through
	// `spellkave_query` with no caller-supplied list at all (the gap those
	// two tests used to document); the last proves `refTagOutboundRefs`
	// itself still accepts a hand-supplied family too (exactly how a content
	// package like `@spellkave/srd-cc` uses it today, bypassing the tool).

	it("kind+id detail carries NO ref-tag outbound ref for a resolvable 'ns.governs.<code>' tag when the bundle declares no tag_prefixes", async () => {
		const { workspace } = await seedTaggedResource(); // authors resource_definitions "aoe_blast/hp"
		const capabilityResult = await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "skill/test",
				actor_kind: "entity",
				description: "A test skill governed by the seeded ability resource.",
				tags: ["skill", "ns.governs.hp"],
			},
			"capability",
		);
		expect(
			(capabilityResult.details as VerbResult).ok,
			JSON.stringify(capabilityResult.details),
		).toBe(true);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "capability_definition_tag", id: "aoe_blast/skill/test::ns.governs.hp" },
			"query",
		);
		const details = result.details as QueryDetailResult;
		expect(details.found, JSON.stringify(result.details)).toBe(true);
		// The bare tag field itself is excluded as identity, and no resolved
		// ref appears alongside it either, even though "hp" is a real
		// resource_definitions id this workspace just authored: the "aoe_blast"
		// bundle declares no `tag_prefixes` entry covering "ns.governs.", so
		// `manifestTagPrefixFamilies` yields nothing for this manifest.
		expect(details.outbound_refs?.some((r) => r.field.startsWith("tag:"))).toBe(false);
	});

	it("kind+id detail resolves a 'ns.governs.<code>' tag through spellkave_query with NO caller-supplied family, once the bundle declares a matching tag_prefixes entry", async () => {
		const { workspace } = await seedTaggedResource(); // authors resource_definitions "aoe_blast/hp"
		// Deliberate `[[bundles]]` header declaring the ref-typed prefix
		// (`tag-vocabulary-declaration` change, Slice A) — the generic
		// write_rows escape hatch, mirroring `defineBundleToolDef`'s own doc
		// comment ("the generic spellkave_write_rows escape hatch (kind:
		// 'bundles') remains available for raw row access").
		const bundleResult = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				kind: "bundles",
				rows: [
					{
						bundle_id: "aoe_blast",
						display_name: "AoE Blast",
						author: "spellkave",
						version: "1.0.0",
						depends_on: [],
						tag_prefixes: [
							{
								prefix: "ns.governs",
								target_kind: "resource_definitions",
								natural_key_field: "resource_definition_id",
							},
						],
					},
				],
			},
			"bundle",
		);
		expect((bundleResult.details as VerbResult).ok, JSON.stringify(bundleResult.details)).toBe(
			true,
		);
		const capabilityResult = await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "skill/test",
				actor_kind: "entity",
				description: "A test skill governed by the seeded ability resource.",
				tags: ["skill", "ns.governs.hp"],
			},
			"capability",
		);
		expect(
			(capabilityResult.details as VerbResult).ok,
			JSON.stringify(capabilityResult.details),
		).toBe(true);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "capability_definition_tag", id: "aoe_blast/skill/test::ns.governs.hp" },
			"query",
		);
		const details = result.details as QueryDetailResult;
		expect(details.found, JSON.stringify(result.details)).toBe(true);
		expect(details.outbound_refs).toContainEqual({
			field: "tag:ns.governs",
			value: "aoe_blast/hp",
		});
	});

	it("traverses an exact tag-value reference through the manifest declaration, never a vocabulary fallback", async () => {
		const workspace = fakeWorkspace(
			renderSchemaManifest({
				schema_version: "1.0.0",
				metadata: { profile: "tag-value-traversal" },
				bundles: [
					{
						bundle_id: "demo",
						display_name: "Demo",
						author: "spellkave",
						version: "1.0.0",
						depends_on: [],
						description: "Exact vocabulary traversal proof.",
						tag_prefixes: [
							{
								prefix: "demo.creature_type",
								target_kind: "tag_value_definitions",
								natural_key_field: "tag",
							},
						],
					},
				],
				tag_value_definitions: [
					{
						tag: "demo.creature_type.humanoid",
						prefix: "demo.creature_type",
						bundle_id: "demo",
						description: "Humanoid creature type.",
					},
				],
				capability_definitions: [
					{
						capability_id: "demo/recognize_humanoid",
						bundle_id: "demo",
						actor_kind: "entity",
						display_name: "Recognize Humanoid",
						description: "Recognition capability.",
						default_visibility: "Public",
					},
				],
				capability_definition_tag: [
					{
						capability_id: "demo/recognize_humanoid",
						tag: "demo.creature_type.humanoid",
						bundle_id: "demo",
					},
				],
			}),
		);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{
				kind: "capability_definition_tag",
				id: "demo/recognize_humanoid::demo.creature_type.humanoid",
			},
			"tag-value-reference",
		);
		const details = result.details as QueryDetailResult;
		expect(details.found, JSON.stringify(result.details)).toBe(true);
		expect(details.outbound_refs).toContainEqual({
			field: "tag:demo.creature_type",
			value: "demo.creature_type.humanoid",
		});
	});

	it("kind+id detail on an unresolvable 'ns.governs.<code>' tag carries no outbound ref for it either way (dangling-ref-tag's job to flag, not this)", async () => {
		const { workspace } = await seedTaggedResource();
		const capabilityResult = await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "skill/typo",
				actor_kind: "entity",
				description: "A test skill with a typo'd governing tag.",
				tags: ["ns.governs.not_a_real_resource"],
			},
			"capability",
		);
		expect(
			(capabilityResult.details as VerbResult).ok,
			JSON.stringify(capabilityResult.details),
		).toBe(true);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{
				kind: "capability_definition_tag",
				id: "aoe_blast/skill/typo::ns.governs.not_a_real_resource",
			},
			"query",
		);
		const details = result.details as QueryDetailResult;
		expect(details.found, JSON.stringify(result.details)).toBe(true);
		expect(details.outbound_refs?.some((r) => r.field.startsWith("tag:"))).toBe(false);
	});

	it("refTagOutboundRefs itself still resolves a 'ns.governs.<code>' tag when a caller supplies its own family (the mechanism `spellkave_query` doesn't yet drive)", async () => {
		const { workspace } = await seedTaggedResource(); // authors resource_definitions "aoe_blast/hp"
		await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "skill/test",
				actor_kind: "entity",
				description: "A test skill governed by the seeded ability resource.",
				tags: ["skill", "ns.governs.hp"],
			},
			"capability",
		);
		const detail = (
			await queryToolDef.run(
				contextWith({ workspace }),
				{ kind: "capability_definition_tag", id: "aoe_blast/skill/test::ns.governs.hp" },
				"query",
			)
		).details as QueryDetailResult;
		expect(detail.found).toBe(true);
		const family: RefTagFamily = {
			prefix: "ns.governs.",
			targetKind: "resource_definitions",
			naturalKeyField: "resource_definition_id",
		};
		// A minimal manifest carrying just the target table `resolveRefTagValue`
		// resolves against — the row itself (`detail.row`) comes from the real
		// workspace query above.
		const refsManifest = { resource_definitions: [{ resource_definition_id: "aoe_blast/hp" }] };
		expect(
			refTagOutboundRefs(refsManifest, detail.row as Record<string, unknown>, [family]),
		).toContainEqual({ field: "tag:ns.governs", value: "aoe_blast/hp" });
	});

	it("kind+id detail reports not-found for a well-formed composite id that doesn't resolve", async () => {
		const { workspace } = await seedTaggedResource();
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definition_tag", id: "aoe_blast/hp::not_a_real_tag" },
			"query",
		);
		expect((result.details as QueryNotFoundResult).found).toBe(false);
	});

	it("a malformed composite id (wrong part count) throws naming `id`, not a silent wrong split", async () => {
		const { workspace } = await seedTaggedResource();
		await expect(
			queryToolDef.run(
				contextWith({ workspace }),
				{ kind: "resource_definition_tag", id: "aoe_blast/hp" },
				"query",
			),
		).rejects.toThrow(/`id`/);
	});
});

describe("spellkave_query — no-`kind` summary shape (former spellkave_manifest_inspect)", () => {
	it("summarizes bundle ids and a row-kind -> count map for the current scratch bundle", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await queryToolDef.run(contextWith({ workspace }), {}, "query");
		const summary = result.details as QuerySummaryResult;
		expect(summary.shape).toBe("summary");
		expect(summary.bundle_ids).toContain("aoe_blast");
		expect(summary.row_kinds.resource_definitions).toBeGreaterThan(0);
	});

	it("an empty workspace returns an empty summary with guidance to connect or configure a target", async () => {
		const workspace = fakeWorkspace(null);
		const result = await queryToolDef.run(contextWith({ workspace }), {}, "query");
		const summary = result.details as QuerySummaryResult;
		expect(summary).toMatchObject({
			shape: "summary",
			source: "workspace",
			bundle_ids: [],
			row_kinds: {},
		});
		expect(summary.guidance).toContain("spellkave_connect");
		expect(summary.guidance).toContain("author.target");
		expect(summary.guidance).toContain("spellkave_config");
		expect(summary.guidance).toContain(".spellkave/config.toml");
		expect(summary.guidance).toContain("SPELLKAVE_AUTHOR_LOCAL_TARGET");
	});

	it("includes guidance when the scratch file has only its schema header", async () => {
		const workspace = fakeWorkspace(renderSchemaManifest({ schema_version: "1.0.0" }));
		const result = await queryToolDef.run(contextWith({ workspace }), {}, "query");
		expect((result.details as QuerySummaryResult).guidance).toContain("author.target");
	});

	it("includes guidance for list results when offline and no target is configured", async () => {
		const workspace = fakeWorkspace(null);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ kind: "resource_definitions" },
			"query",
		);
		const list = result.details as QueryListResult;
		expect(list).toMatchObject({
			shape: "list",
			source: "workspace",
			kind: "resource_definitions",
			items: [],
		});
		expect(list.guidance).toContain("sk config set --project author.target");
	});

	it('does not include guidance for explicit `target: "workspace"`, even when empty', async () => {
		const workspace = fakeWorkspace(null);
		const result = await queryToolDef.run(
			contextWith({ workspace }),
			{ target: "workspace", kind: "resource_definitions" },
			"query",
		);
		const list = result.details as QueryListResult;
		expect(list).toMatchObject({
			shape: "list",
			source: "workspace",
			kind: "resource_definitions",
		});
		expect(list.guidance).toBeUndefined();
	});

	it("map_graph includes guidance when no rows and no configured target is available", async () => {
		const workspace = fakeWorkspace(null);
		const result = await mapGraphToolDef.run(contextWith({ workspace }), {}, "map-graph", {
			node: nodeToolCapability,
		});
		const text = result.content.find(
			(block): block is { type: "text"; text: string } => block.type === "text",
		)?.text;
		expect(text).toContain("spellkave_connect");
		const details = result.details as { guidance?: string; inventory: string };
		expect(details.guidance).toContain("sk config set --project author.target");
		expect(details.inventory).toContain(".spellkave/config.toml");
	});

	it('map_graph does not add guidance for explicit `target: "workspace"`', async () => {
		const workspace = fakeWorkspace(null);
		const result = await mapGraphToolDef.run(
			contextWith({ workspace }),
			{ target: "workspace" },
			"map-graph",
			{ node: nodeToolCapability },
		);
		const details = result.details as { guidance?: string };
		expect(details.guidance).toBeUndefined();
	});

	// Finding #42 (srd-cc finding ledger, 2026-07-28): once a `target`/
	// `extra` source is wired, the summary's row-kind -> count map used to
	// silently drop every `ROW_KIND_COMPOSITE_KEY` kind (the `*_tag`
	// satellites) — even though they were independently listable/detailable
	// (`resolveQueryList`/`resolveQueryDetail`) and the workspace-only fast
	// path already counted them. `summaryAugmentableRowKinds` closes this.
	it("a wired target's composite-key (`*_tag`) rows appear in the summary's row-kind -> count map, alongside natural-key kinds", async () => {
		const workspace = fakeWorkspace(null);
		const target = fakeTarget({
			kind: "local",
			lookup: (rowKind) => {
				if (rowKind === "capability_definition_tag") {
					return [
						{
							capability_id: "other_bundle/firebloom",
							tag: "skill",
							bundle_id: "other_bundle",
							source: "manifest",
						},
						{
							capability_id: "other_bundle/firebloom",
							tag: "ns.governs.mana",
							bundle_id: "other_bundle",
							source: "manifest",
						},
					];
				}
				if (rowKind === "resource_definitions") {
					return [
						{
							resource_definition_id: "other_bundle/mana",
							bundle_id: "other_bundle",
							display_name: "Mana",
							value_kind: "int",
							min_value: 0,
							max_value: 10,
						},
					];
				}
				return [];
			},
		});
		const result = await queryToolDef.run(contextWith({ workspace, target }), {}, "query");
		const summary = result.details as QuerySummaryResult;
		expect(summary.shape).toBe("summary");
		expect(summary.row_kinds.capability_definition_tag).toBe(2);
		expect(summary.row_kinds.resource_definitions).toBe(1);
	});

	it("a target's composite-key rows are counted per-`bundle` scope too, not just the unscoped summary", async () => {
		const workspace = fakeWorkspace(null);
		const target = fakeTarget({
			kind: "local",
			lookup: (rowKind) => {
				if (rowKind !== "capability_definition_tag") return [];
				return [
					{
						capability_id: "aoe_blast/firebloom",
						tag: "skill",
						bundle_id: "aoe_blast",
						source: "manifest",
					},
					{
						capability_id: "other_bundle/firebloom",
						tag: "skill",
						bundle_id: "other_bundle",
						source: "manifest",
					},
				];
			},
		});
		const result = await queryToolDef.run(
			contextWith({ workspace, target }),
			{ bundle: "aoe_blast" },
			"query",
		);
		const summary = result.details as QuerySummaryResult;
		expect(summary.row_kinds.capability_definition_tag).toBe(1);
	});
});

// ---------------------------------------------------------------------------
// #1983: the SHAPE half — what a row may contain, beside which rows exist.
// Retires `spellkave-author schema manifest`, whose only form was a 112 KB
// whole-schema dump.
// ---------------------------------------------------------------------------

describe("spellkave_query — schema shape (retires `spellkave-author schema manifest`)", () => {
	const emptyContext = () => contextWith({ workspace: fakeWorkspace(null) });

	it("describes ONE row kind's fields, natural key, and required set", async () => {
		const result = await queryToolDef.run(
			emptyContext(),
			{ schema: true, kind: "capability_definitions" },
			"query",
		);
		const schema = result.details as QuerySchemaKindResult;

		expect(schema.shape).toBe("schema");
		expect(schema.found).toBe(true);
		expect(schema.natural_key).toBe("capability_id");
		expect(schema.required).toContain("actor_kind");
		expect(Object.keys(schema.fields)).toContain("default_visibility");
	});

	it("exposes exact tag-value definitions through schema metadata as a generic keyed row kind", async () => {
		const result = await queryToolDef.run(
			emptyContext(),
			{ schema: true, kind: "tag_value_definitions" },
			"query",
		);
		const schema = result.details as QuerySchemaKindResult;

		expect(schema).toMatchObject({
			shape: "schema",
			kind: "tag_value_definitions",
			found: true,
			natural_key: "tag",
		});
		expect(schema.required).toEqual(
			expect.arrayContaining(["tag", "prefix", "bundle_id", "description"]),
		);
	});

	it("writes, lists, and details exact tag-value definitions through generic row-kind paths", async () => {
		const workspace = fakeWorkspace(
			renderSchemaManifest({
				schema_version: "1.0.0",
				metadata: { profile: "tag-value-query" },
				bundles: [
					{
						bundle_id: "demo",
						display_name: "Demo",
						author: "spellkave",
						version: "1.0.0",
						depends_on: [],
						description: "Exact vocabulary query proof.",
						tag_prefixes: [
							{
								prefix: "demo.creature_type",
								target_kind: "tag_value_definitions",
								natural_key_field: "tag",
							},
						],
					},
				],
			}),
		);
		const write = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "demo",
				kind: "tag_value_definitions",
				rows: [
					{
						tag: "demo.creature_type.humanoid",
						prefix: "demo.creature_type",
						bundle_id: "demo",
						description: "Humanoid creature type.",
					},
				],
			},
			"tag-value-definition",
		);
		expect((write.details as VerbResult).ok, JSON.stringify(write.details)).toBe(true);

		const list = (
			await queryToolDef.run(
				contextWith({ workspace }),
				{ kind: "tag_value_definitions" },
				"tag-value-list",
			)
		).details as QueryListResult;
		expect(list.items).toEqual([{ id: "demo.creature_type.humanoid", bundle_id: "demo" }]);

		const detail = (
			await queryToolDef.run(
				contextWith({ workspace }),
				{ kind: "tag_value_definitions", id: "demo.creature_type.humanoid" },
				"tag-value-detail",
			)
		).details as QueryDetailResult;
		expect(detail.row).toMatchObject({
			tag: "demo.creature_type.humanoid",
			prefix: "demo.creature_type",
			bundle_id: "demo",
			description: "Humanoid creature type.",
		});
	});

	// The reason this is a per-kind ask rather than a dump: one kind is ~1.5 KB
	// against ~112 KB for the whole schema. A tool that could only answer the
	// broad question would be unusable inside a context window.
	it("stays a slice, not a dump", async () => {
		const result = await queryToolDef.run(
			emptyContext(),
			{ schema: true, kind: "capability_definitions" },
			"query",
		);
		expect(JSON.stringify(result.details).length).toBeLessThan(5_000);
	});

	it("without a kind, returns the row-kind vocabulary and marks which are listable", async () => {
		const result = await queryToolDef.run(emptyContext(), { schema: true }, "query");
		const index = result.details as QuerySchemaIndexResult;

		expect(index.shape).toBe("schema");
		// Schema knows every row kind; only those with a single-column natural
		// key can also be addressed by `id`/`pattern`.
		expect(index.kinds.length).toBeGreaterThan(index.kinds.filter((k) => k.queryable).length);
		const queryable = index.kinds.find((k) => k.kind === "capability_definitions");
		expect(queryable).toEqual({
			kind: "capability_definitions",
			queryable: true,
			natural_key: "capability_id",
		});
	});

	// Finding #9 (srd-cc finding ledger, 2026-07-26): a `*_tag` satellite
	// kind has no SINGLE natural key, but it does have an ordered composite
	// one (parent field + "tag") — reported as `composite_key`, and now
	// listable/detailable too (the row-listing half used to reject these
	// kinds outright; see the sibling describe blocks below for the
	// list/detail round trip this schema-level capability enables).
	it("describes a kind with a composite (not single) natural key — queryable via composite_key", async () => {
		const result = await queryToolDef.run(
			emptyContext(),
			{ schema: true, kind: "action_definition_tag" },
			"query",
		);
		const schema = result.details as QuerySchemaKindResult;

		expect(schema.found).toBe(true);
		expect(schema.natural_key).toBeUndefined();
		expect(schema.composite_key).toEqual(["action_id", "tag"]);
		expect(schema.required).toContain("tag");

		const index = (await queryToolDef.run(emptyContext(), { schema: true }, "query"))
			.details as QuerySchemaIndexResult;
		expect(index.kinds.find((k) => k.kind === "action_definition_tag")).toEqual({
			kind: "action_definition_tag",
			queryable: true,
			composite_key: ["action_id", "tag"],
		});

		// ...and the row-listing half no longer rejects it outright (empty
		// workspace -> empty list, not a throw).
		const list = (
			await queryToolDef.run(emptyContext(), { kind: "action_definition_tag" }, "query")
		).details as QueryListResult;
		expect(list.items).toEqual([]);
	});

	// A kind with NEITHER a single nor a composite key can't be listed at
	// all — `object_state` (a real manifest row kind, not folded into either
	// key table) stays the genuine negative example.
	it("describes a kind with no key of either shape — genuinely not queryable", async () => {
		const result = await queryToolDef.run(
			emptyContext(),
			{ schema: true, kind: "object_state" },
			"query",
		);
		const schema = result.details as QuerySchemaKindResult;

		expect(schema.found).toBe(true);
		expect(schema.natural_key).toBeUndefined();
		expect(schema.composite_key).toBeUndefined();

		await expect(
			queryToolDef.run(emptyContext(), { kind: "object_state", id: "x" }, "query"),
		).rejects.toThrow(/unknown kind/);
	});

	it("reports an unknown kind as a failure while offering the known ones", async () => {
		const result = await queryToolDef.run(
			emptyContext(),
			{ schema: true, kind: "not_a_row_kind" },
			"query",
		);
		const miss = result.details as QuerySchemaNotFoundResult;

		expect(miss.found).toBe(false);
		expect(miss.ok).toBe(false);
		expect(miss.kinds.length).toBeGreaterThan(0);
	});

	it("consults no source — the shape of a row kind is the same everywhere", async () => {
		// No workspace content, no target, no db: still answers in full.
		const result = await queryToolDef.run(
			emptyContext(),
			{ schema: true, kind: "capability_definitions", target: "live" },
			"query",
		);
		// `target: "live"` would throw on any row-reading shape (nothing is wired).
		expect((result.details as QuerySchemaKindResult).found).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// #1968 combat-sim finding A1: `action_class` has NO default (Rust
// `action_definition_tag.tag` is a required String) — omitting it used to
// silently author a `tag: undefined` row, corrupting the workspace and
// surfacing only at the NEXT call as an opaque wasm-level parse error naming
// neither the offending call nor `action_class`. A graceful named-param
// error at call time closes the gap: no wasm-level failure, ever.
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — A1: action_class has no default", () => {
	it("omitting action_class (and tags) throws a named-param error, never a corrupt row", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const paramsWithoutActionClass: Record<string, unknown> = {
			bundle: "aoe_blast",
			id: "no_action_class",
			grant_to: entityKeys[0] as string,
			offered_when: { reach: "same_node" },
			effect: {
				primitive: "ForEachActorInRadius",
				shape: { id: "core/area/node_ball", radius: 0 },
				write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d4" },
			},
		};
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				// biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard from outside TypeBox's static type (a caller that bypasses/skips the JSON Schema, e.g. a raw script)
				paramsWithoutActionClass as any,
				"behavior",
			),
		).rejects.toThrow(/action_class is required.*offending param is `action_class`/s);
		// The workspace must be BYTE-UNCHANGED — no partial/corrupt row landed.
		expect(workspace.current()).toBe(finalToml);
	});

	it("an empty-string action_class is treated the same as omitted (throws, never authors a blank tag)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "blank_action_class",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/node_ball", radius: 0 },
						write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d4" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`action_class`/);
	});

	it("action_class omitted but `tags` set is VALID — `tags` fully substitutes for it", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const paramsWithTagsOnly: Record<string, unknown> = {
			bundle: "aoe_blast",
			id: "tags_only",
			grant_to: entityKeys[0] as string,
			offered_when: { reach: "same_node" },
			tags: ["aoe_blast.spell", "aoe_blast.fire"],
			effect: {
				primitive: "ForEachActorInRadius",
				shape: { id: "core/area/node_ball", radius: 0 },
				write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d4" },
			},
		};
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			// biome-ignore lint/suspicious/noExplicitAny: `action_class` genuinely omitted — `tags` covers it
			paramsWithTagsOnly as any,
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const actionTags = tableRows(manifest, "action_definition_tag").filter(
			(r) => r.action_id === "aoe_blast/cast_tags_only",
		);
		expect(actionTags.map((r) => r.tag).sort()).toEqual(["aoe_blast.fire", "aoe_blast.spell"]);
	});
});

// ---------------------------------------------------------------------------
// #1968 combat-sim finding B4: `grant_to` had no multi-actor grant param —
// "author once, grant twice" (two mechanically-identical monsters sharing
// one scimitar) needed a SECOND spellkave_write_rows call on
// actor_capabilities. `grant_to: string | string[]` closes it: the
// capability/action/affordance/outcome/consequence cluster is still
// authored exactly ONCE, but every entity_key in the array gets its OWN
// actor_capabilities grant + spatial_niche_attachments row.
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — B4: multi-actor grant_to", () => {
	async function twoCasterWorkspace() {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		await authorPlaceToolDef.run(
			context,
			{
				bundle: "goblin_camp",
				nodes: [{ id: "goblin_camp/a" }, { id: "goblin_camp/b" }],
				edges: [],
			},
			"place",
		);
		const spawnA = await spawnToolDef.run(
			context,
			{
				bundle: "goblin_camp",
				entity_def: "npc",
				at: "goblin_camp/a",
				count: 1,
				key_prefix: "goblin_a",
			},
			"spawn-a",
		);
		const spawnB = await spawnToolDef.run(
			context,
			{
				bundle: "goblin_camp",
				entity_def: "npc",
				at: "goblin_camp/b",
				count: 1,
				key_prefix: "goblin_b",
			},
			"spawn-b",
		);
		const casterA = ((spawnA.details as VerbResult).entity_keys as string[])[0] as string;
		const casterB = ((spawnB.details as VerbResult).entity_keys as string[])[0] as string;
		await defineResourceToolDef.run(
			context,
			{
				bundle: "goblin_camp",
				id: "hp",
				display_name: "Hit Points",
				min_value: 0,
				max_value: 10,
				recovery_rule: "long_rest",
				initial_value: 10,
			},
			"resource",
		);
		return { workspace, context, casterA, casterB };
	}

	it("an array grant_to authors the capability/action/affordance/outcome cluster exactly ONCE, with ONE actor_capabilities + spatial_niche_attachments row PER entity_key", async () => {
		const { workspace, context, casterA, casterB } = await twoCasterWorkspace();
		const result = await defineBehaviorToolDef.run(
			context,
			{
				bundle: "goblin_camp",
				id: "scimitar",
				grant_to: [casterA, casterB],
				offered_when: { reach: "same_node" },
				action_class: "weapon",
				effect: {
					primitive: "ForEachActorInRadius",
					shape: { id: "core/area/node_ball", radius: 0 },
					per_target_gate: "",
					write: { primitive: "ModifyResource", resource: "goblin_camp/hp", delta: "-1" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		// Exactly ONE capability/action/affordance/outcome — never duplicated per grantee.
		expect(tableRows(manifest, "capability_definitions")).toHaveLength(1);
		expect(tableRows(manifest, "action_definitions")).toHaveLength(1);
		expect(tableRows(manifest, "affordance_templates")).toHaveLength(1);
		expect(tableRows(manifest, "outcome_templates")).toHaveLength(1);
		const capId = "goblin_camp/spell/scimitar";
		const grants = tableRows(manifest, "actor_capabilities").filter(
			(r) => r.capability_id === capId,
		);
		expect(grants.map((r) => r.actor_entity_key).sort()).toEqual([casterA, casterB].sort());
		const attachments = tableRows(manifest, "spatial_niche_attachments").filter(
			(r) => r.niche_id === `capability:${capId}`,
		);
		// Each caster is at a DIFFERENT node — both attachments must be present,
		// resolved independently (never assumed to share the primary's node).
		expect(attachments.map((r) => r.place_node_id).sort()).toEqual(
			["goblin_camp/a", "goblin_camp/b"].sort(),
		);
	});

	it("a bare string grant_to is unaffected (single grant, byte-identical to before B4)", async () => {
		const { workspace, context, casterA } = await twoCasterWorkspace();
		const result = await defineBehaviorToolDef.run(
			context,
			{
				bundle: "goblin_camp",
				id: "dagger",
				grant_to: casterA,
				offered_when: { reach: "same_node" },
				action_class: "weapon",
				effect: {
					primitive: "ForEachActorInRadius",
					shape: { id: "core/area/node_ball", radius: 0 },
					per_target_gate: "",
					write: { primitive: "ModifyResource", resource: "goblin_camp/hp", delta: "-1" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const capId = "goblin_camp/spell/dagger";
		const grants = tableRows(manifest, "actor_capabilities").filter(
			(r) => r.capability_id === capId,
		);
		expect(grants).toHaveLength(1);
		expect(grants[0]?.actor_entity_key).toBe(casterA);
	});

	it("shrink: re-authoring the SAME bundle+id with FEWER entity_keys clears the dropped actor's grant + attachment rows (clear-under-parent discipline)", async () => {
		const { workspace, context, casterA, casterB } = await twoCasterWorkspace();
		const params = {
			bundle: "goblin_camp",
			id: "scimitar",
			offered_when: { reach: "same_node" as const },
			action_class: "weapon",
			effect: {
				primitive: "ForEachActorInRadius" as const,
				shape: { id: "core/area/node_ball" as const, radius: 0 },
				per_target_gate: "",
				write: { primitive: "ModifyResource" as const, resource: "goblin_camp/hp", delta: "-1" },
			},
		};
		await defineBehaviorToolDef.run(
			context,
			{ ...params, grant_to: [casterA, casterB] },
			"behavior-full",
		);
		const shrunk = await defineBehaviorToolDef.run(
			context,
			{ ...params, grant_to: [casterA] },
			"behavior-shrunk",
		);
		expect((shrunk.details as VerbResult).ok, JSON.stringify(shrunk.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const capId = "goblin_camp/spell/scimitar";
		const grants = tableRows(manifest, "actor_capabilities").filter(
			(r) => r.capability_id === capId,
		);
		expect(grants.map((r) => r.actor_entity_key)).toEqual([casterA]);
		const attachments = tableRows(manifest, "spatial_niche_attachments").filter(
			(r) => r.niche_id === `capability:${capId}`,
		);
		// casterB's node (goblin_camp/b) attachment must be GONE, not merely
		// un-referenced — the niche-scoped clear removes the WHOLE prior set
		// before the shrunk set is re-pushed.
		expect(attachments.map((r) => r.place_node_id)).toEqual(["goblin_camp/a"]);
	});

	it("grant_to: [] is rejected, naming the offending param", async () => {
		const { context } = await twoCasterWorkspace();
		await expect(
			defineBehaviorToolDef.run(
				context,
				{
					bundle: "goblin_camp",
					id: "empty_grant",
					grant_to: [],
					offered_when: { reach: "same_node" },
					action_class: "weapon",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/node_ball", radius: 0 },
						per_target_gate: "",
						write: { primitive: "ModifyResource", resource: "goblin_camp/hp", delta: "-1" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`grant_to`/);
	});
});

// ---------------------------------------------------------------------------
// 5. spellkave_define_behavior's `cost` knob (unused by the fireball itself,
//    but part of the closed param shape — a smoke test of the auto-create path).
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — cost.pool auto-creates a resource_definitions row when new (generic PoC defaults)", () => {
	it("creates the pool with generic bounds and debits it on the last frame_write ordinal", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "sparkbolt",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				cost: { pool: "aoe_blast/spell_slot_1", amount: 1 },
				effect: {
					primitive: "ForEachActorInRadius",
					shape: { id: "core/area/node_ball", radius: 0 },
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d4" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const toml = workspace.current();
		expect(toml).not.toBeNull();
		const manifest = inspectManifest(toml ?? "").manifest as Record<string, unknown>;
		const pool = tableRows(manifest, "resource_definitions").find(
			(r) => r.resource_definition_id === "aoe_blast/spell_slot_1",
		);
		expect(pool).toBeDefined();
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_sparkbolt/success",
		);
		expect(frameWrites).toHaveLength(2);
		expect(
			frameWrites.some((r) => JSON.stringify(r.frame_write).includes("aoe_blast/spell_slot_1")),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 5b. spellkave_define_behavior — US9 VERB EXPANSION (#1968): effect.write.
//     primitive gains 'Spawn' (Brief 26 EffectPrimitive::Spawn) and 'Inscribe'
//     (the raw FrameWriteOp::Inscribe trace idiom), plus offered_when.target
//     ('self'|'place') — the "relieve yourself on the ground" acceptance
//     surface. Primitive names/shapes verified against
//     archive/world-fixtures/srd/base/summon.toml (find_familiar) and
//     packages/spellkave-mechanics/fixtures/core/base/affordances.toml (core/mark/pickup/drop).
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — US9 VERB EXPANSION: Spawn + Inscribe + offered_when.target (#1968)", () => {
	async function seedPuddleEntityType(workspace: AuthorWorkspace) {
		const result = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "item/puddle",
				display_name: "Puddle",
				description: "A small, harmless puddle left on the ground.",
			},
			"entity-type",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	}

	it("target: 'place' + Spawn instantiates the entity_def at the actor's own node, no cost required", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedPuddleEntityType(workspace);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "relieve",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node", target: "place" },
				action_class: "always_available",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "Spawn", entity_def: "aoe_blast/item/puddle" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const toml = workspace.current();
		expect(toml).not.toBeNull();
		const manifest = inspectManifest(toml ?? "").manifest as Record<string, unknown>;
		const action = tableRows(manifest, "action_definitions").find(
			(r) => r.action_id === "aoe_blast/cast_relieve",
		);
		expect(action?.self_eligible).toBe(false);
		const effect = tableRows(manifest, "effect_definitions").find((r) =>
			String(r.effect_def_id).includes("cast_relieve"),
		);
		expect(effect?.primitives_csv).toBe("Spawn");
		expect(String(effect?.parameters_schema_json)).toContain("aoe_blast/item/puddle");
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_relieve/success",
		);
		expect(frameWrites).toHaveLength(0);
	});

	it("target: 'place' + Inscribe writes a bare trace at the actor's own location, no companion definition row", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "mark_ground",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node", target: "place" },
				action_class: "always_available",
				effect: {
					primitive: "ForEachActorInRadius",
					write: {
						primitive: "Inscribe",
						trace_kind: "puddle_mark",
						content: '{"action":"relieve"}',
					},
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const toml = workspace.current();
		expect(toml).not.toBeNull();
		const manifest = inspectManifest(toml ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_mark_ground/success",
		);
		expect(frameWrites).toHaveLength(1);
		const inscribe = (frameWrites[0]?.frame_write as Record<string, unknown>).Inscribe as Record<
			string,
			unknown
		>;
		expect(inscribe.kind).toBe("puddle_mark");
		expect(inscribe.location_ref).toBe("ActorSpatialRef");
		expect(inscribe.payload_json).toBe('{"action":"relieve"}');
		const action = tableRows(manifest, "action_definitions").find(
			(r) => r.action_id === "aoe_blast/cast_mark_ground",
		);
		expect(action?.self_eligible).toBe(false);
		expect(tableRows(manifest, "spatial_state_definitions")).toHaveLength(0);
	});

	it("target: 'self' + Spawn WITHOUT cost errors with the operator-approved hint, before validation", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedPuddleEntityType(workspace);
		const beforeHint = workspace.current();
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "self_spawn",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "self" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "Spawn", entity_def: "aoe_blast/item/puddle" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/self-targeted needs a cost pool.*target: "place"/);
		// NOT persisted — the hint fires before the manifest is touched.
		expect(workspace.current()).toBe(beforeHint);
	});

	it("target: 'self' + Spawn WITH cost succeeds (mirrors srd/cast_find_familiar's self_eligible=true + resourceCost)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedPuddleEntityType(workspace);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "self_spawn",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node", target: "self" },
				action_class: "spell",
				cost: { pool: "aoe_blast/spell_slot_1", amount: 1 },
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "Spawn", entity_def: "aoe_blast/item/puddle" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const action = tableRows(manifest, "action_definitions").find(
			(r) => r.action_id === "aoe_blast/cast_self_spawn",
		);
		expect(action?.self_eligible).toBe(true);
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_self_spawn/success",
		);
		expect(
			frameWrites.some((r) => JSON.stringify(r.frame_write).includes("aoe_blast/spell_slot_1")),
		).toBe(true);
	});

	it("effect.write.primitive 'Spawn'/'Inscribe' without offered_when.target names `offered_when.target`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "untargeted",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "Inscribe", trace_kind: "x", content: "{}" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`offered_when\.target`/);
	});

	it("target: 'place' + ModifyResource is an unsupported combo, names `effect.write.primitive`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_place",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "place" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/node_ball", radius: 0 },
						write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d4" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.primitive`/);
	});

	it("effect.shape set alongside a place/self write.primitive is rejected, naming `effect.shape`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_shape",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "place" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/node_ball", radius: 0 },
						write: { primitive: "Inscribe", trace_kind: "x", content: "{}" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.shape`/);
	});

	it("Spawn's entity_def must already exist — never auto-created, error names `effect.write.entity_def`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "dangling_spawn",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "place" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "Spawn", entity_def: "aoe_blast/item/nonexistent" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.entity_def`/);
	});
});

// ---------------------------------------------------------------------------
// 5c. spellkave_define_behavior — single-target mode (#1968 verb-UX round 2
//     gap③): `effect.shape` OMITTED drives `clusterRows`'s "single-target"
//     shape — the bare ModifyResource(TargetActor) write the MAJORITY of
//     committed srd spells/monster actions use, reusing the SAME builder
//     `author-spell-behavior.ts`/`author-monster-actions.ts` drive directly
//     (compose.ts) rather than hand-mirroring its row assembly.
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — single-target mode (#1968 verb-UX round 2 gap③)", () => {
	it("effect.shape omitted authors a bare ModifyResource(TargetActor) frame_write, gated on the AFFORDANCE (not a per-actor body)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "poke",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					per_target_gate: "d20 >= 13",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d4" },
				},
			},
			"behavior-single-target",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_poke/success",
		);
		expect(frameWrites).toHaveLength(1);
		expect(normalize(frameWrites[0]?.frame_write)).toEqual({
			ModifyResource: { actor: "TargetActor", resource: "aoe_blast/hp", delta_source: "-d4" },
		});
		// The per_target_gate lands on the AFFORDANCE (single-target's own
		// attack-roll seam), NOT wrapped in a ForEachActorInRadius body gate.
		const affordance = tableRows(manifest, "affordance_templates").find(
			(r) => r.template_id === "aoe_blast/cast_poke/affordance",
		);
		expect(affordance?.predicate_bool_source ?? affordance?.predicate_source).toBeDefined();
	});

	it("equivalence: reproduces clusterRows([behavior], cfg) directly, field-by-field, for the SAME single-target ActorBehavior (#1968 proof)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const caster = entityKeys[0] as string;

		// The verb-driven side.
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "smite",
				capability_id: "aoe_blast/spell/smite",
				display_name: "Cast Smite",
				description: "A single-target divine strike.",
				tags: ["aoe_blast.spell", "aoe_blast.damage.radiant"],
				grant_to: caster,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					per_target_gate: "d20 >= 13",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-2d6" },
				},
			},
			"behavior-equivalence",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const actual = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		// The compose-layer side — the SAME builder, driven directly with the
		// EQUIVALENT ActorBehavior/BehaviorConfig (mirrors what
		// author-spell-behavior.ts/author-monster-actions.ts do today).
		const behavior: ActorBehavior = {
			key: "smite",
			capabilityId: "aoe_blast/spell/smite",
			displayName: "Cast Smite",
			emitCapability: true,
			capabilityDescription: "A single-target divine strike.",
			capabilityTags: ["aoe_blast.spell", "aoe_blast.damage.radiant"],
			actionTags: ["aoe_blast.spell", "aoe_blast.damage.radiant"],
			shape: "single-target",
			predicateSource: "d20 >= 13",
			deltaSource: "-2d6",
			resourceStateId: "aoe_blast/hp",
			caster,
			casterNode: "aoe_blast/arena/center",
			selfEligible: false,
		};
		const cfg: BehaviorConfig = {
			bundleId: "aoe_blast",
			manifestPath: "",
			capPrefix: "spell",
			actionPrefix: "cast_",
			defaultCaster: caster,
			defaultCasterNode: "aoe_blast/arena/center",
			idNamespace: "aoe_blast",
		};
		// Round-trip through the SAME render->reparse cycle `actual` went through
		// (workspace.writeToml -> workspace.current() -> inspectManifest) so both
		// sides pick up identical schema serde defaults (e.g.
		// capability_definitions.default_visibility) — comparing the RAW
		// `clusterRows` object against an already-reparsed manifest would flag
		// schema-fill-in noise as a divergence.
		const expected = inspectManifest(
			renderSchemaManifest({ schema_version: "1.0.0", ...clusterRows([behavior], cfg) }),
		).manifest as Record<string, Record<string, unknown>[]>;

		// `actual`'s workspace also carries the fireball behavior's OWN rows
		// (id="firebloom") from `runFireballSequence` — scope the comparison to
		// exactly this call's own "smite" rows via each table's natural (or
		// closest-available) key, since `clusterRows([behavior], cfg)` — driven
		// with ONE behavior — emits ONLY smite's own rows on the expected side.
		const scopedActual = (table: string, matches: (r: Record<string, unknown>) => boolean) =>
			tableRows(actual, table).filter(matches);

		expect(
			normalize(
				scopedActual("capability_definitions", (r) => r.capability_id === "aoe_blast/spell/smite"),
			),
		).toEqual(normalize(expected.capability_definitions));
		expect(
			normalize(
				scopedActual(
					"capability_definition_tag",
					(r) => r.capability_id === "aoe_blast/spell/smite",
				),
			),
		).toEqual(normalize(expected.capability_definition_tag));
		expect(
			normalize(scopedActual("action_definitions", (r) => r.action_id === "aoe_blast/cast_smite")),
		).toEqual(normalize(expected.action_definitions));
		expect(
			normalize(
				scopedActual("action_definition_tag", (r) => r.action_id === "aoe_blast/cast_smite"),
			),
		).toEqual(normalize(expected.action_definition_tag));
		expect(
			normalize(
				scopedActual("outcome_templates", (r) =>
					String(r.outcome_template_id).includes("cast_smite"),
				),
			),
		).toEqual(normalize(expected.outcome_templates));
		expect(
			normalize(
				scopedActual("affordance_templates", (r) => String(r.template_id).includes("cast_smite")),
			),
		).toEqual(normalize(expected.affordance_templates));
		expect(
			normalize(
				scopedActual("consequence_templates", (r) => String(r.template_id).includes("cast_smite")),
			),
		).toEqual(normalize(expected.consequence_templates));
		expect(
			normalize(
				scopedActual(
					"consequence_frame_writes",
					(r) => r.template_id === "aoe_blast/cast_smite/success",
				),
			),
		).toEqual(normalize(expected.consequence_frame_writes));
	});

	it("capability_id override + tags folding: capability_definition_tag/action_definition_tag both reflect `tags`, action_class is not auto-appended", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "jab",
				capability_id: "aoe_blast/spell/jab-override",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				tags: ["aoe_blast.spell", "aoe_blast.level-1"],
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d4" },
				},
			},
			"behavior-tags",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const capability = tableRows(manifest, "capability_definitions").find(
			(r) => r.capability_id === "aoe_blast/spell/jab-override",
		);
		expect(capability).toBeDefined();
		expect(
			tableRows(manifest, "capability_definition_tag")
				.filter((r) => r.capability_id === "aoe_blast/spell/jab-override")
				.map((r) => r.tag)
				.sort(),
		).toEqual(["aoe_blast.level-1", "aoe_blast.spell"]);
		const actionId = tableRows(manifest, "action_definitions").find(
			(r) => r.required_capability === "aoe_blast/spell/jab-override",
		)?.action_id as string;
		expect(
			tableRows(manifest, "action_definition_tag")
				.filter((r) => r.action_id === actionId)
				.map((r) => r.tag)
				.sort(),
		).toEqual(["aoe_blast.level-1", "aoe_blast.spell"]);
	});

	it("display_name override: overrides the derived 'Cast <TitleCase id>' — the mangled-preposition case (#1968)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "circle_of_death",
				display_name: "Cast Circle of Death",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-8d8" },
				},
			},
			"behavior-display-name",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const capability = tableRows(manifest, "capability_definitions").find(
			(r) => r.capability_id === "aoe_blast/spell/circle_of_death",
		);
		expect(capability?.display_name).toBe("Cast Circle of Death");
	});

	it("action_prefix override: '' derives a BARE '<bundle>/<id>' action id, mirroring the Hex/Bless WRITER/CONSUMER family (#1968 srd-migration round)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "hex_strike",
				action_prefix: "",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "buff",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-1d6" },
				},
			},
			"behavior-action-prefix",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const action = tableRows(manifest, "action_definitions").find(
			(r) => r.action_id === "aoe_blast/hex_strike",
		);
		expect(action).toBeDefined();
		expect(
			tableRows(manifest, "action_definitions").some(
				(r) => r.action_id === "aoe_blast/cast_hex_strike",
			),
		).toBe(false);
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/hex_strike/success",
		);
		expect(frameWrites).toHaveLength(1);
	});

	it("emit_capability: false reuses an already-authored capability without emitting a duplicate row, mirroring Guidance's feat-grant reuse (#1968 srd-migration round)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		// Pre-author the capability elsewhere (e.g. a feat grant) — the SAME id this
		// call's capability_id will target.
		const preResult = await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "spell/preexisting",
				actor_kind: "entity",
				display_name: "Preexisting Cap",
				description: "Authored elsewhere (e.g. a feat grant).",
			},
			"pre-capability",
		);
		expect((preResult.details as VerbResult).ok, JSON.stringify(preResult.details)).toBe(true);
		const beforeCount = tableRows(
			inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>,
			"capability_definitions",
		).length;

		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "reuse_cap",
				capability_id: "aoe_blast/spell/preexisting",
				emit_capability: false,
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-1d4" },
				},
			},
			"behavior-reuse-cap",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		// No new capability_definitions row — the count is unchanged.
		expect(tableRows(manifest, "capability_definitions")).toHaveLength(beforeCount);
		// But the action/affordance/niche still key on the reused capability.
		const affordance = tableRows(manifest, "affordance_templates").find((r) =>
			String(r.template_id).includes("cast_reuse_cap"),
		);
		expect(affordance?.capability_id).toBe("aoe_blast/spell/preexisting");
		const actorCap = tableRows(manifest, "actor_capabilities").find(
			(r) =>
				r.capability_id === "aoe_blast/spell/preexisting" && r.actor_entity_key === entityKeys[0],
		);
		expect(actorCap).toBeDefined();
	});

	it("offered_when.range_m overrides the default range_m=0 (#1968 verb-UX round 3 — a melee reach needs a non-zero range)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "melee_swing",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node", range_m: 1.524 },
				action_class: "monster-action",
				effect: {
					primitive: "ForEachActorInRadius",
					per_target_gate: "d20 >= 13",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-1d6" },
				},
			},
			"behavior-range-m",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const affordance = tableRows(manifest, "affordance_templates").find((r) =>
			String(r.template_id).includes("cast_melee_swing"),
		);
		expect(affordance?.range_m).toBeCloseTo(1.524);
	});

	it("offered_when.range_m omitted stays the byte-identical range_m=0 default", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "touch_range",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-1d4" },
				},
			},
			"behavior-range-m-default",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const affordance = tableRows(manifest, "affordance_templates").find((r) =>
			String(r.template_id).includes("cast_touch_range"),
		);
		expect(affordance?.range_m).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// 5c. spellkave_define_behavior — Multiattack (#1968 verb-UX round 3): N
//     independent self-gating TargetActor writes in ONE action, mirroring
//     compose.ts's `ActorBehavior.attacks` (the Polar Bear / Owlbear / Brown
//     Bear Multiattack shape).
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — Multiattack (#1968 verb-UX round 3)", () => {
	/** Every `attacks` write hardcodes `resource: "srd/hp"` (compose.ts's attacks-branch,
	 * mirrored verbatim) — seed it once per test so MF-VAL-217 doesn't false-fail. */
	async function seedSrdHp(workspace: AuthorWorkspace): Promise<void> {
		const result = await defineResourceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "srd", id: "hp", min_value: 0, max_value: 999 },
			"seed-srd-hp",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	}

	it("attacks authors N self-gating ModifyResource(TargetActor, srd/hp, ...) frame_writes, ungated affordance", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				// `srd`, not `aoe_blast`: `attacks` always writes `srd/hp` (compose.ts's
				// hardcode) — the owning bundle must be `srd` itself or a `srd`-dependent
				// bundle, else MF-VAL-214 cross-bundle-dependency false-fails. `grant_to`
				// (an `aoe_blast/*` entity_key) is unaffected — no bundle match required there.
				bundle: "srd",
				id: "rend_twice",
				// `srd/monster-action/*` (mirrors the real fixture convention, not the
				// derived `srd/spell/*`) sidesteps MF-VAL-264 (#835's catalog-binding
				// convention warning, `srd/spell/*`-scoped only — unrelated to this test).
				capability_id: "srd/monster-action/rend_twice",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "monster-action",
				effect: {
					primitive: "ForEachActorInRadius",
					write: {
						primitive: "ModifyResource",
						attacks: [
							{ delta: "cond(d20 >= 11, 0 - (1d8 + 5), 0)", label: "Rend" },
							{ delta: "cond(d20 >= 11, 0 - (1d8 + 5), 0)", label: "Rend" },
						],
					},
				},
			},
			"behavior-attacks",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes")
			.filter((r) => r.template_id === "srd/cast_rend_twice/success")
			.sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
		expect(frameWrites).toHaveLength(2);
		for (const fw of frameWrites) {
			expect(normalize(fw.frame_write)).toEqual({
				ModifyResource: {
					actor: "TargetActor",
					resource: "srd/hp",
					delta_source: "cond(d20 >= 11, 0 - (1d8 + 5), 0)",
				},
			});
		}
		// No affordance gate — each sub-attack self-gates in its own frame_write.
		const affordance = tableRows(manifest, "affordance_templates").find((r) =>
			String(r.template_id).includes("cast_rend_twice"),
		);
		expect(affordance?.predicate_bool ?? affordance?.predicate_bool_source).toBeTruthy();
	});

	it("equivalence: reproduces clusterRows([behavior], cfg)'s `attacks` output field-by-field (#1968 proof)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const caster = entityKeys[0] as string;
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const attacks = [
			{ delta: "cond(d20 >= 10, 0 - (1d8 + 3), 0)", label: "Bite" },
			{ delta: "cond(d20 >= 10, 0 - (1d4 + 3), 0)", label: "Claw" },
		];
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				// `srd`, not `aoe_blast` — see the previous test's comment (attacks always
				// write srd/hp; the owning bundle must be srd itself, else MF-VAL-214).
				bundle: "srd",
				id: "bear_multiattack",
				// srd/monster-action/*, not the derived srd/spell/* — sidesteps MF-VAL-264
				// (#835's catalog-binding convention warning), unrelated to this test.
				capability_id: "srd/monster-action/bear_multiattack",
				grant_to: caster,
				offered_when: { reach: "same_node" },
				action_class: "monster-action",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", attacks },
				},
			},
			"behavior-attacks-equivalence",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const actual = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		const behavior: ActorBehavior = {
			key: "bear_multiattack",
			capabilityId: "srd/monster-action/bear_multiattack",
			displayName: "Cast Bear Multiattack",
			emitCapability: true,
			actionTags: ["monster-action"],
			shape: "single-target",
			predicateSource: "",
			deltaSource: "",
			attacks: attacks.map((a) => ({ deltaSource: a.delta, label: a.label })),
			caster,
			casterNode: "aoe_blast/arena/center",
			selfEligible: false,
		};
		const cfg: BehaviorConfig = {
			bundleId: "srd",
			manifestPath: "",
			capPrefix: "spell",
			actionPrefix: "cast_",
			defaultCaster: caster,
			defaultCasterNode: "aoe_blast/arena/center",
			idNamespace: "srd",
		};
		const expected = inspectManifest(
			renderSchemaManifest({ schema_version: "1.0.0", ...clusterRows([behavior], cfg) }),
		).manifest as Record<string, Record<string, unknown>[]>;

		expect(
			normalize(
				tableRows(actual, "consequence_frame_writes").filter(
					(r) => r.template_id === "srd/cast_bear_multiattack/success",
				),
			),
		).toEqual(normalize(expected.consequence_frame_writes));
	});

	it("effect.shape set alongside attacks is rejected, naming `effect.shape` (Multiattack is single-target only)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_shape",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "monster-action",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/sphere", radius: 10 },
						write: { primitive: "ModifyResource", attacks: [{ delta: "0 - 1d6" }] },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.shape`/);
	});

	it("effect.per_target_gate set alongside attacks is rejected, naming `effect.per_target_gate`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_gate",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "monster-action",
					effect: {
						primitive: "ForEachActorInRadius",
						per_target_gate: "d20 >= 10",
						write: { primitive: "ModifyResource", attacks: [{ delta: "0 - 1d6" }] },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.per_target_gate`/);
	});

	it("an empty attacks array is rejected, naming `effect.write.attacks`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_empty",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "monster-action",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "ModifyResource", attacks: [] },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.attacks`/);
	});

	it("workspace idempotency: re-authoring the SAME bundle+id with a DIFFERENT attacks count replaces the frame_write set, not appends", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const base = {
			bundle: "srd",
			id: "growing_multiattack",
			// srd/monster-action/*, not the derived srd/spell/* — sidesteps MF-VAL-264
			// (#835's catalog-binding convention warning), unrelated to this test.
			capability_id: "srd/monster-action/growing_multiattack",
			grant_to: entityKeys[0] as string,
			offered_when: { reach: "same_node" as const },
			action_class: "monster-action",
		};
		await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				...base,
				effect: {
					primitive: "ForEachActorInRadius" as const,
					write: { primitive: "ModifyResource" as const, attacks: [{ delta: "0 - 1d6" }] },
				},
			},
			"run-1",
		);
		const second = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				...base,
				effect: {
					primitive: "ForEachActorInRadius" as const,
					write: {
						primitive: "ModifyResource" as const,
						attacks: [{ delta: "0 - 1d6" }, { delta: "0 - 1d4" }, { delta: "0 - 1d4" }],
					},
				},
			},
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "srd/cast_growing_multiattack/success",
		);
		expect(frameWrites).toHaveLength(3);
	});
});

// ---------------------------------------------------------------------------
// 5c-bis. spellkave_define_behavior — def-binding (#1968 verb-UX round 3):
//     `bind_to_definition`/`def_instance`, mirroring compose.ts's
//     `ActorBehavior.bindToDefinition`/`defInstance` (the #728 species/class/
//     monster DEFINITION-level capability inheritance, proven by the polar-bear/
//     breath-weapon/second-wind/bardic-inspiration slices).
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — def-binding (#1968 verb-UX round 3)", () => {
	async function seedEntityDef(workspace: AuthorWorkspace, entityDefId: string): Promise<void> {
		const result = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: entityDefId.split("/").slice(1).join("/"),
				display_name: entityDefId,
			},
			"seed-entity-def",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	}

	it("bind_to_definition alone authors ONE entity_definition_initial_capability row, no proof instance", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedEntityDef(workspace, "aoe_blast/monster/owlbear");
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "owlbear_rend",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "monster-action",
				bind_to_definition: "aoe_blast/monster/owlbear",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-2d8" },
				},
			},
			"behavior-bind",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const bindingRows = tableRows(manifest, "entity_definition_initial_capability").filter(
			(r) => r.entity_def_id === "aoe_blast/monster/owlbear",
		);
		expect(bindingRows).toHaveLength(1);
		expect(bindingRows[0]?.capability_id).toBe("aoe_blast/spell/owlbear_rend");
		// No proof instance without def_instance.
		expect(
			tableRows(manifest, "entities").some((r) => String(r.entity_key).includes("owlbear-def")),
		).toBe(false);
	});

	it("def_instance places a proof entity carrying NO actor_capabilities row (the inheritance proof)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedEntityDef(workspace, "aoe_blast/monster/polar-bear");
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "polar_bear_rend",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "monster-action",
				bind_to_definition: "aoe_blast/monster/polar-bear",
				def_instance: { entity_key: "aoe_blast/polar-bear-def", name: "Polar Bear (def-instance)" },
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-2d8" },
				},
			},
			"behavior-def-instance",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		const entity = tableRows(manifest, "entities").find(
			(r) => r.entity_key === "aoe_blast/polar-bear-def",
		);
		expect(entity).toMatchObject({
			entity_key: "aoe_blast/polar-bear-def",
			entity_def_id: "aoe_blast/monster/polar-bear",
			name: "Polar Bear (def-instance)",
		});
		expect(
			tableRows(manifest, "actors").some((r) => r.entity_key === "aoe_blast/polar-bear-def"),
		).toBe(true);
		const loc = tableRows(manifest, "actor_spatial_locations").find(
			(r) => r.entity_key === "aoe_blast/polar-bear-def",
		);
		// Defaults to the resolved caster's own node (grant_to's node) when `node` is omitted.
		expect(loc?.place_node_id).toBe("aoe_blast/arena/center");
		// THE LOAD-BEARING PROOF: no actor_capabilities row for the def-instance —
		// it can act ONLY by inheriting the capability from the definition seed.
		expect(
			tableRows(manifest, "actor_capabilities").some(
				(r) => r.actor_entity_key === "aoe_blast/polar-bear-def",
			),
		).toBe(false);
	});

	it("def_instance.node overrides the default caster-node placement", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedEntityDef(workspace, "aoe_blast/monster/skeleton");
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "skeleton_sword",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "monster-action",
				bind_to_definition: "aoe_blast/monster/skeleton",
				def_instance: {
					entity_key: "aoe_blast/skeleton-def",
					name: "Skeleton (def-instance)",
					node: "aoe_blast/arena/fringe",
				},
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-1d6" },
				},
			},
			"behavior-def-instance-node",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const loc = tableRows(manifest, "actor_spatial_locations").find(
			(r) => r.entity_key === "aoe_blast/skeleton-def",
		);
		expect(loc?.place_node_id).toBe("aoe_blast/arena/fringe");
	});

	it("def_instance without bind_to_definition is rejected, naming `bind_to_definition`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "no_bind",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "monster-action",
					def_instance: { entity_key: "aoe_blast/orphan-def", name: "Orphan" },
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-1d6" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`bind_to_definition`/);
	});

	it("equivalence: reproduces clusterRows([behavior], cfg)'s bindToDefinition/defInstance output field-by-field (#1968 proof)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const caster = entityKeys[0] as string;
		const workspace = fakeWorkspace(finalToml);
		await seedEntityDef(workspace, "aoe_blast/monster/dragonwyrm");
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "wyrm_bite",
				capability_id: "aoe_blast/monster-action/wyrm_bite",
				grant_to: caster,
				offered_when: { reach: "same_node" },
				action_class: "monster-action",
				bind_to_definition: "aoe_blast/monster/dragonwyrm",
				def_instance: { entity_key: "aoe_blast/wyrm-def", name: "Dragonwyrm (def-instance)" },
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-3d6" },
				},
			},
			"behavior-def-binding-equivalence",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const actual = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		const behavior: ActorBehavior = {
			key: "wyrm_bite",
			capabilityId: "aoe_blast/monster-action/wyrm_bite",
			displayName: "Cast Wyrm Bite",
			emitCapability: true,
			actionTags: ["monster-action"],
			shape: "single-target",
			predicateSource: "",
			deltaSource: "-3d6",
			resourceStateId: "aoe_blast/hp",
			caster,
			casterNode: "aoe_blast/arena/center",
			selfEligible: false,
			bindToDefinition: "aoe_blast/monster/dragonwyrm",
			defInstance: { entityKey: "aoe_blast/wyrm-def", name: "Dragonwyrm (def-instance)" },
		};
		const cfg: BehaviorConfig = {
			bundleId: "aoe_blast",
			manifestPath: "",
			capPrefix: "spell",
			actionPrefix: "cast_",
			defaultCaster: caster,
			defaultCasterNode: "aoe_blast/arena/center",
			idNamespace: "aoe_blast",
		};
		const expected = inspectManifest(
			renderSchemaManifest({ schema_version: "1.0.0", ...clusterRows([behavior], cfg) }),
		).manifest as Record<string, Record<string, unknown>[]>;

		expect(
			normalize(
				tableRows(actual, "entity_definition_initial_capability").filter(
					(r) => r.entity_def_id === "aoe_blast/monster/dragonwyrm",
				),
			),
		).toEqual(normalize(expected.entity_definition_initial_capability));
		expect(
			normalize(tableRows(actual, "entities").filter((r) => r.entity_key === "aoe_blast/wyrm-def")),
		).toEqual(normalize(expected.entities?.filter((r) => r.entity_key === "aoe_blast/wyrm-def")));
		expect(
			normalize(
				tableRows(actual, "actor_spatial_locations").filter(
					(r) => r.entity_key === "aoe_blast/wyrm-def",
				),
			),
		).toEqual(
			normalize(
				expected.actor_spatial_locations?.filter((r) => r.entity_key === "aoe_blast/wyrm-def"),
			),
		);
	});

	it("workspace idempotency: re-authoring the SAME bundle+id upserts the binding + proof instance, never duplicates", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedEntityDef(workspace, "aoe_blast/monster/zombie");
		const params = {
			bundle: "aoe_blast",
			id: "zombie_slam",
			grant_to: entityKeys[0] as string,
			offered_when: { reach: "same_node" as const },
			action_class: "monster-action",
			bind_to_definition: "aoe_blast/monster/zombie",
			def_instance: { entity_key: "aoe_blast/zombie-def", name: "Zombie (def-instance)" },
			effect: {
				primitive: "ForEachActorInRadius" as const,
				write: { primitive: "ModifyResource" as const, resource: "aoe_blast/hp", delta: "-1d8" },
			},
		};
		await defineBehaviorToolDef.run(contextWith({ workspace }), params, "run-1");
		const second = await defineBehaviorToolDef.run(contextWith({ workspace }), params, "run-2");
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "entity_definition_initial_capability").filter(
				(r) => r.entity_def_id === "aoe_blast/monster/zombie",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "entities").filter((r) => r.entity_key === "aoe_blast/zombie-def"),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "actors").filter((r) => r.entity_key === "aoe_blast/zombie-def"),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "actor_spatial_locations").filter(
				(r) => r.entity_key === "aoe_blast/zombie-def",
			),
		).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// 5d. spellkave_define_behavior — ApplyStatus + RemoveCondition (#1968
//     srd-migration round): the B9 Hold-Person/Hold-Monster/Bless-family
//     condition-apply shape, and its inverse, the Lesser-Restoration cleanse
//     shape — both single-target-only, mirroring the single-target
//     ModifyResource topology with a different frame_write op.
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — ApplyStatus + RemoveCondition (#1968 srd-migration round)", () => {
	async function seedCondition(workspace: AuthorWorkspace, id: string) {
		const result = await defineConditionToolDef.run(
			contextWith({ workspace }),
			{ bundle: "aoe_blast", id },
			"condition",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	}

	it("ApplyStatus authors a bare ApplyStatus(TargetActor) frame_write, gated on the affordance", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedCondition(workspace, "condition/hexed");
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "hex",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					per_target_gate: "roll_under(d20, 13)",
					write: { primitive: "ApplyStatus", condition: "aoe_blast/condition/hexed" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_hex/success",
		);
		expect(frameWrites).toHaveLength(1);
		const apply = (frameWrites[0]?.frame_write as Record<string, unknown>).ApplyStatus as Record<
			string,
			unknown
		>;
		expect(apply.target_ref).toBe("TargetActor");
		expect(apply.condition_definition_id).toBe("aoe_blast/condition/hexed");
		const affordance = tableRows(manifest, "affordance_templates").find((r) =>
			String(r.template_id).includes("cast_hex"),
		);
		expect(affordance?.predicate_source).toBe("roll_under(d20, 13)");
	});

	it("RemoveCondition, remove_source omitted, authors source_match 'Any'", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedCondition(workspace, "condition/poisoned");
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "cure",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "RemoveCondition", condition: "aoe_blast/condition/poisoned" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_cure/success",
		);
		const remove = (frameWrites[0]?.frame_write as Record<string, unknown>)
			.RemoveCondition as Record<string, unknown>;
		expect(remove.condition_definition_id).toBe("aoe_blast/condition/poisoned");
		expect(remove.source_match).toBe("Any");
	});

	it("RemoveCondition, remove_source set, authors source_match { Exact }", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedCondition(workspace, "condition/poisoned");
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "cure_exact",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: {
						primitive: "RemoveCondition",
						condition: "aoe_blast/condition/poisoned",
						remove_source: "aoe_blast/cast_venom",
					},
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_cure_exact/success",
		);
		const remove = (frameWrites[0]?.frame_write as Record<string, unknown>)
			.RemoveCondition as Record<string, unknown>;
		expect(remove.source_match).toEqual({ Exact: "aoe_blast/cast_venom" });
	});

	it("effect.write.condition is required for ApplyStatus/RemoveCondition, error names `effect.write.condition`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "no_condition",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: { primitive: "ForEachActorInRadius", write: { primitive: "ApplyStatus" } },
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.condition`/);
	});

	it("a dangling effect.write.condition ref is rejected before persisting, naming `effect.write.condition`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "dangling",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "ApplyStatus", condition: "aoe_blast/condition/nonexistent" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.condition`/);
	});

	it("effect.shape set alongside ApplyStatus is rejected, naming `effect.shape` (no aoe condition pulse is wired)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedCondition(workspace, "condition/hexed");
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_shape",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/sphere", radius: 10 },
						write: { primitive: "ApplyStatus", condition: "aoe_blast/condition/hexed" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.shape`/);
	});

	it("offered_when.target 'place' + ApplyStatus is an unsupported combo, names `effect.write.primitive`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedCondition(workspace, "condition/hexed");
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_place",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "place" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "ApplyStatus", condition: "aoe_blast/condition/hexed" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.primitive`/);
	});
});

// ---------------------------------------------------------------------------
// 5e. spellkave_define_behavior — EnvState + OutcomeGraph (#1968 verb-UX
//     round 4): compose.ts's "env-state" (Darkness/Silence/Fog ambient-effect)
//     and "outcome-graph" (branch-on-outcome, Melf's Acid Arrow) shapes.
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — EnvState (#1968 verb-UX round 4)", () => {
	it("authors a bool env-state marker Inscribe(ActorSpatialRef) + auto-creates the spatial_state_definitions row", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "darkness",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "EnvState", env_state_id: "aoe_blast/darkness" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		const stateDef = tableRows(manifest, "spatial_state_definitions").find(
			(r) => r.state_id === "aoe_blast/darkness",
		);
		expect(stateDef?.value_type).toBe("bool");
		expect(stateDef?.writer_policy).toBe("world_interaction");

		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_darkness/success",
		);
		expect(frameWrites).toHaveLength(1);
		const inscribe = (frameWrites[0]?.frame_write as Record<string, unknown>).Inscribe as Record<
			string,
			unknown
		>;
		expect(inscribe.kind).toBe("spatial_environment_state");
		expect(inscribe.location_ref).toBe("ActorSpatialRef");
		const payload = JSON.parse(inscribe.payload_json as string);
		expect(payload).toEqual({ state_id: "aoe_blast/darkness", value: true, visibility: "Public" });
	});

	it("env_state_value: false + env_state_center: 'target' authors value:false on TargetSpatialRef", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "dispel_dark",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: {
						primitive: "EnvState",
						env_state_id: "aoe_blast/darkness",
						env_state_value: false,
						env_state_center: "target",
					},
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_dispel_dark/success",
		);
		const inscribe = (frameWrites[0]?.frame_write as Record<string, unknown>).Inscribe as Record<
			string,
			unknown
		>;
		expect(inscribe.location_ref).toBe("TargetSpatialRef");
		expect(JSON.parse(inscribe.payload_json as string).value).toBe(false);
	});

	it("effect.write.env_state_id is required, error names `effect.write.env_state_id`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "no_state_id",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: { primitive: "ForEachActorInRadius", write: { primitive: "EnvState" } },
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.env_state_id`/);
	});

	it("effect.shape set alongside EnvState is rejected, naming `effect.shape`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_shape",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/sphere", radius: 10 },
						write: { primitive: "EnvState", env_state_id: "aoe_blast/darkness" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.shape`/);
	});

	it("offered_when.target 'place' + EnvState is an unsupported combo, names `effect.write.primitive`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_place",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "place" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "EnvState", env_state_id: "aoe_blast/darkness" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.primitive`/);
	});
});

describe("spellkave_define_behavior — OutcomeGraph (#1968 verb-UX round 4)", () => {
	// compose.ts's "outcome-graph" branch hardcodes each terminal node's ModifyResource
	// write to the LITERAL id `srd/hp` (mirrors the attacks-branch hardcode) — seed it
	// under bundle "srd" (own-namespace, matching the real author-acid-arrow.ts script's
	// own bundle) so the id/bundle-namespace lint (MF-VAL-291) never fires.
	async function seedSrdHp(workspace: AuthorWorkspace) {
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				kind: "resource_definitions",
				rows: [
					{
						resource_definition_id: "srd/hp",
						bundle_id: "srd",
						display_name: "Hit Points",
						value_kind: "int",
						min_value: 0,
						max_value: 999,
						recovery_rule: "long_rest",
						initial_value: 30,
					},
				],
			},
			"resource",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	}

	it("authors a root node + one edge/terminal-node/consequence per branch, in authored_order", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "acid_arrow",
				capability_id: "srd/probe/acid_arrow", // avoid the srd/spell/* catalog-binding convention warning (#835)
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: {
						primitive: "OutcomeGraph",
						branches: [
							{ node: "hit", guard: "d20 >= 13", delta: "0 - 4d4", label: "hit" },
							{ node: "miss", guard: "1 == 1", delta: "0 - 2d4", label: "miss" },
						],
					},
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		const graphId = "srd/cast_acid_arrow/graph";
		const outcome = tableRows(manifest, "outcome_templates").find(
			(r) => r.outcome_template_id === "srd/cast_acid_arrow/outcome",
		);
		expect(outcome?.outcome_expression_source).toBe(`invoke_outcome_graph('${graphId}')`);

		const nodes = tableRows(manifest, "outcome_graph_nodes").filter(
			(r) => r.outcome_graph_id === graphId,
		);
		expect(nodes.map((n) => n.node_id)).toEqual(["root", "hit", "miss"]);

		const edges = tableRows(manifest, "outcome_graph_edges")
			.filter((r) => r.outcome_graph_id === graphId)
			.sort((a, b) => Number(a.authored_order) - Number(b.authored_order));
		expect(edges.map((e) => e.to_node_id)).toEqual(["hit", "miss"]);
		expect(edges.map((e) => e.guard_predicate_source)).toEqual(["d20 >= 13", "1 == 1"]);

		const hitConsequence = `${graphId}/hit_effect`;
		const hitFrameWrite = tableRows(manifest, "consequence_frame_writes").find(
			(r) => r.template_id === hitConsequence,
		);
		expect((hitFrameWrite?.frame_write as Record<string, unknown>).ModifyResource).toMatchObject({
			actor: "TargetActor",
			resource: "srd/hp",
			delta_source: "0 - 4d4",
		});

		const missConsequence = `${graphId}/miss_effect`;
		const missFrameWrite = tableRows(manifest, "consequence_frame_writes").find(
			(r) => r.template_id === missConsequence,
		);
		expect((missFrameWrite?.frame_write as Record<string, unknown>).ModifyResource).toMatchObject({
			delta_source: "0 - 2d4",
		});

		// The cast's OWN success consequence carries no frame_write at all — the effect
		// lives entirely at the selected graph node (#865 node-effect wiring).
		const castFrameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "srd/cast_acid_arrow/success",
		);
		expect(castFrameWrites).toHaveLength(0);
	});

	// #1968 HIGH fresh-eyes fix: every per-branch id (`outcome_graph_node_id`/
	// `outcome_graph_edge_id`/`outcome_template_id`/`consequence_template_id`)
	// derives from the user-supplied `branches[].node` string, but `outcome_graph_id`
	// itself is STABLE (`${action}/graph`) — a re-authored call that REMOVES or
	// RENAMES a branch must clear the OLD branch's rows, or they stay orphaned under
	// the unchanged `outcome_graph_id` and blow `outcome_graphs.max_nodes` on the
	// next validation (MF-VAL-262, permanently — a retry regenerates the same
	// surviving set and hits the same wall). These are that finding's own repro, in
	// both directions (shrink + rename), plus the unchanged-re-run control.
	function outcomeGraphParams(
		id: string,
		branches: { node: string; guard: string; delta: string; label?: string }[],
		entityKey: string,
	) {
		return {
			bundle: "srd",
			id,
			capability_id: `srd/probe/${id}`,
			grant_to: entityKey,
			offered_when: { reach: "same_node" as const },
			action_class: "spell" as const,
			effect: {
				primitive: "ForEachActorInRadius" as const,
				write: { primitive: "OutcomeGraph" as const, branches },
			},
		};
	}

	it("re-authoring the SAME id with a branch REMOVED clears the stale branch's rows (shrink) — no MF-VAL-262", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const graphId = "srd/cast_shrink_test/graph";

		const first = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			outcomeGraphParams(
				"shrink_test",
				[
					{ node: "hit", guard: "d20 >= 13", delta: "0 - 4d4", label: "hit" },
					{ node: "miss", guard: "1 == 1", delta: "0 - 2d4", label: "miss" },
				],
				entityKeys[0] as string,
			),
			"run-1",
		);
		expect((first.details as VerbResult).ok, JSON.stringify(first.details)).toBe(true);
		const manifestAfterFirst = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;
		const hitNodeBefore = tableRows(manifestAfterFirst, "outcome_graph_nodes").find(
			(r) => r.outcome_graph_node_id === `${graphId}/hit`,
		);
		expect(hitNodeBefore).toBeDefined();

		const second = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			outcomeGraphParams(
				"shrink_test",
				[{ node: "hit", guard: "d20 >= 13", delta: "0 - 4d4", label: "hit" }],
				entityKeys[0] as string,
			),
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		const nodes = tableRows(manifest, "outcome_graph_nodes").filter(
			(r) => r.outcome_graph_id === graphId,
		);
		expect(nodes.map((n) => n.node_id).sort()).toEqual(["hit", "root"]);

		const edges = tableRows(manifest, "outcome_graph_edges").filter(
			(r) => r.outcome_graph_id === graphId,
		);
		expect(edges.map((e) => e.to_node_id)).toEqual(["hit"]);

		const graphOwnedOutcomeTemplates = tableRows(manifest, "outcome_templates").filter((r) =>
			(r.outcome_template_id as string).startsWith(`${graphId}/`),
		);
		expect(graphOwnedOutcomeTemplates.map((r) => r.outcome_template_id).sort()).toEqual(
			[`${graphId}/hit`, `${graphId}/root`].sort(),
		);

		const graphOwnedConsequenceTemplates = tableRows(manifest, "consequence_templates").filter(
			(r) => (r.template_id as string).startsWith(`${graphId}/`),
		);
		expect(graphOwnedConsequenceTemplates.map((r) => r.template_id)).toEqual([
			`${graphId}/hit_effect`,
		]);

		// The stale "miss" branch's rows are GONE, not merely orphaned.
		expect(
			tableRows(manifest, "outcome_graph_nodes").some(
				(r) => r.outcome_graph_node_id === `${graphId}/miss`,
			),
		).toBe(false);
		expect(
			tableRows(manifest, "outcome_templates").some(
				(r) => r.outcome_template_id === `${graphId}/miss`,
			),
		).toBe(false);
		expect(
			tableRows(manifest, "consequence_templates").some(
				(r) => r.template_id === `${graphId}/miss_effect`,
			),
		).toBe(false);
		expect(
			tableRows(manifest, "consequence_frame_writes").some(
				(r) => r.template_id === `${graphId}/miss_effect`,
			),
		).toBe(false);

		// The SURVIVING "hit" node row was upserted in place, never deleted+recreated.
		const hitNodeAfter = tableRows(manifest, "outcome_graph_nodes").find(
			(r) => r.outcome_graph_node_id === `${graphId}/hit`,
		);
		expect(hitNodeAfter).toBeDefined();
		assertIdentityStable(
			hitNodeBefore as Record<string, unknown>,
			hitNodeAfter as Record<string, unknown>,
			"outcome_graph_nodes",
		);
		expect(identityOf("outcome_graph_nodes", hitNodeAfter as Record<string, unknown>)).toEqual({
			form: "natural-key",
			kind: "outcome_graph_nodes",
			key: `${graphId}/hit`,
		});
	});

	it("re-authoring the SAME id with a branch RENAMED clears the old name's rows (rename)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const graphId = "srd/cast_rename_test/graph";

		const first = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			outcomeGraphParams(
				"rename_test",
				[
					{ node: "hit", guard: "d20 >= 13", delta: "0 - 4d4", label: "hit" },
					{ node: "miss", guard: "1 == 1", delta: "0 - 2d4", label: "miss" },
				],
				entityKeys[0] as string,
			),
			"run-1",
		);
		expect((first.details as VerbResult).ok, JSON.stringify(first.details)).toBe(true);

		const second = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			outcomeGraphParams(
				"rename_test",
				[
					{ node: "hit", guard: "d20 >= 13", delta: "0 - 4d4", label: "hit" },
					{ node: "graze", guard: "1 == 1", delta: "0 - 1d4", label: "graze" },
				],
				entityKeys[0] as string,
			),
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		const nodes = tableRows(manifest, "outcome_graph_nodes").filter(
			(r) => r.outcome_graph_id === graphId,
		);
		expect(nodes.map((n) => n.node_id).sort()).toEqual(["graze", "hit", "root"]);

		const edges = tableRows(manifest, "outcome_graph_edges").filter(
			(r) => r.outcome_graph_id === graphId,
		);
		expect(edges.map((e) => e.to_node_id).sort()).toEqual(["graze", "hit"]);

		const graphOwnedConsequenceTemplates = tableRows(manifest, "consequence_templates")
			.filter((r) => (r.template_id as string).startsWith(`${graphId}/`))
			.map((r) => r.template_id)
			.sort();
		expect(graphOwnedConsequenceTemplates).toEqual([
			`${graphId}/graze_effect`,
			`${graphId}/hit_effect`,
		]);

		// The old "miss" branch's rows are GONE.
		expect(
			tableRows(manifest, "outcome_graph_nodes").some(
				(r) => r.outcome_graph_node_id === `${graphId}/miss`,
			),
		).toBe(false);
		expect(
			tableRows(manifest, "outcome_templates").some(
				(r) => r.outcome_template_id === `${graphId}/miss`,
			),
		).toBe(false);
		expect(
			tableRows(manifest, "consequence_templates").some(
				(r) => r.template_id === `${graphId}/miss_effect`,
			),
		).toBe(false);
		expect(
			tableRows(manifest, "consequence_frame_writes").some(
				(r) => r.template_id === `${graphId}/miss_effect`,
			),
		).toBe(false);
	});

	it("re-authoring the SAME id with the SAME branches (no-op re-run) stays idempotent — no diagnostics, single row set", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const graphId = "srd/cast_noop_test/graph";
		const branches = [
			{ node: "hit", guard: "d20 >= 13", delta: "0 - 4d4", label: "hit" },
			{ node: "miss", guard: "1 == 1", delta: "0 - 2d4", label: "miss" },
		];

		const first = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			outcomeGraphParams("noop_test", branches, entityKeys[0] as string),
			"run-1",
		);
		expect((first.details as VerbResult).ok, JSON.stringify(first.details)).toBe(true);
		const manifestAfterFirst = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;

		const second = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			outcomeGraphParams("noop_test", branches, entityKeys[0] as string),
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const nodes = tableRows(manifest, "outcome_graph_nodes").filter(
			(r) => r.outcome_graph_id === graphId,
		);
		expect(nodes.map((n) => n.node_id).sort()).toEqual(["hit", "miss", "root"]);
		expectManifestsSemanticallyEqual(manifestAfterFirst, manifest);
	});

	it("effect.write.branches must be non-empty, error names `effect.write.branches`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "no_branches",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "OutcomeGraph", branches: [] },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.branches`/);
	});

	it("effect.per_target_gate set alongside OutcomeGraph is rejected, naming `effect.per_target_gate`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_gate",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						per_target_gate: "d20 >= 13",
						write: {
							primitive: "OutcomeGraph",
							branches: [{ node: "hit", guard: "1 == 1", delta: "0 - 1" }],
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.per_target_gate`/);
	});

	it("effect.shape set alongside OutcomeGraph is rejected, naming `effect.shape`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_shape",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/sphere", radius: 10 },
						write: {
							primitive: "OutcomeGraph",
							branches: [{ node: "hit", guard: "1 == 1", delta: "0 - 1" }],
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.shape`/);
	});

	it("offered_when.target 'place' + OutcomeGraph is an unsupported combo, names `effect.write.primitive`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_place",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "place" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "OutcomeGraph",
							branches: [{ node: "hit", guard: "1 == 1", delta: "0 - 1" }],
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.primitive`/);
	});
});

describe("spellkave_define_behavior — effect.shape byte format (#1968 verb-UX round 5 fix)", () => {
	// srd-migration round 5 discovered this: `shapeParamsJson` used `JSON.stringify`
	// (compact — `{"radius_m":5}`, no decimal for a whole number) instead of matching
	// compose.ts's OWN literal formatting (`{"radius_m": 5.0}`, always one decimal +
	// a space) — undetected until author-spell-behavior.ts's Acid Splash/Shatter/
	// Fireball/etc became the FIRST `effect.shape` (aoe) caller driven against an
	// already-committed fixture's byte-diff gate.
	it('sphere: shape_params_json is `{"radius_m": X.X}` (always one decimal, space after colon) — never JSON.stringify\'s compact form', async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "shape_format_sphere",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					shape: { id: "core/area/sphere", radius: 20 }, // a WHOLE number — the case JSON.stringify mangled
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d6" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrite = tableRows(manifest, "consequence_frame_writes").find(
			(r) => r.template_id === "aoe_blast/cast_shape_format_sphere/success",
		);
		const radius = (frameWrite?.frame_write as Record<string, unknown>)
			.ForEachActorInRadius as Record<string, unknown>;
		expect(radius.shape_params_json).toBe('{"radius_m": 20.0}');
	});

	it('node_ball: shape_params_json is `{"ball_radius": N}` (space after colon, plain integer)', async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "shape_format_node_ball",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					shape: { id: "core/area/node_ball", radius: 1 },
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d6" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrite = tableRows(manifest, "consequence_frame_writes").find(
			(r) => r.template_id === "aoe_blast/cast_shape_format_node_ball/success",
		);
		const radius = (frameWrite?.frame_write as Record<string, unknown>)
			.ForEachActorInRadius as Record<string, unknown>;
		expect(radius.shape_params_json).toBe('{"ball_radius": 1}');
	});
});

// ---------------------------------------------------------------------------
// 5f. spellkave_define_behavior — ScheduledZone (#1968 verb-UX round 5): the
//     LAST blocked verb shape — compose.ts's "scheduled-zone" (ADR-0054,
//     Cloudkill/Moonbeam/Stinking Cloud/the scheduled-damage-zone batch). The
//     pulse's own write REUSES ModifyResource/ApplyStatus (`effect.write.pulse`)
//     rather than a new vocabulary — no hand-mirrored row assembly, the SAME
//     `clusterRows` builder every other define_behavior branch already drives.
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — ScheduledZone (#1968 verb-UX round 5)", () => {
	// compose.ts's "scheduled-zone" branch hardcodes the ModifyResource pulse body's
	// resource to the LITERAL id `srd/hp` (mirrors the outcome-graph/attacks-branch
	// hardcode) — seed it once per test, same posture as the OutcomeGraph describe
	// block's own `seedSrdHp` above.
	async function seedSrdHp(workspace: AuthorWorkspace) {
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				kind: "resource_definitions",
				rows: [
					{
						resource_definition_id: "srd/hp",
						bundle_id: "srd",
						display_name: "Hit Points",
						value_kind: "int",
						min_value: 0,
						max_value: 999,
						recovery_rule: "long_rest",
						initial_value: 30,
					},
				],
			},
			"resource",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	}

	it("ModifyResource pulse: marker Inscribe on the cast + ScheduleAutonomyJob effect + the pulse's OWN consequence_template/frame_write", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		// bundle "srd" (not "aoe_blast"): the pulse's ModifyResource body is HARDCODED
		// to the literal resource id `srd/hp` (compose.ts) — MF-VAL-214 rejects a
		// cross-bundle ref from an owning bundle that doesn't `depends_on` it, same
		// reason the OutcomeGraph equivalence test above uses bundle "srd" too.
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "cloudkill",
				capability_id: "srd/probe/cloudkill", // avoid the srd/spell/* catalog-binding convention warning (#835)
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: {
						primitive: "ScheduledZone",
						zone_state_id: "srd/hazard/cloudkill",
						zone_intensity: 5,
						zone_center: "target",
						pulse: {
							primitive: "ModifyResource",
							delta: "cond(d20 >= 15, 0 - (5d8 / 2), 0 - 5d8)",
						},
						schedule: {
							repeats: 10,
							frequency_ms: 6000,
							requires_subject_alive: false,
							source: "srd/cloudkill/{Actor}/{tick}",
						},
					},
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		// The CAST's own success consequence carries ONLY the marker Inscribe.
		const castFrameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "srd/cast_cloudkill/success",
		);
		expect(castFrameWrites).toHaveLength(1);
		const inscribe = (castFrameWrites[0]?.frame_write as Record<string, unknown>)
			.Inscribe as Record<string, unknown>;
		expect(inscribe.kind).toBe("spatial_environment_state");
		expect(inscribe.location_ref).toBe("TargetSpatialRef");
		expect(JSON.parse(inscribe.payload_json as string)).toEqual({
			state_id: "srd/hazard/cloudkill",
			value: 5,
			visibility: "Public",
		});

		const stateDef = tableRows(manifest, "spatial_state_definitions").find(
			(r) => r.state_id === "srd/hazard/cloudkill",
		);
		expect(stateDef?.value_type).toBe("int");
		expect(stateDef?.writer_policy).toBe("world_interaction");

		// The scheduling effect_definition, referenced off the success consequence.
		const successTemplate = tableRows(manifest, "consequence_templates").find(
			(r) => r.template_id === "srd/cast_cloudkill/success",
		);
		expect(successTemplate?.effect_refs_csv).toBe("srd/cast_cloudkill/schedule");
		const scheduleEffect = tableRows(manifest, "effect_definitions").find(
			(r) => r.effect_def_id === "srd/cast_cloudkill/schedule",
		);
		expect(scheduleEffect?.primitives_csv).toBe("ScheduleAutonomyJob");
		const schedule = JSON.parse(scheduleEffect?.parameters_schema_json as string);
		expect(schedule).toMatchObject({
			dsl_function: "srd/cast_cloudkill/pulse",
			fires_at_ms: 6000,
			source: "srd/cloudkill/{Actor}/{tick}",
			frequency_ms: 6000,
			repeats_remaining: 10,
			requires_subject_alive: false,
		});

		// The pulse's OWN consequence_template + ForEachActorInRadius frame_write —
		// a SEPARATE template from the cast's own success.
		const pulseTemplate = tableRows(manifest, "consequence_templates").find(
			(r) => r.template_id === "srd/cast_cloudkill/pulse",
		);
		expect(pulseTemplate).toBeDefined();
		const pulseFrameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "srd/cast_cloudkill/pulse",
		);
		expect(pulseFrameWrites).toHaveLength(1);
		const radius = (pulseFrameWrites[0]?.frame_write as Record<string, unknown>)
			.ForEachActorInRadius as Record<string, unknown>;
		expect(radius.center_ref).toBe("TargetSpatialRef");
		expect(radius.shape_id).toBe("core/area/node_ball");
		expect(JSON.parse(radius.shape_params_json as string)).toEqual({ ball_radius: 0 });
		expect(radius.predicate_source).toBe(""); // save-for-half: ungated body
		const body = (radius.body as Record<string, unknown>[])[0]?.ModifyResource as Record<
			string,
			unknown
		>;
		expect(body).toMatchObject({
			actor: "Actor",
			resource: "srd/hp",
			delta_source: "cond(d20 >= 15, 0 - (5d8 / 2), 0 - 5d8)",
		});
	});

	it("ApplyStatus pulse: effect.per_target_gate gates the pulse's per-occupant save-negate, not the affordance (Stinking Cloud shape)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await defineConditionToolDef.run(
			contextWith({ workspace }),
			{ bundle: "aoe_blast", id: "condition/poisoned" },
			"condition",
		);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "stinking_cloud",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					per_target_gate: "roll_under(d20, 13)",
					write: {
						primitive: "ScheduledZone",
						zone_state_id: "aoe_blast/hazard/stinking-cloud",
						pulse: { primitive: "ApplyStatus", condition: "aoe_blast/condition/poisoned" },
					},
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		// The affordance itself stays UNGATED — the save lives on the pulse body.
		const affordance = tableRows(manifest, "affordance_templates").find((r) =>
			String(r.template_id).includes("cast_stinking_cloud"),
		);
		expect(affordance?.predicate_bool).toBe(true);
		// Schema round-trip fills an absent `predicate_source` in with its "" default
		// (same class of fill-in noise `normalize`/other tests' comments call out).
		expect(affordance?.predicate_source ?? "").toBe("");

		const pulseFrameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_stinking_cloud/pulse",
		);
		const radius = (pulseFrameWrites[0]?.frame_write as Record<string, unknown>)
			.ForEachActorInRadius as Record<string, unknown>;
		expect(radius.predicate_source).toBe("roll_under(d20, 13)");
		const apply = (radius.body as Record<string, unknown>[])[0]?.ApplyStatus as Record<
			string,
			unknown
		>;
		expect(apply).toMatchObject({
			target_kind: "entity",
			target_ref: "Actor",
			condition_definition_id: "aoe_blast/condition/poisoned",
		});

		// zone_center omitted -> defaults to ActorSpatialRef (mobile aura), matching
		// compose.ts's own default.
		const castFrameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "aoe_blast/cast_stinking_cloud/success",
		);
		const inscribe = (castFrameWrites[0]?.frame_write as Record<string, unknown>)
			.Inscribe as Record<string, unknown>;
		expect(inscribe.location_ref).toBe("ActorSpatialRef");
		expect(radius.center_ref).toBe("ActorSpatialRef");
	});

	it("schedule omitted: compose.ts's own defaults apply (repeats 10, frequency_ms 6000, requires_subject_alive false)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "moonbeam",
				capability_id: "srd/probe/moonbeam", // avoid the srd/spell/* catalog-binding convention warning (#835)
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: {
						primitive: "ScheduledZone",
						zone_state_id: "srd/hazard/moonbeam",
						pulse: { primitive: "ModifyResource", delta: "0 - 2d10" },
					},
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const scheduleEffect = tableRows(manifest, "effect_definitions").find(
			(r) => r.effect_def_id === "srd/cast_moonbeam/schedule",
		);
		const schedule = JSON.parse(scheduleEffect?.parameters_schema_json as string);
		expect(schedule).toMatchObject({
			frequency_ms: 6000,
			repeats_remaining: 10,
			requires_subject_alive: false,
		});
	});

	it("workspace idempotency: a re-run upserts the marker def + schedule effect + BOTH consequence_templates' frame_writes, never duplicates", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const params = {
			bundle: "srd",
			id: "cloudkill",
			capability_id: "srd/probe/cloudkill", // avoid the srd/spell/* catalog-binding convention warning (#835)
			grant_to: entityKeys[0] as string,
			offered_when: { reach: "same_node" as const },
			action_class: "spell",
			effect: {
				primitive: "ForEachActorInRadius" as const,
				write: {
					primitive: "ScheduledZone" as const,
					zone_state_id: "srd/hazard/cloudkill",
					zone_center: "target" as const,
					pulse: { primitive: "ModifyResource" as const, delta: "0 - 5d8" },
				},
			},
		};
		await defineBehaviorToolDef.run(contextWith({ workspace }), params, "run-1");
		const second = await defineBehaviorToolDef.run(contextWith({ workspace }), params, "run-2");
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "spatial_state_definitions").filter(
				(r) => r.state_id === "srd/hazard/cloudkill",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "effect_definitions").filter(
				(r) => r.effect_def_id === "srd/cast_cloudkill/schedule",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "consequence_templates").filter((r) =>
				["srd/cast_cloudkill/success", "srd/cast_cloudkill/pulse"].includes(
					r.template_id as string,
				),
			),
		).toHaveLength(2);
		expect(
			tableRows(manifest, "consequence_frame_writes").filter(
				(r) => r.template_id === "srd/cast_cloudkill/success",
			),
		).toHaveLength(1); // the marker Inscribe only.
		expect(
			tableRows(manifest, "consequence_frame_writes").filter(
				(r) => r.template_id === "srd/cast_cloudkill/pulse",
			),
		).toHaveLength(1); // the ForEachActorInRadius pulse — NOT duplicated by the re-run.
	});

	it("equivalence: reproduces clusterRows([behavior], cfg)'s scheduled-zone output field-by-field, for BOTH the cast's success consequence and the pulse's own (#1968 proof)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const caster = entityKeys[0] as string;

		// The verb-driven side. bundle "srd" (not "aoe_blast"): the pulse's
		// ModifyResource body is HARDCODED to the literal resource id `srd/hp`
		// (compose.ts) — MF-VAL-214 rejects a cross-bundle ref from an owning bundle
		// that doesn't `depends_on` it. `casterNode`/`defaultCasterNode` stay
		// "aoe_blast/arena/center" — the real place node `runFireballSequence`
		// authored; only the SPELL's own id-namespace moves to "srd".
		const workspace = fakeWorkspace(finalToml);
		await seedSrdHp(workspace);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "cloudkill",
				capability_id: "srd/probe/cloudkill", // avoid the srd/spell/* catalog-binding convention warning (#835)
				display_name: "Cast Cloudkill",
				description: "A poison cloud.",
				tags: ["srd.spell", "srd.damage.poison"],
				grant_to: caster,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: {
						primitive: "ScheduledZone",
						zone_state_id: "srd/hazard/cloudkill",
						zone_intensity: 5,
						zone_center: "target",
						pulse: {
							primitive: "ModifyResource",
							delta: "cond(d20 >= 15, 0 - (5d8 / 2), 0 - 5d8)",
						},
						schedule: {
							repeats: 10,
							frequency_ms: 6000,
							requires_subject_alive: false,
							source: "srd/cloudkill/{Actor}/{tick}",
						},
					},
				},
			},
			"behavior-equivalence",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const actual = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		// The compose-layer side — the SAME builder, driven directly with the
		// EQUIVALENT ActorBehavior/BehaviorConfig (mirrors what author-moonbeam.ts/
		// author-stinking-cloud.ts/author-scheduled-damage-zones.ts/author-spell-
		// behavior.ts's Cloudkill entry do today).
		const behavior: ActorBehavior = {
			key: "cloudkill",
			capabilityId: "srd/probe/cloudkill",
			displayName: "Cast Cloudkill",
			emitCapability: true,
			capabilityDescription: "A poison cloud.",
			capabilityTags: ["srd.spell", "srd.damage.poison"],
			actionTags: ["srd.spell", "srd.damage.poison"],
			shape: "scheduled-zone",
			zoneStateId: "srd/hazard/cloudkill",
			zoneIntensity: 5,
			zoneCenterRef: "TargetSpatialRef",
			predicateSource: "",
			deltaSource: "cond(d20 >= 15, 0 - (5d8 / 2), 0 - 5d8)",
			scheduleRepeats: 10,
			scheduleFrequencyMs: 6000,
			requiresSubjectAlive: false,
			scheduleSource: "srd/cloudkill/{Actor}/{tick}",
			caster,
			casterNode: "aoe_blast/arena/center",
			selfEligible: false,
		};
		const cfg: BehaviorConfig = {
			bundleId: "srd",
			manifestPath: "",
			capPrefix: "spell",
			actionPrefix: "cast_",
			defaultCaster: caster,
			defaultCasterNode: "aoe_blast/arena/center",
			idNamespace: "srd",
		};
		// Round-trip through the SAME render->reparse cycle `actual` went through
		// (workspace.writeToml -> workspace.current() -> inspectManifest), mirroring
		// the single-target equivalence proof above.
		const expected = inspectManifest(
			renderSchemaManifest({ schema_version: "1.0.0", ...clusterRows([behavior], cfg) }),
		).manifest as Record<string, Record<string, unknown>[]>;

		const scopedActual = (table: string, matches: (r: Record<string, unknown>) => boolean) =>
			tableRows(actual, table).filter(matches);

		expect(
			normalize(
				scopedActual("capability_definitions", (r) => r.capability_id === "srd/probe/cloudkill"),
			),
		).toEqual(normalize(expected.capability_definitions));
		expect(
			normalize(scopedActual("action_definitions", (r) => r.action_id === "srd/cast_cloudkill")),
		).toEqual(normalize(expected.action_definitions));
		expect(
			normalize(
				scopedActual("consequence_templates", (r) =>
					String(r.template_id).includes("cast_cloudkill"),
				),
			),
		).toEqual(normalize(expected.consequence_templates));
		expect(
			normalize(
				scopedActual(
					"consequence_frame_writes",
					(r) => r.template_id === "srd/cast_cloudkill/success",
				),
			),
		).toEqual(
			normalize(
				(expected.consequence_frame_writes ?? []).filter(
					(r) => r.template_id === "srd/cast_cloudkill/success",
				),
			),
		);
		expect(
			normalize(
				scopedActual(
					"consequence_frame_writes",
					(r) => r.template_id === "srd/cast_cloudkill/pulse",
				),
			),
		).toEqual(
			normalize(
				(expected.consequence_frame_writes ?? []).filter(
					(r) => r.template_id === "srd/cast_cloudkill/pulse",
				),
			),
		);
		expect(
			normalize(
				scopedActual("effect_definitions", (r) =>
					String(r.effect_def_id).includes("cast_cloudkill"),
				),
			),
		).toEqual(normalize(expected.effect_definitions));
		expect(
			normalize(
				scopedActual("spatial_state_definitions", (r) => r.state_id === "srd/hazard/cloudkill"),
			),
		).toEqual(normalize(expected.spatial_state_definitions));
	});

	it("effect.write.zone_state_id is required, error names `effect.write.zone_state_id`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "no_zone_id",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "ScheduledZone",
							pulse: { primitive: "ModifyResource", delta: "0 - d6" },
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.zone_state_id`/);
	});

	it("effect.write.pulse is required, error names `effect.write.pulse`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "no_pulse",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "ScheduledZone", zone_state_id: "aoe_blast/hazard/x" },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.pulse`/);
	});

	it("pulse.primitive 'ModifyResource' requires pulse.delta, error names `effect.write.pulse.delta`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "no_delta",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "ScheduledZone",
							zone_state_id: "aoe_blast/hazard/x",
							pulse: { primitive: "ModifyResource" },
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.pulse\.delta`/);
	});

	it("pulse.primitive 'ApplyStatus' requires pulse.condition, error names `effect.write.pulse.condition`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "no_condition",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "ScheduledZone",
							zone_state_id: "aoe_blast/hazard/x",
							pulse: { primitive: "ApplyStatus" },
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.pulse\.condition`/);
	});

	it("pulse.condition must resolve to an authored condition_definitions row, error names `effect.write.pulse.condition`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "unknown_condition",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "ScheduledZone",
							zone_state_id: "aoe_blast/hazard/x",
							pulse: { primitive: "ApplyStatus", condition: "aoe_blast/condition/nope" },
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.pulse\.condition`/);
	});

	it("effect.shape set alongside ScheduledZone is rejected, naming `effect.shape`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_shape",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/sphere", radius: 10 },
						write: {
							primitive: "ScheduledZone",
							zone_state_id: "aoe_blast/hazard/x",
							pulse: { primitive: "ModifyResource", delta: "0 - d6" },
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.shape`/);
	});

	it("offered_when.target 'place' + ScheduledZone is an unsupported combo, names `effect.write.primitive`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					id: "bad_place",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "place" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "ScheduledZone",
							zone_state_id: "aoe_blast/hazard/x",
							pulse: { primitive: "ModifyResource", delta: "0 - d6" },
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.primitive`/);
	});
});

// ---------------------------------------------------------------------------
// spellkave_define_behavior — Clock (#1968 combat-sim finding C2): the
// SELF-TARGETED multi-ordinal "clock" shape (compose.ts's "clock", the
// death-saves death-and-dying pattern) — no new kernel primitive, just
// content-side verb sugar folding N `ModifyResource(actor="Actor", ...)`
// tally ordinals + M `ForEachActorInRadius(node_ball, ball_radius 0)`
// threshold ordinals (each wrapping an ApplyStatus/RemoveCondition on
// "Actor") into ONE define_behavior call.
// ---------------------------------------------------------------------------

describe("spellkave_define_behavior — Clock (#1968 finding C2)", () => {
	async function seedDeathSaveResources(workspace: AuthorWorkspace) {
		const rows = [
			{
				resource_definition_id: "srd/death_save_last_roll",
				bundle_id: "srd",
				display_name: "Death save — last d20 draw (scratch cell)",
				value_kind: "int",
				min_value: 0,
				max_value: 20,
				recovery_rule: "persistent",
				initial_value: 0,
			},
			{
				resource_definition_id: "srd/death_save_successes",
				bundle_id: "srd",
				display_name: "Death save successes",
				value_kind: "int",
				min_value: 0,
				max_value: 3,
				recovery_rule: "persistent",
				initial_value: 0,
			},
			{
				resource_definition_id: "srd/death_save_failures",
				bundle_id: "srd",
				display_name: "Death save failures",
				value_kind: "int",
				min_value: 0,
				max_value: 3,
				recovery_rule: "persistent",
				initial_value: 0,
			},
			{
				resource_definition_id: "srd/hp",
				bundle_id: "srd",
				display_name: "Hit Points",
				value_kind: "int",
				min_value: -20,
				max_value: 30,
				recovery_rule: "long_rest",
				initial_value: 10,
			},
		];
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{ bundle: "srd", kind: "resource_definitions", rows },
			"death-save-resources",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	}

	async function seedDeathSaveConditions(workspace: AuthorWorkspace) {
		for (const id of ["srd/stable", "srd/dead"]) {
			const result = await defineConditionToolDef.run(
				contextWith({ workspace }),
				{ bundle: "srd", id: id.replace("srd/", "") },
				`condition-${id}`,
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		}
	}

	// The FULL fixture-exact shape (archive/world-fixtures/srd/base/death-saves.toml's
	// OWN 5-tally/2-threshold roll consequence, ordinals 0-6) — reused by both
	// the folding test and the equivalence proof below.
	const DEATH_SAVE_TALLIES = [
		{
			resource: "srd/death_save_last_roll",
			delta: "d20 - actor.stat('srd/death_save_last_roll')",
		},
		{
			resource: "srd/death_save_successes",
			predicate: "actor.stat('srd/death_save_last_roll') >= 10",
		},
		{
			resource: "srd/death_save_failures",
			predicate: "actor.stat('srd/death_save_last_roll') < 10",
		},
		{
			resource: "srd/death_save_failures",
			predicate: "actor.stat('srd/death_save_last_roll') == 1",
		},
		{ resource: "srd/hp", predicate: "actor.stat('srd/death_save_last_roll') == 20" },
	];
	const DEATH_SAVE_THRESHOLDS = [
		{
			when: "actor.stat('srd/death_save_successes') >= 3 || actor.stat('srd/death_save_last_roll') == 20",
			apply_status: "srd/stable",
		},
		{ when: "actor.stat('srd/death_save_failures') >= 3", apply_status: "srd/dead" },
	];
	const DEATH_SAVE_ELIGIBILITY_GATE =
		"actor.status('srd/dying') == true && actor.status('srd/stable') == false && actor.status('srd/dead') == false";

	function deathSaveParams(entityKey: string) {
		return {
			bundle: "srd",
			id: "death_save/roll",
			action_prefix: "",
			capability_id: "srd/capability/death_save",
			grant_to: entityKey,
			offered_when: { reach: "same_node" as const, target: "self" as const },
			action_class: "clock",
			effect: {
				primitive: "ForEachActorInRadius" as const,
				per_target_gate: DEATH_SAVE_ELIGIBILITY_GATE,
				write: {
					primitive: "Clock" as const,
					tallies: DEATH_SAVE_TALLIES,
					thresholds: DEATH_SAVE_THRESHOLDS,
				},
			},
		};
	}

	it("folds tallies (ordinals 0..N-1) then thresholds (ordinals N..), every write targeting Actor alone; affordance carries the eligibility gate, self_eligible true", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveResources(workspace);
		await seedDeathSaveConditions(workspace);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			deathSaveParams(entityKeys[0] as string),
			"death-save-clock",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		const actionId = "srd/death_save/roll";
		const frameWrites = tableRows(manifest, "consequence_frame_writes")
			.filter((r) => String(r.template_id).startsWith(actionId))
			.sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
		expect(frameWrites).toHaveLength(7);

		expect(frameWrites[0]?.frame_write).toMatchObject({
			ModifyResource: {
				actor: "Actor",
				resource: "srd/death_save_last_roll",
				delta_source: "d20 - actor.stat('srd/death_save_last_roll')",
			},
		});
		expect(frameWrites[1]?.frame_write).toMatchObject({
			ModifyResource: {
				actor: "Actor",
				resource: "srd/death_save_successes",
				delta_source: "cond(actor.stat('srd/death_save_last_roll') >= 10, 1, 0)",
			},
		});
		expect(frameWrites[4]?.frame_write).toMatchObject({
			ModifyResource: {
				actor: "Actor",
				resource: "srd/hp",
				delta_source: "cond(actor.stat('srd/death_save_last_roll') == 20, 1, 0)",
			},
		});
		expect(frameWrites[5]?.frame_write).toMatchObject({
			ForEachActorInRadius: {
				center_ref: "ActorSpatialRef",
				shape_id: "core/area/node_ball",
				predicate_source:
					"actor.stat('srd/death_save_successes') >= 3 || actor.stat('srd/death_save_last_roll') == 20",
				body: [
					{
						ApplyStatus: {
							target_kind: "entity",
							target_ref: "Actor",
							condition_definition_id: "srd/stable",
						},
					},
				],
			},
		});
		expect(frameWrites[6]?.frame_write).toMatchObject({
			ForEachActorInRadius: {
				predicate_source: "actor.stat('srd/death_save_failures') >= 3",
				body: [
					{
						ApplyStatus: {
							target_kind: "entity",
							target_ref: "Actor",
							condition_definition_id: "srd/dead",
						},
					},
				],
			},
		});

		const affordance = tableRows(manifest, "affordance_templates").find((r) =>
			String(r.template_id).includes("death_save/roll"),
		);
		expect(affordance?.predicate_source).toBe(DEATH_SAVE_ELIGIBILITY_GATE);
		const action = tableRows(manifest, "action_definitions").find((r) => r.action_id === actionId);
		expect(action).toMatchObject({
			self_eligible: true,
			required_capability: "srd/capability/death_save",
		});
	});

	it("workspace idempotency: a re-run upserts, never duplicates any tally/threshold row", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveResources(workspace);
		await seedDeathSaveConditions(workspace);
		const params = deathSaveParams(entityKeys[0] as string);
		await defineBehaviorToolDef.run(contextWith({ workspace }), params, "run-1");
		const second = await defineBehaviorToolDef.run(contextWith({ workspace }), params, "run-2");
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter((r) =>
			String(r.template_id).startsWith("srd/death_save/roll"),
		);
		expect(frameWrites).toHaveLength(7);
	});

	it("shrink: re-authoring with FEWER tallies/thresholds clears the dropped entries' ordinals (clear-under-parent)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveResources(workspace);
		await seedDeathSaveConditions(workspace);
		const full = deathSaveParams(entityKeys[0] as string);
		await defineBehaviorToolDef.run(contextWith({ workspace }), full, "run-1");

		const shrunk = {
			...full,
			effect: {
				...full.effect,
				write: {
					...full.effect.write,
					tallies: DEATH_SAVE_TALLIES.slice(0, 1),
					thresholds: [DEATH_SAVE_THRESHOLDS[0] as (typeof DEATH_SAVE_THRESHOLDS)[number]],
				},
			},
		};
		const second = await defineBehaviorToolDef.run(contextWith({ workspace }), shrunk, "run-2");
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter((r) =>
			String(r.template_id).startsWith("srd/death_save/roll"),
		);
		expect(frameWrites).toHaveLength(2);
		const rendered = JSON.stringify(frameWrites);
		expect(rendered).not.toContain("srd/death_save_failures");
		expect(rendered).not.toContain("srd/dead");
	});

	it("rename: swapping a threshold's apply_status condition clears the old condition id, never leaves it behind", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveResources(workspace);
		await seedDeathSaveConditions(workspace);
		await defineConditionToolDef.run(
			contextWith({ workspace }),
			{ bundle: "srd", id: "petrified_by_fear" },
			"condition-petrified",
		);
		const full = deathSaveParams(entityKeys[0] as string);
		await defineBehaviorToolDef.run(contextWith({ workspace }), full, "run-1");

		const renamed = {
			...full,
			effect: {
				...full.effect,
				write: {
					...full.effect.write,
					thresholds: [
						DEATH_SAVE_THRESHOLDS[0] as (typeof DEATH_SAVE_THRESHOLDS)[number],
						{
							when: "actor.stat('srd/death_save_failures') >= 3",
							apply_status: "srd/petrified_by_fear",
						},
					],
				},
			},
		};
		const second = await defineBehaviorToolDef.run(contextWith({ workspace }), renamed, "run-2");
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter((r) =>
			String(r.template_id).startsWith("srd/death_save/roll"),
		);
		expect(frameWrites).toHaveLength(7);
		const rendered = JSON.stringify(frameWrites);
		expect(rendered).toContain("srd/petrified_by_fear");
		expect(rendered).not.toContain('"condition_definition_id":"srd/dead"');
	});

	// #1968 PROOF item 2: does the clock shape reproduce the ORIGINAL
	// `archive/world-fixtures/srd/base/death-saves.toml`'s ACTUAL committed roll
	// consequence (`srd/death_save/roll/consequence`, ordinals 0-6), not just
	// something equivalent-shaped? This used to read the real fixture offline
	// (via a scratch `core`+`srd` symlink chain + `createLocalAuthorTarget`) and
	// compare the verb-driven output field-by-field at test time; the srd
	// bundle was deleted outright (world-fixtures-retirement Phase D, task 4.4)
	// — there is no live source left to re-read, so the comparison target below
	// is the value CAPTURED from that live read the last time this test ran
	// against the real fixture (2026-08-14, immediately before deletion,
	// verified passing) — the equivalence claim itself is now historical (the
	// verb-authored output reproduced the original hand-authored content at the
	// moment of migration), but the regression-catching value survives: this
	// test still fails if `defineBehaviorToolDef`'s clock-shape output ever
	// silently drifts from that captured value.
	it("equivalence: reproduces the original srd/base/death-saves.toml's srd/death_save/roll/consequence ordinals field-by-field (#1968 proof, captured 2026-08-14 before srd's deletion)", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveResources(workspace);
		await seedDeathSaveConditions(workspace);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			deathSaveParams(entityKeys[0] as string),
			"death-save-equivalence",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const actual = tableRows(manifest, "consequence_frame_writes")
			.filter((r) => String(r.template_id).startsWith("srd/death_save/roll"))
			.sort((a, b) => Number(a.ordinal) - Number(b.ordinal))
			.map((r) => normalize(r.frame_write));

		const expected: unknown[] = [
			{
				ModifyResource: {
					actor: "Actor",
					delta_source: "d20 - actor.stat('srd/death_save_last_roll')",
					resource: "srd/death_save_last_roll",
				},
			},
			{
				ModifyResource: {
					actor: "Actor",
					delta_source: "cond(actor.stat('srd/death_save_last_roll') >= 10, 1, 0)",
					resource: "srd/death_save_successes",
				},
			},
			{
				ModifyResource: {
					actor: "Actor",
					delta_source: "cond(actor.stat('srd/death_save_last_roll') < 10, 1, 0)",
					resource: "srd/death_save_failures",
				},
			},
			{
				ModifyResource: {
					actor: "Actor",
					delta_source: "cond(actor.stat('srd/death_save_last_roll') == 1, 1, 0)",
					resource: "srd/death_save_failures",
				},
			},
			{
				ModifyResource: {
					actor: "Actor",
					delta_source: "cond(actor.stat('srd/death_save_last_roll') == 20, 1, 0)",
					resource: "srd/hp",
				},
			},
			{
				ForEachActorInRadius: {
					body: [
						{
							ApplyStatus: {
								condition_definition_id: "srd/stable",
								target_kind: "entity",
								target_ref: "Actor",
							},
						},
					],
					center_ref: "ActorSpatialRef",
					predicate_source:
						"actor.stat('srd/death_save_successes') >= 3 || actor.stat('srd/death_save_last_roll') == 20",
					shape_id: "core/area/node_ball",
					shape_params_json: { ball_radius: 0 },
				},
			},
			{
				ForEachActorInRadius: {
					body: [
						{
							ApplyStatus: {
								condition_definition_id: "srd/dead",
								target_kind: "entity",
								target_ref: "Actor",
							},
						},
					],
					center_ref: "ActorSpatialRef",
					predicate_source: "actor.stat('srd/death_save_failures') >= 3",
					shape_id: "core/area/node_ball",
					shape_params_json: { ball_radius: 0 },
				},
			},
		];

		expect(expected.length, "the captured comparison value must still carry all 7 ordinals").toBe(
			7,
		);
		expect(actual).toEqual(expected);
	});

	it("effect.write.tallies is required (non-empty), error names `effect.write.tallies`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveConditions(workspace);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "srd",
					id: "no_tallies",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "self" },
					action_class: "clock",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "Clock", thresholds: DEATH_SAVE_THRESHOLDS },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.tallies`/);
	});

	it("effect.write.thresholds is required (non-empty), error names `effect.write.thresholds`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveResources(workspace);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "srd",
					id: "no_thresholds",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "self" },
					action_class: "clock",
					effect: {
						primitive: "ForEachActorInRadius",
						write: { primitive: "Clock", tallies: DEATH_SAVE_TALLIES },
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.thresholds`/);
	});

	it("a threshold with BOTH apply_status and remove_condition (or neither) is rejected, naming `effect.write.thresholds`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveResources(workspace);
		await seedDeathSaveConditions(workspace);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "srd",
					id: "bad_threshold",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "self" },
					action_class: "clock",
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "Clock",
							tallies: DEATH_SAVE_TALLIES,
							thresholds: [{ when: "1 == 1" }],
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.thresholds`/);
	});

	it("offered_when.target must be 'self' for Clock — omitted is rejected, naming `offered_when.target`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveResources(workspace);
		await seedDeathSaveConditions(workspace);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "srd",
					id: "not_self",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node" },
					action_class: "clock",
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "Clock",
							tallies: DEATH_SAVE_TALLIES,
							thresholds: DEATH_SAVE_THRESHOLDS,
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`offered_when\.target`/);
	});

	it("effect.shape set alongside Clock is rejected, naming `effect.shape`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveResources(workspace);
		await seedDeathSaveConditions(workspace);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "srd",
					id: "bad_shape",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "self" },
					action_class: "clock",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/node_ball", radius: 0 },
						write: {
							primitive: "Clock",
							tallies: DEATH_SAVE_TALLIES,
							thresholds: DEATH_SAVE_THRESHOLDS,
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.shape`/);
	});

	it("effect.write.tallies[].resource must resolve to an authored resource_definitions row, error names `effect.write.tallies`", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await seedDeathSaveConditions(workspace);
		await expect(
			defineBehaviorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "srd",
					id: "unknown_resource",
					grant_to: entityKeys[0] as string,
					offered_when: { reach: "same_node", target: "self" },
					action_class: "clock",
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "Clock",
							tallies: [{ resource: "srd/nope", delta: "1" }],
							thresholds: DEATH_SAVE_THRESHOLDS,
						},
					},
				},
				"behavior",
			),
		).rejects.toThrow(/`effect\.write\.tallies`/);
	});
});

describe("spellkave_define_behavior — communication_speech_act_id (#1968 verb-UX round 4)", () => {
	it("sets outcome_templates.communication_speech_act_id when passed, omits it when not", async () => {
		const { entityKeys, finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const result = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "persuade",
				capability_id: "aoe_blast/social/persuade",
				action_prefix: "",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "social",
				communication_speech_act_id: "aoe_blast/persuade",
				effect: {
					primitive: "ForEachActorInRadius",
					per_target_gate: "d20 >= 15",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "1" },
				},
			},
			"behavior",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const outcome = tableRows(manifest, "outcome_templates").find(
			(r) => r.outcome_template_id === "aoe_blast/persuade/outcome",
		);
		expect(outcome?.communication_speech_act_id).toBe("aoe_blast/persuade");

		const noSpeechAct = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "aoe_blast",
				id: "attack",
				grant_to: entityKeys[0] as string,
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "0 - 1" },
				},
			},
			"behavior",
		);
		expect((noSpeechAct.details as VerbResult).ok, JSON.stringify(noSpeechAct.details)).toBe(true);
		const manifest2 = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;
		const outcome2 = tableRows(manifest2, "outcome_templates").find(
			(r) => r.outcome_template_id === "aoe_blast/cast_attack/outcome",
		);
		expect(outcome2 && "communication_speech_act_id" in outcome2).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// 6. spellkave_write_rows — the generic long-tail escape hatch (#1968 backlog:
//    "fixtures become verb-call scripts"). Kernel/substrate content the
//    narrower verbs were never shaped for.
// ---------------------------------------------------------------------------

describe("spellkave_write_rows", () => {
	it("authoring kind 'bundles' itself does NOT auto-scaffold a conflicting generic header (a foundational bundle's own depends_on is authoritative)", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "core",
				kind: "bundles",
				rows: [
					{
						bundle_id: "core",
						display_name: "spellkave",
						author: "spellkave",
						version: "1.0.0",
						depends_on: [],
						description: "Core baseline world for spellkave.",
					},
				],
			},
			"write-rows",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const bundleRows = tableRows(manifest, "bundles");
		expect(bundleRows).toHaveLength(1);
		expect(bundleRows[0]).toMatchObject({ bundle_id: "core", depends_on: [] });
	});

	it("authors rows of a kind none of the other verbs cover, self-scaffolding the bundle header", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "extent_kind_definitions",
				rows: [
					{
						kind_id: "kernel_pack/tiny",
						bundle_id: "kernel_pack",
						resolution_shape: "PlaceGraph",
						description: "A tiny extent.",
					},
					{
						kind_id: "kernel_pack/huge",
						bundle_id: "kernel_pack",
						resolution_shape: "Party",
						description: "A huge extent.",
					},
				],
			},
			"write-rows",
		);
		const details = result.details as VerbResult & { kind?: string };
		expect(details.ok, JSON.stringify(result.details)).toBe(true);
		expect(details.kind).toBe("extent_kind_definitions");
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "bundles").map((r) => r.bundle_id)).toContain("kernel_pack");
		expect(tableRows(manifest, "extent_kind_definitions")).toHaveLength(2);
	});

	it("defaults bundle_id onto a row that omits it, only when the kind's schema has that column", async () => {
		const workspace = fakeWorkspace(null);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "extent_kind_definitions",
				rows: [
					{
						kind_id: "kernel_pack/tiny",
						resolution_shape: "PlaceGraph",
						description: "A tiny extent.",
					},
				],
			},
			"write-rows",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const row = tableRows(manifest, "extent_kind_definitions")[0];
		expect(row?.bundle_id).toBe("kernel_pack");
	});

	it("reports description_per_row_allowed from the schema, not a hardcoded guess", async () => {
		const workspace = fakeWorkspace(null);
		const withDescription = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "resource_definitions",
				rows: [
					{
						resource_definition_id: "kernel_pack/hp",
						bundle_id: "kernel_pack",
						display_name: "HP",
						value_kind: "int",
						min_value: 0,
						max_value: 10,
						recovery_rule: "none",
					},
				],
			},
			"write-rows",
		);
		expect(
			(withDescription.details as { description_per_row_allowed?: boolean })
				.description_per_row_allowed,
		).toBe(true);

		const noDescription = await writeRowsToolDef.run(
			contextWith({ workspace: fakeWorkspace(null) }),
			{
				bundle: "kernel_pack",
				kind: "place_edge_affordance",
				rows: [
					{
						edge_key: "kernel_pack/edge/a-b",
						affordance_template_id: "core/affordance/traverse_open_portal",
					},
				],
			},
			"write-rows",
		);
		expect(
			(noDescription.details as { description_per_row_allowed?: boolean })
				.description_per_row_allowed,
		).toBe(false);
	});

	it("rejects an unsupported kind loudly, naming the offending param and the valid set", async () => {
		await expect(
			writeRowsToolDef.run(
				contextWith(),
				{ bundle: "kernel_pack", kind: "not_a_real_kind", rows: [{}] },
				"write-rows",
			),
		).rejects.toThrow(/unsupported kind 'not_a_real_kind'.*`kind`/s);
	});

	it("rejects the loader-only `include` directive kind (never silently no-ops)", async () => {
		await expect(
			writeRowsToolDef.run(
				contextWith(),
				{ bundle: "kernel_pack", kind: "include", rows: [{ path: "base/x.toml" }] },
				"write-rows",
			),
		).rejects.toThrow(/unsupported kind 'include'/);
	});

	it("persists a row that carries only a non-fatal WARNING diagnostic (matches r_apply_world_manifest's real admission boundary), surfacing the warning rather than hiding it", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "equipment_slot_definitions",
				rows: [
					{
						// Cross-namespace slot_id (not "kernel_pack/..."): MF-VAL-291,
						// severity "warning" — the CURRENTLY COMMITTED packages/spellkave-mechanics/fixtures/core
						// carries the same pattern today (e.g. "homebrew/horn-sheath").
						slot_id: "homebrew/foo-slot",
						bundle_id: "kernel_pack",
						label: "Foo Slot",
						default_compatibility_predicate: "true",
					},
				],
			},
			"write-rows",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(result.details)).toBe(true);
		expect(
			details.diagnostics?.some((d) => d.code === "MF-VAL-291" && d.severity === "warning"),
		).toBe(true);
		expect(workspace.current()).not.toBeNull();
	});

	it("never persists on a validation failure — the whole merged manifest is the gate", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "entity_tag",
				// Dangling ref: no [[entities]] row named this in the manifest.
				rows: [{ entity_key: "kernel_pack/nonexistent", tag: "hidden", bundle_id: "kernel_pack" }],
			},
			"write-rows",
		);
		expect((result.details as VerbResult).ok).toBe(false);
		expect(workspace.current()).toBeNull();
	});

	it("maps a diagnostic back to rows[i] when the validator path names this call's own row", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "entity_tag",
				rows: [
					{ entity_key: "kernel_pack/one", tag: "hidden", bundle_id: "kernel_pack" },
					{ entity_key: "kernel_pack/nonexistent", tag: "hidden", bundle_id: "kernel_pack" },
				],
			},
			"write-rows",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		const mapped = details.diagnostics?.find((d) => d.message.includes("nonexistent"));
		expect(mapped?.param).toBe("rows[1].entity_key");
	});

	// -------------------------------------------------------------------------
	// #1968 combat-sim finding A2: `spellkave_write_rows`-authored actions/
	// affordances get NO automatic `spatial_niche_attachments` row the way
	// `spellkave_define_behavior` grants for free — every death-save roll in
	// the discovery pass silently failed until one was hand-authored. A
	// non-blocking WARNING (never a block: write_rows is the generic escape
	// hatch, auto-magic attachment would be wrong here) closes the silent half.
	// -------------------------------------------------------------------------
	describe("A2: missing spatial_niche_attachment warning", () => {
		it("warns when a write_rows-authored affordance_templates row's niche has NO spatial_niche_attachments row anywhere in the workspace", async () => {
			const workspace = fakeWorkspace(null);
			const context = contextWith({ workspace });
			// A minimal, independently-valid capability + outcome pair (borrowed
			// from a REAL granted behavior, so the affordance row below references
			// only already-authored ids) — the niche under test is a FRESH,
			// deliberately unattached one.
			await authorPlaceToolDef.run(
				context,
				{ bundle: "niche_probe", nodes: [{ id: "niche_probe/room" }], edges: [] },
				"place",
			);
			const spawn = await spawnToolDef.run(
				context,
				{ bundle: "niche_probe", entity_def: "npc", at: "niche_probe/room", count: 1 },
				"spawn",
			);
			const casterKey = ((spawn.details as VerbResult).entity_keys as string[])[0] as string;
			await defineResourceToolDef.run(
				context,
				{
					bundle: "niche_probe",
					id: "hp",
					display_name: "Hit Points",
					min_value: 0,
					max_value: 10,
					recovery_rule: "long_rest",
					initial_value: 10,
				},
				"resource",
			);
			const behavior = await defineBehaviorToolDef.run(
				context,
				{
					bundle: "niche_probe",
					id: "attached_source",
					grant_to: casterKey,
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/node_ball", radius: 0 },
						per_target_gate: "",
						write: { primitive: "ModifyResource", resource: "niche_probe/hp", delta: "-1" },
					},
				},
				"behavior",
			);
			expect((behavior.details as VerbResult).ok, JSON.stringify(behavior.details)).toBe(true);

			const result = await writeRowsToolDef.run(
				context,
				{
					bundle: "niche_probe",
					kind: "affordance_templates",
					rows: [
						{
							template_id: "niche_probe/unattached/affordance",
							niche_id: "niche_probe/unattached_niche",
							capability_id: "niche_probe/spell/attached_source",
							display_name: "unattached probe",
							predicate_bool: true,
							outcome_template_id: "niche_probe/cast_attached_source/outcome",
							range_m: 0,
						},
					],
				},
				"write-rows",
			);
			const details = result.details as VerbResult & { attachment_warnings?: string[] };
			expect(details.ok, JSON.stringify(result.details)).toBe(true);
			expect(details.attachment_warnings).toEqual([
				expect.stringContaining("niche_probe/unattached_niche"),
			]);
			const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
			expect(text).toContain("WARNING (#1968 A2)");
			expect(text).toContain("niche_probe/unattached_niche");
		});

		it("does NOT warn once a spatial_niche_attachments row covers the niche (workspace-authored)", async () => {
			const workspace = fakeWorkspace(null);
			const context = contextWith({ workspace });
			await authorPlaceToolDef.run(
				context,
				{ bundle: "niche_probe2", nodes: [{ id: "niche_probe2/room" }], edges: [] },
				"place",
			);
			await writeRowsToolDef.run(
				context,
				{
					bundle: "niche_probe2",
					kind: "capability_definitions",
					rows: [
						{
							capability_id: "niche_probe2/spell/attached",
							actor_kind: "entity",
							display_name: "attached",
							description: "",
						},
					],
				},
				"cap",
			);
			await writeRowsToolDef.run(
				context,
				{
					bundle: "niche_probe2",
					kind: "outcome_templates",
					rows: [
						{
							outcome_template_id: "niche_probe2/attached/outcome",
							consequence_template_id: "niche_probe2/attached/consequence",
							display_name: "attached",
							manipulation_action_id: "niche_probe2/attached",
							outcome_bool: true,
							sense_visibility: "local",
						},
					],
				},
				"outcome",
			);
			await writeRowsToolDef.run(
				context,
				{
					bundle: "niche_probe2",
					kind: "spatial_niche_attachments",
					rows: [
						{
							niche_id: "niche_probe2/covered_niche",
							place_node_id: "niche_probe2/room",
							visibility: "Public",
							condition_bool: true,
							ecological_invariant: false,
						},
					],
				},
				"attach",
			);
			const result = await writeRowsToolDef.run(
				context,
				{
					bundle: "niche_probe2",
					kind: "affordance_templates",
					rows: [
						{
							template_id: "niche_probe2/covered/affordance",
							niche_id: "niche_probe2/covered_niche",
							capability_id: "niche_probe2/spell/attached",
							display_name: "covered probe",
							predicate_bool: true,
							outcome_template_id: "niche_probe2/attached/outcome",
							range_m: 0,
						},
					],
				},
				"write-rows",
			);
			const details = result.details as VerbResult & { attachment_warnings?: string[] };
			expect(details.ok, JSON.stringify(result.details)).toBe(true);
			expect(details.attachment_warnings).toBeUndefined();
		});

		it("warns for a write_rows-authored action_definitions row whose derived `capability:<id>` niche has no attachment", async () => {
			const workspace = fakeWorkspace(null);
			const context = contextWith({ workspace });
			await writeRowsToolDef.run(
				context,
				{
					bundle: "niche_probe3",
					kind: "capability_definitions",
					rows: [
						{
							capability_id: "niche_probe3/spell/unattached",
							actor_kind: "entity",
							display_name: "unattached",
							description: "",
						},
					],
				},
				"cap",
			);
			await writeRowsToolDef.run(
				context,
				{
					bundle: "niche_probe3",
					kind: "consequence_templates",
					rows: [{ template_id: "niche_probe3/unattached/consequence" }],
				},
				"consequence",
			);
			const result = await writeRowsToolDef.run(
				context,
				{
					bundle: "niche_probe3",
					kind: "action_definitions",
					rows: [
						{
							action_id: "niche_probe3/unattached_action",
							required_capability: "niche_probe3/spell/unattached",
							on_success: "niche_probe3/unattached/consequence",
							display_name: "unattached action",
							cost_time_ms: 1000,
							self_eligible: false,
						},
					],
				},
				"write-rows",
			);
			const details = result.details as VerbResult & { attachment_warnings?: string[] };
			expect(details.ok, JSON.stringify(result.details)).toBe(true);
			expect(details.attachment_warnings).toEqual([
				expect.stringContaining("capability:niche_probe3/spell/unattached"),
			]);
		});
	});
});

// ---------------------------------------------------------------------------
// 7. The four higher-level SATELLITE-FOLDING verbs (#1968 — fold `*_tag`/
// `roll_table_entries`/`spatial_niche_attachments`/`entity_definition_initial_*`
// satellites into their parent-row verb, one call instead of one call per row).
// ---------------------------------------------------------------------------

describe("spellkave_define_entity_type", () => {
	it("authors an entity_definitions row + every satellite in one call, self-scaffolding the [[bundles]] header", async () => {
		const workspace = fakeWorkspace(null);
		// MF-VAL-253/254/255 (Fatal) require every entity_definition_initial_*
		// seed to resolve — seed the object_state/capability/condition
		// definitions the satellites below reference FIRST, via the generic
		// escape hatch (this test is about the entity-type verb's OWN fold, not
		// about re-proving define_condition).
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "object_state_definitions",
				rows: [
					{
						state_id: "kernel_pack/sharpness",
						bundle_id: "kernel_pack",
						target_kind: "entity",
						display_name: "Sharpness",
					},
				],
			},
			"seed-state",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "capability_definitions",
				rows: [
					{
						capability_id: "kernel_pack/capability/cut",
						bundle_id: "kernel_pack",
						actor_kind: "npc",
						display_name: "Cut",
						description: "Innate cutting capability.",
					},
				],
			},
			"seed-capability",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "condition_definitions",
				rows: [
					{
						condition_definition_id: "kernel_pack/condition/blessed",
						bundle_id: "kernel_pack",
						display_name: "Blessed",
						gate_predicate_source: "",
					},
				],
			},
			"seed-condition",
		);

		const result = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "item/sword",
				display_name: "Iron Sword",
				description: "A plain iron blade.",
				tags: ["item", "weapon"],
				stackable: false,
				initial_states: [{ state: "kernel_pack/sharpness", value_int: 1 }],
				initial_capabilities: [{ capability: "kernel_pack/capability/cut" }],
				initial_conditions: [{ condition: "kernel_pack/condition/blessed", duration_ticks: 100 }],
			},
			"entity-type",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "bundles").map((r) => r.bundle_id)).toContain("kernel_pack");
		const entityDef = tableRows(manifest, "entity_definitions").find(
			(r) => r.entity_def_id === "kernel_pack/item/sword",
		);
		expect(entityDef).toMatchObject({
			entity_def_id: "kernel_pack/item/sword",
			bundle_id: "kernel_pack",
			display_name: "Iron Sword",
			description: "A plain iron blade.",
			stackable: false,
		});
		expect(
			tableRows(manifest, "entity_definition_tag")
				.filter((r) => r.entity_def_id === "kernel_pack/item/sword")
				.map((r) => r.tag)
				.sort(),
		).toEqual(["item", "weapon"]);
		expect(tableRows(manifest, "entity_definition_initial_state")).toMatchObject([
			{ entity_def_id: "kernel_pack/item/sword", state_id: "kernel_pack/sharpness", value_int: 1 },
		]);
		expect(tableRows(manifest, "entity_definition_initial_capability")).toMatchObject([
			{ entity_def_id: "kernel_pack/item/sword", capability_id: "kernel_pack/capability/cut" },
		]);
		expect(tableRows(manifest, "entity_definition_initial_condition")).toMatchObject([
			{
				entity_def_id: "kernel_pack/item/sword",
				condition_definition_id: "kernel_pack/condition/blessed",
				// #1968 backlog item 2: u64 fields cross the wasm/JS boundary as a
				// digit STRING (never a bare JSON number) — see
				// `spellkave-validate-wasm::stringify_u64_fields`.
				duration_ticks: "100",
			},
		]);
	});

	it("tags folding: N tags become N entity_definition_tag rows, zero tags means zero rows", async () => {
		const workspace = fakeWorkspace(null);
		await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "npc/goblin", display_name: "Goblin" },
			"entity-type",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "entity_definition_tag").filter(
				(r) => r.entity_def_id === "kernel_pack/npc/goblin",
			),
		).toHaveLength(0);
	});

	it("a dangling `initial_capabilities` seed ref maps the diagnostic to `initial_capabilities` (MF-VAL-254), not persisted", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "npc/goblin",
				display_name: "Goblin",
				initial_capabilities: [{ capability: "kernel_pack/capability/nonexistent" }],
			},
			"entity-type",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-254")).toBe(true);
		expect(workspace.current()).toBeNull();
	});

	it("initial_containment/initial_equipment folding: each param entry becomes its own structural satellite row (sk-9ll.5)", async () => {
		const workspace = fakeWorkspace(null);
		// The two child definitions the parent's containment/equipment rows FK to,
		// plus the equipment_slot_definitions row the equipment seed's slot_id
		// resolves against (MF-VAL-311..313 slot-compatibility class).
		await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "item/quiver", display_name: "Quiver" },
			"child-quiver",
		);
		await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "item/scimitar", display_name: "Scimitar" },
			"child-scimitar",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "equipment_slot_definitions",
				rows: [
					{
						slot_id: "kernel_pack/main_hand",
						bundle_id: "kernel_pack",
						label: "Main Hand",
						default_compatibility_predicate: "true",
					},
				],
			},
			"seed-slot",
		);

		const result = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "npc/goblin",
				display_name: "Goblin",
				initial_containment: [{ contained_entity_def_id: "kernel_pack/item/quiver", quantity: 1 }],
				initial_equipment: [
					{
						equipped_entity_def_id: "kernel_pack/item/scimitar",
						slot_id: "kernel_pack/main_hand",
					},
				],
			},
			"entity-type",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "entity_definition_initial_containment").filter(
				(r) => r.entity_def_id === "kernel_pack/npc/goblin",
			),
		).toMatchObject([
			{
				entity_def_id: "kernel_pack/npc/goblin",
				contained_entity_def_id: "kernel_pack/item/quiver",
				// #1968 backlog item 2: u64 fields cross the wasm/JS boundary as a
				// digit STRING (never a bare JSON number).
				quantity: "1",
			},
		]);
		expect(
			tableRows(manifest, "entity_definition_initial_equipment").filter(
				(r) => r.entity_def_id === "kernel_pack/npc/goblin",
			),
		).toMatchObject([
			{
				entity_def_id: "kernel_pack/npc/goblin",
				equipped_entity_def_id: "kernel_pack/item/scimitar",
				slot_id: "kernel_pack/main_hand",
			},
		]);
	});

	it("#1968 workspace idempotency: a re-run with fewer containment/equipment rows clears the stale ones (satellite-shrink)", async () => {
		const workspace = fakeWorkspace(null);
		await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "item/quiver", display_name: "Quiver" },
			"child-quiver",
		);
		await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "item/scimitar", display_name: "Scimitar" },
			"child-scimitar",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "equipment_slot_definitions",
				rows: [
					{
						slot_id: "kernel_pack/main_hand",
						bundle_id: "kernel_pack",
						label: "Main Hand",
						default_compatibility_predicate: "true",
					},
				],
			},
			"seed-slot",
		);

		const first = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "npc/goblin",
				display_name: "Goblin",
				initial_containment: [{ contained_entity_def_id: "kernel_pack/item/quiver" }],
				initial_equipment: [
					{
						equipped_entity_def_id: "kernel_pack/item/scimitar",
						slot_id: "kernel_pack/main_hand",
					},
				],
			},
			"run-1",
		);
		expect((first.details as VerbResult).ok, JSON.stringify(first.details)).toBe(true);

		// Re-run with NEITHER satellite: both must be cleared, not left behind.
		const second = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "npc/goblin", display_name: "Goblin (unarmed)" },
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "entity_definition_initial_containment").filter(
				(r) => r.entity_def_id === "kernel_pack/npc/goblin",
			),
		).toHaveLength(0);
		expect(
			tableRows(manifest, "entity_definition_initial_equipment").filter(
				(r) => r.entity_def_id === "kernel_pack/npc/goblin",
			),
		).toHaveLength(0);
	});

	it("a direct self-containment cycle is rejected fatally (MF-VAL-314), not persisted — reuses the server-side cycle check rather than re-implementing it", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "item/ouroboros",
				display_name: "Ouroboros",
				initial_containment: [{ contained_entity_def_id: "kernel_pack/item/ouroboros" }],
			},
			"entity-type",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-314")).toBe(true);
		expect(workspace.current()).toBeNull();
	});
});

describe("spellkave_define_roll_table", () => {
	it("authors a roll_tables row + ordered entries (+ tag satellites) in one call, deriving authored_order/entry ids from array position", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineRollTableToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "d6",
				display_name: "d6",
				result_kind: "int",
				description: "A basic six-sided roll table.",
				tags: ["die", "core"],
				entries: [
					{ result_ref: "1" },
					{ result_ref: "2", weight: 2, tags: ["lucky"] },
					{ result_ref: "3" },
				],
			},
			"roll-table",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "roll_tables").find((r) => r.roll_table_id === "kernel_pack/d6"),
		).toMatchObject({
			display_name: "d6",
			result_kind: "int",
			description: "A basic six-sided roll table.",
		});
		expect(
			tableRows(manifest, "roll_table_tag")
				.filter((r) => r.roll_table_id === "kernel_pack/d6")
				.map((r) => r.tag)
				.sort(),
		).toEqual(["core", "die"]);
		const entries = tableRows(manifest, "roll_table_entries").sort(
			(a, b) => (a.authored_order as number) - (b.authored_order as number),
		);
		expect(entries).toMatchObject([
			{
				roll_table_entry_id: "kernel_pack/d6:1",
				roll_table_id: "kernel_pack/d6",
				authored_order: 1,
				weight: 1,
				result_ref: "1",
			},
			{
				roll_table_entry_id: "kernel_pack/d6:2",
				roll_table_id: "kernel_pack/d6",
				authored_order: 2,
				weight: 2,
				result_ref: "2",
			},
			{
				roll_table_entry_id: "kernel_pack/d6:3",
				roll_table_id: "kernel_pack/d6",
				authored_order: 3,
				weight: 1,
				result_ref: "3",
			},
		]);
		expect(entries.every((r) => !("bundle_id" in r))).toBe(true);
		expect(
			tableRows(manifest, "roll_table_entry_tag").filter(
				(r) => r.roll_table_entry_id === "kernel_pack/d6:2",
			),
		).toMatchObject([{ tag: "lucky" }]);
	});

	it("rejects an empty `entries` array, naming the param", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			defineRollTableToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					id: "empty",
					display_name: "Empty",
					result_kind: "int",
					entries: [],
				},
				"roll-table",
			),
		).rejects.toThrow(/`entries`/);
	});

	it("an unresolvable result_ref against result_kind='int' maps the diagnostic to `entries` (MF-VAL-210), not persisted", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineRollTableToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "broken",
				display_name: "Broken",
				result_kind: "int",
				entries: [{ result_ref: "not_a_number_or_graph" }],
			},
			"roll-table",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-210")).toBe(true);
		expect(workspace.current()).toBeNull();
	});
});

describe("spellkave_define_condition", () => {
	it("authors a condition_definitions row + tag satellites, inline remove_policy/stacking/modifiers, in one call", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineConditionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "condition/hexed",
				display_name: "Hexed",
				description: "A minor curse.",
				tags: ["condition", "curse"],
				gate_predicate_source: "$event.detail.template_id == 'kernel_pack/ability_check'",
				implies: [],
				remove_policy: {
					id: "kernel_pack/remove_policy/independent_lifetime",
					display_name: "Independent lifetime",
					remove_predicate_source: "0 == 1",
				},
				stacking: {
					id: "kernel_pack/stacking/single",
					display_name: "Single active row",
					stack_count_outcome_source: "stack_count",
					expires_at_tick_outcome_source: "-1",
				},
				modifiers: [
					{
						id: "hexed_penalty",
						display_name: "Hexed penalty",
						applies_to: "ResolutionCheck",
						modifier_expression_source: "let bonus = 1; bonus",
						delta_kind: "Disadvantage",
						tags: ["curse"],
					},
				],
			},
			"condition",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const conditionRow = tableRows(manifest, "condition_definitions").find(
			(r) => r.condition_definition_id === "kernel_pack/condition/hexed",
		);
		expect(conditionRow).toMatchObject({
			display_name: "Hexed",
			description: "A minor curse.",
			remove_time_policy: "kernel_pack/remove_policy/independent_lifetime",
			stacking_rule: "kernel_pack/stacking/single",
			// Auto-wired: `modifiers` has exactly ONE entry and `modifier_template_id` was omitted.
			modifier_template_id: "kernel_pack/hexed_penalty",
		});
		expect(
			tableRows(manifest, "condition_definition_tag")
				.filter((r) => r.condition_definition_id === "kernel_pack/condition/hexed")
				.map((r) => r.tag)
				.sort(),
		).toEqual(["condition", "curse"]);
		expect(tableRows(manifest, "condition_remove_policy_definitions")).toMatchObject([
			{
				policy_id: "kernel_pack/remove_policy/independent_lifetime",
				remove_predicate_source: "0 == 1",
			},
		]);
		expect(tableRows(manifest, "stacking_discipline_definitions")).toMatchObject([
			{ discipline_id: "kernel_pack/stacking/single", stack_count_outcome_source: "stack_count" },
		]);
		expect(tableRows(manifest, "modifier_templates")).toMatchObject([
			{
				modifier_template_id: "kernel_pack/hexed_penalty",
				applies_to: "ResolutionCheck",
				delta_kind: "Disadvantage",
			},
		]);
		expect(
			tableRows(manifest, "modifier_template_tag").filter(
				(r) => r.modifier_template_id === "kernel_pack/hexed_penalty",
			),
		).toMatchObject([{ tag: "curse" }]);
	});

	it("a second condition referencing the SAME remove_policy/stacking id does NOT duplicate the shared vocabulary rows", async () => {
		const workspace = fakeWorkspace(null);
		const sharedRemovePolicy = {
			id: "kernel_pack/remove_policy/independent_lifetime",
			display_name: "Independent lifetime",
			remove_predicate_source: "0 == 1",
		};
		const sharedStacking = {
			id: "kernel_pack/stacking/single",
			display_name: "Single active row",
			stack_count_outcome_source: "stack_count",
			expires_at_tick_outcome_source: "-1",
		};
		await defineConditionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "condition/hexed",
				display_name: "Hexed",
				remove_policy: sharedRemovePolicy,
				stacking: sharedStacking,
			},
			"condition-a",
		);
		await defineConditionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "condition/jinxed",
				display_name: "Jinxed",
				remove_policy: sharedRemovePolicy,
				stacking: sharedStacking,
			},
			"condition-b",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "condition_remove_policy_definitions")).toHaveLength(1);
		expect(tableRows(manifest, "stacking_discipline_definitions")).toHaveLength(1);
		expect(tableRows(manifest, "condition_definitions")).toHaveLength(2);
	});

	it("`modifiers` with more than one entry requires an explicit `modifier_template_id`, naming the param", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			defineConditionToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					id: "condition/ambiguous",
					display_name: "Ambiguous",
					modifiers: [
						{
							id: "penalty_a",
							display_name: "Penalty A",
							applies_to: "ResolutionCheck",
							modifier_expression_source: "let bonus = 1; bonus",
						},
						{
							id: "penalty_b",
							display_name: "Penalty B",
							applies_to: "ResolutionCheck",
							modifier_expression_source: "let bonus = 2; bonus",
						},
					],
				},
				"condition",
			),
		).rejects.toThrow(/`modifier_template_id`/);
	});

	it("a mismatched `remove_time_policy` vs `remove_policy.id` is rejected, naming `remove_time_policy`", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			defineConditionToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					id: "condition/mismatch",
					display_name: "Mismatch",
					remove_time_policy: "kernel_pack/remove_policy/other",
					remove_policy: {
						id: "kernel_pack/remove_policy/independent_lifetime",
						display_name: "Independent lifetime",
						remove_predicate_source: "0 == 1",
					},
				},
				"condition",
			),
		).rejects.toThrow(/`remove_time_policy`/);
	});

	it("a dangling `implies` cascade ref maps the diagnostic to `implies` (MF-VAL-226), not persisted", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineConditionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "condition/cascade",
				display_name: "Cascade",
				implies: ["kernel_pack/condition/nonexistent"],
			},
			"condition",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-226")).toBe(true);
		expect(workspace.current()).toBeNull();
	});
});

describe("spellkave_define_niche", () => {
	it("authors a niche_definitions row + tag satellites + node/edge attachments in one call", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineNicheToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "loot_site",
				display_name: "Loot Site",
				description: "A place where authored loot may spawn.",
				tags: ["loot"],
				attachments: [
					{ node: "kernel_pack/village/well" },
					{ edge: 0, ecological_invariant: true },
				],
			},
			"niche",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "niche_definitions").find((r) => r.niche_id === "kernel_pack/loot_site"),
		).toMatchObject({
			display_name: "Loot Site",
			description: "A place where authored loot may spawn.",
		});
		expect(
			tableRows(manifest, "niche_definition_tag").filter(
				(r) => r.niche_id === "kernel_pack/loot_site",
			),
		).toMatchObject([{ tag: "loot" }]);
		const attachments = tableRows(manifest, "spatial_niche_attachments").filter(
			(r) => r.niche_id === "kernel_pack/loot_site",
		);
		expect(attachments).toMatchObject([
			{ place_node_id: "kernel_pack/village/well", place_edge_id: null },
			// #1968 backlog item 2: a present u64 crosses the wasm/JS boundary as
			// a digit STRING (never a bare JSON number); `null` (the Option<u64>
			// "no edge" case) is untouched.
			{ place_node_id: "", place_edge_id: "0", ecological_invariant: true },
		]);
	});

	it("an attachments[] entry with BOTH `node` and `edge` is rejected, naming `attachments`", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			defineNicheToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					id: "loot_site",
					display_name: "Loot Site",
					description: "x",
					attachments: [{ node: "kernel_pack/village/well", edge: 0 }],
				},
				"niche",
			),
		).rejects.toThrow(/`attachments`/);
	});

	it("an attachments[] entry with NEITHER `node` nor `edge` is rejected, naming `attachments`", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			defineNicheToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					id: "loot_site",
					display_name: "Loot Site",
					description: "x",
					attachments: [{}],
				},
				"niche",
			),
		).rejects.toThrow(/`attachments`/);
	});
});

describe("spellkave_define_trace_kind (sk-9ll.8)", () => {
	async function withVillageNodes(workspace: ReturnType<typeof fakeWorkspace>) {
		const context = contextWith({ workspace });
		await authorPlaceToolDef.run(
			context,
			{
				bundle: "kernel_pack",
				nodes: [
					{ id: "kernel_pack/village/well", name: "Well" },
					{ id: "kernel_pack/village/gate", name: "Gate" },
				],
				edges: [],
			},
			"nodes",
		);
		return context;
	}

	it("authors a trace_kind_definitions row + place_node_traces satellites in one call", async () => {
		const workspace = fakeWorkspace(null);
		const context = await withVillageNodes(workspace);
		const result = await defineTraceKindToolDef.run(
			context,
			{
				bundle: "kernel_pack",
				id: "scent",
				description: "A lingering ambient scent.",
				perceptible_for_ticks: 40,
				places: [{ node: "kernel_pack/village/well" }],
			},
			"trace-kind",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "trace_kind_definitions").find((r) => r.kind_id === "kernel_pack/scent"),
		).toMatchObject({
			bundle_id: "kernel_pack",
			location_kinds: "place_node",
			description: "A lingering ambient scent.",
			perceptible_for_ticks: 40,
		});
		expect(
			tableRows(manifest, "place_node_traces").filter(
				(r) => r.trace_kind_id === "kernel_pack/scent",
			),
		).toMatchObject([{ node_id: "kernel_pack/village/well" }]);
	});

	it("location_kinds/schema_json/description/perceptible_for_ticks default to 'place_node'/''/''/absent", async () => {
		const workspace = fakeWorkspace(null);
		const context = await withVillageNodes(workspace);
		const result = await defineTraceKindToolDef.run(
			context,
			{ bundle: "kernel_pack", id: "footprint" },
			"trace-kind",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const row = tableRows(manifest, "trace_kind_definitions").find(
			(r) => r.kind_id === "kernel_pack/footprint",
		);
		expect(row).toMatchObject({ location_kinds: "place_node", schema_json: "", description: "" });
		expect(row?.perceptible_for_ticks).toBeFalsy();
		expect(
			tableRows(manifest, "place_node_traces").filter(
				(r) => r.trace_kind_id === "kernel_pack/footprint",
			),
		).toEqual([]);
	});

	it("re-authoring the SAME bundle+id replaces the row + place_node_traces satellites wholesale (workspace idempotency)", async () => {
		const workspace = fakeWorkspace(null);
		const context = await withVillageNodes(workspace);
		await defineTraceKindToolDef.run(
			context,
			{
				bundle: "kernel_pack",
				id: "scent",
				description: "v1",
				places: [{ node: "kernel_pack/village/well" }, { node: "kernel_pack/village/gate" }],
			},
			"trace-kind-1",
		);
		const result = await defineTraceKindToolDef.run(
			context,
			{
				bundle: "kernel_pack",
				id: "scent",
				description: "v2",
				places: [{ node: "kernel_pack/village/well" }],
			},
			"trace-kind-2",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		expect((result.details as VerbResult).rows_replaced).toBeGreaterThan(0);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "trace_kind_definitions").filter(
				(r) => r.kind_id === "kernel_pack/scent",
			),
		).toMatchObject([{ description: "v2" }]);
		expect(
			tableRows(manifest, "place_node_traces").filter(
				(r) => r.trace_kind_id === "kernel_pack/scent",
			),
		).toMatchObject([{ node_id: "kernel_pack/village/well" }]);
	});

	it("a places[] entry naming an unresolvable node_id is rejected (offline vocabulary-closure check), naming `places`", async () => {
		const workspace = fakeWorkspace(null);
		const context = await withVillageNodes(workspace);
		const result = await defineTraceKindToolDef.run(
			context,
			{
				bundle: "kernel_pack",
				id: "scent",
				description: "x",
				places: [{ node: "kernel_pack/does_not_exist" }],
			},
			"trace-kind",
		);
		expect((result.details as VerbResult).ok).toBe(false);
	});
});

describe("spellkave_define_capability (#1968 verb-UX round: the named missing bare-vocabulary verb)", () => {
	it("authors a capability_definitions row + tag satellites in one call", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "walk",
				actor_kind: "entity",
				display_name: "Walk",
				description: "Actor traverses a passable edge to an adjacent place-node.",
				tags: ["movement"],
			},
			"capability",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "capability_definitions").find(
				(r) => r.capability_id === "kernel_pack/walk",
			),
		).toMatchObject({
			bundle_id: "kernel_pack",
			actor_kind: "entity",
			display_name: "Walk",
			description: "Actor traverses a passable edge to an adjacent place-node.",
			default_visibility: "Public",
		});
		expect(
			tableRows(manifest, "capability_definition_tag").filter(
				(r) => r.capability_id === "kernel_pack/walk",
			),
		).toMatchObject([{ tag: "movement" }]);
	});

	it("display_name and default_visibility are smart defaults: omitted -> title-cased id / 'Public'", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "raw_trace_inscription",
				actor_kind: "entity",
				description: "x",
			},
			"capability",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "capability_definitions").find(
				(r) => r.capability_id === "kernel_pack/raw_trace_inscription",
			),
		).toMatchObject({ display_name: "Raw Trace Inscription", default_visibility: "Public" });
	});

	it("re-authoring the SAME bundle+id replaces the row + tag satellites wholesale (workspace idempotency)", async () => {
		const workspace = fakeWorkspace(null);
		await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "walk",
				actor_kind: "entity",
				display_name: "Walk",
				description: "v1",
				tags: ["movement", "extra"],
			},
			"capability-1",
		);
		const result = await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "walk",
				actor_kind: "entity",
				display_name: "Walk",
				description: "v2",
				tags: ["movement"],
			},
			"capability-2",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		expect((result.details as VerbResult).rows_replaced).toBeGreaterThan(0);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "capability_definitions").filter(
				(r) => r.capability_id === "kernel_pack/walk",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "capability_definition_tag").filter(
				(r) => r.capability_id === "kernel_pack/walk",
			),
		).toMatchObject([{ tag: "movement" }]);
	});
});

describe("spellkave_define_consequence (#1968 backlog B-3 — action/consequence authoring gap)", () => {
	it("authors a consequence_templates row + consequence_frame_writes satellites in one call", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineConsequenceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trap/plate/success",
				frame_writes: [
					{
						Inscribe: {
							kind: "trap_triggered",
							location_kind: "binding",
							location_ref: "ActorSpatialRef",
							payload_json: '{"trap":"plate"}',
						},
					},
					{ PickupTargetItem: { actor_ref: "Actor" } },
				],
			},
			"consequence",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "consequence_templates").find(
				(r) => r.template_id === "kernel_pack/trap/plate/success",
			),
		).toMatchObject({ bundle_id: "kernel_pack" });
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "kernel_pack/trap/plate/success",
		);
		expect(frameWrites).toHaveLength(2);
		expect(frameWrites[0]).toMatchObject({
			ordinal: 0,
			frame_write: { Inscribe: { kind: "trap_triggered" } },
		});
		expect(frameWrites[1]).toMatchObject({
			ordinal: 1,
			frame_write: { PickupTargetItem: { actor_ref: "Actor" } },
		});
	});

	it("effect_ref/description are optional and map to effect_refs_csv/description", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineConsequenceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "schedule/success",
				effect_ref: "kernel_pack/schedule/success/schedule",
				description: "Schedules the follow-up pulse.",
			},
			"consequence",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "consequence_templates").find(
				(r) => r.template_id === "kernel_pack/schedule/success",
			),
		).toMatchObject({
			effect_refs_csv: "kernel_pack/schedule/success/schedule",
			description: "Schedules the follow-up pulse.",
		});
	});

	it("no actor grant: authors no capability/action/outcome/affordance row", async () => {
		const workspace = fakeWorkspace(null);
		await defineConsequenceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "trap/plate/success" },
			"consequence",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "capability_definitions")).toHaveLength(0);
		expect(tableRows(manifest, "action_definitions")).toHaveLength(0);
		expect(tableRows(manifest, "actor_capabilities")).toHaveLength(0);
	});

	it("workspace idempotency: re-authoring the SAME bundle+id replaces the row + frame_writes wholesale (fewer frame_writes on a re-run drops the stale ones)", async () => {
		const workspace = fakeWorkspace(null);
		await defineConsequenceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trap/plate/success",
				frame_writes: [
					{
						Inscribe: {
							kind: "a",
							location_kind: "binding",
							location_ref: "ActorSpatialRef",
							payload_json: "{}",
						},
					},
					{
						Inscribe: {
							kind: "b",
							location_kind: "binding",
							location_ref: "ActorSpatialRef",
							payload_json: "{}",
						},
					},
				],
			},
			"consequence-1",
		);
		const second = await defineConsequenceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trap/plate/success",
				frame_writes: [
					{
						Inscribe: {
							kind: "c",
							location_kind: "binding",
							location_ref: "ActorSpatialRef",
							payload_json: "{}",
						},
					},
				],
			},
			"consequence-2",
		);
		const details = second.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_replaced).toBeGreaterThan(0);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "consequence_templates").filter(
				(r) => r.template_id === "kernel_pack/trap/plate/success",
			),
		).toHaveLength(1);
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "kernel_pack/trap/plate/success",
		);
		expect(frameWrites).toHaveLength(1);
		expect(frameWrites[0]).toMatchObject({ ordinal: 0, frame_write: { Inscribe: { kind: "c" } } });
	});
});

describe("spellkave_define_action (#1968 backlog B-3 — action/consequence authoring gap)", () => {
	async function seedCapability(workspace: ReturnType<typeof fakeWorkspace>) {
		await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trigger/plate",
				actor_kind: "entity",
				description: "Any entity that can trip the arena's hidden pressure plate.",
			},
			"capability",
		);
	}

	it("authors an action_definitions row + action_definition_tag satellites in one call", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		const result = await defineActionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trigger_plate",
				required_capability: "kernel_pack/trigger/plate",
				on_success: "kernel_pack/trap/plate/success",
				display_name: "Trigger Pressure Plate",
				cost_time_ms: 0,
				tags: ["trap"],
			},
			"action",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").find(
				(r) => r.action_id === "kernel_pack/trigger_plate",
			),
		).toMatchObject({
			bundle_id: "kernel_pack",
			required_capability: "kernel_pack/trigger/plate",
			on_success: "kernel_pack/trap/plate/success",
			on_failure: "",
			resolution_mode: "Deterministic",
			display_name: "Trigger Pressure Plate",
			// u64 wire convention (`wire_u64`): a round-trip through render+parse
			// carries cost_time_ms as a digit STRING, not a JS number.
			cost_time_ms: "0",
			self_eligible: false,
			self_only: false,
		});
		expect(
			tableRows(manifest, "action_definition_tag").filter(
				(r) => r.action_id === "kernel_pack/trigger_plate",
			),
		).toMatchObject([{ tag: "trap" }]);
	});

	it("display_name is a smart default: omitted -> title-cased id", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trigger_plate",
				required_capability: "kernel_pack/trigger/plate",
				on_success: "kernel_pack/trap/plate/success",
			},
			"action",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").find(
				(r) => r.action_id === "kernel_pack/trigger_plate",
			),
		).toMatchObject({ display_name: "Trigger Plate" });
	});

	it("no actor grant: authors no actor_capabilities/spatial_niche_attachments row", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trigger_plate",
				required_capability: "kernel_pack/trigger/plate",
				on_success: "kernel_pack/trap/plate/success",
			},
			"action",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "actor_capabilities")).toHaveLength(0);
		expect(tableRows(manifest, "spatial_niche_attachments")).toHaveLength(0);
	});

	it("workspace idempotency: re-authoring the SAME bundle+id replaces the row + tag satellite wholesale", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trigger_plate",
				required_capability: "kernel_pack/trigger/plate",
				on_success: "kernel_pack/trap/plate/success",
				cost_time_ms: 100,
				tags: ["trap", "extra"],
			},
			"action-1",
		);
		const second = await defineActionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trigger_plate",
				required_capability: "kernel_pack/trigger/plate",
				on_success: "kernel_pack/trap/plate/success",
				cost_time_ms: 200,
				tags: ["trap"],
			},
			"action-2",
		);
		const details = second.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_replaced).toBeGreaterThan(0);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").filter(
				(r) => r.action_id === "kernel_pack/trigger_plate",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "action_definitions").find(
				(r) => r.action_id === "kernel_pack/trigger_plate",
			),
		).toMatchObject({ cost_time_ms: "200" });
		expect(
			tableRows(manifest, "action_definition_tag").filter(
				(r) => r.action_id === "kernel_pack/trigger_plate",
			),
		).toMatchObject([{ tag: "trap" }]);
	});

	it("rejects a required_capability that does not resolve, naming `required_capability`", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			defineActionToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					id: "trigger_plate",
					required_capability: "kernel_pack/nonexistent",
					on_success: "kernel_pack/trap/plate/success",
				},
				"action",
			),
		).rejects.toThrow(/`required_capability`/);
	});

	it("a dangling on_success reference is ACCEPTED — no generic ref-check exists for it (mirrors outcome_templates.manipulation_action_id — see this verb's own doc comment)", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		const result = await defineActionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trigger_plate",
				required_capability: "kernel_pack/trigger/plate",
				on_success: "kernel_pack/nonexistent/success",
			},
			"action",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	});

	it("a self-eligible REACTION with an on_success carrying no ModifyResource write DOES fail validation (MF-VAL-263) — the budget rule is scoped to reaction-wired actions since PR #2079", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineConsequenceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "trap/plate/success" }, // no frame_writes at all
			"consequence",
		);
		const result = await defineActionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trigger_plate",
				required_capability: "kernel_pack/trigger/plate",
				on_success: "kernel_pack/trap/plate/success",
				self_eligible: true,
				// The reaction wiring is what puts the action in MF-VAL-263's
				// scope: ADR-0050's protection (a depleting budget is the only
				// terminator for self-triggered reaction loops) applies to
				// reactions only — a plain free self action validates now.
				reaction_eligibility: "actor.has_capability('kernel_pack/trigger/plate')",
				reaction_trigger: "$event.kind == 'r_move'",
			},
			"action",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(JSON.stringify(details.diagnostics)).toContain("MF-VAL-263");
	});

	it("a plain self_eligible action with no budget and no reaction wiring validates — the genuinely-free self action (SRD Dropping Prone shape, PR #2079)", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineConsequenceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "trap/plate/success" }, // no frame_writes at all
			"consequence",
		);
		const result = await defineActionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "trigger_plate",
				required_capability: "kernel_pack/trigger/plate",
				on_success: "kernel_pack/trap/plate/success",
				self_eligible: true,
			},
			"action",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details.diagnostics)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// #1968 verb-UX round smart defaults: `display_name` derived from `id` when
// omitted, `bundle` resolved from `context.defaultBundle` when omitted.
// ---------------------------------------------------------------------------

describe("#1968 verb-UX round: smart defaults", () => {
	it("spellkave_define_entity_type: display_name derives a title-cased id when omitted", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "item/loot_dagger" },
			"entity-type",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "entity_definitions").find(
				(r) => r.entity_def_id === "kernel_pack/item/loot_dagger",
			),
		).toMatchObject({ display_name: "Item Loot Dagger" });
	});

	it("spellkave_define_niche: an explicit display_name still wins over the derived default", async () => {
		const workspace = fakeWorkspace(null);
		await defineNicheToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", id: "loot_site", display_name: "Custom Name", description: "x" },
			"niche",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "niche_definitions").find((r) => r.niche_id === "kernel_pack/loot_site"),
		).toMatchObject({ display_name: "Custom Name" });
	});

	it("bundle omitted + context.defaultBundle set (a bare value): every write verb falls back to it", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineNicheToolDef.run(
			contextWith({ workspace, defaultBundle: "core" }),
			{ id: "loot_site", display_name: "Loot Site", description: "x" },
			"niche",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "bundles").map((r) => r.bundle_id)).toContain("core");
		expect(
			tableRows(manifest, "niche_definitions").find((r) => r.niche_id === "core/loot_site"),
		).toBeDefined();
	});

	it("bundle omitted + context.defaultBundle as a thunk: resolved lazily, per call", async () => {
		const workspace = fakeWorkspace(null);
		let current = "pack_a";
		const result = await defineResourceToolDef.run(
			contextWith({ workspace, defaultBundle: () => current }),
			{ id: "hp", display_name: "HP", min_value: 0, max_value: 10 },
			"resource-1",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		current = "pack_b";
		const result2 = await defineResourceToolDef.run(
			contextWith({ workspace, defaultBundle: () => current }),
			{ id: "mana", display_name: "Mana", min_value: 0, max_value: 10 },
			"resource-2",
		);
		expect((result2.details as VerbResult).ok, JSON.stringify(result2.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "resource_definitions")
				.map((r) => r.resource_definition_id)
				.sort(),
		).toEqual(["pack_a/hp", "pack_b/mana"]);
	});

	it("bundle omitted + explicit `bundle` given: the per-call value always wins over context.defaultBundle", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineResourceToolDef.run(
			contextWith({ workspace, defaultBundle: "fallback" }),
			{ bundle: "explicit", id: "hp", display_name: "HP", min_value: 0, max_value: 10 },
			"resource",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "bundles").map((r) => r.bundle_id)).toEqual(["explicit"]);
	});

	it("bundle omitted + no context.defaultBundle: rejected, naming `bundle` as the offending param", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			defineResourceToolDef.run(
				contextWith({ workspace }),
				{ id: "hp", display_name: "HP", min_value: 0, max_value: 10 },
				"resource",
			),
		).rejects.toThrow(/`bundle`/);
	});

	it("spellkave_write_rows: bundle also resolves from context.defaultBundle when omitted", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, defaultBundle: "core" }),
			{
				kind: "extent_kind_definitions",
				rows: [
					{
						kind_id: "core/region",
						resolution_shape: "PlaceGraph",
						bundle_id: "core",
						description: "x",
					},
				],
			},
			"write-rows",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "bundles").map((r) => r.bundle_id)).toContain("core");
	});

	it("spellkave_write_rows: a row omitting `default_visibility` resolves to 'Public' via the schema's own serde default (no verb-side injection needed)", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "capability_definitions",
				rows: [
					{
						capability_id: "kernel_pack/cast",
						bundle_id: "kernel_pack",
						actor_kind: "entity",
						display_name: "Cast",
						description: "x",
						// default_visibility intentionally omitted.
					},
				],
			},
			"write-rows",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "capability_definitions").find(
				(r) => r.capability_id === "kernel_pack/cast",
			),
		).toMatchObject({ default_visibility: "Public" });
	});
});

// ---------------------------------------------------------------------------
// Workspace idempotency (#1968 US "workspace idempotency"): every write verb's
// merge-into-the-workspace step upserts by authored key rather than appending
// a duplicate, mirroring the server's delta-apply upsert discipline
// (ADR-0085) and closing MF-VAL-272 (fatal duplicate-authored-id) on a
// re-run.
// ---------------------------------------------------------------------------

/** Sort every table's rows (normalized, JSON-string order) so two manifests can be compared ignoring row order. */
function normalizeManifestForCompare(manifest: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(manifest)) {
		if (!Array.isArray(value)) continue;
		const rows = value.map((row) => normalize(row));
		rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
		out[key] = rows;
	}
	return out;
}

function expectManifestsSemanticallyEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
	expect(normalizeManifestForCompare(a)).toEqual(normalizeManifestForCompare(b));
}

describe("workspace idempotency (#1968 US 'workspace idempotency')", () => {
	it("spellkave_define_resource: an identical re-run reports rows_replaced and leaves the manifest semantically unchanged", async () => {
		const workspace = fakeWorkspace(null);
		const params = {
			bundle: "kernel_pack",
			id: "hp",
			display_name: "Hit Points",
			min_value: 0,
			max_value: 20,
			recovery_rule: "long_rest" as const,
			initial_value: 20,
		};
		const first = await defineResourceToolDef.run(contextWith({ workspace }), params, "run-1");
		expect((first.details as VerbResult).ok, JSON.stringify(first.details)).toBe(true);
		expect((first.details as VerbResult).rows_replaced).toBeUndefined();
		const manifestAfterFirst = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;

		const second = await defineResourceToolDef.run(contextWith({ workspace }), params, "run-2");
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);
		const manifestAfterSecond = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;

		expect(tableRows(manifestAfterSecond, "resource_definitions")).toHaveLength(1);
		expectManifestsSemanticallyEqual(manifestAfterFirst, manifestAfterSecond);
	});

	it("spellkave_define_entity_type: a re-run upserts the row; FEWER tags/seeds on the re-run drop the stale ones (satellite shrink)", async () => {
		const workspace = fakeWorkspace(null);
		// Seed the object_state/capability rows the initial_state/initial_capability
		// seeds below reference — MF-VAL-253/254 require them to already exist.
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "object_state_definitions",
				rows: [
					{
						state_id: "kernel_pack/sharp",
						bundle_id: "kernel_pack",
						target_kind: "entity",
						display_name: "Sharp",
					},
				],
			},
			"seed-state",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "capability_definitions",
				rows: [
					{
						capability_id: "kernel_pack/cap/stab",
						bundle_id: "kernel_pack",
						actor_kind: "npc",
						display_name: "Stab",
						description: "Innate stabbing capability.",
					},
				],
			},
			"seed-capability",
		);
		const first = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "item/dagger",
				display_name: "Dagger",
				tags: ["weapon", "light"],
				initial_states: [{ state: "kernel_pack/sharp", value_bool: true }],
				initial_capabilities: [{ capability: "kernel_pack/cap/stab" }],
			},
			"run-1",
		);
		expect((first.details as VerbResult).ok, JSON.stringify(first.details)).toBe(true);

		const second = await defineEntityTypeToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "item/dagger",
				display_name: "Dagger (rebalanced)",
				tags: ["weapon"],
			},
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "entity_definitions")).toHaveLength(1);
		expect(tableRows(manifest, "entity_definitions")[0]).toMatchObject({
			display_name: "Dagger (rebalanced)",
		});
		expect(
			tableRows(manifest, "entity_definition_tag").filter(
				(r) => r.entity_def_id === "kernel_pack/item/dagger",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "entity_definition_initial_state").filter(
				(r) => r.entity_def_id === "kernel_pack/item/dagger",
			),
		).toHaveLength(0);
		expect(
			tableRows(manifest, "entity_definition_initial_capability").filter(
				(r) => r.entity_def_id === "kernel_pack/item/dagger",
			),
		).toHaveLength(0);
	});

	it("spellkave_define_roll_table: a re-run with FEWER entries drops the stale entries/entry_tag rows", async () => {
		const workspace = fakeWorkspace(null);
		await defineRollTableToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "loot/common",
				display_name: "Common Loot",
				result_kind: "int",
				tags: ["loot"],
				entries: [
					{ result_ref: "10", tags: ["copper"] },
					{ result_ref: "20", tags: ["silver"] },
					{ result_ref: "30" },
				],
			},
			"run-1",
		);
		const second = await defineRollTableToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "loot/common",
				display_name: "Common Loot",
				result_kind: "int",
				entries: [{ result_ref: "10", tags: ["copper"] }],
			},
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "roll_tables")).toHaveLength(1);
		expect(
			tableRows(manifest, "roll_table_entries").filter(
				(r) => r.roll_table_id === "kernel_pack/loot/common",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "roll_table_entry_tag").filter((r) =>
				String(r.roll_table_entry_id ?? "").startsWith("kernel_pack/loot/common:"),
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "roll_table_tag").filter(
				(r) => r.roll_table_id === "kernel_pack/loot/common",
			),
		).toHaveLength(0);
	});

	it("spellkave_define_condition: a re-run upserts the condition + tags; the shared remove_policy/stacking/modifier vocabulary upserts by its OWN id", async () => {
		const workspace = fakeWorkspace(null);
		const removePolicy = {
			id: "kernel_pack/remove_policy/independent_lifetime",
			display_name: "Independent lifetime",
			remove_predicate_source: "0 == 1",
		};
		await defineConditionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "condition/hexed",
				display_name: "Hexed",
				tags: ["debuff", "curse"],
				remove_policy: removePolicy,
				modifiers: [
					{
						id: "hex_penalty",
						display_name: "Hex penalty",
						applies_to: "ResolutionCheck",
						modifier_expression_source: "let bonus = 2; 0 - bonus",
					},
				],
			},
			"run-1",
		);
		const second = await defineConditionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "condition/hexed",
				display_name: "Hexed (rebalanced)",
				tags: ["curse"],
				remove_policy: { ...removePolicy, display_name: "Independent lifetime (v2)" },
				modifiers: [
					{
						id: "hex_penalty",
						display_name: "Hex penalty (v2)",
						applies_to: "ResolutionCheck",
						modifier_expression_source: "let bonus = 3; 0 - bonus",
					},
				],
			},
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "condition_definitions")).toHaveLength(1);
		expect(tableRows(manifest, "condition_definitions")[0]).toMatchObject({
			display_name: "Hexed (rebalanced)",
		});
		expect(
			tableRows(manifest, "condition_definition_tag").filter(
				(r) => r.condition_definition_id === "kernel_pack/condition/hexed",
			),
		).toHaveLength(1);
		expect(tableRows(manifest, "condition_remove_policy_definitions")).toHaveLength(1);
		expect(tableRows(manifest, "condition_remove_policy_definitions")[0]).toMatchObject({
			display_name: "Independent lifetime (v2)",
		});
		expect(tableRows(manifest, "modifier_templates")).toHaveLength(1);
		expect(tableRows(manifest, "modifier_templates")[0]).toMatchObject({
			display_name: "Hex penalty (v2)",
			modifier_expression_source: "let bonus = 3; 0 - bonus",
		});
	});

	it("spellkave_define_niche: a re-run with FEWER tags/attachments drops the stale ones", async () => {
		const workspace = fakeWorkspace(null);
		await defineNicheToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "loot_site",
				display_name: "Loot Site",
				description: "A place where authored loot may spawn.",
				tags: ["loot", "outdoor"],
				attachments: [{ node: "kernel_pack/village/well" }, { edge: 0 }],
			},
			"run-1",
		);
		const second = await defineNicheToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "loot_site",
				display_name: "Loot Site",
				description: "A place where authored loot may spawn.",
				tags: ["loot"],
				attachments: [{ node: "kernel_pack/village/well" }],
			},
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "niche_definitions")).toHaveLength(1);
		expect(
			tableRows(manifest, "niche_definition_tag").filter(
				(r) => r.niche_id === "kernel_pack/loot_site",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "spatial_niche_attachments").filter(
				(r) => r.niche_id === "kernel_pack/loot_site",
			),
		).toHaveLength(1);
	});

	it("spellkave_define_behavior: a re-run upserts the WHOLE generated cluster, never a duplicate id", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/arena/center" }], edges: [] },
			"place",
		);
		await defineResourceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "hp",
				display_name: "Hit Points",
				min_value: 0,
				max_value: 20,
				recovery_rule: "long_rest",
				initial_value: 20,
			},
			"resource",
		);
		await spawnToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				entity_def: "npc",
				at: "kernel_pack/arena/center",
				key_prefix: "caster",
			},
			"spawn",
		);
		const behaviorParams = {
			bundle: "kernel_pack",
			id: "firebloom",
			grant_to: "kernel_pack/caster_1",
			offered_when: { reach: "same_node" as const },
			action_class: "spell",
			cost: { pool: "kernel_pack/slot_1", amount: 1 },
			effect: {
				primitive: "ForEachActorInRadius" as const,
				shape: { id: "core/area/node_ball" as const, radius: 0 },
				per_target_gate: "d20 < 13",
				write: { primitive: "ModifyResource" as const, resource: "kernel_pack/hp", delta: "-d6" },
			},
		};
		await defineBehaviorToolDef.run(contextWith({ workspace }), behaviorParams, "run-1");
		const second = await defineBehaviorToolDef.run(
			contextWith({ workspace }),
			behaviorParams,
			"run-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);

		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "capability_definitions")).toHaveLength(1);
		expect(tableRows(manifest, "action_definitions")).toHaveLength(1);
		expect(tableRows(manifest, "outcome_templates")).toHaveLength(1);
		expect(tableRows(manifest, "affordance_templates")).toHaveLength(1);
		expect(tableRows(manifest, "consequence_templates")).toHaveLength(1);
		expect(
			tableRows(manifest, "consequence_frame_writes").filter(
				(r) => r.template_id === "kernel_pack/cast_firebloom/success",
			),
		).toHaveLength(2); // the AoE ModifyResource + the resource-cost debit ordinal.
		expect(tableRows(manifest, "actor_capabilities")).toHaveLength(1);
		expect(tableRows(manifest, "spatial_niche_attachments")).toHaveLength(1);
	});

	it("spellkave_author_place: a re-run with identical params upserts (rows_replaced > 0), manifest semantically unchanged", async () => {
		const workspace = fakeWorkspace(null);
		const params = {
			bundle: "kernel_pack",
			nodes: [{ id: "kernel_pack/arena/center", name: "Center" }],
			edges: [] as [string, string][],
		};
		await authorPlaceToolDef.run(contextWith({ workspace }), params, "run-1");
		const manifestAfterFirst = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;
		const second = await authorPlaceToolDef.run(contextWith({ workspace }), params, "run-2");
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);
		const manifestAfterSecond = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;
		expect(tableRows(manifestAfterSecond, "place_graphs")).toHaveLength(1);
		expect(tableRows(manifestAfterSecond, "place_nodes")).toHaveLength(1);
		expectManifestsSemanticallyEqual(manifestAfterFirst, manifestAfterSecond);
	});

	it("place_entity removes actor steering rows while place_actor emits them", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/room" }], edges: [] },
			"place",
		);
		await rawPlaceActorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "npc",
				at: "kernel_pack/room",
				key_prefix: "fixture",
			},
			"place-actor",
		);

		let manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "actors")).toHaveLength(1);
		expect(tableRows(manifest, "actor_spatial_locations")).toHaveLength(1);

		await placeEntityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "item",
				at: "kernel_pack/room",
				key_prefix: "fixture",
			},
			"place-entity",
		);

		manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "entities")).toHaveLength(1);
		expect(tableRows(manifest, "entities")[0]?.kind).toBe("item");
		expect(tableRows(manifest, "actors")).toHaveLength(0);
		expect(tableRows(manifest, "actor_spatial_locations")).toHaveLength(0);
	});

	describe("actor placement: key_prefix identity", () => {
		it("WITH key_prefix, a re-run upserts (same keys → replace, including the object_state satellite)", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/arena/center" }], edges: [] },
				"place",
			);
			await spawnToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					entity_def: "npc",
					at: "kernel_pack/arena/center",
					key_prefix: "boss",
					resources: [{ resource: "kernel_pack/hp", value: 20 }],
				},
				"spawn-1",
			);
			const second = await spawnToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					entity_def: "npc",
					at: "kernel_pack/arena/center",
					key_prefix: "boss",
					resources: [{ resource: "kernel_pack/hp", value: 30 }],
				},
				"spawn-2",
			);
			expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
			expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);
			expect((second.details as VerbResult).entity_keys).toEqual(["kernel_pack/boss_1"]);

			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities")).toHaveLength(1);
			expect(tableRows(manifest, "actors")).toHaveLength(1);
			expect(tableRows(manifest, "actor_spatial_locations")).toHaveLength(1);
			const states = tableRows(manifest, "object_state").filter(
				(r) => r.entity_key === "kernel_pack/boss_1",
			);
			expect(states).toHaveLength(1);
			expect(states[0]).toMatchObject({ value_int: 30 });
		});

		it("WITHOUT key_prefix, repeated calls are ADDITIVE — never colliding", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/arena/center" }], edges: [] },
				"place",
			);
			const first = await spawnToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", entity_def: "npc", at: "kernel_pack/arena/center", count: 2 },
				"spawn-1",
			);
			const second = await spawnToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", entity_def: "npc", at: "kernel_pack/arena/center", count: 2 },
				"spawn-2",
			);
			expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
			expect((second.details as VerbResult).rows_replaced).toBeUndefined();
			expect((first.details as VerbResult).entity_keys).toEqual([
				"kernel_pack/npc_1",
				"kernel_pack/npc_2",
			]);
			expect((second.details as VerbResult).entity_keys).toEqual([
				"kernel_pack/npc_3",
				"kernel_pack/npc_4",
			]);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities")).toHaveLength(4);
		});

		it("`key_prefix` set together with `placements` is rejected, naming both", async () => {
			const workspace = fakeWorkspace(null);
			await expect(
				spawnToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "kernel_pack",
						entity_def: "npc",
						key_prefix: "boss",
						placements: [{ at: "kernel_pack/arena/center" }],
					},
					"spawn",
				),
			).rejects.toThrow(/`key_prefix`/);
		});
	});

	describe("sk-9ll.6: entity_key — explicit LITERAL key, no ordinal minted", () => {
		it("places an entity under the EXACT entity_key, no bundle prefix/ordinal appended by the tool", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "fastlane", nodes: [{ id: "fastlane/arena/ring" }], edges: [] },
				"place",
			);
			const result = await spawnToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "fastlane",
					entity_def: "npc",
					at: "fastlane/arena/ring",
					entity_key: "fastlane/hero",
				},
				"place-hero",
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
			expect((result.details as VerbResult).entity_keys).toEqual(["fastlane/hero"]);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities").map((r) => r.entity_key)).toEqual(["fastlane/hero"]);
		});

		it("a re-run with the SAME entity_key upserts (replace), same as key_prefix", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "fastlane", nodes: [{ id: "fastlane/arena/ring" }], edges: [] },
				"place",
			);
			await spawnToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "fastlane",
					entity_def: "npc",
					at: "fastlane/arena/ring",
					entity_key: "fastlane/hero",
					resources: [{ resource: "fastlane/hp", value: 20 }],
				},
				"spawn-1",
			);
			const second = await spawnToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "fastlane",
					entity_def: "npc",
					at: "fastlane/arena/ring",
					entity_key: "fastlane/hero",
					resources: [{ resource: "fastlane/hp", value: 30 }],
				},
				"spawn-2",
			);
			expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities")).toHaveLength(1);
			const states = tableRows(manifest, "object_state").filter(
				(r) => r.entity_key === "fastlane/hero",
			);
			expect(states).toHaveLength(1);
			expect(states[0]).toMatchObject({ value_int: 30 });
		});

		it("`entity_key` set together with `key_prefix` is rejected, naming both", async () => {
			const workspace = fakeWorkspace(null);
			await expect(
				spawnToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "kernel_pack",
						entity_def: "npc",
						at: "kernel_pack/arena/center",
						entity_key: "kernel_pack/hero",
						key_prefix: "boss",
					},
					"spawn",
				),
			).rejects.toThrow(/`entity_key`/);
		});

		it("`entity_key` with `count` > 1 is rejected (a literal key cannot be shared)", async () => {
			const workspace = fakeWorkspace(null);
			await expect(
				spawnToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "kernel_pack",
						entity_def: "npc",
						at: "kernel_pack/arena/center",
						entity_key: "kernel_pack/hero",
						count: 2,
					},
					"spawn",
				),
			).rejects.toThrow(/`entity_key`/);
		});

		it("`placements[].entity_key` places distinct literal keys across multiple locations in one call", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "fastlane",
					nodes: [{ id: "fastlane/arena/ring" }, { id: "fastlane/arena/fringe" }],
					edges: [],
				},
				"place",
			);
			const result = await spawnToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "fastlane",
					entity_def: "npc",
					placements: [
						{ at: "fastlane/arena/ring", entity_key: "fastlane/hero" },
						{ at: "fastlane/arena/fringe", entity_key: "fastlane/foe" },
					],
				},
				"spawn",
			);
			expect((result.details as VerbResult).entity_keys).toEqual(["fastlane/hero", "fastlane/foe"]);
		});
	});

	describe("sk-ntz.1: name — verbatim entities.name/actors.name override", () => {
		it("flat `name` sets entities.name AND actors.name verbatim (place_actor), no ordinal suffix", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "fastlane", nodes: [{ id: "fastlane/arena/ring" }], edges: [] },
				"place",
			);
			await rawPlaceActorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "fastlane",
					kind: "player",
					at: "fastlane/arena/ring",
					entity_key: "fastlane/hero",
					name: "Fast-lane Hero",
				},
				"place-hero",
			);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities")[0]).toMatchObject({ name: "Fast-lane Hero" });
			expect(tableRows(manifest, "actors")[0]).toMatchObject({ name: "Fast-lane Hero" });
		});

		it("`placements[].name` wins over the flat `name` when both are set", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "fastlane",
					nodes: [{ id: "fastlane/arena/ring" }, { id: "fastlane/arena/fringe" }],
					edges: [],
				},
				"place",
			);
			await rawPlaceActorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "fastlane",
					kind: "npc",
					name: "Flat Default Name",
					placements: [
						{ at: "fastlane/arena/ring", entity_key: "fastlane/hero" },
						{ at: "fastlane/arena/fringe", entity_key: "fastlane/foe", name: "Fast-lane Foe" },
					],
				},
				"place",
			);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			const byKey = (key: string) =>
				tableRows(manifest, "entities").find((r) => r.entity_key === key);
			expect(byKey("fastlane/hero")).toMatchObject({ name: "Flat Default Name" });
			expect(byKey("fastlane/foe")).toMatchObject({ name: "Fast-lane Foe" });
		});

		it("omitting `name` keeps the existing default: title-cased kind, ordinal-suffixed for multi-instance", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/arena/center" }], edges: [] },
				"place",
			);
			await rawPlaceActorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					kind: "npc",
					at: "kernel_pack/arena/center",
					key_prefix: "goblin",
					count: 2,
				},
				"place",
			);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities").map((r) => r.name)).toEqual(["Npc 1", "Npc 2"]);
		});
	});

	describe("sk-jay0.7.15.3: name_prefix — stem + kept ordinal", () => {
		it("flat `name_prefix` + count names each body `'<prefix> <n>'`", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kavemouth", nodes: [{ id: "kavemouth/arena/ring" }], edges: [] },
				"place",
			);
			await rawPlaceActorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kavemouth",
					kind: "npc",
					at: "kavemouth/arena/ring",
					key_prefix: "adventure/encounter/road_wolf",
					count: 3,
					name_prefix: "Road Wolf",
				},
				"place-wolves",
			);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities").map((r) => r.name)).toEqual([
				"Road Wolf 1",
				"Road Wolf 2",
				"Road Wolf 3",
			]);
			expect(tableRows(manifest, "actors").map((r) => r.name)).toEqual([
				"Road Wolf 1",
				"Road Wolf 2",
				"Road Wolf 3",
			]);
		});

		it("`placements[].name_prefix` wins over the flat `name_prefix` when both are set", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kavemouth",
					nodes: [{ id: "kavemouth/arena/ring" }, { id: "kavemouth/arena/fringe" }],
					edges: [],
				},
				"place",
			);
			await rawPlaceActorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kavemouth",
					kind: "npc",
					name_prefix: "Wolf",
					placements: [
						{ at: "kavemouth/arena/ring", count: 2, key_prefix: "wolf" },
						{
							at: "kavemouth/arena/fringe",
							count: 2,
							key_prefix: "stirge",
							name_prefix: "Stirge",
						},
					],
				},
				"place",
			);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities").map((r) => r.name)).toEqual([
				"Wolf 1",
				"Wolf 2",
				"Stirge 1",
				"Stirge 2",
			]);
		});

		it("`name` and `name_prefix` together are rejected, naming both params", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/arena/center" }], edges: [] },
				"place",
			);
			await expect(
				rawPlaceActorToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "kernel_pack",
						kind: "npc",
						at: "kernel_pack/arena/center",
						count: 2,
						key_prefix: "goblin",
						name: "Goblin",
						name_prefix: "Goblin",
					},
					"place",
				),
			).rejects.toThrow(/`name` and `name_prefix` are mutually exclusive/);
		});

		it("`name_prefix` with `entity_key` is rejected (no ordinal is minted)", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/arena/center" }], edges: [] },
				"place",
			);
			await expect(
				rawPlaceActorToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "kernel_pack",
						kind: "npc",
						at: "kernel_pack/arena/center",
						entity_key: "kernel_pack/hero",
						name_prefix: "Hero",
					},
					"place",
				),
			).rejects.toThrow(/`name_prefix` keeps the ordinal suffix/);
		});
	});

	describe("sk-ntz.1: quantity — entities.quantity override (place_entity only)", () => {
		async function seedStackableCredit(workspace: AuthorWorkspace) {
			const result = await defineEntityTypeToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "mech_priced_exchange",
					id: "item/credit",
					display_name: "Credit Token",
					stackable: true,
				},
				"entity-type",
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		}

		it("flat `quantity` sets entities.quantity on spellkave_place_entity", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "mech_priced_exchange",
					nodes: [{ id: "mech_priced_exchange/arena" }],
					edges: [],
				},
				"place",
			);
			await seedStackableCredit(workspace);
			const result = await placeEntityToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "mech_priced_exchange",
					kind: "item",
					entity_def: "mech_priced_exchange/item/credit",
					at: "mech_priced_exchange/arena",
					entity_key: "mech_priced_exchange/item/credit-stack",
					quantity: 10,
				},
				"place-stack",
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			// #1968 wire_u64: `quantity` round-trips through inspectManifest as a decimal-digit
			// STRING (JS/wasm wire form), never a native number — same convention every other
			// `quantity`-reading test in this file already asserts against.
			expect(tableRows(manifest, "entities")[0]).toMatchObject({ quantity: "10" });
		});

		it("`placements[].quantity` wins over the flat `quantity` when both are set", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "mech_priced_exchange",
					nodes: [{ id: "mech_priced_exchange/arena" }],
					edges: [],
				},
				"place",
			);
			await seedStackableCredit(workspace);
			const result = await placeEntityToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "mech_priced_exchange",
					kind: "item",
					entity_def: "mech_priced_exchange/item/credit",
					quantity: 1,
					placements: [
						{
							at: "mech_priced_exchange/arena",
							entity_key: "mech_priced_exchange/item/credit-stack",
							quantity: 10,
						},
					],
				},
				"place-stack",
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities")[0]).toMatchObject({ quantity: "10" });
		});

		it("omitting `quantity` keeps the schema default (1), unchanged", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/room" }], edges: [] },
				"place",
			);
			const result = await placeEntityToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", kind: "item", at: "kernel_pack/room" },
				"place",
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities")[0]?.quantity).toBe("1");
		});

		it("`quantity` on spellkave_place_actor is rejected with a helpful error naming `quantity`", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/room" }], edges: [] },
				"place",
			);
			await expect(
				rawPlaceActorToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "kernel_pack",
						kind: "npc",
						at: "kernel_pack/room",
						quantity: 5,
					},
					"place",
				),
			).rejects.toThrow(/`quantity`/);
		});

		it("`placements[].quantity` on spellkave_place_actor is also rejected", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/room" }], edges: [] },
				"place",
			);
			await expect(
				rawPlaceActorToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "kernel_pack",
						kind: "npc",
						placements: [{ at: "kernel_pack/room", quantity: 3 }],
					},
					"place",
				),
			).rejects.toThrow(/`quantity`/);
		});
	});

	describe("spellkave_write_rows: keyed vs unkeyed kinds", () => {
		it("a kind WITH a natural key (entity_definitions) upserts on re-declare", async () => {
			const workspace = fakeWorkspace(null);
			await writeRowsToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					kind: "entity_definitions",
					rows: [
						{ entity_def_id: "kernel_pack/torch", bundle_id: "kernel_pack", display_name: "Torch" },
					],
				},
				"run-1",
			);
			const second = await writeRowsToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					kind: "entity_definitions",
					rows: [
						{
							entity_def_id: "kernel_pack/torch",
							bundle_id: "kernel_pack",
							display_name: "Torch (unlit)",
						},
					],
				},
				"run-2",
			);
			expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
			expect((second.details as VerbResult).rows_replaced).toBe(1);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			const rows = tableRows(manifest, "entity_definitions").filter(
				(r) => r.entity_def_id === "kernel_pack/torch",
			);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ display_name: "Torch (unlit)" });
		});

		it("a kind with a ROW_KIND_STORAGE_KEY composite (entity_tag) upserts on re-declare (ADR-0146, sk-jay0.7.174.30)", async () => {
			const workspace = fakeWorkspace(null);
			// entity_tag's own MF-VAL-242 requires the referenced entity_key to
			// already carry an authored entities row.
			await writeRowsToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					kind: "entities",
					rows: [
						{
							entity_key: "kernel_pack/torch_1",
							bundle_id: "kernel_pack",
							name: "Torch",
							kind: "item",
							place_node_id: "",
						},
					],
				},
				"seed-entity",
			);
			// entity_tag's full storage key is (entity_key, tag, bundle_id, source)
			// — `bundle_id` is auto-filled from `bundle`, but `source` must be
			// declared explicitly on BOTH calls for the composite key to match;
			// an omitted key field can only ever append (proven by the sibling
			// "consequence_frame_writes" test below), never collide.
			await writeRowsToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					kind: "entity_tag",
					rows: [{ entity_key: "kernel_pack/torch_1", tag: "lightsource", source: "manifest" }],
				},
				"run-1",
			);
			const second = await writeRowsToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "kernel_pack",
					kind: "entity_tag",
					rows: [{ entity_key: "kernel_pack/torch_1", tag: "lightsource", source: "manifest" }],
				},
				"run-2",
			);
			expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
			expect((second.details as VerbResult).rows_replaced).toBe(1);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entity_tag")).toHaveLength(1);
		});

		it("a kind absent from BOTH key tables (consequence_frame_writes, the Class-β set-level kind) stays append-only", async () => {
			// consequence_frame_writes' identity is the WHOLE ordered list per
			// template_id (design.md D3, SET_LEVEL_FIELD) — a per-row composite
			// key would be wrong here, so it is deliberately absent from
			// ROW_KIND_STORAGE_KEY (see `row_identity.rs`'s own doc comment).
			const { finalToml } = await runFireballSequence(false);
			const workspace = fakeWorkspace(finalToml);
			const templateId = "aoe_blast/manual_write_rows_test/success";
			const frameWrite = (delta: string) => ({
				ModifyResource: { actor: "TargetActor", resource: "aoe_blast/hp", delta_source: delta },
			});
			// Same template_id, DIFFERENT ordinal each call — MF-VAL-335 separately
			// rejects a duplicate (template_id, ordinal) pair as a fatal, so a
			// same-ordinal re-declare (the shape an upsert-by-key kind would
			// tolerate) is not a fair append-only probe here; two ordinals is.
			await writeRowsToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					kind: "consequence_frame_writes",
					rows: [{ template_id: templateId, ordinal: 0, frame_write: frameWrite("-d4") }],
				},
				"run-1",
			);
			const second = await writeRowsToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "aoe_blast",
					kind: "consequence_frame_writes",
					rows: [{ template_id: templateId, ordinal: 1, frame_write: frameWrite("-d6") }],
				},
				"run-2",
			);
			expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
			expect((second.details as VerbResult).rows_replaced).toBeUndefined();
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(
				tableRows(manifest, "consequence_frame_writes").filter((r) => r.template_id === templateId),
			).toHaveLength(2);
		});
	});
});

// ---------------------------------------------------------------------------
// #1968 "Decision: connection-level target for the author tools"
// ---------------------------------------------------------------------------

function fakeTarget(overrides: Partial<AuthorTarget> = {}): AuthorTarget {
	return {
		kind: "local",
		resolveRef: () => false,
		lookup: () => [],
		applyBatch: async () => ({ ok: true }),
		...overrides,
	};
}

describe("spellkave_place_*: short-slug default + collision fallback (#1968 addendum)", () => {
	it("a catalog-bound entity_def defaults to the SHORT last path segment, not the fully-qualified slug", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/arena/center" }], edges: [] },
			"place",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				kind: "entity_definitions",
				rows: [
					{
						entity_def_id: "srd/monster/goblin",
						bundle_id: "srd",
						display_name: "Goblin",
					},
				],
			},
			"seed-def",
		);
		const result = await spawnToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", entity_def: "srd/monster/goblin", at: "kernel_pack/arena/center" },
			"spawn",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		expect((result.details as VerbResult).entity_keys).toEqual(["kernel_pack/goblin_1"]);
	});

	it("falls back to the fully-qualified slug when the short slug would collide across different entity_defs", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/arena/center" }], edges: [] },
			"place",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				kind: "entity_definitions",
				rows: [
					{ entity_def_id: "srd/monster/goblin", bundle_id: "srd", display_name: "Goblin" },
					{
						entity_def_id: "homebrew/monster/goblin",
						bundle_id: "homebrew",
						display_name: "Homebrew Goblin",
					},
				],
			},
			"seed-defs",
		);
		const first = await spawnToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", entity_def: "srd/monster/goblin", at: "kernel_pack/arena/center" },
			"spawn-1",
		);
		expect((first.details as VerbResult).entity_keys).toEqual(["kernel_pack/goblin_1"]);

		const second = await spawnToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				entity_def: "homebrew/monster/goblin",
				at: "kernel_pack/arena/center",
			},
			"spawn-2",
		);
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		// Colliding with the FIRST goblin's short-slug stem (a DIFFERENT
		// entity_def_id already occupies "kernel_pack/goblin_") -> fully-qualified.
		expect((second.details as VerbResult).entity_keys).toEqual([
			"kernel_pack/homebrew_monster_goblin_1",
		]);
	});

	it("a bare kind literal (no catalog binding) is unaffected — slugify already returns the short form", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/arena/center" }], edges: [] },
			"place",
		);
		const result = await spawnToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", entity_def: "npc", at: "kernel_pack/arena/center" },
			"spawn",
		);
		expect((result.details as VerbResult).entity_keys).toEqual(["kernel_pack/npc_1"]);
	});
});

describe("connection-level target (#1968 'Decision: connection-level target for the author tools')", () => {
	it("spawn resolves entity_def/at through context.target when the workspace alone would false-reject (US5/US6 fix)", async () => {
		const workspace = fakeWorkspace(null);
		const target = fakeTarget({
			kind: "live",
			resolveRef: (rowKind, id) =>
				(rowKind === "entity_definitions" && id === "srd/monster/goblin") ||
				(rowKind === "place_nodes" && id === "kernel_pack/arena/center"),
		});
		// NO spellkave_author_place call at all — the workspace has NO place_nodes
		// and NO entity_definitions rows; only the target resolves these refs.
		const result = await spawnToolDef.run(
			contextWith({ workspace, target }),
			{ bundle: "kernel_pack", entity_def: "srd/monster/goblin", at: "kernel_pack/arena/center" },
			"spawn",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	});

	it("spawn still rejects a ref neither the workspace nor the target resolves", async () => {
		const workspace = fakeWorkspace(null);
		const target = fakeTarget({ resolveRef: () => false });
		await expect(
			spawnToolDef.run(
				contextWith({ workspace, target }),
				{ bundle: "kernel_pack", entity_def: "srd/monster/goblin", at: "kernel_pack/arena/center" },
				"spawn",
			),
		).rejects.toThrow(/entity_def/);
	});

	it("a `target` thunk is re-resolved per call (mirrors `db`'s value-or-thunk convention)", async () => {
		const workspace = fakeWorkspace(null);
		let connected = false;
		const target: AuthorTarget = fakeTarget({
			kind: "live",
			resolveRef: (rowKind, id) =>
				connected &&
				((rowKind === "entity_definitions" && id === "srd/monster/goblin") ||
					(rowKind === "place_nodes" && id === "kernel_pack/arena/center")),
		});
		const context = contextWith({ workspace, target: () => (connected ? target : undefined) });

		await expect(
			spawnToolDef.run(
				context,
				{ bundle: "kernel_pack", entity_def: "srd/monster/goblin", at: "kernel_pack/arena/center" },
				"spawn-disconnected",
			),
		).rejects.toThrow(/entity_def/);

		connected = true;
		const result = await spawnToolDef.run(
			context,
			{ bundle: "kernel_pack", entity_def: "srd/monster/goblin", at: "kernel_pack/arena/center" },
			"spawn-connected",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
	});

	it("spellkave_apply_manifest_delta flushes through context.target when wired, naming the target kind", async () => {
		const applyBatch = async (toml: string) => ({
			ok: true,
			detail: `merged ${toml.length} bytes`,
		});
		const target = fakeTarget({ kind: "local", applyBatch });
		const { APPLY_MANIFEST_DELTA_TOOL, createAuthorFacingBoundTools } = await import(
			"@spellkave/tool-authoring"
		);
		const tool = createAuthorFacingBoundTools(contextWith({ target })).find(
			(t) => t.name === APPLY_MANIFEST_DELTA_TOOL,
		);
		if (tool === undefined) throw new Error("missing spellkave_apply_manifest_delta");
		const result = (await tool.execute("apply", {
			toml: 'schema_version = "1.0.0"\n',
		})) as { details: unknown };
		expect(result.details).toMatchObject({ ok: true, target: "local", source: "toml" });
	});

	it("spellkave_apply_manifest_delta commits workspace scratch when toml is omitted", async () => {
		const seen: string[] = [];
		const applyBatch = async (toml: string) => {
			seen.push(toml);
			return { ok: true, detail: "ok" };
		};
		const scratch = 'schema_version = "1.0.0"\n[[place_graphs]]\nplace_graph_id = "tri"\n';
		const target = fakeTarget({ kind: "live", applyBatch });
		const { APPLY_MANIFEST_DELTA_TOOL, createAuthorFacingBoundTools } = await import(
			"@spellkave/tool-authoring"
		);
		const tool = createAuthorFacingBoundTools(
			contextWith({ target, workspace: fakeWorkspace(scratch) }),
		).find((t) => t.name === APPLY_MANIFEST_DELTA_TOOL);
		if (tool === undefined) throw new Error("missing spellkave_apply_manifest_delta");
		const result = (await tool.execute("apply-scratch", {})) as { details: unknown };
		expect(seen).toEqual([scratch]);
		expect(result.details).toMatchObject({ ok: true, target: "live", source: "scratch" });
	});

	it("spellkave_query: target: 'workspace' override ignores a configured target entirely", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const target = fakeTarget({
			kind: "local",
			lookup: () => [
				{
					resource_definition_id: "other_bundle/mana",
					bundle_id: "other_bundle",
					value_kind: "int",
				},
			],
		});
		const result = await queryToolDef.run(
			contextWith({ workspace, target }),
			{ kind: "resource_definitions", target: "workspace" },
			"query",
		);
		const details = result.details as QueryListResult;
		expect(details.source).toBe("workspace");
		expect(details.items.some((i) => i.id === "other_bundle/mana")).toBe(false);
	});

	it("spellkave_query: default union includes a configured local target's rows, labeling source 'workspace+local'", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const target = fakeTarget({
			kind: "local",
			lookup: (rowKind) =>
				rowKind === "resource_definitions"
					? [
							{
								resource_definition_id: "other_bundle/mana",
								bundle_id: "other_bundle",
								value_kind: "int",
								min_value: 0,
								max_value: 10,
							},
						]
					: [],
		});
		const result = await queryToolDef.run(
			contextWith({ workspace, target }),
			{ kind: "resource_definitions" },
			"query",
		);
		const details = result.details as QueryListResult;
		expect(details.source).toBe("workspace+local");
		expect(details.items.some((i) => i.id === "other_bundle/mana")).toBe(true);
	});

	it("spellkave_query: target: 'local' requested but none configured errors naming the offending param", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		await expect(
			queryToolDef.run(
				contextWith({ workspace }),
				{ kind: "resource_definitions", target: "local" },
				"query",
			),
		).rejects.toThrow(/`target`/);
	});

	it("spellkave_query: target: 'live' falls back to the legacy context.db when no target is wired", async () => {
		const { finalToml } = await runFireballSequence(false);
		const workspace = fakeWorkspace(finalToml);
		const fakeDb = {
			resource_definition: {
				iter: () => [
					{
						resourceDefinitionId: "live_bundle/mana",
						bundleId: "live_bundle",
						valueKind: "int",
						minValue: 0,
						maxValue: 10,
					},
				],
			},
		};
		const result = await queryToolDef.run(
			contextWith({ workspace, db: () => fakeDb as never }),
			{ kind: "resource_definitions", target: "live" },
			"query",
		);
		const details = result.details as QueryListResult;
		expect(details.source).toBe("workspace+live");
		expect(details.items.some((i) => i.id === "live_bundle/mana")).toBe(true);
	});
});

describe("spellkave_query — kind+id detail shape across targets (local/live ref-graph walk, #1968 §3)", () => {
	it("target: 'local', kind+id resolves a row the workspace doesn't have, sourced 'local'", async () => {
		const workspace = fakeWorkspace(null);
		const target = fakeTarget({
			kind: "local",
			lookup: (rowKind) =>
				rowKind === "resource_definitions"
					? [
							{
								resource_definition_id: "other_bundle/mana",
								bundle_id: "other_bundle",
								display_name: "Mana",
								value_kind: "int",
								min_value: 0,
								max_value: 10,
							},
						]
					: [],
		});
		const result = await queryToolDef.run(
			contextWith({ workspace, target }),
			{ kind: "resource_definitions", id: "other_bundle/mana" },
			"query",
		);
		const details = result.details as QueryDetailResult;
		expect(details.found).toBe(true);
		expect(details.source).toBe("local");
		expect(details.row.display_name).toBe("Mana");
	});

	it("inbound_refs on a local target walk EVERY known row kind that target answers, not just the queried kind (assembled via AuthorTarget.lookup per kind, #1968 §3)", async () => {
		const workspace = fakeWorkspace(null);
		const target = fakeTarget({
			kind: "local",
			lookup: (rowKind) => {
				if (rowKind === "capability_definitions") {
					return [
						{
							capability_id: "other_bundle/firebloom",
							bundle_id: "other_bundle",
							actor_kind: "npc",
							display_name: "Firebloom",
							description: "",
						},
					];
				}
				if (rowKind === "affordance_templates") {
					return [
						{
							template_id: "other_bundle/firebloom/cast",
							bundle_id: "other_bundle",
							niche_id: "capability:other_bundle/firebloom",
							capability_id: "other_bundle/firebloom",
							display_name: "Cast Firebloom",
							outcome_template_id: "other_bundle/firebloom/outcome",
						},
					];
				}
				return [];
			},
		});
		const result = await queryToolDef.run(
			contextWith({ workspace, target }),
			{ kind: "capability_definitions", id: "other_bundle/firebloom" },
			"query",
		);
		const details = result.details as QueryDetailResult;
		expect(details.found).toBe(true);
		expect(details.inbound_refs).toContainEqual({
			kind: "affordance_templates",
			id: "other_bundle/firebloom/cast",
			field: "capability_id",
		});
	});
});



// ---------------------------------------------------------------------------
// #1968 verb-UX round 2 gap② — target-aware validation (commitOrReport
// validates against target ∪ workspace, not the workspace standalone, once a
// `context.target` is wired). Mirrors the server's own
// world-aware admission semantic (live world ∪ delta).
// ---------------------------------------------------------------------------

describe("#1968 verb-UX round 2 gap② — target-aware validation (commitOrReport)", () => {
	let fixturesRoot: string;

	afterEach(() => {
		if (fixturesRoot) rmSync(fixturesRoot, { recursive: true, force: true });
	});

	function seedTargetFolder(): string {
		fixturesRoot = mkdtempSync(join(tmpdir(), "commit-target-aware-"));
		const dir = join(fixturesRoot, "gap2_target");
		writeOutputs(
			dir,
			{
				bundle_id: "gap2_target",
				display_name: "Gap2 Target",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "target folder for gap② tests",
			},
			{ bundle: "gap2_target", profile: "gap2_target" },
			["base/catalog.toml"],
			[
				{
					relPath: "base/catalog.toml",
					groups: [
						{
							kind: "entity_definitions",
							rows: [
								{
									entity_def_id: "gap2_target/monster/goblin",
									bundle_id: "gap2_target",
									display_name: "Goblin",
								},
							],
						},
						{
							kind: "object_state_definitions",
							rows: [
								{
									state_id: "gap2_target/ac",
									bundle_id: "gap2_target",
									target_kind: "entity",
									display_name: "Armor Class",
								},
							],
						},
						{
							kind: "action_definitions",
							rows: [
								{
									action_id: "gap2_target/answer",
									bundle_id: "gap2_target",
									// Ungated (empty capability_id, no existence check — same
									// convention `spellkave_define_action_verb`'s own tests use).
									required_capability: "",
									on_success: "gap2_target/answer/success",
									display_name: "Answer",
								},
							],
						},
					],
				},
			],
		);
		return dir;
	}

	// SAME bundle_id throughout ("gap2_target") — mirrors the real fixture case
	// this gap closes (`author-monster-ac-supplement.ts`'s entity_definition_
	// initial_state satellite pointing at entity/state defs authored in a
	// DIFFERENT FRAGMENT FILE of the SAME `srd` bundle, not a different bundle
	// — a genuinely cross-BUNDLE ref additionally trips MF-VAL-214
	// (cross-bundle-scope, requires the owning bundle to declare `depends_on`),
	// a SEPARATE check this gap does not touch.
	it("CLOSED WORLD UNCHANGED: with NO target, a ref to a row that exists only in another fragment stays a Fatal, exactly as before this change", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "gap2_target",
				kind: "entity_definition_initial_state",
				rows: [
					{
						bundle_id: "gap2_target",
						entity_def_id: "gap2_target/monster/goblin",
						state_id: "gap2_target/ac",
						value_bool: true,
						value_int: 15,
					},
				],
			},
			"seed-no-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(
			details.diagnostics?.some((d) => d.code === "MF-VAL-252" || d.code === "MF-VAL-253"),
		).toBe(true);
		expect(workspace.current()).toBeNull();
	});

	it("local driver: a ref to an entity_definitions/object_state_definitions row that lives ONLY in the target resolves (MF-VAL-252/253), and the row persists", async () => {
		const dir = seedTargetFolder();
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap2_target",
				kind: "entity_definition_initial_state",
				rows: [
					{
						bundle_id: "gap2_target",
						entity_def_id: "gap2_target/monster/goblin",
						state_id: "gap2_target/ac",
						value_bool: true,
						value_int: 15,
					},
				],
			},
			"seed-with-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "entity_definition_initial_state")).toMatchObject([
			{ entity_def_id: "gap2_target/monster/goblin", state_id: "gap2_target/ac", value_int: 15 },
		]);
		// The augmented rows are VALIDATION-ONLY — the target's own
		// entity_definitions/object_state_definitions rows are never copied into
		// the persisted workspace manifest.
		expect(tableRows(manifest, "entity_definitions")).toHaveLength(0);
		expect(tableRows(manifest, "object_state_definitions")).toHaveLength(0);
	});

	// sk-jay0.2.33.15.7 (ADR-0142): prompt_definitions.response_action_ids
	// (MF-VAL-101) resolving against a DEPENDENCY bundle's action_definitions —
	// the kavemouth quest-prompt gap. Same "CLOSED WORLD UNCHANGED / local
	// driver / live driver" triple as the entity_definitions gap② tests above.
	it("CLOSED WORLD UNCHANGED: with NO target, prompt_definitions.response_action_ids naming an action that exists only in another fragment stays a Fatal", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "gap2_target",
				kind: "prompt_definitions",
				rows: [
					{
						prompt_def_id: "gap2_target/prompt/quest",
						bundle_id: "gap2_target",
						source_selector: "gap2_target/talker",
						open_predicate_source: "",
						response_action_ids: ["gap2_target/answer"],
						audience_kind_ref: "core/audience/broadcast",
						trace_window_ticks: 20,
						contract_version: 1,
					},
				],
			},
			"prompt-no-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(
			details.diagnostics?.some(
				(d) => d.code === "MF-VAL-101" && d.message.includes("gap2_target/answer"),
			),
		).toBe(true);
		expect(workspace.current()).toBeNull();
	});

	it("local driver: prompt_definitions.response_action_ids naming an action that lives ONLY in the target resolves, and the action row is never persisted", async () => {
		const dir = seedTargetFolder();
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap2_target",
				kind: "prompt_definitions",
				rows: [
					{
						prompt_def_id: "gap2_target/prompt/quest",
						bundle_id: "gap2_target",
						source_selector: "gap2_target/talker",
						open_predicate_source: "",
						response_action_ids: ["gap2_target/answer"],
						audience_kind_ref: "core/audience/broadcast",
						trace_window_ticks: 20,
						contract_version: 1,
					},
				],
			},
			"prompt-with-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "prompt_definitions")).toMatchObject([
			{ prompt_def_id: "gap2_target/prompt/quest", response_action_ids: ["gap2_target/answer"] },
		]);
		// Validation-only, same as the entity_definitions/object_state_definitions
		// case above — the target's own action_definitions row is never copied
		// into the persisted workspace manifest.
		expect(tableRows(manifest, "action_definitions")).toHaveLength(0);
	});

	it("live driver (fake SnapshotDb, offline): prompt_definitions.response_action_ids naming an action that lives ONLY in the live target resolves", async () => {
		const fakeDb = emptyLiveDb({
			action_definition: {
				iter: () => [
					{
						actionId: "gap2_live/answer",
						bundleId: "gap2_live",
						requiredCapability: "",
						onSuccess: "gap2_live/answer/success",
						displayName: "Answer",
						resolutionMode: "Deterministic",
					},
				],
			},
		});
		const target = createLiveAuthorTarget({ db: () => fakeDb as never });
		const workspace = fakeWorkspace(null);

		// Without a target: naming the same action fails standalone (closed world).
		const withoutTarget = await writeRowsToolDef.run(
			contextWith({ workspace: fakeWorkspace(null) }),
			{
				bundle: "gap2_live",
				kind: "prompt_definitions",
				rows: [
					{
						prompt_def_id: "gap2_live/prompt/quest",
						bundle_id: "gap2_live",
						source_selector: "gap2_live/talker",
						open_predicate_source: "",
						response_action_ids: ["gap2_live/answer"],
						audience_kind_ref: "core/audience/broadcast",
						trace_window_ticks: 20,
						contract_version: 1,
					},
				],
			},
			"prompt-no-target-live",
		);
		const withoutDetails = withoutTarget.details as VerbResult;
		expect(withoutDetails.ok).toBe(false);

		// With the live target wired: response_action_ids resolves against the
		// live action_definition table.
		const withTarget = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap2_live",
				kind: "prompt_definitions",
				rows: [
					{
						prompt_def_id: "gap2_live/prompt/quest",
						bundle_id: "gap2_live",
						source_selector: "gap2_live/talker",
						open_predicate_source: "",
						response_action_ids: ["gap2_live/answer"],
						audience_kind_ref: "core/audience/broadcast",
						trace_window_ticks: 20,
						contract_version: 1,
					},
				],
			},
			"prompt-with-target-live",
		);
		const details = withTarget.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
	});

	it("local driver: MF-VAL-101 on bundles.depends_on is dropped once a target is active — a depends_on the SAME manifest doesn't declare no longer blocks", async () => {
		const dir = seedTargetFolder();
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap2_proof",
				kind: "bundles",
				rows: [
					{
						bundle_id: "gap2_proof",
						display_name: "Gap2 Proof",
						author: "spellkave-test",
						version: "0.1.0",
						depends_on: ["gap2_target"],
						description: "proof bundle depending on gap2_target, not self-declared",
					},
				],
			},
			"bundles-with-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-101")).toBe(false);
	});

	it("live driver (fake SnapshotDb, offline): a ref to a resource_definitions row that lives ONLY in the live target resolves", async () => {
		const fakeDb = emptyLiveDb({
			resource_definition: {
				iter: () => [
					{
						resourceDefinitionId: "gap2_live/hp",
						bundleId: "gap2_live",
						displayName: "Hit Points",
						valueKind: "int",
						recoveryRule: "none",
						minValue: 0,
						maxValue: 20,
					},
				],
			},
		});
		const target = createLiveAuthorTarget({ db: () => fakeDb as never });
		const workspace = fakeWorkspace(null);

		// Without a target: a cost pool debit referencing an undeclared resource
		// fails standalone (closed world).
		const withoutTarget = await defineBehaviorToolDef
			.run(
				contextWith({ workspace: fakeWorkspace(null) }),
				{
					bundle: "gap2_live",
					id: "poke",
					grant_to: "gap2_live/caster",
					offered_when: { reach: "same_node" },
					action_class: "spell",
					effect: {
						primitive: "ForEachActorInRadius",
						shape: { id: "core/area/sphere", radius: 1 },
						write: { primitive: "ModifyResource", resource: "gap2_live/hp", delta: "-1" },
					},
				},
				"no-target",
			)
			.catch((err: unknown) => err);
		expect(withoutTarget).toBeInstanceOf(Error);

		// With the live target wired: resourceExists (the pre-check) AND
		// commitOrReport's own target-aware validation both see the row.
		await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap2_live",
				kind: "place_nodes",
				rows: [
					{
						node_id: "gap2_live/node",
						bundle_id: "gap2_live",
						place_graph_id: "gap2_live/graph",
						local_id: "node",
						substrate_id: "outdoor",
						display_name: "Node",
					},
				],
			},
			"seed-node",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap2_live",
				kind: "actor_spatial_locations",
				rows: [
					{
						entity_key: "gap2_live/caster",
						place_node_id: "gap2_live/node",
						bundle_id: "gap2_live",
						selection_path: "manifest:gap2_live/caster",
					},
				],
			},
			"seed-loc",
		);
		const withTarget = await defineBehaviorToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap2_live",
				id: "poke",
				grant_to: "gap2_live/caster",
				offered_when: { reach: "same_node" },
				action_class: "spell",
				effect: {
					primitive: "ForEachActorInRadius",
					shape: { id: "core/area/sphere", radius: 1 },
					write: { primitive: "ModifyResource", resource: "gap2_live/hp", delta: "-1" },
				},
			},
			"with-target",
		);
		expect((withTarget.details as VerbResult).ok, JSON.stringify(withTarget.details)).toBe(true);
	});

	// sk-jay0.7.23.35 review follow-up: `augmentForValidation`'s
	// `entity_definitions` reference-closure narrowing (`authoring-verbs.ts`)
	// must be seeded from EVERY row already in the augmented manifest, not
	// just the calling workspace's own rows — a committed `entities`
	// instance row (which stays fully augmented, unnarrowed) can reference
	// an `entity_definitions` row the workspace never mentions at all. If
	// the closure only scanned workspace rows, that reference would dangle
	// after narrowing and the validator's `entities.quantity` stackable
	// check (MF-VAL-339) would false-fire — an over-report that blocks a
	// commit unrelated to the entity the diagnostic is about.
	it("SK-JAY0.7.23.35: entity_definitions referenced only by a committed entities row (never by the workspace) resolves cleanly", async () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "entities-closure-"));
		const dir = join(fixturesRoot, "ec_target");
		writeOutputs(
			dir,
			{
				bundle_id: "ec_target",
				display_name: "Entities Closure Target",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "target folder for the entity_definitions closure's entities-seed test",
			},
			{ bundle: "ec_target", profile: "ec_target" },
			["base/catalog.toml"],
			[
				{
					relPath: "base/catalog.toml",
					groups: [
						{
							kind: "entity_definitions",
							rows: [
								{
									entity_def_id: "ec_target/monster/only-via-entities",
									bundle_id: "ec_target",
									display_name: "Only Via Entities",
									stackable: true,
								},
								{
									entity_def_id: "ec_target/monster/directly-referenced",
									bundle_id: "ec_target",
									display_name: "Directly Referenced",
								},
							],
						},
						{
							kind: "object_state_definitions",
							rows: [
								{
									state_id: "ec_target/ac",
									bundle_id: "ec_target",
									target_kind: "entity",
									display_name: "Armor Class",
								},
							],
						},
						{
							kind: "entities",
							rows: [
								{
									entity_key: "ec_target/instance/goblin-1",
									bundle_id: "ec_target",
									entity_def_id: "ec_target/monster/only-via-entities",
									name: "Goblin One",
									kind: "npc",
									place_node_id: "",
									quantity: 2,
								},
							],
						},
					],
				},
			],
		);
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		// This call references ONLY "directly-referenced" — the entities row,
		// and the "only-via-entities" definition it alone points at, are
		// never mentioned by the workspace at all.
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "ec_target",
				kind: "entity_definition_initial_state",
				rows: [
					{
						bundle_id: "ec_target",
						entity_def_id: "ec_target/monster/directly-referenced",
						state_id: "ec_target/ac",
						value_bool: true,
						value_int: 15,
					},
				],
			},
			"entities-closure-unrelated-call",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.diagnostics ?? []).toHaveLength(0);
	});
});

describe("#1968 verb-UX round 3 (shape 4) — place-graph target-augmentation, local-only", () => {
	let fixturesRoot: string;

	afterEach(() => {
		if (fixturesRoot) rmSync(fixturesRoot, { recursive: true, force: true });
	});

	it("local driver: appending a place_node to a place_graph owned by a SIBLING fragment of the SAME bundle resolves (the redbrands.toml shape)", async () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "gap4-place-"));
		const dir = join(fixturesRoot, "gap4_target");
		writeOutputs(
			dir,
			{
				bundle_id: "gap4_target",
				display_name: "Gap4 Target",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "target folder for shape-4 tests",
			},
			{ bundle: "gap4_target", profile: "gap4_target" },
			["base/spatial.toml"],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "place_graphs",
							rows: [
								{
									place_graph_id: "gap4_target/town",
									bundle_id: "gap4_target",
									substrate_id: "outdoor",
									display_name: "Town",
									anchor_node_id: "gap4_target/town/green",
								},
							],
						},
					],
				},
			],
		);
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap4_target",
				kind: "place_nodes",
				rows: [
					{
						node_id: "gap4_target/town/inn",
						bundle_id: "gap4_target",
						place_graph_id: "gap4_target/town", // owned by the SIBLING fragment above, not this call
						local_id: "inn",
						substrate_id: "outdoor",
						display_name: "The Inn",
					},
				],
			},
			"seed-sibling-graph-node",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "place_nodes")).toMatchObject([
			{ node_id: "gap4_target/town/inn", place_graph_id: "gap4_target/town" },
		]);
		// Validation-only augmentation: the target's own place_graphs row is never
		// copied into the persisted workspace manifest.
		expect(tableRows(manifest, "place_graphs")).toHaveLength(0);
	});

	it("local driver: a DEPENDENCY bundle's place_graph is NOT pulled in (same-bundle filter) — cross-bundle graph refs stay Fatal", async () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "gap4-cross-bundle-"));
		const depDir = join(fixturesRoot, "gap4_dep");
		writeOutputs(
			depDir,
			{
				bundle_id: "gap4_dep",
				display_name: "Gap4 Dep",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "dependency bundle owning its own place_graph",
			},
			{ bundle: "gap4_dep", profile: "gap4_dep" },
			["base/spatial.toml"],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "place_graphs",
							rows: [
								{
									place_graph_id: "gap4_dep/town",
									bundle_id: "gap4_dep",
									substrate_id: "outdoor",
									display_name: "Dep Town",
									anchor_node_id: "gap4_dep/town/green",
								},
							],
						},
					],
				},
			],
		);
		const mainDir = join(fixturesRoot, "gap4_main");
		writeOutputs(
			mainDir,
			{
				bundle_id: "gap4_main",
				display_name: "Gap4 Main",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: ["gap4_dep"],
				description:
					"the bundle under test — depends on gap4_dep but must not inherit its place_graphs",
			},
			{ bundle: "gap4_main", profile: "gap4_main" },
			[],
			[],
		);
		const target = createLocalAuthorTarget(mainDir);
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap4_main",
				kind: "place_nodes",
				rows: [
					{
						node_id: "gap4_main/inn",
						bundle_id: "gap4_main",
						place_graph_id: "gap4_dep/town", // a DIFFERENT bundle's graph — must stay unresolved
						local_id: "inn",
						substrate_id: "outdoor",
						display_name: "The Inn",
					},
				],
			},
			"seed-cross-bundle-graph-node",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-101")).toBe(true);
	});

	it("live driver: place_graphs/place_nodes augmentation never activates — MF-VAL-101 unknown-graph stays Fatal even with a live target wired", async () => {
		const target = createLiveAuthorTarget({ db: () => emptyLiveDb() });
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "gap4_live",
				kind: "place_nodes",
				rows: [
					{
						node_id: "gap4_live/inn",
						bundle_id: "gap4_live",
						place_graph_id: "gap4_live/town", // never authored anywhere in this test
						local_id: "inn",
						substrate_id: "outdoor",
						display_name: "The Inn",
					},
				],
			},
			"seed-live-unknown-graph",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-101")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// #1968 B-9 lane (2026-07-25) — entity-INSTANCE target-augmentation, local-only
// (MF-VAL-242 entity_tag.entity_key / MF-VAL-244 knows_entity bindings_json).
// Mirrors the gap② (`VALIDATION_AUGMENT_KINDS`) and shape-4
// (`PLACE_AUGMENT_KINDS_LOCAL_ONLY`) test shapes above, for the NEW
// `ENTITY_INSTANCE_AUGMENT_KINDS_LOCAL_ONLY` set. The real repro this closes:
// `packages/spellkave-phandelver/fixtures/base/locate-castle.toml`
// (MF-VAL-244) and `.../explorer-combat-factions.toml` (MF-VAL-242) — both
// author entity_tag/knows_entity references against an entity INSTANCE owned
// by an already-committed SIBLING fragment.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// #2092 / srd-cc executable finding #38 — modifier_target_definitions in
// VALIDATION_AUGMENT_KINDS. Same shape as gap②: a sibling fragment owns the
// axis row; the workspace authors a modifier_template that applies_to it.
// ---------------------------------------------------------------------------

describe("#2092 — modifier_target_definitions target-augmentation (MF-VAL-225)", () => {
	let fixturesRoot: string;

	afterEach(() => {
		if (fixturesRoot) rmSync(fixturesRoot, { recursive: true, force: true });
	});

	function seedAxisTargetFolder(): string {
		fixturesRoot = mkdtempSync(join(tmpdir(), "mt-axis-target-"));
		const dir = join(fixturesRoot, "mt_axis");
		writeOutputs(
			dir,
			{
				bundle_id: "mt_axis",
				display_name: "MT Axis Target",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "target folder owning a custom modifier axis",
			},
			{ bundle: "mt_axis", profile: "mt_axis" },
			["base/axes.toml"],
			[
				{
					relPath: "base/axes.toml",
					groups: [
						{
							kind: "modifier_target_definitions",
							rows: [
								{
									target_id: "mt_axis/ac",
									bundle_id: "mt_axis",
									shape: "Numeric",
									display_name: "Armor Class",
								},
							],
						},
					],
				},
			],
		);
		return dir;
	}

	it("CLOSED WORLD UNCHANGED: with NO target, applies_to a sibling-only axis stays Fatal (MF-VAL-225)", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "mt_axis",
				kind: "modifier_templates",
				rows: [
					{
						modifier_template_id: "mt_axis/cover_half",
						bundle_id: "mt_axis",
						applies_to: "mt_axis/ac",
						display_name: "Half Cover",
						predicate_source: "",
						modifier_expression_source: "let bonus = 2; bonus",
						priority: 0,
						delta_kind: "Plus",
					},
				],
			},
			"seed-no-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-225")).toBe(true);
		expect(workspace.current()).toBeNull();
	});

	it("local driver: applies_to an axis that lives ONLY in the target resolves (MF-VAL-225 no longer false-fails)", async () => {
		const dir = seedAxisTargetFolder();
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "mt_axis",
				kind: "modifier_templates",
				rows: [
					{
						modifier_template_id: "mt_axis/cover_half",
						bundle_id: "mt_axis",
						applies_to: "mt_axis/ac",
						display_name: "Half Cover",
						predicate_source: "",
						modifier_expression_source: "let bonus = 2; bonus",
						priority: 0,
						delta_kind: "Plus",
					},
				],
			},
			"seed-with-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "modifier_templates")).toMatchObject([
			{ modifier_template_id: "mt_axis/cover_half", applies_to: "mt_axis/ac" },
		]);
		// Validation-only: target axis row is never copied into the workspace.
		expect(tableRows(manifest, "modifier_target_definitions")).toHaveLength(0);
	});
});

describe("#1968 B-9 lane — entities target-augmentation, local-only (MF-VAL-242/244)", () => {
	let fixturesRoot: string;

	afterEach(() => {
		if (fixturesRoot) rmSync(fixturesRoot, { recursive: true, force: true });
	});

	function seedEntityTargetFolder(): string {
		fixturesRoot = mkdtempSync(join(tmpdir(), "b9-entity-target-"));
		const dir = join(fixturesRoot, "b9_target");
		writeOutputs(
			dir,
			{
				bundle_id: "b9_target",
				display_name: "B9 Target",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "target folder for the B-9 entity-instance augmentation tests",
			},
			{ bundle: "b9_target", profile: "b9_target" },
			["base/entities.toml"],
			[
				{
					relPath: "base/entities.toml",
					groups: [
						{
							kind: "entities",
							rows: [
								{
									entity_key: "b9_target/castle",
									bundle_id: "b9_target",
									name: "Castle",
									kind: "place",
									place_node_id: "",
								},
							],
						},
					],
				},
			],
		);
		return dir;
	}

	// ---- MF-VAL-242 (entity_tag.entity_key) ----------------------------------

	it("CLOSED WORLD UNCHANGED: with NO target, entity_tag against an entity that lives only in a sibling fragment stays Fatal (MF-VAL-242)", async () => {
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "b9_target",
				kind: "entity_tag",
				rows: [{ entity_key: "b9_target/castle", tag: "explored" }],
			},
			"seed-no-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-242")).toBe(true);
	});

	it("local driver: entity_tag against an entity that lives ONLY in the target resolves (MF-VAL-242 no longer false-fails)", async () => {
		const dir = seedEntityTargetFolder();
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "b9_target",
				kind: "entity_tag",
				rows: [{ entity_key: "b9_target/castle", tag: "explored" }],
			},
			"seed-with-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "entity_tag")).toMatchObject([
			{ entity_key: "b9_target/castle", tag: "explored" },
		]);
		// Validation-only augmentation: the target's own `entities` row is never
		// copied into the persisted workspace manifest.
		expect(tableRows(manifest, "entities")).toHaveLength(0);
	});

	it("local driver: a GENUINE dangling entity_tag ref (nowhere in target ∪ workspace) still Fatal — augmentation never weakens real-miss detection (MF-VAL-242)", async () => {
		const dir = seedEntityTargetFolder();
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "b9_target",
				kind: "entity_tag",
				rows: [{ entity_key: "b9_target/nonexistent", tag: "explored" }],
			},
			"seed-genuine-miss",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-242")).toBe(true);
	});

	it("live driver: entities augmentation never activates (no LIVE_TABLE_ACCESSORS entry) — a dangling entity_tag ref stays Fatal even with a live target wired (MF-VAL-242)", async () => {
		const target = createLiveAuthorTarget({ db: () => emptyLiveDb() });
		const workspace = fakeWorkspace(null);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "b9_live",
				kind: "entity_tag",
				rows: [{ entity_key: "b9_live/nowhere", tag: "explored" }],
			},
			"seed-live-unknown-entity",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-242")).toBe(true);
	});

	// ---- MF-VAL-244 (place_edge_affordance.bindings_json knows_entity) ------

	async function seedKnowsEntityTemplate(
		context: ReturnType<typeof contextWith>,
		bundle: string,
	): Promise<void> {
		await writeRowsToolDef.run(
			context,
			{
				bundle,
				kind: "affordance_templates",
				rows: [
					{
						template_id: `${bundle}/affordance/march`,
						niche_id: `${bundle}/passable_portal`,
						capability_id: `${bundle}/walk`,
						display_name: "March",
						outcome_template_id: `${bundle}/move_outcome`,
						predicate_source: "actor.knows_entity($bindings.castle)",
						range_m: 0,
					},
				],
			},
			"seed-template",
		);
	}

	it("local driver: a knows_entity binding naming an entity that lives ONLY in the target resolves (MF-VAL-244 no longer false-fails)", async () => {
		const dir = seedEntityTargetFolder();
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace, target });
		await seedKnowsEntityTemplate(context, "b9_target");
		const result = await writeRowsToolDef.run(
			context,
			{
				bundle: "b9_target",
				kind: "place_edge_affordance",
				rows: [
					{
						edge_key: "b9_target/edge/turnoff",
						affordance_template_id: "b9_target/affordance/march",
						bindings_json: '{"castle":"b9_target/castle"}',
					},
				],
			},
			"seed-binding-with-target",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "place_edge_affordance")).toMatchObject([
			{ edge_key: "b9_target/edge/turnoff", bindings_json: '{"castle":"b9_target/castle"}' },
		]);
		expect(tableRows(manifest, "entities")).toHaveLength(0);
	});

	it("local driver: a GENUINE dangling knows_entity binding (nowhere in target ∪ workspace) still Fatal — augmentation never weakens real-miss detection (MF-VAL-244)", async () => {
		const dir = seedEntityTargetFolder();
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace, target });
		await seedKnowsEntityTemplate(context, "b9_target");
		const result = await writeRowsToolDef.run(
			context,
			{
				bundle: "b9_target",
				kind: "place_edge_affordance",
				rows: [
					{
						edge_key: "b9_target/edge/turnoff",
						affordance_template_id: "b9_target/affordance/march",
						bindings_json: '{"castle":"b9_target/nonexistent"}',
					},
				],
			},
			"seed-binding-genuine-miss",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-244")).toBe(true);
	});
});

describe("#1968 verb-UX round 3 — commitOrReport catches a host writeToml scratch-shape-guard throw", () => {
	it("a VALID render whose workspace.writeToml THROWS is surfaced as { ok: false, guard }, not an uncaught exception", async () => {
		const workspace: AuthorWorkspace = {
			readToml: () => null,
			writeToml: () => {
				throw new Error('free-authored scratch TOML must never set profile = "core".');
			},
		};
		const result = await defineResourceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "guard_test", id: "hp", min_value: 0, max_value: 10 },
			"call-1",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(details.guard).toMatch(/scratch TOML must never set profile/);
		expect(details.diagnostics).toBeUndefined();
		expect((result.content[0] as { text: string }).text).toMatch(/REJECTED by scratch-shape guard/);
	});

	it("an INVALID render never reaches workspace.writeToml at all — the guard rejection stays diagnostics-shaped", async () => {
		let writeTomlCalled = false;
		const workspace: AuthorWorkspace = {
			readToml: () => null,
			writeToml: (toml: string) => {
				writeTomlCalled = true;
				return toml;
			},
		};
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "guard_test",
				kind: "entity_tag",
				// Dangling ref: no [[entities]] row named this — a genuine
				// validator rejection, distinct from the writeToml-throws case above.
				rows: [{ entity_key: "guard_test/nonexistent", tag: "hidden", bundle_id: "guard_test" }],
			},
			"call-1",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(details.guard).toBeUndefined();
		expect(writeTomlCalled).toBe(false);
	});
});

describe("spellkave_bind_actor (#1968 verb-UX round 6, item 1 — character identity and ordinary capability verb)", () => {
	async function spawnOne(workspace: ReturnType<typeof fakeWorkspace>) {
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "us_dungeon", nodes: [{ id: "us_dungeon/vault" }], edges: [] },
			"place",
		);
		await spawnToolDef.run(
			contextWith({ workspace }),
			{ bundle: "us_dungeon", entity_def: "npc", at: "us_dungeon/vault", key_prefix: "npc" },
			"spawn",
		);
	}

	it("directs privileged requests to role grants before writing the workspace", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			bindActorToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "us_dungeon",
					entity_key: "us_dungeon/npc_1",
					capabilities: [{ capability_id: "frontier.apply_manifest", source: "core" }],
				},
				"bind",
			),
		).rejects.toThrow("spellkave_grant_role");
		expect(workspace.current()).toBeNull();
	});

	it("binds identity to $sender/primary by default — no capabilities param at all", async () => {
		const workspace = fakeWorkspace(null);
		await spawnOne(workspace);
		const result = await bindActorToolDef.run(
			contextWith({ workspace }),
			{ bundle: "us_dungeon", entity_key: "us_dungeon/npc_1" },
			"bind",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "actor_identities")).toEqual([
			{
				entity_key: "us_dungeon/npc_1",
				identity: "$sender",
				role: "primary",
				bundle_id: "us_dungeon",
			},
		]);
		expect(tableRows(manifest, "actor_capabilities")).toEqual([]);
	});

	it("the combined genesis-window idiom — one call authors BOTH the actor_identities bind and the actor_capabilities grant (mirrors srd/regdar / phandelver/hero / the US5 live-dungeon idiom byte-for-byte)", async () => {
		const workspace = fakeWorkspace(null);
		await spawnOne(workspace);
		// A bootstrap-shaped capability this call GRANTS but never CREATES — properly
		// namespaced (unlike the real 'frontier.apply_manifest', which is a KNOWN
		// accepted-warning cross-namespace id, MF-VAL-291 — this test proves the
		// bind+grant MECHANISM, not that specific real capability's own namespace
		// exception, so it stays warning-free).
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "core",
				kind: "capability_definitions",
				rows: [
					{
						capability_id: "core/frontier_apply_manifest",
						bundle_id: "core",
						actor_kind: "entity",
						display_name: "Apply Manifest",
						description: "test stand-in for the real bootstrap-seeded frontier.apply_manifest.",
					},
				],
			},
			"seed-cap",
		);
		const result = await bindActorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "us_dungeon",
				entity_key: "us_dungeon/npc_1",
				capabilities: [{ capability_id: "core/frontier_apply_manifest", source: "core" }],
			},
			"bind",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_added).toBe(2);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "actor_identities")).toEqual([
			{
				entity_key: "us_dungeon/npc_1",
				identity: "$sender",
				role: "primary",
				bundle_id: "us_dungeon",
			},
		]);
		expect(tableRows(manifest, "actor_capabilities")).toMatchObject([
			{
				actor_entity_key: "us_dungeon/npc_1",
				capability_id: "core/frontier_apply_manifest",
				source: "core",
				bundle_id: "us_dungeon",
			},
		]);
	});

	it("workspace idempotency: re-binding the SAME entity_key REPLACES the identity row, never duplicates", async () => {
		const workspace = fakeWorkspace(null);
		await spawnOne(workspace);
		await bindActorToolDef.run(
			contextWith({ workspace }),
			{ bundle: "us_dungeon", entity_key: "us_dungeon/npc_1", role: "primary" },
			"bind-1",
		);
		const second = await bindActorToolDef.run(
			contextWith({ workspace }),
			{ bundle: "us_dungeon", entity_key: "us_dungeon/npc_1", role: "dm" },
			"bind-2",
		);
		const details = second.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_replaced).toBe(1);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "actor_identities")).toEqual([
			{
				entity_key: "us_dungeon/npc_1",
				identity: "$sender",
				role: "dm",
				bundle_id: "us_dungeon",
			},
		]);
	});

	it("rejects an entity_key with no actor_spatial_locations row, naming `entity_key` (spawn it first)", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			bindActorToolDef.run(
				contextWith({ workspace }),
				{ bundle: "us_dungeon", entity_key: "us_dungeon/ghost" },
				"bind",
			),
		).rejects.toThrow(/`entity_key`/);
	});
});

describe("spellkave_stow_item / spellkave_equip_item (sk-9ll.3, child of sk-9ll's author-tool-gap review)", () => {
	async function placeHeroAndItems(workspace: ReturnType<typeof fakeWorkspace>) {
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "adv", nodes: [{ id: "adv/loft" }], edges: [] },
			"place-graph",
		);
		await spawnToolDef.run(
			contextWith({ workspace }),
			{ bundle: "adv", entity_def: "npc", at: "adv/loft", key_prefix: "hero" },
			"place-hero",
		);
		await placeEntityToolDef.run(
			contextWith({ workspace }),
			{ bundle: "adv", kind: "item", at: "adv/loft", key_prefix: "sword" },
			"place-sword",
		);
		await placeEntityToolDef.run(
			contextWith({ workspace }),
			{ bundle: "adv", kind: "item", at: "adv/loft", key_prefix: "torch" },
			"place-torch",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "core",
				kind: "equipment_slot_definitions",
				rows: [
					{
						slot_id: "core/slot/main_hand",
						bundle_id: "core",
						label: "Main Hand",
					},
				],
			},
			"seed-slot",
		);
	}

	describe("spellkave_stow_item", () => {
		it("container_entity_key omitted: stows item_entity_key directly onto actor_entity_key", async () => {
			const workspace = fakeWorkspace(null);
			await placeHeroAndItems(workspace);
			const result = await stowItemToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", actor_entity_key: "adv/hero_1", item_entity_key: "adv/sword_1" },
				"stow",
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entity_containment")).toEqual([
				{
					entity_key: "adv/sword_1",
					container_entity_key: "adv/hero_1",
					slot_id: "",
					direction: "",
				},
			]);
		});

		it("container_entity_key explicit: nests item_entity_key inside a DIFFERENT already-placed container", async () => {
			const workspace = fakeWorkspace(null);
			await placeHeroAndItems(workspace);
			await stowItemToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", actor_entity_key: "adv/hero_1", item_entity_key: "adv/sword_1" },
				"stow-kit",
			);
			const result = await stowItemToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "adv",
					actor_entity_key: "adv/hero_1",
					item_entity_key: "adv/torch_1",
					container_entity_key: "adv/sword_1",
					slot_id: "",
					direction: "in",
				},
				"stow-torch",
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(
				tableRows(manifest, "entity_containment").find((r) => r.entity_key === "adv/torch_1"),
			).toMatchObject({ container_entity_key: "adv/sword_1", direction: "in" });
		});

		it("idempotent re-call: re-stowing the SAME item/container REPLACES the row, never duplicates", async () => {
			const workspace = fakeWorkspace(null);
			await placeHeroAndItems(workspace);
			await stowItemToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", actor_entity_key: "adv/hero_1", item_entity_key: "adv/sword_1" },
				"stow-1",
			);
			const second = await stowItemToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", actor_entity_key: "adv/hero_1", item_entity_key: "adv/sword_1" },
				"stow-2",
			);
			const details = second.details as VerbResult;
			expect(details.ok, JSON.stringify(details)).toBe(true);
			expect(details.rows_replaced).toBe(1);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entity_containment")).toHaveLength(1);
		});

		it("rejects an item_entity_key with no authored entities row, naming `item_entity_key`", async () => {
			const workspace = fakeWorkspace(null);
			await placeHeroAndItems(workspace);
			await expect(
				stowItemToolDef.run(
					contextWith({ workspace }),
					{ bundle: "adv", actor_entity_key: "adv/hero_1", item_entity_key: "adv/ghost_sword" },
					"stow",
				),
			).rejects.toThrow(/`item_entity_key`/);
		});

		it("rejects an actor_entity_key with no actor_spatial_locations row, naming `actor_entity_key`", async () => {
			const workspace = fakeWorkspace(null);
			await placeHeroAndItems(workspace);
			await expect(
				stowItemToolDef.run(
					contextWith({ workspace }),
					{ bundle: "adv", actor_entity_key: "adv/ghost", item_entity_key: "adv/sword_1" },
					"stow",
				),
			).rejects.toThrow(/`actor_entity_key`/);
		});

		it("rejects a live id-keyed miss in under 1s, naming the entity_key it looked for (sk-awlo.8)", async () => {
			const workspace = fakeWorkspace(null);
			await placeHeroAndItems(workspace);
			const target = fakeTarget({
				kind: "live",
				lookup: (rowKind) =>
					rowKind === "actor_spatial_locations"
						? [{ entity_id: 2, place_node_id: "adv/loft" }]
						: [],
			});
			const started = Date.now();
			await expect(
				stowItemToolDef.run(
					contextWith({ workspace, target }),
					{ bundle: "adv", actor_entity_key: "adv/ghost", item_entity_key: "adv/sword_1" },
					"stow",
				),
			).rejects.toThrow(/looked for entity_key 'adv\/ghost'/);
			expect(Date.now() - started).toBeLessThan(1000);
		});

		it("workspace ASL without entities fails fast instead of applying a container-less delta (sk-awlo.8)", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", nodes: [{ id: "adv/loft" }], edges: [] },
				"place-graph",
			);
			await placeEntityToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", kind: "item", at: "adv/loft", key_prefix: "sword" },
				"place-sword",
			);
			await writeRowsToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "adv",
					kind: "actor_spatial_locations",
					rows: [
						{
							bundle_id: "adv",
							entity_key: "adv/ghost_hero",
							place_node_id: "adv/loft",
							selection_path: "manifest:adv/ghost_hero",
						},
					],
				},
				"fake-asl",
			);
			const started = Date.now();
			await expect(
				stowItemToolDef.run(
					contextWith({ workspace }),
					{ bundle: "adv", actor_entity_key: "adv/ghost_hero", item_entity_key: "adv/sword_1" },
					"stow",
				),
			).rejects.toThrow(/looked for entity_key 'adv\/ghost_hero'/);
			expect(Date.now() - started).toBeLessThan(1000);
		});

		it("materializes a live authored actor into workspace entities so the delta carries the container (sk-awlo.8)", async () => {
			const workspace = fakeWorkspace(null);
			await authorPlaceToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", nodes: [{ id: "adv/loft" }], edges: [] },
				"place-graph",
			);
			await placeEntityToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", kind: "item", at: "adv/loft", key_prefix: "sword" },
				"place-sword",
			);
			const target = fakeTarget({
				kind: "live",
				lookup: (rowKind) =>
					rowKind === "actor_spatial_locations"
						? [
								{
									entity_key: "adv/hero_1",
									bundle_id: "adv",
									place_node_id: "adv/loft",
									entity_def_id: "npc",
									name: "Hero",
									kind: "player",
								},
							]
						: [],
			});
			const result = await stowItemToolDef.run(
				contextWith({ workspace, target }),
				{ bundle: "adv", actor_entity_key: "adv/hero_1", item_entity_key: "adv/sword_1" },
				"stow",
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "entities").some((r) => r.entity_key === "adv/hero_1")).toBe(true);
			expect(tableRows(manifest, "entity_containment")).toEqual([
				{
					entity_key: "adv/sword_1",
					container_entity_key: "adv/hero_1",
					slot_id: "",
					direction: "",
				},
			]);
		});
	});

	describe("spellkave_equip_item", () => {
		async function placeAndStowSword(workspace: ReturnType<typeof fakeWorkspace>) {
			await placeHeroAndItems(workspace);
			await stowItemToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", actor_entity_key: "adv/hero_1", item_entity_key: "adv/sword_1" },
				"stow-sword",
			);
		}

		it("equips an already-stowed item into a named slot", async () => {
			const workspace = fakeWorkspace(null);
			await placeAndStowSword(workspace);
			const result = await equipItemToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "adv",
					actor_entity_key: "adv/hero_1",
					item_entity_key: "adv/sword_1",
					slot_id: "core/slot/main_hand",
				},
				"equip",
			);
			expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "actor_equipment_slots")).toEqual([
				{
					actor_entity_key: "adv/hero_1",
					slot_id: "core/slot/main_hand",
					item_key: "adv/sword_1",
				},
			]);
		});

		it("idempotent re-call: re-equipping the SAME item into the SAME slot REPLACES the row, never rejects", async () => {
			const workspace = fakeWorkspace(null);
			await placeAndStowSword(workspace);
			const params = {
				bundle: "adv",
				actor_entity_key: "adv/hero_1",
				item_entity_key: "adv/sword_1",
				slot_id: "core/slot/main_hand",
			};
			await equipItemToolDef.run(contextWith({ workspace }), params, "equip-1");
			const second = await equipItemToolDef.run(contextWith({ workspace }), params, "equip-2");
			const details = second.details as VerbResult;
			expect(details.ok, JSON.stringify(details)).toBe(true);
			expect(details.rows_replaced).toBe(1);
			const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<
				string,
				unknown
			>;
			expect(tableRows(manifest, "actor_equipment_slots")).toHaveLength(1);
		});

		it("rejects equipping a DIFFERENT item into an already-occupied slot, naming `slot_id`", async () => {
			const workspace = fakeWorkspace(null);
			await placeAndStowSword(workspace);
			await stowItemToolDef.run(
				contextWith({ workspace }),
				{ bundle: "adv", actor_entity_key: "adv/hero_1", item_entity_key: "adv/torch_1" },
				"stow-torch",
			);
			await equipItemToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "adv",
					actor_entity_key: "adv/hero_1",
					item_entity_key: "adv/sword_1",
					slot_id: "core/slot/main_hand",
				},
				"equip-sword",
			);
			await expect(
				equipItemToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "adv",
						actor_entity_key: "adv/hero_1",
						item_entity_key: "adv/torch_1",
						slot_id: "core/slot/main_hand",
					},
					"equip-torch",
				),
			).rejects.toThrow(/`slot_id`/);
		});

		it("rejects an unknown slot_id via the SHARED validator (MF-VAL-319), not a bespoke TS copy", async () => {
			const workspace = fakeWorkspace(null);
			await placeAndStowSword(workspace);
			const result = await equipItemToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "adv",
					actor_entity_key: "adv/hero_1",
					item_entity_key: "adv/sword_1",
					slot_id: "adv/slot/does_not_exist",
				},
				"equip",
			);
			const details = result.details as VerbResult;
			expect(details.ok).toBe(false);
			expect(JSON.stringify(details.diagnostics)).toContain("MF-VAL-319");
		});

		it("rejects an item_entity_key not (yet) contained by actor_entity_key, naming `item_entity_key`", async () => {
			const workspace = fakeWorkspace(null);
			await placeHeroAndItems(workspace);
			await expect(
				equipItemToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "adv",
						actor_entity_key: "adv/hero_1",
						item_entity_key: "adv/sword_1",
						slot_id: "core/slot/main_hand",
					},
					"equip",
				),
			).rejects.toThrow(/`item_entity_key`/);
		});

		it("rejects an item_entity_key with no authored entities row, naming `item_entity_key`", async () => {
			const workspace = fakeWorkspace(null);
			await placeAndStowSword(workspace);
			await expect(
				equipItemToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "adv",
						actor_entity_key: "adv/hero_1",
						item_entity_key: "adv/ghost_sword",
						slot_id: "core/slot/main_hand",
					},
					"equip",
				),
			).rejects.toThrow(/`item_entity_key`/);
		});

		it("rejects an actor_entity_key with no actor_spatial_locations row, naming `actor_entity_key`", async () => {
			const workspace = fakeWorkspace(null);
			await placeAndStowSword(workspace);
			await expect(
				equipItemToolDef.run(
					contextWith({ workspace }),
					{
						bundle: "adv",
						actor_entity_key: "adv/ghost",
						item_entity_key: "adv/sword_1",
						slot_id: "core/slot/main_hand",
					},
					"equip",
				),
			).rejects.toThrow(/`actor_entity_key`/);
		});
	});
});

describe("spellkave_define_affordance (#1968 verb-UX round 6, item 2 — niche-triggered environmental affordance, no actor grant)", () => {
	async function seedNicheAndCapability(workspace: ReturnType<typeof fakeWorkspace>) {
		await defineNicheToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "us_dungeon",
				id: "trap_trigger",
				display_name: "Trap trigger",
				description: "A target a pressure plate can trigger against.",
				predicate_source: 'target.has_capability("core/walk")',
			},
			"niche",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "core",
				kind: "capability_definitions",
				rows: [
					{
						capability_id: "core/walk",
						bundle_id: "core",
						actor_kind: "entity",
						display_name: "Walk",
						description: "test stand-in for core's real bootstrap-seeded walk capability.",
					},
				],
			},
			"seed-cap",
		);
	}

	it("reproduces the US5 live-dungeon pressure-plate row shape byte-for-byte (outcome_expression_source form)", async () => {
		const workspace = fakeWorkspace(null);
		await seedNicheAndCapability(workspace);
		const result = await defineAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "us_dungeon",
				id: "pressure_plate",
				niche_id: "us_dungeon/trap_trigger",
				capability_id: "core/walk",
				display_name: "Pressure plate",
				predicate_source: "d20 >= 13",
				outcome_expression_source: "invoke_outcome_graph('us_dungeon/pressure_plate/graph')",
			},
			"affordance",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		// Mirrors sandbox/sk-sndbx-unified-authoring/user-stories/us-live-dungeon.ts's
		// v1() outcome_templates/affordance_templates write_rows calls exactly (US5).
		expect(
			tableRows(manifest, "outcome_templates").find(
				(r) => r.outcome_template_id === "us_dungeon/pressure_plate/outcome",
			),
		).toMatchObject({
			display_name: "Pressure plate",
			outcome_expression_source: "invoke_outcome_graph('us_dungeon/pressure_plate/graph')",
		});
		expect(
			tableRows(manifest, "affordance_templates").find(
				(r) => r.template_id === "us_dungeon/pressure_plate/affordance",
			),
		).toMatchObject({
			niche_id: "us_dungeon/trap_trigger",
			capability_id: "core/walk",
			display_name: "Pressure plate",
			predicate_source: "d20 >= 13",
			outcome_template_id: "us_dungeon/pressure_plate/outcome",
			range_m: 0,
		});
		// No actor grant: this verb never emits a capability, an actor_capabilities
		// grant, or a spatial_niche_attachments row — the whole point (contrast
		// spellkave_define_behavior, which always binds a capability to grant_to).
		expect(tableRows(manifest, "capability_definitions")).toHaveLength(1); // core/walk only, seeded above
		expect(tableRows(manifest, "actor_capabilities")).toHaveLength(0);
		expect(tableRows(manifest, "spatial_niche_attachments")).toHaveLength(0);
	});

	it("the manipulation_action_id form (the darkness-consumer idiom) sets outcome_bool + manipulation_action_id, not outcome_expression_source", async () => {
		const workspace = fakeWorkspace(null);
		await seedNicheAndCapability(workspace);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "us_dungeon",
				kind: "action_definitions",
				rows: [
					{
						action_id: "us_dungeon/act_in_dark",
						bundle_id: "us_dungeon",
						required_capability: "core/walk",
						on_success: "us_dungeon/act_in_dark/success",
						display_name: "Search the Murk",
						cost_time_ms: 1000,
					},
				],
			},
			"seed-action",
		);
		const result = await defineAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "us_dungeon",
				id: "act_in_dark",
				niche_id: "us_dungeon/trap_trigger",
				capability_id: "core/walk",
				manipulation_action_id: "us_dungeon/act_in_dark",
			},
			"affordance",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "outcome_templates").find(
				(r) => r.outcome_template_id === "us_dungeon/act_in_dark/outcome",
			),
		).toMatchObject({ outcome_bool: true, manipulation_action_id: "us_dungeon/act_in_dark" });
		expect(
			tableRows(manifest, "affordance_templates").find(
				(r) => r.template_id === "us_dungeon/act_in_dark/affordance",
			),
		).toMatchObject({ predicate_bool: true });
	});

	it("workspace idempotency: re-declaring the SAME id REPLACES both rows (the US6 'DC 13 -> DC 15' re-declare shape)", async () => {
		const workspace = fakeWorkspace(null);
		await seedNicheAndCapability(workspace);
		await defineAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "us_dungeon",
				id: "pressure_plate",
				niche_id: "us_dungeon/trap_trigger",
				capability_id: "core/walk",
				predicate_source: "d20 >= 13",
				outcome_expression_source: "invoke_outcome_graph('us_dungeon/pressure_plate/graph')",
			},
			"affordance-1",
		);
		const second = await defineAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "us_dungeon",
				id: "pressure_plate",
				niche_id: "us_dungeon/trap_trigger",
				capability_id: "core/walk",
				predicate_source: "d20 >= 15", // the edit: DC 13 -> DC 15
				outcome_expression_source: "invoke_outcome_graph('us_dungeon/pressure_plate/graph')",
			},
			"affordance-2",
		);
		const details = second.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_replaced).toBe(2);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "affordance_templates").filter(
				(r) => r.template_id === "us_dungeon/pressure_plate/affordance",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "affordance_templates").find(
				(r) => r.template_id === "us_dungeon/pressure_plate/affordance",
			),
		).toMatchObject({ predicate_source: "d20 >= 15" });
	});

	it("rejects BOTH outcome_expression_source and manipulation_action_id set together", async () => {
		const workspace = fakeWorkspace(null);
		await seedNicheAndCapability(workspace);
		await expect(
			defineAffordanceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "us_dungeon",
					id: "pressure_plate",
					niche_id: "us_dungeon/trap_trigger",
					capability_id: "core/walk",
					outcome_expression_source: "invoke_outcome_graph('x')",
					manipulation_action_id: "us_dungeon/act",
				},
				"affordance",
			),
		).rejects.toThrow(/outcome_expression_source.*manipulation_action_id/);
	});

	it("rejects NEITHER outcome_expression_source nor manipulation_action_id set", async () => {
		const workspace = fakeWorkspace(null);
		await seedNicheAndCapability(workspace);
		await expect(
			defineAffordanceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "us_dungeon",
					id: "pressure_plate",
					niche_id: "us_dungeon/trap_trigger",
					capability_id: "core/walk",
				},
				"affordance",
			),
		).rejects.toThrow(/outcome_expression_source.*manipulation_action_id/);
	});

	it("rejects a niche_id that does not resolve, naming `niche_id`", async () => {
		const workspace = fakeWorkspace(null);
		await seedNicheAndCapability(workspace);
		await expect(
			defineAffordanceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "us_dungeon",
					id: "pressure_plate",
					niche_id: "us_dungeon/nonexistent",
					capability_id: "core/walk",
					outcome_expression_source: "invoke_outcome_graph('x')",
				},
				"affordance",
			),
		).rejects.toThrow(/`niche_id`/);
	});

	it("rejects a capability_id that does not resolve, naming `capability_id`", async () => {
		const workspace = fakeWorkspace(null);
		await seedNicheAndCapability(workspace);
		await expect(
			defineAffordanceToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "us_dungeon",
					id: "pressure_plate",
					niche_id: "us_dungeon/trap_trigger",
					capability_id: "core/nonexistent",
					outcome_expression_source: "invoke_outcome_graph('x')",
				},
				"affordance",
			),
		).rejects.toThrow(/`capability_id`/);
	});
});

describe("#1968 verb-UX round 6 (item 3) — MF-VAL-226/MF-VAL-255 target-deferred drop (mirrors the server's own unconditional drop)", () => {
	let fixturesRoot: string;

	afterEach(() => {
		if (fixturesRoot) rmSync(fixturesRoot, { recursive: true, force: true });
	});

	it("CLOSED WORLD UNCHANGED: with NO target, an unresolved condition_definition_id (MF-VAL-255) stays Fatal, exactly as before this change", async () => {
		const workspace = fakeWorkspace(null);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "condrop",
				kind: "entity_definitions",
				rows: [
					{ entity_def_id: "condrop/target-def", bundle_id: "condrop", display_name: "Target Def" },
				],
			},
			"seed-entity-def",
		);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "condrop",
				kind: "entity_definition_initial_condition",
				rows: [
					{
						entity_def_id: "condrop/target-def",
						condition_definition_id: "condrop/nonexistent",
						duration_ticks: 0,
						bundle_id: "condrop",
					},
				],
			},
			"seed-condition-seed",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(details.diagnostics?.some((d) => d.code === "MF-VAL-255")).toBe(true);
	});

	it("local target: MF-VAL-255 is DROPPED (deferred to the CLI merge-gate) — the row persists even though the target does NOT carry the referenced condition either (proves the drop, not augmentation)", async () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "condrop-local-"));
		const dir = join(fixturesRoot, "condrop_target");
		writeOutputs(
			dir,
			{
				bundle_id: "condrop_target",
				display_name: "Condrop Target",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description:
					"target folder for the MF-VAL-255-drop test — carries no condition_definitions at all",
			},
			{ bundle: "condrop_target", profile: "condrop_target" },
			[],
			[],
		);
		const target = createLocalAuthorTarget(dir);
		const workspace = fakeWorkspace(null);
		await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "condrop",
				kind: "entity_definitions",
				rows: [
					{ entity_def_id: "condrop/target-def", bundle_id: "condrop", display_name: "Target Def" },
				],
			},
			"seed-entity-def",
		);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "condrop",
				kind: "entity_definition_initial_condition",
				rows: [
					{
						entity_def_id: "condrop/target-def",
						// Never authored ANYWHERE (not in this workspace, not in the
						// target) — proves the diagnostic is DROPPED, not resolved via
						// a lookup.
						condition_definition_id: "condrop/nonexistent",
						duration_ticks: 0,
						bundle_id: "condrop",
					},
				],
			},
			"seed-condition-seed",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "entity_definition_initial_condition")).toMatchObject([
			{ condition_definition_id: "condrop/nonexistent" },
		]);
	});

	it("live target: MF-VAL-255 is ALSO dropped — not local-only (the drop is target-presence-gated, not target-kind-gated, matching the server's own unconditional-by-code drop)", async () => {
		const target = createLiveAuthorTarget({ db: () => emptyLiveDb() });
		const workspace = fakeWorkspace(null);
		await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "condrop",
				kind: "entity_definitions",
				rows: [
					{ entity_def_id: "condrop/target-def", bundle_id: "condrop", display_name: "Target Def" },
				],
			},
			"seed-entity-def",
		);
		const result = await writeRowsToolDef.run(
			contextWith({ workspace, target }),
			{
				bundle: "condrop",
				kind: "entity_definition_initial_condition",
				rows: [
					{
						entity_def_id: "condrop/target-def",
						condition_definition_id: "condrop/nonexistent",
						duration_ticks: 0,
						bundle_id: "condrop",
					},
				],
			},
			"seed-condition-seed",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 11a. spellkave_define_bundle — the DELIBERATE [[bundles]] header verb
// (srd-cc finding #8, packages/spellkave-srd-cc/ledger/findings.md), sibling
// to the spellkave_write_rows `kind: "bundles"`
// escape hatch (finding #3) exercised above.
// ---------------------------------------------------------------------------

describe("spellkave_define_bundle", () => {
	it("authors the [[bundles]] header directly into an EMPTY workspace, with NO auto-scaffold leakage (depends_on stays [])", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineBundleToolDef.run(
			contextWith({ workspace }),
			{
				bundle_id: "srd",
				display_name: "spellkave-srd-probe",
				author: "spellkave",
				version: "0.1.0",
				depends_on: [],
				description: "SRD 5.2 conformance probe content bundle.",
			},
			"define-bundle",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const bundleRows = tableRows(manifest, "bundles");
		// Exactly ONE header — the generic auto-scaffold (`ensureBundleScaffold`,
		// which would silently stamp `depends_on: ["core"]`) never ran, since
		// this verb is the deliberate replacement, not an additional call.
		expect(bundleRows).toHaveLength(1);
		expect(bundleRows[0]).toMatchObject({
			bundle_id: "srd",
			display_name: "spellkave-srd-probe",
			author: "spellkave",
			version: "0.1.0",
			depends_on: [],
			description: "SRD 5.2 conformance probe content bundle.",
		});
	});

	it("display_name/version/author are smart defaults: omitted -> title-cased bundle_id / '1.0.0' / 'spellkave-verb-tools'", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineBundleToolDef.run(
			contextWith({ workspace }),
			{ bundle_id: "kernel_pack", depends_on: ["core"] },
			"define-bundle",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "bundles")[0]).toMatchObject({
			bundle_id: "kernel_pack",
			display_name: "Kernel Pack",
			author: "spellkave-verb-tools",
			version: "1.0.0",
		});
	});

	it("re-authoring the SAME bundle_id with UNCHANGED params is a no-op — semantically identical manifest, still one header row", async () => {
		const workspace = fakeWorkspace(null);
		const params = {
			bundle_id: "srd",
			display_name: "spellkave-srd-probe",
			author: "spellkave",
			version: "0.1.0",
			depends_on: ["core"],
			description: "SRD content bundle.",
		};
		const first = await defineBundleToolDef.run(contextWith({ workspace }), params, "run-1");
		expect((first.details as VerbResult).ok, JSON.stringify(first.details)).toBe(true);
		expect((first.details as VerbResult).rows_replaced).toBeUndefined();
		const manifestAfterFirst = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;

		const second = await defineBundleToolDef.run(contextWith({ workspace }), params, "run-2");
		expect((second.details as VerbResult).ok, JSON.stringify(second.details)).toBe(true);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);
		const manifestAfterSecond = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;

		expect(tableRows(manifestAfterSecond, "bundles")).toHaveLength(1);
		expectManifestsSemanticallyEqual(manifestAfterFirst, manifestAfterSecond);
	});

	it("re-authoring the SAME bundle_id with CHANGED params (depends_on grows) updates the row, not appends a second header", async () => {
		const workspace = fakeWorkspace(null);
		await defineBundleToolDef.run(
			contextWith({ workspace }),
			{ bundle_id: "phandelver", depends_on: [], version: "0.1.0" },
			"run-1",
		);
		// "core" is the one bundle id the validator always treats as implicitly
		// known (admission seeds it before any bundle's manifest applies,
		// `BundleScope::build` in crates/spellkave-validate/src/refs.rs) — any
		// OTHER named dependency needs its own `[[bundles]]` row present in the
		// manifest under validation, so this closed-world (no target) test
		// grows the dependency list with `core` rather than an uncommitted id.
		const result = await defineBundleToolDef.run(
			contextWith({ workspace }),
			{ bundle_id: "phandelver", depends_on: ["core"], version: "0.2.0" },
			"run-2",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		expect((result.details as VerbResult).rows_replaced).toBeGreaterThan(0);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const bundleRows = tableRows(manifest, "bundles");
		expect(bundleRows).toHaveLength(1);
		expect(bundleRows[0]).toMatchObject({
			bundle_id: "phandelver",
			depends_on: ["core"],
			version: "0.2.0",
		});
	});

	it("missing `depends_on` is rejected loudly, naming the offending param — never silently defaults to [] via the schema's own serde default", async () => {
		const workspace = fakeWorkspace(null);
		const paramsWithoutDependsOn: Record<string, unknown> = { bundle_id: "srd" };
		await expect(
			defineBundleToolDef.run(
				contextWith({ workspace }),
				// biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard from outside TypeBox's static type (a caller that bypasses/skips the JSON Schema, e.g. a raw script)
				paramsWithoutDependsOn as any,
				"define-bundle",
			),
		).rejects.toThrow(/`depends_on`/);
		// No partial/corrupt row landed.
		expect(workspace.current()).toBeNull();
	});

	it("a subsequent spellkave_define_resource call for the SAME bundle reuses the header — no re-scaffold to depends_on: ['core']", async () => {
		const workspace = fakeWorkspace(null);
		await defineBundleToolDef.run(
			contextWith({ workspace }),
			{ bundle_id: "srd", depends_on: [], version: "0.1.0" },
			"define-bundle",
		);
		const result = await defineResourceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "srd", id: "hp", display_name: "Hit Points", min_value: 0, max_value: 30 },
			"resource",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const bundleRows = tableRows(manifest, "bundles");
		// ONE header, still carrying the DELIBERATE depends_on: [] — NOT the
		// generic auto-scaffold's ["core"] default. `ensureBundleScaffold`
		// (called by spellkave_define_resource) sees the bundle already exists
		// and skips its own scaffold entirely.
		expect(bundleRows).toHaveLength(1);
		expect(bundleRows[0]).toMatchObject({ bundle_id: "srd", depends_on: [] });
		expect(
			tableRows(manifest, "resource_definitions").find(
				(r) => r.resource_definition_id === "srd/hp",
			),
		).toBeDefined();
	});
});

describe("spellkave_define_session (#2027 — first-class session authoring)", () => {
	it("authors a timed long-running session with smart defaults", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineSessionToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				id: "channel_ritual",
				round_duration_ms: 6000,
				termination_pred:
					"world.tick - session.stat('opened_at') >= session.stat('promoted_duration_ticks')",
				busy_break_pred: "target.has_tag('attack')",
			},
			"session",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "session_definitions").find(
				(r) => r.session_def_id === "kernel_pack/channel_ritual",
			),
		).toMatchObject({
			bundle_id: "kernel_pack",
			turn_rule: "Sequential",
			visibility_policy: "Public",
			termination_pred:
				"world.tick - session.stat('opened_at') >= session.stat('promoted_duration_ticks')",
			busy_break_pred: "target.has_tag('attack')",
			on_terminate: "",
			auto_join_on_targeting: false,
			// u64 wire convention (`wire_u64`): digit STRING after render+parse.
			round_duration_ms: "6000",
		});
	});

	it("re-authoring the same bundle+id replaces the row wholesale (#1968 idempotency)", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		await defineSessionToolDef.run(
			context,
			{ bundle: "kernel_pack", id: "channel_ritual", busy_allow_pred: "target.has_tag('talk')" },
			"session",
		);
		await defineSessionToolDef.run(
			context,
			{ bundle: "kernel_pack", id: "channel_ritual", round_duration_ms: 6000 },
			"session",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const rows = tableRows(manifest, "session_definitions").filter(
			(r) => r.session_def_id === "kernel_pack/channel_ritual",
		);
		expect(rows).toHaveLength(1);
		// The replacement dropped the first call's busy_allow_pred wholesale.
		expect(rows[0]?.busy_allow_pred ?? null).toBeNull();
		expect(rows[0]?.round_duration_ms).toBe("6000");
	});
});

describe("spellkave_define_action resumable (#2022 verb parity)", () => {
	it("passes resumable through and defaults it to false", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		await defineCapabilityToolDef.run(
			context,
			{ bundle: "kernel_pack", id: "craft", actor_kind: "entity", description: "Can craft." },
			"capability",
		);
		await defineActionToolDef.run(
			context,
			{
				bundle: "kernel_pack",
				id: "long_craft",
				required_capability: "kernel_pack/craft",
				on_success: "kernel_pack/craft/success",
				cost_time_ms: 600000,
				resumable: true,
			},
			"action",
		);
		await defineActionToolDef.run(
			context,
			{
				bundle: "kernel_pack",
				id: "short_craft",
				required_capability: "kernel_pack/craft",
				on_success: "kernel_pack/craft/success",
			},
			"action",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").find(
				(r) => r.action_id === "kernel_pack/long_craft",
			),
		).toMatchObject({ resumable: true });
		expect(
			tableRows(manifest, "action_definitions").find(
				(r) => r.action_id === "kernel_pack/short_craft",
			),
		).toMatchObject({ resumable: false });
	});
});

describe("spellkave_define_action_verb (executable finding #40 — action/affordance/outcome/consequence composite fold)", () => {
	async function seedCapability(
		workspace: ReturnType<typeof fakeWorkspace>,
		id = "srd/check/perception",
	) {
		await defineCapabilityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: id.replace(/^srd\//, ""),
				actor_kind: "entity",
				description: "Generic check eligibility capability (test fixture).",
			},
			"capability",
		);
	}

	it("row fan-out: ONE call authors all four rows (action/outcome/affordance/consequence), schema defaults applied", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		const result = await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				display_name: "Perception Check",
				predicate_source: "d20 >= 10",
			},
			"action-verb",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;

		expect(
			tableRows(manifest, "action_definitions").find((r) => r.action_id === "srd/check/perception"),
		).toMatchObject({
			bundle_id: "srd",
			required_capability: "srd/check/perception",
			on_success: "srd/check/perception/success",
			on_failure: "",
			resolution_mode: "Deterministic",
			display_name: "Perception Check",
			// u64 wire convention: a round-trip through render+parse carries
			// cost_time_ms as a digit STRING, not a JS number (mirrors
			// spellkave_define_action's own test).
			cost_time_ms: "0",
			self_eligible: false,
			self_only: false,
		});
		const outcomeRow = tableRows(manifest, "outcome_templates").find(
			(r) => r.outcome_template_id === "srd/check/perception/outcome",
		);
		expect(outcomeRow).toMatchObject({
			bundle_id: "srd",
			display_name: "Perception Check",
			outcome_bool: true,
			manipulation_action_id: "srd/check/perception",
			// Schema-defaulted, never hand-specified by this verb:
			sense_visibility: "local",
			consequence_template_id: "",
		});
		// `communication_speech_act_id` carries `skip_serializing_if =
		// String::is_empty` and is OMITTED entirely when empty, not round-tripped
		// as "" — unlike `consequence_template_id`, which has no such attribute.
		expect(outcomeRow).not.toHaveProperty("communication_speech_act_id");
		expect(
			tableRows(manifest, "affordance_templates").find(
				(r) => r.template_id === "srd/check/perception/affordance",
			),
		).toMatchObject({
			bundle_id: "srd",
			niche_id: "creature",
			capability_id: "srd/check/perception",
			display_name: "Perception Check",
			predicate_source: "d20 >= 10",
			outcome_template_id: "srd/check/perception/outcome",
			range_m: 0,
			accepts_global_storm: false,
			reads_occupancy: false,
			stratification_ok: true,
			locality_class: "",
		});
		expect(
			tableRows(manifest, "consequence_templates").find(
				(r) => r.template_id === "srd/check/perception/success",
			),
		).toMatchObject({ bundle_id: "srd" });
	});

	it("no-op consequence (MF-VAL-222's own documented shape): omitting `consequence` entirely authors NO consequence_frame_writes row", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "consequence_frame_writes")).toHaveLength(0);
		const consequenceRow = tableRows(manifest, "consequence_templates").find(
			(r) => r.template_id === "srd/check/perception/success",
		);
		expect(consequenceRow).toMatchObject({ bundle_id: "srd" });
		expect(consequenceRow).not.toHaveProperty("effect_refs_csv");
	});

	it("consequence.frame_writes authors consequence_frame_writes rows in AUTHORED order", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				consequence: {
					frame_writes: [
						{
							Inscribe: {
								kind: "check_succeeded",
								location_kind: "binding",
								location_ref: "ActorSpatialRef",
								payload_json: "{}",
							},
						},
					],
				},
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const frameWrites = tableRows(manifest, "consequence_frame_writes").filter(
			(r) => r.template_id === "srd/check/perception/success",
		);
		expect(frameWrites).toHaveLength(1);
		expect(frameWrites[0]).toMatchObject({ ordinal: 0 });
	});

	it("ungated affordance: omitting `predicate_source` sets predicate_bool = true, not predicate_source", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const affordance = tableRows(manifest, "affordance_templates").find(
			(r) => r.template_id === "srd/check/perception/affordance",
		);
		expect(affordance).toMatchObject({ predicate_bool: true });
		// `predicate_source` has NO `skip_serializing_if` on the schema (unlike
		// `communication_speech_act_id` above) — an omitted value round-trips as
		// its schema default ("") rather than disappearing from the row.
		expect(affordance).toMatchObject({ predicate_source: "" });
	});

	it("sk-9ll.6: spends_channel defaults to BOTH rows — r_manipulate's on-turn budget gate reads the affordance row, r_react/reaction_producer's off-turn metering reads the action row", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				spends_channel: "srd/economy_channel/primary",
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").find(
				(row) => row.action_id === "srd/check/perception",
			),
		).toMatchObject({ spends_channel: "srd/economy_channel/primary" });
		expect(
			tableRows(manifest, "affordance_templates").find(
				(row) => row.template_id === "srd/check/perception/affordance",
			),
		).toMatchObject({ spends_channel: "srd/economy_channel/primary" });
	});

	it("sk-9ll.6: spends_channel_placement='action' writes only the action row", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				spends_channel: "srd/economy_channel/primary",
				spends_channel_placement: "action",
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").find(
				(row) => row.action_id === "srd/check/perception",
			),
		).toMatchObject({ spends_channel: "srd/economy_channel/primary" });
		expect(
			tableRows(manifest, "affordance_templates").find(
				(row) => row.template_id === "srd/check/perception/affordance",
			),
		).toMatchObject({ spends_channel: null });
	});

	it("sk-9ll.6: spends_channel_placement='affordance' writes only the affordance row (dead on the action row for a non-reaction verb)", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				spends_channel: "srd/economy_channel/primary",
				spends_channel_placement: "affordance",
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").find(
				(row) => row.action_id === "srd/check/perception",
			),
		).toMatchObject({ spends_channel: null });
		expect(
			tableRows(manifest, "affordance_templates").find(
				(row) => row.template_id === "srd/check/perception/affordance",
			),
		).toMatchObject({ spends_channel: "srd/economy_channel/primary" });
	});

	it("sk-9ll.6: omitting required_capability authors an ungated verb (empty capability_id, no existence check)", async () => {
		const workspace = fakeWorkspace(null);
		const result = await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "attack/strike",
				niche_id: "creature",
			},
			"action-verb",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").find(
				(row) => row.action_id === "srd/attack/strike",
			),
		).toMatchObject({ required_capability: "" });
		expect(
			tableRows(manifest, "affordance_templates").find(
				(row) => row.template_id === "srd/attack/strike/affordance",
			),
		).toMatchObject({ capability_id: "" });
	});

	it("sk-9ll.6: outcome_id_suffix/consequence_id_suffix reproduce the failure-recovery '/consequence'+'/hit' combo", async () => {
		const workspace = fakeWorkspace(null);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "attack/strike",
				niche_id: "creature",
				outcome_id_suffix: "hit",
				consequence_id_suffix: "consequence",
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").find(
				(row) => row.action_id === "srd/attack/strike",
			),
		).toMatchObject({ on_success: "srd/attack/strike/consequence" });
		expect(
			tableRows(manifest, "outcome_templates").find(
				(row) => row.outcome_template_id === "srd/attack/strike/hit",
			),
		).toMatchObject({ manipulation_action_id: "srd/attack/strike" });
		expect(
			tableRows(manifest, "affordance_templates").find(
				(row) => row.template_id === "srd/attack/strike/affordance",
			),
		).toMatchObject({ outcome_template_id: "srd/attack/strike/hit" });
		expect(
			tableRows(manifest, "consequence_templates").find(
				(row) => row.template_id === "srd/attack/strike/consequence",
			),
		).toMatchObject({ bundle_id: "srd" });
	});

	it("sk-9ll.6: composes passes through onto the affordance row verbatim", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				composes: ["srd/child_a/affordance", "srd/child_b/affordance"],
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "affordance_templates").find(
				(row) => row.template_id === "srd/check/perception/affordance",
			),
		).toMatchObject({ composes: ["srd/child_a/affordance", "srd/child_b/affordance"] });
	});

	it("sk-9ll.6: communication_speech_act_id passes through onto the outcome row", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				communication_speech_act_id: "srd/speech_act/persuasion_directive",
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "outcome_templates").find(
				(row) => row.outcome_template_id === "srd/check/perception/outcome",
			),
		).toMatchObject({ communication_speech_act_id: "srd/speech_act/persuasion_directive" });
	});

	it("niche_id is NOT existence-checked — a bare tag-shaped niche id with no niche_definitions row (e.g. the 'creature' umbrella) is accepted", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		const result = await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature", // no niche_definitions row anywhere in this workspace
			},
			"action-verb",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		expect(
			tableRows(
				inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>,
				"niche_definitions",
			),
		).toHaveLength(0);
	});

	it("the 'capability:<id>' synthetic-niche convention auto-authors provider=actor (WA-CAP-002)", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		const result = await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "capability:srd/check/perception",
			},
			"action-verb",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const niche = tableRows(
			inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>,
			"niche_definitions",
		).find((row) => row.niche_id === "capability:srd/check/perception");
		expect(niche).toMatchObject({ provider: "actor" });
	});

	it("no actor grant: authors no actor_capabilities/spatial_niche_attachments row", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "actor_capabilities")).toHaveLength(0);
		expect(tableRows(manifest, "spatial_niche_attachments")).toHaveLength(0);
	});

	it("tags fold into action_definition_tag", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				tags: ["srd.check"],
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definition_tag").filter(
				(r) => r.action_id === "srd/check/perception",
			),
		).toMatchObject([{ tag: "srd.check" }]);
	});

	it("workspace idempotency: re-authoring the SAME bundle+id replaces all four rows + satellites wholesale", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				predicate_source: "d20 >= 10",
				tags: ["srd.check", "extra"],
			},
			"action-verb-1",
		);
		const second = await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				predicate_source: "d20 >= 15", // the edit
				tags: ["srd.check"],
			},
			"action-verb-2",
		);
		const details = second.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_replaced).toBeGreaterThan(0);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "action_definitions").filter(
				(r) => r.action_id === "srd/check/perception",
			),
		).toHaveLength(1);
		expect(
			tableRows(manifest, "affordance_templates").find(
				(r) => r.template_id === "srd/check/perception/affordance",
			),
		).toMatchObject({ predicate_source: "d20 >= 15" });
		expect(
			tableRows(manifest, "action_definition_tag").filter(
				(r) => r.action_id === "srd/check/perception",
			),
		).toMatchObject([{ tag: "srd.check" }]);
	});

	it("rejects a required_capability that does not resolve, naming `required_capability`", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			defineActionVerbToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "srd",
					id: "check/perception",
					required_capability: "srd/nonexistent",
					niche_id: "creature",
				},
				"action-verb",
			),
		).rejects.toThrow(/`required_capability`/);
	});

	it("accepts_global_storm overrides the schema default (false)", async () => {
		const workspace = fakeWorkspace(null);
		await seedCapability(workspace);
		await defineActionVerbToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "srd",
				id: "check/perception",
				required_capability: "srd/check/perception",
				niche_id: "creature",
				accepts_global_storm: true,
			},
			"action-verb",
		);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(
			tableRows(manifest, "affordance_templates").find(
				(r) => r.template_id === "srd/check/perception/affordance",
			),
		).toMatchObject({ accepts_global_storm: true });
	});
});

describe("spatial toolbox — link / map_layer / annotate", () => {
	async function twoGraphs(workspace: AuthorWorkspace) {
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				substrate: "outdoor",
				nodes: [
					{ id: "tb/out/gate", name: "Gate", x: 0, y: 0 },
					{ id: "tb/out/pad", name: "Pad", x: 2, y: 0 },
				],
				edges: [["tb/out/gate", "tb/out/pad"]],
			},
			"out",
		);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				substrate: "indoor",
				nodes: [
					{ id: "tb/in/foyer", name: "Foyer", x: 0, y: 0, elevation: 0 },
					{ id: "tb/in/hall", name: "Hall", x: 2, y: 0, elevation: 0 },
				],
				edges: [["tb/in/foyer", "tb/in/hall"]],
			},
			"in",
		);
	}

	it("link_places authors cross-graph portal with substrate_crossing, and NO affordance row by default (ADR-0101)", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		const result = await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", from: "tb/out/pad", to: "tb/in/foyer", bidirectional: true },
			"link",
		);
		expect((result.details as VerbResult).ok).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const edges = tableRows(manifest, "place_edges");
		const cross = edges.filter(
			(e) => e.from_node_id === "tb/out/pad" && e.to_node_id === "tb/in/foyer",
		);
		expect(cross).toHaveLength(1);
		expect(cross[0]).toMatchObject({ place_graph_id: "", substrate_crossing: true });
		// ADR-0101 D-7: link_places stopped emitting a default place_edge_affordance
		// row — an ordinary edge inherits the bundle/graph movement_default instead
		// (place_edges.inherit_movement_default defaults to true, A-1).
		const aff = tableRows(manifest, "place_edge_affordance");
		expect(aff.some((a) => a.edge_key === "tb/out/pad->tb/in/foyer")).toBe(false);
	});

	it("link_places threads description onto the place_edges row (sk-gre)", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		const result = await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				from: "tb/out/pad",
				to: "tb/in/foyer",
				bidirectional: false,
				description: "a drafty doorway",
			},
			"link",
		);
		expect((result.details as VerbResult).ok).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const edges = tableRows(manifest, "place_edges");
		const edge = edges.find((e) => e.edge_key === "tb/out/pad->tb/in/foyer");
		expect(edge?.description).toBe("a drafty doorway");
	});

	it("link_places(portal:true) still attaches a place_edge_affordance when explicitly requested", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		const result = await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				from: "tb/out/pad",
				to: "tb/in/foyer",
				bidirectional: false,
				portal: true,
				affordance_template_id: "srd/affordance/step",
			},
			"link",
		);
		expect((result.details as VerbResult).ok).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const aff = tableRows(manifest, "place_edge_affordance");
		expect(
			aff.some(
				(a) =>
					a.edge_key === "tb/out/pad->tb/in/foyer" &&
					a.affordance_template_id === "srd/affordance/step",
			),
		).toBe(true);
	});

	async function seedStepTemplate(workspace: AuthorWorkspace) {
		// The step template is an actor-provided traversal affordance. Declare
		// its niche as such: without a niche_definitions row the validator's
		// fail-closed place default (MF-VAL-328) would flag the template as an
		// unattached place-provided niche once place_nodes exist, and every
		// later block-on-any verb (author_place, link_places) would refuse to
		// commit the workspace.
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				kind: "niche_definitions",
				rows: [
					{
						niche_id: "creature",
						bundle_id: "tb",
						display_name: "Creature",
						description: "",
						predicate_source: "",
						provider: "actor",
					},
				],
			},
			"step-niche",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				kind: "affordance_templates",
				rows: [
					{
						template_id: "tb/affordance/step",
						bundle_id: "tb",
						niche_id: "creature",
						capability_id: "",
						display_name: "Step",
						predicate_bool: true,
						outcome_template_id: "",
						range_m: 0,
						accepts_global_storm: false,
					},
				],
			},
			"step-template",
		);
	}

	it("bind_edge_affordance attaches to an edge created by an EARLIER call (not link_places)", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await seedStepTemplate(workspace);
		// Create the edge via link_places WITHOUT its own affordance (portal: false).
		await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", from: "tb/out/pad", to: "tb/in/foyer", bidirectional: true, portal: false },
			"link",
		);
		const result = await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bindings_json: '{"movement_reach_resource":"srd/speed-walk"}',
			},
			"bind",
		);
		expect((result.details as VerbResult).ok).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const aff = tableRows(manifest, "place_edge_affordance");
		expect(aff.filter((a) => a.affordance_template_id === "tb/affordance/step")).toHaveLength(2);
		expect(
			aff.some(
				(a) =>
					a.edge_key === "tb/out/pad->tb/in/foyer" &&
					a.affordance_template_id === "tb/affordance/step",
			),
		).toBe(true);
		expect(
			aff.some(
				(a) =>
					a.edge_key === "tb/in/foyer->tb/out/pad" &&
					a.affordance_template_id === "tb/affordance/step",
			),
		).toBe(true);
	});

	it("bind_edge_affordance rejects an unknown edge, naming from/to", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await seedStepTemplate(workspace);
		await expect(
			bindEdgeAffordanceToolDef.run(
				contextWith({ workspace }),
				{
					from: "tb/out/pad",
					to: "tb/in/foyer",
					affordance_template_id: "tb/affordance/step",
					bidirectional: false,
				},
				"bind",
			),
		).rejects.toThrow(/does not exist.*link the places first/s);
	});

	it("bind_edge_affordance rejects an unknown affordance_template_id", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", from: "tb/out/pad", to: "tb/in/foyer", bidirectional: false, portal: false },
			"link",
		);
		await expect(
			bindEdgeAffordanceToolDef.run(
				contextWith({ workspace }),
				{
					from: "tb/out/pad",
					to: "tb/in/foyer",
					affordance_template_id: "tb/affordance/nonexistent",
					bidirectional: false,
				},
				"bind",
			),
		).rejects.toThrow(/affordance_template_id/);
	});

	it("bind_edge_affordance re-attach is idempotent — replaces bindings_json, does not duplicate", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await seedStepTemplate(workspace);
		await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", from: "tb/out/pad", to: "tb/in/foyer", bidirectional: false, portal: false },
			"link",
		);
		await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bindings_json: '{"a":1}',
				bidirectional: false,
			},
			"bind-1",
		);
		const result = await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bindings_json: '{"a":2}',
				bidirectional: false,
			},
			"bind-2",
		);
		expect((result.details as VerbResult).ok).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const aff = tableRows(manifest, "place_edge_affordance").filter(
			(a) =>
				a.edge_key === "tb/out/pad->tb/in/foyer" &&
				a.affordance_template_id === "tb/affordance/step",
		);
		expect(aff).toHaveLength(1);
		expect(aff[0]).toMatchObject({ bindings_json: '{"a":2}' });
	});

	it("bind_edge_affordance: a second template on the same edge does not clobber the first", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await seedStepTemplate(workspace);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				kind: "affordance_templates",
				rows: [
					{
						template_id: "tb/affordance/second",
						bundle_id: "tb",
						niche_id: "creature",
						capability_id: "",
						display_name: "Second",
						predicate_bool: true,
						outcome_template_id: "",
						range_m: 0,
						accepts_global_storm: false,
					},
				],
			},
			"second-template",
		);
		await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", from: "tb/out/pad", to: "tb/in/foyer", bidirectional: false, portal: false },
			"link",
		);
		await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bidirectional: false,
			},
			"bind-first",
		);
		const result = await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/second",
				bidirectional: false,
			},
			"bind-second",
		);
		expect((result.details as VerbResult).ok).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const aff = tableRows(manifest, "place_edge_affordance").filter(
			(a) => a.edge_key === "tb/out/pad->tb/in/foyer",
		);
		expect(aff.map((a) => a.affordance_template_id).sort()).toEqual([
			"tb/affordance/second",
			"tb/affordance/step",
		]);
	});

	it("bind_edge_affordance bidirectional writes both edges", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await seedStepTemplate(workspace);
		await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", from: "tb/out/pad", to: "tb/in/foyer", bidirectional: true, portal: false },
			"link",
		);
		const result = await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
			},
			"bind",
		);
		expect((result.details as VerbResult).ok).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const aff = tableRows(manifest, "place_edge_affordance").filter(
			(a) => a.affordance_template_id === "tb/affordance/step",
		);
		expect(aff.map((a) => a.edge_key).sort()).toEqual([
			"tb/in/foyer->tb/out/pad",
			"tb/out/pad->tb/in/foyer",
		]);
	});

	async function seedFlyTemplate(workspace: AuthorWorkspace) {
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				kind: "affordance_templates",
				rows: [
					{
						template_id: "tb/affordance/fly",
						bundle_id: "tb",
						niche_id: "creature",
						capability_id: "",
						display_name: "Fly",
						predicate_bool: true,
						outcome_template_id: "",
						range_m: 0,
						accepts_global_storm: false,
					},
				],
			},
			"fly-template",
		);
	}

	it("bind_edge_affordance mode_id: distinct templates under two modes on one edge are siblings (OR alternatives, ADR-0101)", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await seedStepTemplate(workspace);
		await seedFlyTemplate(workspace);
		await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", from: "tb/out/pad", to: "tb/in/foyer", bidirectional: false },
			"link",
		);
		await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bidirectional: false,
				mode_id: "walk",
			},
			"bind-walk",
		);
		const result = await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/fly",
				bidirectional: false,
				mode_id: "fly",
			},
			"bind-fly",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const aff = tableRows(manifest, "place_edge_affordance").filter(
			(a) => a.edge_key === "tb/out/pad->tb/in/foyer",
		);
		expect(aff).toHaveLength(2);
		expect(aff.map((a) => a.mode_id).sort()).toEqual(["fly", "walk"]);
	});

	it("bind_edge_affordance: the SAME template attached under two different mode_ids on one edge is blocked (validator's authoring-slip warning, ADR-0101 D-5)", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await seedStepTemplate(workspace);
		await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", from: "tb/out/pad", to: "tb/in/foyer", bidirectional: false },
			"link",
		);
		await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bidirectional: false,
				mode_id: "walk",
			},
			"bind-walk",
		);
		const result = await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bidirectional: false,
				mode_id: "fly",
			},
			"bind-fly-same-template",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(
			details.diagnostics?.some((d) => d.message.includes("under both mode")),
			JSON.stringify(details.diagnostics),
		).toBe(true);
	});

	it("bind_edge_affordance mode_id: re-binding the SAME (edge, template, mode) replaces bindings_json", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await seedStepTemplate(workspace);
		await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", from: "tb/out/pad", to: "tb/in/foyer", bidirectional: false },
			"link",
		);
		await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bidirectional: false,
				mode_id: "fly",
				bindings_json: '{"dc":10}',
			},
			"bind-fly-1",
		);
		const result = await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bidirectional: false,
				mode_id: "fly",
				bindings_json: '{"dc":15}',
			},
			"bind-fly-2",
		);
		expect((result.details as VerbResult).ok).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const aff = tableRows(manifest, "place_edge_affordance").filter(
			(a) => a.edge_key === "tb/out/pad->tb/in/foyer",
		);
		expect(aff).toHaveLength(1);
		expect(aff[0]?.bindings_json).toBe('{"dc":15}');
	});

	it("bind_edge_affordance inherit_movement_default: replaces the flag on an edge already authored in this workspace, preserving other columns", async () => {
		const workspace = fakeWorkspace(null);
		await twoGraphs(workspace);
		await seedStepTemplate(workspace);
		await linkPlacesToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				from: "tb/out/pad",
				to: "tb/in/foyer",
				bidirectional: false,
				substrate_crossing: true,
			},
			"link",
		);
		const result = await bindEdgeAffordanceToolDef.run(
			contextWith({ workspace }),
			{
				from: "tb/out/pad",
				to: "tb/in/foyer",
				affordance_template_id: "tb/affordance/step",
				bidirectional: false,
				mode_id: "fly",
				inherit_movement_default: false,
			},
			"detach-default",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const edge = tableRows(manifest, "place_edges").find(
			(e) => e.edge_key === "tb/out/pad->tb/in/foyer",
		);
		expect(edge).toMatchObject({
			inherit_movement_default: false,
			// The whole-row re-author preserved a field this call did not repeat.
			substrate_crossing: true,
		});
	});

	it("bind_edge_affordance inherit_movement_default: rejects an edge that exists only live/target, not in this workspace", async () => {
		const fakeDb = emptyLiveDb({
			visible_place_edge: {
				iter: () => [
					{
						edgeId: 1n,
						edgeKey: "tb/out/pad->tb/in/foyer",
						fromNodeId: "tb/out/pad",
						toNodeId: "tb/in/foyer",
					},
				],
			},
			affordance_template: {
				iter: () => [{ templateId: "core/affordance/traverse_open_portal" }],
			},
		});
		const workspace = fakeWorkspace(null);
		await expect(
			bindEdgeAffordanceToolDef.run(
				contextWith({ workspace, db: () => fakeDb as never }),
				{
					from: "tb/out/pad",
					to: "tb/in/foyer",
					affordance_template_id: "core/affordance/traverse_open_portal",
					bidirectional: false,
					inherit_movement_default: false,
				},
				"detach-default-live-only",
			),
		).rejects.toThrow(/inherit_movement_default.*already authored in THIS workspace/s);
	});

	it("attach_map_layer + annotate_place write map_layers and metadata", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				nodes: [{ id: "tb/g/a", name: "A", x: 0, y: 0 }],
				edges: [],
			},
			"g",
		);
		const layer = await attachMapLayerToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				place_graph_id: "tb/g",
				asset_module: "ccc3-maps",
				asset_path: "maps/306 Fortified Hamlet.jpg",
				map_id: "306",
			},
			"layer",
			{ node: nodeToolCapability },
		);
		expect((layer.details as VerbResult).ok).toBe(true);
		const ann = await annotatePlaceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				target_kind: "place_graph",
				target_ref: "tb/g",
				terrain: ["settlement", "palisade"],
				h3_origin_res10: 4242424242424,
			},
			"ann",
		);
		expect((ann.details as VerbResult).ok).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "map_layers")[0]).toMatchObject({
			place_graph_id: "tb/g",
			asset_module: "ccc3-maps",
		});
		expect(Number(tableRows(manifest, "place_graphs")[0]?.origin_cell_res10)).toBe(4242424242424);
		const meta = tableRows(manifest, "metadata_attachments");
		expect(meta.some((m) => m.namespace === "terrain.hint")).toBe(true);
		expect(meta.some((m) => m.namespace === "provenance.source")).toBe(true);
	});
});

describe("sk-9ll.7: tags[] — INSTANCE entity_tag via the placement verb", () => {
	it("places INSTANCE entity_tag rows for every tag in `tags`, scoped to the placed entity_key", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/room" }], edges: [] },
			"place",
		);
		const result = await placeEntityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "item",
				at: "kernel_pack/room",
				entity_key: "kernel_pack/lever",
				tags: ["kernel_pack.leader", "kernel_pack.faction.a"],
			},
			"place-entity",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const tagRowsFound = tableRows(manifest, "entity_tag").filter(
			(r) => r.entity_key === "kernel_pack/lever",
		);
		expect(tagRowsFound.map((r) => r.tag).sort()).toEqual([
			"kernel_pack.faction.a",
			"kernel_pack.leader",
		]);
		for (const row of tagRowsFound) {
			expect(row).toMatchObject({ source: "manifest", bundle_id: "kernel_pack" });
		}
	});

	it("a re-run with the SAME entity_key and FEWER tags drops the stale ones (clear-and-reseed, mirrors `resources`)", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/room" }], edges: [] },
			"place",
		);
		await placeEntityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "item",
				at: "kernel_pack/room",
				entity_key: "kernel_pack/lever",
				tags: ["kernel_pack.leader", "kernel_pack.faction.a"],
			},
			"place-1",
		);
		const second = await placeEntityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "item",
				at: "kernel_pack/room",
				entity_key: "kernel_pack/lever",
				tags: ["kernel_pack.faction.b"],
			},
			"place-2",
		);
		expect((second.details as VerbResult).rows_replaced).toBeGreaterThan(0);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const tagRowsFound = tableRows(manifest, "entity_tag").filter(
			(r) => r.entity_key === "kernel_pack/lever",
		);
		expect(tagRowsFound.map((r) => r.tag)).toEqual(["kernel_pack.faction.b"]);
	});

	it("an unknown-grammar tag is rejected with a helpful error, not persisted (reuses the shared validator, no TS grammar)", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/room" }], edges: [] },
			"place",
		);
		const result = await placeEntityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "item",
				at: "kernel_pack/room",
				entity_key: "kernel_pack/lever",
				tags: ["kv:shaped"],
			},
			"place-entity",
		);
		const details = result.details as VerbResult;
		expect(details.ok).toBe(false);
		expect(JSON.stringify(details.diagnostics)).toContain("MF-VAL-296");
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		expect(tableRows(manifest, "entities")).toHaveLength(0);
		expect(tableRows(manifest, "entity_tag")).toHaveLength(0);
	});

	it("surfaces a 'tag X grants capability Y' diagnostic when the tag carries an authored tag_capability_grant (informational, never blocking)", async () => {
		const workspace = fakeWorkspace(null);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kernel_pack", nodes: [{ id: "kernel_pack/room" }], edges: [] },
			"place",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "capability_definitions",
				rows: [
					{
						capability_id: "kernel_pack/speak",
						bundle_id: "kernel_pack",
						actor_kind: "any",
						display_name: "Speak",
						description: "",
					},
				],
			},
			"seed-capability",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "tag_capability_grant",
				rows: [
					{
						tag: "kernel_pack.leader",
						capability_id: "kernel_pack/speak",
						bundle_id: "kernel_pack",
					},
				],
			},
			"seed-grant",
		);
		const result = await placeEntityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kernel_pack",
				kind: "item",
				at: "kernel_pack/room",
				entity_key: "kernel_pack/lever",
				tags: ["kernel_pack.leader"],
			},
			"place-entity",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.tag_capability_grants).toEqual([
			{
				entity_key: "kernel_pack/lever",
				tag: "kernel_pack.leader",
				capability_id: "kernel_pack/speak",
			},
		]);
	});
});

describe("spellkave_tag_entity (sk-ntz.2, cross-file post-placement retag)", () => {
	async function placeHero(workspace: ReturnType<typeof fakeWorkspace>) {
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kavemouth", nodes: [{ id: "kavemouth/hearth" }], edges: [] },
			"place",
		);
		await rawPlaceActorToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kavemouth",
				kind: "player",
				at: "kavemouth/hearth",
				entity_key: "kavemouth/hero_1",
				tags: ["kavemouth.fighter", "kavemouth.human"],
			},
			"place-hero",
		);
	}

	it("default mode 'add' upserts the listed tags and keeps every existing tag on the entity untouched", async () => {
		const workspace = fakeWorkspace(null);
		await placeHero(workspace);
		const result = await tagEntityToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kavemouth", entity_key: "kavemouth/hero_1", tags: ["kavemouth.party_member"] },
			"tag",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_added).toBe(1);
		expect(details.rows_replaced).toBeUndefined();
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const tagRowsFound = tableRows(manifest, "entity_tag").filter(
			(r) => r.entity_key === "kavemouth/hero_1",
		);
		expect(tagRowsFound.map((r) => r.tag).sort()).toEqual([
			"kavemouth.fighter",
			"kavemouth.human",
			"kavemouth.party_member",
		]);
	});

	it("mode 'add' is idempotent: re-running with the SAME tags adds nothing new", async () => {
		const workspace = fakeWorkspace(null);
		await placeHero(workspace);
		await tagEntityToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kavemouth", entity_key: "kavemouth/hero_1", tags: ["kavemouth.party_member"] },
			"tag-1",
		);
		const second = await tagEntityToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kavemouth", entity_key: "kavemouth/hero_1", tags: ["kavemouth.party_member"] },
			"tag-2",
		);
		const details = second.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_added).toBe(0);
		expect(details.rows_replaced).toBeUndefined();
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const tagRowsFound = tableRows(manifest, "entity_tag").filter(
			(r) => r.entity_key === "kavemouth/hero_1" && r.tag === "kavemouth.party_member",
		);
		expect(tagRowsFound).toHaveLength(1);
	});

	it("mode 'replace' clears every existing entity_tag row for entity_key first, then reseeds exactly `tags`", async () => {
		const workspace = fakeWorkspace(null);
		await placeHero(workspace);
		const result = await tagEntityToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kavemouth",
				entity_key: "kavemouth/hero_1",
				tags: ["kavemouth.party_member"],
				mode: "replace",
			},
			"tag-replace",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_replaced).toBe(2);
		expect(details.rows_added).toBe(1);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const tagRowsFound = tableRows(manifest, "entity_tag").filter(
			(r) => r.entity_key === "kavemouth/hero_1",
		);
		expect(tagRowsFound.map((r) => r.tag)).toEqual(["kavemouth.party_member"]);
	});

	it("rejects an entity_key with no entities row, naming `entity_key` (place it first)", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			tagEntityToolDef.run(
				contextWith({ workspace }),
				{ bundle: "kavemouth", entity_key: "kavemouth/ghost", tags: ["kavemouth.party_member"] },
				"tag",
			),
		).rejects.toThrow(/`entity_key`/);
	});

	it("surfaces a 'tag X grants capability Y' diagnostic (informational, never blocking), same helper as spellkave_place_entity/spellkave_place_actor", async () => {
		const workspace = fakeWorkspace(null);
		await placeHero(workspace);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kavemouth",
				kind: "capability_definitions",
				rows: [
					{
						capability_id: "kavemouth/speak",
						bundle_id: "kavemouth",
						actor_kind: "any",
						display_name: "Speak",
						description: "",
					},
				],
			},
			"seed-capability",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "kavemouth",
				kind: "tag_capability_grant",
				rows: [
					{
						tag: "kavemouth.party_member",
						capability_id: "kavemouth/speak",
						bundle_id: "kavemouth",
					},
				],
			},
			"seed-grant",
		);
		const result = await tagEntityToolDef.run(
			contextWith({ workspace }),
			{ bundle: "kavemouth", entity_key: "kavemouth/hero_1", tags: ["kavemouth.party_member"] },
			"tag",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.tag_capability_grants).toEqual([
			{
				entity_key: "kavemouth/hero_1",
				tag: "kavemouth.party_member",
				capability_id: "kavemouth/speak",
			},
		]);
	});
});

describe("spellkave_set_movement_default (ADR-0101 D-1/D-7)", () => {
	async function seedStepTemplate(workspace: AuthorWorkspace) {
		// The step template is an actor-provided traversal affordance. Declare
		// its niche as such: without a niche_definitions row the validator's
		// fail-closed place default (MF-VAL-328) would flag the template as an
		// unattached place-provided niche once place_nodes exist, and every
		// later block-on-any verb (author_place, link_places) would refuse to
		// commit the workspace.
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				kind: "niche_definitions",
				rows: [
					{
						niche_id: "creature",
						bundle_id: "tb",
						display_name: "Creature",
						description: "",
						predicate_source: "",
						provider: "actor",
					},
				],
			},
			"step-niche",
		);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				kind: "affordance_templates",
				rows: [
					{
						template_id: "tb/affordance/step",
						bundle_id: "tb",
						niche_id: "creature",
						capability_id: "",
						display_name: "Step",
						predicate_bool: true,
						outcome_template_id: "",
						range_m: 0,
						accepts_global_storm: false,
					},
				],
			},
			"step-template",
		);
	}

	it("bundle scope (place_graph_id omitted) writes a movement_defaults row with empty scope/mode", async () => {
		const workspace = fakeWorkspace(null);
		await seedStepTemplate(workspace);
		const result = await setMovementDefaultToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				affordance_template_id: "tb/affordance/step",
				bindings_json: '{"movement_reach_resource":"tb/speed-walk"}',
			},
			"default",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const rows = tableRows(manifest, "movement_defaults");
		expect(rows).toEqual([
			{
				bundle_id: "tb",
				place_graph_id: "",
				mode_id: "",
				affordance_template_id: "tb/affordance/step",
				bindings_json: '{"movement_reach_resource":"tb/speed-walk"}',
			},
		]);
	});

	it("place_graph_id scopes the default to one graph, and must already resolve", async () => {
		const workspace = fakeWorkspace(null);
		await seedStepTemplate(workspace);
		await expect(
			setMovementDefaultToolDef.run(
				contextWith({ workspace }),
				{
					bundle: "tb",
					place_graph_id: "tb/nowhere",
					affordance_template_id: "tb/affordance/step",
				},
				"bad-graph-throws",
			),
		).rejects.toThrow(/place_graph_id/);

		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", nodes: [{ id: "tb/g/a", name: "A", x: 0, y: 0 }], edges: [] },
			"g",
		);
		const result = await setMovementDefaultToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				place_graph_id: "tb/g",
				affordance_template_id: "tb/affordance/step",
			},
			"graph-scoped",
		);
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const row = tableRows(manifest, "movement_defaults")[0];
		expect(row?.place_graph_id).toBe("tb/g");
	});

	it("rejects an affordance_template_id that does not resolve", async () => {
		const workspace = fakeWorkspace(null);
		await expect(
			setMovementDefaultToolDef.run(
				contextWith({ workspace }),
				{ bundle: "tb", affordance_template_id: "tb/affordance/nonexistent" },
				"bad-template",
			),
		).rejects.toThrow(/affordance_template_id/);
	});

	it("upserts by (bundle, place_graph_id, mode_id, template) — replace vs sibling vs alternative mode", async () => {
		const workspace = fakeWorkspace(null);
		await seedStepTemplate(workspace);
		await writeRowsToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				kind: "affordance_templates",
				rows: [
					{
						template_id: "tb/affordance/fly",
						bundle_id: "tb",
						niche_id: "creature",
						capability_id: "",
						display_name: "Fly",
						predicate_bool: true,
						outcome_template_id: "",
						range_m: 0,
						accepts_global_storm: false,
					},
				],
			},
			"fly-template",
		);

		await setMovementDefaultToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", affordance_template_id: "tb/affordance/step", bindings_json: '{"a":"1"}' },
			"walk-1",
		);
		// Re-authoring the SAME scope+mode+template replaces bindings_json.
		await setMovementDefaultToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", affordance_template_id: "tb/affordance/step", bindings_json: '{"a":"2"}' },
			"walk-2",
		);
		const manifest1 = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;
		expect(tableRows(manifest1, "movement_defaults")).toHaveLength(1);
		expect(tableRows(manifest1, "movement_defaults")[0]?.bindings_json).toBe('{"a":"2"}');

		// A distinct mode_id is a sibling alternative (OR), not a replace.
		const result = await setMovementDefaultToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", mode_id: "fly", affordance_template_id: "tb/affordance/fly" },
			"fly-default",
		);
		expect((result.details as VerbResult).ok).toBe(true);
		const manifest2 = inspectManifest(workspace.current() ?? "").manifest as Record<
			string,
			unknown
		>;
		expect(tableRows(manifest2, "movement_defaults")).toHaveLength(2);
	});

	it("zero-row edge + one bundle default validates clean (A-1: no per-edge affordance row needed)", async () => {
		const workspace = fakeWorkspace(null);
		await seedStepTemplate(workspace);
		await authorPlaceToolDef.run(
			contextWith({ workspace }),
			{
				bundle: "tb",
				nodes: [
					{ id: "tb/hamlet/square", name: "Square", x: 0, y: 0 },
					{ id: "tb/hamlet/inn", name: "Inn", x: 1, y: 0 },
				],
				edges: [["tb/hamlet/square", "tb/hamlet/inn"]],
			},
			"hamlet",
		);
		const result = await setMovementDefaultToolDef.run(
			contextWith({ workspace }),
			{ bundle: "tb", affordance_template_id: "tb/affordance/step" },
			"bundle-default",
		);
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.diagnostics ?? []).toEqual([]);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		// No place_edge_affordance row anywhere — the edge relies purely on the
		// bundle-scoped movement_default + its own default inherit_movement_default.
		expect(tableRows(manifest, "place_edge_affordance")).toHaveLength(0);
	});
});
