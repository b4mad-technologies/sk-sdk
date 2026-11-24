// connect() drift gate behavior tests (tasks.md 3.8; shape check sk-jay0.7.389.3).
//
// Scenarios:
//   missing strict table    -> connect() throws BindingDriftError before .build()
//   all strict names match  -> connect() proceeds to .build()
//   additive server surface -> connect() proceeds and emits binding_drift_additive
//   breaking served shape   -> connect() throws BindingShapeError before .build()
//   appended served column  -> connect() throws BindingShapeError (rows decode positionally)
//   shapeCheck "warn" mode  -> connect() proceeds and emits contract_shape_mismatch
//   index-only difference   -> connect() proceeds and emits binding_shape_diagnostic

import { afterEach, describe, expect, it, vi } from "vitest";

let buildCalled = false;
let tokenPassed: string | undefined;
let subscribedQueries: readonly string[] | undefined;
const subscriptionQueries: (readonly string[])[] = [];
let unsubscribeCalls = 0;
let rejectSatelliteSubscribe = false;

vi.mock("@spellkave/bindings", () => {
	let onConnect: ((conn: unknown, identity: string, token: string) => void) | undefined;
	let onApplied: (() => void) | undefined;
	let onSubError: ((ctx: unknown, err?: unknown) => void) | undefined;
	const subscriptionBuilder = {
		onApplied: (callback: () => void) => {
			onApplied = callback;
			return subscriptionBuilder;
		},
		onError: (callback: (ctx: unknown, err?: unknown) => void) => {
			onSubError = callback;
			return subscriptionBuilder;
		},
		subscribe: (queries: readonly string[]) => {
			subscribedQueries = queries;
			subscriptionQueries.push(queries);
			const wantsSatellite = queries.some((q) => q.includes("condition_definition_description"));
			if (wantsSatellite && rejectSatelliteSubscribe) {
				onSubError?.(
					undefined,
					new Error("subscription: no such table condition_definition_description"),
				);
				return subscriptionBuilder;
			}
			onApplied?.();
			return subscriptionBuilder;
		},
		unsubscribe: () => {
			unsubscribeCalls += 1;
		},
	};
	const conn = {
		db: {},
		subscriptionBuilder: () => subscriptionBuilder,
		disconnect: () => {},
	};
	const builder = {
		withUri: () => builder,
		withCompression: () => builder,
		withDatabaseName: () => builder,
		withToken: (token: string) => {
			tokenPassed = token;
			return builder;
		},
		onConnect: (callback: (conn: unknown, identity: string, token: string) => void) => {
			onConnect = callback;
			return builder;
		},
		onConnectError: () => builder,
		onDisconnect: () => builder,
		build: () => {
			buildCalled = true;
			onConnect?.(conn, "identity", "issued-token");
			return conn;
		},
	};

	return {
		DbConnection: { builder: () => builder },
		STRICT_REDUCERS: [
			"r_manipulate",
			"r_move",
			"r_sense",
			"r_session_close",
			"r_session_move",
			"r_session_open",
		],
	};
});

import type { SchemaSnapshot } from "../core/world-contract/index.ts";
import { connect, ShapeCheckConfigError, STRICT_TABLES } from "../connection";
import { BindingDriftError, BindingShapeError, SchemaInventoryError } from "../core/binding_drift";
import { KERNEL_CONTRACT_EPOCH } from "../core/kernel_contract.generated";
import { resetReportedShapeMismatches } from "../core/shape_telemetry";
import { servedSchema } from "./served_schema_fixture";

const STRICT_REDUCERS = [
	"r_manipulate",
	"r_move",
	"r_sense",
	"r_session_close",
	"r_session_move",
	"r_session_open",
];

/** A served schema for these names; a non-string entry is appended to Tables as is. */
function schema(
	tables: readonly unknown[],
	reducers: readonly string[],
	views: readonly { source_name: string; is_public: boolean }[] = [],
	edit?: (snapshot: SchemaSnapshot) => SchemaSnapshot,
) {
	const names = tables.filter((t): t is string => typeof t === "string");
	const served = servedSchema(names, reducers, views, edit) as {
		sections: Record<string, unknown[]>[];
	};
	const raw = tables.filter((t) => typeof t !== "string");
	const section = served.sections.find((s) => "Tables" in s);
	section?.Tables?.push(...raw);
	return served;
}

