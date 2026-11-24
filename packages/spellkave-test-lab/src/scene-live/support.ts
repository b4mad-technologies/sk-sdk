// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "Per-test scene prefixes parameterize the extra rows (items, containment, state, equipment, condition) that the shared owner-read and take-item live tests add to one private scene bundle."}
// ci-allow(embedded-manifest-schema): private-scene manifest assembler - TOML built from runtime fragments, not a standalone manifest
/**
 * Shared helpers for the package-level scene live tests (`test:live`).
 *
 * The package seeds ONE database once (`seed.ts`); every test builds its own
 * private scene on it. Nothing here wipes, publishes or reseeds.
 */

import { connect, type SpellkaveSession } from "@spellkave/sdk";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import { applyManifestDelta, connectTestWorld, type TestWorld } from "../live";
import { type Scene, type SceneWorldRef, scene, serializeApplyPerDb } from "../scene";

/** Owner world reference for `scene()`. Throws without a local publisher credential. */
export function liveWorldRef(): SceneWorldRef {
	const token = resolveSpacetimeConfigPathToken();
	if (!token) throw new Error("owned node publisher credential required (SPACETIME_CONFIG_PATH)");
	return {
		url: process.env.SPELLKAVE_URL ?? "http://127.0.0.1:3000",
		db: process.env.SPELLKAVE_DB ?? "spellkave-dev",
		token,
	};
}

export const localNode = process.env.SPELLKAVE_LOCAL_NODE === "1";

/** Bundle header for a delta that adds rows to an existing scene bundle. */
export function sceneDeltaHeader(prefix: string, dependsOn: readonly string[] = ["core"]): string {
	return `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[[bundles]]
bundle_id = "${prefix}"
display_name = "Scene ${prefix}"
author = "spellkave-test"
version = "1.0.0"
depends_on = ${JSON.stringify(dependsOn)}
`;
}

let extrasOwner: Promise<TestWorld> | undefined;

/** One owner-token connection per process for extras applies (bound by the scene's gatekeeper step). */
export function ownerConnection(): Promise<TestWorld> {
	const world = liveWorldRef();
	extrasOwner ??= connectTestWorld({ url: world.url, db: world.db, token: world.token });
	return extrasOwner;
}

/** Release the shared extras connection. Call from `afterAll`. */
export async function closeExtrasOwner(): Promise<void> {
	if (extrasOwner === undefined) return;
	const owner = await extrasOwner;
	extrasOwner = undefined;
	owner.disconnect();
}

/**
 * Apply extra rows (items, containment, state, ...) to a scene bundle that has
 * already been applied. `rows` is TOML without the header. Must run after
 * `scene.apply()` (which binds the owner to the gatekeeper). Rides the scene
 * per-DB apply queue so it cannot collide with another scene in this process.
 */
export async function applySceneExtras(
	target: Scene,
	toml: string,
	dependsOn: readonly string[] = ["core"],
): Promise<void> {
	const world = liveWorldRef();
	const owner = await ownerConnection();
	await serializeApplyPerDb(world, () =>
		applyManifestDelta(owner, `${sceneDeltaHeader(target.prefix, dependsOn)}\n${toml}`, {
			tolerateAlreadyApplied: true,
			label: `scene ${target.prefix} extras`,
		}),
	);
}

export const entityKey = (prefix: string, name: string): string => `${prefix}/${name}`;

export type Row = Record<string, unknown>;

export const quiet = { onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} };
export const sameId = (a: unknown, b: unknown): boolean => String(a) === String(b);

export function hex(value: unknown): string {
	if (value && typeof value === "object" && "toHexString" in value) {
		const fn = (value as { toHexString?: () => string }).toHexString;
		if (typeof fn === "function") return fn.call(value).replace(/^0x/i, "").toLowerCase();
	}
	return String(value ?? "")
		.replace(/^0x/i, "")
		.toLowerCase();
}

export function rows(session: SpellkaveSession, accessor: string): Row[] {
	const handle = (
		session.conn.db as unknown as Record<string, { iter(): Iterable<Row> } | undefined>
	)[accessor];
	if (typeof handle?.iter !== "function") throw new Error(`missing cache handle: ${accessor}`);
	return [...handle.iter()];
}

export const asWorld = (session: SpellkaveSession): TestWorld =>
	({ conn: session.conn }) as TestWorld;

