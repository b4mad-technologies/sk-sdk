// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "Per-test prefixes and freshly minted hero identities parameterize one private mini-scene bundle so concurrent tests share a database without sharing any entity, place or edge identifier."}
// ci-allow(embedded-manifest-schema): private-scene manifest assembler - TOML built from runtime fragments, not a standalone manifest
/**
 * Private, prefix-namespaced mini scene on a database other tests share
 * (ledger/designs/shared-db-mini-scenes.md §4-6, adapted to the one-DB-per-
 * package maxim, sk-jay0.7.123.20.25).
 *
 * A scene owns one authored bundle (id = prefix), one place graph, generic
 * NPCs and hero bodies bound to dedicated in-memory identities. It never
 * mutates DB-wide state: no clock, no RNG, no gatekeeper. Tests that need
 * `pauseTicks`/`manualTick`/`setTestRng` belong to the serial final phase of
 * the package run, not here.
 *
 * `scene()` takes a structural `{url, db, token}` so callers holding a leased
 * or local world need no dependency edge to `@spellkave/behaviour`. `token`
 * is the DB owner credential: manifest applies run on a connection that
 * carries it, hero identities are minted anonymously and never touch disk.
 *
 * Reads go through `scene.reads`, which only ever returns entities whose
 * manifest key or place node sits under the scene prefix. Scoping is
 * client-side over the subscribed rows; it is a convenience that keeps
 * assertions local, not an access-control boundary.
 */
import { randomUUID } from "node:crypto";
import { stringify } from "smol-toml";
import {
	applyManifestDelta,
	connectTestWorld,
	ensureWorldAuthority,
	operatorScopeManifest,
	type SnapshotDb,
	type TestWorld,
	waitForEvent,
} from "./live";

/** Structural world reference. `WorldSource` from `@spellkave/behaviour` satisfies it. */
export interface SceneWorldRef {
	url: string;
	db: string;
	/** DB owner credential (local publisher token, or a lease token). */
	token: string;
}

export interface SceneOptions {
	/** Bundles the scene depends on. Default `["core"]`. */
	bundleDeps?: readonly string[];
	connectTimeoutMs?: number;
}

export interface ScenePlaceSpec {
	/** Names of other places of this scene reachable from here (one-way edges). */
	exits?: readonly string[];
	/**
	 * `bindings_json` for the traverse affordance of an exit, keyed by the exit's
	 * place name (movement reach/budget bindings). Exits without an entry keep the
	 * plain, instantaneous traversal.
	 */
	exitBindings?: Readonly<Record<string, string>>;
}

export interface SceneNpcSpec {
	at: string;
	/** Entity definition. Default `core/creature/wolf` (generic, no named singleton). */
	def?: string;
	/** Also author an `actor` row for the body. Default false. */
	actor?: boolean;
	capabilities?: readonly string[];
}

export interface SceneHeroSpec {
	at: string;
	def?: string;
	capabilities?: readonly string[];
}

export interface SceneHero {
	name: string;
	/** Dedicated connection for this hero's identity. Set after `apply()`. */
	world: TestWorld;
	identity: string;
	entityId: bigint;
	actorId: bigint;
}

export interface SceneReads {
	/** Manifest-authored entity of this scene, or null before `apply()` lands. */
	entityId(name: string): bigint | null;
	/** Place node id of a declared place. Pure; no subscription needed. */
	nodeId(place: string): string;
	/** Entities located at one of this scene's places (authored or runtime-spawned). */
	at(place: string): bigint[];
	/** Every entity of the scene: authored under the prefix, or located at a scene node. */
	entityIds(): bigint[];
	/** Place node of an authored entity. */
	nodeOf(name: string): string | null;
	/** Integer object state of an authored entity. */
	state(name: string, stateId: string): number | null;
	/**
	 * Every scene entity and its place node; the input of a pattern's scene diff.
	 * Object states are not part of it: `object_state` is server-filtered for
	 * subscriptions, so the owner connection never receives those rows. Assert a
	 * state change through a hero's visible reads instead.
	 */
	snapshot(): SceneSnapshot;
}

export interface SceneEntitySnapshot {
	/** Place node, or null when the entity has no location row. */
	node: string | null;
}

