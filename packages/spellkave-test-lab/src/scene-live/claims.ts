/**
 * Shared helpers of the kernel-claim scene tests (neutral mechanics fixtures:
 * threshold progression, priced exchange, budget gate, failure recovery,
 * economy projection, the US9 kit). They move the 8 kernel-claim live tests out
 * of the session package's `fast-lane/` and `us9-act/` directories.
 *
 * What lives here, and why it is not in a test file:
 * - `actingBody` / `manipulate` / `openSession` / `closeSession` dispatch through
 *   the SDK `ActorClient` (the tool surface under test); a test calls them inside
 *   a pattern `act`, so the step is counted and the observers are synced after it.
 * - the readers (`statesOf`, `conditionsOf`, ...) are plain synchronous cache
 *   reads of the hero's own connection; a test calls them after the pattern
 *   returned, which already synced the connection.
 * - the extras builders write the per-scene rows a fixture hard-codes for its
 *   fixed actors (capability niche attachments, object states, identity bindings).
 */

import {
	type ActorClient,
	asEntityRef,
	createActorClient,
	READER_SCOPED_TABLES,
	readEntity,
} from "@spellkave/sdk";
import {
	readInventoryProjection,
	readSelfConditions,
	readSelfEconomyBudget,
	readSelfStates,
} from "@spellkave/sdk/readers";
import { stringify } from "smol-toml";
import {
	actorIdForBody,
	captureTestDriverToken,
	ownerActorIdentities,
	syncConnection,
	type TestWorld,
} from "../live";
import type { Scene, SceneHero } from "../scene";
import { applySceneExtras, entityKey } from "./support";

export type Row = Record<string, unknown>;

/** Rows of one cache table by SDK accessor name (empty when the table is not subscribed). */
export function rowsOf(db: unknown, accessor: string): Row[] {
	const handle = (db as Record<string, { iter(): Iterable<unknown> } | undefined>)[accessor];
	return Array.from(handle?.iter() ?? [], (row) => row as Row);
}

/** A body a test connection controls, with the SDK client that acts as it. */
export interface ActingBody {
	world: TestWorld;
	entityId: bigint;
	/** Entity-id reference string the SDK readers and client take. */
	ref: string;
	client: ActorClient;
	/** The last error `r_manipulate` itself threw (the SDK client reports only "rejected by server"). */
	lastRefusal: string;
}

/** Subscribe the reader tables once, sync, and build the client acting as `entityId`. */
export async function actingBody(world: TestWorld, entityId: bigint): Promise<ActingBody> {
	await world.subscribeReaders([{ requiredTables: READER_SCOPED_TABLES }]);
	await syncConnection(world);
	const ref = String(entityId);
	const body: ActingBody = {
		world,
		entityId,
		ref,
		lastRefusal: "",
		client: createActorClient(world.conn, ref, {
			successOnProvenance: true,
			observationTimeoutMs: 8_000,
			// Harness port of the reducer the client dispatches, as a host supplies it: it attaches the
			// driver token the connection observes (a service-provenance binding, such as a `$sender`
			// delta without `provenance`, acts only with one) and keeps the text of a thrown refusal.
			rManipulate: async (args) => {
				try {
					return await world.conn.reducers.rManipulate({
						...args,
						driverToken: captureTestDriverToken(world, entityId),
					});
				} catch (error) {
					body.lastRefusal = String(error);
					throw error;
				}
			},
		}),
	};
	return body;
}

export const heroBody = (hero: SceneHero): Promise<ActingBody> =>
	actingBody(hero.world, hero.entityId);

export interface ManipulateReceipt {
	status: string;
	failureDetail: string;
	/** The SDK's own reason for a non-success status (empty on success). */
	reason: string;
}

/** One `r_manipulate` through the SDK client. Use inside a pattern `act`. */
export async function manipulate(
	body: ActingBody,
	targetRef: string,
	actionId: string,
	argsJson = "",
): Promise<ManipulateReceipt> {
	const result = await body.client.manipulate(
		targetRef,
		actionId,
		argsJson,
		() => false,
		() => null,
	);
	return {
		status: result.status,
		failureDetail: result.provenance?.failure_detail ?? "",
		reason: "reason" in result ? `${result.reason} ${body.lastRefusal}`.trim() : "",
	};
}

/** `r_release_claim` through the SDK client: let go of the claim the body's last action took on `targetRef`. */
export async function releaseClaim(body: ActingBody, targetRef: string): Promise<string> {
	const result = await body.client.releaseClaim(targetRef);
	return result.status;
}

/** JSON for failure messages (bigint-safe). */
export const show = (value: unknown): string =>
	JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));

/** `entity:<id>` target reference. */
export const entityRef = (id: bigint | string): string => `entity:${id}`;

export interface SessionOpened {
	status: string;
	sessionId: bigint;
}

/**
 * `r_session_open` through the SDK client. The caller must control every participant, or `via`
 * is a connection that may open it for them (the publisher, for cross-identity party setup): the
 * actor is resolved in `body`'s cache, the reducer is dispatched on `via`.
 */
