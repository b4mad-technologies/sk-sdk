// A world author tries a DSL formula (a roll, a predicate, a macro) with
// `sk eval` before putting it into a manifest. It must give the same answer
// as `sk tool spellkave_eval`, need no node, and keep its exit codes: 0 for
// any result (false included), 2 when the formula is rejected, 1 for a usage
// error. The human trace of each of the 11 evaluation kinds is pinned as a
// snapshot (`__snapshots__/eval-cli.test.ts.snap`). Offline; fixed dice.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXIT_IN_WORLD, EXIT_OK, EXIT_USAGE, runCli } from "../cli.ts";
import { collect, snapshotText } from "./helpers.ts";

let workspace: string;

beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "sk-eval-cli-"));
});

afterEach(() => {
	rmSync(workspace, { recursive: true, force: true });
	delete process.env.SPELLKAVE_AUTHOR_LOCAL_TARGET;
	delete process.env.SPELLKAVE_AUTHOR_WORKSPACE;
});

describe("sk eval CLI projection", () => {
	it("Scenario: No node is needed", async () => {
		const io = collect();
		const code = await runCli(["--format", "jsonl", "eval", "1 + 1", "--kind", "int"], io.io);

		expect(code).toBe(EXIT_OK);
		expect(io.out).toHaveLength(1);
		const payload = JSON.parse(io.out[0] as string);
		expect(payload.kind).toBe("tool_result");
		expect(payload.tool).toBe("spellkave_eval");
		expect(payload.ok).toBe(true);
		expect(payload.details.value).toEqual({ type: "Int", value: 2 });
	});

	it("Scenario: Same result through the tool (sk eval vs sk tool spellkave_eval)", async () => {
		const evalIo = collect();
		const toolIo = collect();

		const expr = "1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')";
		const facts = JSON.stringify({
			actor: { stat: { "demo/bonus": 3 } },
			target: { stat: { "demo/threshold": 15 } },
		});

		const evalCode = await runCli(
			["--format", "jsonl", "eval", expr, "--kind", "predicate", "--facts", facts, "--dice", "12"],
			evalIo.io,
		);
		const toolCode = await runCli(
			[
				"--format",
				"jsonl",
				"tool",
				"spellkave_eval",
				expr,
				"--kind",
				"predicate",
				"--facts",
				facts,
				"--dice",
				"12",
			],
			toolIo.io,
		);

		expect(evalCode).toBe(EXIT_OK);
		expect(toolCode).toBe(EXIT_OK);
		expect(evalIo.out).toHaveLength(1);
		expect(toolIo.out).toHaveLength(1);
		expect(JSON.parse(evalIo.out[0] as string)).toEqual(JSON.parse(toolIo.out[0] as string));
	});

	it("Exit code contract: 0 for true/false success, 2 for rejection, 1 for usage error", async () => {
		// True predicate -> 0
		const trueIo = collect();
		const trueCode = await runCli(
			["eval", "1d20 >= 10", "--kind", "predicate", "--dice", "15", "--format", "json"],
			trueIo.io,
		);
		expect(trueCode).toBe(EXIT_OK);

		// False predicate -> 0
		const falseIo = collect();
		const falseCode = await runCli(
			["eval", "1d20 >= 10", "--kind", "predicate", "--dice", "5", "--format", "json"],
			falseIo.io,
		);
		expect(falseCode).toBe(EXIT_OK);

		// Rejection (missing dice) -> 2
		const rejIo = collect();
		const rejCode = await runCli(
			["eval", "1d20 >= 10", "--kind", "predicate", "--format", "json"],
			rejIo.io,
		);
		expect(rejCode).toBe(EXIT_IN_WORLD);

		// Usage error (invalid kind) -> 1
		const usageIo = collect();
		const usageCode = await runCli(
			["eval", "1d20 >= 10", "--kind", "invalid", "--format", "json"],
			usageIo.io,
		);
		expect(usageCode).toBe(EXIT_USAGE);
	});
});

