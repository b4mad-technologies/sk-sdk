// Every `sk` answer goes to stdout in one of three forms: JSONL for scripts
// and pipes, Markdown-like text for a person at a terminal, or TOON for
// agents. These tests pin how the form is chosen and how each form looks:
// tables in a stable column order, large numbers kept exact, text that only
// repeats the details dropped, errors shown as errors. Scripts depend on the
// JSONL shape (ADR-0002). Pure rendering; no node.
import { describe, expect, it } from "vitest";

import {
	createRecordIo,
	prepareHumanRecord,
	projectJsonToMarkdown,
	renderHumanRecord,
	resolveOutputFormat,
	stringifyJsonl,
	stringifyToon,
} from "../output.ts";
import { collect } from "./helpers.ts";

describe("output selection", () => {
	it("uses human output only for a TTY in auto mode", () => {
		expect(resolveOutputFormat("auto", true)).toBe("human");
		expect(resolveOutputFormat("auto", false)).toBe("jsonl");
		expect(resolveOutputFormat("human", false)).toBe("human");
		expect(resolveOutputFormat("jsonl", true)).toBe("jsonl");
	});

	it("drops a text field that only repeats details from JSONL records", () => {
		const collected = collect({ stdoutIsTTY: true });
		const output = createRecordIo(collected.io, "jsonl");
		const record = {
			kind: "tool_result",
			text: '{\n  "ok": true\n}',
			details: { ok: true },
		};

		output.record(record);
		output.hint("Next: ignored");

		expect(collected.out).toEqual([JSON.stringify({ kind: "tool_result", details: { ok: true } })]);
	});

	it("keeps JSONL text that is not a copy of details", () => {
		const collected = collect({ stdoutIsTTY: true });
		const output = createRecordIo(collected.io, "jsonl");
		const record = {
			kind: "tool_result",
			text: "The manifest is ready for review.",
			details: { ok: true },
		};

		output.record(record);

		expect(collected.out).toEqual([JSON.stringify(record)]);
	});

	it("keeps human guidance with the human-readable stdout result", () => {
		const collected = collect();
		const output = createRecordIo(collected.io, "human");

		output.record({ kind: "tool_list", tools: [] });
		output.hint("Next: run sk help <tool>.");

		expect(collected.err).toEqual([]);
		expect(collected.out.at(-1)).toBe("Next: run sk help <tool>.");
	});

	it("wraps hint descriptions while leaving the copyable command intact", () => {
		const collected = collect({ stdoutColumns: 48 });
		const output = createRecordIo(collected.io, "human");

		output.hint(
			"Next:\n  sk query --kind capability_definitions — browse a populated row kind and inspect it",
		);

		expect(collected.out).toContain("  sk query --kind capability_definitions");
		expect(collected.out.every((line) => line.length <= 48)).toBe(true);
	});

	it("separates multiple human records with one blank line", () => {
		const collected = collect({ stdoutColumns: 70 });
		const output = createRecordIo(collected.io, "human");

		output.record({ kind: "finding", message: "One" });
		output.record({ kind: "tool_result", ok: true });

		expect(collected.out.filter((line) => line === "")).toHaveLength(1);
		expect(collected.out.join("\n")).toContain("Finding");
		expect(collected.out.join("\n")).toContain("Tool result");
	});
});

