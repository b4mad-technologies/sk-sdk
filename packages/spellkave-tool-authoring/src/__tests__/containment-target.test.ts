// embedded-manifest: {"category":"schema_object_oracle","rationale":"Minimal policy attachment envelopes prove connected-target dependency admission without reusable authored world content."}
/** Authors attach dependency policies and reference existing predicate inputs
 * without copying dependency rows into their workspace. Unknown and foreign
 * references remain fatal. CI owner: ci-js tool-authoring offline tests. */
import { inspectManifest, renderSchemaManifest } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";
import { type AuthorTarget, createAuthorFacingBoundTools } from "../index";

async function writePolicy(
	options: {
		kind?: "entity_definition_containment_policy" | "containment_policy_definition";
		source?: string;
		dependency?: "direct" | "transitive" | "outside";
		missing?: "policy" | "condition";
		targetKind?: "local" | "live";
	} = {},
) {
	const bundle = (id: string, depends_on: string[] = []) => ({
		bundle_id: id,
		display_name: id,
		author: "test",
		version: "1",
		depends_on,
	});
	let toml = renderSchemaManifest({
		schema_version: "1.0.0",
		bundles: [
			bundle(
				"house",
				options.dependency === "outside"
					? []
					: [options.dependency === "transitive" ? "bridge" : "library"],
			),
		],
	});
	const rows: Record<string, Record<string, unknown>[]> = {
		bundles: [bundle("library"), bundle("bridge", ["library"])],
		entity_definitions: [{ bundle_id: "house", entity_def_id: "house/bag", display_name: "Bag" }],
		containment_policy_definition:
			options.missing === "policy"
				? []
				: [
						{
							bundle_id: "library",
							policy_id: "library/policy",
							// Target content is already admitted; preflight needs existence,
							// not reconstruction of its dependency DSL and macro vocabulary.
						},
					],
		condition_definitions:
			options.missing === "condition"
				? []
				: [
						{
							bundle_id: "library",
							condition_definition_id: "library/condition",
						},
					],
		object_state_definitions: [
			{
				bundle_id: "library",
				state_id: "library/open",
				target_kind: "entity",
				display_name: "Open",
			},
		],
		tag_value_definitions: [
			{ bundle_id: "library", tag: "library.member", prefix: "library", description: "member" },
		],
	};
	const target: AuthorTarget = {
		kind: options.targetKind ?? "local",
		lookup: (kind) => rows[kind] ?? [],
		resolveRef: () => true,
		applyBatch: async () => ({ ok: true }),
	};
	const tool = createAuthorFacingBoundTools(
		{
			workspace: {
				readToml: () => toml,
				writeToml: (value) => {
					toml = value;
					return "memory";
				},
			},
			defaultBundle: "house",
			target,
		},
		{},
	).find((t) => t.name === "spellkave_write_rows");
	if (!tool) throw new Error("row writer absent");
	const kind = options.kind ?? "entity_definition_containment_policy";
	const result = (await tool.execute("containment", {
		bundle: "house",
		kind,
		rows:
			kind === "entity_definition_containment_policy"
				? [{ entity_def_id: "house/bag", policy_id: "library/policy" }]
				: [
						{
							policy_id: "house/policy",
							exposure_predicate_source: options.source ?? "target.status('library/condition')",
							access_predicate_source: "true == true",
						},
					],
	})) as { details: { ok: boolean; diagnostics?: unknown } };
	return { ...result, manifest: inspectManifest(toml).manifest };
}

describe("containment policy author-target vocabulary", () => {
	it.each([
		"local",
		"live",
	] as const)("attaches an existing dependency policy through a %s target without persisting borrowed rows", async (targetKind) => {
		const result = await writePolicy({ targetKind });
		expect(result.details.ok, JSON.stringify(result.details.diagnostics)).toBe(true);
		expect(result.manifest.bundles?.map((r) => r.bundle_id)).toEqual(["house"]);
		expect(result.manifest.containment_policy_definition ?? []).toEqual([]);
		expect(result.manifest.entity_definitions ?? []).toEqual([]);
	});
	it("resolves transitive dependency policy ownership", async () => {
		const result = await writePolicy({ dependency: "transitive" });
		expect(result.details.ok, JSON.stringify(result.details.diagnostics)).toBe(true);
	});
	it.each(["outside", "missing"] as const)("refuses an %s policy", async (caseName) => {
		const result = await writePolicy(
			caseName === "outside" ? { dependency: "outside" } : { missing: "policy" },
		);
		expect(result.details.ok).toBe(false);
		expect(JSON.stringify(result.details.diagnostics)).toContain("MF-VAL-391");
	});
	it.each([
		"target.status('library/condition')",
		"target.state('library/open')",
		"target.has_tag('library.member')",
	])("resolves input %s without copying its source", async (source) => {
		const result = await writePolicy({ kind: "containment_policy_definition", source });
		expect(result.details.ok, JSON.stringify(result.details.diagnostics)).toBe(true);
		expect(result.manifest.condition_definitions ?? []).toEqual([]);
		expect(result.manifest.tag_value_definitions ?? []).toEqual([]);
		expect(result.manifest.object_state_definitions ?? []).toEqual([]);
	});
	it.each(["outside", "missing"] as const)("refuses an %s predicate input", async (caseName) => {
		const result = await writePolicy({
			kind: "containment_policy_definition",
			...(caseName === "outside"
				? ({ dependency: "outside" } as const)
				: ({ missing: "condition" } as const)),
		});
		expect(result.details.ok).toBe(false);
		expect(JSON.stringify(result.details.diagnostics)).toContain("MF-VAL-391");
	});
	it("still rejects a stochastic incoming policy with a target attached", async () => {
		const result = await writePolicy({ kind: "containment_policy_definition", source: "1d20 > 5" });
		expect(result.details.ok).toBe(false);
		expect(JSON.stringify(result.details.diagnostics)).toContain("MF-VAL-391");
	});
});
