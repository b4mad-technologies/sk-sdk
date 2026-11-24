import { createRequire } from "node:module";
// keep-file(K1): the one normaliser against the real encodings, and one case per connect-time rule and direction
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import {
	classifyRuntimeChange,
	foldCollisions,
	foldNames,
	normaliseItems,
	normaliseModuleDef,
	restrictSnapshot,
	type SchemaSnapshot,
	type SchemaTable,
	servedSchemaFromSnapshot,
	typeNames,
} from "../core/world-contract/index.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compareServedShape, fetchServerSchema, parseServerSurface } from "../core/binding_drift";
import { KERNEL_CONTRACT, KERNEL_CONTRACT_EPOCH } from "../core/kernel_contract.generated";

const fixture = (name: string) =>
	JSON.parse(
		gunzipSync(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).toString("utf8"),
	);
const withoutComment = (s: SchemaSnapshot & { $comment?: string }) => {
	const { $comment: _c, ...rest } = s;
	return rest as SchemaSnapshot;
};
const WORLD = withoutComment(
	JSON.parse(
		readFileSync(
			createRequire(import.meta.url).resolve("@spellkave/bindings/world.schema.json"),
			"utf8",
		),
	),
);
const AT_CAPTURE = withoutComment(fixture("world-snapshot-at-capture.json.gz"));

describe("normaliseModuleDef", () => {
	it.each([
		"2.10.0",
		"2.10.1",
	])("reads the real served world schema of SpacetimeDB %s to the wasm's snapshot (names folded)", (v) => {
		const served = normaliseModuleDef(fixture(`served-world-schema-${v}.json.gz`));
		const keep = foldCollisions(served, AT_CAPTURE);
		expect(foldNames(served, keep)).toEqual(foldNames(AT_CAPTURE, keep));
	});

	it("reads the served SpacetimeDB 2.14.1 world schema against the epoch-2 capture", () => {
		const captured = withoutComment(fixture("world-snapshot-at-2.14.1-capture.json.gz"));
		const raw = fixture("served-world-schema-2.14.1.json.gz");
		expect(parseServerSurface(raw, "SpacetimeDB 2.14.1 capture").tables).toContain("config");
		const served = normaliseModuleDef(raw);
		const keep = foldCollisions(served, captured);
		expect(foldNames(served, keep)).toEqual(foldNames(captured, keep));
	});

	it("rejects unsupported case conversion metadata", () => {
		for (const policy of [
			{ SnakeCase: [] },
			{ None: [1] },
			{ None: {} },
			{ None: [], SnakeCase: [] },
			[],
		]) {
			const raw = fixture("served-world-schema-2.14.1.json.gz");
			const section = raw.sections.find(
				(entry: Record<string, unknown>) => "CaseConversionPolicy" in entry,
			);
			expect(section).toBeDefined();
			section.CaseConversionPolicy = policy;
			expect(() => parseServerSurface(raw, "SpacetimeDB 2.14.1 capture")).toThrow(
				"unsupported CaseConversionPolicy",
			);
		}
	});

	it("requires case conversion metadata", () => {
		const raw = fixture("served-world-schema-2.14.1.json.gz");
		raw.sections = raw.sections.filter(
			(section: Record<string, unknown>) => !("CaseConversionPolicy" in section),
		);
		expect(() => parseServerSurface(raw, "SpacetimeDB 2.14.1 capture")).toThrow(
			"missing CaseConversionPolicy",
		);
	});

	it("keeps the node's spelling: only the folded forms match", () => {
		const served = normaliseModuleDef(fixture("served-world-schema-2.10.1.json.gz"));
		expect(served.tables.location_definition?.columns).toContain("cell_res_10: U64");
		expect(AT_CAPTURE.tables.location_definition?.columns).toContain("cell_res10: U64");
	});

	it("renders default values the same from served hex and decoded bytes", () => {
		const served = normaliseModuleDef(fixture("served-world-schema-2.10.1.json.gz"));
		expect(served.tables.actor_identity?.columns.at(-1)).toBe(
			AT_CAPTURE.tables.actor_identity?.columns.at(-1),
		);
		expect(AT_CAPTURE.tables.actor_identity?.columns.at(-1)).toMatch(/ = 0x01$/);
	});

	it("round-trips the current world snapshot through the served encoding", () => {
		expect(normaliseModuleDef(servedSchemaFromSnapshot(WORLD))).toEqual(WORLD);
	});

	it("renders a recursive named type by name and an unnamed type inline", () => {
		const def = {
			sections: [
				{
					Typespace: {
						types: [
							{
								Product: {
									elements: [{ name: { some: "kids" }, algebraic_type: { Array: { Ref: 0 } } }],
								},
							},
							{ Product: { elements: [{ name: { some: "x" }, algebraic_type: { U8: [] } }] } },
							{
								Product: {
									elements: [
										{ name: { some: "tree" }, algebraic_type: { Ref: 0 } },
										{ name: { some: "point" }, algebraic_type: { Ref: 1 } },
									],
								},
							},
						],
					},
				},
				{ Types: [{ source_name: { scope: [], source_name: "Tree" }, ty: 0 }] },
				{
					Tables: [
						{
							source_name: "t",
							product_type_ref: 2,
							primary_key: [],
							indexes: [],
							constraints: [],
							sequences: [],
							table_type: { User: [] },
							table_access: { Public: [] },
							default_values: [],
							is_event: false,
						},
					],
				},
			],
		};
		const s = normaliseModuleDef(def);
		expect(s.tables.t?.columns).toEqual(["tree: Tree", "point: {x: U8}"]);
		expect(s.types).toEqual({ Tree: { product: ["kids: Array<Tree>"] } });
	});
});

