// Persona-profile + app-config TOML model and loaders.
//
// Mirrors the Rust types in `client/src/config.rs` and `client/src/config_io.rs`:
//
//   AppConfig {
//     default_profile: Option<String>,
//   }
//
//   PersonaProfile {
//     connection: { url, db, env? }
//     identity:   { role, in_world_self, credential? }
//     defaults:   { mode? }
//   }
//
// The Rust code uses `serde(deny_unknown_fields)`. We mirror that here by
// rejecting any top-level / table keys that are not in the schema. This
// prevents host-private extensions to the profile shape from drifting away
// from the Rust contract.

import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import type { CredentialRef } from "./credential";

export interface AppConfig {
	default_profile?: string;
}

export interface ConnectionConfig {
	url: string;
	db: string;
	env?: string;
}

export interface IdentityConfig {
	role: string;
	in_world_self: string;
	credential?: CredentialRef;
}

export interface PersonaDefaults {
	mode?: string;
}

export interface PersonaProfile {
	connection: ConnectionConfig;
	identity: IdentityConfig;
	defaults: PersonaDefaults;
}

const APP_CONFIG_KEYS = new Set(["default_profile"]);
const PROFILE_TABLES = new Set(["connection", "identity", "defaults"]);
const CONNECTION_KEYS = new Set(["url", "db", "env"]);
const IDENTITY_KEYS = new Set(["role", "in_world_self", "credential"]);
const DEFAULTS_KEYS = new Set(["mode"]);

export function parseAppConfig(text: string): AppConfig {
	const raw = parseToml(text) as Record<string, unknown>;
	for (const k of Object.keys(raw)) {
		if (!APP_CONFIG_KEYS.has(k)) {
			throw new Error(`unknown field in config.toml: '${k}'`);
		}
	}
	const out: AppConfig = {};
	if (raw.default_profile !== undefined) {
		if (typeof raw.default_profile !== "string") {
			throw new Error("config.toml default_profile must be a string");
		}
		out.default_profile = raw.default_profile;
	}
	return out;
}

export function parsePersonaProfile(text: string): PersonaProfile {
	const raw = parseToml(text) as Record<string, unknown>;
	for (const k of Object.keys(raw)) {
		if (!PROFILE_TABLES.has(k)) {
			throw new Error(`unknown table in profile: '${k}'`);
		}
	}
	const connection = parseConnectionTable(raw.connection);
	const identity = parseIdentityTable(raw.identity);
	const defaults = parseDefaultsTable(raw.defaults);
	return { connection, identity, defaults };
}

function parseConnectionTable(raw: unknown): ConnectionConfig {
	if (raw === undefined) {
		throw new Error("profile missing required [connection] table");
	}
	if (typeof raw !== "object" || raw === null) {
		throw new Error("profile [connection] is not a table");
	}
	const obj = raw as Record<string, unknown>;
	for (const k of Object.keys(obj)) {
		if (!CONNECTION_KEYS.has(k)) {
			throw new Error(`unknown field in [connection]: '${k}'`);
		}
	}
	const url = requireString(obj, "connection.url");
	const db = requireString(obj, "connection.db");
	const env = optionalString(obj, "connection.env");
	return env === undefined ? { url, db } : { url, db, env };
}

function parseIdentityTable(raw: unknown): IdentityConfig {
	if (raw === undefined) {
		throw new Error("profile missing required [identity] table");
	}
	if (typeof raw !== "object" || raw === null) {
		throw new Error("profile [identity] is not a table");
	}
	const obj = raw as Record<string, unknown>;
	for (const k of Object.keys(obj)) {
		if (!IDENTITY_KEYS.has(k)) {
			throw new Error(`unknown field in [identity]: '${k}'`);
		}
	}
	const role = requireString(obj, "identity.role");
	const in_world_self = requireString(obj, "identity.in_world_self");
	const credential = parseCredentialRef(obj.credential);
	return credential === undefined ? { role, in_world_self } : { role, in_world_self, credential };
}

function parseDefaultsTable(raw: unknown): PersonaDefaults {
	if (raw === undefined) return {};
	if (typeof raw !== "object" || raw === null) {
		throw new Error("profile [defaults] is not a table");
	}
	const obj = raw as Record<string, unknown>;
	for (const k of Object.keys(obj)) {
		if (!DEFAULTS_KEYS.has(k)) {
			throw new Error(`unknown field in [defaults]: '${k}'`);
		}
	}
	const mode = optionalString(obj, "defaults.mode");
	return mode === undefined ? {} : { mode };
}

