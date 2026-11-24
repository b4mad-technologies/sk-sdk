import type { NodeToolCapabilities } from "@spellkave/tool-runtime";
import { describe, expect, it, vi } from "vitest";
import type { AuthorTarget } from "../author-target.ts";
import { createAuthorFacingBoundTools } from "../authoring.ts";

const unused = (): never => {
	throw new Error("the target adapter owns persistence");
};
const capabilities: NodeToolCapabilities = {
	node: {
		filesystem: {
			exists: unused,
			isFile: unused,
			readText: unused,
			writeText: unused,
			ensureDirectory: unused,
			dirname: unused,
			join: unused,
			resolve: unused,
			moduleDirectory: unused,
		},
		map: {
			writeJpeg: unused,
			mapLayersToBackdrops: unused,
			backdropAssetDataHref: unused,
			attachSpatialGraphImage: unused,
			probeAssetDimensions: unused,
		},
		telemetry: { createRunEmitter: unused },
	},
};

// keep-file(K2): injected target capabilities prove the local-only dispatch boundary.
describe("remove_entity target boundary", () => {
	it.each([
		"local",
		"live",
		"missing",
	] as const)("handles a %s target without a world write", async (kind) => {
		const workspace = { readToml: () => null, writeToml: () => "scratch" };
		const removeEntity = vi.fn(async () => ({
			ok: true,
			removed: { root: { entities: 1 }, workspace: {} },
		}));
		const applyDelta = vi.fn(async () => ({ ok: true }));
		const target: AuthorTarget = {
			kind: kind === "local" ? "local" : "live",
			resolveRef: () => false,
			lookup: () => [],
			applyBatch: async () => ({ ok: true }),
			removeEntity,
		};
		const tool = createAuthorFacingBoundTools(
			{ workspace, applyDelta, ...(kind === "missing" ? {} : { target }) },
			capabilities,
		).find((t) => t.name === "spellkave_remove_entity");
		if (!tool) throw new Error("remove_entity missing");
		const result = await tool.execute("remove", { entity_key: "demo/torch" });
		const answer = result.details as { ok: boolean; detail?: string };
		expect(answer.ok).toBe(kind === "local");
		if (kind === "local") expect(removeEntity).toHaveBeenCalledWith("demo/torch", workspace);
		else {
			expect(removeEntity).not.toHaveBeenCalled();
			expect(answer.detail).toContain("local target");
		}
		expect(applyDelta).not.toHaveBeenCalled();
	});
});
