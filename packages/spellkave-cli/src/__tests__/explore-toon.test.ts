// An agent exploring a world with `sk explore` reads TOON (a compact,
// table-like text form of JSON) by default, so each answer costs few tokens.
// These tests pin that text: rows as one table, a detail as one object, the
// source and completeness lines only when they say something, an empty or
// unavailable answer said out loud, and next steps as commands to copy.
// Only `sk explore` prefers TOON; `--format` still wins. Pure; no node.
import { fileURLToPath } from "node:url";
import { decode } from "@toon-format/toon";
import { describe, expect, it } from "vitest";
import { PREFERRED_FORMAT, runCli } from "../cli";
import { exploreToonShape } from "../explore-toon";
import { projectExploreRecord } from "../explore-verbs";
import { stringifyToon } from "../output";
import { collect } from "./helpers";

const ref = (id: string, kind = "place_nodes") => ({ kind, id, bundle: "town" });
const graph = { kind: "place_graphs", id: "town/g", bundle: "town" };
const source = { source: "local", source_id: "0123456789abcdef", coverage: "complete" };

describe("explore TOON shape", () => {
	it("lists rows as one table with the context as one column", () => {
		const shaped = exploreToonShape({
			ok: true,
			operation: "search",
			source,
			completeness: "complete",
			items: [
				{ ref: ref("town/a"), label: "Straße", context: [graph] },
				{ ref: ref("town/b"), label: "Straße", context: [graph] },
			],
			page: { complete: true, total: { count: 2 } },
		});
		expect(stringifyToon(shaped)).toBe(
			[
				"source: local",
				"source_id: 0123456789abcdef",
				"completeness: complete",
				"total: 2",
				"items[2]{kind,key,label,context}:",
				"  place_nodes,town/a,Straße,place_graphs town/g",
				"  place_nodes,town/b,Straße,place_graphs town/g",
			].join("\n"),
		);
	});

	it("prints next as complete commands, one per line, and help as templates", () => {
		const shaped = exploreToonShape(
			{
				ok: true,
				operation: "search",
				source,
				completeness: "complete",
				items: [
					{ ref: ref("town/a"), label: "A" },
					{ ref: ref("town/b"), label: "B" },
				],
				page: { complete: false, next_cursor: "c", total: { count: 9 } },
				next: ["sk explore search --cursor c"],
			},
			"sk explore detail <kind> <key> --source-id 0123456789abcdef",
		);
		const text = stringifyToon(shaped);
		expect(text).toContain("more: showing 2 of 9; the next commands show more");
		expect(text).toContain("next[1]{command}:\n  sk explore search --cursor c");
		expect(text).toContain("help[1]{command}:\n  sk explore detail <kind> <key> --source-id");
		expect((decode(text) as { next: { command: string }[] }).next[0]?.command).toBe(
			"sk explore search --cursor c",
		);
	});

	it("adds the bundle, relationship and chosen fields as columns only when a row has them", () => {
		const shaped = exploreToonShape({
			ok: true,
			operation: "neighbors",
			source,
			completeness: "complete",
			items: [
				{
					ref: { kind: "entity_definitions", id: "x/chest", bundle: "x" },
					label: "Chest",
					relationship: { kind: "initial_capability", key: "k", direction: "outbound" },
					fields: { pos_x: 3 },
				},
				{
					ref: { kind: "capability_definitions", id: "town/open", bundle: "town" },
					label: "Open",
					relationship: { kind: "initial_capability", key: "k", direction: "inbound" },
				},
			],
			page: { complete: true, total: { count: 2 } },
		});
		expect(shaped.items).toEqual([
			{
				kind: "entity_definitions",
				key: "x/chest",
				label: "Chest",
				bundle: "x",
				relationship: "initial_capability outbound",
				pos_x: 3,
			},
			{
				kind: "capability_definitions",
				key: "town/open",
				label: "Open",
				bundle: "town",
				relationship: "initial_capability inbound",
				pos_x: null,
			},
		]);
	});

	it("shows a detail as one object, with each text once and how much of it is cut", () => {
		const shaped = exploreToonShape({
			ok: true,
			operation: "detail",
			source,
			completeness: "complete",
			items: [
				{
					ref: ref("town/hall"),
					label: "Hall",
					description: "ää",
					context: [graph],
					fields: { description: "ää", pos_x: 3 },
					truncated: [{ field: "description", shown_code_points: 2, total_code_points: 9 }],
				},
			],
			page: { complete: true },
		});
		expect(shaped.item).toEqual({
			kind: "place_nodes",
			key: "town/hall",
			bundle: "town",
			label: "Hall",
			context: "place_graphs town/g",
			description: "ää",
			pos_x: 3,
		});
		expect(shaped.truncated).toEqual([{ field: "description", shown: 2, total: 9 }]);
	});

	it("says explicitly that an empty complete answer is empty", () => {
		const shaped = exploreToonShape({
			ok: true,
			operation: "search",
			source,
			completeness: "complete",
			items: [],
			page: { complete: true, total: { count: 0 } },
		});
		expect(stringifyToon(shaped)).toContain(
			"total: 0\nitems: 0 matches; complete for this scope only",
		);
	});

	it("turns an unavailable answer into one error block with reason, class, cause and hint", () => {
		const shaped = exploreToonShape({
			ok: false,
			status: "unavailable",
			reason: "source_unreadable",
			error_class: "usage",
			cause: "manifest root missing 'x'.",
			hint: "Pass --fixtures-root <dir>.",
			completeness: "incomplete",
			source: { source: "local", source_id: "unavailable", coverage: [] },
			items: [],
			recovery: ["sk explore search --source live"],
		});
		expect(stringifyToon(shaped)).toBe(
			[
				"error: unavailable",
				"completeness: incomplete",
				"reason: source_unreadable",
				"error_class: usage",
				"cause: manifest root missing 'x'.",
				"hint: Pass --fixtures-root <dir>.",
				"recovery[1]{command}:",
				"  sk explore search --source live",
			].join("\n"),
		);
	});
});

