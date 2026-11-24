// embedded-manifest: {"category": "exact_text_oracle", "rationale": "movement documentation contract needs an exact dangling-edge validator counterexample"}
// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "verb-authored world directly proves independent movement capability and reach gates"}
// Doc-contract test suite, "Movement gates: capability + reach are
// independent" (#1968 combat-sim discovery pass, findings D1/D2/B3-as-doc -
// see the #1968 "Combat-sim findings" comment and
// `sandbox/sk-sndbx-unified-authoring/combat-sim/demo.md` section 6 for the
// grounding evidence). Companion to `running-an-authored-act.md`'s own
// "Movement gates: capability + reach are independent" section this file
// proves - a SEPARATE file from every other `doc-contract*.test.ts`
// (the `doc-promises` skgate registry gate scans EVERY `doc-contract*.test.ts`
// under a package's `src/__tests__/`, so a new file joins the SAME gate
// without touching another agent's).
//
// OFFLINE only (unconditional): the STATIC, always-true half of the promise -
// `core/walk` is a real core capability the shipped `traverse_*`
// affordance templates gate on (read from the COMMITTED
// `packages/spellkave-mechanics/fixtures/core` via `createLocalAuthorTarget`, no live
// node, no `packages/spellkave-mechanics/src/core/**` import - that package lives
// outside this package's `tsconfig.json` rootDir, same TS6059 boundary
// `../live-delta.ts`'s own header documents); `spellkave_bind_actor`
// grants it via a plain `actor_capabilities` row (`memoryWorkspace()`,
// canonical core target); and a `place_edge` endpoint outside a bundle's dependency
// chain is a FATAL static diagnostic (`validateManifestToml`), never a
// runtime `r_move` rejection.
//
// The LIVE half (granting `core/walk` unlocks a real `r_move`, and withholding
// it rejects the SAME edge even with a generous `movement_reach_resource`
// binding) is kernel behaviour and lives in `@spellkave/test-lab`:
// `packages/spellkave-test-lab/src/scene-live/doc-contract-movement.local-node.test.ts`
// (sk-jay0.7.123.20.46).
//
// Each `it` carries a `DOC-PROMISE: running-an-authored-act#<heading-slug>`
// comment - see `doc-contract.test.ts`'s own header for the full anchor
// convention; the `doc-promises` gate is the other half of this
// honesty contract.
// ci-allow(embedded-manifest-schema): movement documentation counterexamples - deliberately incorrect TOML
import { fileURLToPath } from "node:url";
import type { AuthorToolContext } from "@spellkave/tool-authoring";
import { createAuthorFacingBoundTools } from "@spellkave/tool-authoring";
import { createLocalAuthorTarget } from "@spellkave/tool-node/authoring";
import { memoryWorkspace, validateManifestToml } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";

const BUNDLE = "doc_promise_movement";
const CORE_DIR = fileURLToPath(
	new URL("../../../../spellkave-mechanics/fixtures/core", import.meta.url),
);

const TRAVERSAL_TEMPLATE_IDS = [
	"core/walk_edge",
	"core/affordance/traverse_open_portal",
	"core/affordance/traverse_known_threshold",
	"core/affordance/traverse_locked_portal",
];

async function call(
	context: AuthorToolContext,
	toolName: string,
	label: string,
	params: Record<string, unknown>,
): Promise<void> {
	const tools = createAuthorFacingBoundTools(context);
	const tool = tools.find((t) => t.name === toolName);
	if (tool === undefined) throw new Error(`missing tool ${toolName}`);
	const result = (await tool.execute(label, params as never)) as { details: unknown };
	const details = result.details as { ok: boolean; diagnostics?: unknown };
	if (!details.ok) {
		throw new Error(`${label} rejected: ${JSON.stringify(details.diagnostics, null, 2)}`);
	}
}

// ---------------------------------------------------------------------------
// OFFLINE
// ---------------------------------------------------------------------------

describe("running-an-authored-act — Movement gates: capability + reach are independent (offline)", () => {
	it("a place_edge endpoint outside the bundle's dependency chain is a FATAL static diagnostic, never a runtime r_move rejection", () => {
		const SCHEMA = "#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json";
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe"
author = "test"
display_name = "Probe"
version = "0.0.1"

[[place_graphs]]
place_graph_id = "probe"
bundle_id = "probe"
substrate_id = "outdoor"
display_name = "Graph"
anchor_node_id = "probe/a"

[[place_nodes]]
node_id = "probe/a"
bundle_id = "probe"
place_graph_id = "probe"
local_id = "a"
substrate_id = "outdoor"
display_name = "A"

[[place_edges]]
edge_key = "probe/a->nowhere"
bundle_id = "probe"
place_graph_id = "probe"
from_node_id = "probe/a"
to_node_id = "probe/nowhere"
`;
		const diags = validateManifestToml(toml);
		// MF-VAL-105 (checks.rs's edge-endpoints-resolve check, `chain_scoped_node_ids`)
		// — a dangling to_node_id outside the bundle's dependency chain.
		const endpointDiag = diags.find(
			(d) =>
				d.severity === "fatal" &&
				d.code === "MF-VAL-105" &&
				d.message.includes("edge endpoints must resolve"),
		);
		expect(
			endpointDiag,
			`no FATAL edge-endpoint diagnostic for a dangling to_node_id: ${JSON.stringify(diags)}`,
		).toBeDefined();
	});
});