function parseCredentialRef(raw: unknown): CredentialRef | undefined {
	if (raw === undefined) return undefined;
	if (typeof raw !== "object" || raw === null) {
		throw new Error("identity.credential must be an inline table");
	}
	const obj = raw as Record<string, unknown>;
	const kind = obj.kind;
	if (typeof kind !== "string") {
		throw new Error("identity.credential.kind is required (env_var | file | inline)");
	}
	switch (kind) {
		case "env_var": {
			const name = requireString(obj, "identity.credential.name");
			const allowed = new Set(["kind", "name"]);
			checkOnlyKeys(obj, allowed, "identity.credential");
			return { kind: "env_var", name };
		}
		case "file": {
			const path = requireString(obj, "identity.credential.path");
			const allowed = new Set(["kind", "path"]);
			checkOnlyKeys(obj, allowed, "identity.credential");
			return { kind: "file", path };
		}
		case "inline": {
			const value = requireString(obj, "identity.credential.value");
			const allowed = new Set(["kind", "value"]);
			checkOnlyKeys(obj, allowed, "identity.credential");
			return { kind: "inline", value };
		}
		default:
			throw new Error(`identity.credential.kind '${kind}' is not one of env_var | file | inline`);
	}
}

function requireString(obj: Record<string, unknown>, label: string): string {
	const v = obj[label.split(".").pop() ?? label];
	if (typeof v !== "string") {
		throw new Error(`${label} is required and must be a string`);
	}
	return v;
}

function optionalString(obj: Record<string, unknown>, label: string): string | undefined {
	const key = label.split(".").pop() ?? label;
	const v = obj[key];
	if (v === undefined) return undefined;
	if (typeof v !== "string") {
		throw new Error(`${label} must be a string when present`);
	}
	return v;
}

function checkOnlyKeys(obj: Record<string, unknown>, allowed: Set<string>, label: string): void {
	for (const k of Object.keys(obj)) {
		if (!allowed.has(k)) {
			throw new Error(`unknown field in ${label}: '${k}'`);
		}
	}
}

/**
 * Cross-field validity for a parsed profile. Mirrors Rust
 * `validate_persona_contract`: connection/identity strings must not be empty.
 */
export function validatePersonaContract(profile: PersonaProfile): void {
	const c = profile.connection;
	if (c.url.trim().length === 0) {
		throw new Error("profile connection.url must not be empty");
	}
	if (c.db.trim().length === 0) {
		throw new Error("profile connection.db must not be empty");
	}
	const id = profile.identity;
	if (id.role.trim().length === 0) {
		throw new Error("profile identity.role must not be empty");
	}
	if (id.in_world_self.trim().length === 0) {
		throw new Error("profile identity.in_world_self must not be empty");
	}
}

/**
 * Render a profile as TOML that `parsePersonaProfile` reads back unchanged.
 * `header` lines are written as leading `#` comments.
 */
export function serializePersonaProfile(
	profile: PersonaProfile,
	header: readonly string[] = [],
): string {
	const body: Record<string, unknown> = {
		connection: { ...profile.connection },
		identity: { ...profile.identity },
	};
	if (Object.keys(profile.defaults).length > 0) body.defaults = { ...profile.defaults };
	const comments = header.map((line) => `# ${line}`.trimEnd()).join("\n");
	return `${comments.length > 0 ? `${comments}\n` : ""}${stringifyToml(body)}\n`;
}

export interface ProfileIo {
	readFileSync?: (path: string) => string;
}

export function loadAppConfigFromDisk(path: string, io: ProfileIo = {}): AppConfig {
	const text = read(path, io);
	if (text === undefined) return {};
	return parseAppConfig(text);
}

export function loadProfileFromDisk(path: string, io: ProfileIo = {}): PersonaProfile {
	const text = read(path, io);
	if (text === undefined) {
		throw new Error(`profile file not found: ${path}`);
	}
	const profile = parsePersonaProfile(text);
	validatePersonaContract(profile);
	return profile;
}

function read(path: string, io: ProfileIo): string | undefined {
	const reader = io.readFileSync;
	if (reader === undefined) {
		throw new Error(
			"profile loaders require io.readFileSync; use @spellkave/sdk/node for the Node-bound default",
		);
	}
	try {
		return reader(path);
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
		throw err;
	}
}
