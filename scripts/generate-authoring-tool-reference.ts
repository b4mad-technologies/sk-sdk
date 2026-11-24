// Generates `packages/spellkave-world-author/docs/tool-reference.md` from the
// ACTUAL AUTHOR tool registry (#1968 "docs as testable promises",
// layer 3a) — `authorFacingToolDefinitions` in
// `@spellkave/tool-authoring`. Same pattern as
// `generate-authoring-reference-docs.ts` (manifest-format.md/dsl-grammar.md
// from the Rust schema): a schema-derived doc can never lie about a tool's
// name/label/description/parameter shape, because it IS the tool's own
// TypeBox schema, walked structurally — never hand-copied prose that can
// drift the moment a verb's params change under it.
//
// `authoring-verbs.ts` (the tool bodies) is owned by a parallel #1968 track —
// this script only ever IMPORTS from it (read-only), never edits it.
//
// The rendering primitives (schema walk, TOC entry, section) live in
// `./tool-reference-render.ts`, shared with
// `scripts/generate-player-tool-reference.ts` — the PLAYER/operator +
// explorer-meta sibling registries (#1968) — so both pages render from the
// SAME structural walk instead of two hand-copied implementations.
//
// Regenerate: npx tsx scripts/generate-authoring-tool-reference.ts
// CI guard: the `authoring-tool-reference-drift` skgate registry gate (runs
// this with --check, sk-jay0.7.133.10).
//
// #1968 follow-up ("expose host-supported tool prompt metadata" + "docs as
// testable promises, executed examples"): every AUTHOR tool that declares
// `exampleParams` (`ToolDefinition.exampleParams`, `tool-registry.ts`) gets
// its example call EXECUTED here, against a single shared bespoke in-memory
// `AuthorWorkspace` (NOT a live node, NOT the fast-lane seed) — the SAME
// "fireball" worked-example sequence `__tests__/authoring-verbs.test.ts`
// already proves offline (author_place -> define_resource -> spawn ->
// bind_actor -> define_behavior), extended to every other offline-authorable
// verb. Execution runs in a hand-picked DEPENDENCY-SAFE order (`EXAMPLE_
// EXECUTION_ORDER`, below) — independent of the rendered section order,
// which stays `authorFacingToolDefinitions`' own registration order — so a
// later verb (e.g. spellkave_define_affordance) can reference an id an
// EARLIER-registered verb didn't happen to author yet (e.g. spellkave_
// define_capability, which registers AFTER it). `spellkave_apply_manifest_
// delta` is the one AUTHOR tool with no `exampleParams` (it REQUIRES a live
// connection/target) — it renders an honest "requires an active connection"
// marker instead of a fabricated result.
import { readFile, writeFile } from "node:fs/promises";
import {
	AUTHOR_PLACE_TOOL,
	type AuthorFacingToolDefinition,
	authorFacingToolDefinitions,
	type AuthorToolContext,
	type AuthorWorkspace,
	BIND_ACTOR_TOOL,
	DECLARE_INEXPRESSIBLE_TOOL,
	DEFINE_ACTION_TOOL,
	DEFINE_ACTION_VERB_TOOL,
	DEFINE_AFFORDANCE_TOOL,
	DEFINE_BEHAVIOR_TOOL,
	DEFINE_CAPABILITY_TOOL,
	DEFINE_CONDITION_TOOL,
	DEFINE_CONSEQUENCE_TOOL,
	DEFINE_ENTITY_TYPE_TOOL,
	DEFINE_NICHE_TOOL,
	DEFINE_RESOURCE_TOOL,
	DEFINE_ROLL_TABLE_TOOL,
	DIFF_MANIFEST_TOOL,
	DOCS_TOOL,
	EQUIP_ITEM_TOOL,
	NOTE_DOC_GAP_TOOL,
	PLACE_ACTOR_TOOL,
	PLACE_ENTITY_TOOL,
	QUERY_TOOL,
	STOW_ITEM_TOOL,
	WRITE_ROWS_TOOL,
} from "../packages/spellkave-tool-authoring/src/index.ts";
import type { NodeToolCapabilities } from "../packages/spellkave-tool-runtime/src/index.ts";
import { nodeToolCapability as canonicalNodeToolCapability } from "../packages/spellkave-tool-node/src/index.ts";
import { tidy, tocEntry, toolSection, type ToolExampleRender } from "./tool-reference-render";

