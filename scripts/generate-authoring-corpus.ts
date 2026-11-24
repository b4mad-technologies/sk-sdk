// embedded-manifest: {"category": "toml_embedder", "rationale": "the corpus generator serializes committed example TOML into the package's drift-gated source"}
// Generates the world-author corpus from the single source of truth — the
// package-local `packages/spellkave-world-author/docs/**` prose (R1/D5,
// #1968: physically moved off `docs/modding/**` so the package is
// self-contained and ships full prose, not a repo-checkout-dependent
// summary) — instead of the hand-copied inline consts that used to drift
// (ADR-0047 D-2). Two halves:
//
//   - EXAMPLES: `docs/examples/*.toml` plus a per-example `*.meta.json`
//     sidecar. The `.toml` is the example bytes; the sidecar carries
//     title/intent/tags only — the sidecar's `body` field was retired
//     (authoring-doc-evidence task 5.1 rider): it was already dead (the
//     example's own `.md` walkthrough is the served prose, same ingestion
//     rule as every other doc below) and this generator never read it into
//     the output; `expectedDiagnostics` is NOT authored — it is a snapshot
//     retained in committed per-example `.diagnostics.json` goldens. Preparation
//     checks current wasm behaviour against them; only --update-diagnostics
//     captures changed goldens for review, never an ordinary preparation run
//     (ADR-0047 D-2, keeping behaviour out of the hand surface).
//   - PROSE: every other `docs/*.md` (guides, generated reference docs),
//     ingested FULL BODY keyed by filename stem; `docs/README.md` (the
//     onramp) is keyed specially as `"onramp"` since `corpus.ts`'s synthetic
//     id has no matching stem. `corpus.ts`'s hand-authored `PROSE_DOCS` still
//     owns the curated id/title/kind/tags; only the `body` comes from here.
//
// Output `corpus.generated.ts` is an ignored, prepared build input, `--check`-gated by the
// `authoring-corpus-drift` skgate registry gate (sk-jay0.7.133.10), mirroring
// `generate-authoring-reference-docs.ts`. `--prepare` refreshes it quietly;
// `--check` rejects missing/stale bytes without writing them.
//
// Import the validator directly so corpus generation can run before world-author is loaded.
import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validate_manifest_toml } from "@spellkave/validate-wasm";

// Package scripts run in their own directory; all inputs belong to this checkout.
process.chdir(fileURLToPath(new URL("..", import.meta.url)));

/** Diagnostic codes the wasm validator emits for a TOML (empty = clean). */
function diagnosticCodes(toml: string): string[] {
	const raw = JSON.parse(validate_manifest_toml(toml)) as Array<{ code: string }>;
	return raw.map((d) => d.code);
}

/** Reviewed validator goldens survive independently of the ignored corpus. */
function checkedDiagnostics(id: string, toml: string): string[] {
	const actual = diagnosticCodes(toml);
	const path = `${EXAMPLES_DIR}/${id}.diagnostics.json`;
	if (process.argv.includes("--update-diagnostics")) {
		writeFileSync(path, `${JSON.stringify(actual, null, "\t")}\n`, "utf8");
	}
	let expected: unknown;
	try {
		expected = JSON.parse(readFileSync(path, "utf8"));
	} catch {
		throw new Error(`${path} is missing or invalid; review validator changes and run node scripts/generate-authoring-corpus.ts --update-diagnostics explicitly`);
	}
	if (!Array.isArray(expected) || !expected.every(code => typeof code === "string") || JSON.stringify(expected) !== JSON.stringify(actual)) {
		throw new Error(`${path} differs from current wasm diagnostics; review validator changes and run node scripts/generate-authoring-corpus.ts --update-diagnostics explicitly`);
	}
	return expected;
}

const DOCS_DIR = "packages/spellkave-world-author/docs";
const EXAMPLES_DIR = `${DOCS_DIR}/examples`;
const OUTPUT_PATH = "packages/spellkave-world-author/src/corpus.generated.ts";
// Not prose to ingest as a guide/reference doc: CLAUDE.md/AGENTS.md are
// agent-context (editing conventions for this very directory), and README.md
// is ingested separately under the special "onramp" id (below). `index.md`
// (the generated corpus index, #1968 browsable docs) needs no special-casing
// — its filename stem already matches its PROSE_DOCS id ("index"), same as
// every other prose doc.
const PROSE_EXCLUDED = new Set(["CLAUDE.md", "AGENTS.md", "README.md"]);
const ONRAMP_ID = "onramp";

interface ExampleSidecar {
	title: string;
	intent: string;
	tags: string[];
}

