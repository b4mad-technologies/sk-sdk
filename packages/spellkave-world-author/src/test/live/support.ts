// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "live scene extras need a minimal bundle envelope that restates scene entities, since a delta validates on its own", "signatures": ["toml_version", "schema_directive", "schema_shape"]}
// ci-allow(embedded-manifest-schema): private-scene extras - TOML built from runtime fragments, not a standalone manifest
/**
 * Shared helpers for the world-author live tests (`pnpm test:live`). The package seeds ONE
 * database once (`seed.ts`); every test builds its own prefixed scene on it.
 */
import { connect, type SpellkaveSession, snapshotDb } from "@spellkave/sdk";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	applyManifestDelta,
	connectTestWorld,
	type Scene,
	type SceneWorldRef,
	scene,
	serializeApplyPerDb,
	type TestWorld,
} from "@spellkave/test-lab";
import { createOwnerInstanceRead, type OwnerSnapshot } from "../../owner-instance-read";

export const localNode = process.env.SPELLKAVE_LOCAL_NODE === "1";

export function liveWorldRef(): SceneWorldRef {
	const token = resolveSpacetimeConfigPathToken();
	if (!token) throw new Error("owned node publisher credential required (SPACETIME_CONFIG_PATH)");
	return {
		url: process.env.SPELLKAVE_URL ?? "http://127.0.0.1:3000",
		db: process.env.SPELLKAVE_DB ?? "spellkave-dev",
		token,
	};
}

const quiet = { onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} };

/** Open an owner-table session (publisher with `token`, anonymous with `null`). */
export async function openOwnerSession(token: string | null): Promise<SpellkaveSession> {
	const w = liveWorldRef();
	const session = await connect(
		{
			url: w.url,
			db: w.db,
			token,
			connectedActorId: "world-author-live-owner-read",
			ownerTables: true,
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

/** The `spellkave_get` / `spellkave_describe` port over one session's owner cache. */
export function ownerReader(session: SpellkaveSession) {
	return createOwnerInstanceRead({
		snapshot: () => snapshotDb(session) as OwnerSnapshot,
		worldTick: () => session.currentWorldTick(),
		readsAsPublisher: session.readsAsPublisher,
	});
}

export const asWorld = (session: SpellkaveSession): TestWorld =>
	({ conn: session.conn }) as TestWorld;

let extrasOwner: Promise<TestWorld> | undefined;
export function ownerConnection(): Promise<TestWorld> {
	const w = liveWorldRef();
	extrasOwner ??= connectTestWorld({ url: w.url, db: w.db, token: w.token });
	return extrasOwner;
}
export async function closeExtrasOwner(): Promise<void> {
	if (extrasOwner === undefined) return;
	const owner = await extrasOwner;
	extrasOwner = undefined;
	owner.disconnect();
}

/**
 * A yard with a hero, a chest (container) holding a gem, and a coin on the ground.
 * A delta validates on its own, so entities it references are restated verbatim.
 */
export async function buildChestScene(): Promise<Scene> {
	const w = liveWorldRef();
	const s = await scene(w);
	s.place("yard")
		.npc("chest", { at: "yard", def: "core/item/wayfarer_pack" })
		.hero("hero", { at: "yard", capabilities: ["core/inspect"] });
	await s.apply();
	const p = s.prefix;
	const yard = s.reads.nodeId("yard");
	const owner = await ownerConnection();
	await serializeApplyPerDb(w, () =>
		applyManifestDelta(
			owner,
			`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[[bundles]]
bundle_id = "${p}"
display_name = "Scene ${p}"
author = "spellkave-test"
version = "1.0.0"
depends_on = ["core"]

[[entities]]
bundle_id = "${p}"
entity_key = "${p}/chest"
entity_def_id = "core/item/wayfarer_pack"
name = "chest"
kind = "npc"
place_node_id = "${yard}"

[[entities]]
bundle_id = "${p}"
entity_key = "${p}/gem"
entity_def_id = "core/item/torch"
name = "gem"
kind = "item"
place_node_id = ""

[[entity_containment]]
container_entity_key = "${p}/chest"
entity_key = "${p}/gem"
slot_id = ""
direction = ""

[[entities]]
bundle_id = "${p}"
entity_key = "${p}/coin"
entity_def_id = "core/item/loot_dagger"
name = "coin"
kind = "item"
place_node_id = "${yard}"
`,
			{ tolerateAlreadyApplied: true, label: `scene ${p} extras` },
		),
	);
	await s.waitFor(
		(r) => ["chest", "gem", "coin"].every((n) => r.entityId(n) !== null),
		"chest scene entities visible",
	);
	return s;
}
