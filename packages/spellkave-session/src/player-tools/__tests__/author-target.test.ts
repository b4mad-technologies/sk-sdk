// embedded-manifest: {"category": "exact_text_oracle", "rationale": "filesystem target and dependency-chain tests require exact merge and parser inputs"}
// embedded-manifest: {"category": "schema_object_oracle", "rationale": "A typed empty workspace directly proves blueprint Text seeds use live state homes and refuse undeclared homes without mutation."}
// Unit tests for the #1968 "connection-level target" `AuthorTarget` drivers
// (`author-target.ts`): the `live` driver (fake `SnapshotDb`-shaped table
// handles, no real SDK connection) and the `local` driver (real temp-dir
// fixtures via `@spellkave/world-author`'s own harness — the same
// `writeOutputs`/`loadFlattened` machinery `authoring-harness.test.ts` uses).
// ci-allow(embedded-manifest-schema): filesystem target parser malformed inputs - deliberately broken TOML
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import type { SnapshotDb } from "@spellkave/sdk/replay";
import { createAuthorFacingBoundTools, resolveAuthorTarget } from "@spellkave/tool-authoring";
import {
	createLocalAuthorTarget,
	LocalAuthorTargetDirectoryError,
	resolveLocalAuthorTarget,
} from "@spellkave/tool-node/authoring";
import {
	inspectManifest,
	loadBundleChain,
	renderSchemaManifest,
	validateManifestToml,
	writeOutputs,
} from "@spellkave/world-author";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveAuthorTarget } from "../../authoring";

// ---------------------------------------------------------------------------
// `live` driver
// ---------------------------------------------------------------------------

interface FakeTable {
	iter(): Iterable<Record<string, unknown>>;
}

function fakeDb(tables: Record<string, Record<string, unknown>[]>): SnapshotDb {
	const db: Record<string, FakeTable> = {};
	for (const [name, rows] of Object.entries(tables)) {
		db[name] = { iter: () => rows };
	}
	return db as unknown as SnapshotDb;
}