describe("Human-readable trace snapshots across all 11 evaluation kinds", () => {
	it("1. A roll against fixed dice", async () => {
		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			[
				"eval",
				"1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')",
				"--kind",
				"predicate",
				"--facts",
				JSON.stringify({
					actor: { stat: { "demo/bonus": 3 } },
					target: { stat: { "demo/threshold": 15 } },
				}),
				"--dice",
				"12",
				"--format",
				"human",
			],
			io.io,
		);
		expect(code).toBe(EXIT_OK);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("2. False predicate is a result, not a rejection", async () => {
		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			[
				"eval",
				"1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')",
				"--kind",
				"predicate",
				"--facts",
				JSON.stringify({
					actor: { stat: { "demo/bonus": 3 } },
					target: { stat: { "demo/threshold": 15 } },
				}),
				"--dice",
				"11",
				"--format",
				"human",
			],
			io.io,
		);
		expect(code).toBe(EXIT_OK);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("3. A missing fact is named", async () => {
		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			[
				"eval",
				"1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')",
				"--kind",
				"predicate",
				"--facts",
				JSON.stringify({
					actor: { stat: { "demo/bonus": 3 } },
				}),
				"--dice",
				"12",
				"--format",
				"human",
			],
			io.io,
		);
		expect(code).toBe(EXIT_IN_WORLD);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("4. An unknown pool is named", async () => {
		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			[
				"eval",
				"actor.stat('demo/bonus') >= 3",
				"--kind",
				"predicate",
				"--facts",
				JSON.stringify({
					actor: {
						stat: { "demo/bonus": 3 },
						unknown_pool: { x: 1 },
					},
				}),
				"--format",
				"human",
			],
			io.io,
		);
		expect(code).toBe(EXIT_IN_WORLD);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("5. Too few dice", async () => {
		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			["eval", "2d6", "--kind", "int", "--dice", "4", "--format", "human"],
			io.io,
		);
		expect(code).toBe(EXIT_IN_WORLD);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("6. Too few dice inside an item source", async () => {
		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			[
				"eval",
				"1d6 + actor.wielded_item.source('damage')",
				"--kind",
				"int",
				"--facts",
				JSON.stringify({
					item_sources: {
						"actor.wielded_item": {
							damage: "2d6",
						},
					},
				}),
				"--dice",
				"3,4",
				"--format",
				"human",
			],
			io.io,
		);
		expect(code).toBe(EXIT_IN_WORLD);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("7. The bench applies the resolution limits", async () => {
		const io = collect({ stdoutColumns: 120 });
		const dice = Array.from({ length: 300 }, () => 3).join(",");
		const code = await runCli(
			["eval", "300d6", "--kind", "int", "--dice", dice, "--format", "human"],
			io.io,
		);
		expect(code).toBe(EXIT_IN_WORLD);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("8. The trace shows how a boolean expression groups", async () => {
		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			[
				"eval",
				"actor.stat('a') == 1 && actor.stat('b') == 1 || actor.stat('c') == 1",
				"--kind",
				"predicate",
				"--facts",
				JSON.stringify({
					actor: { stat: { a: 0, b: 1, c: 1 } },
				}),
				"--format",
				"human",
			],
			io.io,
		);
		expect(code).toBe(EXIT_OK);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("9. A macro comes from the manifest", async () => {
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
		writeFileSync(join(workspace, "manifest.toml"), manifestToml, "utf8");

		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			[
				"--workspace",
				workspace,
				"eval",
				"10 + macro('demo/macro_bonus')",
				"--kind",
				"int",
				"--format",
				"human",
			],
			io.io,
		);
		expect(code).toBe(EXIT_OK);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("10. A supplied roll table wins", async () => {
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
		writeFileSync(join(workspace, "manifest.toml"), manifestToml, "utf8");

		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			[
				"--workspace",
				workspace,
				"eval",
				"roll_table('demo/table')",
				"--kind",
				"int",
				"--facts",
				JSON.stringify({
					roll_tables: {
						"demo/table": [{ entry_id: "demo/table:facts_entry", weight: 1, result_ref: "200" }],
					},
				}),
				"--dice",
				"1",
				"--format",
				"human",
			],
			io.io,
		);
		expect(code).toBe(EXIT_OK);
		expect(snapshotText(io.out)).toMatchSnapshot();
	});

	it("11. An equipped item source slot is evaluated", async () => {
		const io = collect({ stdoutColumns: 120 });
		const code = await runCli(
			[
				"eval",
				"actor.equipped_item('main_hand').source('damage')",
				"--kind",
				"int",
				"--facts",
				JSON.stringify({
					item_sources: {
						"actor.equipped_item:main_hand": {
							damage: "1d8 + 3",
						},
					},
				}),
				"--dice",
				"7",
				"--format",
				"human",
			],
			io.io,
		);
		expect(code).toBe(EXIT_OK);
		const human = snapshotText(io.out);
		expect(human).toContain("### Draws");
		expect(human).toContain('actor.equipped_item("main_hand").damage');
		expect(human).not.toContain("dice: [7]");
		expect(human).toMatchSnapshot();
	});
});
