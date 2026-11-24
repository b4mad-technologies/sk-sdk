/** Minimal projected columns used for identity and ordering; values stay opaque. */
export interface EnvironmentStateCandidate {
	bundleId?: string;
	stateId?: string;
	stateRowId?: bigint;
	updatedTick?: bigint;
	targetKind?: string;
	targetRef?: unknown;
	placeNodeId?: string;
	placeEdgeId?: bigint | string;
	locationDefId?: string;
	cellRes10?: bigint;
	cellRes7?: bigint;
	cellRes4?: bigint;
	substrateId?: string;
}

/** Projection/ancestor columns describe locality, not the logical target. */
function targetIdentity(row: EnvironmentStateCandidate): unknown {
	const kind = row.targetKind ?? "";
	if ((!kind || kind === "place_node") && row.placeNodeId) return ["node", row.placeNodeId];
	if ((!kind || kind === "place_edge") && row.placeEdgeId && String(row.placeEdgeId) !== "0")
		return ["edge", String(row.placeEdgeId)];
	if ((!kind || kind === "location") && row.locationDefId) return ["location", row.locationDefId];
	if (row.targetRef !== undefined) return ["reference", canonicalReference(row.targetRef)];
	return [
		kind,
		String(row.cellRes10 ?? 0),
		String(row.cellRes7 ?? 0),
		String(row.cellRes4 ?? 0),
		row.substrateId ?? "",
	];
}

function canonicalReference(value: unknown): unknown {
	if (typeof value === "bigint" || typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.map(canonicalReference);
	if (value && typeof value === "object")
		return Object.entries(value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, field]) => [key, canonicalReference(field)]);
	return value;
}

/** Resolve only the rows already admitted to this caller; never expire values. */
export function resolveEffectiveSpatialEnvironmentStates<T extends EnvironmentStateCandidate>(
	input: Iterable<T>,
): T[] {
	const effective = new Map<string, T>();
	const rank = (row: T): [number, bigint, bigint] => [
		row.bundleId === "" ? 1 : 0,
		BigInt(row.updatedTick ?? 0),
		BigInt(row.stateRowId ?? 0),
	];
	for (const row of input) {
		const key = JSON.stringify([row.stateId ?? "", targetIdentity(row)]);
		const prior = effective.get(key);
		if (!prior) {
			effective.set(key, row);
			continue;
		}
		const left = rank(row),
			right = rank(prior);
		if (
			left[0] > right[0] ||
			(left[0] === right[0] && (left[1] > right[1] || (left[1] === right[1] && left[2] > right[2])))
		)
			effective.set(key, row);
	}
	return [...effective.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
}
