// Client-side rain-radar buffer over an already-authorized SnapshotDb.
//
// Bootstrap from the live subscription at connect time (now). Fold later
// onUpdate snapshots into a bounded tick-indexed ring. Pause/scrub/play
// only move a VIEW cursor — the world keeps ticking. Reconnect discards.
//
// Pattern (TTL cap, rebuild from current perception, no history hydrate)
// matches npc-brains combat-picture / perceived-map, but this module reads
// visible_* tables for an observer/DM see-as grant. Do not import
// @spellkave/npc-brains.

import type { VisibleCapabilityRow } from "./binding_rows";
import {
	asString,
	buildEntityDescriptionMap,
	buildEntityFactionMap,
	buildEntityNameMap,
	buildEntitySummaryMap,
	optNumber,
	rows,
	tagString,
} from "./core/readers/_helpers";
import { buildEntityConditionsMap } from "./core/readers/actor_snapshot";
import { readActorIdentityBindings, readActorPrincipals } from "./core/readers/actors_and_bodies";
import {
	buildPublicArtIndex,
	type EntityArt,
	lookupPublicEntityArt,
} from "./core/readers/entity_art";
import { readEntityIntStates } from "./core/readers/object_state";
import { readRecentEvents } from "./core/readers/world_events";
import { readWorldStatus } from "./core/readers/world_status";
import type { SnapshotDb } from "./replay";

/** Forget frames older than this many ticks. Same order as combat-picture TTL. */
export const WATCH_BUFFER_CAP = 600;

/**
 * Tables a maps/observer connection must subscribe in addition to seat
 * catalogs. Union with CONNECTION_BASELINE at connect(); never include
 * FILTERED_SUBSCRIPTION_TABLES.
 */
export const WATCH_BUFFER_REQUIRED_TABLES = [
	"visible_actor_spatial_location",
	"actor",
	"visible_actor_identity",
	"entity",
	"visible_entity_tag",
	"visible_entity_tag_coverage",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"visible_object_state",
	"visible_target_condition",
	"visible_world_event",
	"visible_capability",
	"resource_definition",
	"visible_entity_containment",
	"visible_entity_equipment_slot",
	"visible_entity_location",
	"public_metadata_attachment",
	"visible_metadata_attachment",
	"entity_description",
] as const;

export interface WatchActorState {
	state_id: string;
	display_name: string;
	value: string;
}

export interface WatchActorCondition {
	id: string;
	stack_count: number;
}

export interface WatchActor {
	entityId: string;
	actorId: string | null;
	name: string;
	placeNodeId: string;
	faction: string | null;
	description: string | null;
	conditions: WatchActorCondition[];
	states: WatchActorState[];
	/** Public subject art (ADR-0073 <bundle>.art.image), when authored. */
	art: EntityArt | null;
}

export interface WatchEvent {
	id: string;
	tick: number;
	kind: string;
	summary?: string;
}

export interface WatchItem {
	entityId: string;
	name: string;
	placeNodeId: string;
	holderEntityId: string | null;
	holderName: string | null;
	/** Containment slot ("" = loose carriage; e.g. "core/main_hand" when
	 * equipped). Leaf-humanized by callers for display — the readable
	 * equipment_slot label lives in a table the watch buffer does not
	 * subscribe (sk-jay0.4.4.3). */
	slotId: string;
	/** entity_description text for this item, when authored (sk-jay0.4.4.5). */
	description: string | null;
	/** Int object states for this item (same shape as WatchActor.states). */
	states: WatchActorState[];
	/** Instance entity_tag list (author-facing, small). */
	tags: string[];
	/** Public subject art (ADR-0073), instance or definition fallback. */
	art: EntityArt | null;
}

export interface WatchFrame {
	tick: number;
	actors: WatchActor[];
	events: WatchEvent[];
	items: WatchItem[];
}

export type WatchCursor = { kind: "live" } | { kind: "paused"; tick: number };

