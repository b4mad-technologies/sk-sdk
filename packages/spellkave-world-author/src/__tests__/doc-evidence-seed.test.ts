// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "manifest-format evidence needs minimal valid and invalid header probes", "signatures": ["toml_version", "schema_directive", "schema_shape"]}
// Seed doc-evidence declarations (authoring-doc-evidence task 1.4). Each
// wraps a real offline assertion — the same behavior validate.test.ts /
// manifest.test.ts already prove structurally — through the doc-evidence
// protocol so the generated `ledger/claims.md` carries its first real rows.
// See openspec/changes/authoring-doc-evidence/{design,tasks}.md.

// ci-allow(embedded-manifest-schema): header validation counterexamples - deliberately invalid headers under test
import { describe, expect } from "vitest";
import { renderManifest, type WorldManifest } from "../manifest";
import { docEvidence } from "../test/doc-evidence/evidence";
import { validateManifestToml } from "../validate";

const SCHEMA = "#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json";

const header: WorldManifest["header"] = {
	bundleId: "doc_evidence_seed",
	displayName: "Doc Evidence Seed",
	author: "world-author-agent",
	version: "1.0.0",
	dependsOn: ["core"],
	description: "seed fixture for doc-evidence claims",
};

describe("doc-evidence seed declarations", () => {
	docEvidence(
		{
			doc: "manifest-format",
			tier: "offline",
			claim:
				"a manifest TOML that omits the `#:schema` directive documented at the top of the reference is rejected with MF-FMT-001",
		},
		() => {
			const diags = validateManifestToml('schema_version = "1.0.0"\n');
			expect(diags[0]?.code).toBe("MF-FMT-001");
			expect(diags[0]?.severity).toBe("fatal");
		},
	);

	docEvidence(
		{
			doc: "manifest-format",
			tier: "offline",
			claim:
				"the schema directive, metadata profile, and bundle header (including depends_on) render into a manifest exactly as documented",
		},
		() => {
			const toml = renderManifest({ header });
			expect(toml).toContain(SCHEMA);
			expect(toml).toContain('profile = "doc_evidence_seed"');
			expect(toml).toMatch(/\[\[bundles\]\][\s\S]*?depends_on = \["core"\]/);
		},
	);

	docEvidence(
		{
			doc: "metadata-attachments",
			tier: "offline",
			claim:
				"the Validation section's promise that payload JSON not decoding to an object is rejected holds — an array payload is flagged WA-META-001",
		},
		() => {
			const diags = validateManifestToml(metadataToml("art.prompt", ["not", "an", "object"]));
			expect(diags.some((d) => d.code === "WA-META-001" && d.message.includes("JSON object"))).toBe(
				true,
			);
		},
	);

	docEvidence(
		{
			doc: "metadata-attachments",
			tier: "offline",
			claim:
				"the Validation section's promise that an unregistered namespace is rejected holds — an attachment against a namespace with no registry row is flagged WA-META-001",
		},
		() => {
			const diags = validateManifestToml(metadataToml("map.anchor", { x: 1 }));
			expect(diags.some((d) => d.code === "WA-META-001" && d.message.includes("unknown"))).toBe(
				true,
			);
		},
	);

	docEvidence(
		{
			doc: "metadata-attachments",
			tier: "offline",
			claim:
				"the Row Shape section's metadata_attachments row fields (target_kind, namespace, payload_json) render exactly as documented (ADR-0073)",
		},
		() => {
			const toml = renderManifest({
				header,
				metadataNamespaces: [
					{
						namespace: "doc_evidence_seed.note",
						audience: "author",
						description: "Seed note.",
					},
				],
				metadataAttachments: [
					{
						targetKind: "place_graph",
						targetRef: "doc_evidence_seed/graph",
						namespace: "doc_evidence_seed.note",
						payload: { text: "needs review" },
					},
				],
			});
			expect(toml).toContain("[[metadata_attachments]]");
			expect(toml).toContain('target_kind = "place_graph"');
			expect(toml).toContain('namespace = "doc_evidence_seed.note"');
			expect(toml).toContain('payload_json = \'{"text":"needs review"}\'');
		},
	);
});

function metadataToml(namespace: string, payload: unknown): string {
	return `${SCHEMA}
schema_version = "1.0.0"

[metadata]
profile = "metadata_test"

[[bundles]]
bundle_id = "metadata_test"
display_name = "Metadata Test"
author = "test"
version = "1.0.0"
depends_on = []
description = "metadata validation fixture"

[[metadata_attachments]]
target_kind = "place_graph"
target_ref = "metadata_test/graph"
namespace = "${namespace}"
payload_json = '${JSON.stringify(payload)}'
bundle_id = "metadata_test"

${
	namespace === "map.anchor"
		? ""
		: `[[metadata_namespaces]]
namespace = "${namespace}"
audience = "author"
bundle_id = "metadata_test"
`
}
`;
}