describe("normaliseItems", () => {
	const served = () => structuredClone(fixture("served-world-schema-2.10.1.json.gz"));

	it("reads only the named items, so an unreadable item nobody consumes fails nothing", () => {
		const def = served();
		const tables = def.sections.find((s: Record<string, unknown>) => "Tables" in s).Tables;
		const other = tables.find((t: { source_name: string }) => t.source_name === "mod_bundle");
		other.table_access = { SomeFutureAccess: [], Extra: [] };
		const { snapshot, unchecked } = normaliseItems(def, {
			tables: ["actor"],
			reducers: ["r_move"],
		});
		expect(unchecked).toEqual([]);
		expect(Object.keys(snapshot.tables)).toEqual(["actor"]);
		expect(Object.keys(snapshot.reducers)).toEqual(["r_move"]);
	});

	it("reports an unreadable consumed item as unchecked instead of throwing", () => {
		const def = served();
		const tables = def.sections.find((s: Record<string, unknown>) => "Tables" in s).Tables;
		tables.find((t: { source_name: string }) => t.source_name === "actor").product_type_ref =
			999999;
		const { unchecked } = normaliseItems(def, { tables: ["actor", "seat"], reducers: [] });
		expect(unchecked.map((u) => u.item)).toEqual(["table actor"]);
	});
});

describe("typeNames", () => {
	it("follows the structure: a field or variant named like a type is no reference", () => {
		expect(typeNames("{Seat: U64, kind: (Seat | Actor(ActorRef))}")).toEqual(["U64", "ActorRef"]);
		expect(typeNames("Option<Array<Seat>>")).toEqual(["Seat"]);
	});
});

describe("restrictSnapshot", () => {
	it("pulls in the types a used item reaches, not a type a member is merely named after", () => {
		const s: Snap = {
			tables: { t: { ...T, columns: ["Seat: U64", "mode: Mode"] } },
			views: {},
			reducers: {},
			procedures: {},
			lifecycle: {},
			types: {
				Mode: { sum: ["A: ()", "Inner: Deep"] },
				Deep: { product: ["x: U8"] },
				Seat: { product: [] },
			},
		};
		expect(Object.keys(restrictSnapshot(s, { tables: ["t"], reducers: [] }).types)).toEqual([
			"Deep",
			"Mode",
		]);
	});
});

