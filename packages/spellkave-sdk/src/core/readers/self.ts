import type {
	ActorSpatialLocationRow,
	ConditionDefinitionDescriptionRow,
	ObjectStateRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asString, resolveEntityId, rows, tagString } from "./_helpers";
import { type ActorConditionRow, type ActorSnapshot, readActorSnapshot } from "./actor_snapshot";
import { type ActorStateEntry, type ReadActorStatesOptions, readActorStates } from "./actor_states";
import { readActorIdentityBindings, readActorPrincipals } from "./actors_and_bodies";
import type { BoundedCollection } from "./bounded_collection";
import { boundedCollection } from "./bounded_collection";
import { readSurfaceMembership, type SurfaceMembership } from "./surface_membership";

// `metadata_attachment` backs `readSurfaceMembership`'s `ui.self_summary`
// join (#2119): author-driven `vitals`/`quest` bucket membership, replacing
// the old literal `"core"`/`"quest"` tag filters. The ENRICHED identity facets
// (tag + catalog prefix + description) live on `self_identity.ts`'s
// `readSelfIdentity` (#2119 follow-up, 2026-08-03). That change had also
// stripped identity from the recurring glance entirely, on the reasoning that
// static entity-definition data belongs at session start — but live play
// (sk-0m4.120.34) showed players never made the extra call and could not tell
// their own class/species/background. The player-tool `self_summary` therefore
// re-surfaces the authored facets COMPACTLY (tag + catalog prefix, no
// description, no minted field names) on the glance — the verbose per-facet
// prose stays here at `self_states kind=identity`, both because it is #2119's
// no-prose-on-the-glance intent and because carrying it forced so tight a bound
// that the alphabetical facet sort dropped species. This SDK reader stays
// content-neutral and identity-free — composition is the tool's job (§6).
//
// Appearance / backstory (sk-609b.19) are hero-owned Text object_state rows
// from character creation — always present on the glance as empty string
// when unset (same "" shape as scene_detail description).
const APPEARANCE_STATE_ID = "srd/appearance";
const BACKSTORY_STATE_ID = "srd/backstory";

export const requiredTables: RequiredTables<
	[
		"public_metadata_attachment",
		"visible_metadata_attachment",
		"owned_object_state",
		"actor",
		"visible_actor_identity",
		"directly_controlled_actor_spatial_location",
		"condition_definition",
	]
> = [
	"public_metadata_attachment",
	"visible_metadata_attachment",
	"owned_object_state",
	"actor",
	"visible_actor_identity",
	"directly_controlled_actor_spatial_location",
	"condition_definition",
];
registerReaderManifest({ requiredTables });

/** ADR-0073 namespace for PLAYER self-summary bucket membership — audience
 * `public`, one namespace per player surface (#2119). */
const SELF_SUMMARY_NAMESPACE = "ui.self_summary";
const RESOURCE_DEFINITION_TARGET_KIND = "resource_definition";

export interface CompactSelfState {
	state_id: string;
	display_name: string;
	value: string;
}

export interface CompactSelfCondition {
	condition_definition_id: string;
	stack_count: number;
	expires_at_tick?: number;
}

export interface SelfSummaryProjection {
	actor_id: EntityRef;
	entity_name: string;
	current_node_id?: string;
	state_count: number;
	/** Public appearance prose (`srd/appearance`); `""` when unset. */
	appearance: string;
	/** Hidden backstory prose (`srd/backstory`) — owner and DM-extent readers; `""` when unset. */
	backstory: string;
	conditions: BoundedCollection<CompactSelfCondition>;
	/** States the bundle authored into the `vitals` slot of `ui.self_summary`
	 * (e.g. HP, AC, level), ordered by authored `order` then `state_id`
	 * (#2119). Author-driven — no server-side vocabulary. */
	vitals: BoundedCollection<CompactSelfState>;
	/** States the bundle authored into the `quest` slot of `ui.self_summary`.
	 * Empty when a bundle has no quest-tracking states — that is correct, not
	 * a gap (#2119). */
	quest: BoundedCollection<CompactSelfState>;
}

function compact(state: ActorStateEntry): CompactSelfState {
	return { state_id: state.state_id, display_name: state.display_name, value: state.value };
}

/** States whose `state_id` is a member of `slot` in `membership`, ordered by
 * the authored `order` then `state_id` (#2119 dedupe/tie rule — membership
 * itself already resolved a `state_id` claimed by two bundles to the lowest
 * `order`, `readSurfaceMembership`'s job; this is the final display order). */
function bucketStates(
	states: ActorStateEntry[],
	membership: Map<string, SurfaceMembership>,
	slot: string,
): ActorStateEntry[] {
	return states
		.map((state) => ({ state, entry: membership.get(state.state_id) }))
		.filter(
			(row): row is { state: ActorStateEntry; entry: SurfaceMembership } =>
				row.entry !== undefined && row.entry.slot === slot,
		)
		.sort((a, b) => {
			if (a.entry.order !== b.entry.order) return a.entry.order - b.entry.order;
			return a.state.state_id < b.state.state_id ? -1 : a.state.state_id > b.state.state_id ? 1 : 0;
		})
		.map((row) => row.state);
}

