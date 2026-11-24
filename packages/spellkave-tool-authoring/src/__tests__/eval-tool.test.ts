// embedded-manifest: {"category": "exact_text_oracle", "rationale": "macro and roll-table evaluation tests require exact manifest fragments for context resolution"}
import { describe, expect, it } from "vitest";
import type { AuthorToolContext } from "../authoring";
import { evalToolDef } from "../authoring-verbs";

function fakeWorkspace(initial: string | null = null) {
	let current = initial;
	return {
		readToml: () => current,
		writeToml: (toml: string) => {
			current = toml;
			return "/scratch/explorer_scratch";
		},
	};
}

function contextWith(
	workspaceToml: string | null = null,
	target?: AuthorToolContext["target"],
): AuthorToolContext {
	return {
		workspace: fakeWorkspace(workspaceToml),
		target,
	};
}

describe("spellkave_eval tool scenarios (world-authoring-cli spec delta)", () => {
	it("Scenario: A roll against fixed dice", async () => {
		const context = contextWith();
		const res = await evalToolDef.run(context, {
			expression: "1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')",
			kind: "predicate",
			facts: {
				actor: { stat: { "demo/bonus": 3 } },
				target: { stat: { "demo/threshold": 15 } },
			},
			dice: [12],
		});

		expect(res.details.ok).toBe(true);
		expect(res.details.value).toEqual({ type: "Bool", value: true });
		expect(res.details.draws).toHaveLength(1);
		expect(res.details.draws?.[0].value).toBe(12);

		const trace = res.details.trace ?? [];
		expect(trace.length).toBeGreaterThan(0);
		// Check that roll evaluated to 12 and sum evaluated to 15
		expect(trace.some((e) => e.operator === "Roll" && e.value?.value === 12)).toBe(true);
		expect(trace.some((e) => e.operator === "Arithmetic" && e.value?.value === 15)).toBe(true);
	});

	it("Scenario: False is a result, not a rejection", async () => {
		const context = contextWith();
		const res = await evalToolDef.run(context, {
			expression: "1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')",
			kind: "predicate",
			facts: {
				actor: { stat: { "demo/bonus": 3 } },
				target: { stat: { "demo/threshold": 15 } },
			},
			dice: [11],
		});

		expect(res.details.ok).toBe(true);
		expect(res.details.value).toEqual({ type: "Bool", value: false });
	});

	it("Scenario: A missing fact is named", async () => {
		const context = contextWith();
		const res = await evalToolDef.run(context, {
			expression: "1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')",
			kind: "predicate",
			facts: {
				actor: { stat: { "demo/bonus": 3 } },
			},
			dice: [12],
		});

		expect(res.details.ok).toBe(false);
		expect(res.details.rejection).toMatchObject({
			kind: "missing_fact",
			subject: "target",
			field_id: "demo/threshold",
		});
	});

	it("Scenario: An unknown pool is named", async () => {
		const context = contextWith();
		const res = await evalToolDef.run(context, {
			expression: "actor.stat('demo/bonus') >= 3",
			kind: "predicate",
			facts: {
				actor: {
					stat: { "demo/bonus": 3 },
					unknown_pool: { x: 1 },
				},
			},
		});

		expect(res.details.ok).toBe(false);
		expect(res.details.rejection).toMatchObject({
			kind: "unknown_pool",
			pool: "unknown_pool",
		});
	});

	it("Scenario: Too few dice", async () => {
		const context = contextWith();
		const res = await evalToolDef.run(context, {
			expression: "2d6",
			kind: "int",
			dice: [4],
		});

		expect(res.details.ok).toBe(false);
		expect(res.details.rejection).toMatchObject({
			kind: "dice_exhausted",
			draw_number: 2,
		});
	});

	it("Scenario: Too few dice inside an item source", async () => {
		const context = contextWith();
		const res = await evalToolDef.run(context, {
			expression: "1d6 + actor.wielded_item.source('damage')",
			kind: "int",
			facts: {
				item_sources: {
					"actor.wielded_item": {
						damage: "2d6",
					},
				},
			},
			dice: [3, 4],
		});

		expect(res.details.ok).toBe(false);
		expect(res.details.rejection).toMatchObject({
			kind: "dice_exhausted",
			draw_number: 3,
		});
	});

	it("Scenario: The bench applies the resolution limits", async () => {
		const context = contextWith();
		const dice = Array.from({ length: 300 }, () => 3);
		const res = await evalToolDef.run(context, {
			expression: "300d6",
			kind: "int",
			dice,
		});

		expect(res.details.ok).toBe(false);
		expect(res.details.rejection?.kind).toBe("bound_exceeded");
		expect(res.details.rejection?.bound).toBe("draw");
		expect(typeof res.details.rejection?.budget).toBe("number");
	});

	it("Scenario: The trace shows how a boolean expression groups", async () => {
		const context = contextWith();
		// In DSL grammar, || binds tighter than &&: A && B || C means A && (B || C)
		// When A is false and C is true, A evaluates false and the B || C group is not evaluated
		const res = await evalToolDef.run(context, {
			expression: "actor.stat('a') == 1 && actor.stat('b') == 1 || actor.stat('c') == 1",
			kind: "predicate",
			facts: {
				actor: {
					stat: { a: 0, b: 1, c: 1 },
				},
			},
		});

		expect(res.details.ok).toBe(true);
		expect(res.details.value).toEqual({ type: "Bool", value: false });

		const trace = res.details.trace ?? [];
		// Node for checking stat 'a' is in trace with false
		expect(trace.some((e) => e.value?.value === false)).toBe(true);
		// Stat 'b' and stat 'c' are short-circuited and not evaluated
		expect(trace.some((e) => e.operator === "ReadInt" && trace.indexOf(e) > 0)).toBe(false);
	});

	it("Scenario: A macro comes from the manifest", async () => {
		const manifestToml = `#:schema https://spellkave.example/schema/manifest-v1.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "test"
display_name = "Test"
author = "test"
version = "1.0.0"
depends_on = []

[[dsl_macro_definitions]]
macro_id = "demo/macro_bonus"
bundle_id = "test"
return_type = "Int"
parameters = []
body_source = "5"
`;
		const withContext = contextWith(manifestToml);
		const resWith = await evalToolDef.run(withContext, {
			expression: "10 + macro('demo/macro_bonus')",
			kind: "int",
		});

		expect(resWith.details.ok).toBe(true);
		expect(resWith.details.value).toEqual({ type: "Int", value: 15 });

		const withoutContext = contextWith(null);
		const resWithout = await evalToolDef.run(withoutContext, {
			expression: "10 + macro('demo/macro_bonus')",
			kind: "int",
		});

		expect(resWithout.details.ok).toBe(false);
		expect(resWithout.details.rejection).toMatchObject({
			kind: "unknown_macro",
			macro_id: "demo/macro_bonus",
		});
	});

	it("Scenario: Target-only macro and roll-table entries are available to eval", async () => {
		const target = {
			kind: "local" as const,
			resolveRef: () => false,
			lookup: (kind: string) => {
				if (kind === "bundles")
					return [
						{
							bundle_id: "target",
							display_name: "Target",
							author: "test",
							version: "1.0.0",
							depends_on: [],
						},
					];
				if (kind === "dsl_macro_definitions")
					return [
						{
							macro_id: "target/bonus",
							bundle_id: "target",
							return_type: "Int",
							parameters: [],
							body_source: "5",
						},
					];
				if (kind === "roll_table_entries")
					return [
						{
							roll_table_entry_id: "target/table:a",
							roll_table_id: "target/table",
							authored_order: 1,
							weight: 2,
							result_ref: "10",
						},
						{
							roll_table_entry_id: "target/table:b",
							roll_table_id: "target/table",
							authored_order: 2,
							weight: 3,
							result_ref: "20",
						},
					];
				return [];
			},
			applyBatch: async () => ({ ok: true }),
		};
		const context = contextWith(null, target);

		const macro = await evalToolDef.run(context, {
			expression: "macro('target/bonus')",
			kind: "int",
		});
		expect(macro.details.rejection).toBeUndefined();
		expect(macro.details.value).toEqual({ type: "Int", value: 5 });

		const table = await evalToolDef.run(context, {
			expression: "roll_table('target/table')",
			kind: "int",
			// Raw entropy 7 % (2 + 3) = 2 crosses `:a`'s weight-2 boundary into `:b`.
			dice: [7],
		});
		expect(table.details.value).toEqual({ type: "Int", value: 20 });
		expect(
			table.details.trace?.find((entry) => entry.operator === "RollTable")?.table_entries,
		).toEqual([{ entry_id: "target/table:b", kept: true }]);
	});

	it("Scenario: Scratch macro and roll-table rows override target rows", async () => {
		const target = {
			kind: "local" as const,
			resolveRef: () => false,
			lookup: (kind: string) => {
				if (kind === "bundles")
					return [
						{
							bundle_id: "target",
							display_name: "Target",
							author: "test",
							version: "1.0.0",
							depends_on: [],
						},
					];
				if (kind === "dsl_macro_definitions")
					return [
						{
							macro_id: "target/bonus",
							bundle_id: "target",
							return_type: "Int",
							parameters: [],
							body_source: "5",
						},
					];
				if (kind === "roll_table_entries")
					return [
						{
							roll_table_entry_id: "target/table:one",
							roll_table_id: "target/table",
							authored_order: 1,
							weight: 1,
							result_ref: "10",
						},
					];
				return [];
			},
			applyBatch: async () => ({ ok: true }),
		};
		const scratch = `#:schema https://spellkave.example/schema/manifest-v1.json
schema_version = "1.0.0"
[[dsl_macro_definitions]]
macro_id = "target/bonus"
bundle_id = "scratch"
return_type = "Int"
parameters = []
body_source = "9"

[[roll_table_entries]]
roll_table_entry_id = "target/table:one"
roll_table_id = "target/table"
authored_order = 1
weight = 1
result_ref = "99"
`;
		const context = contextWith(scratch, target);
		const macro = await evalToolDef.run(context, {
			expression: "macro('target/bonus')",
			kind: "int",
		});
		expect(macro.details.value).toEqual({ type: "Int", value: 9 });
		const table = await evalToolDef.run(context, {
			expression: "roll_table('target/table')",
			kind: "int",
			dice: [0],
		});
		expect(table.details.value).toEqual({ type: "Int", value: 99 });
	});

	it("Scenario: A supplied roll table wins", async () => {
		const manifestToml = `#:schema https://spellkave.example/schema/manifest-v1.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "test"
display_name = "Test"
author = "test"
version = "1.0.0"
depends_on = []

[[roll_tables]]
roll_table_id = "demo/table"
bundle_id = "test"
display_name = "Demo Table"
result_kind = "Int"

[[roll_table_entries]]
roll_table_entry_id = "demo/table:manifest_entry"
roll_table_id = "demo/table"
authored_order = 1
weight = 1
result_ref = "100"
`;
		const context = contextWith(manifestToml);
		const res = await evalToolDef.run(context, {
			expression: "roll_table('demo/table')",
			kind: "int",
			facts: {
				roll_tables: {
					"demo/table": [{ entry_id: "demo/table:facts_entry", weight: 1, result_ref: "200" }],
				},
			},
			dice: [1],
		});

		expect(res.details.ok).toBe(true);
		expect(res.details.value).toEqual({ type: "Int", value: 200 });

		const trace = res.details.trace ?? [];
		expect(
			trace.some((e) => e.table_entries?.some((te) => te.entry_id === "demo/table:facts_entry")),
		).toBe(true);
	});

	it("Scenario: An item source slot is evaluated", async () => {
		const context = contextWith();
		const res = await evalToolDef.run(context, {
			expression: "actor.wielded_item.source('damage')",
			kind: "int",
			facts: {
				item_sources: {
					"actor.wielded_item": {
						damage: "1d8 + 3",
					},
				},
			},
			dice: [7],
		});

		expect(res.details.ok).toBe(true);
		expect(res.details.value).toEqual({ type: "Int", value: 10 });

		const trace = res.details.trace ?? [];
		expect(
			trace.some((e) =>
				e.scope.some((s) => s.subject === "ActorWieldedItem" && s.slot === "damage"),
			),
		).toBe(true);
	});

	it("Scenario: Outcome-only operator is rejected", async () => {
		const context = contextWith();
		const res = await evalToolDef.run(context, {
			expression: "invoke_outcome_graph('core/open_container')",
			kind: "predicate",
		});

		expect(res.details.ok).toBe(false);
		expect(res.details.rejection).toMatchObject({
			kind: "unsupported_operator",
			operator: "InvokeOutcomeGraph",
		});
	});
});