interface BuiltExample {
	id: string;
	sidecar: ExampleSidecar;
	toml: string;
	expectedDiagnostics: string[];
	/** Full text of the `<id>.md` walkthrough — the served doc body (R1). */
	walkthroughMd: string;
}

/** Discover every example id from its `<id>.toml` source, sorted for determinism. */
function exampleIds(): string[] {
	return readdirSync(EXAMPLES_DIR)
		.filter((f) => f.endsWith(".toml"))
		.map((f) => f.slice(0, -".toml".length))
		.sort();
}

function readSidecar(id: string): ExampleSidecar {
	const path = join(EXAMPLES_DIR, `${id}.meta.json`);
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (err) {
		throw new Error(`example "${id}": missing or invalid sidecar ${path}: ${(err as Error).message}`);
	}
	const s = parsed as Partial<ExampleSidecar>;
	const ok =
		typeof s.title === "string" &&
		typeof s.intent === "string" &&
		Array.isArray(s.tags) &&
		s.tags.every((t) => typeof t === "string");
	if (!ok) {
		throw new Error(
			`example "${id}": sidecar ${path} must have string title/intent and a string[] tags`,
		);
	}
	return { title: s.title as string, intent: s.intent as string, tags: s.tags as string[] };
}

function readWalkthrough(id: string): string {
	const path = join(EXAMPLES_DIR, `${id}.md`);
	try {
		return readFileSync(path, "utf8");
	} catch {
		throw new Error(`example "${id}": missing walkthrough ${path} (ADR-0047 D-3: every .toml needs a matching .md)`);
	}
}

function build(): BuiltExample[] {
	return exampleIds().map((id) => {
		const toml = readFileSync(join(EXAMPLES_DIR, `${id}.toml`), "utf8");
		const sidecar = readSidecar(id);
		const walkthroughMd = readWalkthrough(id);
		// Snapshot the validator's verdict — never hand-authored (ADR-0047 D-2).
		const expectedDiagnostics = checkedDiagnostics(id, toml);
		return { id, sidecar, toml, expectedDiagnostics, walkthroughMd };
	});
}

/**
 * Discover every non-example prose doc's full body, keyed by filename stem —
 * the guide/reference half of R1's "full prose in the package" (#1968).
 * `README.md` (the onramp) is keyed specially since `corpus.ts`'s synthetic
 * `onramp` id has no matching stem.
 */
