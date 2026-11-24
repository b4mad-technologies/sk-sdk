// embedded-manifest: {"category":"production_schema_constructor","rationale":"The offline DM data compiler constructs a versioned data envelope over admitted tables, not an embedded world manifest or runtime authority grant.","signatures":["schema_shape"]}
/** Offline data compilation only. No runtime authority or publication grant. */
import { validate_dm_srd_tables_json } from "@spellkave/validate-wasm";

export interface DmSrdData {
	schema_version: 1;
	tables: Record<string, unknown>;
	content_hash: string;
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
			.join(",")}}`;
	}
	const encoded = JSON.stringify(value);
	if (encoded === undefined) throw new Error("DM SRD data requires JSON values");
	return encoded;
}
/** Lossless JSON source values only; the shared Rust validator admits the shape. */
export async function compileDmSrdData(tables: unknown): Promise<DmSrdData> {
	const encoded = canonical(tables);
	const errors: string[] = JSON.parse(validate_dm_srd_tables_json(encoded));
	if (errors.length) throw new Error(`Invalid DM SRD tables: ${errors.join("; ")}`);
	const content = { schema_version: 1 as const, tables: JSON.parse(encoded) };
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonical(content)),
	);
	const hash = Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return { ...content, content_hash: `sha256:${hash}` };
}
/** Publish-time tooling must derive again, rather than trust a supplied hash. */
export async function parseDmSrdData(encoded: string): Promise<DmSrdData> {
	const value: unknown = JSON.parse(encoded);
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new Error("Invalid DM SRD data envelope");
	const fields = value as Record<string, unknown>;
	if (
		fields.schema_version !== 1 ||
		Object.keys(fields).sort().join(",") !== "content_hash,schema_version,tables"
	)
		throw new Error("Invalid DM SRD data envelope");
	const compiled = await compileDmSrdData(fields.tables);
	if (canonical(compiled) !== canonical(value)) throw new Error("DM SRD data hash mismatch");
	return compiled;
}