/** Keyed by entity id (decimal string). */
export type SceneSnapshot = Map<string, SceneEntitySnapshot>;

export interface Scene {
	readonly prefix: string;
	readonly bundleId: string;
	readonly reads: SceneReads;
	/** The scene's owner connection (DB owner credential, raw-table reads). */
	readonly owner: TestWorld;
	/** Every hero applied so far. */
	heroes(): SceneHero[];
	/** Declare a place. Names are scene-local; ids become `${prefix}/g/${name}`. */
	place(name: string, spec?: ScenePlaceSpec): this;
	/** Declare a generic NPC (no seat, no identity). */
	npc(name: string, spec: SceneNpcSpec): this;
	/** Declare a hero body bound to a freshly minted identity. */
	hero(name: string, spec: SceneHeroSpec): this;
	/** Resolved after `apply()`. Throws for an unknown or not yet applied hero. */
	heroOf(name: string): SceneHero;
	/** Apply everything declared so far as one delta (upsert). Safe to call again. */
	apply(): Promise<void>;
	/** Wait until `predicate(reads)` holds on the scene's own connection. */
	waitFor(predicate: (reads: SceneReads) => boolean, message: string): Promise<void>;
	/** Disconnect all connections. Scenes are never deleted (bundle delete is decommissioned). */
	close(): Promise<void>;
}

// --- pure parts ---------------------------------------------------------

const PREFIX_RE = /^[a-z][a-z0-9_]{2,47}$/;
const NAME_RE = /^[a-z][a-z0-9_]{0,47}$/;
const GENERIC_DEF = "core/creature/wolf";
const SCENE_GRAPH = "g";
const TRAVERSE_AFFORDANCE = "core/affordance/traverse_open_portal";