/** Exported for `self_capabilities.ts`, the second consumer of this same
 * entity-resolution + directly-controlled-body gate. */
export function isDirectlyControlled(db: SnapshotDb, actorId: EntityRef): boolean {
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return false;
	if (
		rows<ActorSpatialLocationRow>(db, "directly_controlled_actor_spatial_location").some(
			(row) => String(row.entityId) === String(entityId),
		)
	)
		return true;
	const ownedActorIds = new Set(
		readActorIdentityBindings(db)
			.filter((row) => row.role !== "co-pilot")
			.map((row) => row.actor_id),
	);
	return readActorPrincipals(db).some(
		(actor) => ownedActorIds.has(actor.actor_id) && String(actor.current_body) === String(entityId),
	);
}

function dslTextValue(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (tagString(record.tag) === "Text") {
		const inner = record.value;
		return inner === undefined || inner === null ? "" : String(inner);
	}
	if ("Text" in record) {
		const inner = record.Text;
		return inner === undefined || inner === null ? "" : String(inner);
	}
	return null;
}

function readOwnedTextState(db: SnapshotDb, entityId: string, stateId: string): string {
	for (const row of rows<ObjectStateRow>(db, "owned_object_state")) {
		if (asString(row.stateId) !== stateId) continue;
		const targetKind = tagString(row.targetKind);
		if (targetKind !== "entity" && targetKind !== "Entity") continue;
		if (String(row.targetId) !== entityId) continue;
		const text = dslTextValue(row.value);
		if (text !== null) return text;
	}
	return "";
}

/** Compact directly-owned body sheet. Tag interpretation is presentation-only. */
export function readSelfSummary(db: SnapshotDb, actorId: EntityRef): SelfSummaryProjection | null {
	if (!isDirectlyControlled(db, actorId)) return null;
	const snapshot: ActorSnapshot | null = readActorSnapshot(db, actorId);
	if (snapshot === null) return null;
	const entityId = resolveEntityId(db, actorId);
	const entityKey = entityId === undefined ? "" : String(entityId);
	const membership = readSurfaceMembership(
		db,
		SELF_SUMMARY_NAMESPACE,
		RESOURCE_DEFINITION_TARGET_KIND,
	);
	const vitalsStates = bucketStates(snapshot.states, membership, "vitals");
	const questStates = bucketStates(snapshot.states, membership, "quest");
	const conditions = snapshot.conditions.map((condition) => ({
		condition_definition_id: condition.condition_definition_id,
		stack_count: condition.stack_count,
		...(condition.expires_at_tick === undefined
			? {}
			: { expires_at_tick: condition.expires_at_tick }),
	}));
	const out: SelfSummaryProjection = {
		actor_id: actorId,
		entity_name: snapshot.entity_name,
		state_count: snapshot.states.length,
		appearance: entityKey === "" ? "" : readOwnedTextState(db, entityKey, APPEARANCE_STATE_ID),
		backstory: entityKey === "" ? "" : readOwnedTextState(db, entityKey, BACKSTORY_STATE_ID),
		conditions: boundedCollection(conditions, {
			tool: "spellkave_self_states",
			args: { kind: "condition" },
		}),
		vitals: boundedCollection(vitalsStates.map(compact), {
			tool: "spellkave_self_states",
			args: { kind: "state" },
		}),
		quest: boundedCollection(questStates.map(compact), {
			tool: "spellkave_self_states",
			args: { kind: "state" },
		}),
	};
	if (snapshot.current_node_id !== undefined) out.current_node_id = snapshot.current_node_id;
	return out;
}

/** Full authorized self-condition projection in stable domain order. */
export function readSelfConditions(
	db: SnapshotDb,
	actorId: EntityRef,
): Array<ActorConditionRow & { description?: string }> {
	if (!isDirectlyControlled(db, actorId)) return [];
	const conditions = readActorSnapshot(db, actorId)?.conditions ?? [];
	const descriptions = new Map(
		rows<ConditionDefinitionDescriptionRow>(db, "condition_definition_description").map((row) => [
			row.conditionDefinitionId,
			asString(row.description),
		]),
	);
	return conditions.map((condition) => {
		const description = descriptions.get(condition.condition_definition_id);
		return description?.trim() ? { ...condition, description } : condition;
	});
}

/** Full authorized self-state projection; callers apply shared pagination. */
export function readSelfStates(
	db: SnapshotDb,
	actorId: EntityRef,
	options: ReadActorStatesOptions = {},
): ActorStateEntry[] {
	if (!isDirectlyControlled(db, actorId)) return [];
	return readActorStates(db, actorId, options);
}