export function readWatchTick(db: SnapshotDb): number {
	return readWorldStatus(db)?.tick ?? 0;
}

function isItemKind(kind: string): boolean {
	const k = kind.toLowerCase();
	return k === "item" || k.endsWith(".item");
}

/** Current bodies of the self-only identity bindings, including role presences.
 * Requires actor + visible_actor_identity in this caller's subscription. */
export function readWatchOwnBodies(db: SnapshotDb): string[] {
	const actors = new Set(readActorIdentityBindings(db).map((row) => String(row.actor_id)));
	return readActorPrincipals(db)
		.filter((row) => actors.has(String(row.actor_id)) && String(row.current_body) !== "0")
		.map((row) => String(row.current_body));
}

/** Live oversight on the caller's own bodies. Scalar depth remains a migration bridge. */
export function hasOversightGrant(db: SnapshotDb, ownBodies: readonly string[] = []): boolean {
	const own = new Set(ownBodies);
	const now = readWorldStatus(db)?.tick;
	for (const row of rows<VisibleCapabilityRow>(db, "visible_capability")) {
		if (!own.has(String(row.entityId))) continue;
		const expires = optNumber(row.expiresAtTick);
		if (expires !== undefined && (now === undefined || expires <= now)) continue;
		const extent = asString(row.extentRef);
		const elevation = tagString(row.elevationClass).toLowerCase();
		if (
			extent !== "" &&
			(row.capabilityId === "frontier.read_internal" || elevation === "internal")
		)
			return true;
	}
	return false;
}

export function watchOverlayAdmitted(db: SnapshotDb, ownBodies: readonly string[] = []): boolean {
	return hasOversightGrant(db, ownBodies);
}