function stubFetch(schemaFixture: unknown) {
	return vi.fn().mockResolvedValue({
		ok: true,
		status: 200,
		statusText: "OK",
		json: () => Promise.resolve(schemaFixture),
	});
}

const BASE_CALLBACKS = {
	onError: () => {},
	onDisconnect: () => {},
	onUpdate: () => {},
};

const BASE_ARGS = {
	url: "http://localhost:3000",
	db: "spellkave-dev",
	token: undefined,
	connectedActorId: "core_baseline/player",
};

const originalFetch = globalThis.fetch;

afterEach(() => {
	resetReportedShapeMismatches();
	delete process.env.SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT;
	buildCalled = false;
	tokenPassed = undefined;
	subscribedQueries = undefined;
	subscriptionQueries.length = 0;
	unsubscribeCalls = 0;
	rejectSatelliteSubscribe = false;
	delete process.env.SPELLKAVE_CONNECT_TOKEN;
	globalThis.fetch = originalFetch;
	vi.restoreAllMocks();
});

describe("connect() drift gate", () => {
	it("does not require removed communicate reducer in strict generated surface", () => {
		expect(STRICT_REDUCERS).not.toContain("r_communicate");
	});

	it("throws BindingDriftError and never calls .build() when a strict table is missing", async () => {
		const [missingTable, ...presentTables] = STRICT_TABLES;
		globalThis.fetch = stubFetch(schema(presentTables, STRICT_REDUCERS)) as unknown as typeof fetch;

		let caught: unknown;
		try {
			await connect(BASE_ARGS, BASE_CALLBACKS);
		} catch (err) {
			caught = err;
		}

		expect(buildCalled).toBe(false);
		expect(caught).toBeInstanceOf(BindingDriftError);
		expect(caught).toMatchObject({
			mismatchKind: "table",
			expected: { tables: expect.arrayContaining([missingTable]) },
			actual: { tables: expect.not.arrayContaining([missingTable]) },
			scope: "consumed",
		});
	});

	it("proceeds when all strict tables and reducers are present", async () => {
		globalThis.fetch = stubFetch(schema(STRICT_TABLES, STRICT_REDUCERS)) as unknown as typeof fetch;

		await connect(BASE_ARGS, BASE_CALLBACKS);

		expect(buildCalled).toBe(true);
		expect(tokenPassed).toBeUndefined();
	});

	it("uses SPELLKAVE_CONNECT_TOKEN as an explicit host default for token reuse", async () => {
		globalThis.fetch = stubFetch(schema(STRICT_TABLES, STRICT_REDUCERS)) as unknown as typeof fetch;
		process.env.SPELLKAVE_CONNECT_TOKEN = "seed-identity-token";

		await connect(BASE_ARGS, BASE_CALLBACKS);

		expect(buildCalled).toBe(true);
		expect(tokenPassed).toBe("seed-identity-token");
	});

	it("treats token: null as explicitly anonymous even when the host default is set", async () => {
		globalThis.fetch = stubFetch(schema(STRICT_TABLES, STRICT_REDUCERS)) as unknown as typeof fetch;
		process.env.SPELLKAVE_CONNECT_TOKEN = "seed-identity-token";

		await connect({ ...BASE_ARGS, token: null }, BASE_CALLBACKS);

		expect(buildCalled).toBe(true);
		expect(tokenPassed).toBeUndefined();
	});

	it("uses an explicit reader-manifest set instead of the full reader-scoped union", async () => {
		globalThis.fetch = stubFetch(schema(STRICT_TABLES, STRICT_REDUCERS)) as unknown as typeof fetch;

		await connect(
			{ ...BASE_ARGS, readerManifests: [{ requiredTables: ["actor"] }] },
			BASE_CALLBACKS,
		);

		// CONNECTION_BASELINE is always folded in; the reader-manifest union is
		// narrowed to exactly what was declared, never the full catalog.
		expect(subscribedQueries).toEqual([
			// ci-allow-start(raw-sql): asserts the OUTPUT shape of connect()'s own derivation - expected values, not subscription calls
			"SELECT * FROM config",
			"SELECT * FROM world_time",
			"SELECT * FROM directly_controlled_actor_spatial_location",
			"SELECT * FROM actor",
			// ci-allow-end(raw-sql)
		]);
	});

	it("overlaps a replacement reader set before retiring the prior subscription", async () => {
		globalThis.fetch = stubFetch(schema(STRICT_TABLES, STRICT_REDUCERS)) as unknown as typeof fetch;
		const session = await connect(BASE_ARGS, BASE_CALLBACKS);

		await session.replaceReaderManifests([{ requiredTables: ["actor"] }]);

		expect(subscriptionQueries).toHaveLength(2);
		// Assert table membership, not a whole-table SQL literal — the gate
		// `no-raw-sql-subscriptions` treats `"SELECT * FROM …"` as a hit.
		expect(subscriptionQueries[1]).toContainEqual(expect.stringMatching(/FROM actor$/));
		expect(unsubscribeCalls).toBe(1);
	});

	it("rejects a malformed optional satellite entry instead of silently skipping prose", async () => {
		globalThis.fetch = stubFetch(
			schema(
				[
					...STRICT_TABLES,
					{
						/* intended condition_definition_description */
					},
				],
				STRICT_REDUCERS,
			),
		) as unknown as typeof fetch;

		await expect(connect(BASE_ARGS, BASE_CALLBACKS)).rejects.toBeInstanceOf(SchemaInventoryError);
		expect(buildCalled).toBe(false);
	});

	it("rejects ready and onError when schema-present satellite subscribe races to missing table", async () => {
		rejectSatelliteSubscribe = true;
		const errors: Error[] = [];
		globalThis.fetch = stubFetch(
			schema([...STRICT_TABLES, "condition_definition_description"], STRICT_REDUCERS),
		) as unknown as typeof fetch;

		const session = await connect(BASE_ARGS, {
			...BASE_CALLBACKS,
			onError: (err) => errors.push(err),
		});

		expect(buildCalled).toBe(true);
		await expect(session.ready).rejects.toThrow(/no such table condition_definition_description/);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.message).toMatch(/no such table condition_definition_description/);
	});

	it("proceeds and reports binding_drift_additive for non-strict server surface", async () => {
		const diagnostics: object[] = [];
		globalThis.fetch = stubFetch(
			schema(
				[...STRICT_TABLES, "extra_advisory_table"],
				[...STRICT_REDUCERS, "extra_advisory_reducer"],
			),
		) as unknown as typeof fetch;

		await connect({ ...BASE_ARGS, onDiagnostic: (line) => diagnostics.push(line) }, BASE_CALLBACKS);

		expect(buildCalled).toBe(true);
		expect(diagnostics).toEqual([
			{
				kind: "binding_drift_additive",
				additions: {
					tables: ["extra_advisory_table"],
					reducers: ["extra_advisory_reducer"],
				},
			},
		]);
	});

	it("throws BindingShapeError and never calls .build() when a consumed row shape breaks", async () => {
		globalThis.fetch = stubFetch(
			schema(STRICT_TABLES, STRICT_REDUCERS, [], (s) => {
				const actor = s.tables.actor;
				if (!actor) throw new Error("fixture: actor is a strict table");
				const columns = [...actor.columns];
				columns[1] = "name: U32";
				return { ...s, tables: { ...s.tables, actor: { ...actor, columns } } };
			}),
		) as unknown as typeof fetch;

		let caught: unknown;
		try {
			await connect(BASE_ARGS, BASE_CALLBACKS);
		} catch (err) {
			caught = err;
		}

		expect(buildCalled).toBe(false);
		expect(caught).toBeInstanceOf(BindingShapeError);
		expect(caught).toBeInstanceOf(BindingDriftError);
		expect(caught).toMatchObject({ mismatchKind: "row-shape", clientEpoch: KERNEL_CONTRACT_EPOCH });
		expect((caught as Error).message).toContain(
			"table actor: column 2 changed: name: String -> name: U32",
		);
		expect((caught as Error).message).toContain(
			`built for contract epoch ${KERNEL_CONTRACT_EPOCH}`,
		);
	});

	it("throws BindingShapeError when a strict reducer's arguments change", async () => {
		globalThis.fetch = stubFetch(
			schema(STRICT_TABLES, STRICT_REDUCERS, [], (s) => {
				const move = s.reducers.r_move;
				if (!move) throw new Error("fixture: r_move is a strict reducer");
				return {
					...s,
					reducers: { ...s.reducers, r_move: { ...move, params: move.params.slice(1) } },
				};
			}),
		) as unknown as typeof fetch;

		await expect(connect(BASE_ARGS, BASE_CALLBACKS)).rejects.toThrow(/reducer r_move: arguments/);
		expect(buildCalled).toBe(false);
	});

	const appendedColumn = (s: SchemaSnapshot) => {
		const actor = s.tables.actor;
		if (!actor) throw new Error("fixture: actor is a strict table");
		return {
			...s,
			tables: {
				...s.tables,
				actor: { ...actor, columns: [...actor.columns, "mood: String = 0x00000000"] },
			},
		};
	};

	it("refuses an appended defaulted column: the SDK decodes rows positionally", async () => {
		globalThis.fetch = stubFetch(
			schema(STRICT_TABLES, STRICT_REDUCERS, [], appendedColumn),
		) as unknown as typeof fetch;
		await expect(connect(BASE_ARGS, BASE_CALLBACKS)).rejects.toThrow(
			/table actor: column mood: String exists only on the server/,
		);
		expect(buildCalled).toBe(false);
	});

	it.each([
		["the shapeCheck option", { shapeCheck: "warn" as const }, () => {}],
		[
			"SPELLKAVE_SHAPE_CHECK=warn",
			{},
			() => {
				process.env.SPELLKAVE_SHAPE_CHECK = "warn";
			},
		],
		[
			"globalThis.SPELLKAVE_SHAPE_CHECK (browser builds)",
			{},
			() => {
				(globalThis as { SPELLKAVE_SHAPE_CHECK?: string }).SPELLKAVE_SHAPE_CHECK = "warn";
			},
		],
	])("warn mode via %s connects and emits one contract_shape_mismatch per mismatch", async (_lever, extra, arm) => {
		arm();
		const diagnostics: object[] = [];
		globalThis.fetch = stubFetch(
			schema(STRICT_TABLES, STRICT_REDUCERS, [], appendedColumn),
		) as unknown as typeof fetch;
		try {
			await connect(
				{ ...BASE_ARGS, ...extra, onDiagnostic: (line) => diagnostics.push(line) },
				BASE_CALLBACKS,
			);
		} finally {
			delete process.env.SPELLKAVE_SHAPE_CHECK;
			delete (globalThis as { SPELLKAVE_SHAPE_CHECK?: string }).SPELLKAVE_SHAPE_CHECK;
		}
		expect(buildCalled).toBe(true);
		expect(
			diagnostics.filter((d) => (d as { kind: string }).kind === "contract_shape_mismatch"),
		).toEqual([
			{
				kind: "contract_shape_mismatch",
				shape_mode: "warn",
				shape_database: "spellkave-dev",
				shape_item: "table actor",
				shape_detail: expect.stringContaining("column mood: String exists only on the server"),
				client_epoch: KERNEL_CONTRACT_EPOCH,
			},
		]);
	});

	it.each(["strict", undefined, ""])("SPELLKAVE_SHAPE_CHECK=%s is strict mode", async (value) => {
		if (value !== undefined) process.env.SPELLKAVE_SHAPE_CHECK = value;
		globalThis.fetch = stubFetch(
			schema(STRICT_TABLES, STRICT_REDUCERS, [], appendedColumn),
		) as unknown as typeof fetch;
		try {
			await expect(connect(BASE_ARGS, BASE_CALLBACKS)).rejects.toBeInstanceOf(BindingShapeError);
		} finally {
			delete process.env.SPELLKAVE_SHAPE_CHECK;
		}
	});

	it.each([
		["env", "enforce", {}],
		["env", "WARN", {}],
		["option", "off", { shapeCheck: "off" as never }],
		["global", "Warn", {}],
	])("an unknown mode (%s %s) is a configuration error even without a mismatch", async (where, value, extra) => {
		if (where === "env") process.env.SPELLKAVE_SHAPE_CHECK = value;
		if (where === "global")
			(globalThis as { SPELLKAVE_SHAPE_CHECK?: string }).SPELLKAVE_SHAPE_CHECK = value;
		globalThis.fetch = stubFetch(schema(STRICT_TABLES, STRICT_REDUCERS)) as unknown as typeof fetch;
		try {
			await expect(connect({ ...BASE_ARGS, ...extra }, BASE_CALLBACKS)).rejects.toBeInstanceOf(
				ShapeCheckConfigError,
			);
		} finally {
			delete process.env.SPELLKAVE_SHAPE_CHECK;
			delete (globalThis as { SPELLKAVE_SHAPE_CHECK?: string }).SPELLKAVE_SHAPE_CHECK;
		}
		expect(buildCalled).toBe(false);
	});

	it("reports a mismatch once per process, one event per item, and ships it over OTLP from connect()", async () => {
		process.env.SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT = "https://telemetry.example/v1/logs";
		const reordered = (s: SchemaSnapshot) => {
			const actor = s.tables.actor;
			if (!actor) throw new Error("fixture: actor is a strict table");
			const [a, b, ...rest] = actor.columns;
			return {
				...s,
				tables: { ...s.tables, actor: { ...actor, columns: [b as string, a as string, ...rest] } },
			};
		};
		const body = schema(STRICT_TABLES, STRICT_REDUCERS, [], reordered);
		const otlp: string[] = [];
		globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
			if (String(url).includes("/v1/logs")) {
				otlp.push(String(init?.body));
				return { ok: true, status: 200 };
			}
			return { ok: true, status: 200, statusText: "OK", json: () => Promise.resolve(body) };
		}) as unknown as typeof fetch;
		const diagnostics: object[] = [];
		const args = {
			...BASE_ARGS,
			shapeCheck: "warn" as const,
			onDiagnostic: (line: object) => diagnostics.push(line),
		};
		await connect(args, BASE_CALLBACKS);
		await connect(args, BASE_CALLBACKS);
		const mismatches = diagnostics.filter(
			(d) => (d as { kind: string }).kind === "contract_shape_mismatch",
		);
		// Two shifted columns, one item, one event; the second connect reports nothing new.
		expect(mismatches).toHaveLength(1);
		expect((mismatches[0] as { shape_detail: string }).shape_detail).toContain("; ");
		await vi.waitFor(() => expect(otlp).toHaveLength(1));
		expect(otlp[0]).toContain("contract_shape_mismatch");
		expect(otlp[0]).toContain("table actor");
	});

	it('an explicit shapeCheck: "strict" wins over SPELLKAVE_SHAPE_CHECK=warn', async () => {
		process.env.SPELLKAVE_SHAPE_CHECK = "warn";
		globalThis.fetch = stubFetch(
			schema(STRICT_TABLES, STRICT_REDUCERS, [], appendedColumn),
		) as unknown as typeof fetch;
		try {
			await expect(
				connect({ ...BASE_ARGS, shapeCheck: "strict" }, BASE_CALLBACKS),
			).rejects.toBeInstanceOf(BindingShapeError);
		} finally {
			delete process.env.SPELLKAVE_SHAPE_CHECK;
		}
	});

	it("connects and reports binding_shape_diagnostic when only a consumed table's index differs", async () => {
		const diagnostics: object[] = [];
		globalThis.fetch = stubFetch(
			schema(STRICT_TABLES, STRICT_REDUCERS, [], (s) => {
				const actor = s.tables.actor;
				if (!actor) throw new Error("fixture: actor is a strict table");
				return { ...s, tables: { ...s.tables, actor: { ...actor, indexes: {} } } };
			}),
		) as unknown as typeof fetch;

		await connect({ ...BASE_ARGS, onDiagnostic: (line) => diagnostics.push(line) }, BASE_CALLBACKS);

		expect(buildCalled).toBe(true);
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				kind: "binding_shape_diagnostic",
				changes: [expect.stringContaining("table actor: indexes differ")],
			}),
		);
	});
});
