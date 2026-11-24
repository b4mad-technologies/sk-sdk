// Pre-flight manifest validation for the authoring SDK.
//
// This is NOT a client-side reimplementation of the validator (which would drift
// from the server — the thing ADR-0009 D-2 forbids). It calls the SAME Rust
// `spellkave-validate` core, compiled to wasm (`spellkave-validate-wasm`), over
// the canonical TOML parse path — the identical code `r_apply_world_manifest`
// runs at admission. So a clean result here means "the server would admit this"
// (modulo a few cross-bundle checks the server defers to live admission). The
// crate stays the single source of truth; this is just an in-process front door
// to it — no live node, no shell-out.

import {
	validate_manifest_toml,
	validate_manifest_toml_with_containment_context,
} from "@spellkave/validate-wasm";
import { type Diagnostic, diagnosticsFromJson } from "./diagnostics";
import { inspectManifest } from "./inspect";
import { renderManifest, type WorldManifest } from "./manifest";
import {
	type SchemaMetadataAttachmentRow,
	type SchemaMetadataNamespaceRow,
	validateMetadataRows,
} from "./metadata";

export type { Diagnostic, DiagnosticSeverity, DiagnosticSpan } from "./diagnostics";

interface SchemaActorCapabilityRow {
	actor_entity_key: string;
	capability_id: string;
}

interface SchemaAffordanceTemplateRow {
	niche_id?: string;
	template_id?: string;
}

interface SchemaNicheDefinitionRow {
	niche_id?: string;
	provider?: string;
}

export function validateActorCapabilityRows(
	rows: SchemaActorCapabilityRow[] | undefined,
	pathPrefix = "actor_capabilities",
): Diagnostic[] {
	const diags: Diagnostic[] = [];
	const seen = new Map<string, number>();
	for (const [index, row] of (rows ?? []).entries()) {
		const key = `${row.actor_entity_key}::${row.capability_id}`;
		const priorIndex = seen.get(key);
		if (priorIndex !== undefined) {
			diags.push({
				code: "WA-CAP-001",
				severity: "warning",
				message:
					`duplicate actor_capabilities row for (actor_entity_key='${row.actor_entity_key}', ` +
					`capability_id='${row.capability_id}') at index ${index} (first at index ${priorIndex}) — ` +
					"the ADR-0085 commit upsert keys on this pair alone, so this row silently replaces " +
					"the earlier one's extent instead of adding a second one; mint a distinct capability_id " +
					"per extent if both grants are intended (sk-dms.28)",
				path: `${pathPrefix}[${index}]`,
				details: row,
			});
			continue;
		}
		seen.set(key, index);
	}
	return diags;
}

function capabilityNicheProviderDiag(
	nicheId: string,
	path: string,
	details: unknown,
	why: string,
): Diagnostic {
	return {
		code: "WA-CAP-002",
		severity: "fatal",
		message:
			`capability-shaped niche '${nicheId}' ${why} — provider is required on capability:* ` +
			'niches (author provider = "actor" | "entity" | "place" explicitly). The empty/place ' +
			"default is not allowed here: it fails closed silently, which is how class features " +
			"became unusable outside one room (sk-0m4.69). Ordinary (non-capability:*) niches " +
			"keep today's empty-provider = place-provided behaviour.",
		path,
		details,
	};
}

/**
 * sk-0m4.69 / WA-CAP-002: `provider` is REQUIRED on any niche whose id carries
 * the `capability:` prefix. Authoring one without a provider (a definition
 * row with provider empty, or an affordance using `capability:*` with no
 * definition row at all) is a fatal error, not a silent place-provided
 * default. Do not flip the default to actor — fail-closed is correct; the
 * defect is that the failure was silent and, for capability:* niches, the
 * default was wrong in every observed case.
 */
export function validateCapabilityNicheProvider(
	nicheRows: SchemaNicheDefinitionRow[] | undefined,
	affordanceRows: SchemaAffordanceTemplateRow[] | undefined,
	nichePathPrefix = "niche_definitions",
	affordancePathPrefix = "affordance_templates",
): Diagnostic[] {
	const diags: Diagnostic[] = [];
	const defined = new Set<string>();
	for (const [index, row] of (nicheRows ?? []).entries()) {
		const nicheId = row.niche_id;
		if (typeof nicheId !== "string" || !nicheId.startsWith("capability:")) continue;
		defined.add(nicheId);
		const provider = typeof row.provider === "string" ? row.provider.trim() : "";
		if (provider === "") {
			diags.push(
				capabilityNicheProviderDiag(
					nicheId,
					`${nichePathPrefix}[${index}]`,
					row,
					"has a niche_definitions row with no provider",
				),
			);
		}
	}
	for (const [index, row] of (affordanceRows ?? []).entries()) {
		const nicheId = row.niche_id;
		if (typeof nicheId !== "string" || !nicheId.startsWith("capability:")) continue;
		if (defined.has(nicheId)) continue;
		diags.push(
			capabilityNicheProviderDiag(
				nicheId,
				`${affordancePathPrefix}[${index}]`,
				row,
				"is used by an affordance but has no niche_definitions row, so no provider is authored",
			),
		);
	}
	return diags;
}

