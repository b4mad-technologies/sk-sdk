/**
 * WorkOS user API key validation for Account API routes (ADR-0107 D-5 / sk-t2qm.3).
 *
 * Uses the same endpoint as `@workos-inc/node` `workos.apiKeys.createValidation({ value })`:
 *   POST https://api.workos.com/api_keys/validations
 *   Authorization: Bearer <WORKOS_API_KEY>
 *   body: { "value": "<user api key>" }
 *
 * Feature is OFF when WORKOS_API_KEY is absent — callers must 401 as today.
 * Never logs the raw key; cache stores only a SHA-256 hash.
 */

import { createHash } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";

/** Successful validations are cached this long (ms), keyed by key hash. */
export const API_KEY_VALIDATION_CACHE_TTL_MS = 60_000;

export const WORKOS_API_KEYS_VALIDATIONS_PATH = "/api_keys/validations";
export const DEFAULT_WORKOS_API_BASE_URL = "https://api.workos.com";

export type ApiKeyAuthOutcome = "ok" | "invalid" | "disabled" | "network_error" | "rejected_owner";

export class ApiKeyAuthError extends Error {
	readonly outcome: Exclude<ApiKeyAuthOutcome, "ok">;
	readonly httpStatus: 401 | 503;

	constructor(outcome: Exclude<ApiKeyAuthOutcome, "ok">, message: string, httpStatus: 401 | 503) {
		super(message);
		this.name = "ApiKeyAuthError";
		this.outcome = outcome;
		this.httpStatus = httpStatus;
	}
}

export interface WorkOsApiKeyOwner {
	type: string;
	id: string;
	organization_id?: string;
}

export interface WorkOsApiKeyObject {
	object?: string;
	id?: string;
	owner?: WorkOsApiKeyOwner;
	permissions?: string[];
	name?: string;
	obfuscated_value?: string;
}

export interface WorkOsValidateApiKeyResponse {
	api_key: WorkOsApiKeyObject | null;
	agent_registration_id?: string | null;
}

export interface ApiKeyValidationResult {
	subject: string;
	permissions: string[];
	apiKeyId: string | undefined;
	ownerType: string;
}

export interface ApiKeyValidatorOptions {
	/** Server-side WorkOS API key (sk_…). Absent/empty → feature disabled. */
	workosApiKey?: string;
	/** Override WorkOS API origin (tests). Default https://api.workos.com */
	baseUrl?: string;
	/** Injected fetch (tests). */
	fetchImpl?: typeof fetch;
	/** Clock (tests). */
	now?: () => number;
	/** Cache TTL override (tests). */
	cacheTtlMs?: number;
}

export interface ApiKeyValidator {
	/** True when WORKOS_API_KEY is configured. */
	readonly enabled: boolean;
	/**
	 * Validate a user API key value. Throws ApiKeyAuthError on failure.
	 * On success returns subject (user id) + permissions.
	 */
	validate(value: string): Promise<ApiKeyValidationResult>;
}

type CacheEntry = {
	expiresAt: number;
	result: ApiKeyValidationResult;
};

