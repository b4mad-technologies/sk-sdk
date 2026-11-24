export interface IncludedManifestMetadata {
	/** The exact JSON-safe `[metadata]` tree authored by this include file. */
	metadata: Record<string, unknown>;
	/** The same fragment with its root `[metadata]` tree omitted for row flattening. */
	rowsToml: string;
}

export interface RenderManifestIncludeOptions {
	/** Keep an authored `[metadata]` table in the include. Defaults to false. */
	retainMetadata?: boolean;
}

/**
 * Turn a complete renderer-authored workspace manifest into an include. The
 * Rust formatter removes root-owned bundle/include fields without exposing
 * native gameplay integers to JavaScript.
 */
export function renderManifestIncludeWith(
	render: (source: string, retainMetadata: boolean) => string,
	rendered: string,
	options: RenderManifestIncludeOptions = {},
): string {
	try {
		return render(rendered, options.retainMetadata === true);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`manifest include render failed: ${message}`);
	}
}

function recordOf(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/**
 * Parse and project one direct include in the Rust formatter. Gameplay values
 * remain native TOML values all the way through row rendering, so legal i64
 * and u64 rows never cross JavaScript's lossy number representation.
 * Metadata-free fragments retain their original bytes; metadata-bearing ones
 * return canonical rows with only their local `[metadata]` removed.
 */
export function splitIncludedManifestMetadataWith(
	split: (source: string) => string,
	fragmentToml: string,
): IncludedManifestMetadata {
	let envelope: unknown;
	try {
		envelope = JSON.parse(split(fragmentToml));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`included manifest fragment TOML parse failed: ${message}`);
	}
	if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope)) {
		throw new Error("included manifest fragment splitter returned an invalid envelope.");
	}
	const value = envelope as Record<string, unknown>;
	if (typeof value.rowToml !== "string") {
		throw new Error("included manifest fragment splitter returned no rowToml.");
	}
	return { metadata: recordOf(value.metadata), rowsToml: value.rowToml };
}
