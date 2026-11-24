// Bundle-level manifest reading: the fs half of `sk` (#1983).
//
// WHY THIS IS NOT A REGISTRY TOOL. Every tool in
// the canonical AUTHOR registry works through host-provided ports
// (`AuthorWorkspace`, `AuthorTarget`) — not one of them takes a filesystem
// path, because the host, not the tool, decides where content lives. That
// invariant is what lets the same registry serve an in-process Pi session and
// a live-connected agent. The commands here take paths and resolve a bundle's
// `[[include]]` fragments plus its `depends_on` closure off disk, so they
// belong to this CLI rather than to a surface an end user is handed on a live
// server. #1983 anticipates exactly this: "Bundle include-resolution needs a
// home with fs access either way."
//
// Ported from `packages/spellkave-author-cli/src/cli.ts`, which this replaces.

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
	type Diagnostic,
	inspectManifest,
	LINT_RULES,
	type LintFinding,
	lintManifest,
	manifestTagPrefixFamilies,
	patchManifest,
	renderSchemaManifest,
	renderSchemaManifestJson,
	splitIncludedManifestMetadata,
	validateManifestToml,
} from "@spellkave/world-author";
import { parse as parseToml } from "smol-toml";

export interface BundleBodies {
	/** The root manifest verbatim — the one file carrying the `#:schema` header. */
	rootToml: string;
	/** The root's own rows with that header stripped, for appending after another root. */
	rootRowsToml: string;
	/** Each resolved `[[include]]` fragment's row-only text. */
	bodies: string[];
	/** Real `[metadata]` authored by each include, paired with its declaration path. */
	fragmentMetadata: Array<{ path: string; metadata: Record<string, unknown> }>;
	included: string[];
	missing: string[];
	/** An include that exists but is structurally rejected (e.g. ADR-0145 `applyset`). */
	fragmentErrors: Array<{ path: string; message: string }>;
}

/**
 * Strip the single-root-only header lines so a manifest's rows can be appended
 * after another manifest's root. A merged document may carry exactly one
 * `#:schema` directive, one `schema_version`, one `applyset`, and one
 * root metadata tree (including nested tables and arrays of tables). Original
 * roots remain verbatim in `rootToml`; this projection never rewrites row values.
 */
