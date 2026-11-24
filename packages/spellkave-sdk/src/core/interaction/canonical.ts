// Deterministic key-sorted JSON shaping, shared by `attemptFingerprint` and
// `inputValuesToText`. Object key order carries no author meaning and must
// not affect identity; array order does carry meaning (it is a sequence, not
// a set) and is always preserved.

export function sortKeysDeep(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortKeysDeep);
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(record).sort()) sorted[key] = sortKeysDeep(record[key]);
		return sorted;
	}
	return value;
}