describe("explore TOON header", () => {
	const answer = (over: Record<string, unknown> = {}) => ({
		ok: true,
		operation: "search",
		source,
		completeness: "complete",
		items: [{ ref: ref("town/a"), label: "A" }],
		page: { complete: true, total: { count: 1 } },
		...over,
	});
	it("keeps completeness explicit with compact default-source metadata", () => {
		const text = stringifyToon(exploreToonShape(answer(), undefined, "local"));
		expect(text.split("\n")[0]).toBe("completeness: complete");
		expect(text).not.toMatch(/source|coverage/);
	});
	it("prints them when the source is not the default one", () => {
		const text = stringifyToon(exploreToonShape(answer(), undefined, "live"));
		expect(text).toMatch(
			/^source: local\nsource_id: 0123456789abcdef\ncompleteness: complete\ntotal: 1/,
		);
	});
	it("prints them, with the reason, when something is not complete", () => {
		const incomplete = answer({
			completeness: "incomplete",
			page: { complete: true },
			source: {
				...source,
				coverage: [
					{ state: "incomplete", reason: "examined_row_bound", families: ["entity_definitions"] },
				],
			},
		});
		const text = stringifyToon(exploreToonShape(incomplete, undefined, "local"));
		expect(text).toContain("completeness: incomplete");
		expect(text).toContain("incomplete,examined_row_bound,entity_definitions");
		expect(text).not.toContain("total:");
	});
	it("keeps a detail template for neighbors, whose source id is no longer printed", () => {
		const text = stringifyToon(
			exploreToonShape(
				answer({ operation: "neighbors" }),
				"sk explore detail <kind> <key> --source-id 0123456789abcdef",
				"local",
			),
		);
		expect(text).toContain("help[1]{command}:\n  sk explore detail <kind> <key> --source-id");
	});
	it("says how many are shown when the total is unknown", () => {
		const text = stringifyToon(
			exploreToonShape(answer({ page: { complete: false, next_cursor: "c" } }), undefined, "local"),
		);
		expect(text).toContain("more: showing 1; the next commands show more");
	});
	it.each([
		"search",
		"detail",
	])("explains a fixed reader bound without a replay recovery for %s", (operation) => {
		const record = answer({
			operation,
			completeness: "incomplete",
			source: {
				...source,
				coverage: [
					{ state: "incomplete", reason: "examined_row_bound", families: ["entity_definitions"] },
				],
			},
			recovery: ["sk explore search --collection definitions"],
			next: ["sk explore search --collection definitions --cursor c"],
		});
		const shaped = exploreToonShape(record, undefined, "local");
		expect(shaped.completeness).toBe("incomplete");
		expect(shaped.coverage_note).toContain("fixed reader bound");
		expect(shaped.coverage_note).toContain("Repeating this command will not broaden coverage");
		expect(shaped.recovery).toBeUndefined();
		expect(shaped.next).toEqual([
			{ command: "sk explore search --collection definitions --cursor c" },
		]);
	});
	// K5: host coverage combinations; the real CLI unsupported-catalog journey is in visibility.feature.
	it.each([
		["unsupported", [{ state: "unsupported", reason: "no_live_projection" }]],
		["authored projection", [{ state: "incomplete", reason: "authored_entities_only" }]],
		[
			"mixed fixed limits",
			[
				{ state: "unsupported", reason: "no_live_projection" },
				{ state: "incomplete", reason: "examined_row_bound" },
				{ state: "incomplete", reason: "authored_entities_only" },
			],
		],
	])("omits an unchanged retry for %s", (_name, coverage) => {
		const shaped = exploreToonShape(
			answer({
				completeness: "incomplete",
				source: { ...source, source: "live", coverage },
				recovery: ["sk explore search --collection definitions --source live"],
			}),
		);
		expect(shaped.recovery).toBeUndefined();
		expect(shaped.coverage_note).toContain("Repeating this command will not broaden coverage");
	});
	it("keeps recoveries for other incomplete coverage", () => {
		const shaped = exploreToonShape(
			answer({
				completeness: "incomplete",
				source: {
					...source,
					coverage: [
						{ state: "incomplete", reason: "examined_row_bound" },
						{ state: "disconnected", reason: "reader_unavailable" },
					],
				},
				recovery: ["sk explore search"],
			}),
		);
		expect(shaped.recovery).toEqual([{ command: "sk explore search" }]);
	});
	it("does not claim complete absence when no examined rows match", () => {
		const shaped = exploreToonShape(answer({ completeness: "incomplete", items: [] }));
		expect(shaped.items).toBe("0 matches in examined rows; coverage is incomplete");
	});
	it("identifies live results as caller-visible rows", () => {
		const shaped = exploreToonShape(
			answer({ source: { ...source, source: "live" } }),
			undefined,
			"live",
		);
		expect(shaped.scope).toBe("caller-visible rows");
		expect(exploreToonShape(answer(), undefined, "local")).not.toHaveProperty("scope");
	});
	it("preserves the row-bound recovery in the JSONL projection", () => {
		const record = answer({
			completeness: "incomplete",
			source: { ...source, coverage: [{ state: "incomplete", reason: "examined_row_bound" }] },
			recovery: [
				{ tool: "spellkave_query", params: { explore: { operation: "search", source: "local" } } },
			],
		});
		expect(projectExploreRecord(record, [], "jsonl").recovery).toEqual([
			"sk explore search --source local",
		]);
		expect(record).toHaveProperty("recovery", [
			{ tool: "spellkave_query", params: { explore: { operation: "search", source: "local" } } },
		]);
	});
});

