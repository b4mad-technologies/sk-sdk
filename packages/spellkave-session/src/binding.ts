// Session identity (#1990 decision 1): a session **is** the tuple
// `(url, db, identity, actorId)`, not a name or a path — ssh's
// `ControlPath %C` pattern. `identity` is deliberately opaque to this module:
// callers supply whatever string distinguishes "who is connecting" for their
// host (a resolved credential token, a `spacetime login` token, a connected
// `Identity.toHexString()` once known) — `binding.ts` only canonicalizes and
// hashes, it never resolves credentials itself, so it stays isomorphic.
//
// Deviation from the #1990 handover comment's literal `{ url, identity,
// actorId }` shape: `db` is included too. Two databases served from the same
// `url` are different worlds with different affordance caches; dropping `db`
// would hash them onto the same socket and daemon.
//
// Canonicalization matters because two spellings of the same endpoint
// (`http://localhost:3000/` vs `http://127.0.0.1:3000`) must hash to the same
// socket — a session daemon is keyed by where a caller SHOULD attach, not by
// how they happened to type it.

/** The tuple that identifies one live session. */
export interface SessionBinding {
	readonly url: string;
	readonly db: string;
	readonly identity: string;
	readonly actorId: string;
}

/** `SessionBinding` after canonicalization — every field trimmed/normalized. */
export type CanonicalBinding = Readonly<SessionBinding>;

/**
 * Canonicalize a binding's fields for stable hashing:
 *   - `url`: lowercase scheme/host, `localhost` folded to `127.0.0.1` (avoids
 *     IPv4/hostname-resolution ambiguity for the loopback case every local
 *     dev node uses), trailing slash stripped from the path.
 *   - `db`/`identity`/`actorId`: trimmed. These are opaque identifiers, not
 *     URLs — no case-folding, since SpacetimeDB database names and identity
 *     hex strings are case-sensitive.
 */
export function canonicalizeBinding(binding: SessionBinding): CanonicalBinding {
	return {
		url: canonicalizeUrl(binding.url),
		db: binding.db.trim(),
		identity: binding.identity.trim(),
		actorId: binding.actorId.trim(),
	};
}

function canonicalizeUrl(raw: string): string {
	const trimmed = raw.trim();
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		// Not a well-formed absolute URL (e.g. a bare host:port some caller
		// passed through) — fall back to a best-effort string normalization
		// rather than throwing. Binding hashing must never fail a caller who
		// only wants a stable socket path.
		return trimmed.replace(/\/+$/, "");
	}
	const host =
		parsed.hostname.toLowerCase() === "localhost" ? "127.0.0.1" : parsed.hostname.toLowerCase();
	const port = parsed.port.length > 0 ? `:${parsed.port}` : "";
	const path = parsed.pathname.replace(/\/+$/, "");
	return `${parsed.protocol}//${host}${port}${path}`;
}

/**
 * Canonical JSON representation of a binding, with a fixed key order — the
 * hash input. Fixed order matters: `JSON.stringify` on an object literal
 * already preserves insertion order for string keys, but this function is the
 * ONE place that order is decided, so a future field addition can't silently
 * reorder existing hashes.
 */
export function canonicalBindingJson(binding: SessionBinding): string {
	const canonical = canonicalizeBinding(binding);
	return JSON.stringify({
		url: canonical.url,
		db: canonical.db,
		identity: canonical.identity,
		actorId: canonical.actorId,
	});
}

/** A sha256-hex digest function. Sync or async, so a host may use WebCrypto or `node:crypto`. */
export type Sha256Hex = (input: string) => string | Promise<string>;

/** Digest length, in hex chars, of {@link hashBinding}'s result — 12 hex chars = 48 bits. */
export const BINDING_HASH_LENGTH = 12;

/**
 * Derive the stable per-binding hash used to key a session's socket path.
 * Same binding (after canonicalization) → same hash, from any host, any hash
 * implementation — the hasher is injected so this stays isomorphic; the
 * default uses WebCrypto (`globalThis.crypto.subtle`), which every modern
 * Node and browser runtime provides. `@spellkave/session/node` additionally
 * exposes a synchronous `node:crypto`-backed hasher for callers (like socket
 * path derivation) that cannot await.
 */
export async function hashBinding(
	binding: SessionBinding,
	sha256: Sha256Hex = webCryptoSha256Hex,
): Promise<string> {
	const digest = await sha256(canonicalBindingJson(binding));
	return digest.slice(0, BINDING_HASH_LENGTH);
}

/** WebCrypto-backed sha256 hex digest — the isomorphic default hasher. */
export async function webCryptoSha256Hex(input: string): Promise<string> {
	const subtle = globalThis.crypto?.subtle;
	if (subtle === undefined) {
		throw new Error(
			"webCryptoSha256Hex requires globalThis.crypto.subtle (WebCrypto); pass a Sha256Hex " +
				"override on hosts without it, e.g. @spellkave/session/node's node:crypto-backed hasher",
		);
	}
	const bytes = new TextEncoder().encode(input);
	const digest = await subtle.digest("SHA-256", bytes);
	return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
	let out = "";
	for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
	return out;
}
