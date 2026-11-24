// An agent explores a world one command at a time: `sk explore search`, then
// `detail`, `neighbors`, `references` or `field` on a reference the last
// answer printed. Every printed next step must be a command that, run as
// printed (quotes included), sends exactly the same request. These tests
// round-trip every operation through its printed command and refuse half a
// reference or an unknown verb. Pure parsing; no node.
import type { ExploreRequest } from "@spellkave/tool-contracts";
import { describe, expect, it } from "vitest";
import { UsageError } from "../args";
import {
	EXPLORE_VERBS,
	exploreVerb,
	parseExploreArgs,
	projectExploreBody,
	projectExploreRecord,
	renderExploreCommand,
} from "../explore-verbs";

const ref = { kind: "place_nodes", id: "town/it's a hall", bundle: "town" };
const requests: ExploreRequest[] = [
	{ operation: "search", source: "local", text: "inn keeper", kind: "place_nodes" },
	{
		operation: "search",
		source: "local",
		source_id: "abc",
		collection: "definitions",
		tags: ["a", "b"],
		fields: ["pos_x", "description"],
		within: { kind: "place_graphs", id: "town/g", bundle: "town" },
		bundle: "town",
		limit: 5,
		cursor: "Zm9v==",
	},
	{ operation: "detail", source: "workspace", source_id: "abc", ref, fields: ["pos_x"] },
	{ operation: "neighbors", source: "live", source_id: "abc", ref, limit: 3 },
	{ operation: "references", source: "local", source_id: "abc", ref, direction: "inbound" },
	{
		operation: "field",
		source: "local",
		source_id: "abc",
		ref,
		field: "description",
		offset: 512,
	},
];

/** Split a printed command the way a POSIX shell would, for the quoting subset we emit. */
function words(line: string): string[] {
	return [...line.matchAll(/'((?:[^']|'\\'')*)'|(\S+)/g)].map((m) =>
		(m[1] ?? m[2] ?? "").replaceAll("'\\''", "'"),
	);
}

describe("sk explore verbs", () => {
	it("round-trips every request through its printed command", () => {
		for (const request of requests) {
			const line = renderExploreCommand(request, ["--target", "my dir"]);
			const tokens = words(line);
			expect(tokens.slice(0, 4)).toEqual(["sk", "--target", "my dir", "explore"]);
			const verb = exploreVerb(tokens[4]);
			expect(parseExploreArgs(verb, tokens.slice(5))).toEqual(request);
		}
	});

	it("covers every operation the contract names", () => {
		expect(EXPLORE_VERBS.map((v) => v.name).sort()).toEqual([
			"detail",
			"field",
			"neighbors",
			"references",
			"search",
			"summary",
		]);
	});

	it("rejects a half container, a missing reference part and an unknown verb", () => {
		const search = exploreVerb("search");
		expect(() => parseExploreArgs(search, ["--within-kind", "place_graphs"])).toThrow(UsageError);
		expect(() => parseExploreArgs(exploreVerb("detail"), ["place_nodes"])).toThrow(/missing <key>/);
		expect(() => exploreVerb("find")).toThrow(/expected one of/);
	});

	it("prints next and recovery as commands and leaves the rest of the answer alone", () => {
		const body = projectExploreBody(
			{
				ok: true,
				items: [],
				next: [{ operation: "detail", source: "local", source_id: "s", ref }],
				recovery: [
					{ tool: "spellkave_query", params: { explore: { operation: "search", source: "live" } } },
					{ tool: "other", params: {} },
				],
			},
			["--profile", "p"],
		);
		expect(body.items).toEqual([]);
		expect(body.recovery).toEqual(["sk --profile p explore search --source live"]);
		expect(body.next).toEqual([
			"sk --profile p explore detail place_nodes 'town/it'\\''s a hall' --bundle town --source local --source-id s",
		]);
	});
});

describe("a live answer names the world it read", () => {
	const record = { kind: "explore_result", ok: true, operation: "search", items: [] };
	const target = { url: "https://api.example", db: "prod-world", source: "flag", profile: "prod" };
	it.each([
		"jsonl",
		"human",
		"toon",
	] as const)("%s leads with the profile, URL and database", (format) => {
		const projected = projectExploreRecord(record, [], format, "live", undefined, target);
		expect(Object.keys(projected)[0]).toBe("target");
		expect(projected.target).toEqual(target);
	});
	it("a file answer has no target", () => {
		expect(projectExploreRecord(record, [], "jsonl", "local")).not.toHaveProperty("target");
	});
});