export async function openSession(
	body: ActingBody,
	sessionDefId: string,
	participants: readonly bigint[],
	via?: TestWorld,
): Promise<SessionOpened> {
	const client =
		via === undefined
			? body.client
			: createActorClient(body.world.conn, body.ref, {
					rSessionOpen: (args) => via.conn.reducers.rSessionOpen(args),
				});
	const result = await client.sessionOpen(sessionDefId, participants.join(","));
	return { status: result.status, sessionId: BigInt(result.sessionId ?? 0n) };
}

/** `r_session_close` through the SDK client. */
export async function closeSession(body: ActingBody, sessionId: bigint): Promise<string> {
	const result = await body.client.sessionClose(sessionId, "abandoned");
	return result.status;
}

// --- synchronous reads over the hero's own synced cache ----------------------

export interface StateEntry {
	state_id: string;
	value: string;
}

/** Numeric value of an object_state row's serialised DslValue. */
export function intStateValue(states: readonly StateEntry[], stateId: string): number | null {
	const row = states.find((s) => s.state_id === stateId);
	if (row === undefined) return null;
	try {
		const parsed = JSON.parse(row.value) as unknown;
		if (parsed !== null && typeof parsed === "object") {
			return Number((parsed as Record<string, unknown>).value);
		}
		return Number(parsed);
	} catch {
		return Number(row.value);
	}
}

/** Every state of the body this connection controls. */
export function statesOf(body: ActingBody): StateEntry[] {
	return readSelfStates(body.world.db() as never, asEntityRef(body.ref), {
		limit: 100,
	} as never) as unknown as StateEntry[];
}

export const stateInt = (body: ActingBody, stateId: string): number | null =>
	intStateValue(statesOf(body), stateId);

/** Condition definition ids on the body this connection controls. */
export function conditionsOf(body: ActingBody): string[] {
	return readSelfConditions(body.world.db() as never, asEntityRef(body.ref)).map(
		(c) => c.condition_definition_id,
	);
}

export const hasCondition = (body: ActingBody, conditionId: string): boolean =>
	conditionsOf(body).includes(conditionId);

/** Any entity the connection can see, by id: `{ entity_def_id, kind, quantity }` or null. */
export function entityById(world: TestWorld, entityId: bigint | string) {
	return readEntity(world.db() as never, asEntityRef(String(entityId)));
}

/** What the body carries (its whole containment tree): entity id, def, kind and quantity per item. */
export function inventoryOf(body: ActingBody) {
	return readInventoryProjection(body.world.db() as never, asEntityRef(body.ref))?.items ?? [];
}

/** The body's budget channels (the economy_budget self-state), keyed as the SDK reader projects them. */
export function budgetOf(body: ActingBody) {
	return readSelfEconomyBudget(body.world.db() as never, asEntityRef(body.ref));
}

// --- per-scene extras ---------------------------------------------------------

/**
 * Wait-free settle for rows a delta just added: the apply returned after the seal, so one sync barrier
 * on the owner connection delivers them. Returns the entity ids in `names` order.
 */
export async function authoredIds(s: Scene, names: readonly string[]): Promise<bigint[]> {
	await syncConnection(s.owner);
	return names.map((name) => {
		const id = s.reads.entityId(name);
		if (id === null) throw new Error(`scene ${s.prefix}: '${name}' is not authored`);
		return id;
	});
}

/**
 * Actor row id of a scene body and the identities bound to it. The actor row comes from the owner's
 * synced cache; `actor_identity` is per-identity filtered, so the identities come from the
 * publisher's raw SQL postcondition (committed state, no sync needed).
 */
export async function bindingOf(
	s: Scene,
	name: string,
): Promise<{ actorId: bigint | null; identities: string[] }> {
	const body = s.reads.entityId(name);
	if (body === null) throw new Error(`scene ${s.prefix}: '${name}' is not authored`);
	const actorId = actorIdForBody(s.owner.db(), body);
	if (actorId === null) return { actorId, identities: [] };
	return { actorId, identities: await ownerActorIdentities(actorId) };
}

/** `[[object_state]]` row of a scene entity (integer value). */
export function intStateRow(prefix: string, name: string, stateId: string, value: number): Row {
	return {
		bundle_id: prefix,
		entity_key: entityKey(prefix, name),
		state_id: stateId,
		value_bool: true,
		value_int: value,
		visibility: "Public",
		expires_at_tick: 0,
		source_template_id: "manifest",
	};
}

/** A capability niche attached to one of the scene's places. */
export function nicheRow(s: Scene, place: string, nicheId: string): Row {
	return {
		bundle_id: s.prefix,
		place_node_id: s.reads.nodeId(place),
		niche_id: nicheId,
		condition_bool: true,
		ecological_invariant: false,
		visibility: "Public",
	};
}

/** `$identity`-bound actor row: `entityName` is controlled by the same connection as `hero`. */
export function identityRow(s: Scene, entityName: string, hero: SceneHero): Row {
	return {
		bundle_id: s.prefix,
		entity_key: entityKey(s.prefix, entityName),
		identity: hero.identity,
		role: "primary",
		provenance: "person",
	};
}

/** Apply `tables` (TOML tables keyed by table name) as a delta on the scene bundle. */
export async function applyRows(
	s: Scene,
	tables: Record<string, Row[]>,
	dependsOn: readonly string[] = ["core"],
): Promise<void> {
	await applySceneExtras(s, stringify(tables), dependsOn);
}
