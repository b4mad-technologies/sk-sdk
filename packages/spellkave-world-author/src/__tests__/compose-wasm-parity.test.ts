import { compose_ids_json, compose_live_wiring_json } from "@spellkave/authoring-wasm";
import { describe, expect, it } from "vitest";
import { type ActorBehavior, type BehaviorConfig, clusterRows } from "../index";

// #1968 R7 (ADR-0087, tasks.md 4.1): `ids()` and the shared live-wiring
// emission are the FIRST compose.ts pieces ported to Rust — the exact spot
// the `ids()` hand-mirror incident (ADR-0087 Context) came from. `compose.ts`
// itself is NOT yet routed through wasm (that is tasks.md 4.10); this suite
// proves the new `spellkave-authoring-wasm` exports (`compose_ids_json`,
// `compose_live_wiring_json`) reproduce, byte-for-byte, what the SAME
// synthetic inputs make the still-authoritative `clusterRows` (old TS)
// compute — a real parity oracle against live TS behavior, not a hand-copied
// expectation. Covers both `idNamespace` shapes the corpus actually uses: the
// unset/"srd" default, and the bundle-generic override
// (`authoring-verbs.ts`'s `spellkave_define_behavior` sets `idNamespace:
// bundle` — see that file's `cfg` construction around its `clusterRows` call).

type Rows = Record<string, Array<Record<string, unknown>>>;

function idsFromClusterRows(rows: Rows) {
	return {
		cap: rows.capability_definitions?.[0]?.capability_id,
		niche: rows.spatial_niche_attachments?.[0]?.niche_id,
		action: rows.action_definitions?.[0]?.action_id,
		outcome: rows.outcome_templates?.[0]?.outcome_template_id,
		affordance: rows.affordance_templates?.[0]?.template_id,
		success: rows.consequence_templates?.[0]?.template_id,
	};
}

function liveWiringFromClusterRows(rows: Rows) {
	return {
		actor_capabilities: rows.actor_capabilities,
		spatial_niche_attachments: rows.spatial_niche_attachments,
		entities: rows.entities,
		actor_spatial_locations: rows.actor_spatial_locations,
		actors: rows.actors,
		entity_definition_initial_capability: rows.entity_definition_initial_capability,
	};
}

// The wasm `compose_live_wiring_json` export omits table keys it never
// touched (see that module's doc comment); `clusterRows`'s full `rows`
// object always predefines every table key as `[]` before dropping empties
// at the very end. Normalize both sides to "present tables only" so the
// comparison is about ROWS, not about which convention drops empty arrays.
function dropEmptyTables(tables: Record<string, unknown[] | undefined>) {
	return Object.fromEntries(
		Object.entries(tables).filter(([, rows]) => rows !== undefined && rows.length > 0),
	);
}

const BASE_CFG: BehaviorConfig = {
	bundleId: "srd",
	manifestPath: "world-fixtures/srd/manifest.toml",
	capPrefix: "spell",
	actionPrefix: "cast_",
	defaultCaster: "srd/regdar",
	defaultCasterNode: "srd_outdoor/cell_a",
};

const BASE_BEHAVIOR: ActorBehavior = {
	key: "firebolt",
	displayName: "Firebolt",
	emitCapability: true,
	actionTags: ["spell"],
	shape: "single-target",
	predicateSource: "d20 >= 13",
	deltaSource: "0 - 1d10",
};

