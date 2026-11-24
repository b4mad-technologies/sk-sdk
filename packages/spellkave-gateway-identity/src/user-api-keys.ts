/**
 * WorkOS user-scoped API key management (ADR-0107 D-5 / sk-t2qm.10).
 *
 * End users cannot mint keys in the WorkOS dashboard; the gateway holds
 * WORKOS_API_KEY and calls the same User Management HTTP surface as
 * `@workos-inc/node` `userManagement.createUserApiKey` / `listUserApiKeys`
 * and `apiKeys.deleteApiKey`. Never logs the plaintext secret.
 *
 *   POST /user_management/users/{userId}/api_keys
 *   GET  /user_management/users/{userId}/api_keys
 *   DELETE /api_keys/{id}
 *
 * Feature is OFF when WORKOS_API_KEY is absent — token routes return 503.
 */

import { DEFAULT_WORKOS_API_BASE_URL } from "./api-key-auth.ts";

export const WORKOS_USER_API_KEYS_PATH = (userId: string): string =>
	`/user_management/users/${encodeURIComponent(userId)}/api_keys`;
export const WORKOS_API_KEY_PATH = (id: string): string => `/api_keys/${encodeURIComponent(id)}`;

export const ACCOUNT_TOKEN_PERMISSION = "account:manage";

export class UserApiKeyClientError extends Error {
	readonly httpStatus: 400 | 404 | 503;
	readonly code: "bad_request" | "not_found" | "unavailable";

	constructor(
		code: "bad_request" | "not_found" | "unavailable",
		message: string,
		httpStatus: 400 | 404 | 503,
	) {
		super(message);
		this.name = "UserApiKeyClientError";
		this.code = code;
		this.httpStatus = httpStatus;
	}
}

export interface CreatedUserApiKey {
	id: string;
	name: string;
	value: string;
}

export interface ListedUserApiKey {
	id: string;
	name: string;
	created_at: string;
	last_used_at: string | null;
}

export interface UserApiKeyClientOptions {
	/** Server-side WorkOS API key (sk_…). Absent/empty → feature disabled. */
	workosApiKey?: string;
	/** Fallback organization when the JWT has no org_id (WORKOS_ORGANIZATION_ID). */
	organizationId?: string;
	/** Override WorkOS API origin (tests). Default https://api.workos.com */
	baseUrl?: string;
	/** Injected fetch (tests). */
	fetchImpl?: typeof fetch;
}

export interface UserApiKeyClient {
	readonly enabled: boolean;
	readonly defaultOrganizationId: string | undefined;
	create(
		userId: string,
		options: { name: string; organizationId: string; permissions?: string[] },
	): Promise<CreatedUserApiKey>;
	list(userId: string, options?: { organizationId?: string }): Promise<ListedUserApiKey[]>;
	delete(id: string): Promise<void>;
}

function workosHeaders(workosApiKey: string): Record<string, string> {
	return {
		authorization: `Bearer ${workosApiKey}`,
		"content-type": "application/json",
		accept: "application/json",
	};
}

function mapHttpError(status: number, fallback: string): UserApiKeyClientError {
	if (status === 404) {
		return new UserApiKeyClientError("not_found", "API key not found", 404);
	}
	if (status >= 500 || status === 429) {
		return new UserApiKeyClientError(
			"unavailable",
			`WorkOS API key management HTTP ${status}`,
			503,
		);
	}
	if (status >= 400) {
		return new UserApiKeyClientError("bad_request", fallback, 400);
	}
	return new UserApiKeyClientError("unavailable", fallback, 503);
}