export function stripRootOnlyHeader(toml: string): string {
	const out: string[] = [];
	let inMetadata = false;
	let inRoot = true;
	let omitStatement = false;
	let quote: string | undefined;
	let depth = 0;
	for (const line of toml.split("\n")) {
		// Only statement boundaries can start tables/keys. Documentation and row
		// strings may themselves contain TOML-looking lines; arrays may span lines.
		if (quote === undefined && depth === 0) {
			omitStatement = line.trimStart().startsWith("#:schema");
			const table = /^\s*\[\[?\s*((?:"(?:\\.|[^"\\])*"|'[^']*'|[\w-]+))\s*(?:\.|\])/.exec(line);
			const assignment = inRoot
				? /^\s*((?:"(?:\\.|[^"\\])*"|'[^']*'|[\w-]+))\s*(?:\.|=)/.exec(line)
				: null;
			const keySource = table?.[1] ?? assignment?.[1];
			if (keySource !== undefined) {
				// Decode quoted keys with the TOML parser, without parsing any row numbers.
				const key = /^["']/.test(keySource)
					? Object.keys(parseToml(`${keySource} = 0`))[0]
					: keySource;
				if (table) {
					inRoot = false;
					inMetadata = key === "metadata";
				} else {
					// ADR-0145: a dependency's applyset names ITS set, not this one.
					omitStatement = key === "schema_version" || key === "applyset" || key === "metadata";
				}
			}
		}
		if (!inMetadata && !omitStatement) out.push(line);
		// Track only lexical boundaries; inspectManifest already validated the root.
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (quote !== undefined) {
				if (quote[0] === '"' && char === "\\") {
					i++;
				} else if (line.startsWith(quote, i)) {
					i += quote.length - 1;
					// Multiline strings allow one or two extra quotes at their end.
					if (quote.length === 3) while (line[i + 1] === char) i++;
					quote = undefined;
				}
			} else if (char === "#") {
				break;
			} else if (char === '"' || char === "'") {
				quote = line.startsWith(char.repeat(3), i) ? char.repeat(3) : char;
				i += quote.length - 1;
			} else if (char === "[" || char === "{") {
				depth++;
			} else if (char === "]" || char === "}") {
				depth--;
			}
		}
	}
	return out.join("\n").trim();
}

/** Read a manifest plus every `[[include]]` fragment it resolves, recording misses. */
export async function readBundleBodies(manifestPath: string): Promise<BundleBodies> {
	const rootToml = await readFile(manifestPath, "utf8");
	const root = inspectManifest(rootToml);
	const dir = dirname(manifestPath);
	const includes = Array.isArray(root.manifest.include) ? root.manifest.include : [];
	const bodies: string[] = [];
	const fragmentMetadata: Array<{ path: string; metadata: Record<string, unknown> }> = [];
	const included: string[] = [];
	const missing: string[] = [];
	const fragmentErrors: Array<{ path: string; message: string }> = [];
	for (const entry of includes) {
		const relPath =
			entry && typeof entry === "object" && typeof (entry as { path?: unknown }).path === "string"
				? (entry as { path: string }).path
				: undefined;
		if (relPath === undefined) continue;
		try {
			const fragment = splitIncludedManifestMetadata(await readFile(resolve(dir, relPath), "utf8"));
			bodies.push(fragment.rowsToml);
			fragmentMetadata.push({ path: relPath, metadata: fragment.metadata });
			included.push(relPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				// A missing fragment is REPORTED, never fatal here: the caller shows
				// it beside the diagnostics so a broken include reads as a broken
				// include rather than as a mysteriously incomplete row set.
				missing.push(relPath);
				continue;
			}
			// A fragment that exists but is structurally rejected (e.g. ADR-0145: an
			// include declaring its own `applyset`) is likewise REPORTED, not thrown:
			// the caller turns it into a fatal `Diagnostic` so `sk validate --bundle`
			// exits through the documented contract instead of crashing.
			const message = error instanceof Error ? error.message : String(error);
			fragmentErrors.push({ path: relPath, message });
		}
	}
	return {
		rootToml,
		rootRowsToml: stripRootOnlyHeader(rootToml),
		bodies,
		fragmentMetadata,
		included,
		missing,
		fragmentErrors,
	};
}

/**
 * Merge a root manifest, each dependency bundle, and every include fragment
 * into ONE document. This is the whole point of `--bundle`: cross-row checks
 * that a single-file validate structurally cannot see (a niche referenced from
 * one fragment and defined in another, a `depends_on` bundle's vocabulary) only
 * fire against the real merged catalog.
 */
async function mergeBundle(
	manifestPath: string,
	depPaths: string[],
): Promise<{
	merged: string;
	included: string[];
	missing: string[];
	fragmentErrors: Array<{ path: string; message: string }>;
}> {
	const root = await readBundleBodies(manifestPath);
	const depBodies: string[] = [];
	const missing = [...root.missing];
	const fragmentErrors = [...root.fragmentErrors];
	for (const dep of depPaths) {
		const bodies = await readBundleBodies(dep);
		if (bodies.rootRowsToml.length > 0) depBodies.push(bodies.rootRowsToml);
		depBodies.push(...bodies.bodies);
		missing.push(...bodies.missing);
		fragmentErrors.push(...bodies.fragmentErrors);
	}
	// Keep each bundle's fragments immediately after its own `[[bundles]]` row.
	// Nested tables such as `[[bundles.tag_prefixes]]` bind to the most recent
	// parent array entry, so inserting dependencies between the root and its
	// fragments would attach the root's vocabulary to the final dependency.
	// The root TOML still carries the document's only schema/version header.
	return {
		merged: [root.rootToml, ...root.bodies, ...depBodies].join("\n\n"),
		included: root.included,
		missing,
		fragmentErrors,
	};
}

/** {@link mergeBundle}, parsed — for callers that want the rows, not the text. */
export async function readMergedManifest(
	manifestPath: string,
	depPaths: string[],
	bundle: boolean,
): Promise<{
	manifest: Record<string, unknown>;
	includedFiles: string[];
	depManifests: string[];
	missingIncludes: string[];
}> {
	if (!bundle) {
		return {
			manifest: inspectManifest(await readFile(manifestPath, "utf8")).manifest,
			includedFiles: [],
			depManifests: [],
			missingIncludes: [],
		};
	}
	const { merged, included, missing } = await mergeBundle(manifestPath, depPaths);
	try {
		return {
			manifest: inspectManifest(merged).manifest,
			includedFiles: included,
			depManifests: depPaths,
			missingIncludes: missing,
		};
	} catch {
		// Concatenated TOML can fail schema-aware re-parse on nested tables such as
		// `[[bundles.tag_prefixes]]`. Fall back to per-document row assembly so map
		// and inspect still see the full include closure.
		const root = await readBundleBodies(manifestPath);
		const documents: string[] = [root.rootToml];
		const allIncluded = [...root.included];
		const allMissing = [...root.missing];
		for (const dep of depPaths) {
			const bodies = await readBundleBodies(dep);
			documents.push(bodies.rootToml, ...bodies.bodies);
			allIncluded.push(...bodies.included);
			allMissing.push(...bodies.missing);
		}
		documents.push(...root.bodies);
		return {
			manifest: mergeManifestDocuments(documents),
			includedFiles: allIncluded.length > 0 ? allIncluded : included,
			depManifests: depPaths,
			missingIncludes: allMissing.length > 0 ? allMissing : missing,
		};
	}
}

/** Merge independently-parsed manifest documents by concatenating array row kinds. */
function mergeManifestDocuments(documents: readonly string[]): Record<string, unknown> {
	const merged: Record<string, unknown> = {};
	for (const toml of documents) {
		if (toml.trim().length === 0) continue;
		const part = parseManifestDocumentLoose(toml);
		for (const [key, value] of Object.entries(part)) {
			if (Array.isArray(value)) {
				const existing = merged[key];
				merged[key] = Array.isArray(existing) ? [...existing, ...value] : [...value];
				continue;
			}
			if (merged[key] === undefined) merged[key] = value;
		}
	}
	return merged;
}

/**
 * Parse one on-disk TOML document for row assembly. Prefer the schema-aware
 * inspector for roots; fall back to loose smol-toml for include fragments that
 * lack a schema header or that the inspector rejects in isolation.
 */
function parseManifestDocumentLoose(toml: string): Record<string, unknown> {
	try {
		if (/^#:schema\b/m.test(toml) || /^schema_version\s*=/m.test(toml)) {
			return inspectManifest(toml).manifest as Record<string, unknown>;
		}
	} catch {
		// fall through to loose parse
	}
	try {
		const parsed = parseToml(toml) as Record<string, unknown>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * Turn a rejected include fragment (e.g. ADR-0145: an include declaring its
 * own `applyset`) into a fatal `Diagnostic`. `MF-FMT-002` is the same code the
 * wasm boundary already assigns `ParseError::FragmentApplyset` and its sibling
 * parse failures at the root-manifest entry point (`spellkave-validate-wasm`'s
 * `validate_manifest_toml`) — this is the identical underlying rejection,
 * reached through the fragment splitter instead.
 */
function fragmentErrorDiagnostic(error: { path: string; message: string }): Diagnostic {
	return {
		code: "MF-FMT-002",
		severity: "fatal",
		message: `${error.path}: ${error.message}`,
		path: error.path,
	};
}

export interface ValidateResult {
	path: string;
	bundle: boolean;
	/** `true` when no FATAL diagnostic fired — the server admits with warnings. */
	valid: boolean;
	includedFiles: string[];
	depManifests: string[];
	missingIncludes: string[];
	diagnostics: Diagnostic[];
}

export async function validateBundle(
	manifestPath: string,
	depPaths: string[],
	bundle: boolean,
): Promise<ValidateResult> {
	if (!bundle) {
		const diagnostics = validateManifestToml(await readFile(manifestPath, "utf8"));
		return {
			path: manifestPath,
			bundle: false,
			valid: !diagnostics.some((d) => d.severity === "fatal"),
			includedFiles: [],
			depManifests: [],
			missingIncludes: [],
			diagnostics,
		};
	}
	const { merged, included, missing, fragmentErrors } = await mergeBundle(manifestPath, depPaths);
	const diagnostics = [
		...fragmentErrors.map(fragmentErrorDiagnostic),
		...validateManifestToml(merged),
	];
	return {
		path: manifestPath,
		bundle: true,
		valid: !diagnostics.some((d) => d.severity === "fatal"),
		includedFiles: included,
		depManifests: depPaths,
		missingIncludes: missing,
		diagnostics,
	};
}

export interface LintResult {
	path: string;
	bundle: boolean;
	/** No findings on root-owned rows (dependency findings remain advisory). */
	clean: boolean;
	rules: typeof LINT_RULES;
	includedFiles: string[];
	depManifests: string[];
	missingIncludes: string[];
	findings: LintFinding[];
}

/**
 * The author-time companion to {@link validateBundle}: same rows, but only
 * NON-FATAL duplication/binding smells. Advisory by default — a finding is a
 * prompt to look, not a broken bundle.
 */
export async function lintBundle(
	manifestPath: string,
	depPaths: string[],
	bundle: boolean,
): Promise<LintResult> {
	if (!bundle) {
		const toml = await readFile(manifestPath, "utf8");
		const manifest = inspectManifest(toml).manifest;
		const findings = lintManifest(manifest, {
			refTagFamilies: manifestTagPrefixFamilies(manifest),
		});
		return {
			path: manifestPath,
			bundle: false,
			clean: findings.length === 0,
			rules: LINT_RULES,
			includedFiles: [],
			depManifests: [],
			missingIncludes: [],
			findings,
		};
	}
	const { manifest, includedFiles, missingIncludes } = await readMergedManifest(
		manifestPath,
		depPaths,
		true,
	);
	const findings = lintManifest(manifest, { refTagFamilies: manifestTagPrefixFamilies(manifest) });
	// Dependency rows supply reference context and remain visible in the report,
	// but the author gates only the bundles declared by this root and its includes.
	const own =
		depPaths.length === 0 ? manifest : (await readMergedManifest(manifestPath, [], true)).manifest;
	const ownBundles = new Set(
		(Array.isArray(own.bundles) ? own.bundles : []).map((row) => row.bundle_id),
	);
	const clean = findings.every(
		(finding) => finding.bundleId !== undefined && !ownBundles.has(finding.bundleId),
	);
	return {
		path: manifestPath,
		bundle: true,
		clean,
		rules: LINT_RULES,
		includedFiles: includedFiles,
		depManifests: depPaths,
		missingIncludes: missingIncludes,
		findings,
	};
}

export interface InspectResult {
	path: string;
	bundle: boolean;
	bundleIds: string[];
	rowKinds: Record<string, number>;
	includedFiles: string[];
	missingIncludes: string[];
}

/** Summarize what a manifest (optionally with its include closure) contains. */
export async function inspectBundle(
	manifestPath: string,
	depPaths: string[],
	bundle: boolean,
): Promise<InspectResult> {
	if (!bundle) {
		const inspection = inspectManifest(await readFile(manifestPath, "utf8"));
		return {
			path: manifestPath,
			bundle: false,
			bundleIds: inspection.summary.bundleIds,
			rowKinds: inspection.summary.rowKinds,
			includedFiles: [],
			missingIncludes: [],
		};
	}
	const { manifest, includedFiles, missingIncludes } = await readMergedManifest(
		manifestPath,
		depPaths,
		true,
	);
	const bundleIds = Array.isArray(manifest.bundles)
		? (manifest.bundles as Array<Record<string, unknown>>)
				.map((row) => (typeof row.bundle_id === "string" ? row.bundle_id : null))
				.filter((id): id is string => id !== null)
		: [];
	const rowKinds: Record<string, number> = {};
	for (const [key, value] of Object.entries(manifest)) {
		if (Array.isArray(value)) rowKinds[key] = value.length;
	}
	return {
		path: manifestPath,
		bundle: true,
		bundleIds,
		rowKinds,
		includedFiles: includedFiles,
		missingIncludes: missingIncludes,
	};
}

export interface WriteTomlResult {
	output: string;
	validationSkipped: boolean;
	valid?: boolean;
	diagnostics: Diagnostic[];
}

/**
 * Write rendered TOML, validating FIRST unless explicitly waived. Nothing is
 * written when a diagnostic fires: a half-valid manifest on disk is worse than
 * no write at all, because the next command reads it back as if it were sound.
 */
async function writeValidatedToml(
	outputPath: string,
	toml: string,
	noValidate: boolean,
): Promise<{ result: WriteTomlResult; ok: boolean }> {
	if (noValidate) {
		await writeFile(outputPath, toml, "utf8");
		return {
			result: { output: outputPath, validationSkipped: true, diagnostics: [] },
			ok: true,
		};
	}
	const diagnostics = validateManifestToml(toml);
	if (diagnostics.length > 0) {
		return {
			result: { output: outputPath, validationSkipped: false, valid: false, diagnostics },
			ok: false,
		};
	}
	await writeFile(outputPath, toml, "utf8");
	return {
		result: { output: outputPath, validationSkipped: false, valid: true, diagnostics: [] },
		ok: true,
	};
}

/**
 * Apply one named patch op to a manifest FILE and write the result.
 *
 * The op name and payload are pass-through: `patchManifest` dispatches them in
 * the Rust wasm layer, so this command gains every op the crate gains with no
 * edit here — the same "no hand-maintained list" property the registry half of
 * this CLI has, arrived at from the other direction.
 *
 * Distinct from the registry write verbs, and both are worth having: the verbs
 * author into a workspace and flush to a bundle's ROOT manifest, while this
 * writes whichever FILE you name — which is how a row lands in a specific
 * `[[include]]` fragment of an include-heavy bundle.
 */
export async function patchManifestFile(
	manifestPath: string,
	op: string,
	payload: Record<string, unknown>,
	outputPath: string,
	noValidate: boolean,
): Promise<{ result: WriteTomlResult; ok: boolean }> {
	const inspection = inspectManifest(await readFile(manifestPath, "utf8"));
	patchManifest(inspection.manifest, op, payload);
	return writeValidatedToml(outputPath, renderSchemaManifest(inspection.manifest), noValidate);
}

/** Render a whole schema-shaped JSON manifest to TOML — the bulk-authoring path. */
export async function renderManifestFile(
	inputPath: string,
	outputPath: string,
	noValidate: boolean,
): Promise<{ result: WriteTomlResult; ok: boolean }> {
	const toml = renderSchemaManifestJson(await readFile(inputPath, "utf8"));
	return writeValidatedToml(outputPath, toml, noValidate);
}
