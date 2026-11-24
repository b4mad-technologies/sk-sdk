// Reader: enumerate an actor's own object-state pools, enriched with the
// authored display name + tags from the bundle's resource definitions.
//
// This is the "list my states" read surface (#1229). Before it, an actor could
// only read a pool it already knew the id of (`readObjectStateInt` needs a
// `stateId`), and `readActorSnapshot` returned a bare sheet with no pools at
// all — so authored state (hp, a quest stage) was imperceptible to a curious
// player. Here we enumerate every visible pool the entity carries and left-join:
//   - `resource_definition`     → `display_name`, `value_kind`
//   - `resource_definition_tag` → `tags[]`
// keyed on `state_id == resource_definition_id`.
//
// Content-neutrality (ADR-0021, and the same posture the rest of this package
// holds — see `object_state.ts`): the reader forwards whatever tags the bundle
// authored (`quest`, `currency`, a modder's `faction`) verbatim. It does NOT
// mint a `quest` → "objective" classification — the consumer (companion tool,
// player UI, playtest scorer) interprets a tag's meaning. Surfacing the tag IS
// the fix; the interpretation is presentation.

import type {
	ObjectStateRow,
	ResourceDefinitionRow,
	ResourceDefinitionTagRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asNumber, asString, resolveEntityId, rows } from "./_helpers";

export const requiredTables: RequiredTables<
	[
		"owned_object_state",
		"resource_definition",
		"resource_definition_tag",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
	]
> = [
	"owned_object_state",
	"resource_definition",
	"resource_definition_tag",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
];
registerReaderManifest({ requiredTables });

export interface ActorStateEntry {
	/** Pool id, e.g. `srd/hp` or `phandelver/escort_stage`. */
	state_id: string;
	/** Authored label from `resource_definition`; falls back to `state_id`. */
	display_name: string;
	/** Optional authored resource prose; absent when no description was supplied. */
	description?: string;
	/** Authored kind (`int`, `bool`, …) from `resource_definition`; `""` if unknown. */
	value_kind: string;
	/** Parsed integer value when the pool holds an int; `null` otherwise. */
	value_int: number | null;
	/** Human-readable rendering of the pool value (always present). */
	value: string;
	/** Authored tags (sorted), e.g. `["quest"]`. A consumer decides what they mean. */
	tags: string[];
}

export interface ReadActorStatesOptions {
	/**
	 * Cap on returned rows, keeping the most-recently-written ones
	 * (`set_at_tick` desc, row-insertion-order tiebreak) when there are more
	 * matches than the cap. `undefined` or `0` = unbounded (today's full-dump
	 * behavior) — existing callers that pass no options see NO change
	 * (#1839: the companion tool layer, not this reader, owns the default
	 * bounded view; other SDK consumers — web panels, srd-runner proofs —
	 * still need the complete list).
	 */
	limit?: number;
	/** Optional filter: only states whose state_id starts with this prefix. */
	statePrefix?: string;
	/** Optional filter: only states carrying this exact author-defined resource tag. */
	stateTag?: string;
}

/**
 * All object-state pools visible on one actor's entity, enriched and sorted by
 * `state_id`. Returns `[]` when the actor id does not resolve to an entity.
 */
export function readActorStates(
	db: SnapshotDb,
	actorId: EntityRef,
	opts: ReadActorStatesOptions = {},
): ActorStateEntry[] {
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return [];
	const targetId = String(entityId);

	const definitions = new Map<string, ResourceDefinitionRow>();
	for (const def of rows<ResourceDefinitionRow>(db, "resource_definition")) {
		definitions.set(asString(def.resourceDefinitionId), def);
	}

	const tagsByState = new Map<string, string[]>();
	for (const row of rows<ResourceDefinitionTagRow>(db, "resource_definition_tag")) {
		const key = asString(row.resourceDefinitionId);
		const list = tagsByState.get(key) ?? [];
		list.push(asString(row.tag));
		tagsByState.set(key, list);
	}

	let matched = rows<ObjectStateRow>(db, "owned_object_state").filter(
		(row) => asString(row.targetKind) === "entity" && String(row.targetId) === targetId,
	);
	matched = matched.filter(
		(row) =>
			(!opts.statePrefix || asString(row.stateId).startsWith(opts.statePrefix)) &&
			(!opts.stateTag || (tagsByState.get(asString(row.stateId)) ?? []).includes(opts.stateTag)),
	);
	if (opts.limit && opts.limit > 0 && matched.length > opts.limit) {
		matched = matched
			.slice()
			.sort((a, b) => {
				const tickDiff = asNumber(b.setAtTick) - asNumber(a.setAtTick);
				return tickDiff !== 0 ? tickDiff : asString(b.key).localeCompare(asString(a.key));
			})
			.slice(0, opts.limit);
	}

	return matched
		.map((row) => {
			const stateId = asString(row.stateId);
			const def = definitions.get(stateId);
			const intValue = dslIntValue(row.value);
			const tags = (tagsByState.get(stateId) ?? []).slice().sort();
			return {
				state_id: stateId,
				display_name: def ? asString(def.displayName) : stateId,
				...(def && asString(def.description) ? { description: asString(def.description) } : {}),
				value_kind: def ? asString(def.valueKind) : "",
				value_int: intValue === null ? null : Number(intValue),
				value: intValue === null ? stringifyValue(row.value) : String(intValue),
				tags,
			};
		})
		.sort((a, b) => (a.state_id < b.state_id ? -1 : a.state_id > b.state_id ? 1 : 0));
}

function dslIntValue(value: unknown): bigint | null {
	if (typeof value === "bigint") return value;
	if (typeof value === "number") return BigInt(value);
	if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
	if (!value || typeof value !== "object") return null;

	const record = value as Record<string, unknown>;
	if (asString(record.tag) === "Int") return dslIntValue(record.value);
	if ("Int" in record) return dslIntValue(record.Int);
	return null;
}

function stringifyValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value !== "object") return String(value);
	return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}
