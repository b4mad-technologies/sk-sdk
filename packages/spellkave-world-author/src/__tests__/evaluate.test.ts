import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evaluateDslExpression } from "../evaluate";
import { docEvidence } from "../test/doc-evidence/evidence";

describe("evaluation wire contract", () => {
	it("preserves structured scopes, depth and nulls from WASM", () => {
		const result = evaluateDslExpression({
			expression: "actor.equipped_item('main_hand').source('damage')",
			kind: "int",
			facts: { item_sources: { "actor.equipped_item:main_hand": { damage: "1d6" } } },
			dice: [4],
		});
		const roll = result.trace?.find((entry) => entry.operator === "Roll");
		expect(roll).toMatchObject({ depth: 2, error: null, table_entries: null });
		const subject = roll?.scope[0]?.subject;
		expect(subject).toEqual({ ActorEquippedItem: { slot_id: "main_hand" } });
		if (typeof subject !== "object" || !("ActorEquippedItem" in subject)) {
			throw new Error("expected equipped item scope");
		}
		expect(subject.ActorEquippedItem.slot_id).toBe("main_hand");
	});

	it("exposes kept table selections and flat diagnostic spans", () => {
		const result = evaluateDslExpression({
			expression: "roll_table('demo/table')",
			kind: "int",
			facts: { roll_tables: { "demo/table": [{ entry_id: "a", result_ref: "9" }] } },
			dice: [0],
		});
		const selections = result.trace?.find((entry) => entry.operator === "RollTable")?.table_entries;
		expect(selections).toEqual([{ entry_id: "a", kept: true }]);
		expect(selections?.[0]?.kept).toBe(true);
		const invalid = evaluateDslExpression({ expression: "1 +", kind: "int" });
		const diagnostic = invalid.rejection?.diagnostics?.[0];
		expect(diagnostic?.start).toEqual(expect.any(Number));
		expect(diagnostic?.end).toEqual(expect.any(Number));
	});

	it("rejects malformed capability values through the shipped WASM", () => {
		const result = evaluateDslExpression({
			expression: "actor.has_capability('demo/walk')",
			kind: "predicate",
			facts: { actor: { capabilities: { "demo/walk": "false" } } },
		});
		expect(result.ok).toBe(false);
		expect(result.rejection?.kind).toBe("invalid_facts");
		expect(result.error).toContain("actor.capabilities.demo/walk");
	});
});

docEvidence(
	{
		doc: "rule-bench",
		tier: "offline",
		claim: "The documented facts object evaluates with the shipped bench",
	},
	() => {
		const guide = readFileSync(new URL("../../docs/rule-bench.md", import.meta.url), "utf8");
		const json = guide.match(/```json\n([\s\S]*?)\n```/)?.[1];
		if (!json) throw new Error("guide facts example missing");
		const facts = JSON.parse(json);
		const result = evaluateDslExpression({
			expression: "1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')",
			kind: "predicate",
			facts,
			dice: [12],
		});
		expect(result.value).toEqual({ type: "Bool", value: true });
		expect(
			evaluateDslExpression({ expression: "actor.stat('srd/hp')", kind: "int", facts }).value,
		).toEqual({ type: "Int", value: 25 });
	},
);
