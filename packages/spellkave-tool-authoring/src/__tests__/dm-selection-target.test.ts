// embedded-manifest: {"category": "schema_object_oracle", "rationale": "Typed dependency and selection objects exercise target vocabulary admission, foreign ownership and conflicting declarations."}
import { inspectManifest, renderSchemaManifest } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";
import { type AuthorTarget, createAuthorFacingBoundTools } from "../index.ts";

async function writeSelection(
	variant: string,
	fields: Record<string, unknown>,
	tagCopies = 1,
	conflictingCopy = false,
	externalOwner: "valid" | "missing" | "incoming" | "outside" | "badprefix" | undefined = undefined,
) {
	let toml = renderSchemaManifest({
		schema_version: "1.0.0",
		bundles: [
			{
				bundle_id: "house",
				display_name: "House",
				author: "test",
				version: "1",
				depends_on: externalOwner !== undefined && externalOwner !== "outside" ? ["library"] : [],
				tag_prefixes: [
					{ prefix: "house", target_kind: "tag_value_definitions", natural_key_field: "tag" },
				],
			},
		],
		consequence_templates: [{ bundle_id: "house", template_id: "house/change" }],
	});
	const definitions: Record<string, Record<string, unknown>[]> = {
		tag_value_definitions: [
			{
				tag: "house.identity.mage",
				prefix: "house",
				bundle_id: "house",
				description: "Chosen identity.",
			},
		],
		entity_definitions: [
			{ entity_def_id: "house/staff", bundle_id: "house", display_name: "Staff" },
		],
	};
	if (externalOwner !== undefined) {
		definitions.tag_value_definitions = [
			{
				tag: "library.identity.mage",
				prefix: "library",
				bundle_id: "library",
				description: "Existing library identity.",
			},
		];
		definitions.bundles =
			externalOwner === "missing"
				? []
				: [
						{
							bundle_id: "library",
							display_name: "Library",
							author: "test",
							version: "1",
							depends_on: [],
							tag_prefixes: [
								{
									prefix: externalOwner === "badprefix" ? "other" : "library",
									target_kind: "tag_value_definitions",
									natural_key_field: "tag",
								},
							],
						},
					];
		if (externalOwner === "incoming") {
			const incoming = inspectManifest(toml).manifest;
			toml = renderSchemaManifest({
				...incoming,
				tag_value_definitions: definitions.tag_value_definitions,
			});
		}
	}
	const tag = definitions.tag_value_definitions?.[0];
	if (tag === undefined) throw new Error("test tag missing");
	definitions.tag_value_definitions = Array.from({ length: tagCopies }, (_, index) => ({
		...tag,
		...(conflictingCopy && index > 0 ? { description: "Conflicting declaration." } : {}),
	}));
	if (externalOwner === "valid") {
		definitions.tag_value_definitions.push({
			tag: "library.identity.ranger",
			prefix: "library",
			bundle_id: "library",
			description: "Sibling vocabulary.",
		});
		const incoming = inspectManifest(toml).manifest;
		toml = renderSchemaManifest({
			...incoming,
			entity_definitions: [
				{ entity_def_id: "house/person", bundle_id: "house", display_name: "Person" },
			],
			entity_definition_tag: [
				{
					entity_def_id: "house/person",
					bundle_id: "house",
					source: "test",
					tag: "library.identity.ranger",
				},
			],
		});
	}
	const target: AuthorTarget = {
		kind: "local",
		lookup: (kind) => definitions[kind] ?? [],
		resolveRef: (kind, id) =>
			(definitions[kind] ?? []).some((row) => Object.values(row).includes(id)),
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
	).find((tool) => tool.name === "spellkave_write_rows");
	if (tool === undefined) throw new Error("row writer absent");
	const result = (await tool.execute("selection", {
		bundle: "house",
		kind: "consequence_frame_writes",
		rows: [{ template_id: "house/change", ordinal: 0, frame_write: { [variant]: fields } }],
	})) as { details: { ok: boolean; diagnostics?: unknown } };
	return {
		...result,
		persistedBundleIds: inspectManifest(toml).manifest.bundles?.map((row) => row.bundle_id),
	};
}