/**
 * sk-jay0.7.23.29: `commitOrReport` (`@spellkave/tool-authoring`'s
 * `authoring-verbs.ts`) calls this function once per AUTHOR tool call, each
 * time re-rendering (workspace ∪ augmented target) to a fresh TOML string and
 * re-running the FULL wasm validator over it — so a caller that drives many
 * calls against the SAME target (e.g. `spellkave-srd-cc`'s verb-runner, which
 * re-issues the identical bundle-header/tag-vocabulary/action-economy/
 * dsl-macro seed sequence for every generated unit) redundantly re-validates
 * byte-identical input over and over: a CPU profile of the `classes` chapter
 * put ~70% of self time inside the wasm validator alone.
 *
 * `validateManifestToml` is a pure function of its TOML and optional containment
 * reference context (no side effects), so memoizing it by the exact input string is
 * always correct — a cache hit returns EXACTLY what a fresh call would have
 * computed, byte-identical diagnostics included. Bounded by total cache-key
 * bytes (not entry count): a naive count cap would let a run's many
 * large-but-unique final per-entity manifests (workspace ∪ whole target,
 * never looked up again) evict the small, HIGH-REUSE seed-step entries that
 * actually deliver the win; a byte budget with LRU eviction keeps the
 * frequently-reused keys resident regardless of how many one-shot large keys
 * pass through. Content-addressed by design: a target/workspace change
 * produces a different TOML/context key, so there is no separate invalidation
 * path to get wrong.
 */
const VALIDATE_MANIFEST_TOML_CACHE_BYTE_BUDGET = 64 * 1024 * 1024;
const validateManifestTomlCache = new Map<string, Diagnostic[]>();
let validateManifestTomlCacheBytes = 0;

function validateManifestTomlCacheGet(toml: string): Diagnostic[] | undefined {
	const hit = validateManifestTomlCache.get(toml);
	if (hit === undefined) return undefined;
	// Move to most-recently-used (Map iterates in insertion order).
	validateManifestTomlCache.delete(toml);
	validateManifestTomlCache.set(toml, hit);
	return hit;
}

function validateManifestTomlCacheSet(toml: string, diagnostics: Diagnostic[]): void {
	validateManifestTomlCache.set(toml, diagnostics);
	validateManifestTomlCacheBytes += toml.length;
	while (
		validateManifestTomlCacheBytes > VALIDATE_MANIFEST_TOML_CACHE_BYTE_BUDGET &&
		validateManifestTomlCache.size > 1
	) {
		const oldestKey = validateManifestTomlCache.keys().next().value;
		if (oldestKey === undefined) break;
		validateManifestTomlCacheBytes -= oldestKey.length;
		validateManifestTomlCache.delete(oldestKey);
	}
}

/** Test-only: drop every cached entry (keeps cross-test isolation honest). */
export function clearValidateManifestTomlCache(): void {
	validateManifestTomlCache.clear();
	validateManifestTomlCacheBytes = 0;
}

/**
 * Validate a manifest from its TOML source. Returns the validator's diagnostics
 * (empty array = valid). Never throws on a rejected manifest — a rejection is a
 * normal result, surfaced as diagnostics, so authoring loops can treat it as a
 * finding rather than an exception.
 *
 * Memoized by exact TOML and optional containment context — see the cache doc comment above. Every
 * caller gets its own shallow-copied array so no caller can mutate the
 * cached entry (none currently do; the copy is defensive and cheap relative
 * to the wasm validate call it protects).
 */
export function validateManifestToml(toml: string, containmentContextJson?: string): Diagnostic[] {
	const cacheKey =
		containmentContextJson === undefined ? toml : JSON.stringify([toml, containmentContextJson]);
	const cached = validateManifestTomlCacheGet(cacheKey);
	if (cached !== undefined) return cached.slice();
	const diagnostics = diagnosticsFromJson(
		containmentContextJson === undefined
			? validate_manifest_toml(toml)
			: validate_manifest_toml_with_containment_context(toml, containmentContextJson),
	);
	try {
		const manifest = inspectManifest(toml).manifest as Record<string, unknown>;
		diagnostics.push(
			...validateMetadataRows(
				manifest.metadata_attachments as SchemaMetadataAttachmentRow[] | undefined,
				manifest.metadata_namespaces as SchemaMetadataNamespaceRow[] | undefined,
			),
		);
		diagnostics.push(
			...validateActorCapabilityRows(
				manifest.actor_capabilities as SchemaActorCapabilityRow[] | undefined,
			),
		);
		diagnostics.push(
			...validateCapabilityNicheProvider(
				manifest.niche_definitions as SchemaNicheDefinitionRow[] | undefined,
				manifest.affordance_templates as SchemaAffordanceTemplateRow[] | undefined,
			),
		);
	} catch {
		// Parse errors are already represented by validate_manifest_toml.
	}
	validateManifestTomlCacheSet(cacheKey, diagnostics);
	return diagnostics.slice();
}

/**
 * Render a typed `WorldManifest` to TOML and validate it in one step — the
 * common authoring path (build rows → check before apply).
 */
export function validateManifest(manifest: WorldManifest): Diagnostic[] {
	return validateManifestToml(renderManifest(manifest));
}

/** True iff the manifest has no fatal/warning diagnostics (clean for admission). */
export function isValid(diagnostics: Diagnostic[]): boolean {
	return diagnostics.length === 0;
}
