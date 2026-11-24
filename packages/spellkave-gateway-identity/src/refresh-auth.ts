/**
 * Headless AuthKit refresh-token grant for the improvement-loop machine user
 * (ADR-0124 D-7 / sk-t2qm.11.6 option A).
 *
 * Hits `{issuer}/oauth2/token` — the same AuthKit-domain Connect endpoint
 * the website uses — with RFC 8707 `resource=https://mcp.spellkave.com/mcp`
 * so `iss`/`aud`/`sub` match an interactive login. Never calls
 * `POST /user_management/authenticate`.
 *
 * Provisioning supplies the seed (non-rotating identifiers + initial refresh_token).
 * AuthKit rotates the refresh token on every use, so the live token is
 * written only to a host-side runtime file (separate from the seed and from
 * the ReadOnly gateway container).
 *
 * The loop owns this exchange. The Account API never sees the refresh token.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { worldIdentityFromAccessToken } from "./world-identity.ts";

export const MCP_RESOURCE = "https://mcp.spellkave.com/mcp";

export class AuthKitRefreshAuthError extends Error {
	readonly httpStatus: number;

	constructor(message: string, httpStatus = 0) {
		super(message);
		this.name = "AuthKitRefreshAuthError";
		this.httpStatus = httpStatus;
	}
}

export interface MachineUserRecord {
	refresh_token: string;
	client_id: string;
	issuer: string;
	resource: string;
}

export interface AuthKitRefreshResult {
	accessToken: string;
	iss: string;
	sub: string;
	key: string;
	rotated: boolean;
	record: MachineUserRecord;
}

export function assertAuthKitIssuer(issuer: string): string {
	const trimmed = issuer.trim().replace(/\/$/, "");
	if (trimmed === "") {
		throw new AuthKitRefreshAuthError("issuer is required");
	}
	if (!trimmed.startsWith("https://")) {
		throw new AuthKitRefreshAuthError("issuer must be an https AuthKit domain");
	}
	if (trimmed.includes("api.workos.com")) {
		throw new AuthKitRefreshAuthError(
			"User Management issuer is forbidden; use the AuthKit-domain issuer so Identity = BLAKE3(iss|sub) matches interactive login",
		);
	}
	return trimmed;
}

export function parseMachineUserRecord(value: unknown): MachineUserRecord {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new AuthKitRefreshAuthError("machine-user record must be an object");
	}
	const rec = value as Record<string, unknown>;
	const refresh_token = typeof rec.refresh_token === "string" ? rec.refresh_token.trim() : "";
	const client_id = typeof rec.client_id === "string" ? rec.client_id.trim() : "";
	const issuer = typeof rec.issuer === "string" ? rec.issuer.trim() : "";
	const resource = typeof rec.resource === "string" ? rec.resource.trim() : "";
	if (refresh_token === "" || client_id === "" || issuer === "" || resource === "") {
		throw new AuthKitRefreshAuthError(
			"machine-user record needs refresh_token, client_id, issuer, resource",
		);
	}
	return {
		refresh_token,
		client_id,
		issuer: assertAuthKitIssuer(issuer),
		resource,
	};
}

export function defaultRuntimePath(player: string): string {
	return join(homedir(), ".config", "spellkave", "sim-players", `${player}.json`);
}

export function defaultSeedPath(player: string): string {
	// Per player, so onboarding a second simulated player cannot clobber the
	// first one's seed. Mirrors the runtime file's own per-player naming and
	// the stack's `machineUserSeed-<player>` config key.
	return join(homedir(), ".config", "spellkave", "player-mcp", `machine-user-${player}.seed.json`);
}

export function readRecordFile(path: string): MachineUserRecord | undefined {
	try {
		const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
		return parseMachineUserRecord(raw);
	} catch {
		return undefined;
	}
}

export function writeRecordFile(path: string, record: MachineUserRecord): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	chmodSync(tmp, 0o600);
	renameSync(tmp, path);
	chmodSync(path, 0o600);
}

export function buildRefreshForm(input: MachineUserRecord): URLSearchParams {
	return new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: input.refresh_token,
		client_id: input.client_id,
		resource: input.resource,
	});
}

export async function refreshAccessToken(
	record: MachineUserRecord,
	options: { fetchImpl?: typeof fetch; tokenEndpoint?: string } = {},
): Promise<AuthKitRefreshResult> {
	const issuer = assertAuthKitIssuer(record.issuer);
	const fetchImpl = options.fetchImpl ?? fetch;
	const tokenEndpoint = options.tokenEndpoint ?? `${issuer}/oauth2/token`;
	let response: Response;
	try {
		response = await fetchImpl(tokenEndpoint, {
			method: "POST",
			headers: {
				accept: "application/json",
				"content-type": "application/x-www-form-urlencoded",
			},
			body: buildRefreshForm({ ...record, issuer }).toString(),
		});
	} catch {
		throw new AuthKitRefreshAuthError("AuthKit token endpoint unreachable", 503);
	}

	let json: Record<string, unknown> = {};
	try {
		json = (await response.json()) as Record<string, unknown>;
	} catch {
		throw new AuthKitRefreshAuthError(
			`AuthKit token endpoint returned non-JSON (HTTP ${response.status})`,
			response.status,
		);
	}

	if (!response.ok) {
		const code = typeof json.error === "string" ? json.error : "unknown";
		throw new AuthKitRefreshAuthError(
			`AuthKit refresh grant failed: HTTP ${response.status} ${code}`,
			response.status,
		);
	}

	const accessToken = typeof json.access_token === "string" ? json.access_token : "";
	if (accessToken === "") {
		throw new AuthKitRefreshAuthError("AuthKit refresh grant omitted access_token");
	}

	const nextRefresh =
		typeof json.refresh_token === "string" && json.refresh_token.trim() !== ""
			? json.refresh_token.trim()
			: record.refresh_token;
	const rotated = nextRefresh !== record.refresh_token;
	const nextRecord: MachineUserRecord = { ...record, issuer, refresh_token: nextRefresh };

	const identity = worldIdentityFromAccessToken(accessToken);
	if (identity.iss.replace(/\/$/, "") !== issuer) {
		throw new AuthKitRefreshAuthError(
			"refresh grant returned foreign iss (refusing — would mint a second world identity)",
		);
	}
	return {
		accessToken,
		iss: identity.iss,
		sub: identity.sub,
		key: identity.key,
		rotated,
		record: nextRecord,
	};
}

export async function mintMachineAccessToken(options: {
	player: string;
	seedPath?: string;
	runtimePath?: string;
	fetchImpl?: typeof fetch;
}): Promise<AuthKitRefreshResult> {
	const runtimePath = options.runtimePath ?? defaultRuntimePath(options.player);
	const seedPath = options.seedPath ?? defaultSeedPath(options.player);
	const runtime = readRecordFile(runtimePath);
	const seed = readRecordFile(seedPath);
	const record = runtime ?? seed;
	if (record === undefined) {
		throw new AuthKitRefreshAuthError(
			`no machine-user seed or runtime record for '${options.player}' (looked at ${runtimePath} and ${seedPath}). Install it: scripts/sim/install-machine-seed.sh --player ${options.player}`,
		);
	}
	const result = await refreshAccessToken(record, { fetchImpl: options.fetchImpl });
	// Write the rotated token to the runtime file BEFORE the caller prints
	// the access token. Never write back to the provisioned seed.
	writeRecordFile(runtimePath, result.record);
	return result;
}
