import { describe, expect, it, vi } from "vitest";

import { BROWSER_AUTHOR_TOOL_NAMES, createBrowserAuthorFacingBoundTools } from "../browser.ts";

describe("browser AUTHOR capability policy", () => {
	it("omits every contract that requires a Node-only execution capability", () => {
		const tools = createBrowserAuthorFacingBoundTools({
			workspace: { readToml: () => null, writeToml: () => "browser-memory" },
		});

		expect(tools.map((tool) => tool.name)).toEqual(
			BROWSER_AUTHOR_TOOL_NAMES.filter(
				(name) =>
					name !== "spellkave_apply_manifest_delta" &&
					name !== "spellkave_can_i" &&
					name !== "spellkave_applyset_diff" &&
					name !== "spellkave_applyset_apply",
			),
		);
		expect(tools.map((tool) => tool.name)).not.toContain("spellkave_can_i");
		expect(BROWSER_AUTHOR_TOOL_NAMES).not.toContain("spellkave_map_graph");
		expect(BROWSER_AUTHOR_TOOL_NAMES).not.toContain("spellkave_attach_map_layer");
		expect(BROWSER_AUTHOR_TOOL_NAMES).not.toContain("spellkave_export");
		expect(BROWSER_AUTHOR_TOOL_NAMES).not.toContain("spellkave_diff");
		expect(tools.map((tool) => tool.name)).not.toContain("spellkave_apply_manifest_delta");
		expect(
			createBrowserAuthorFacingBoundTools({
				workspace: { readToml: () => null, writeToml: () => "browser-memory" },
				applyDelta: async () => ({ ok: true }),
			}).map((tool) => tool.name),
		).toContain("spellkave_apply_manifest_delta");
	});
	it("binds the connected admission probe only when its live port is supplied", () => {
		const tools = createBrowserAuthorFacingBoundTools({
			workspace: { readToml: () => null, writeToml: () => "browser-memory" },
			canI: {
				resolveAuthoredEntity: async () => null,
				probe: async () => ({ kind: "refused_caller" }),
			},
		});
		expect(tools.map((tool) => tool.name)).toContain("spellkave_can_i");
	});
	it("offers portable applyset tools only with their world port and refuses browser-local paths", async () => {
		const workspace = { readToml: () => null, writeToml: () => "browser-memory" };
		const absent = createBrowserAuthorFacingBoundTools({ workspace });
		expect(absent.map((tool) => tool.name)).not.toContain("spellkave_applyset_diff");
		expect(absent.map((tool) => tool.name)).not.toContain("spellkave_applyset_apply");
		const readApplyset = vi.fn(async () => null);
		const applyBundle = vi.fn(async () => ({ ok: true as const }));
		const present = createBrowserAuthorFacingBoundTools({
			workspace,
			applyset: {
				readApplyset,
				applyBundle,
				rootPathFor: (path) => path,
			},
		});
		for (const name of ["spellkave_applyset_diff", "spellkave_applyset_apply"]) {
			const tool = present.find((tool) => tool.name === name);
			expect(tool).toBeDefined();
			await expect(tool!.execute("browser-path", { dir: "gateway/manifest.toml" })).rejects.toThrow(
				"hosted authoring requires source",
			);
		}
		expect(readApplyset).not.toHaveBeenCalled();
		expect(applyBundle).not.toHaveBeenCalled();
	});
});
