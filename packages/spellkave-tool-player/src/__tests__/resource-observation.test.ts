import { describe, expect, it, vi } from "vitest";
import { MAX_RESOURCE_READS, observeOfferedResources } from "../resource-observation";

describe("optional offered resource reads", () => {
	it("reads only offered configured pools, deduplicates and excludes prefix siblings", async () => {
		const read = vi.fn(async () => ({
			items: [
				{ state_id: "neutral/uses", value: "0" },
				{ state_id: "neutral/uses/private-sibling", value: "99" },
			],
		}));
		const result = await observeOfferedResources(
			[
				{ actionPrefix: "heal/", actionSuffix: "/self", stateId: "neutral/uses" },
				{ actionPrefix: "heal/", stateId: "neutral/uses" },
				{ actionPrefix: "absent/", stateId: "other" },
				{ actionPrefix: "heal/", actionSuffix: "/ally", stateId: "ally" },
			],
			[{ actionId: "heal/wind/self" }],
			read,
		);
		expect(read.mock.calls).toEqual([["neutral/uses"]]);
		expect(result).toEqual({
			items: [{ state_id: "neutral/uses", value: "0" }],
			omittedStateIds: [],
		});
	});
	it("bounds extra calls and exposes omitted pools without inventing empty values", async () => {
		const read = vi.fn(async () => ({ listing: "paginated", truncated: true, items: [] }));
		const config = Array.from({ length: MAX_RESOURCE_READS + 2 }, (_, i) => ({
			actionPrefix: "heal",
			stateId: `pool/${i}`,
		}));
		const result = await observeOfferedResources(config, [{ actionId: "heal" }], read);
		expect(read).toHaveBeenCalledTimes(MAX_RESOURCE_READS);
		expect(result).toEqual({ items: [], omittedStateIds: ["pool/4", "pool/5"] });
	});
	it("costs no calls without matching offers and treats unavailable replies as unknown", async () => {
		const read = vi.fn(async () => null);
		const config = [{ actionPrefix: "heal", stateId: "pool" }];
		expect(await observeOfferedResources(config, [], read)).toEqual({
			items: [],
			omittedStateIds: [],
		});
		expect(read).not.toHaveBeenCalled();
		expect(await observeOfferedResources(config, [{ actionId: "heal" }], read)).toEqual({
			items: [],
			omittedStateIds: [],
		});
	});
});
