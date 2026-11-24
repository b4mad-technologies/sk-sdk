import { inspectManifest } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";
import type { AuthorTarget } from "../author-target";
import {
	type AuthorToolContext,
	type AuthorWorkspace,
	createAuthorFacingBoundTools,
} from "../authoring";

function workspace(): AuthorWorkspace {
	let toml: string | null = null;
	return {
		readToml: () => toml,
		writeToml: (next) => {
			toml = next;
			return "/scratch/apply-scaffold-bundle";
		},
	};
}

function tool(context: AuthorToolContext, name: string) {
	const found = createAuthorFacingBoundTools(context).find((candidate) => candidate.name === name);
	if (found === undefined) throw new Error(`missing ${name}`);
	return found;
}

/** A target that records each flushed delta and already defines `existing`. */
function recordingTarget(existing: string[]): AuthorTarget & { sent: string[] } {
	const sent: string[] = [];
	return {
		kind: "local",
		sent,
		resolveRef: (rowKind, id) => rowKind === "bundles" && existing.includes(id),
		lookup: () => [],
		applyBatch: async (toml) => {
			sent.push(toml);
			return { ok: true };
		},
	};
}

const bundlesOf = (toml: string | undefined) =>
	(
		(inspectManifest(toml ?? "").manifest as { bundles?: { bundle_id: string }[] }).bundles ?? []
	).map((row) => row.bundle_id);

describe("apply_manifest_delta keeps the target's own bundle row (sk-jay0.3.26.16)", () => {
	it("drops the verb-scaffolded header when the target already defines the bundle", async () => {
		const target = recordingTarget(["adventure"]);
		const context: AuthorToolContext = { workspace: workspace(), target };
		await tool(context, "spellkave_author_place").execute("place", {
			bundle: "adventure",
			nodes: [{ id: "cellar/stair", name: "Stair" }],
			edges: [],
		});
		const applied = await tool(context, "spellkave_apply_manifest_delta").execute("apply", {});
		expect((applied.details as { ok: boolean }).ok).toBe(true);
		expect(bundlesOf(target.sent[0])).toEqual([]);
		expect(target.sent[0]).toContain("cellar/stair");
	});

	it("keeps the scaffolded header for a bundle the target does not define yet", async () => {
		const target = recordingTarget([]);
		const context: AuthorToolContext = { workspace: workspace(), target };
		await tool(context, "spellkave_author_place").execute("place", {
			bundle: "adventure",
			nodes: [{ id: "cellar/stair", name: "Stair" }],
			edges: [],
		});
		await tool(context, "spellkave_apply_manifest_delta").execute("apply", {});
		expect(bundlesOf(target.sent[0])).toEqual(["adventure"]);
	});

	it("always sends a deliberate define_bundle row", async () => {
		const target = recordingTarget(["adventure"]);
		const context: AuthorToolContext = { workspace: workspace(), target };
		await tool(context, "spellkave_define_bundle").execute("bundle", {
			bundle_id: "adventure",
			depends_on: ["srd"],
		});
		await tool(context, "spellkave_apply_manifest_delta").execute("apply", {});
		expect(bundlesOf(target.sent[0])).toEqual(["adventure"]);
	});
});
