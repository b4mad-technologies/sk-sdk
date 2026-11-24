/**
 * "Logout everywhere" cutoff (ADR-0161 D-7 step 4, bead sk-jay0.5.14.5.4).
 *
 * When a person signs out on the login site, it writes `logout_after = <unix
 * seconds>` into their WorkOS user `metadata`. Every resource server that
 * validates access tokens (the account API and the MCP gateway) then rejects
 * a token whose `iat` is older than that value, so an access token minted
 * before the sign-out stops working at once instead of at `exp`.
 *
 * Store: WorkOS user metadata is the only store. ADR-0161 D-7 names it as the
 * fallback; the API service's own store is the SpacetimeDB control module,
 * which the gateway cannot read (coordinator decision 2026-10-16, recorded in
 * the D-7 amendment). Both services already hold `WORKOS_API_KEY`.
 *
 * Reads are cached per `sub` for 30 s. A WorkOS failure is fail-open with the
 * last value seen for that `sub` (and logged): the cutoff narrows the window
 * of an already short-lived token (D-8, 300 s), it is not the only control,
 * and a WorkOS outage must not sign every player out.
 */

export const LOGOUT_AFTER_METADATA_KEY = "logout_after";
export const LOGOUT_CUTOFF_TTL_MS = 30_000;
const MAX_CACHED_SUBJECTS = 10_000;
const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";

export interface LogoutCutoff {
	/** Unix seconds; tokens with `iat` below it are revoked. `undefined` = no cutoff. */
	notBefore(sub: string): Promise<number | undefined>;
	/** Drops the cached value (the writer calls it after a write in the same process). */
	forget(sub: string): void;
}

export interface WorkosLogoutCutoffOptions {
	workosApiKey: string;
	baseUrl?: string;
	fetchImpl?: typeof fetch;
	ttlMs?: number;
	now?: () => number;
	timeoutMs?: number;
	log?: (record: Record<string, unknown>) => void;
}

/** Parses the stored metadata value: decimal unix seconds, nothing else. */
export function parseLogoutAfter(value: unknown): number | undefined {
	if (typeof value !== "string" || !/^\d{1,12}$/.test(value)) return undefined;
	return Number(value);
}

/**
 * Clock-skew margin between our clock (which writes `logout_after`) and
 * WorkOS's (which writes `iat`): a token issued up to this many seconds
 * before the sign-out still passes, so a fresh sign-in right after a
 * sign-out is never refused because WorkOS's clock runs behind. The SPA
 * refresh grants are dead at once anyway (D-7 step 1).
 */
export const LOGOUT_CUTOFF_SKEW_S = 5;

/**
 * True when the token was issued before the cutoff (minus the skew margin).
 * A token issued in the same second as the sign-out, or after it, passes. A
 * token without a numeric `iat` counts as older than any cutoff.
 */
export function issuedBeforeCutoff(payload: Record<string, unknown>, cutoff: number): boolean {
	return typeof payload.iat !== "number" || payload.iat < cutoff - LOGOUT_CUTOFF_SKEW_S;
}

function userPath(sub: string): string {
	return `/user_management/users/${encodeURIComponent(sub)}`;
}

export function createWorkosLogoutCutoff(options: WorkosLogoutCutoffOptions): LogoutCutoff {
	const apiKey = options.workosApiKey.trim();
	if (apiKey === "") throw new Error("logout cutoff needs WORKOS_API_KEY");
	const baseUrl = (options.baseUrl ?? DEFAULT_WORKOS_API_BASE_URL).replace(/\/$/, "");
	const fetchImpl = options.fetchImpl ?? fetch;
	const ttlMs = options.ttlMs ?? LOGOUT_CUTOFF_TTL_MS;
	const now = options.now ?? Date.now;
	const timeoutMs = options.timeoutMs ?? 5_000;
	const log =
		options.log ??
		((record: Record<string, unknown>) => process.stderr.write(`${JSON.stringify(record)}\n`));
	const cache = new Map<string, { at: number; value: number | undefined }>();
	const inflight = new Map<string, Promise<number | undefined>>();

	async function load(sub: string): Promise<number | undefined> {
		const stale = cache.get(sub);
		let value: number | undefined;
		try {
			const response = await fetchImpl(`${baseUrl}${userPath(sub)}`, {
				headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
				signal: AbortSignal.timeout(timeoutMs),
			});
			if (response.status === 404) {
				value = undefined;
			} else if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			} else {
				const body = (await response.json()) as { metadata?: Record<string, unknown> | null };
				value = parseLogoutAfter(body.metadata?.[LOGOUT_AFTER_METADATA_KEY]);
			}
		} catch (error) {
			// Fail-open with the last known value; cached for one TTL so an
			// outage costs one WorkOS call per subject per window, not per request.
			log({
				event: "logout_cutoff_unavailable",
				error: error instanceof Error ? error.message : String(error),
				has_stale_value: stale?.value !== undefined,
			});
			value = stale?.value;
		}
		if (cache.size >= MAX_CACHED_SUBJECTS && !cache.has(sub)) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
		cache.delete(sub);
		cache.set(sub, { at: now(), value });
		return value;
	}

	return {
		async notBefore(sub) {
			const hit = cache.get(sub);
			if (hit !== undefined && now() - hit.at < ttlMs) return hit.value;
			const running = inflight.get(sub);
			if (running !== undefined) return running;
			const next = load(sub).finally(() => inflight.delete(sub));
			inflight.set(sub, next);
			return next;
		},
		forget(sub) {
			cache.delete(sub);
		},
	};
}