describe("createLiveAuthorTarget", () => {
	// keep(K3): generated camelCase cache rows must retain the authored policy
	// identity/source shape; private vocabulary must stay absent for scoped seats.
	it("exposes subscribed publisher policy vocabulary without opening it to scoped seats", () => {
		const db = fakeDb({
			containment_policy_definition: [
				{
					policyId: "library/open",
					bundleId: "library",
					exposurePredicateSource: "true == true",
					accessPredicateSource: "false == true",
				},
			],
		});
		let publisherSeat = true;
		const publisher = createLiveAuthorTarget({
			db,
			cacheRows: true,
			readsAsPublisher: () => publisherSeat,
		});
		expect(publisher.lookup("containment_policy_definition")).toEqual([
			{
				policy_id: "library/open",
				bundle_id: "library",
				exposure_predicate_source: "true == true",
				access_predicate_source: "false == true",
			},
		]);
		expect(publisher.resolveRef("containment_policy_definition", "library/open")).toBe(true);
		publisherSeat = false;
		expect(publisher.lookup("containment_policy_definition")).toEqual([]);
		const scoped = createLiveAuthorTarget({ db, readsAsPublisher: () => false });
		expect(scoped.lookup("containment_policy_definition")).toEqual([]);
		expect(scoped.resolveRef("containment_policy_definition", "library/open")).toBe(false);
		expect(
			createLiveAuthorTarget({ db: fakeDb({}) }).lookup("containment_policy_definition"),
		).toEqual([]);
	});
	it("admits blueprint Text seeds from live state vocabulary and refuses unknown homes", async () => {
		const target = createLiveAuthorTarget({
			db: () =>
				fakeDb({
					resource_definition: [],
					entity_definition: [],
					capability_definition: [],
					tag_value_definition: [],
					dsl_macro_definition: [],
					modifier_target_definition: [],
					equipment_slot_definition: [],
					object_state_definition: [
						{
							stateId: "house/appearance",
							bundleId: "house",
							targetKind: "entity",
							displayName: "Appearance",
							defaultVisibility: { tag: "Public" },
							description: "Authored prose home",
						},
					],
				}),
		});
		let toml = renderSchemaManifest({
			schema_version: "1.0.0",
			bundles: [
				{
					bundle_id: "house",
					display_name: "House",
					author: "test",
					version: "1",
					depends_on: [],
				},
			],
		});
		const tool = createAuthorFacingBoundTools(
			{
				workspace: {
					readToml: () => toml,
					writeToml: (value) => {
						toml = value;
						return "memory";
					},
				},
				defaultBundle: "house",
				target,
			},
			{},
		).find((tool) => tool.name === "spellkave_define_entity_type");
		if (!tool) throw new Error("entity blueprint verb absent");
		const result = (await tool.execute("text-seed", {
			bundle: "house",
			id: "candidate",
			display_name: "Candidate",
			initial_states: [{ state: "house/appearance", value_text: "" }],
		})) as { details: { ok: boolean; diagnostics?: unknown } };
		expect(result.details.ok, JSON.stringify(result.details.diagnostics)).toBe(true);
		const manifest = inspectManifest(toml).manifest;
		expect(manifest.entity_definition_initial_state).toEqual([
			{
				bundle_id: "house",
				entity_def_id: "house/candidate",
				state_id: "house/appearance",
				value_text: "",
				value_int: null,
				value_bool: true,
			},
		]);
		expect(manifest.object_state_definitions ?? []).toEqual([]);
		const before = toml;
		const refused = (await tool.execute("missing-home", {
			bundle: "house",
			id: "invalid",
			display_name: "Invalid",
			initial_states: [{ state: "house/missing", value_text: "" }],
		})) as { details: { ok: boolean; diagnostics: { code: string; severity: string }[] } };
		expect(refused.details.ok).toBe(false);
		expect(refused.details.diagnostics).toContainEqual(
			expect.objectContaining({ code: "MF-VAL-253", severity: "fatal" }),
		);
		expect(toml).toBe(before);
	});
	it("resolves seeded runtime prompt namespaces without redeclaring them", () => {
		const target = createLiveAuthorTarget({
			db: () =>
				fakeDb({
					metadata_namespace_definition: [
						{
							key: "elven_mini:dialogue.prompt",
							namespace: "dialogue.prompt",
							audience: "public",
							bundleId: "elven_mini",
							description: "Prompt labels",
							setAtTick: 1n,
							onDemand: false,
						},
					],
				}),
		});
		expect(target.lookup("metadata_namespaces")).toEqual([
			{
				namespace: "dialogue.prompt",
				audience: "public",
				bundle_id: "elven_mini",
				description: "Prompt labels",
				on_demand: false,
			},
		]);
	});

	it("projects bindings with exact optional ticks and realised body metadata", () => {
		const target = createLiveAuthorTarget({
			db: () =>
				fakeDb({
					visible_role_binding: [
						{
							bindingId: "house/dm",
							bundleId: "house",
							subject: "house/npc",
							roleId: "dm",
							extentKindRef: "place_graph",
							extentRef: "house/region",
							description: "Runs the region",
							expiresAtTick: 18446744073709551615n,
							presenceEntityId: 42n,
							realisedAtTick: 5n,
						},
					],
				}),
		});
		expect(target.resolveRef("role_bindings", "house/dm")).toBe(true);
		const rows = target.lookup("role_bindings");
		expect(rows).toEqual([
			{
				binding_id: "house/dm",
				bundle_id: "house",
				subject: "house/npc",
				role_id: "dm",
				extent_kind_ref: "place_graph",
				extent_ref: "house/region",
				description: "Runs the region",
				expires_at_tick: "18446744073709551615",
				presence_entity_id: "42",
				realised_at_tick: 5,
			},
		]);
		expect(() => JSON.stringify(rows)).not.toThrow();
	});
	it("projects the public role and extent vocabulary without synthetic or private fields", () => {
		const target = createLiveAuthorTarget({
			db: () =>
				fakeDb({
					role_definition: [
						{
							roleId: "dm",
							bundleId: "core",
							displayName: "DM",
							description: "Authored DM",
							capabilityIds: ["frontier.read_hidden"],
						},
					],
					role_aggregation: [
						{
							key: '["dm","house"]',
							roleId: "dm",
							bundleId: "house",
							description: "Contribution",
							capabilityIds: ["house/weather"],
						},
					],
					extent_kind_definition: [
						{
							kindId: "place_graph",
							bundleId: "core",
							resolutionShape: { tag: "PlaceGraph" },
							description: "Graph extent",
						},
					],
				}),
		});
		expect(target.lookup("role_definitions")).toEqual([
			{
				role_id: "dm",
				bundle_id: "core",
				display_name: "DM",
				description: "Authored DM",
				capability_ids: ["frontier.read_hidden"],
			},
		]);
		expect(target.lookup("role_aggregations")).toEqual([
			{
				role_id: "dm",
				bundle_id: "house",
				description: "Contribution",
				capability_ids: ["house/weather"],
			},
		]);
		expect(target.lookup("extent_kind_definitions")).toEqual([
			{
				kind_id: "place_graph",
				bundle_id: "core",
				resolution_shape: "PlaceGraph",
				description: "Graph extent",
			},
		]);
	});

	it.each(["camelCase", "snake_case"])("preserves equipment fields from %s snapshots", (shape) => {
		const predicate = 'slot_id == "srd/slot/chest"';
		const equipment =
			shape === "camelCase"
				? { entityDefId: "srd/armor/chain-mail", slotCompatibilityPredicate: predicate }
				: { entity_def_id: "srd/armor/chain-mail", slot_compatibility_predicate: predicate };
		const target = createLiveAuthorTarget({
			db: () =>
				fakeDb({
					entity_definition: [
						{ ...equipment, stackable: false },
						{ entityDefId: "srd/gear/gold-piece", stackable: true },
					],
				}),
		});
		expect(target.lookup("entity_definitions")).toMatchObject([
			{
				entity_def_id: "srd/armor/chain-mail",
				slot_compatibility_predicate: predicate,
				stackable: false,
			},
			{ entity_def_id: "srd/gear/gold-piece", stackable: true },
		]);
	});

	it("resolveRef resolves a bounded row kind against the live table, false for anything else", () => {
		const db = fakeDb({
			entity_definition: [{ entityDefId: "srd/monster/goblin", bundleId: "srd" }],
			visible_place_node: [{ nodeId: "core/village/green", bundleId: "core" }],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.kind).toBe("live");
		expect(target.resolveRef("entity_definitions", "srd/monster/goblin")).toBe(true);
		expect(target.resolveRef("entity_definitions", "srd/monster/orc")).toBe(false);
		expect(target.resolveRef("place_nodes", "core/village/green")).toBe(true);
		// A row kind outside the bounded live-table map (see this file's header
		// note): honestly false, never a guess.
		expect(target.resolveRef("roll_tables", "core/d20")).toBe(false);
	});

	// Ledger finding #5 (`packages/spellkave-srd-cc/ledger/findings.md`):
	// the real live `DbConnection.db` keys every table accessor snake_case,
	// never camelCase — a stale camelCase entry in `LIVE_TABLE_ACCESSORS`, or a
	// connected db that's simply missing the table for some other reason,
	// must throw naming the row kind and the accessor, never silently read as
	// "no rows" (which looks identical to "seed didn't take").
	it("resolveRef/lookup throw naming the row kind and accessor when the live table is genuinely absent", () => {
		const db = fakeDb({}); // connected, but no tables at all — every accessor absent.
		const target = createLiveAuthorTarget({ db: () => db });
		expect(() => target.resolveRef("entity_definitions", "srd/monster/goblin")).toThrow(
			/entity_definitions.*entity_definition/,
		);
		expect(() => target.lookup("resource_definitions")).toThrow(
			/resource_definitions.*resource_definition/,
		);
	});

	it("resolveRef/lookup are false/empty when the db thunk throws (disconnected)", () => {
		const target = createLiveAuthorTarget({
			db: () => {
				throw new Error("not connected");
			},
		});
		expect(target.resolveRef("entity_definitions", "srd/monster/goblin")).toBe(false);
		expect(target.lookup("entity_definitions")).toEqual([]);
	});

	it("lookup joins id-keyed live actors onto entity_key via visible_manifest_authored_entity (sk-awlo.8)", () => {
		const db = fakeDb({
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{
					manifestKey: "adv:adv/hero_1",
					bundleId: "adv",
					entityId: 2n,
				},
				{
					manifestKey: "adv:adv/sword_1",
					bundleId: "adv",
					entityId: 3n,
				},
			],
			entity: [
				{ entityId: 2n, entityDefId: "srd/creature/scout", name: "Hero", kind: "player" },
				{ entityId: 3n, entityDefId: "srd/weapon/longsword", name: "Sword", kind: "item" },
			],
			visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "gatekeeper/root" }],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		const rows = target.lookup("actor_spatial_locations");
		expect(rows).toEqual([
			{
				entity_key: "adv/hero_1",
				bundle_id: "adv",
				place_node_id: "",
				entity_def_id: "srd/creature/scout",
				name: "Hero",
				kind: "player",
			},
		]);
		expect(target.resolveRef("actor_spatial_locations", "adv/hero_1")).toBe(true);
		expect(target.resolveRef("actor_spatial_locations", "adv/sword_1")).toBe(false);
	});

	it("cacheRows reads each table once per target; the default re-reads it on every lookup", () => {
		let reads = 0;
		const db = {
			resource_definition: {
				iter: () => {
					reads += 1;
					return [{ resourceDefinitionId: "srd/hp", bundleId: "srd", displayName: "HP" }];
				},
			},
		} as unknown as SnapshotDb;
		const uncached = createLiveAuthorTarget({ db: () => db });
		uncached.lookup("resource_definitions");
		uncached.lookup("resource_definitions");
		expect(reads).toBe(2);

		reads = 0;
		const cached = createLiveAuthorTarget({ db: () => db, cacheRows: true });
		const first = cached.lookup("resource_definitions");
		const second = cached.lookup("resource_definitions");
		expect(reads).toBe(1);
		expect(second).toBe(first);
		// A different bundle filter is a different cache entry, not a stale hit.
		expect(cached.lookup("resource_definitions", { bundle: "other" })).toHaveLength(0);
	});

	it("lookup maps live rows into manifest (snake_case) shape and filters by bundle", () => {
		const db = fakeDb({
			resource_definition: [
				{
					resourceDefinitionId: "srd/hp",
					bundleId: "srd",
					displayName: "Hit Points",
					valueKind: "int",
					recoveryRule: "none",
					minValue: 0,
					maxValue: 20,
					initialValue: 20,
				},
				{
					resourceDefinitionId: "homebrew/mana",
					bundleId: "homebrew",
					displayName: "Mana",
					valueKind: "int",
					minValue: 0,
					maxValue: 10,
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		const all = target.lookup("resource_definitions");
		expect(all.map((r) => r.resource_definition_id).sort()).toEqual(["homebrew/mana", "srd/hp"]);
		const scoped = target.lookup("resource_definitions", { bundle: "srd" });
		expect(scoped).toHaveLength(1);
		expect(scoped[0]).toMatchObject({
			resource_definition_id: "srd/hp",
			display_name: "Hit Points",
		});
	});

	it("lookup reconstructs a live DSL macro signature losslessly", () => {
		const db = fakeDb({
			dsl_macro_definition: [
				{
					macroId: "srd/half_damage",
					bundleId: "srd",
					returnType: { tag: "Int" },
					parametersJson: '[{"name":"damage","value_type":"Int"}]',
					bodySource: "(damage) / 2",
					description: "Half a positive damage magnitude.",
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.lookup("dsl_macro_definitions")).toEqual([
			{
				macro_id: "srd/half_damage",
				bundle_id: "srd",
				return_type: "Int",
				parameters: [{ name: "damage", value_type: "Int" }],
				body_source: "(damage) / 2",
				description: "Half a positive damage magnitude.",
			},
		]);
	});

	it("resolveRef/lookup map exact tag-value vocabulary rows through the live table", () => {
		const db = fakeDb({
			tag_value_definition: [
				{
					tag: "demo.creature_type.humanoid",
					prefix: "demo.creature_type",
					bundleId: "demo",
					description: "Humanoid creature type.",
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.resolveRef("tag_value_definitions", "demo.creature_type.humanoid")).toBe(true);
		expect(target.lookup("tag_value_definitions")).toEqual([
			{
				tag: "demo.creature_type.humanoid",
				prefix: "demo.creature_type",
				bundle_id: "demo",
				description: "Humanoid creature type.",
			},
		]);
	});

	// #1968 spellkave_query round: LIVE_TABLE_ACCESSORS grew the proven
	// core/inspect definition-chain kinds (capability_definitions,
	// affordance_templates, action_definitions, outcome_templates) — one
	// mapping test per kind, mirroring the pattern above for the
	// pre-existing 5. Field names match the generated SDK row schemas
	// (`packages/spellkave-bindings/src/module_bindings/*_table.ts`).
	it("lookup maps capability_definitions live rows into manifest shape", () => {
		const db = fakeDb({
			capability_definition: [
				{
					capabilityId: "core/inspect",
					bundleId: "core",
					actorKind: "entity",
					displayName: "Inspect",
					description: "",
					defaultVisibility: "public",
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.resolveRef("capability_definitions", "core/inspect")).toBe(true);
		expect(target.lookup("capability_definitions")).toEqual([
			{
				capability_id: "core/inspect",
				bundle_id: "core",
				actor_kind: "entity",
				display_name: "Inspect",
				description: "",
				default_visibility: "public",
			},
		]);
	});

	it("lookup maps affordance_templates live rows into manifest shape", () => {
		const db = fakeDb({
			affordance_template: [
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
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.resolveRef("affordance_templates", "core/inspect/affordance")).toBe(true);
		const [row] = target.lookup("affordance_templates");
		expect(row).toMatchObject({
			template_id: "core/inspect/affordance",
			capability_id: "core/inspect",
			outcome_template_id: "core/inspect/outcome",
		});
	});

	it("lookup maps action_definitions live rows into manifest shape (no description column, honestly omitted)", () => {
		const db = fakeDb({
			action_definition: [
				{
					actionId: "core/inspect",
					bundleId: "core",
					requiredCapability: "core/inspect",
					onSuccess: "core/inspect/success",
					onFailure: "",
					resolutionMode: "Deterministic",
					resolutionCheck: "",
					resolutionDc: 0,
					displayName: "Inspect",
					costTimeMs: 500,
					sessionDefId: "",
					reactionEligibility: "",
					reactionWindowMs: 0,
					reactionTrigger: "",
					selfEligible: false,
					selfOnly: false,
					consumesActionClass: "",
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.resolveRef("action_definitions", "core/inspect")).toBe(true);
		const [row] = target.lookup("action_definitions");
		expect(row).toMatchObject({ action_id: "core/inspect", on_success: "core/inspect/success" });
		expect(row?.description).toBeUndefined();
	});

	it("lookup maps outcome_templates live rows into manifest shape", () => {
		const db = fakeDb({
			outcome_template: [
				{
					outcomeTemplateId: "core/inspect/outcome",
					bundleId: "core",
					displayName: "Core Inspect",
					outcomeExpressionSource: "",
					manipulationActionId: "core/inspect",
					communicationSpeechActId: "",
					movementDescriptor: "",
					senseQueryKind: "",
					senseVisibility: "local",
					consequenceTemplateId: "",
					discoveryValidated: false,
					description: "",
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.resolveRef("outcome_templates", "core/inspect/outcome")).toBe(true);
		const [row] = target.lookup("outcome_templates");
		expect(row).toMatchObject({
			outcome_template_id: "core/inspect/outcome",
			manipulation_action_id: "core/inspect",
		});
	});

	it("lookup maps bundles live rows into manifest shape (mod_bundle table)", () => {
		const db = fakeDb({
			mod_bundle: [
				{
					bundleId: "srd",
					displayName: "SRD 5.2.1 (CC-BY)",
					author: "spellkave-test",
					version: "0.0.0",
					dependsOn: "",
					description: "",
					tagPrefixes: [
						{
							prefix: "srd.creature_type",
							targetKind: "tag_value_definitions",
							naturalKeyField: "tag",
						},
					],
					allowFlatTags: false,
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.resolveRef("bundles", "srd")).toBe(true);
		const [row] = target.lookup("bundles");
		expect(row).toMatchObject({
			bundle_id: "srd",
			display_name: "SRD 5.2.1 (CC-BY)",
			tag_prefixes: [
				{
					prefix: "srd.creature_type",
					target_kind: "tag_value_definitions",
					natural_key_field: "tag",
				},
			],
			allow_flat_tags: false,
		});
	});

	it("lookup joins condition_definition_description satellite when reconstructing live rows", () => {
		const catalog = {
			conditionDefinitionId: "srd/cover/half",
			bundleId: "srd",
			displayName: "Half Cover",
			stackingRule: "core/stacking/single",
			removeTimePolicy: "core/remove_policy/independent_lifetime",
			gatePredicateSource: "",
			modifierTemplateId: "srd/cover/half/ac_bonus",
			observable: true,
			grantsCapabilityWhileActive: "",
			implies: [],
		};
		const withProse = fakeDb({
			condition_definition: [{ ...catalog, description: "stale catalog column must be ignored" }],
			condition_definition_description: [
				{
					conditionDefinitionId: "srd/cover/half",
					description: "Part of the body is protected by cover.",
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => withProse });
		expect(target.resolveRef("condition_definitions", "srd/cover/half")).toBe(true);
		const [row] = target.lookup("condition_definitions");
		expect(row).toMatchObject({
			condition_definition_id: "srd/cover/half",
			modifier_template_id: "srd/cover/half/ac_bonus",
		});
		expect(row?.description).toBe("Part of the body is protected by cover.");

		const catalogOnly = fakeDb({ condition_definition: [catalog] });
		const [blank] = createLiveAuthorTarget({ db: () => catalogOnly }).lookup(
			"condition_definitions",
		);
		expect(blank?.description).toBe("");
	});

	it("lookup joins the session_turn_eligibility satellite when reconstructing session rows (ADR-0143)", () => {
		const session = {
			sessionDefId: "srd/session/combat",
			bundleId: "srd",
			participantsPred: "",
			initialState: "",
			legalMovesCsv: "",
			turnRule: "Sequential",
			visibilityPolicy: "Public",
			terminationPred: "",
			onTerminate: "",
			stakesRequired: "",
			winnerPredicate: "",
			turnSchedulerId: "srd/turn/initiative",
			roundDurationMs: 6000n,
			autoJoinOnTargeting: false,
			combatGridBlueprintId: "",
			gridEdgeAffordanceTemplateId: "",
			gridEdgeAffordanceBindingsJson: "",
		};
		const withRule = fakeDb({
			session_definition: [session],
			session_turn_eligibility: [
				{
					sessionDefId: "srd/session/combat",
					bundleId: "srd",
					predicateSource: "macro('srd/takes-turn')",
				},
			],
		});
		const [row] = createLiveAuthorTarget({ db: () => withRule }).lookup("session_definitions");
		expect(row?.turn_eligibility_pred).toBe("macro('srd/takes-turn')");

		// No satellite row (or a module that predates the table): the field is
		// absent, never an empty string a pre-ADR-0143 module would refuse.
		const [plain] = createLiveAuthorTarget({
			db: () => fakeDb({ session_definition: [session] }),
		}).lookup("session_definitions");
		expect(plain).not.toHaveProperty("turn_eligibility_pred");
	});

	it("lookup maps consequence_templates live rows into manifest shape (no description column, honestly omitted)", () => {
		const db = fakeDb({
			consequence_template: [
				{
					templateId: "srd/check/acrobatics/success",
					bundleId: "srd",
					effectRefsCsv: "",
					tracesJson: "[]",
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.resolveRef("consequence_templates", "srd/check/acrobatics/success")).toBe(true);
		const [row] = target.lookup("consequence_templates");
		expect(row).toMatchObject({
			template_id: "srd/check/acrobatics/success",
			traces_json: "[]",
		});
		expect(row?.description).toBeUndefined();
	});

	it("lookup maps modifier_target_definitions live rows into manifest shape, unwrapping the shape enum's {tag} carrier", () => {
		const db = fakeDb({
			modifier_target_definition: [
				{
					targetId: "srd/ac",
					shape: { tag: "Numeric" },
					displayName: "Armor Class",
					bundleId: "srd",
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.resolveRef("modifier_target_definitions", "srd/ac")).toBe(true);
		const [row] = target.lookup("modifier_target_definitions");
		expect(row).toEqual({
			target_id: "srd/ac",
			shape: "Numeric",
			display_name: "Armor Class",
			bundle_id: "srd",
		});
	});

	it("lookup maps modifier_templates live rows into manifest shape, unwrapping the delta_kind enum's {tag} carrier", () => {
		const db = fakeDb({
			modifier_template: [
				{
					modifierTemplateId: "srd/armor/chain-mail/ac_bonus",
					bundleId: "srd",
					appliesTo: "srd/ac",
					displayName: "Chain Mail AC Bonus",
					predicateSource: "",
					modifierExpressionSource: "16",
					priority: 0,
					deltaKind: { tag: "FlatSet" },
					replaceTemplateId: "",
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		expect(target.resolveRef("modifier_templates", "srd/armor/chain-mail/ac_bonus")).toBe(true);
		const [row] = target.lookup("modifier_templates");
		expect(row).toMatchObject({
			modifier_template_id: "srd/armor/chain-mail/ac_bonus",
			applies_to: "srd/ac",
			delta_kind: "FlatSet",
		});
	});

	// Finding #42 (srd-cc finding ledger): the four `*_tag` composite-key
	// kinds `@spellkave/srd-cc`'s own bundle authors — `resolveRef` is never
	// exercised for these (see `author-target.ts`'s `LIVE_ID_FIELD` doc
	// comment: no `ROW_KIND_NATURAL_KEY` entry exists for a composite-keyed
	// kind, and no call site ever passes one to `resolveRef`), so only
	// `lookup`'s mapping is proven here, same as every other accessor above.
	it("lookup maps capability_definition_tag live rows into manifest shape", () => {
		const db = fakeDb({
			capability_definition_tag: [
				{
					rowId: 1n,
					capabilityId: "srd/skill/acrobatics",
					tag: "srd.ability.dex",
					bundleId: "srd",
					source: "manifest",
					setAtTick: 0n,
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		const [row] = target.lookup("capability_definition_tag");
		expect(row).toEqual({
			capability_id: "srd/skill/acrobatics",
			tag: "srd.ability.dex",
			bundle_id: "srd",
			source: "manifest",
		});
	});

	it("lookup maps resource_definition_tag live rows into manifest shape", () => {
		const db = fakeDb({
			resource_definition_tag: [
				{
					rowId: 1n,
					resourceDefinitionId: "srd/dex",
					tag: "srd.ability_score",
					bundleId: "srd",
					source: "manifest",
					setAtTick: 0n,
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		const [row] = target.lookup("resource_definition_tag");
		expect(row).toEqual({
			resource_definition_id: "srd/dex",
			tag: "srd.ability_score",
			bundle_id: "srd",
			source: "manifest",
		});
	});

	it("lookup maps entity_definition_tag live rows into manifest shape", () => {
		const db = fakeDb({
			entity_definition_tag: [
				{
					rowId: 1n,
					entityDefId: "srd/armor/chain-mail",
					tag: "srd.armor",
					bundleId: "srd",
					source: "manifest",
					setAtTick: 0n,
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		const [row] = target.lookup("entity_definition_tag");
		expect(row).toEqual({
			entity_def_id: "srd/armor/chain-mail",
			tag: "srd.armor",
			bundle_id: "srd",
			source: "manifest",
		});
	});

	it("lookup maps modifier_template_tag live rows into manifest shape", () => {
		const db = fakeDb({
			modifier_template_tag: [
				{
					rowId: 1n,
					modifierTemplateId: "srd/armor/chain-mail/ac_bonus",
					tag: "srd.armor",
					bundleId: "srd",
					source: "manifest",
					setAtTick: 0n,
				},
			],
		});
		const target = createLiveAuthorTarget({ db: () => db });
		const [row] = target.lookup("modifier_template_tag");
		expect(row).toEqual({
			modifier_template_id: "srd/armor/chain-mail/ac_bonus",
			tag: "srd.armor",
			bundle_id: "srd",
			source: "manifest",
		});
	});

	it("applyBatch dispatches through the applyDelta port", async () => {
		const calls: string[] = [];
		const target = createLiveAuthorTarget({
			db: undefined,
			applyDelta: async (toml) => {
				calls.push(toml);
				return { ok: true };
			},
		});
		const result = await target.applyBatch('schema_version = "1.0.0"\n');
		expect(result).toEqual({ ok: true });
		expect(calls).toEqual(['schema_version = "1.0.0"\n']);
	});

	it("applyBatch rejects (not throws) when no applyDelta port is wired", async () => {
		const target = createLiveAuthorTarget({ db: undefined });
		const result = await target.applyBatch('schema_version = "1.0.0"\n');
		expect(result.ok).toBe(false);
		expect(result.detail).toMatch(/not connected/);
	});
});

// ---------------------------------------------------------------------------
// `local` driver
// ---------------------------------------------------------------------------

describe("createLocalAuthorTarget", () => {
	let fixturesRoot: string;

	afterEach(() => {
		if (fixturesRoot) rmSync(fixturesRoot, { recursive: true, force: true });
	});

	function seedFixtures(): { depDir: string; baseDir: string } {
		fixturesRoot = mkdtempSync(join(tmpdir(), "author-target-local-"));
		const depDir = join(fixturesRoot, "target_test_dep");
		const baseDir = join(fixturesRoot, "target_test_base");
		writeOutputs(
			depDir,
			{
				bundle_id: "target_test_dep",
				display_name: "Target Test Dep",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "dependency bundle",
			},
			{ bundle: "target_test_dep", profile: "target_test_dep" },
			["base/spatial.toml"],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "place_nodes",
							rows: [
								{
									node_id: "target_test_dep/area/anchor",
									bundle_id: "target_test_dep",
									place_graph_id: "target_test_dep/area",
									local_id: "anchor",
									substrate_id: "outdoor",
									display_name: "Anchor",
								},
							],
						},
					],
				},
			],
		);
		writeOutputs(
			baseDir,
			{
				bundle_id: "target_test_base",
				display_name: "Target Test Base",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: ["target_test_dep"],
				description: "base bundle depending on target_test_dep",
			},
			{ bundle: "target_test_base", profile: "target_test_base" },
			["base/spatial.toml"],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "resource_definitions",
							rows: [
								{
									resource_definition_id: "target_test_base/hp",
									bundle_id: "target_test_base",
									display_name: "Hit Points",
									value_kind: "int",
									recovery_rule: "none",
									min_value: 0,
									max_value: 20,
								},
							],
						},
					],
				},
			],
		);
		return { depDir, baseDir };
	}

	/** A self-contained bundle with one resource row owned by an include fragment. */
	function seedStandaloneFixture(): string {
		fixturesRoot = mkdtempSync(join(tmpdir(), "author-target-local-standalone-"));
		const dir = join(fixturesRoot, "target_test_standalone");
		writeOutputs(
			dir,
			{
				bundle_id: "target_test_standalone",
				display_name: "Target Test Standalone",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "self-contained bundle for applyBatch tests",
			},
			{ bundle: "target_test_standalone", profile: "target_test_standalone" },
			["base/spatial.toml"],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "resource_definitions",
							rows: [
								{
									resource_definition_id: "target_test_standalone/hp",
									bundle_id: "target_test_standalone",
									display_name: "Hit Points",
									value_kind: "int",
									recovery_rule: "none",
									min_value: 0,
									max_value: 20,
								},
							],
						},
					],
				},
			],
		);
		return dir;
	}

	it("resolveRef/lookup resolve through the depends_on chain (dependency's rows visible from the base target)", () => {
		const { baseDir } = seedFixtures();
		const target = createLocalAuthorTarget(baseDir);
		expect(target.kind).toBe("local");
		expect(target.resolveRef("place_nodes", "target_test_dep/area/anchor")).toBe(true);
		expect(target.resolveRef("resource_definitions", "target_test_base/hp")).toBe(true);
		expect(target.resolveRef("place_nodes", "nonexistent")).toBe(false);

		const resources = target.lookup("resource_definitions");
		expect(resources.map((r) => r.resource_definition_id)).toEqual(["target_test_base/hp"]);
		const scoped = target.lookup("resource_definitions", { bundle: "wrong_bundle" });
		expect(scoped).toEqual([]);
	});

	it("applyBatch renders/merges the delta into the target's own manifest.toml — round-trips (render -> parse -> semanticEqual)", async () => {
		const dir = seedStandaloneFixture();
		const target = createLocalAuthorTarget(dir);

		const deltaToml = [
			"#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json",
			'schema_version = "1.0.0"',
			"",
			"[[resource_definitions]]",
			'resource_definition_id = "target_test_standalone/mana"',
			'bundle_id = "target_test_standalone"',
			'display_name = "Mana"',
			'value_kind = "int"',
			'recovery_rule = "none"',
			"min_value = 0",
			"max_value = 10",
			"",
		].join("\n");

		const result = await target.applyBatch(deltaToml);
		expect(result.ok, JSON.stringify(result)).toBe(true);

		const rootToml = readFileSync(join(dir, "manifest.toml"), "utf8");
		const rootManifest = inspectManifest(rootToml).manifest as Record<string, unknown>;
		const resourceIds = (rootManifest.resource_definitions as Record<string, unknown>[]).map(
			(r) => r.resource_definition_id,
		);
		expect(resourceIds).toContain("target_test_standalone/mana");
		// The fragment-owned resource row remains in its source file; the new
		// resource is root-owned.
		const fragmentToml = readFileSync(join(dir, "base/spatial.toml"), "utf8");
		expect(fragmentToml).toContain("target_test_standalone/hp");
		expect(fragmentToml).not.toContain("target_test_standalone/mana");

		// resolveRef/lookup reflect the freshly-applied row after cache invalidation
		// (the FULL chain — root + fragments — resolves both rows).
		expect(target.resolveRef("resource_definitions", "target_test_standalone/mana")).toBe(true);
		expect(target.resolveRef("resource_definitions", "target_test_standalone/hp")).toBe(true);

		// Round-trip fidelity: re-parsing the just-written ROOT file (render ->
		// parse) reproduces exactly the newly-merged row, field-for-field — "hp"
		// stays a fragment-only row (asserted above), never duplicated onto root.
		expect(resourceIds).toEqual(["target_test_standalone/mana"]);
		const manaRow = (rootManifest.resource_definitions as Record<string, unknown>[]).find(
			(r) => r.resource_definition_id === "target_test_standalone/mana",
		);
		expect(manaRow).toMatchObject({
			bundle_id: "target_test_standalone",
			display_name: "Mana",
			value_kind: "int",
			min_value: 0,
			max_value: 10,
		});
	});

	it.each([
		"fragment",
		"root",
	])("applyBatch respects the %s owner of an existing natural key", async (owner) => {
		const dir = seedStandaloneFixture();
		const rootPath = join(dir, "manifest.toml");
		const fragmentPath = join(dir, "base/spatial.toml");
		const initial = loadBundleChain(dir);
		if (owner === "root") {
			const root = inspectManifest(readFileSync(rootPath, "utf8")).manifest;
			writeFileSync(
				rootPath,
				renderSchemaManifest({ ...root, resource_definitions: initial.resource_definitions }),
			);
			writeFileSync(fragmentPath, "# row moved to root\n");
		}
		const beforeFragment = readFileSync(fragmentPath, "utf8");
		const target = createLocalAuthorTarget(dir);
		// Repeating an unchanged row must leave its owner intact.
		expect(
			await target.applyBatch(
				renderSchemaManifest({
					schema_version: "1.0.0",
					resource_definitions: initial.resource_definitions,
				}),
			),
		).toEqual({ ok: true });
		const beforeRoot = readFileSync(rootPath, "utf8");
		const oldRow = (initial.resource_definitions as Record<string, unknown>[])[0];
		// A valid addition before the conflicting row must also remain unapplied.
		const result = await target.applyBatch(
			renderSchemaManifest({
				schema_version: "1.0.0",
				resource_definitions: [
					{ ...oldRow, resource_definition_id: "target_test_standalone/mana" },
					{ ...oldRow, display_name: "Hit Points (renamed)", max_value: 30 },
				],
			}),
		);
		if (owner === "fragment") {
			expect(result).toEqual({ ok: false, detail: expect.stringContaining("base/spatial.toml") });
			expect(readFileSync(rootPath, "utf8")).toBe(beforeRoot);
		} else expect(result).toEqual({ ok: true });
		expect(readFileSync(fragmentPath, "utf8")).toBe(beforeFragment);

		const rootManifest = inspectManifest(readFileSync(rootPath, "utf8")).manifest;
		const fragmentManifest = inspectManifest(
			renderSchemaManifest({ schema_version: "1.0.0" }) + readFileSync(fragmentPath, "utf8"),
		).manifest;
		const hpRows = [
			...(rootManifest.resource_definitions as Record<string, unknown>[]),
			...(fragmentManifest.resource_definitions as Record<string, unknown>[]),
		].filter((row) => row.resource_definition_id === "target_test_standalone/hp");
		expect(hpRows).toHaveLength(1);
		expect(hpRows[0]).toMatchObject(
			owner === "root"
				? { display_name: "Hit Points (renamed)", max_value: 30 }
				: { display_name: "Hit Points", max_value: 20 },
		);
		const complete = loadBundleChain(dir);
		expect(complete.resource_definitions as unknown[]).toHaveLength(owner === "root" ? 2 : 1);
		expect(
			validateManifestToml(renderSchemaManifest(complete)).filter((d) => d.severity === "fatal"),
		).toEqual([]);
	});

	it.each([
		false,
		true,
	])("validates includes before unrelated edits (implicit core: %s)", async (implicitCore) => {
		const dir = seedStandaloneFixture();
		const rootPath = join(dir, "manifest.toml");
		const fragmentPath = join(dir, "base/spatial.toml");
		const complete = loadBundleChain(dir);
		const root = inspectManifest(readFileSync(rootPath, "utf8")).manifest;
		if (implicitCore) {
			const bundle = (root.bundles as Record<string, unknown>[])[0];
			if (!bundle) throw new Error("fixture bundle missing");
			bundle.depends_on = ["core"];
		}
		writeFileSync(
			rootPath,
			renderSchemaManifest({ ...root, resource_definitions: complete.resource_definitions }),
		);
		const beforeRoot = readFileSync(rootPath, "utf8");
		const beforeFragment = readFileSync(fragmentPath, "utf8");
		const result = await createLocalAuthorTarget(dir).applyBatch(
			renderSchemaManifest({
				schema_version: "1.0.0",
				metadata: { note: "do not hide a duplicate in an include" },
			}),
		);
		expect(result).toEqual({ ok: false, detail: expect.stringContaining("MF-VAL-272") });
		expect(readFileSync(rootPath, "utf8")).toBe(beforeRoot);
		expect(readFileSync(fragmentPath, "utf8")).toBe(beforeFragment);
	});

	it("applyBatch rejects (not throws) a delta with a fatal diagnostic, leaving the folder untouched", async () => {
		const dir = seedStandaloneFixture();
		const target = createLocalAuthorTarget(dir);
		const before = readFileSync(join(dir, "manifest.toml"), "utf8");

		// A dangling place_graph_id ref on a place_node is a fatal admission error.
		const invalidToml = [
			"#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json",
			'schema_version = "1.0.0"',
			"",
			"[[place_nodes]]",
			'node_id = "target_test_standalone/broken/node"',
			'bundle_id = "target_test_standalone"',
			'place_graph_id = "target_test_standalone/nonexistent_graph"',
			'local_id = "node"',
			'substrate_id = "outdoor"',
			'display_name = "Broken"',
			"",
		].join("\n");

		const result = await target.applyBatch(invalidToml);
		expect(result.ok).toBe(false);
		expect(result.detail).toBeDefined();
		expect(readFileSync(join(dir, "manifest.toml"), "utf8")).toBe(before);
	});

	// --- Fresh (not-yet-created) target folders (#1983). `applyBatch` always
	// tolerated a missing root manifest via `ownManifest`; `resolveRef`/`lookup`
	// did not, so a host pointed at a new bundle dir threw before it could ever
	// reach the flush that would create the file. ---

	it("resolveRef/lookup treat a target folder with no manifest.toml as empty, not an error", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "author-target-local-fresh-"));
		const target = createLocalAuthorTarget(join(fixturesRoot, "brand_new_bundle"));

		expect(target.resolveRef("resource_definitions", "anything")).toBe(false);
		expect(target.lookup("resource_definitions")).toEqual([]);
	});

	it("applyBatch bootstraps a fresh folder, and the chain resolves from it afterwards", async () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "author-target-local-bootstrap-"));
		const dir = join(fixturesRoot, "bootstrap_bundle");
		const target = createLocalAuthorTarget(dir);

		const deltaToml = [
			"#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json",
			'schema_version = "1.0.0"',
			"",
			"[[bundles]]",
			'bundle_id = "bootstrap_bundle"',
			'display_name = "Bootstrap Bundle"',
			'author = "spellkave-test"',
			'version = "0.0.0"',
			"depends_on = []",
			'description = "created by applyBatch on a folder that did not exist"',
			"",
			"[[resource_definitions]]",
			'resource_definition_id = "bootstrap_bundle/hp"',
			'bundle_id = "bootstrap_bundle"',
			'display_name = "Hit Points"',
			'value_kind = "int"',
			'recovery_rule = "none"',
			"min_value = 0",
			"max_value = 20",
			"",
		].join("\n");

		expect(await target.applyBatch(deltaToml)).toEqual({ ok: true, applyset: "bootstrap_bundle" });
		// A new root is named after its only bundle, so `sk dev seed` accepts it.
		expect(readFileSync(join(dir, "manifest.toml"), "utf8")).toMatch(
			/^applyset = "bootstrap_bundle"$/m,
		);
		// The same target instance now resolves through its own freshly
		// written manifest — the post-`applyBatch` cache invalidation is what
		// makes the empty-chain fallback self-healing rather than sticky.
		expect(target.resolveRef("resource_definitions", "bootstrap_bundle/hp")).toBe(true);
	});

	it("still throws when a depends_on names a bundle that is not there", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "author-target-local-baddep-"));
		const dir = join(fixturesRoot, "dangling_dep_bundle");
		writeOutputs(
			dir,
			{
				bundle_id: "dangling_dep_bundle",
				display_name: "Dangling Dep Bundle",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: ["no_such_bundle"],
				description: "depends on a bundle that does not exist",
			},
			{ bundle: "dangling_dep_bundle", profile: "dangling_dep_bundle" },
			[],
			[],
		);
		const target = createLocalAuthorTarget(dir);

		// The leniency above is scoped to the ROOT: a broken `depends_on` is a
		// real authoring error and must not resolve to silence, or refs into
		// the typo'd dependency would validate clean.
		expect(() => target.resolveRef("resource_definitions", "anything")).toThrow(
			/dependency 'no_such_bundle' manifest not found: .*no_such_bundle\/manifest\.toml/,
		);
	});
});

// ---------------------------------------------------------------------------
// `resolveAuthorTarget`
// ---------------------------------------------------------------------------

describe("resolveAuthorTarget", () => {
	it("returns undefined for undefined", () => {
		expect(resolveAuthorTarget(undefined)).toBeUndefined();
	});

	it("returns a bare value unchanged", () => {
		const target = createLiveAuthorTarget({ db: undefined });
		expect(resolveAuthorTarget(target)).toBe(target);
	});

	it("invokes a thunk", () => {
		const target = createLiveAuthorTarget({ db: undefined });
		expect(resolveAuthorTarget(() => target)).toBe(target);
	});

	it("returns undefined when a thunk throws", () => {
		expect(
			resolveAuthorTarget(() => {
				throw new Error("boom");
			}),
		).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// `resolveLocalAuthorTarget` — the shared "dir string -> validated local
// `AuthorTarget`" seam both hosts wrap (#2004).
// ---------------------------------------------------------------------------

describe("resolveLocalAuthorTarget", () => {
	let fixturesRoot: string;

	afterEach(() => {
		if (fixturesRoot) rmSync(fixturesRoot, { recursive: true, force: true });
	});

	it("throws LocalAuthorTargetDirectoryError on an empty dir", () => {
		expect(() => resolveLocalAuthorTarget("")).toThrow(LocalAuthorTargetDirectoryError);
	});

	it("throws LocalAuthorTargetDirectoryError on a whitespace-only dir", () => {
		expect(() => resolveLocalAuthorTarget("   ")).toThrow(LocalAuthorTargetDirectoryError);
	});

	// Reconciles the two hosts' prior drift: `sk`'s `--target` resolved eagerly
	// via `resolve()`; the Pi extension passed its env value through raw. The
	// shared helper adopts eager resolution — a relative `dir` becomes absolute
	// at the moment a host commits to it, not at whatever point the underlying
	// `local` driver happens to touch the filesystem.
	it("resolves a relative dir to an absolute path anchored on process.cwd()", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "resolve-local-author-target-relative-"));
		const relativeDir = relative(process.cwd(), fixturesRoot);
		const resolved = resolveLocalAuthorTarget(relativeDir);
		expect(resolved.dir).toBe(resolve(fixturesRoot));
		expect(resolved.target.kind).toBe("local");
	});

	it("leaves an already-absolute dir unchanged", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "resolve-local-author-target-absolute-"));
		const resolved = resolveLocalAuthorTarget(fixturesRoot);
		expect(resolved.dir).toBe(resolve(fixturesRoot));
	});

	it("builds a working target whose resolveRef/lookup match createLocalAuthorTarget's own", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "resolve-local-author-target-build-"));
		const dir = join(fixturesRoot, "resolve_helper_bundle");
		writeOutputs(
			dir,
			{
				bundle_id: "resolve_helper_bundle",
				display_name: "Resolve Helper Bundle",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "seeded for resolveLocalAuthorTarget's own test",
			},
			{ bundle: "resolve_helper_bundle", profile: "resolve_helper_bundle" },
			["base/spatial.toml"],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "resource_definitions",
							rows: [
								{
									resource_definition_id: "resolve_helper_bundle/hp",
									bundle_id: "resolve_helper_bundle",
									display_name: "Hit Points",
									value_kind: "int",
									recovery_rule: "none",
									min_value: 0,
									max_value: 20,
								},
							],
						},
					],
				},
			],
		);

		const resolved = resolveLocalAuthorTarget(dir);
		expect(resolved.target.resolveRef("resource_definitions", "resolve_helper_bundle/hp")).toBe(
			true,
		);
		expect(resolved.target.resolveRef("resource_definitions", "nonexistent")).toBe(false);
	});

	it("resolves a relative fixturesRoot the same way it resolves dir", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "resolve-local-author-target-fixtures-root-"));
		const depDir = join(fixturesRoot, "resolve_helper_dep");
		const baseDir = join(fixturesRoot, "resolve_helper_base");
		writeOutputs(
			depDir,
			{
				bundle_id: "resolve_helper_dep",
				display_name: "Resolve Helper Dep",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: [],
				description: "dependency bundle",
			},
			{ bundle: "resolve_helper_dep", profile: "resolve_helper_dep" },
			["base/spatial.toml"],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "resource_definitions",
							rows: [
								{
									resource_definition_id: "resolve_helper_dep/mana",
									bundle_id: "resolve_helper_dep",
									display_name: "Mana",
									value_kind: "int",
									recovery_rule: "none",
									min_value: 0,
									max_value: 10,
								},
							],
						},
					],
				},
			],
		);
		writeOutputs(
			baseDir,
			{
				bundle_id: "resolve_helper_base",
				display_name: "Resolve Helper Base",
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: ["resolve_helper_dep"],
				description: "base bundle depending on resolve_helper_dep",
			},
			{ bundle: "resolve_helper_base", profile: "resolve_helper_base" },
			[],
			[],
		);

		const relativeFixturesRoot = relative(process.cwd(), fixturesRoot);
		const resolved = resolveLocalAuthorTarget(baseDir, { fixturesRoot: relativeFixturesRoot });
		expect(resolved.target.resolveRef("resource_definitions", "resolve_helper_dep/mana")).toBe(
			true,
		);
	});
});
