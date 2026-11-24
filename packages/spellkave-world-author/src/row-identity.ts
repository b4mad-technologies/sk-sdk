
import { ROW_KIND_NATURAL_KEY } from "./row-kinds";

export const SURROGATE_ID_FIELDS: Readonly<Record<string, { camel: string; snake: string }>> = {
	entities: { camel: "entityId", snake: "entity_id" },
	actors: { camel: "actorId", snake: "actor_id" },
};

/** A row's identity descriptor — see this module's header for which kinds get which form. */
export type RowIdentity =
	| { form: "surrogate"; kind: string; id: number }
	| { form: "natural-key"; kind: string; key: string };

function knownKinds(): string[] {
	return [
		...new Set([...Object.keys(SURROGATE_ID_FIELDS), ...Object.keys(ROW_KIND_NATURAL_KEY)]),
	].sort();
}

/**
 * Derive `row`'s identity descriptor for row kind `kind`.
 *
 * `entities`/`actors`: `row` MUST be a LIVE row (a query result carrying the
 * numeric surrogate id — camelCase `entityId`/`actorId`, matching the
 * SpacetimeDB SDK binding convention, or snake_case `entity_id`/`actor_id`
 * for a raw/manifest-shaped stand-in) — a bare authoring-time manifest row
 * (only `entity_key`, no numeric id yet) throws, naming the missing field.
 *
 * Every other kind: `row` is keyed by its `ROW_KIND_NATURAL_KEY` column.
 *
 * An unrecognized `kind` throws, naming every known kind (surrogate + natural-
 * key) — the wrong-usage guard this helper exists to provide.
 */
export function identityOf(kind: string, row: Record<string, unknown>): RowIdentity {
	const surrogate = SURROGATE_ID_FIELDS[kind];
	if (surrogate !== undefined) {
		const raw = row[surrogate.camel] ?? row[surrogate.snake];
		if (typeof raw !== "number" && typeof raw !== "bigint") {
			throw new Error(
				`identityOf: surrogate kind '${kind}' row has no numeric '${surrogate.camel}'/'${surrogate.snake}' ` +
					"field — pass a LIVE row (a query result), not a bare manifest row (which carries only the " +
					`authoring-time '${ROW_KIND_NATURAL_KEY[kind]}' natural key, not yet a live surrogate id).`,
			);
		}
		return { form: "surrogate", kind, id: Number(raw) };
	}
	const naturalKeyField = ROW_KIND_NATURAL_KEY[kind];
	if (naturalKeyField === undefined) {
		throw new Error(
			`identityOf: unknown row kind '${kind}' — not a surrogate kind (${Object.keys(
				SURROGATE_ID_FIELDS,
			).join(
				", ",
			)}) and not registered in ROW_KIND_NATURAL_KEY. Known kinds: ${knownKinds().join(", ")}.`,
		);
	}
	const rawKey = row[naturalKeyField];
	if (typeof rawKey !== "string" || rawKey.length === 0) {
		throw new Error(
			`identityOf: row of kind '${kind}' has no non-empty '${naturalKeyField}' natural-key field — the ` +
				`offending row: ${JSON.stringify(row)}.`,
		);
	}
	return { form: "natural-key", kind, key: rawKey };
}

/**
 * Assert `kind`'s identity held across `before` -> `after` (e.g. a re-author,
 * re-apply, or apply-then-act cycle). Throws with a descriptive message on
 * mismatch; returns nothing on success ("no news is good news", matching this
 * package's other assert* helpers, e.g. `spell.ts`'s
 * `assertSpellCatalogBinding`).
 *
 * Surrogate kinds (`entities`/`actors`): the numeric id must be IDENTICAL —
 * this is the "never deleted and recreated" proof.
 * Natural-key kinds (everything else): the SAME key must be present in both —
 * every OTHER field is free to differ (that is what an upsert-by-key IS).
 */
export function assertIdentityStable(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
	kind: string,
): void {
	const beforeId = identityOf(kind, before);
	const afterId = identityOf(kind, after);
	if (beforeId.form === "surrogate") {
		const afterDescribed = afterId.form === "surrogate" ? String(afterId.id) : "(natural-key form)";
		if (afterId.form !== "surrogate" || afterId.id !== beforeId.id) {
			throw new Error(
				`assertIdentityStable: surrogate kind '${kind}' identity changed — before id ${beforeId.id}, after ` +
					`${afterDescribed}. A re-authored/re-applied row of a surrogate kind must keep the SAME live id, ` +
					"never delete+recreate under the same authored key.",
			);
		}
		return;
	}
	const afterDescribed = afterId.form === "natural-key" ? `'${afterId.key}'` : "(surrogate form)";
	if (afterId.form !== "natural-key" || afterId.key !== beforeId.key) {
		throw new Error(
			`assertIdentityStable: natural-key kind '${kind}' identity changed — before key '${beforeId.key}', ` +
				`after ${afterDescribed}. Field changes are fine (that is what upsert-by-key IS) — the KEY itself ` +
				"must stay the same row identity.",
		);
	}
}
