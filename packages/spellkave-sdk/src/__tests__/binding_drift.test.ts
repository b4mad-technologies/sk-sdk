// Unit tests for runtime schema surface fetch.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	BindingDriftError,
	fetchServerSurface,
	parseServerSurface,
	SchemaInventoryError,
} from "../core/binding_drift";

const STUB_SCHEMA = {
	sections: [
		{ CaseConversionPolicy: { None: [] } },
		{ Typespace: { types: [] } },
		{
			Tables: [
				{ source_name: "world_time" },
				{ source_name: "config" },
				{ source_name: "unrelated_table" },
			],
		},
		{
			Views: [
				{ source_name: "visible_evaluation_provenance", is_public: true },
				{ source_name: "private_debug_view", is_public: false },
			],
		},
		{
			Reducers: [
				{ source_name: "r_move" },
				{ source_name: "r_sense" },
				{ source_name: "other_reducer" },
			],
		},
	],
};

function stubFetch(schema: unknown, status = 200) {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		statusText: status === 200 ? "OK" : "Error",
		json: () => Promise.resolve(schema),
	});
}

describe("fetchServerSurface", () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		globalThis.fetch = stubFetch(STUB_SCHEMA) as unknown as typeof fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("returns sorted table and reducer names", async () => {
		await expect(fetchServerSurface("http://localhost:3000", "spellkave-dev")).resolves.toEqual({
			tables: ["config", "unrelated_table", "visible_evaluation_provenance", "world_time"],
			reducers: ["other_reducer", "r_move", "r_sense"],
		});
	});

	it("rejects duplicate table names", async () => {
		globalThis.fetch = stubFetch({
			sections: [
				{ CaseConversionPolicy: { None: [] } },
				{ Typespace: {} },
				{ Tables: [{ source_name: "config" }, { source_name: "config" }] },
				{ Views: [] },
				{ Reducers: [{ source_name: "r_move" }] },
			],
		}) as unknown as typeof fetch;
		await expect(
			fetchServerSurface("http://localhost:3000", "spellkave-dev"),
		).rejects.toBeInstanceOf(SchemaInventoryError);
	});

	it("rejects a view missing is_public", async () => {
		globalThis.fetch = stubFetch({
			sections: [
				{ CaseConversionPolicy: { None: [] } },
				{ Typespace: {} },
				{ Tables: [{ source_name: "config" }] },
				{ Views: [{ source_name: "notable_events" }] },
				{ Reducers: [{ source_name: "r_move" }] },
			],
		}) as unknown as typeof fetch;
		await expect(
			fetchServerSurface("http://localhost:3000", "spellkave-dev"),
		).rejects.toBeInstanceOf(SchemaInventoryError);
	});

	it("rejects a duplicate Tables section", async () => {
		globalThis.fetch = stubFetch({
			sections: [
				{ CaseConversionPolicy: { None: [] } },
				{ Typespace: {} },
				{ Tables: [{ source_name: "config" }] },
				{ Tables: [{ source_name: "world_time" }] },
				{ Views: [] },
				{ Reducers: [{ source_name: "r_move" }] },
			],
		}) as unknown as typeof fetch;
		await expect(
			fetchServerSurface("http://localhost:3000", "spellkave-dev"),
		).rejects.toBeInstanceOf(SchemaInventoryError);
	});

	it("rejects a malformed optional table entry among valid names", async () => {
		globalThis.fetch = stubFetch({
			sections: [
				{ CaseConversionPolicy: { None: [] } },
				{ Typespace: {} },
				{
					Tables: [{ source_name: "config" }, { source_name: "world_time" }, {}],
				},
				{ Views: [] },
				{ Reducers: [{ source_name: "r_move" }] },
			],
		}) as unknown as typeof fetch;
		await expect(
			fetchServerSurface("http://localhost:3000", "spellkave-dev"),
		).rejects.toBeInstanceOf(SchemaInventoryError);
	});

	it("throws on non-2xx HTTP response", async () => {
		globalThis.fetch = stubFetch({}, 503) as unknown as typeof fetch;
		await expect(fetchServerSurface("http://localhost:3000", "spellkave-dev")).rejects.toThrow(
			/Schema fetch failed: 503/,
		);
	});

	it("throws on network error", async () => {
		globalThis.fetch = vi
			.fn()
			.mockRejectedValue(new Error("fetch failed")) as unknown as typeof fetch;
		await expect(fetchServerSurface("http://localhost:3000", "spellkave-dev")).rejects.toThrow(
			"fetch failed",
		);
	});

	it("rejects a schema body missing sections", async () => {
		globalThis.fetch = stubFetch({}) as unknown as typeof fetch;
		await expect(
			fetchServerSurface("http://localhost:3000", "spellkave-dev"),
		).rejects.toBeInstanceOf(SchemaInventoryError);
	});

	it("rejects a schema body missing Tables", async () => {
		globalThis.fetch = stubFetch({
			sections: [{ Views: [] }, { Reducers: [] }],
		}) as unknown as typeof fetch;
		await expect(
			fetchServerSurface("http://localhost:3000", "spellkave-dev"),
		).rejects.toBeInstanceOf(SchemaInventoryError);
	});

	it("fetches from the correct URL", async () => {
		const mockFetch = stubFetch(STUB_SCHEMA);
		globalThis.fetch = mockFetch as unknown as typeof fetch;
		await fetchServerSurface("http://mynode:4000", "mydb");
		expect(mockFetch).toHaveBeenCalledWith("http://mynode:4000/v1/database/mydb/schema?version=10");
	});
});

describe("Procedures section", () => {
	const url = "http://example/schema";
	const required = [
		{ CaseConversionPolicy: { None: [] } },
		{ Typespace: {} },
		{ Tables: [{ source_name: "config" }] },
		{ Views: [] },
		{ Reducers: [{ source_name: "r_move" }] },
	];

	it("accepts a schema with a Procedures array", () => {
		expect(
			parseServerSurface(
				{
					sections: [...required, { Procedures: [{ source_name: "probe_manipulate" }] }],
				},
				url,
			),
		).toEqual({ tables: ["config"], reducers: ["r_move"] });
	});

	it("accepts a schema without a Procedures section", () => {
		expect(parseServerSurface({ sections: required }, url)).toEqual({
			tables: ["config"],
			reducers: ["r_move"],
		});
	});

	it("accepts the probe-by-rollback module schema", () => {
		const schemaPath = resolve(
			dirname(fileURLToPath(import.meta.url)),
			"./fixtures/probe-by-rollback-schema.json",
		);
		expect(parseServerSurface(JSON.parse(readFileSync(schemaPath, "utf8")), schemaPath)).toEqual({
			tables: ["thing"],
			reducers: ["ok_reducer", "probe_reducer"],
		});
	});

	it("still rejects a section the reader does not know", () => {
		expect(() => parseServerSurface({ sections: [...required, { NotASection: [] }] }, url)).toThrow(
			SchemaInventoryError,
		);
	});
});

describe("BindingDriftError", () => {
	it("carries name-set surfaces and mismatch kind", () => {
		const err = new BindingDriftError(
			{ tables: ["config"], reducers: ["r_move"] },
			{ tables: [], reducers: ["r_move"] },
			"table",
		);

		expect(err).toMatchObject({
			name: "BindingDriftError",
			expected: { tables: ["config"], reducers: ["r_move"] },
			actual: { tables: [], reducers: ["r_move"] },
			mismatchKind: "table",
			scope: "consumed",
		});
	});
});
