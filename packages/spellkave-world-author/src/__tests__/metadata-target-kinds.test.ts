import { metadata_target_kinds_json } from "@spellkave/validate-wasm";
import { describe, expect, it } from "vitest";
import type { MetadataAttachmentRow } from "../metadata";


const EXHAUSTIVE: Record<MetadataAttachmentRow["targetKind"], true> = {
	entity: true,
	entity_definition: true,
	place_graph: true,
	place_node: true,
	place_edge: true,
	item_definition: true,
	resource_definition: true,
	affordance_template: true,
	capability_definition: true,
	bundle: true,
	prompt_definition: true,
};

describe("metadata target kinds", () => {
	it("offers exactly the kinds the Rust validator admits", () => {
		const admitted = JSON.parse(metadata_target_kinds_json()) as string[];
		expect(Object.keys(EXHAUSTIVE).sort()).toEqual([...admitted].sort());
	});

	it("reads a non-empty list from the wasm export", () => {
		// Guards the failure mode where a broken export returns its "[]"
		// fallback and the comparison above passes only because both sides
		// are empty.
		const admitted = JSON.parse(metadata_target_kinds_json()) as string[];
		expect(admitted.length).toBeGreaterThan(0);
		expect(admitted).toContain("bundle");
	});
});