describe("KERNEL_CONTRACT", () => {
	it("is the world snapshot restricted to what the SDK uses, at the current epoch", () => {
		const epochs = JSON.parse(
			readFileSync(
				createRequire(import.meta.url).resolve("@spellkave/bindings/epoch.json"),
				"utf8",
			),
		);
		expect(KERNEL_CONTRACT_EPOCH).toBe(epochs.world);
		for (const [name, table] of Object.entries(KERNEL_CONTRACT.tables))
			expect(WORLD.tables[name]).toEqual(table);
		for (const [name, reducer] of Object.entries(KERNEL_CONTRACT.reducers))
			expect(WORLD.reducers[name]).toEqual(reducer);
	});
});

// The connect-time rules (`@spellkave/bindings/contract` runtime.ts), one case
// per rule and direction. Each case edits the SERVER (server newer) or the
// CLIENT (client newer: images applied before the world is re-loaded).
type Snap = SchemaSnapshot;
const T: SchemaTable = {
	access: "public",
	kind: "user",
	event: false,
	columns: ["id: U64", "name: String", "mode: Mode"],
	primaryKey: ["id"],
	unique: ["id"],
	indexes: { t_id_idx_btree: "id: btree(id)" },
	autoInc: [],
};
const BASE: Snap = {
	tables: { t: T },
	views: {
		v: { public: true, anonymous: false, params: [], returns: "Array", columns: ["id: U64"] },
	},
	reducers: {
		r: { visibility: "client", params: ["id: U64", "mode: Mode"], ok: "()", err: "String" },
	},
	procedures: {},
	lifecycle: {},
	types: { Mode: { sum: ["A: ()", "B: ()"] }, Point: { product: ["x: U8"] } },
};
const t =
	(patch: Partial<SchemaTable>) =>
	(s: Snap): Snap => ({ ...s, tables: { t: { ...T, ...patch } } });
const v =
	(patch: Partial<Snap["views"][string]>) =>
	(s: Snap): Snap => ({ ...s, views: { v: { ...BASE.views.v!, ...patch } } });
const r =
	(patch: Partial<Snap["reducers"][string]>) =>
	(s: Snap): Snap => ({ ...s, reducers: { r: { ...BASE.reducers.r!, ...patch } } });
const mode =
	(variants: string[]) =>
	(s: Snap): Snap => ({ ...s, types: { Mode: { sum: variants } } });