/** Fresh per-test prefix, same shape as the parameterized-scene helpers. */
export function newScenePrefix(): string {
	return `t_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

/** Throws unless `prefix` is usable as a bundle id and key namespace. */
export function validateScenePrefix(prefix: string): string {
	if (!PREFIX_RE.test(prefix)) {
		throw new Error(`scene prefix ${JSON.stringify(prefix)} must match ${PREFIX_RE}`);
	}
	return prefix;
}

export const sceneEntityKey = (prefix: string, name: string): string => `${prefix}/${name}`;
export const sceneNodeId = (prefix: string, place: string): string =>
	`${prefix}/${SCENE_GRAPH}/${place}`;

/** True when a place node id belongs to the scene with this prefix. */
export function isSceneNode(prefix: string, nodeId: string): boolean {
	return nodeId.startsWith(`${prefix}/`);
}

interface PlaceModel {
	name: string;
	exits: readonly string[];
	exitBindings?: Readonly<Record<string, string>>;
}
interface BodyModel {
	name: string;
	kind: "npc" | "hero";
	at: string;
	def: string;
	actor: boolean;
	capabilities: readonly string[];
}
export interface SceneModel {
	prefix: string;
	bundleDeps: readonly string[];
	places: readonly PlaceModel[];
	bodies: readonly BodyModel[];
}

/**
 * Render the scene bundle. `identities` maps hero name -> identity hex; every
 * hero in the model needs one. Pure, so prefixing and shape are unit-testable.
 */
export function sceneManifestSource(
	model: SceneModel,
	identities: ReadonlyMap<string, string>,
): string {
	const b = model.prefix;
	const graph = `${b}/${SCENE_GRAPH}`;
	const placeNames = new Set(model.places.map((p) => p.name));
	if (model.places.length === 0) throw new Error(`scene ${b}: declare at least one place`);
	for (const body of model.bodies) {
		if (!placeNames.has(body.at)) {
			throw new Error(`scene ${b}: ${body.kind} '${body.name}' is at unknown place '${body.at}'`);
		}
	}
	const edges = model.places.flatMap((from) =>
		from.exits.map((to) => {
			if (!placeNames.has(to)) {
				throw new Error(`scene ${b}: place '${from.name}' has exit to unknown place '${to}'`);
			}
			return {
				edge_key: `${b}/${from.name}->${to}`,
				from,
				to,
				bindings: from.exitBindings?.[to],
			};
		}),
	);
	const actors = model.bodies.filter((body) => body.actor || body.kind === "hero");
	const caps = model.bodies.flatMap((body) =>
		body.capabilities.map((capability_id) => ({
			bundle_id: b,
			actor_entity_key: sceneEntityKey(b, body.name),
			capability_id,
			source: "manifest",
		})),
	);
	const heroRows = model.bodies
		.filter((body) => body.kind === "hero")
		.map((body) => {
			const identity = identities.get(body.name);
			if (identity === undefined)
				throw new Error(`scene ${b}: hero '${body.name}' has no identity`);
			return {
				bundle_id: b,
				entity_key: sceneEntityKey(b, body.name),
				identity,
				role: "primary",
				provenance: "person",
			};
		});
	const doc: Record<string, unknown[]> = {
		bundles: [
			{
				bundle_id: b,
				display_name: `Scene ${b}`,
				author: "spellkave-test",
				version: "1.0.0",
				depends_on: [...model.bundleDeps],
			},
		],
		place_graphs: [
			{
				bundle_id: b,
				place_graph_id: graph,
				substrate_id: "outdoor",
				display_name: "scene",
				anchor_node_id: sceneNodeId(b, model.places[0]?.name ?? ""),
			},
		],
		place_nodes: model.places.map((place, index) => ({
			bundle_id: b,
			node_id: sceneNodeId(b, place.name),
			local_id: place.name,
			place_graph_id: graph,
			substrate_id: "outdoor",
			display_name: place.name,
			pos_present: true,
			// Scene-owned coordinates: one 10 m step per declared place.
			pos_x: index * 10,
			pos_y: 0,
			extent_shape_id: "core/area/cube",
			extent_params_json: '{"extent_m":1}',
		})),
		entities: model.bodies.map((body) => ({
			bundle_id: b,
			entity_key: sceneEntityKey(b, body.name),
			entity_def_id: body.def,
			name: body.name,
			kind: "npc",
			place_node_id: sceneNodeId(b, body.at),
		})),
	};
	if (edges.length > 0) {
		doc.place_edges = edges.map((e) => ({
			edge_key: e.edge_key,
			bundle_id: b,
			place_graph_id: graph,
			from_node_id: sceneNodeId(b, e.from.name),
			to_node_id: sceneNodeId(b, e.to),
		}));
		doc.place_edge_affordance = edges.map((e) => ({
			edge_key: e.edge_key,
			affordance_template_id: TRAVERSE_AFFORDANCE,
			...(e.bindings === undefined ? {} : { bindings_json: e.bindings }),
		}));
	}
	if (actors.length > 0) {
		doc.actors = actors.map((body) => ({
			bundle_id: b,
			entity_key: sceneEntityKey(b, body.name),
			name: body.name,
		}));
		doc.actor_spatial_locations = actors.map((body) => ({
			bundle_id: b,
			entity_key: sceneEntityKey(b, body.name),
			place_node_id: sceneNodeId(b, body.at),
		}));
	}
	if (heroRows.length > 0) doc.actor_identities = heroRows;
	if (caps.length > 0) doc.actor_capabilities = caps;
	return `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n${stringify(doc)}`;
}

// --- per-DB apply queue ---------------------------------------------------

/**
 * MF-APPLY-013 allows one manifest apply in flight per DB and the client does
 * not retry. Every scene apply against the same `(url, db)` chains here, so
 * scenes built concurrently in one process cannot collide with each other.
 * Cross-process collisions still fail loudly (by design, see live.ts).
 */
const applyQueues = new Map<string, Promise<unknown>>();

export function serializeApplyPerDb<T>(
	world: Pick<SceneWorldRef, "url" | "db">,
	task: () => Promise<T>,
): Promise<T> {
	const key = `${world.url}\u0000${world.db}`;
	const tail = applyQueues.get(key) ?? Promise.resolve();
	const run = tail.then(task, task);
	const settled = run.catch(() => undefined);
	applyQueues.set(key, settled);
	void settled.then(() => {
		if (applyQueues.get(key) === settled) applyQueues.delete(key);
	});
	return run;
}

/** `(url, db, owner identity)` triples whose gatekeeper binding this process confirmed. */
const gatekept = new Set<string>();

// --- live part ------------------------------------------------------------

/** Tables the scene's owner-side reads need; narrower than the full catalog. */
const OWNER_READ_TABLES = [
	"operator_manifest_authored_entity",
	"actor",
	"entity_location",
	"object_state",
] as const;

function row(raw: unknown): Record<string, unknown> {
	return raw as Record<string, unknown>;
}

function rows(db: SnapshotDb, accessor: string, snake: string): Record<string, unknown>[] {
	const handle = db[accessor] ?? db[snake];
	return Array.from(handle?.iter() ?? [], row);
}

export async function scene(
	world: SceneWorldRef,
	prefix: string = newScenePrefix(),
	options: SceneOptions = {},
): Promise<Scene> {
	validateScenePrefix(prefix);
	const places = new Map<string, PlaceModel>();
	const bodies = new Map<string, BodyModel>();
	const heroes = new Map<string, SceneHero>();
	const identities = new Map<string, TestWorld>();

	const owner = await connectTestWorld({
		url: world.url,
		db: world.db,
		token: world.token,
		connectedActorId: prefix,
		connectTimeoutMs: options.connectTimeoutMs,
		readerManifests: [operatorScopeManifest(`scene:${prefix}`, OWNER_READ_TABLES)],
	});

	const manifestKey = (name: string) => `${prefix}:${sceneEntityKey(prefix, name)}`;
	const claim = (name: string) => {
		if (!NAME_RE.test(name)) throw new Error(`scene ${prefix}: bad name ${JSON.stringify(name)}`);
		if (places.has(name) || bodies.has(name)) {
			throw new Error(`scene ${prefix}: '${name}' is already declared`);
		}
	};

	const reads: SceneReads = {
		entityId: (name) => {
			const mapping = rows(
				owner.db(),
				"operatorManifestAuthoredEntity",
				"operator_manifest_authored_entity",
			).find((r) => String(r.manifestKey ?? r.manifest_key) === manifestKey(name));
			return mapping === undefined ? null : BigInt(String(mapping.entityId ?? mapping.entity_id));
		},
		nodeId: (place) => {
			if (!places.has(place)) throw new Error(`scene ${prefix}: unknown place '${place}'`);
			return sceneNodeId(prefix, place);
		},
		at: (place) => {
			const node = reads.nodeId(place);
			return rows(owner.db(), "entityLocation", "entity_location")
				.filter((r) => String(r.placeNodeId ?? r.place_node_id) === node)
				.map((r) => BigInt(String(r.entityId ?? r.entity_id)));
		},
		entityIds: () => {
			const ids = new Set<string>();
			for (const r of rows(
				owner.db(),
				"operatorManifestAuthoredEntity",
				"operator_manifest_authored_entity",
			)) {
				if (String(r.manifestKey ?? r.manifest_key).startsWith(`${prefix}:${prefix}/`)) {
					ids.add(String(r.entityId ?? r.entity_id));
				}
			}
			for (const r of rows(owner.db(), "entityLocation", "entity_location")) {
				if (isSceneNode(prefix, String(r.placeNodeId ?? r.place_node_id))) {
					ids.add(String(r.entityId ?? r.entity_id));
				}
			}
			return [...ids].map((id) => BigInt(id));
		},
		nodeOf: (name) => {
			const id = reads.entityId(name);
			if (id === null) return null;
			const hit = rows(owner.db(), "entityLocation", "entity_location").find(
				(r) => String(r.entityId ?? r.entity_id) === String(id),
			);
			return hit === undefined ? null : String(hit.placeNodeId ?? hit.place_node_id);
		},
		state: (name, stateId) => {
			const id = reads.entityId(name);
			if (id === null) return null;
			for (const r of rows(owner.db(), "objectState", "object_state")) {
				if (String(r.targetId ?? r.target_id) !== String(id)) continue;
				if (String(r.stateId ?? r.state_id) !== stateId) continue;
				const value = r.value as { tag?: string; value?: bigint | number } | undefined;
				if (value?.tag === "Int") return Number(value.value);
			}
			return null;
		},
		snapshot: () => {
			const snapshot: SceneSnapshot = new Map();
			for (const id of reads.entityIds()) snapshot.set(String(id), { node: null });
			for (const r of rows(owner.db(), "entityLocation", "entity_location")) {
				const entry = snapshot.get(String(r.entityId ?? r.entity_id));
				if (entry !== undefined) entry.node = String(r.placeNodeId ?? r.place_node_id);
			}
			return snapshot;
		},
	};

	const model = (): SceneModel => ({
		prefix,
		bundleDeps: options.bundleDeps ?? ["core"],
		places: [...places.values()],
		bodies: [...bodies.values()],
	});

	const self: Scene = {
		prefix,
		bundleId: prefix,
		reads,
		owner,
		heroes: () => [...heroes.values()],
		place(name, spec = {}) {
			claim(name);
			places.set(name, {
				name,
				exits: spec.exits ?? [],
				exitBindings: spec.exitBindings ?? {},
			});
			return this;
		},
		npc(name, spec) {
			claim(name);
			bodies.set(name, {
				name,
				kind: "npc",
				at: spec.at,
				def: spec.def ?? GENERIC_DEF,
				actor: spec.actor ?? false,
				capabilities: spec.capabilities ?? [],
			});
			return this;
		},
		hero(name, spec) {
			claim(name);
			bodies.set(name, {
				name,
				kind: "hero",
				at: spec.at,
				def: spec.def ?? GENERIC_DEF,
				actor: true,
				capabilities: spec.capabilities ?? [],
			});
			return this;
		},
		heroOf(name) {
			const hero = heroes.get(name);
			if (hero === undefined) throw new Error(`scene ${prefix}: hero '${name}' is not applied`);
			return hero;
		},
		async apply() {
			const snapshot = model();
			const heroNames = snapshot.bodies.filter((b) => b.kind === "hero").map((b) => b.name);
			// Identities are minted before the apply (the bundle binds them) and
			// outside the queue: connecting is not an apply.
			for (const name of heroNames) {
				if (identities.has(name)) continue;
				identities.set(
					name,
					await connectTestWorld({
						url: world.url,
						db: world.db,
						connectedActorId: `${prefix}/${name}`,
						connectTimeoutMs: options.connectTimeoutMs,
						readerManifests: [
							operatorScopeManifest(`scene:${prefix}:${name}`, ["visible_entity_location"]),
						],
					}),
				);
			}
			const ids = new Map(heroNames.map((n) => [n, identities.get(n)?.identity ?? ""] as const));
			const source = sceneManifestSource(snapshot, ids);
			await serializeApplyPerDb(world, async () => {
				// The apply reducer wants a bound actor with the authored
				// capability even for the DB owner. Bind the owner once; the
				// gatekeeper bundle is shared and idempotent, scene content is not.
				const gate = `${world.url}\u0000${world.db}\u0000${owner.identity}`;
				if (!gatekept.has(gate)) {
					await ensureWorldAuthority(owner, { publisherToken: world.token });
					gatekept.add(gate);
				}
				await applyManifestDelta(owner, source, {
					tolerateAlreadyApplied: true,
					label: `scene ${prefix}`,
				});
			});
			for (const body of snapshot.bodies) {
				await waitForEvent(
					owner,
					() => reads.entityId(body.name) !== null,
					`scene ${prefix}: ${body.kind} '${body.name}' did not appear`,
				);
			}
			for (const name of heroNames) {
				const entityId = reads.entityId(name);
				const conn = identities.get(name);
				if (entityId === null || conn === undefined) continue;
				await waitForEvent(
					owner,
					() => actorIdFor(owner.db(), entityId) !== null,
					`scene ${prefix}: hero '${name}' actor row did not appear`,
				);
				const actorId = actorIdFor(owner.db(), entityId);
				if (actorId === null) continue;
				heroes.set(name, {
					name,
					world: conn,
					identity: conn.identity ?? "",
					entityId,
					actorId,
				});
			}
		},
		waitFor: (predicate, message) => waitForEvent(owner, () => predicate(reads), message),
		async close() {
			for (const conn of identities.values()) conn.disconnect();
			identities.clear();
			owner.disconnect();
		},
	};
	return self;
}

function actorIdFor(db: SnapshotDb, body: bigint): bigint | null {
	for (const r of rows(db, "actor", "actor")) {
		if (String(r.currentBody ?? r.current_body) === String(body)) {
			return BigInt(String(r.actorId ?? r.actor_id));
		}
	}
	return null;
}