const OUTPUT_PATH = "packages/spellkave-world-author/docs/tool-reference.md";

/** A bespoke in-memory scratch workspace — no fs, no live node, no fast-lane seed. */
function offlineWorkspace(): AuthorWorkspace {
	let current: string | null = null;
	return {
		readToml: () => current,
		writeToml: (toml: string) => {
			current = toml;
			return "<in-memory doc-generation workspace>";
		},
	};
}

/**
 * Execution order for `exampleParams` — dependency-safe, NOT the rendered
 * section order (`authorFacingToolDefinitions` stays registration-order for
 * that). Several verbs need something a LATER-registered verb authors:
 * spellkave_query's example inspects the resource pool spellkave_define_
 * resource authors, spellkave_define_affordance's example references the
 * capability spellkave_define_capability authors, and (#1968 backlog B-3)
 * spellkave_define_action's example references BOTH the capability
 * spellkave_define_capability authors AND the consequence spellkave_define_
 * consequence authors — all moved earlier here.
 */
const EXAMPLE_EXECUTION_ORDER: readonly string[] = [
	DOCS_TOOL,
	DECLARE_INEXPRESSIBLE_TOOL,
	NOTE_DOC_GAP_TOOL,
	AUTHOR_PLACE_TOOL,
	DEFINE_RESOURCE_TOOL,
	PLACE_ENTITY_TOOL,
	PLACE_ACTOR_TOOL,
	BIND_ACTOR_TOOL,
	STOW_ITEM_TOOL,
	EQUIP_ITEM_TOOL,
	DEFINE_BEHAVIOR_TOOL,
	DEFINE_ENTITY_TYPE_TOOL,
	DEFINE_ROLL_TABLE_TOOL,
	DEFINE_CONDITION_TOOL,
	DEFINE_CAPABILITY_TOOL,
	DEFINE_CONSEQUENCE_TOOL,
	DEFINE_ACTION_TOOL,
	DEFINE_NICHE_TOOL,
	// #1968 battle-test finding #40: needs BOTH DEFINE_CAPABILITY_TOOL's and
	// DEFINE_NICHE_TOOL's own examples already authored (required_capability +
	// niche_id) — moved after the latter, the later of the two dependencies.
	DEFINE_ACTION_VERB_TOOL,
	DEFINE_AFFORDANCE_TOOL,
	WRITE_ROWS_TOOL,
	QUERY_TOOL,
	DIFF_MANIFEST_TOOL,
];

/** Minimal structural shape this module needs from a `ToolDefinition` to execute its example — avoids importing the internal `ToolDefinition`/`TSchema` types, which the package does not expose publicly. */
type ExampleRunnable = {
	name: string;
	exampleParams?: unknown;
	run: (
		context: AuthorToolContext,
		params: unknown,
		toolCallId: string,
		capabilities: NodeToolCapabilities,
	) => Promise<{ details: unknown }>;
};

async function computeExamples(): Promise<ReadonlyMap<string, ToolExampleRender>> {
	const byName = new Map<string, AuthorFacingToolDefinition>(
		authorFacingToolDefinitions.map((def) => [def.name, def]),
	);
	const context: AuthorToolContext = { workspace: offlineWorkspace() };
	const examples = new Map<string, ToolExampleRender>();

	for (const name of EXAMPLE_EXECUTION_ORDER) {
		const def = byName.get(name) as ExampleRunnable | undefined;
		if (def?.exampleParams === undefined) continue;
		// sk-9ll.3: `spellkave_equip_item`'s own example ("aoe_blast/wand_1" into
		// "core/slot/main_hand") needs an `equipment_slot_definitions` row that no
		// EARLIER example in this dependency-safe order happens to author (no
		// narrower verb than the generic write_rows escape hatch authors that row
		// kind at all) — seed it here, silently (not its own rendered Example),
		// exactly once, right before spellkave_equip_item's turn.
		if (name === EQUIP_ITEM_TOOL) {
			const writeRows = byName.get(WRITE_ROWS_TOOL) as ExampleRunnable | undefined;
			if (writeRows !== undefined) {
				await writeRows.run(
					context,
					{
						bundle: "core",
						kind: "equipment_slot_definitions",
						rows: [
							{ slot_id: "core/slot/main_hand", bundle_id: "core", label: "Main Hand" },
						],
					},
					"doc-example-seed-equipment-slot",
					{ node: canonicalNodeToolCapability },
				);
			}
		}
		const result = await def.run(
			context,
			def.exampleParams,
			`doc-example-${name}`,
			{ node: canonicalNodeToolCapability },
		);
		// This generated page is itself part of the corpus digest. Snapshotting the
		// current digest here would create a revision feedback loop. Preserve the
		// executed result shape while explicitly marking this illustrative field.
		const stableResult = JSON.parse(JSON.stringify(result.details, (key, value) =>
			key === "corpus_revision" ? "<packaged-corpus-revision>" : value,
		));
		examples.set(name, { kind: "executed", params: def.exampleParams, result: stableResult });
	}

	// Every AUTHOR tool without `exampleParams` needs a live connection/target
	// (today: spellkave_apply_manifest_delta) — never fabricate a result.
	for (const def of authorFacingToolDefinitions) {
		if (!examples.has(def.name) && (def as ExampleRunnable).exampleParams === undefined) {
			examples.set(def.name, { kind: "requires_connection" });
		}
	}
	return examples;
}