export async function openSession(
	token: string | null,
	ownerTables: boolean,
): Promise<SpellkaveSession> {
	const world = liveWorldRef();
	const session = await connect(
		{
			url: world.url,
			db: world.db,
			token,
			connectedActorId: "scene-live-owner-read",
			...(ownerTables ? { ownerTables: true } : {}),
		},
		quiet,
	);
	try {
		await session.ready;
		await session.ownerRowsReady;
	} catch (error) {
		session.disconnect();
		throw error;
	}
	return session;
}

/**
 * One scene: a yard with a crate (container) holding a gem, a marked item that
 * carries an initial condition, a coin on the ground, and a hero who wields a
 * blade and has a bound identity.
 */
export async function buildStockedScene(): Promise<Scene> {
	const s = await scene(liveWorldRef());
	s.place("yard")
		.npc("crate", { at: "yard", def: "core/item/wayfarer_pack" })
		.hero("hero", { at: "yard", capabilities: ["core/inspect"] });
	await s.apply();
	const p = s.prefix;
	// A delta validates on its own, so entities it references are restated
	// verbatim (upsert: same def, same place) next to the new rows.
	await applySceneExtras(
		s,
		`
[[entities]]
bundle_id = "${p}"
entity_key = "${entityKey(p, "crate")}"
entity_def_id = "core/item/wayfarer_pack"
name = "crate"
kind = "npc"
place_node_id = "${s.reads.nodeId("yard")}"

[[entities]]
bundle_id = "${p}"
entity_key = "${entityKey(p, "hero")}"
entity_def_id = "core/creature/wolf"
name = "hero"
kind = "npc"
place_node_id = "${s.reads.nodeId("yard")}"

[[entity_definitions]]
bundle_id = "${p}"
entity_def_id = "${p}/marked"
display_name = "Marked"
description = "An item that carries an initial condition."

[[entity_definition_initial_condition]]
bundle_id = "${p}"
entity_def_id = "${p}/marked"
condition_definition_id = "core/condition/prone"
duration_ticks = 0

[[entities]]
bundle_id = "${p}"
entity_key = "${entityKey(p, "marked")}"
entity_def_id = "${p}/marked"
name = "marked"
kind = "item"
place_node_id = "${s.reads.nodeId("yard")}"

[[entities]]
bundle_id = "${p}"
entity_key = "${entityKey(p, "gem")}"
entity_def_id = "core/item/torch"
name = "gem"
kind = "item"
place_node_id = ""

[[entity_containment]]
container_entity_key = "${entityKey(p, "crate")}"
entity_key = "${entityKey(p, "gem")}"
slot_id = ""
direction = ""

[[entities]]
bundle_id = "${p}"
entity_key = "${entityKey(p, "blade")}"
entity_def_id = "core/item/sword"
name = "blade"
kind = "item"
place_node_id = ""
owned_by_entity_key = "${entityKey(p, "hero")}"

[[entity_containment]]
container_entity_key = "${entityKey(p, "hero")}"
entity_key = "${entityKey(p, "blade")}"
slot_id = ""
direction = ""

[[actor_equipment_slots]]
actor_entity_key = "${entityKey(p, "hero")}"
item_key = "${entityKey(p, "blade")}"
slot_id = "core/main_hand"

[[entities]]
bundle_id = "${p}"
entity_key = "${entityKey(p, "coin")}"
entity_def_id = "core/item/loot_dagger"
name = "coin"
kind = "item"
place_node_id = "${s.reads.nodeId("yard")}"

[[object_state]]
bundle_id = "${p}"
entity_key = "${entityKey(p, "crate")}"
state_id = "core/locked"
value_bool = true
source_template_id = "manifest"

[[entity_tag]]
bundle_id = "${p}"
entity_key = "${entityKey(p, "crate")}"
tag = "core.scene_crate"
source = "manifest"
`,
	);
	await s.waitFor(
		(r) => ["crate", "gem", "marked", "blade", "coin"].every((n) => r.entityId(n) !== null),
		"stocked scene entities visible",
	);
	return s;
}

export const ownedBy = (s: Scene, name: string): bigint => {
	const id = s.reads.entityId(name);
	if (id === null) throw new Error(`scene ${s.prefix}: '${name}' not authored`);
	return id;
};