function buildProseBodies(): Record<string, string> {
	const bodies: Record<string, string> = {
		[ONRAMP_ID]: readFileSync(join(DOCS_DIR, "README.md"), "utf8"),
	};
	const files = readdirSync(DOCS_DIR)
		.filter((f) => f.endsWith(".md") && !PROSE_EXCLUDED.has(f))
		.sort();
	for (const file of files) {
		const id = file.slice(0, -".md".length);
		bodies[id] = readFileSync(join(DOCS_DIR, file), "utf8");
	}
	// Situational repair sheets (authoring-docs-tool-first-onramp).
	const repairsDir = join(DOCS_DIR, "repairs");
	try {
		const repairFiles = readdirSync(repairsDir)
			.filter((f) => f.endsWith(".md"))
			.sort();
		for (const file of repairFiles) {
			const id = file.slice(0, -".md".length);
			if (bodies[id] !== undefined) {
				throw new Error(
					`repair id "${id}" collides with a top-level docs/${id}.md — rename one of them`,
				);
			}
			bodies[id] = readFileSync(join(repairsDir, file), "utf8");
		}
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
	// Publish every Patternbook page without a runtime docs-directory read.
	for (const file of readdirSync(join(DOCS_DIR, "patterns")).sort()) {
		if (!file.endsWith(".md") || PROSE_EXCLUDED.has(file)) continue;
		const id = file === "index.md" ? "patterns" : `patterns/${file.slice(0, -3)}`;
		if (bodies[id] !== undefined) throw new Error(`duplicate prose id "${id}"`);
		bodies[id] = readFileSync(join(DOCS_DIR, "patterns", file), "utf8");
	}
	return bodies;
}

/** Emit a value as a JS literal via JSON — exact round-trip, escapes backticks/newlines/`${`. */
function lit(value: unknown): string {
	return JSON.stringify(value);
}

// CI-gate exception markers the OUTPUT carries (grammar:
// packages/spellkave-gates/src/ci-allow.ts). Two gates scan the generated corpus and would
// otherwise flag it: it embeds manifest TOML that is doc prose rather than a
// standalone document, and it embeds guide prose that quotes a `SELECT * FROM`
// example. Emitting the markers from here rather than hand-editing the output
// is the point — a regeneration cannot silently drop them.
//
// The token is assembled rather than written out because this generator sits
// inside a scanned tree itself: a literal here would read as a marker ON this
// file (which embeds no manifest and opens no subscription) instead of one it
// EMITS, and the gate would rightly call it stale.
const ALLOW = `ci-${"allow"}`;
const EMITTED_CLASSIFICATION =
	"// embedded-" +
	"manifest: " +
	JSON.stringify({
		category: "generated_toml_corpus",
		rationale: "generated executable documentation corpus sourced from docs/examples files",
		signatures: ["schema_directive", "schema_shape"],
	});
const EMITTED_SCHEMA_ALLOW = `// ${ALLOW}(embedded-manifest-schema): generated corpus, drift-gated byte-exact against the source TOML it was built from`;
const EMITTED_RAW_SQL_ALLOW_START = `// ${ALLOW}-start(raw-sql): guide prose embedded verbatim from the docs tree; a SQL snippet in here is an example someone typed into a guide, never a subscription call`;
const EMITTED_RAW_SQL_ALLOW_END = `// ${ALLOW}-end(raw-sql)`;

function render(examples: BuiltExample[], proseBodies: Record<string, string>): string {
	const packageGuidePath = "packages/spellkave-cli/docs/cli-workflows.md";
	const packageGuideMeta = JSON.parse(readFileSync("packages/spellkave-cli/docs/cli-workflows.meta.json", "utf8")) as ExampleSidecar;
	const packageGuides: import("../packages/spellkave-world-author/src/corpus").AuthoringDoc[] = [{
		id: "cli/workflows", title: packageGuideMeta.title, kind: "guide", summary: packageGuideMeta.intent,
		tags: packageGuideMeta.tags, body: readFileSync(packageGuidePath, "utf8"), source_path: packageGuidePath,
	}];
	for (const [id, sourcePath] of [
		["personas/access", "packages/spellkave-cli/docs/persona-routes"],
		["player/workflows", "packages/spellkave-tool-player/docs/player-loop"],
	]) {
		const meta = JSON.parse(readFileSync(`${sourcePath}.meta.json`, "utf8")) as ExampleSidecar;
		if (typeof meta.title !== "string" || typeof meta.intent !== "string" || !Array.isArray(meta.tags) || !meta.tags.every((tag) => typeof tag === "string")) throw new Error(`Invalid guide metadata: ${id}`);
		packageGuides.push({ id, title: meta.title, kind: "guide", summary: meta.intent, tags: meta.tags,
			body: readFileSync(`${sourcePath}.md`, "utf8"), source_path: `${sourcePath}.md` });
	}
	packageGuides.push({
		id: "evidence/auth-56-installed-cli", title: "Installed CLI candidate evidence — AUTH-56-01", kind: "reference",
		summary: "Historical partial installed-candidate capture; exact artifact, assertions, sanitized transcript and pinned text cost.",
		tags: ["evidence", "AUTH-56-01", "installed-cli"],
		body: readFileSync("packages/spellkave-cli/docs/installed-cli-evidence.md", "utf8"),
		source_path: "packages/spellkave-cli/docs/installed-cli-evidence.md",
		publication: { content_status: "historical", supported_surfaces: ["cli", "local-mcp"] },
	});
	for (const [id, title, summary] of [
		["evidence/auth-56-hosted-mcp", "Caller MCP guidance evidence — AUTH-56-01/02", "Versioned native real-caller public guidance capture, independent postconditions and whole-journey cost; no deployed-service claim."],
		["evidence/auth-56-hosted-mcp-transcript", "Historical caller MCP capture", "Identity, assertions and cost for the archived AUTH-56 integration run."],
	]) {
		const sourcePath = `packages/spellkave-world-author/docs/${id}.md`;
		packageGuides.push({ id, title, kind: "reference", summary,
			tags: ["evidence", "AUTH-56-01", "AUTH-56-02", "hosted-mcp"],
			body: readFileSync(sourcePath, "utf8"), source_path: sourcePath,
			publication: { content_status: "historical", supported_surfaces: ["cli", "local-mcp", "hosted-mcp", "web"] },
		});
	}
	// Include authored title/summary/tags/publication facts and projection semantics,
	// not only prose. These sources never read the generated digest, avoiding a cycle.
	const metadataSource = readFileSync("packages/spellkave-world-author/src/corpus.ts", "utf8");
	const metadataContract = readFileSync("packages/spellkave-tool-contracts/src/docs-metadata.ts", "utf8");
	const generatorSource = readFileSync("scripts/generate-authoring-corpus.ts", "utf8");
	const revision = `sha256:${createHash("sha256").update(JSON.stringify({ examples, proseBodies, metadataSource, metadataContract, generatorSource, packageGuides })).digest("hex")}`;
	const patternDocs = Object.entries(proseBodies)
		.filter(([id]) => id.startsWith("patterns/"))
		.map(([id, body]) => {
			const title = /^# (.+)$/m.exec(body)?.[1];
			if (!title) throw new Error(`${id}: missing page title`);
			const problem = /## Problem\s+([\s\S]*?)(?=\n## |$)/.exec(body)?.[1];
			const summary = (problem ?? title).replace(/\s+/g, " ").trim();
			return { id, title, kind: "guide", summary: summary.length > 180 ? `${summary.slice(0, 179)}…` : summary,
				tags: ["patterns", ...id.slice("patterns/".length).split("-")], body };
		});
	const exampleRows = examples
		.map(
			(e) => `\t{
\t\tid: ${lit(e.id)},
\t\tintent: ${lit(e.sidecar.intent)},
\t\ttags: ${lit(e.sidecar.tags)},
\t\ttoml: ${lit(e.toml)},
\t\texpectedDiagnostics: ${lit(e.expectedDiagnostics)},
\t},`,
		)
		.join("\n");

	const docRows = examples
		.map(
			(e) => `\t{
\t\tid: ${lit(e.id)},
\t\ttitle: ${lit(e.sidecar.title)},
\t\tkind: "example",
\t\tsummary: ${lit(e.sidecar.intent)},
\t\ttags: ${lit(e.sidecar.tags)},
\t\tbody: ${lit(e.walkthroughMd)},
\t},`,
		)
		.join("\n");

	const proseEntries = Object.entries(proseBodies)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([id, body]) => `\t${lit(id)}: ${lit(body)},`)
		.join("\n");

	return `// GENERATED by scripts/generate-authoring-corpus.ts — DO NOT EDIT BY HAND.
${EMITTED_CLASSIFICATION}
// Source of truth: packages/spellkave-world-author/docs/** (ADR-0047 D-2, #1968).
// Regenerate: npx tsx scripts/generate-authoring-corpus.ts
// CI guard: the \`authoring-corpus-drift\` skgate registry gate (runs this with --check).
// \`expectedDiagnostics\` is a snapshot of the wasm validator over each .toml; it
// is regenerated, never hand-edited, when a validator code/message changes.
${EMITTED_SCHEMA_ALLOW}
import type { AuthoringDoc, AuthoringExample } from ${lit("./corpus")};

// Content identity, independent of a checkout or an assumed server version.
export const GENERATED_CORPUS_REVISION = ${lit(revision)};

export const GENERATED_EXAMPLES: AuthoringExample[] = [
${exampleRows}
];

export const GENERATED_EXAMPLE_DOCS: AuthoringDoc[] = [
${docRows}
];

// Individual Patternbook pages: title and problem summary derive from source.
export const GENERATED_PATTERN_DOCS: AuthoringDoc[] = ${lit(patternDocs)};

// Build-time projection; source prose remains owned by each product package.
export const GENERATED_PACKAGE_GUIDES: AuthoringDoc[] = ${lit(packageGuides)};

// Full prose bodies for every guide/reference doc, keyed by filename stem
// (\`onramp\` = README.md). \`corpus.ts\`'s hand-authored PROSE_DOCS supplies the
// curated id/title/kind/tags; the body always comes from here (R1 — the
// package is self-contained, no repo-checkout read needed).
${EMITTED_RAW_SQL_ALLOW_START}
export const GENERATED_PROSE_BODIES: Record<string, string> = {
${proseEntries}
};
${EMITTED_RAW_SQL_ALLOW_END}
`;
}