function hashKey(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * True when the bearer looks like a compact JWT (three base64url parts that
 * decode as JSON header/payload). Non-JWT bearers are API-key candidates.
 */
export function looksLikeJwt(token: string): boolean {
	const parts = token.split(".");
	if (parts.length !== 3) return false;
	if (parts.some((part) => part.length === 0)) return false;
	try {
		for (const part of parts.slice(0, 2)) {
			const pad = "=".repeat((4 - (part.length % 4)) % 4);
			const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString(
				"utf8",
			);
			const parsed: unknown = JSON.parse(json);
			if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return false;
		}
		return true;
	} catch {
		return false;
	}
}

/** Extract the raw Bearer credential, or undefined when missing/malformed. */
export function extractBearerToken(request: Request): string | undefined {
	const header = request.headers.get("authorization");
	if (header === null) return undefined;
	const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
	if (match === null) return undefined;
	const token = match[1] ?? "";
	return token === "" ? undefined : token;
}

export function createApiKeyValidator(options: ApiKeyValidatorOptions = {}): ApiKeyValidator {
	const workosApiKey = options.workosApiKey?.trim() ?? "";
	const enabled = workosApiKey !== "";
	const baseUrl = (options.baseUrl ?? DEFAULT_WORKOS_API_BASE_URL).replace(/\/$/, "");
	const fetchImpl = options.fetchImpl ?? fetch;
	const now = options.now ?? Date.now;
	const cacheTtlMs = options.cacheTtlMs ?? API_KEY_VALIDATION_CACHE_TTL_MS;
	const cache = new Map<string, CacheEntry>();

	return {
		enabled,
		async validate(value: string): Promise<ApiKeyValidationResult> {
			if (!enabled) {
				throw new ApiKeyAuthError("disabled", "API key authentication is not configured", 401);
			}
			const keyHash = hashKey(value);
			const cached = cache.get(keyHash);
			const ts = now();
			if (cached !== undefined && cached.expiresAt > ts) {
				return cached.result;
			}
			if (cached !== undefined) cache.delete(keyHash);

			let response: Response;
			try {
				response = await fetchImpl(`${baseUrl}${WORKOS_API_KEYS_VALIDATIONS_PATH}`, {
					method: "POST",
					headers: {
						authorization: `Bearer ${workosApiKey}`,
						"content-type": "application/json",
						accept: "application/json",
					},
					body: JSON.stringify({ value }),
				});
			} catch {
				throw new ApiKeyAuthError("network_error", "WorkOS API key validation unreachable", 503);
			}

			if (response.status >= 500) {
				throw new ApiKeyAuthError(
					"network_error",
					`WorkOS API key validation HTTP ${response.status}`,
					503,
				);
			}
			if (response.status >= 400) {
				throw new ApiKeyAuthError("invalid", "API key rejected by WorkOS", 401);
			}

			let body: WorkOsValidateApiKeyResponse;
			try {
				body = (await response.json()) as WorkOsValidateApiKeyResponse;
			} catch {
				throw new ApiKeyAuthError(
					"network_error",
					"WorkOS API key validation returned non-JSON",
					503,
				);
			}

			const apiKey = body.api_key;
			if (apiKey === null || apiKey === undefined) {
				throw new ApiKeyAuthError("invalid", "API key is not valid", 401);
			}
			const owner = apiKey.owner;
			if (
				owner === undefined ||
				owner.type !== "user" ||
				typeof owner.id !== "string" ||
				owner.id === ""
			) {
				throw new ApiKeyAuthError("rejected_owner", "API key owner must be a user", 401);
			}

			const result: ApiKeyValidationResult = {
				subject: owner.id,
				permissions: Array.isArray(apiKey.permissions)
					? apiKey.permissions.filter((p): p is string => typeof p === "string")
					: [],
				apiKeyId: typeof apiKey.id === "string" ? apiKey.id : undefined,
				ownerType: owner.type,
			};
			cache.set(keyHash, { expiresAt: ts + cacheTtlMs, result });
			// Bound cache growth: drop expired entries opportunistically.
			if (cache.size > 256) {
				for (const [k, entry] of cache) {
					if (entry.expiresAt <= ts) cache.delete(k);
				}
			}
			return result;
		},
	};
}

/** Build an AuthInfo matching the JWT verifier shape for Account API handlers. */
export function apiKeyAuthInfo(
	token: string,
	validation: ApiKeyValidationResult,
	resource: string,
): AuthInfo {
	return {
		token,
		clientId: "workos-api-key",
		scopes: validation.permissions,
		resource: new URL(resource),
		extra: {
			subject: validation.subject,
			credential_kind: "api_key",
			permissions: validation.permissions,
			...(validation.apiKeyId === undefined ? {} : { api_key_id: validation.apiKeyId }),
		},
	};
}

export function apiKeyUnauthorizedResponse(
	canonicalOrigin: string,
	description: string,
	status: 401 | 503 = 401,
): Response {
	const error = status === 503 ? "temporarily_unavailable" : "invalid_token";
	return new Response(JSON.stringify({ error, error_description: description }), {
		status,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			...(status === 401
				? {
						"www-authenticate": `Bearer realm="mcp", resource_metadata="${new URL(canonicalOrigin).origin}/.well-known/oauth-protected-resource"`,
					}
				: {}),
		},
	});
}

export function jwtRequiredResponse(description?: string): Response {
	return new Response(
		JSON.stringify({
			error: "jwt_required",
			error_description:
				description ??
				"seat claim/release binds your world identity and needs an interactive login token",
		}),
		{
			status: 403,
			headers: {
				"content-type": "application/json",
				"cache-control": "no-store",
			},
		},
	);
}

export function isApiKeyCredential(authInfo: AuthInfo): boolean {
	return authInfo.extra?.credential_kind === "api_key";
}