// [rule, side edited, edit, verdict]
const RULES: [
	string,
	"server" | "client",
	(s: Snap) => Snap,
	"none" | "breaking" | "diagnostic",
][] = [
	["identical", "server", (s) => s, "none"],
	[
		"column appended with a default",
		"server",
		t({ columns: [...T.columns, "x: U8 = 0x00"] }),
		"breaking",
	],
	[
		"column appended without a default",
		"server",
		t({ columns: [...T.columns, "x: U8"] }),
		"breaking",
	],
	["column only on the client", "client", t({ columns: [...T.columns, "x: U8"] }), "breaking"],
	[
		"column type changed",
		"server",
		t({ columns: ["id: U64", "name: U32", "mode: Mode"] }),
		"breaking",
	],
	[
		"columns reordered",
		"server",
		t({ columns: ["name: String", "id: U64", "mode: Mode"] }),
		"breaking",
	],
	["column removed", "server", t({ columns: ["id: U64", "name: String"] }), "breaking"],
	[
		"column renamed",
		"server",
		t({ columns: ["id: U64", "label: String", "mode: Mode"] }),
		"breaking",
	],
	[
		"column re-cased only",
		"server",
		t({ columns: ["id: U64", "Name: String", "mode: Mode"] }),
		"none",
	],
	[
		"default value changed",
		"server",
		t({ columns: ["id: U64", "name: String = 0x00000000", "mode: Mode"] }),
		"diagnostic",
	],
	["table made private", "server", t({ access: "private" }), "breaking"],
	["table made public", "client", t({ access: "private" }), "diagnostic"],
	["index removed", "server", t({ indexes: {} }), "diagnostic"],
	[
		"index only on the client",
		"client",
		t({ indexes: { ...T.indexes, t_name_idx_btree: "name: btree(name)" } }),
		"diagnostic",
	],
	[
		"index accessor changed",
		"server",
		t({ indexes: { t_id_idx_btree: "by_id: btree(id)" } }),
		"diagnostic",
	],
	["unique added", "server", t({ unique: ["id", "name"] }), "diagnostic"],
	["primary key removed", "server", t({ primaryKey: [] }), "diagnostic"],
	["auto-inc added", "server", t({ autoInc: ["id"] }), "diagnostic"],
	["schedule added", "server", t({ schedule: "tick(id)" }), "diagnostic"],
	["event flag changed", "server", t({ event: true }), "diagnostic"],
	["table removed", "server", (s) => ({ ...s, tables: {} }), "breaking"],
	["view made private", "server", v({ public: false }), "breaking"],
	["view anonymous flag changed", "server", v({ anonymous: true }), "diagnostic"],
	["view parameters changed", "server", v({ params: ["x: U8"] }), "breaking"],
	["view return shape changed", "server", v({ returns: "Option" }), "breaking"],
	["view column appended", "server", v({ columns: ["id: U64", "x: U8"] }), "breaking"],
	["view removed", "server", (s) => ({ ...s, views: {} }), "breaking"],
	["reducer arguments changed", "server", r({ params: ["id: U32", "mode: Mode"] }), "breaking"],
	["reducer arguments reordered", "server", r({ params: ["mode: Mode", "id: U64"] }), "breaking"],
	[
		"reducer argument only on the client",
		"client",
		r({ params: ["id: U64", "mode: Mode", "x: U8"] }),
		"breaking",
	],
	["reducer return type changed", "server", r({ ok: "U64" }), "breaking"],
	["reducer turned internal", "server", r({ visibility: "internal" }), "breaking"],
	["reducer removed", "server", (s) => ({ ...s, reducers: {} }), "breaking"],
	["enum variant added on the server", "server", mode(["A: ()", "B: ()", "C: ()"]), "breaking"],
	["enum variant only on the client", "client", mode(["A: ()", "B: ()", "C: ()"]), "diagnostic"],
	["enum variant renamed", "server", mode(["A: ()", "Z: ()"]), "breaking"],
	["enum variant re-cased only", "server", mode(["a: ()", "b: ()"]), "none"],
	[
		"struct field added to a named type",
		"server",
		(s) => ({ ...s, types: { ...s.types, Point: { product: ["x: U8", "y: U8"] } } }),
		"breaking",
	],
	[
		"struct field type changed in a named type",
		"server",
		(s) => ({ ...s, types: { ...s.types, Point: { product: ["x: U16"] } } }),
		"breaking",
	],
	[
		"table became a view",
		"server",
		(s) => ({
			...s,
			tables: {},
			views: {
				...s.views,
				t: { public: true, anonymous: false, params: [], returns: "Array", columns: T.columns },
			},
		}),
		"breaking",
	],
	[
		"view became a table",
		"server",
		(s) => ({ ...s, views: {}, tables: { ...s.tables, v: { ...T, columns: ["id: U64"] } } }),
		"breaking",
	],
];

describe("classifyRuntimeChange", () => {
	it.each(RULES)("%s (%s side) -> %s", (_rule, side, edit, verdict) => {
		const client = side === "client" ? edit(BASE) : BASE;
		const server = side === "server" ? edit(BASE) : BASE;
		const changes = classifyRuntimeChange(foldNames(client), foldNames(server));
		const got = changes.some((c) => c.verdict === "breaking")
			? "breaking"
			: changes.length > 0
				? "diagnostic"
				: "none";
		expect(got).toBe(verdict);
	});
});

