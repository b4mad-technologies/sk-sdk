import { expect, it } from "vitest";
import { projectDmAuthorityWorlds } from "../npc-dm-authority-projection.js";

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing expected fixture row");
	return value;
}

const root = {
	role_definitions: [{ role_id: "dm", capability_ids: ["act"], description: "Full row" }],
	role_aggregations: [{ role_id: "dm", bundle_id: "foreign", capability_ids: ["other"] }],
	role_bindings: [{ binding_id: "foreign/reader", role_id: "reader", subject: "identity" }],
	action_definitions: [{ action_id: "foreign/act", required_capability: "foreign/read" }],
	actor_capabilities: [{ actor_entity_key: "foreign/actor", capability_id: "foreign/read" }],
	metadata_namespaces: [{ namespace: "foreign.data", audience: "foreign/read" }],
	capability_definitions: [{ capability_id: "foreign/read", description: "Full definition" }],
	bundles: [{ bundle_id: "foreign", display_name: "Foreign" }],
	entities: [{ entity_key: "foreign/actor", bundle_id: "foreign", display_name: "Actor" }],
};

// K2: authority closure cannot omit a foreign user or aggregation from any root.
it("retains every root and row with exactly the consumed column projection", () => {
	const worlds = [root, structuredClone(root), {}];
	const projected = projectDmAuthorityWorlds(worlds);
	expect(projected).toHaveLength(worlds.length);
	for (const [index, world] of worlds.entries()) {
		for (const table of Object.keys(required(projected[index]))) {
			const input = (world as Record<string, unknown[]>)[table] ?? [];
			const output = required(projected[index])[table as keyof (typeof projected)[number]];
			expect(output).toHaveLength(input.length);
		}
	}
	for (const table of [
		"role_definitions",
		"role_aggregations",
		"metadata_namespaces",
		"capability_definitions",
	] as const)
		expect(required(projected[0])[table]).toEqual(root[table]);
	expect(required(projected[0]).role_bindings).toEqual([
		{ binding_id: "foreign/reader", role_id: "reader" },
	]);
	expect(required(projected[0]).action_definitions).toEqual([
		{ required_capability: "foreign/read" },
	]);
	expect(required(projected[0]).actor_capabilities).toEqual(root.actor_capabilities);
	expect(required(projected[0]).bundles).toEqual([{ bundle_id: "foreign" }]);
	expect(required(projected[0]).entities).toEqual([
		{ entity_key: "foreign/actor", bundle_id: "foreign" },
	]);
	expect(projected[1]).toEqual(required(projected[0]));
	// Returned rows cannot mutate the admitted roots used by other closure checks.
	required(required(projected[0]).role_definitions[0]).description = "changed";
	expect(required(root.role_definitions[0]).description).toBe("Full row");
});

// K2: optional-column differences must reach Rust collision admission intact.
it("preserves conflicts and absent versus present namespace options without coercion", () => {
	for (const [table, column] of [
		["capability_definitions", "description"],
		["capability_definitions", "display_name"],
		["capability_definitions", "default_visibility"],
		["metadata_namespaces", "description"],
	] as const) {
		const first = root[table][0];
		const second = { ...first, [column]: "different" };
		const projected = projectDmAuthorityWorlds([{ [table]: [first, second] }]);
		expect(required(projected[0])[table]).toEqual([first, second]);
	}
	for (const value of [false, true, null, "false", 0]) {
		const row = { namespace: "foreign.data", on_demand: value };
		const projected = projectDmAuthorityWorlds([{ metadata_namespaces: [row] }]);
		expect(required(projected[0]).metadata_namespaces[0]).toEqual(row);
	}
	expect(required(projectDmAuthorityWorlds([root])[0]).metadata_namespaces[0]).not.toHaveProperty(
		"on_demand",
	);
});

// K2: malformed canonical tables cannot become empty or partially valid inputs.
it("refuses malformed tables, rows and required columns instead of dropping them", () => {
	for (const world of [null, false, [], { role_definitions: null }, { bundles: [null] }])
		expect(() => projectDmAuthorityWorlds([world])).toThrow();
	for (const [table, field] of [
		["role_bindings", "binding_id"],
		["action_definitions", "required_capability"],
		["actor_capabilities", "capability_id"],
		["bundles", "bundle_id"],
		["entities", "entity_key"],
	] as const) {
		const world = structuredClone(root);
		delete (world[table][0] as Record<string, unknown>)[field];
		expect(() => projectDmAuthorityWorlds([world])).toThrow();
	}
	for (const bad of [undefined, Number.NaN, () => true, new Date()])
		expect(() =>
			projectDmAuthorityWorlds([{ metadata_namespaces: [{ description: bad }] }]),
		).toThrow();
	const cycle: Record<string, unknown> = {};
	cycle.self = cycle;
	expect(() => projectDmAuthorityWorlds([{ metadata_namespaces: [cycle] }])).toThrow();
	expect(() => projectDmAuthorityWorlds([])).toThrow();
});

// K2: a large source's unrelated content is excluded, but authority is never truncated.
it("bounds the complete UTF-8 projection without raising the existing eight MiB ceiling", () => {
	const huge = "é".repeat(4 * 1024 * 1024);
	expect(() => projectDmAuthorityWorlds([{ unrelated_content: huge }])).not.toThrow();
	expect(() =>
		projectDmAuthorityWorlds([{ capability_definitions: [{ description: huge }] }]),
	).toThrow("exceeds 8 MiB");
});