export function projectWatchFrame(db: SnapshotDb, tick: number): WatchFrame {
	const names = buildEntityNameMap(db);
	const descriptions = buildEntityDescriptionMap(db);
	const factions = buildEntityFactionMap(db);
	const conditions = buildEntityConditionsMap(db);
	const bodyToActor = new Map<string, string>();
	for (const principal of readActorPrincipals(db)) {
		bodyToActor.set(String(principal.current_body), String(principal.actor_id));
	}

	const summaries = buildEntitySummaryMap(db);
	// One art index per projection; per-entity lookups hit the cache.
	const artIndex = buildPublicArtIndex(db);

	const actors: WatchActor[] = [];
	const seen = new Set<string>();
	for (const row of rows<Record<string, unknown>>(db, "visible_actor_spatial_location")) {
		const entityId =
			row.entityId !== undefined && row.entityId !== null
				? String(row.entityId)
				: row.entity_id !== undefined && row.entity_id !== null
					? String(row.entity_id)
					: "";
		if (entityId === "" || seen.has(entityId)) continue;
		const placeNodeId =
			row.placeNodeId !== undefined && row.placeNodeId !== null
				? String(row.placeNodeId)
				: row.place_node_id !== undefined && row.place_node_id !== null
					? String(row.place_node_id)
					: "";
		if (placeNodeId === "") continue;
		seen.add(entityId);
		const actorConditions = (conditions.get(entityId) ?? []).map((c) => ({
			id: c.condition_definition_id,
			stack_count: c.stack_count,
		}));
		const states = readEntityIntStates(db, entityId).map((s) => ({
			state_id: s.stateId,
			display_name: s.stateId,
			value: String(s.value),
		}));
		actors.push({
			entityId,
			actorId: bodyToActor.get(entityId) ?? null,
			name: names.get(entityId) ?? entityId,
			placeNodeId,
			faction: factions.get(entityId) ?? null,
			description: descriptions.get(entityId) || null,
			conditions: actorConditions,
			states,
			art:
				lookupPublicEntityArt(artIndex, entityId, summaries.get(entityId)?.entity_def_id ?? "") ??
				null,
		});
	}
	actors.sort((a, b) => a.entityId.localeCompare(b.entityId));

	// Per-entity tags (author-facing) — one pass, reused by both item loops.
	const tagsByEntity = new Map<string, string[]>();
	for (const row of rows<Record<string, unknown>>(db, "visible_entity_tag")) {
		const entityId =
			row.entityId !== undefined && row.entityId !== null
				? String(row.entityId)
				: row.entity_id !== undefined && row.entity_id !== null
					? String(row.entity_id)
					: "";
		const tag = row.tag !== undefined && row.tag !== null ? String(row.tag) : "";
		if (entityId === "" || tag === "") continue;
		const list = tagsByEntity.get(entityId) ?? [];
		list.push(tag);
		tagsByEntity.set(entityId, list);
	}
	// Equipped items live in their own table (entity_equipment_slot: wearer
	// entity_id + slot_id + equipped_entity_id), not in containment slot_id
	// (machine ports only). Keyed by the EQUIPPED item so the items loop can
	// override loose carriage (sk-jay0.4.4.3).
	const equippedSlot = new Map<string, string>();
	for (const row of rows<Record<string, unknown>>(db, "visible_entity_equipment_slot")) {
		const equippedEntityId =
			row.equippedEntityId !== undefined && row.equippedEntityId !== null
				? String(row.equippedEntityId)
				: row.equipped_entity_id !== undefined && row.equipped_entity_id !== null
					? String(row.equipped_entity_id)
					: "";
		const slot =
			row.slotId !== undefined && row.slotId !== null
				? String(row.slotId)
				: row.slot_id !== undefined && row.slot_id !== null
					? String(row.slot_id)
					: "";
		if (equippedEntityId !== "" && slot !== "") equippedSlot.set(equippedEntityId, slot);
	}
	const actorPlace = new Map<string, string>();
	for (const actor of actors) actorPlace.set(actor.entityId, actor.placeNodeId);
	const groundPlace = new Map<string, string>();
	for (const row of rows<Record<string, unknown>>(db, "visible_entity_location")) {
		const entityId =
			row.entityId !== undefined && row.entityId !== null
				? String(row.entityId)
				: row.entity_id !== undefined && row.entity_id !== null
					? String(row.entity_id)
					: "";
		const placeNodeId =
			row.placeNodeId !== undefined && row.placeNodeId !== null
				? String(row.placeNodeId)
				: row.place_node_id !== undefined && row.place_node_id !== null
					? String(row.place_node_id)
					: "";
		if (entityId !== "" && placeNodeId !== "") groundPlace.set(entityId, placeNodeId);
	}
	const items: WatchItem[] = [];
	const seenItem = new Set<string>();
	for (const row of rows<Record<string, unknown>>(db, "visible_entity_containment")) {
		const entityId =
			row.entityId !== undefined && row.entityId !== null
				? String(row.entityId)
				: row.entity_id !== undefined && row.entity_id !== null
					? String(row.entity_id)
					: "";
		const containerId =
			row.containerId !== undefined && row.containerId !== null
				? String(row.containerId)
				: row.container_id !== undefined && row.container_id !== null
					? String(row.container_id)
					: "";
		const slotId =
			row.slotId !== undefined && row.slotId !== null
				? String(row.slotId)
				: row.slot_id !== undefined && row.slot_id !== null
					? String(row.slot_id)
					: "";
		if (entityId === "" || seenItem.has(entityId)) continue;
		const summary = summaries.get(entityId);
		if (summary === undefined || !isItemKind(summary.kind)) continue;
		const placeNodeId =
			actorPlace.get(containerId) ??
			groundPlace.get(containerId) ??
			groundPlace.get(entityId) ??
			"";
		if (placeNodeId === "") continue;
		seenItem.add(entityId);
		const holder = summaries.get(containerId);
		items.push({
			entityId,
			name: summary.name || entityId,
			placeNodeId,
			holderEntityId: containerId,
			holderName: holder?.name ?? containerId,
			slotId: equippedSlot.get(entityId) ?? slotId,
			description: descriptions.get(entityId) || null,
			states: readEntityIntStates(db, entityId).map((s) => ({
				state_id: s.stateId,
				display_name: s.stateId,
				value: String(s.value),
			})),
			tags: tagsByEntity.get(entityId) ?? [],
			art:
				lookupPublicEntityArt(artIndex, entityId, summaries.get(entityId)?.entity_def_id ?? "") ??
				null,
		});
	}
	for (const [entityId, placeNodeId] of groundPlace) {
		if (seenItem.has(entityId)) continue;
		const summary = summaries.get(entityId);
		if (summary === undefined || !isItemKind(summary.kind)) continue;
		seenItem.add(entityId);
		items.push({
			entityId,
			name: summary.name || entityId,
			placeNodeId,
			holderEntityId: null,
			holderName: null,
			slotId: "",
			description: descriptions.get(entityId) || null,
			states: readEntityIntStates(db, entityId).map((s) => ({
				state_id: s.stateId,
				display_name: s.stateId,
				value: String(s.value),
			})),
			tags: tagsByEntity.get(entityId) ?? [],
			art:
				lookupPublicEntityArt(artIndex, entityId, summaries.get(entityId)?.entity_def_id ?? "") ??
				null,
		});
	}
	items.sort((a, b) => a.entityId.localeCompare(b.entityId));

	const events: WatchEvent[] = readRecentEvents(db, 64)
		.filter((event) => event.tick === tick)
		.map((event) => {
			const out: WatchEvent = { id: event.id, tick: event.tick, kind: event.kind };
			if (event.summary !== undefined) out.summary = event.summary;
			return out;
		});

	return { tick, actors, events, items };
}

