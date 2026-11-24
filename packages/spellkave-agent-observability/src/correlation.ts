// Host-neutral causal references for WORLD-ACTOR evidence. These are explicit
// query attributes, not W3C trace parentage: an asynchronous actor reaction
// links to the authoritative world row that caused it without pretending to
// be an in-process child call.

export const WORLD_ACTOR_CAUSAL_FIELDS = [
	"correlation_id",
	"world_slug",
	"cause_kind",
	"cause_id",
	"action_id",
	"target_ref",
	"provenance_id",
	"provenance_status",
	"provenance_kind",
	"failure_class",
] as const;

export type WorldActorCausalField = (typeof WORLD_ACTOR_CAUSAL_FIELDS)[number];

export interface WorldActorCausalContext {
	/** Fresh non-secret identifier for one synchronous host request. */
	correlation_id?: string;
	/** Public deployment routing slug, never a database URL or credential. */
	world_slug?: string;
	/** Kind and id of an authoritative asynchronous world cause. */
	cause_kind?: string;
	cause_id?: string;
	action_id?: string;
	target_ref?: string;
	provenance_id?: string;
	provenance_status?: string;
	provenance_kind?: string;
	/** Safe classification only; never the full server failure detail. */
	failure_class?: string;
}

const MAX_CAUSAL_VALUE_LENGTH = 256;

function boundedNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (trimmed === "") return undefined;
	return trimmed.slice(0, MAX_CAUSAL_VALUE_LENGTH);
}

/** Parse an untrusted protocol/object value into the closed safe context.
 * Unknown fields are dropped. An incomplete asynchronous cause is dropped as
 * a pair so callers never manufacture a misleading half-link. */
export function normalizeWorldActorCausalContext(
	value: unknown,
): WorldActorCausalContext | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const source = value as Record<string, unknown>;
	const context: WorldActorCausalContext = {};
	for (const field of WORLD_ACTOR_CAUSAL_FIELDS) {
		const safe = boundedNonEmptyString(source[field]);
		if (safe !== undefined) context[field] = safe;
	}
	if (context.cause_kind === undefined || context.cause_id === undefined) {
		delete context.cause_kind;
		delete context.cause_id;
	}
	return Object.keys(context).length === 0 ? undefined : context;
}

/** Copy the normalized fields into an event-data payload. */
export function worldActorCausalEventData(
	context: WorldActorCausalContext | undefined,
): Record<string, string> {
	const safe = normalizeWorldActorCausalContext(context);
	return safe === undefined ? {} : Object.fromEntries(Object.entries(safe));
}

/** Copy normalized context to the shared trace attribute namespace. */
export function worldActorCausalAttributes(
	context: WorldActorCausalContext | undefined,
): Record<string, string> {
	const safe = normalizeWorldActorCausalContext(context);
	if (safe === undefined) return {};
	return Object.fromEntries(
		Object.entries(safe).map(([key, value]) => [`spellkave.${key}`, value]),
	);
}