async function readJson(response: Response): Promise<unknown> {
	try {
		return (await response.json()) as unknown;
	} catch {
		throw new UserApiKeyClientError(
			"unavailable",
			"WorkOS API key management returned non-JSON",
			503,
		);
	}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function listedFromWorkos(row: unknown): ListedUserApiKey | undefined {
	const record = asRecord(row);
	if (record === undefined) return undefined;
	const id = typeof record.id === "string" ? record.id : "";
	const name = typeof record.name === "string" ? record.name : "";
	const createdAt = typeof record.created_at === "string" ? record.created_at : "";
	if (id === "" || createdAt === "") return undefined;
	const lastUsed =
		typeof record.last_used_at === "string" && record.last_used_at !== ""
			? record.last_used_at
			: null;
	return { id, name, created_at: createdAt, last_used_at: lastUsed };
}

export function createUserApiKeyClient(options: UserApiKeyClientOptions = {}): UserApiKeyClient {
	const workosApiKey = options.workosApiKey?.trim() ?? "";
	const enabled = workosApiKey !== "";
	const defaultOrganizationId = options.organizationId?.trim() || undefined;
	const baseUrl = (options.baseUrl ?? DEFAULT_WORKOS_API_BASE_URL).replace(/\/$/, "");
	const fetchImpl = options.fetchImpl ?? fetch;

	async function request(
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ status: number; json: unknown }> {
		if (!enabled) {
			throw new UserApiKeyClientError(
				"unavailable",
				"API token management is not configured (WORKOS_API_KEY is unset)",
				503,
			);
		}
		let response: Response;
		try {
			response = await fetchImpl(`${baseUrl}${path}`, {
				method,
				headers: workosHeaders(workosApiKey),
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
			});
		} catch {
			throw new UserApiKeyClientError("unavailable", "WorkOS API key management unreachable", 503);
		}
		if (response.status === 204) {
			return { status: 204, json: null };
		}
		const json = response.headers.get("content-type")?.includes("json")
			? await readJson(response)
			: null;
		if (!response.ok) {
			throw mapHttpError(response.status, "WorkOS rejected the API key request");
		}
		return { status: response.status, json };
	}

	return {
		enabled,
		defaultOrganizationId,
		async create(userId, createOptions) {
			const { json } = await request("POST", WORKOS_USER_API_KEYS_PATH(userId), {
				name: createOptions.name,
				organization_id: createOptions.organizationId,
				permissions: createOptions.permissions ?? [ACCOUNT_TOKEN_PERMISSION],
			});
			const record = asRecord(json);
			const id = typeof record?.id === "string" ? record.id : "";
			const name = typeof record?.name === "string" ? record.name : createOptions.name;
			const value = typeof record?.value === "string" ? record.value : "";
			if (id === "" || value === "") {
				throw new UserApiKeyClientError(
					"unavailable",
					"WorkOS create response omitted the one-time secret",
					503,
				);
			}
			return { id, name, value };
		},
		async list(userId, listOptions) {
			const params = new URLSearchParams();
			params.set("limit", "100");
			if (listOptions?.organizationId !== undefined && listOptions.organizationId !== "") {
				params.set("organization_id", listOptions.organizationId);
			}
			const query = params.toString();
			const { json } = await request("GET", `${WORKOS_USER_API_KEYS_PATH(userId)}?${query}`);
			const record = asRecord(json);
			const data = Array.isArray(record?.data) ? record.data : Array.isArray(json) ? json : [];
			const listed: ListedUserApiKey[] = [];
			for (const row of data) {
				const mapped = listedFromWorkos(row);
				if (mapped !== undefined) listed.push(mapped);
			}
			return listed;
		},
		async delete(id) {
			await request("DELETE", WORKOS_API_KEY_PATH(id));
		},
	};
}

/** Resolve the WorkOS organization the user-owned key must belong to. */
export function resolveTokenOrganizationId(
	authExtra: Record<string, unknown> | undefined,
	jwtPayload: Record<string, unknown> | undefined,
	fallback: string | undefined,
): string | undefined {
	const fromExtra = typeof authExtra?.org_id === "string" ? authExtra.org_id.trim() : "";
	if (fromExtra !== "") return fromExtra;
	const fromJwt = typeof jwtPayload?.org_id === "string" ? jwtPayload.org_id.trim() : "";
	if (fromJwt !== "") return fromJwt;
	const fromFallback = fallback?.trim() ?? "";
	return fromFallback === "" ? undefined : fromFallback;
}

export function tokenUnavailableResponse(description: string): Response {
	return new Response(JSON.stringify({ error: "unavailable", error_description: description }), {
		status: 503,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
		},
	});
}