describe("authored selections resolve against the connected author target", () => {
	it("resolves a borrowed tag against its existing foreign owner without persisting owner rows", async () => {
		const result = await writeSelection(
			"SetEntityTag",
			{ entity: "TargetActor", tag: { allowed_ids: ["library.identity.mage"] }, present: true },
			1,
			false,
			"valid",
		);
		expect(result.details.ok, JSON.stringify(result.details.diagnostics)).toBe(true);
		expect(result.persistedBundleIds).toEqual(["house"]);
	});
	it("keeps dependency-closure refusal for a foreign tag outside the declared dependencies", async () => {
		const result = await writeSelection(
			"SetEntityTag",
			{ entity: "TargetActor", tag: { allowed_ids: ["library.identity.mage"] }, present: true },
			1,
			false,
			"outside",
		);
		expect(result.details.ok).toBe(false);
		expect(JSON.stringify(result.details.diagnostics)).toContain("MF-VAL-214");
		expect(JSON.stringify(result.details.diagnostics)).toContain("MF-VAL-306");
	});
	it("refuses a borrowed tag whose target owner does not declare the exact prefix", async () => {
		const result = await writeSelection(
			"SetEntityTag",
			{ entity: "TargetActor", tag: { allowed_ids: ["library.identity.mage"] }, present: true },
			1,
			false,
			"badprefix",
		);
		expect(result.details.ok).toBe(false);
		expect(JSON.stringify(result.details.diagnostics)).toContain("MF-VAL-306");
	});
	it("refuses a borrowed tag when its owning target bundle is missing", async () => {
		const result = await writeSelection(
			"SetEntityTag",
			{ entity: "TargetActor", tag: { allowed_ids: ["library.identity.mage"] }, present: true },
			1,
			false,
			"missing",
		);
		expect(result.details.ok).toBe(false);
		expect(JSON.stringify(result.details.diagnostics)).toContain("MF-VAL-306");
	});
	it("preserves ownership checks for incoming foreign tag declarations", async () => {
		const result = await writeSelection(
			"SetEntityTag",
			{ entity: "TargetActor", tag: { allowed_ids: ["library.identity.mage"] }, present: true },
			1,
			false,
			"incoming",
		);
		expect(result.details.ok).toBe(false);
		expect(JSON.stringify(result.details.diagnostics)).toContain("MF-VAL-306");
	});
	it("collapses identical declarations returned by overlapping fixture fragments", async () => {
		const result = await writeSelection(
			"SetEntityTag",
			{
				entity: "TargetActor",
				tag: { allowed_ids: ["house.identity.mage"] },
				present: true,
			},
			2,
		);
		expect(result.details.ok, JSON.stringify(result.details.diagnostics)).toBe(true);
	});
	it("preserves conflicting declarations for admission to refuse", async () => {
		const result = await writeSelection(
			"SetEntityTag",
			{
				entity: "TargetActor",
				tag: { allowed_ids: ["house.identity.mage"] },
				present: true,
			},
			2,
			true,
		);
		expect(result.details.ok).toBe(false);
		expect(JSON.stringify(result.details.diagnostics)).toContain("MF-VAL-357");
	});
	it("admits an existing declared tag from another fragment", async () => {
		const result = await writeSelection("SetEntityTag", {
			entity: "TargetActor",
			tag: { allowed_ids: ["house.identity.mage"] },
			present: true,
		});
		expect(result.details.ok, JSON.stringify(result.details.diagnostics)).toBe(true);
	});
	it("admits an existing item definition from another fragment", async () => {
		const result = await writeSelection("InsertItem", {
			selection: { allowed_ids: ["house/staff"] },
			count: 1,
			destination: { ActorInventory: { actor_ref: "TargetActor" } },
		});
		expect(result.details.ok, JSON.stringify(result.details.diagnostics)).toBe(true);
	});
	it("refuses a tag absent from both workspace and target", async () => {
		const result = await writeSelection("SetEntityTag", {
			entity: "TargetActor",
			tag: { allowed_ids: ["house.identity.missing"] },
			present: true,
		});
		expect(result.details.ok).toBe(false);
	});
});
