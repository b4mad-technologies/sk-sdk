// Mutable only while a runtime-specific wasm binding initializes. Consumers
// receive the Rust-owned, frozen Node records or the browser's initialized
// web-wasm records through these accessors.
let natural: Readonly<Record<string, string>> = {};
let composite: Readonly<Record<string, readonly string[]>> = {};

export function setRowKindMaps(
	nextNatural: Readonly<Record<string, string>>,
	nextComposite: Readonly<Record<string, readonly string[]>>,
): void {
	natural = nextNatural;
	composite = nextComposite;
}

export function rowKindNaturalKey(): Readonly<Record<string, string>> {
	return natural;
}

export function rowKindCompositeKey(): Readonly<Record<string, readonly string[]>> {
	return composite;
}

// sk-jay0.7.174.15: row kind (or "*") -> fields `r_export_manifest` does not
// round-trip. Rust-owned (`spellkave_schema::export_round_trip`), set by the
// same wasm initializers as the row-kind maps above.
let notRoundTripped: Readonly<Record<string, readonly string[]>> = {};

export function setExportNotRoundTripped(next: Readonly<Record<string, readonly string[]>>): void {
	notRoundTripped = next;
}

/** Fields a live export may differ in from the authored `kind` row without drift. */
export function exportNotRoundTrippedFields(kind: string): readonly string[] {
	return [...(notRoundTripped["*"] ?? []), ...(notRoundTripped[kind] ?? [])];
}