describe("sk explore output format", () => {
	const core = fileURLToPath(
		new URL("./fixtures/catalog", import.meta.url),
	);
	const run = async (args: string[], stdoutIsTTY: boolean) => {
		const io = collect({ stdoutIsTTY });
		const code = await runCli(
			[
				"--target",
				`${core}/manifest.toml`,
				...args,
				"explore",
				"search",
				"torch",
				"--collection",
				"definitions",
				"--kind",
				"entity_definitions",
			],
			io.io,
		);
		return { code, text: io.out.join("\n") };
	};

	it("prints TOON by default, on a pipe and on a TTY", async () => {
		for (const tty of [false, true]) {
			const { code, text } = await run([], tty);
			expect(code).toBe(0);
			// Completeness stays explicit even when default-source metadata is omitted.
			expect(text).toMatch(/^completeness: complete\ntotal: 1\nitems\[1\]/);
			expect(text).not.toMatch(/^(source|source_id|coverage)/m);
			expect(text).toContain("items[1]{kind,key,label");
		}
	});

	it("declares a preferred format for the agent-facing groups only", () => {
		expect(PREFERRED_FORMAT).toEqual({ explore: "toon", spire: "toon" });
	});

	it("lets an explicit --format win", async () => {
		const jsonl = await run(["--format", "jsonl"], true);
		expect(JSON.parse(jsonl.text)).toMatchObject({ kind: "explore_result", shape: "exploration" });
		const human = await run(["--format", "human"], false);
		expect(human.text).toContain("Completeness");
		expect(human.text).not.toContain("source_id: ");
		const toon = await run(["--format", "toon"], false);
		expect(toon.text).toMatch(/^completeness: complete\ntotal: 1\n/);
	});
});