describe("generic JSON-to-Markdown projection", () => {
	it("projects flat records as a table in stable column order", () => {
		const markdown = projectJsonToMarkdown([
			{ id: "first", ready: true },
			{ id: "second", ready: false },
		]);

		expect(markdown).toContain("| Id | Ready |");
		expect(markdown).toContain("| first | true |");
		expect(markdown).toContain("| second | false |");
	});

	it("renders nested arrays and multiline Markdown below field headings", () => {
		const markdown = projectJsonToMarkdown({
			kind: "example",
			items: [{ id: "one", count: 2 }],
			notes: "### Authored note\n\nThis remains **Markdown**.",
		});

		expect(markdown).toContain("| Field | Value |");
		expect(markdown).toContain("## Items");
		expect(markdown).toContain("| Id | Count |");
		expect(markdown).toContain("## Notes");
		expect(markdown).toContain("This remains **Markdown**.");
	});

	it("keeps nested record data after a scalar summary table", () => {
		const markdown = projectJsonToMarkdown([
			{ name: "alpha", flags: [{ flag: "--one", required: true }] },
			{ name: "beta", flags: [{ flag: "--two", required: false }] },
		]);

		expect(markdown).toContain("| Name |");
		expect(markdown).toContain("## alpha");
		expect(markdown).toContain("### Flags");
		expect(markdown).toContain("| Flag | Required |");
	});

	it("keeps large record collections scannable by summarizing nested data", () => {
		const names = [
			"query",
			"spawn",
			"inspect",
			"validate",
			"scene",
			"inventory",
			"traces",
			"end_turn",
			"write_rows",
			"define_action",
		];
		const markdown = projectJsonToMarkdown(
			Array.from({ length: 10 }, (_, index) => ({
				name: `spellkave_${names[index]}`,
				flags: [{ flag: "--value", required: true }],
				...(index === 9 ? { reason: "Not configured" } : {}),
			})),
		);

		expect(markdown).toContain("| Name |");
		expect(markdown).toContain("| query |");
		expect(markdown).toContain("Shared `name` prefix omitted");
		expect(markdown).toContain("`spellkave_`");
		expect(markdown).toContain("Optional fields omitted");
		expect(markdown).toContain("`flags`");
		expect(markdown).toContain("`reason`");
		expect(markdown).not.toContain("## tool-0");
	});

	it("renders ordered topic fields as grouped sections instead of a repeated column", () => {
		const markdown = projectJsonToMarkdown(
			Array.from({ length: 10 }, (_, index) => ({
				topic: index < 2 ? "Start here" : "Examples",
				id: `doc-${index}`,
				title: `Document ${index}`,
			})),
		);

		expect(markdown).toContain("## Start here");
		expect(markdown).toContain("## Examples");
		expect(markdown).toContain("| Id | Title |");
		expect(markdown).not.toContain("| Topic |");
		expect(markdown.indexOf("## Start here")).toBeLessThan(markdown.indexOf("## Examples"));
	});

	it("distills large numeric maps by omitting zero-valued fields", () => {
		const markdown = projectJsonToMarkdown({
			capability_definitions: 11,
			entity_definitions: 5,
			...Object.fromEntries(Array.from({ length: 15 }, (_, index) => [`empty_${index}`, 0])),
		});

		expect(markdown).toContain("Capability definitions");
		expect(markdown).toContain("`capability_definitions`");
		expect(markdown).toContain("Entity definitions");
		expect(markdown).toContain("15 zero-valued fields omitted");
		expect(markdown).toContain("--format jsonl");
		expect(markdown).not.toContain("Empty 0");
	});

	it("renders standard error records as errors rather than data tables", () => {
		const rendered = renderHumanRecord(
			{ kind: "error", scope: "usage", message: "unknown tool" },
			{ width: 72 },
		).join("\n");

		expect(rendered).toContain("Error:");
		expect(rendered).toContain("unknown tool");
		expect(rendered).not.toContain("Field");
		expect(rendered).not.toContain("Scope");
	});

	it("falls back visibly for cyclic, non-JSON input", () => {
		const value: Record<string, unknown> = { id: "cycle" };
		value.self = value;

		const markdown = projectJsonToMarkdown(value);

		expect(markdown).toContain("~~~json");
		expect(markdown).toContain("[Circular]");
	});

	it("renders within the injected terminal width", () => {
		const lines = renderHumanRecord(
			{ kind: "example", message: "A deliberately long sentence that must wrap in the table." },
			{ width: 48 },
		);

		expect(lines.length).toBeGreaterThan(1);
		expect(lines.every((line) => line.length <= 48)).toBe(true);
	});
});

describe("duplicate text suppression", () => {
	it("hides the internal record discriminator from human output", () => {
		const prepared = prepareHumanRecord({
			kind: "validate_result",
			path: "manifest.toml",
			valid: true,
		});

		expect(prepared).toEqual({ path: "manifest.toml", valid: true });
	});

	it("removes text only when it is JSON-equivalent to details", () => {
		const prepared = prepareHumanRecord({
			kind: "tool_result",
			text: JSON.stringify({ ok: true, items: [{ id: "one" }] }, null, 2),
			details: { items: [{ id: "one" }], ok: true },
		});

		expect(prepared).not.toHaveProperty("text");
		expect(prepared).toHaveProperty("details");
	});

	it("preserves independently useful prose", () => {
		const prepared = prepareHumanRecord({
			kind: "tool_result",
			text: "The manifest is ready for review.",
			details: { ok: true },
		});

		expect(prepared.text).toBe("The manifest is ready for review.");
	});
});