function main(): void {
	const check = process.argv.includes("--check");
	const prepare = process.argv.includes("--prepare");
	if (check && process.argv.includes("--update-diagnostics")) {
		throw new Error("--check cannot update diagnostics");
	}
	const content = render(build(), buildProseBodies());
	let actual: string | null = null;
	try {
		actual = readFileSync(OUTPUT_PATH, "utf8");
	} catch {
		// An absent prepared file is actionable in check mode and generated otherwise.
	}

	if (check) {
		if (actual !== content) {
			console.error(
				`${OUTPUT_PATH} is missing or stale; run: npx tsx scripts/generate-authoring-corpus.ts`,
			);
			process.exitCode = 1;
			return;
		}
		console.log(`[authoring-corpus] OK — generated corpus matches ${DOCS_DIR}/**.`);
		return;
	}

	if (actual !== content) {
		// Readers and concurrent preparation see a complete old or new module.
		const temporary = `${OUTPUT_PATH}.${process.pid}.tmp`;
		try {
			writeFileSync(temporary, content, "utf8");
			renameSync(temporary, OUTPUT_PATH);
		} finally {
			rmSync(temporary, { force: true });
		}
	}
	if (!prepare) console.log(`[authoring-corpus] wrote ${OUTPUT_PATH}`);
}

main();