describe("compose ids()/live-wiring wasm parity (#1968 R7 slice 4.1)", () => {
	it("srd-default idNamespace: wasm compose_ids_json matches clusterRows' derived ids", () => {
		const rows = clusterRows([BASE_BEHAVIOR], BASE_CFG) as Rows;
		const tsIds = idsFromClusterRows(rows);

		const wasmIds = JSON.parse(
			compose_ids_json(JSON.stringify(BASE_BEHAVIOR), JSON.stringify(BASE_CFG)),
		);
		expect(wasmIds).toEqual(tsIds);
		expect(wasmIds.cap).toBe("srd/spell/firebolt");
	});

	it("bundle-generic idNamespace override (companion-agent shape): wasm compose_ids_json matches clusterRows", () => {
		const cfg: BehaviorConfig = { ...BASE_CFG, bundleId: "aoe_blast", idNamespace: "aoe_blast" };
		const behavior: ActorBehavior = { ...BASE_BEHAVIOR, key: "firebloom" };
		const rows = clusterRows([behavior], cfg) as Rows;
		const tsIds = idsFromClusterRows(rows);

		const wasmIds = JSON.parse(compose_ids_json(JSON.stringify(behavior), JSON.stringify(cfg)));
		expect(wasmIds).toEqual(tsIds);
		expect(wasmIds.cap).toBe("aoe_blast/spell/firebloom");
	});

	it("explicit capabilityId override: wasm compose_ids_json matches clusterRows (the catalog-spell-identity path)", () => {
		const behavior: ActorBehavior = { ...BASE_BEHAVIOR, capabilityId: "srd/spell/fire-bolt" };
		const rows = clusterRows([behavior], BASE_CFG) as Rows;
		const tsIds = idsFromClusterRows(rows);

		const wasmIds = JSON.parse(
			compose_ids_json(JSON.stringify(behavior), JSON.stringify(BASE_CFG)),
		);
		expect(wasmIds).toEqual(tsIds);
		expect(wasmIds.cap).toBe("srd/spell/fire-bolt");
	});

	it("srd-default: wasm compose_live_wiring_json matches clusterRows' live-wiring rows (bare caster)", () => {
		const rows = clusterRows([BASE_BEHAVIOR], BASE_CFG) as Rows;
		const tsWiring = dropEmptyTables(liveWiringFromClusterRows(rows));

		const wasmWiring = JSON.parse(
			compose_live_wiring_json(JSON.stringify(BASE_BEHAVIOR), JSON.stringify(BASE_CFG)),
		);
		expect(wasmWiring).toEqual(tsWiring);
	});

	it("emitCasterEntity + emitCasterActor: wasm compose_live_wiring_json matches clusterRows (monster-caster wiring)", () => {
		const behavior: ActorBehavior = {
			...BASE_BEHAVIOR,
			key: "goblin-bite",
			caster: "srd/goblin-1",
			emitCasterEntity: true,
			emitCasterActor: true,
			casterEntityDefId: "srd/monster/goblin",
			casterName: "Goblin",
			casterKind: "npc",
		};
		const rows = clusterRows([behavior], BASE_CFG) as Rows;
		const tsWiring = dropEmptyTables(liveWiringFromClusterRows(rows));

		const wasmWiring = JSON.parse(
			compose_live_wiring_json(JSON.stringify(behavior), JSON.stringify(BASE_CFG)),
		);
		expect(wasmWiring).toEqual(tsWiring);
	});

	it("bindToDefinition + defInstance: wasm compose_live_wiring_json matches clusterRows (the #728 proof-instance shape)", () => {
		const behavior: ActorBehavior = {
			...BASE_BEHAVIOR,
			key: "test-strike",
			bindToDefinition: "srd/monster/cat",
			defInstance: { entityKey: "srd/proof-cat", name: "Proof Cat" },
		};
		const rows = clusterRows([behavior], BASE_CFG) as Rows;
		const tsWiring = dropEmptyTables(liveWiringFromClusterRows(rows));

		const wasmWiring = JSON.parse(
			compose_live_wiring_json(JSON.stringify(behavior), JSON.stringify(BASE_CFG)),
		);
		expect(wasmWiring).toEqual(tsWiring);
	});

	it("bundle-generic idNamespace + defInstance node override: wasm compose_live_wiring_json matches clusterRows", () => {
		const cfg: BehaviorConfig = { ...BASE_CFG, bundleId: "aoe_blast", idNamespace: "aoe_blast" };
		const behavior: ActorBehavior = {
			...BASE_BEHAVIOR,
			key: "firebloom",
			bindToDefinition: "aoe_blast/def/imp",
			defInstance: {
				entityKey: "aoe_blast/proof-imp",
				name: "Proof Imp",
				node: "aoe_blast/cell_b",
			},
		};
		const rows = clusterRows([behavior], cfg) as Rows;
		const tsWiring = dropEmptyTables(liveWiringFromClusterRows(rows));

		const wasmWiring = JSON.parse(
			compose_live_wiring_json(JSON.stringify(behavior), JSON.stringify(cfg)),
		);
		expect(wasmWiring).toEqual(tsWiring);
	});
});