describe("JSONL bigint integers", () => {
	const i64Min = -9223372036854775808n;
	const i64Max = 9223372036854775807n;
	const u64Max = 18446744073709551615n;

	it("emits decimal strings and does not throw", () => {
		expect(() => JSON.stringify({ i64Max })).toThrow();
		const line = stringifyJsonl({
			kind: "get_result",
			value_int: i64Max,
			expires_at: u64Max,
			min_int: i64Min,
		});
		expect(line).toBe(
			'{"kind":"get_result","value_int":"9223372036854775807","expires_at":"18446744073709551615","min_int":"-9223372036854775808"}',
		);
	});

	it("writes the same digits on the jsonl record path", () => {
		const collected = collect();
		const output = createRecordIo(collected.io, "jsonl");
		output.record({
			kind: "get_result",
			row: { value_int: i64Max, expires_at: u64Max },
		});
		expect(collected.out).toEqual([
			'{"kind":"get_result","row":{"value_int":"9223372036854775807","expires_at":"18446744073709551615"}}',
		]);
	});
});

describe("toon output", () => {
	it("renders a uniform array of objects as one table", () => {
		expect(
			stringifyToon({
				items: [
					{ kind: "place_nodes", key: "town/hall", label: "Hall" },
					{ kind: "place_nodes", key: "town/yard", label: "Yard" },
				],
			}),
		).toBe("items[2]{kind,key,label}:\n  place_nodes,town/hall,Hall\n  place_nodes,town/yard,Yard");
	});

	it("nests objects by indentation and keeps scalars on one line", () => {
		expect(stringifyToon({ ok: true, count: 2, none: null, page: { total: 3, more: false } })).toBe(
			"ok: true\ncount: 2\nnone: null\npage:\n  total: 3\n  more: false",
		);
	});

	it("quotes strings that would read as something else", () => {
		const text = stringifyToon({
			comma: "a, b",
			numeric: "123",
			boolish: "true",
			empty: "",
			newline: "one\ntwo",
			quote: 'say "hi"',
			colon: "k: v",
			plain: "Straße town/hall",
		});
		expect(text).toBe(
			[
				'comma: "a, b"',
				'numeric: "123"',
				'boolish: "true"',
				'empty: ""',
				'newline: "one\\ntwo"',
				'quote: "say \\"hi\\""',
				'colon: "k: v"',
				"plain: Straße town/hall",
			].join("\n"),
		);
	});

	it("says an empty array is empty instead of dropping it", () => {
		expect(stringifyToon({ items: [], nested: { rows: [] } })).toBe(
			"items: []\nnested:\n  rows: []",
		);
	});

	it("writes bigint as a decimal string, as JSONL does", () => {
		expect(stringifyToon({ tick: 12345678901234567890n })).toBe('tick: "12345678901234567890"');
	});

	it("emits one document per record, a blank line between, on stdout only", () => {
		const collected = collect({ stdoutIsTTY: true });
		const output = createRecordIo(collected.io, "toon");
		output.record({ a: 1 });
		output.record({ b: 2 });
		output.hint("Next: ignored in machine output");
		expect(output.format).toBe("toon");
		expect(collected.out).toEqual(["a: 1", "", "b: 2"]);
		expect(collected.err).toEqual([]);
	});

	it("drops a text field that only repeats details, like JSONL", () => {
		const collected = collect();
		createRecordIo(collected.io, "toon").record({
			kind: "tool_result",
			text: '{"ok":true}',
			details: { ok: true },
		});
		expect(collected.out).toEqual(["kind: tool_result", "details:", "  ok: true"]);
	});

	it("is chosen only by --format toon, or by a command's preferred format while auto", () => {
		expect(resolveOutputFormat("toon", false)).toBe("toon");
		expect(resolveOutputFormat("toon", true)).toBe("toon");
		for (const tty of [true, false]) {
			expect(resolveOutputFormat("auto", tty, "toon")).toBe("toon");
			// An explicit choice always wins over the command's preference.
			expect(resolveOutputFormat("jsonl", tty, "toon")).toBe("jsonl");
			expect(resolveOutputFormat("json", tty, "toon")).toBe("jsonl");
			expect(resolveOutputFormat("human", tty, "toon")).toBe("human");
		}
		// No preference: today's defaults, untouched.
		expect(resolveOutputFormat("auto", true)).toBe("human");
		expect(resolveOutputFormat("auto", false)).toBe("jsonl");
	});

	it("keeps JSONL and human output byte-identical when a command prefers toon", () => {
		const record = { kind: "tool_result", ok: true, items: [{ id: "a" }, { id: "b" }] };
		for (const format of ["jsonl", "human"] as const) {
			const plain = collect({ stdoutIsTTY: true });
			const preferring = collect({ stdoutIsTTY: true });
			createRecordIo(plain.io, format).record(record);
			createRecordIo(preferring.io, format, "toon").record(record);
			expect(preferring.out).toEqual(plain.out);
		}
		const jsonl = collect();
		createRecordIo(jsonl.io, "jsonl").record(record);
		expect(jsonl.out).toEqual([JSON.stringify(record)]);
	});
});
