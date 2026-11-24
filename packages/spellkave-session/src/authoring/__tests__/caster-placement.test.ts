// embedded-manifest: {"category": "schema_object_oracle", "rationale": "Typed workspace placement rows directly prove caster-node validation and precedence over injected target rows."}
import type { AuthorTarget, AuthorWorkspace } from "@spellkave/tool-authoring";
import { createAuthorFacingBoundTools } from "@spellkave/tool-authoring";
import { nodeToolCapability } from "@spellkave/tool-node";
import { inspectManifest, renderSchemaManifest } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";

const bundle = "caster_placement";
const caster = `${bundle}/caster`;
const node = `${bundle}/hall`;
const params = {
	bundle,
	id: "observe",
	grant_to: caster,
	action_class: "probe",
	offered_when: { reach: "same_node" },
	effect: {
		primitive: "ForEachActorInRadius",
		write: {
			primitive: "OutcomeGraph",
			branches: [
				{
					node: "observed",
					guard: "1 == 1",
					subject: "TargetActor",
					resource: `${bundle}/value`,
					delta: "1",
				},
			],
		},
	},
};

function fixture(liveNode: unknown, workspaceNode?: string) {
	let source: string | null =
		workspaceNode === undefined
			? null
			: renderSchemaManifest({
					schema_version: "1.0.0",
					actor_spatial_locations: [
						{ bundle_id: bundle, entity_key: caster, place_node_id: workspaceNode },
					],
				});
	const before = source;
	const workspace: AuthorWorkspace = {
		readToml: () => source,
		writeToml: (value) => {
			source = value;
			return "memory";
		},
	};
	const target: AuthorTarget = {
		kind: "live",
		resolveRef: () => true,
		lookup: (kind) =>
			kind === "actor_spatial_locations" ? [{ entity_key: caster, place_node_id: liveNode }] : [],
		applyBatch: async () => {
			throw new Error("placement checks must not apply a manifest");
		},
	};
	const tool = createAuthorFacingBoundTools(
		{ workspace, target },
		{ node: nodeToolCapability },
	).find((tool) => tool.name === "spellkave_define_behavior");
	if (!tool) throw new Error("define_behavior tool missing");
	return { tool, before, current: () => source };
}

describe("define_behavior caster placement boundary", () => {
	// keep(K2): malformed adapter node values require an injected target; do not emit them as attachments.
	it.each([
		"",
		" \t ",
		undefined,
		null,
		0,
	])("refuses an unusable live node %j without writing scratch", async (value) => {
		const f = fixture(value);
		await expect(f.tool.execute("unavailable-caster", params)).rejects.toThrow(
			/grant_to.*place_node_id/,
		);
		expect(f.current()).toBe(f.before);
	});

	// keep(K2): inject a visibility-filtered target to pin workspace precedence at the adapter boundary.
	it("uses an explicit workspace node when the live node is unavailable", async () => {
		const f = fixture("", node);
		const result = await f.tool.execute("explicit-caster", params);
		expect(result).toMatchObject({ details: { ok: true } });
		const manifest = inspectManifest(f.current() as string).manifest;
		expect(manifest.spatial_niche_attachments).toEqual(
			expect.arrayContaining([expect.objectContaining({ place_node_id: node })]),
		);
	});

	// keep(K2): an injected target proves that invalid workspace placement still takes precedence.
	it("refuses a blank workspace node without falling through to the target", async () => {
		const f = fixture(node, "");
		await expect(f.tool.execute("invalid-workspace-caster", params)).rejects.toThrow(
			/grant_to.*place_node_id.*workspace/,
		);
		expect(f.current()).toBe(f.before);
	});

	// keep(K2): a concrete injected adapter row controls against blanket rejection of target-only placement.
	it("uses a concrete live node", async () => {
		const f = fixture(node);
		const result = await f.tool.execute("placed-caster", params);
		expect(result).toMatchObject({ details: { ok: true } });
		const manifest = inspectManifest(f.current() as string).manifest;
		expect(manifest.spatial_niche_attachments).toEqual(
			expect.arrayContaining([expect.objectContaining({ place_node_id: node })]),
		);
	});
});