function renderDoc(examples: ReadonlyMap<string, ToolExampleRender>): string {
	const sections = authorFacingToolDefinitions
		.map((def) => toolSection(def, examples.get(def.name)))
		.join("\n\n");
	const toc = authorFacingToolDefinitions.map(tocEntry).join("\n");
	// Membership lives at `authorFacingToolDefinitions` / `AUTHOR_TOOL_NAMES`.
	// Do not put a roster length in this heading — even a derived `${length}`
	// still ships as a prose count that steers readers (sk-jay0.7.15.7;
	// earlier #1968 round 6 already learned a hardcoded "16-verb" title goes
	// stale).
	return tidy(`# Tool reference — AUTHOR surface

<!-- GENERATED by scripts/generate-authoring-tool-reference.ts. Do not edit by hand. -->

This page is generated directly from \`authorFacingToolDefinitions\`
(\`packages/spellkave-tool-authoring/src/authoring.ts\`) — the SAME TypeBox
parameter schemas a host binds to \`createAuthorFacingTools\` and hands to an
agent's tool-calling loop. Every name, required/optional flag, type, default,
and description below is the tool's own runtime schema, not hand-copied prose:
if a verb's parameters change, this page changes with it (the
\`authoring-tool-reference-drift\` skgate registry gate fails the build otherwise). Every tool below that declares an offline-executable
example also carries a real, EXECUTED "Example" call + result — never
hand-typed — run against a bespoke in-memory scratch workspace by this
generator; a tool whose \`run\` requires a live connection instead carries an
honest "requires an active connection" marker.
Corpus revision fields use \`<packaged-corpus-revision>\` here to avoid hashing a
page containing its own digest; actual docs responses carry the current digest.

For a narrative walkthrough of the calling PATTERN (which verbs to call in
what order, smart defaults, stage-then-commit), see
[\`getting-started-with-verbs.md\`](./getting-started-with-verbs.md). For the
underlying TOML row shapes these verbs write, see
[\`manifest-format.md\`](./manifest-format.md). For the PLAYER/DM tool surface —
a different audience, not served through \`spellkave_docs\` — see
[the PLAYER tool reference](../../spellkave-tool-player/docs/tool-reference.md).

## Tools, in registration order

${toc}

${sections}
`);
}

async function checkFile(path: string, expected: string): Promise<boolean> {
	let actual: string;
	try {
		actual = await readFile(path, "utf8");
	} catch {
		console.error(`${path} is missing; run: npx tsx scripts/generate-authoring-tool-reference.ts`);
		return false;
	}
	if (actual !== expected) {
		console.error(`${path} is stale; run: npx tsx scripts/generate-authoring-tool-reference.ts`);
		return false;
	}
	return true;
}

async function main(): Promise<void> {
	const check = process.argv.includes("--check");
	const examples = await computeExamples();
	const doc = renderDoc(examples);

	if (check) {
		const ok = await checkFile(OUTPUT_PATH, doc);
		process.exitCode = ok ? 0 : 1;
		return;
	}

	await writeFile(OUTPUT_PATH, doc, "utf8");
	console.log(`[authoring-tool-reference] wrote ${OUTPUT_PATH}`);
}

await main();
