export type QueryDomain =
	| "self"
	| "scene"
	| "inventory"
	| "trace"
	| "reaction"
	| "intervention"
	| "session";

const DOMAIN_PREFIX: Record<QueryDomain, string> = {
	self: "u",
	scene: "s",
	inventory: "i",
	trace: "t",
	reaction: "r",
	intervention: "w",
	session: "o",
};

export class QueryProtocolError extends Error {
	constructor(
		public readonly code: "invalid_cursor" | "stale_cursor" | "cross_domain" | "unknown_handle",
	) {
		super(code);
		this.name = "QueryProtocolError";
	}
}

function canonical(value: unknown): string {
	if (typeof value === "bigint") return JSON.stringify(value.toString());
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const object = value as Record<string, unknown>;
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
		.join(",")}}`;
}

const utf8 = new TextEncoder();

function hashText(text: string): string {
	let hash = 0x811c9dc5;
	for (const byte of utf8.encode(text)) {
		hash ^= byte;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(36);
}

/** Envelope revision over `rows` AS PASSED. `decodeCursor` binds offset to
 * this string, so identical rev must imply identical listing order — do not
 * sort only at hash time. Hash the caller-visible listing so hidden bookkeeping
 * changes do not invalidate a cursor. */
export function queryRevision(domain: QueryDomain, rows: readonly unknown[]): string {
	return `${DOMAIN_PREFIX[domain]}${rows.length}-${hashText(canonical(rows))}`;
}

interface CursorPayload {
	d: QueryDomain;
	r: string;
	o: number;
}

function encodeBase64Url(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64Url(text: string): string {
	const padded = text
		.replaceAll("-", "+")
		.replaceAll("_", "/")
		.padEnd(Math.ceil(text.length / 4) * 4, "=");
	const binary = atob(padded);
	return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

export function encodeCursor(domain: QueryDomain, revision: string, offset: number): string {
	if (!Number.isSafeInteger(offset) || offset < 0) throw new QueryProtocolError("invalid_cursor");
	return encodeBase64Url(
		JSON.stringify({ d: domain, r: revision, o: offset } satisfies CursorPayload),
	);
}

export function decodeCursor(cursor: string, domain: QueryDomain, revision: string): number {
	let payload: CursorPayload;
	try {
		payload = JSON.parse(decodeBase64Url(cursor)) as CursorPayload;
	} catch {
		throw new QueryProtocolError("invalid_cursor");
	}
	if (payload.d !== domain) throw new QueryProtocolError("cross_domain");
	if (payload.r !== revision) throw new QueryProtocolError("stale_cursor");
	if (!Number.isSafeInteger(payload.o) || payload.o < 0) {
		throw new QueryProtocolError("invalid_cursor");
	}
	return payload.o;
}

export function queryHandle(domain: QueryDomain, index: number): string {
	if (!Number.isSafeInteger(index) || index < 0) throw new QueryProtocolError("unknown_handle");
	return `${DOMAIN_PREFIX[domain]}${index}`;
}

export function parseQueryHandle(handle: string, domain: QueryDomain, size: number): number {
	const match = /^([uhsitrwo])(\d+)$/.exec(handle);
	if (!match) throw new QueryProtocolError("unknown_handle");
	if (match[1] !== DOMAIN_PREFIX[domain]) throw new QueryProtocolError("cross_domain");
	const index = Number(match[2]);
	if (!Number.isSafeInteger(index) || index < 0 || index >= size) {
		throw new QueryProtocolError("unknown_handle");
	}
	return index;
}

// --- Stable identity handles (T12, tool-ux-decision-log.md; BL-3 stable-
// handles half). `queryHandle`/`parseQueryHandle` above are POSITIONAL —
// index-into-array — which is exactly the churn source T12 names: a row
// shifting position (or the whole domain's content hash moving for an
// unrelated reason) shifts or busts every handle even when the specific
// thing a caller remembered never itself changed. `stableHandle`/
// `parseStableHandle` instead wrap a caller-supplied IDENTITY string (a raw
// entity_id, edge_id, trace_id, or `${kind}:${id}` composite for a domain
// mixing kinds) so the same real-world thing always gets the same handle,
// for as long as it exists, regardless of what else in the domain moved.
// Scoped today to the domains where an already-legible, non-sensitive
// identity exists on every row (scene/inventory/trace); reaction/
// intervention/affordance/self stay positional deliberately — see
// `packages/spellkave-srd-cc/ledger/designs/tool-ux-decision-log.md` T12.
export function stableHandle(domain: QueryDomain, id: string): string {
	if (id.length === 0) throw new QueryProtocolError("unknown_handle");
	return `${DOMAIN_PREFIX[domain]}:${id}`;
}

/** Extract the identity payload from a stable handle. Malformed (no `:`,
 * empty id) -> `unknown_handle`; a well-formed handle for a DIFFERENT known
 * domain -> `cross_domain`; a well-formed handle for THIS domain returns its
 * id verbatim — existence against current rows is the caller's job (T12:
 * "existence + field equality of the ONE referenced thing", not a domain-
 * wide check here). */
export function parseStableHandle(handle: string, domain: QueryDomain): string {
	const separatorIndex = handle.indexOf(":");
	if (separatorIndex <= 0) throw new QueryProtocolError("unknown_handle");
	const prefix = handle.slice(0, separatorIndex);
	const id = handle.slice(separatorIndex + 1);
	if (id.length === 0) throw new QueryProtocolError("unknown_handle");
	if (prefix !== DOMAIN_PREFIX[domain]) {
		const knownPrefixes = new Set(Object.values(DOMAIN_PREFIX));
		throw new QueryProtocolError(knownPrefixes.has(prefix) ? "cross_domain" : "unknown_handle");
	}
	return id;
}

/** Content fingerprint of ONE row — the per-target analogue of
 * `queryRevision`'s whole-domain hash. Used as the `rev` a caller copies
 * alongside a stable handle: it changes only when THAT row's own content
 * changes, never when an unrelated sibling row in the same domain does
 * (T12's "diff-stable" target state). */
export function contentFingerprint(value: unknown): string {
	return hashText(canonical(value));
}

export interface QueryEnvelope<T> {
	listing: "paginated";
	shown: number;
	matched: number;
	truncated: boolean;
	next_cursor: string | null;
	rev: string;
	items: T[];
}

export function queryPage<T>(options: {
	domain: QueryDomain;
	rows: readonly T[];
	limit?: number;
	cursor?: string;
	maxLimit?: number;
	revision?: string;
}): QueryEnvelope<T> {
	const { domain, rows } = options;
	const rev = options.revision ?? queryRevision(domain, rows);
	const maxLimit = Math.max(1, options.maxLimit ?? 100);
	const limit = Math.min(maxLimit, Math.max(1, options.limit ?? 20));
	const offset = options.cursor ? decodeCursor(options.cursor, domain, rev) : 0;
	const items = rows.slice(offset, offset + limit);
	const nextOffset = offset + items.length;
	return {
		listing: "paginated",
		shown: items.length,
		matched: rows.length,
		truncated: nextOffset < rows.length,
		next_cursor: nextOffset < rows.length ? encodeCursor(domain, rev, nextOffset) : null,
		rev,
		items,
	};
}