export class WatchBuffer {
	private readonly cap: number;
	private readonly frames: WatchFrame[] = [];
	private mode: WatchCursor = { kind: "live" };

	constructor(cap = WATCH_BUFFER_CAP) {
		this.cap = Math.max(1, cap);
	}

	bootstrap(db: SnapshotDb, tick = readWatchTick(db)): WatchFrame {
		this.frames.length = 0;
		this.mode = { kind: "live" };
		const frame = projectWatchFrame(db, tick);
		this.frames.push(frame);
		return frame;
	}

	observe(db: SnapshotDb, tick = readWatchTick(db)): WatchFrame {
		const frame = projectWatchFrame(db, tick);
		const last = this.frames[this.frames.length - 1];
		if (last !== undefined && last.tick === tick) {
			this.frames[this.frames.length - 1] = frame;
		} else {
			this.frames.push(frame);
			while (this.frames.length > this.cap) this.frames.shift();
		}
		return frame;
	}

	pause(): void {
		const tick = this.latestTick();
		if (tick === null) return;
		this.mode = { kind: "paused", tick };
	}

	play(): void {
		this.mode = { kind: "live" };
	}

	scrub(tick: number): void {
		const latest = this.latestTick();
		const oldest = this.oldestTick();
		if (latest === null || oldest === null) return;
		const clamped = Math.min(latest, Math.max(oldest, tick));
		this.mode = { kind: "paused", tick: clamped };
	}

	cursor(): WatchCursor {
		return this.mode;
	}

	latestTick(): number | null {
		return this.frames[this.frames.length - 1]?.tick ?? null;
	}

	oldestTick(): number | null {
		return this.frames[0]?.tick ?? null;
	}

	frameAtCursor(): WatchFrame | null {
		if (this.frames.length === 0) return null;
		if (this.mode.kind === "live") return this.frames[this.frames.length - 1] ?? null;
		return this.frameAt(this.mode.tick);
	}

	frameAt(tick: number): WatchFrame | null {
		let found: WatchFrame | null = null;
		for (const frame of this.frames) {
			if (frame.tick <= tick) found = frame;
			if (frame.tick === tick) return frame;
		}
		return found;
	}
}
