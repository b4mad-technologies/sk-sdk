const EXAMPLE_BOUND = 4;

/**
 * Self-describing bounded collection: `listing` tells a caller whether
 * `items` is the entire authorized collection ("complete") or a bounded
 * example slice ("examples") that needs a follow-up `continuation` call to
 * see the rest. Never silent-truncate a collection without saying so.
 */
export interface BoundedCollection<T> {
	count: number;
	listing: "complete" | "examples";
	items: T[];
	continuation?: { tool: string; args: Record<string, unknown> };
}

/** Build a `BoundedCollection` from a full authorized row set. */
export function boundedCollection<T>(
	all: readonly T[],
	continuation: { tool: string; args: Record<string, unknown> },
	limit = EXAMPLE_BOUND,
): BoundedCollection<T> {
	const complete = all.length <= limit;
	return {
		count: all.length,
		listing: complete ? "complete" : "examples",
		items: all.slice(0, limit),
		...(complete ? {} : { continuation }),
	};
}