describe("compareServedShape", () => {
	const served = (edit: (s: Snap) => Snap = (s) => s) =>
		servedSchemaFromSnapshot(edit(structuredClone(WORLD) as Snap));
	const actor = (s: Snap) => s.tables.actor as SchemaTable;

	it("passes the module the client was built for, and ignores unconsumed items", () => {
		const result = compareServedShape(
			served((s) => ({
				...s,
				tables: {
					...s.tables,
					mod_bundle: { ...(s.tables.mod_bundle as SchemaTable), columns: ["x: U8"] },
				},
			})),
			KERNEL_CONTRACT,
		);
		expect(result).toEqual({ breaking: [], diagnostics: [], unchecked: [] });
	});

	it("refuses an appended defaulted column on a consumed table and names it in the module's spelling", () => {
		const result = compareServedShape(
			served((s) => ({
				...s,
				tables: {
					...s.tables,
					actor: { ...actor(s), columns: [...actor(s).columns, "mood_now: U8 = 0x00"] },
				},
			})),
			KERNEL_CONTRACT,
		);
		expect(result.breaking.map((c) => `${c.item}: ${c.detail}`)).toEqual([
			"table actor: column mood_now: U8 exists only on the server (rows are decoded positionally)",
		]);
	});

	it("keeps two names apart that fold to the same spelling", () => {
		const contract: Snap = {
			...BASE,
			tables: { foo_bar: T, foobar: { ...T, columns: ["id: U64"] } },
			views: {},
			reducers: {},
		};
		const swapped = servedSchemaFromSnapshot({
			...contract,
			tables: { foo_bar: contract.tables.foobar!, foobar: T },
		});
		const result = compareServedShape(swapped, contract);
		expect(result.breaking.length).toBeGreaterThan(0);
		expect(compareServedShape(servedSchemaFromSnapshot(contract), contract).breaking).toEqual([]);
	});

	it.each([
		[
			"a Schedules function_name re-encoded",
			(def: { sections: Record<string, unknown[]>[] }) => {
				const schedules = def.sections.find((s) => "Schedules" in s)?.Schedules as {
					function_name: unknown;
				}[];
				(schedules[0] as { function_name: unknown }).function_name = { NotAString: [] };
			},
			true,
		],
		[
			"one odd Procedures entry",
			(def: { sections: Record<string, unknown[]>[] }) => {
				const procedures = def.sections.find((s) => "Procedures" in s)?.Procedures as unknown[];
				procedures.push({ source_name: 7, odd: true });
			},
			false,
		],
		[
			"a Types ty re-encoded",
			(def: { sections: Record<string, unknown[]>[] }) => {
				const types = def.sections.find((s) => "Types" in s)?.Types as { ty: unknown }[];
				(types[0] as { ty: unknown }).ty = "12";
			},
			true,
		],
	])("refuses nothing when the real 2.10.0 schema has %s", (_what, mutate, reported) => {
		const def = fixture("served-world-schema-2.10.0.json.gz") as {
			sections: Record<string, unknown[]>[];
		};
		mutate(def);
		// Judge the frozen capture against the snapshot of its own commit, not
		// today's contract: the pair does not follow later schema changes
		// (fixtures/README.md), only the served encoding is under test here.
		const result = compareServedShape(def, AT_CAPTURE);
		expect(result.breaking).toEqual([]);
		expect(result.unchecked.length > 0).toBe(reported);
	});

	it("leaves an unreadable consumed item unchecked rather than refusing", () => {
		const def = served() as { sections: Record<string, unknown[]>[] };
		const tables = def.sections.find((s) => "Tables" in s)?.Tables as {
			source_name: string;
			product_type_ref: number;
		}[];
		const target = tables.find((x) => x.source_name === "actor");
		if (target) target.product_type_ref = 999999;
		const result = compareServedShape(def, KERNEL_CONTRACT);
		expect(result.breaking).toEqual([]);
		expect(result.unchecked.map((u) => u.item)).toEqual(["table actor"]);
	});
});

describe("fetchServerSchema", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("rejects a non-200 answer with the pre-existing message", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: "Service Unavailable" }),
		);
		await expect(fetchServerSchema("http://x", "db")).rejects.toThrow(
			"Schema fetch failed: 503 Service Unavailable",
		);
	});

	it("rejects a body that is not JSON with the JSON parser's own error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				statusText: "OK",
				json: () => Promise.reject(new SyntaxError("Unexpected token <")),
			}),
		);
		await expect(fetchServerSchema("http://x", "db")).rejects.toThrow(SyntaxError);
	});
});
