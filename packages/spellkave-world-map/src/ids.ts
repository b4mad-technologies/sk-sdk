/**
 * FNV-1a 64-bit → OSM positive 63-bit id (ADR-0123 D-3).
 *
 * OSM ids are signed 64-bit; negative means "not yet uploaded" in every
 * editor, so we never emit a sign bit. Collision within a primitive type
 * fails the export — we never silently renumber.
 *
 * Id representation: decimal **string** of a positive 63-bit integer.
 * Never `number` (H3 / OSM ids exceed Number.MAX_SAFE_INTEGER). Internal
 * hashing uses bigint; public surfaces and writers use string.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffff_ffff_ffff_ffffn;
/** Drop the sign bit → positive int63. */
const MASK63 = 0x7fff_ffff_ffff_ffffn;

/** Thrown when two different keys hash to the same 63-bit id inside one type. */
export class OsmIdCollision extends Error {
	readonly id: string;
	readonly keys: readonly [string, string];

	constructor(id: string, keys: readonly [string, string]) {
		super(`OSM id collision within type: hash=${id} keys=[${keys[0]}, ${keys[1]}] (ADR-0123 D-3)`);
		this.name = "OsmIdCollision";
		this.id = id;
		this.keys = keys;
	}
}

/** Hash an arbitrary UTF-8 key to a positive 63-bit BigInt (≥ 1). */
export function fnv1a63(key: string): bigint {
	let hash = FNV_OFFSET;
	const bytes = new TextEncoder().encode(key);
	for (const b of bytes) {
		hash ^= BigInt(b);
		hash = (hash * FNV_PRIME) & MASK64;
	}
	let id = hash & MASK63;
	if (id === 0n) id = 1n;
	return id;
}

/** Same as {@link fnv1a63} but returned as a decimal string. */
export function fnv1a63String(key: string): string {
	return fnv1a63(key).toString(10);
}

export type IdHasher = (key: string) => string;

/**
 * Allocate an id for `key` inside one primitive type's namespace.
 * Throws {@link OsmIdCollision} on collision (two different keys → same id).
 */
export class IdRegistry {
	private readonly byId = new Map<string, string>(); // id → key
	private readonly byKey = new Map<string, string>(); // key → id
	private readonly hash: IdHasher;

	constructor(hash: IdHasher = fnv1a63String) {
		this.hash = hash;
	}

	id(key: string): string {
		const existing = this.byKey.get(key);
		if (existing !== undefined) return existing;
		const id = this.hash(key);
		const owner = this.byId.get(id);
		if (owner !== undefined && owner !== key) {
			throw new OsmIdCollision(id, [owner, key]);
		}
		this.byId.set(id, key);
		this.byKey.set(key, id);
		return id;
	}

	has(key: string): boolean {
		return this.byKey.has(key);
	}
}
