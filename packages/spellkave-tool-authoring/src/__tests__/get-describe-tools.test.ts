import { describe, expect, it, vi } from "vitest";
import type { AuthorToolContext } from "../authoring";
import { createAuthorFacingBoundTools } from "../authoring";

function fakeWorkspace(): AuthorToolContext["workspace"] {
	return {
		readToml: () => null,
		writeToml: () => "/scratch",
	};
}

function modelText(result: { content?: unknown } | undefined): string {
	const block = (result?.content as { type?: string; text?: string }[] | undefined)?.find(
		(part) => part.type === "text",
	);
	if (block?.text === undefined) throw new Error("missing model-facing text content");
	return block.text;
}

describe("spellkave_get / spellkave_describe", () => {
	it("returns not_publisher without readInstance", async () => {
		const tools = createAuthorFacingBoundTools({ workspace: fakeWorkspace() });
		const get = tools.find((t) => t.name === "spellkave_get");
		const describeTool = tools.find((t) => t.name === "spellkave_describe");
		expect(get).toBeDefined();
		expect(describeTool).toBeDefined();
		const g = await get?.execute("t", { kind: "entities" });
		expect(g?.details).toMatchObject({ ok: false, code: "not_publisher" });
		const d = await describeTool?.execute("t", { kind: "entities", key: "x" });
		expect(d?.details).toMatchObject({ ok: false, code: "not_publisher" });
	});

	it("model-facing content is the full OwnerGetAnswer JSON", async () => {
		const answer = {
			ok: true as const,
			kind: "entities",
			bundle: "elven_mini",
			tick: "1",
			labels: ["authored_entities_only"] as const,
			row: { entity_key: "hero", value_int: 9223372036854775807n },
		};
		const tools = createAuthorFacingBoundTools({
			workspace: fakeWorkspace(),
			readInstance: {
				get: () => answer,
				describe: () => {
					throw new Error("describe must not run");
				},
			},
		});
		const get = tools.find((t) => t.name === "spellkave_get");
		const g = await get?.execute("t", { kind: "entities", key: "hero" });
		const parsed = JSON.parse(modelText(g)) as Record<string, unknown>;
		expect(parsed.ok).toBe(true);
		expect(parsed.kind).toBe("entities");
		expect(parsed.bundle).toBe("elven_mini");
		expect(parsed.tick).toBe("1");
		expect(parsed.labels).toEqual(["authored_entities_only"]);
		expect(parsed.row).toMatchObject({
			entity_key: "hero",
			value_int: "9223372036854775807",
		});
		expect(g?.details).toEqual(answer);
	});

	it("model-facing content is the full OwnerDescribeAnswer JSON", async () => {
		const answer = {
			ok: true as const,
			kind: "entities" as const,
			bundle: "elven_mini",
			tick: "9",
			labels: ["authored_entities_only"] as const,
			row: { entity_key: "chest" },
			slices: { entity_containment: [{ numeric_id: "11" }] },
			numeric_id: "10",
			place: "inn/loft",
			container_chain: [{ numeric_id: "10", entity_key: "chest", place: "inn/loft" }],
			chain_end: { reason: "place" as const, numeric_id: "10" },
			belonging: [{ entity_key: "potion", numeric_id: "11", relation: "containment" as const }],
			match_count: 1,
			left_out: 0,
		};
		const tools = createAuthorFacingBoundTools({
			workspace: fakeWorkspace(),
			readInstance: {
				get: () => {
					throw new Error("get must not run");
				},
				describe: () => answer,
			},
		});
		const describeTool = tools.find((t) => t.name === "spellkave_describe");
		const d = await describeTool?.execute("t", { kind: "entities", key: "chest" });
		const parsed = JSON.parse(modelText(d)) as Record<string, unknown>;
		expect(parsed.ok).toBe(true);
		expect(parsed.row).toEqual({ entity_key: "chest" });
		expect(parsed.slices).toEqual({ entity_containment: [{ numeric_id: "11" }] });
		expect(parsed.container_chain).toEqual([
			{ numeric_id: "10", entity_key: "chest", place: "inn/loft" },
		]);
		expect(parsed.bundle).toBe("elven_mini");
		expect(parsed.tick).toBe("9");
		expect(parsed.labels).toEqual(["authored_entities_only"]);
		expect(parsed.numeric_id).toBe("10");
		expect(parsed.place).toBe("inn/loft");
		expect(parsed.chain_end).toEqual({ reason: "place", numeric_id: "10" });
		expect(parsed.belonging).toEqual([
			{ entity_key: "potion", numeric_id: "11", relation: "containment" },
		]);
		expect(d?.details).toEqual(answer);
	});

	it("forwards describe bundle and limit to the port", async () => {
		const describe = vi.fn(() => ({
			ok: false as const,
			code: "unknown_key" as const,
			message: "no authored entity shared in bundle a",
		}));
		const tools = createAuthorFacingBoundTools({
			workspace: fakeWorkspace(),
			readInstance: {
				get: () => {
					throw new Error("get must not run");
				},
				describe,
			},
		});
		const describeTool = tools.find((t) => t.name === "spellkave_describe");
		await describeTool?.execute("t", {
			kind: "entities",
			key: "shared",
			bundle: "a",
			limit: 3,
		});
		expect(describe).toHaveBeenCalledWith({
			kind: "entities",
			key: "shared",
			bundle: "a",
			limit: 3,
		});
	});
});
