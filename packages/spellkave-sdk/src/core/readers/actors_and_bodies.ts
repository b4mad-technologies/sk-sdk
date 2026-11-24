import type {
	VisibleActorIdentityRow as DbActorIdentityRow,
	ActorRow as DbActorRow,
	EntityRow as DbEntityRow,
	ObjectStateRow as DbObjectStateRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { type ActorId, asActorId, asEntityId, type EntityId, type EntityRef } from "../ids";
import {
	asNumber,
	asString,
	optNumber,
	optString,
	resolveEntityId,
	rows,
	tagString,
} from "./_helpers";

// visible_manifest_authored_entity backs resolveEntityId (manifest-key refs). #504 L1.
// `actor_identity` is private (#915 PR-5); `visible_actor_identity` is its
// self-only view (ADR-0084 D-5 Family 1 shape) — see `readActorIdentityBindings`.
export const requiredTables: RequiredTables<
	[
		"actor",
		"visible_actor_identity",
		"entity",
		"visible_object_state",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
	]
> = [
	"actor",
	"visible_actor_identity",
	"entity",
	"visible_object_state",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
];
registerReaderManifest({ requiredTables });

/** BSATN option<ConnectionId> → lowercase hex string, or null when unbound (durable seat). */
function connectionIdHex(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	const some =
		typeof value === "object" && "some" in (value as object)
			? (value as { some?: unknown }).some
			: value;
	if (some === undefined || some === null) return null;
	const hex = (some as { toHexString?: () => string }).toHexString;
	if (typeof hex === "function") return hex.call(some);
	const s = String(some);
	return s.length > 0 && s !== "[object Object]" ? s : null;
}

export interface ActorPrincipalRow {
	actor_id: ActorId;
	name: string;
	current_body: EntityId;
	created_at_tick: number;
}

export interface ActorIdentityBindingRow {
	/** ADR-0146 storage key: `[actor_id, identity hex]`. */
	key: string;
	actor_id: ActorId;
	identity: string;
	role: string;
	provenance: string;
	assigned_by?: number;
	bound_at_tick: number;
	/** Null when the binding is durable (trusted IdP or trusted-authorship). */
	connection_id: string | null;
}

export interface EntityBodyRow {
	entity_id: EntityId;
	entity_def_id: string;
	name: string;
	kind: string;
	quantity: number;
	owned_by_entity_id: string;
	created_at_tick: number;
}

export interface EntityObjectStateRow {
	/** ADR-0146 storage key: `[target_kind, target_id, state_id]`. */
	key: string;
	target_id: string;
	state_id: string;
	value: string;
	source_template_id: string;
	set_at_tick: number;
	expires_at_tick: number;
	bundle_id: string;
}

/** Schema pair (`Actor.actor_id` / `Actor.current_body`). */
export function readActorPrincipals(db: SnapshotDb): ActorPrincipalRow[] {
	return rows<DbActorRow>(db, "actor").map((row) => ({
		actor_id: asActorId(String(row.actorId)),
		name: asString(row.name),
		current_body: asEntityId(String(row.currentBody)),
		created_at_tick: asNumber(row.createdAtTick),
	}));
}

/**
 * `actor_identity` is private (#915 PR-5 — every login Identity + role
 * binding is deanonymization-grade metadata: who controls which character,
 * who holds a high-trust seat like the DM). This reads the self-only
 * `visible_actor_identity` view (ADR-0084 D-5 Family 1 shape: extent never
 * widens the root set — a DM's class×extent elevation covers world/sheet
 * state, not player login identities), so it now returns only the
 * CALLER'S OWN bindings, never another identity's.
 *
 * This reader returns steering principals (`Actor.actor_id`); neighbouring
 * `readEntityBody` takes an entity ref.
 */
export function readActorIdentityBindings(db: SnapshotDb): ActorIdentityBindingRow[] {
	return rows<DbActorIdentityRow>(db, "visible_actor_identity").map((row) => ({
		key: asString(row.key),
		actor_id: asActorId(String(row.actorId)),
		identity: asString(row.identity),
		role: asString(row.role),
		provenance: tagString(row.provenance).toLowerCase(),
		assigned_by: optNumber(row.assignedBy),
		bound_at_tick: asNumber(row.boundAtTick),
		connection_id: connectionIdHex(row.connectionId),
	}));
}

export function readEntityBody(db: SnapshotDb, entityId: EntityRef): EntityBodyRow | null {
	const id = resolveEntityId(db, entityId);
	if (id === undefined) return null;
	const row = rows<DbEntityRow>(db, "entity").find((candidate) => candidate.entityId === id);
	if (!row) return null;
	return {
		entity_id: asEntityId(String(row.entityId)),
		entity_def_id: asString(row.entityDefId),
		name: asString(row.name),
		kind: asString(row.kind),
		quantity: asNumber(row.quantity),
		owned_by_entity_id: String(row.ownedByEntityId),
		created_at_tick: asNumber(row.createdAtTick),
	};
}

export function readObjectStatesForEntity(
	db: SnapshotDb,
	entityId: EntityRef,
): EntityObjectStateRow[] {
	// Resolve to the numeric targetId form first, else the string compare below
	// silently matches nothing for a manifest key (quiet sibling of BigInt throw).
	const resolved = resolveEntityId(db, entityId);
	if (resolved === undefined) return [];
	const targetId = String(resolved);
	return rows<DbObjectStateRow>(db, "visible_object_state")
		.filter((row) => asString(row.targetKind) === "entity" && asString(row.targetId) === targetId)
		.map((row) => ({
			key: asString(row.key),
			target_id: asString(row.targetId),
			state_id: asString(row.stateId),
			value: stringifyValue(row.value),
			source_template_id: asString(row.sourceTemplateId),
			set_at_tick: asNumber(row.setAtTick),
			expires_at_tick: asNumber(row.expiresAtTick),
			bundle_id: asString(row.bundleId),
		}));
}

function stringifyValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value !== "object") return String(value);
	return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}
