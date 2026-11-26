// Every `sk` command takes its flags from the tool's schema, not from a
// hand-written list. These tests check that translation: which parameter
// becomes which kind of flag, how values, `--no-x`, repeated and JSON flags
// parse, and that an unknown flag or a flag without a value is refused
// rather than dropped. A wrong parse would send the world a different
// request than the author typed. Pure parsing; no node.
import { authorFacingToolDefinitions } from "@spellkave/tool-authoring";
import { DIFF_MANIFEST_TOOL, EXPORT_MANIFEST_TOOL } from "@spellkave/tool-contracts";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import { deriveFlags, parseToolArgs, UsageError } from "../args.ts";

const SCHEMA = Type.Object({
	id: Type.String({ description: "natural key" }),
	count: Type.Optional(Type.Number()),
	self_only: Type.Optional(Type.Boolean()),
	tags: Type.Optional(Type.Array(Type.String())),
	rows: Type.Optional(Type.Array(Type.Object({ a: Type.String() }))),
	mode: Type.Optional(Type.Union([Type.Literal("fast"), Type.Literal("slow")])),
});

describe("deriveFlags", () => {
	it("classifies each parameter by what a shell can express", () => {
		expect(deriveFlags(SCHEMA)).toEqual([
			{ name: "id", flag: "--id", kind: "string", required: true, description: "natural key" },
			{ name: "count", flag: "--count", kind: "number", required: false },
			{ name: "self_only", flag: "--self-only", kind: "boolean", required: false },
			{ name: "tags", flag: "--tags", kind: "string-list", required: false },
			// An array of OBJECTS has structure a flag cannot carry — JSON only.
			{ name: "rows", flag: "--rows", kind: "json", required: false },
			// A union of string literals is still one token; help lists its values.
			{ name: "mode", flag: "--mode", kind: "string", required: false, choices: ["fast", "slow"] },
		]);
	});
});

describe("parseToolArgs", () => {
	const flags = deriveFlags(SCHEMA);
	const parse = (argv: string[]) => parseToolArgs(flags, argv);

	it("accepts --flag value and --flag=value alike", () => {
		expect(parse(["--id", "a"])).toEqual({ id: "a" });
		expect(parse(["--id=a"])).toEqual({ id: "a" });
	});

	it("coerces numbers and rejects non-numeric input", () => {
		expect(parse(["--count", "3"])).toEqual({ count: 3 });
		expect(() => parse(["--count", "many"])).toThrow(UsageError);
	});

	it("treats a bare boolean flag as true and --no- as false", () => {
		expect(parse(["--self-only"])).toEqual({ self_only: true });
		expect(parse(["--no-self-only"])).toEqual({ self_only: false });
		expect(parse(["--self-only", "false"])).toEqual({ self_only: false });
	});

	it("prefers a parameter literally named no-<x> over negating <x>", () => {
		const heroFlags = deriveFlags(
			Type.Object({
				hero: Type.Optional(Type.String()),
				"no-hero": Type.Optional(Type.Boolean()),
			}),
		);
		expect(parseToolArgs(heroFlags, ["--no-hero"])).toEqual({ "no-hero": true });
		expect(parseToolArgs(heroFlags, ["--hero", "k"])).toEqual({ hero: "k" });
		// Without such a parameter, --no-<x> still negates a boolean <x>.
		expect(parse(["--no-self-only"])).toEqual({ self_only: false });
	});

	it("does not swallow the next flag as a boolean's value", () => {
		expect(parse(["--self-only", "--id", "a"])).toEqual({ self_only: true, id: "a" });
	});

	it("repeats a string-list flag", () => {
		expect(parse(["--tags", "a", "--tags", "b"])).toEqual({ tags: ["a", "b"] });
	});

	it("accepts and flattens JSON string arrays alongside repeated plain values", () => {
		expect(parse(["--tags", '["a","b"]', "--tags=c", "--tags=[]"])).toEqual({
			tags: ["a", "b", "c"],
		});
		expect(parse(["--tags", "[]"])).toEqual({ tags: [] });
		expect(parse(["--tags", '["srd"]'])).toEqual(parse(["--tags", "srd"]));
	});

	it.each(['["a",1]', "[null]", '["a"'])("refuses malformed string arrays: %s", (value) => {
		expect(() => parse(["--tags", value])).toThrow(
			/--tags: expected a JSON string array or a plain value/,
		);
	});

	it("parses structured parameters as JSON", () => {
		expect(parse(["--rows", '[{"a":"x"}]'])).toEqual({ rows: [{ a: "x" }] });
		expect(() => parse(["--rows", "not json"])).toThrow(UsageError);
	});

	it("merges --json as a base that per-flag values override", () => {
		expect(parse(["--json", '{"id":"a","count":1}', "--count", "2"])).toEqual({
			id: "a",
			count: 2,
		});
	});

	it("rejects unknown flags and positionals rather than ignoring them", () => {
		expect(() => parse(["--nope", "x"])).toThrow(UsageError);
		expect(() => parse(["bare"])).toThrow(UsageError);
	});

	it("parses sk diff positionals and flags from the registry schema", () => {
		const def = authorFacingToolDefinitions.find((tool) => tool.name === DIFF_MANIFEST_TOOL);
		if (def === undefined) throw new Error("missing spellkave_diff");
		const flags = deriveFlags(def.parameters);
		expect(
			parseToolArgs(
				flags,
				[
					"left.toml",
					"right.toml",
					"--ignore-fields",
					"a,b",
					"--kinds",
					"entities,object_state",
					"--only",
					"gaps",
					"--map-key",
					"kavemouth/adventure/candidate_1=kavemouth/adventure/hero_1",
					"--map-key",
					"a=b",
				],
				def.cli?.positionals ?? [],
			),
		).toEqual({
			left: "left.toml",
			right: "right.toml",
			ignore_fields: "a,b",
			kinds: "entities,object_state",
			only: "gaps",
			map_key: ["kavemouth/adventure/candidate_1=kavemouth/adventure/hero_1", "a=b"],
		});
	});

	it("parses sk export positionals and flags from the registry schema", () => {
		const def = authorFacingToolDefinitions.find((tool) => tool.name === EXPORT_MANIFEST_TOOL);
		if (def === undefined) throw new Error("missing spellkave_export");
		const flags = deriveFlags(def.parameters);
		expect(
			parseToolArgs(
				flags,
				["kavemouth", "--actor", "kavemouth/adventure/hero_1", "--out", "hero.toml"],
				def.cli?.positionals ?? [],
			),
		).toEqual({
			bundle: "kavemouth",
			actor: "kavemouth/adventure/hero_1",
			out: "hero.toml",
		});
	});

	it("accepts positionals only when the registry declares their parameter order", () => {
		expect(parseToolArgs(flags, ["guide", "--count", "2"], ["id"])).toEqual({
			id: "guide",
			count: 2,
		});
		expect(() => parseToolArgs(flags, ["guide", "extra"], ["id"])).toThrow(UsageError);
	});

	it("rejects a flag with no value", () => {
		expect(() => parse(["--id"])).toThrow(UsageError);
	});
});
