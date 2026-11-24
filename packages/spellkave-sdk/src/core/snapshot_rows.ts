// Camel/snake-tolerant raw-row helpers over a `SnapshotDb`, plus the two
// content-free reads built on them (dead entity ids, entity-key resolution).
//
// This module knows NO bundle or condition id: a caller that needs "the dead
// condition" passes its id in. The sdk stays id-free.

import type { SnapshotDb } from "../reader-manifest";
import type { EntityRef } from "./ids";
import { asEntityRef } from "./ids";
import { resolveEntityId } from "./readers/_helpers";

/** Rows of the FIRST table handle that exists on `db` under any of `names`
 * (the generated accessors are camelCase, fixtures and some raw handles are
 * snake_case). Empty when none exists. For private tables callers MUST list the
 * visible view first: `--include-private` leaves an unsubscribed empty raw
 * handle that would shadow it. */
export function tableRows(db: SnapshotDb, ...names: string[]): Iterable<unknown> {
	const record = db as unknown as Record<string, unknown>;
	for (const name of names) {
		const handle = record[name];
		if (handle && typeof handle === "object" && "iter" in handle) {
			return (handle as { iter(): Iterable<unknown> }).iter();
		}
	}
	return [];
}

/** The first non-null, non-empty value among `names` on `row`, stringified;
 * `""` when none. */
export function fieldOf(row: Record<string, unknown>, ...names: string[]): string {
	for (const name of names) {
		const value = row[name];
		if (value !== undefined && value !== null && String(value).length > 0) return String(value);
	}
	return "";
}

/**
 * Entity ids currently carrying the dead condition.
 *
 * `deadConditionId` is required: the sdk cannot know the ruleset's id. A
 * condition counts as dead when it equals `deadConditionId`, or - only when the
 * caller passes `deadConditionSuffix` - ends with it (bundle-prefixed copies of
 * the same condition, e.g. `"/condition/dead"`).
 */
export function readDeadEntityIds(
	db: SnapshotDb,
	options: { deadConditionId: string; deadConditionSuffix?: string },
): Set<string> {
	const { deadConditionId, deadConditionSuffix } = options;
	const dead = new Set<string>();
	for (const raw of tableRows(
		db,
		"visibleTargetCondition",
		"visible_target_condition",
		"target_condition",
	)) {
		const row = raw as Record<string, unknown>;
		const conditionId = fieldOf(
			row,
			"conditionId",
			"condition_id",
			"conditionDefinitionId",
			"condition_definition_id",
		);
		const isDead =
			conditionId === deadConditionId ||
			(deadConditionSuffix !== undefined &&
				deadConditionSuffix !== "" &&
				conditionId.endsWith(deadConditionSuffix));
		if (!isDead) continue;
		const entityId = fieldOf(
			row,
			"entityId",
			"entity_id",
			"targetEntityId",
			"target_entity_id",
			"targetBodyEntityId",
			"target_body_entity_id",
			"targetId",
			"target_id",
		);
		if (entityId !== "") dead.add(entityId);
	}
	return dead;
}

/**
 * Map each authored entity key to its live numeric entity id (as a string),
 * omitting keys that are not placed.
 *
 * `resolveEntityId` matches the bare key against
 * `visible_manifest_authored_entity.manifest_key` after its first `bundle:` colon, so a
 * key that itself carries a `bundle:` prefix is tried bare first, then verbatim.
 * Do not strip path segments.
 */
export function resolveEntityKeys(db: SnapshotDb, keys: readonly EntityRef[]): Map<string, string> {
	const out = new Map<string, string>();
	for (const key of keys) {
		try {
			const bare = key.includes(":") ? asEntityRef(key.slice(key.indexOf(":") + 1)) : key;
			const id = resolveEntityId(db, bare) ?? resolveEntityId(db, key);
			if (id !== undefined) out.set(key, String(id));
		} catch {
			/* not placed */
		}
	}
	return out;
}
