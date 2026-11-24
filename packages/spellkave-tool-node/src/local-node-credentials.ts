import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const URL = process.env.SPELLKAVE_URL ?? "http://127.0.0.1:3000";
const DB = process.env.SPELLKAVE_DB ?? "spellkave-dev";

/** Resolve the local SpacetimeDB author credential for Node hosts. */
export function liveNodeToken(): string | undefined {
	const envToken = process.env.SPELLKAVE_TOKEN;
	if (envToken && envToken.length > 0) return envToken;
	const ownerToken = cliOwnerToken();
	if (ownerToken !== undefined) return ownerToken;
	const key = credentialKey(URL, DB);
	try {
		const token = decodeRustSdkCredential(
			readFileSync(join(homedir(), ".spacetimedb_client_credentials", key)),
		);
		return token.length > 0 ? token : undefined;
	} catch {
		return undefined;
	}
}

function cliOwnerToken(): string | undefined {
	if (process.env.SPELLKAVE_CLI_AS_OWNER !== "1") return undefined;
	const configPath = process.env.SPACETIME_CONFIG_PATH;
	if (configPath === undefined || configPath.length === 0) return undefined;
	try {
		const raw = readFileSync(configPath, "utf8");
		return raw.match(/^\s*spacetimedb_token\s*=\s*"([^"]+)"/m)?.[1];
	} catch {
		return undefined;
	}
}

function decodeRustSdkCredential(raw: Buffer): string {
	if (raw.length >= 4) {
		const len = raw.readUInt32LE(0);
		if (len > 0 && len <= raw.length - 4)
			return raw
				.subarray(4, 4 + len)
				.toString("utf8")
				.trim();
	}
	return raw.toString("utf8").trim();
}

function credentialKey(url: string, db: string): string {
	let key = "spellkave-";
	for (const ch of `${url}-${db}`) key += /[A-Za-z0-9_-]/.test(ch) ? ch : "_";
	return key;
}
