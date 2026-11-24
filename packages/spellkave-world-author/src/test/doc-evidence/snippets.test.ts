import { describe, expect, it } from "vitest";

import { extractSnippet } from "./snippets";

describe("doc-evidence snippet extraction", () => {
	it("extracts a fenced block's language and content by marker id", () => {
		const { lang, content } = extractSnippet(
			"interaction-dsl-and-world-authoring",
			"actor-equipment-slot",
		);
		expect(lang).toBe("toml");
		expect(content).toBe(
			'[[actor_equipment_slots]]\nactor_entity_key = "srd/regdar"\nslot_id = "srd/main_hand"\nitem_key = "srd/item/dagger"',
		);
	});

	it("throws a loud error when the marker is missing", () => {
		expect(() => extractSnippet("interaction-dsl-and-world-authoring", "no-such-marker")).toThrow(
			/no fenced block follows marker/,
		);
	});

	it("throws a loud error when the doc file does not exist", () => {
		expect(() => extractSnippet("no-such-doc", "any-marker")).toThrow();
	});
});
