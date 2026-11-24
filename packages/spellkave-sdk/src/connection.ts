import { STRICT_REDUCERS } from "./core/world-contract/strict-reducers.ts";
// SpacetimeDB connection lifecycle for the pi extension.
//
// Wraps the generated TypeScript bindings in a small typed seam so the rest
// of the extension code can subscribe, snapshot, and disconnect without
// re-spelling the SDK's builder chain at every callsite. Stays well inside
// ADR-0009 D-2 wrapper discipline by limiting itself to:
//   * connection lifecycle (build / disconnect)
//   * the canonical first-slice subscription set
//   * a `snapshot()` that copies live tables into the actor/movement reader
//     shapes consumed by `src/core/{actor,movement}.ts`
//
// Reducer invocation lives in `tool.ts` next to the LLM tool definition so
// this file stays read-side only.

// Generated bindings ship as the workspace `@spellkave/bindings` package
// (source-of-truth produced by `just generate`); pi extension consumes the
// barrel export rather than reaching into the file layout.
import { DbConnection, type SubscriptionHandle } from "@spellkave/bindings";
// `@spellkave/world-events` is zero-dep and browser-gated (see the package's
// own header) — this is the one new edge B1/B2 add to the SDK's package
// graph, per `ledger/designs/session-owns-the-world-event-cursor.md`.
import { createWorldEventFanout, type WorldEventFanout } from "@spellkave/world-events";

import type {
	ActorSpatialLocationRow,
	EvaluationProvenanceRow,
	PlaceEdgeRow,
	PlaceNodeRow,
	WorldTimeRow,
} from "./binding_rows";
import type { LiveActorReader } from "./core/actor";
import {
	BindingDriftError,
	BindingShapeError,
	compareServedShape,
	fetchServerSchema,
} from "./core/binding_drift";
import { asEntityId, type EntityId } from "./core/ids";
import { KERNEL_CONTRACT, KERNEL_CONTRACT_EPOCH } from "./core/kernel_contract.generated";
import type { LiveMovementReader } from "./core/movement";
import { type ProvenanceBufferConfig, ProvenanceRingBuffer } from "./core/provenance_buffer";
import {
	CONTRACT_SHAPE_MISMATCH,
	exportShapeMismatches,
	shapeMismatchEvents,
	shapeMismatchFields,
	shapeTelemetryDriver,
	unreportedShapeMismatches,
} from "./core/shape_telemetry";
import { TickIntervalEstimator } from "./core/tick_cadence";
import { MANIFEST_APPLY_WAIT_TABLES } from "./manifest-apply";
import {
	CONNECTION_BASELINE,
	getRegisteredReaderTables,
	READER_SCOPED_TABLES,
	type ReaderManifest,
	STRICT_TABLES,
} from "./reader-manifest";
import type { SnapshotDb } from "./replay";
import { createWorldEventBuilder } from "./world-events/builder.ts";

export {
	CONNECTION_BASELINE,
	defaultReaderManifest,
	findUndeclaredBaselineTables,
	getRegisteredReaderTables,
	READER_SCOPED_TABLES,
	type ReaderManifest,
	type RequiredTables,
	registerReaderManifest,
	STRICT_TABLES,
	SUBSCRIBED_TABLES,
	type TableName,
} from "./reader-manifest";
export {
	captureSnapshotFrame,
	type SnapshotCaptureFrame,
	type SnapshotDb,
	type SnapshotFixtureTables,
	snapshotDbFromCaptureFrame,
	snapshotDbFromFixture,
} from "./replay";

type PromiseWithResolversResult<T> = {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
};

function ensurePromiseWithResolvers(): void {
	const PromiseCtor = Promise as PromiseConstructor & {
		withResolvers?: <T>() => PromiseWithResolversResult<T>;
	};
	if (typeof PromiseCtor.withResolvers === "function") return;

	PromiseCtor.withResolvers = <T>() => {
		let resolve!: (value: T | PromiseLike<T>) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<T>((resolveFn, rejectFn) => {
			resolve = resolveFn;
			reject = rejectFn;
		});
		return { promise, resolve, reject };
	};
}

// Raw evaluation_provenance, target_condition, object_state, world_event, entity_tag,
// arbitration context and autonomy jobs
// are private server state. Clients subscribe the per-caller visible_* views
// instead.
/**
 * Raw world-state tables the publisher may subscribe (ADR-0150).
 * Add a table here only with a live row, and only when no ADR makes that
 * table's view the only client read. This set bypasses `buildSubscribeSet()`
 * and its filter on purpose: private base names are stripped on the
 * ordinary reader route.
 */
export const OWNER_SUBSCRIPTION_TABLES = [
	"operator_manifest_authored_entity",
	"entity_tag",
	"autonomy_job",
	"arbitration_request",
	"arbitration_response",
	"arbitration_rejection",
	"arbitration_fallback",
	"entity_containment",
	"entity_location",
	"object_state",
	"capability",
	"actor_identity",
	"actor_spatial_location",
	"entity_equipment_slot",
	"target_condition",
] as const;

/**
 * Test-only probe. Not a `ConnectArgs` field and not part of the public
 * connect contract. A live proof sets `appendBogusTable` so the owner
 * subscription is refused at subscribe time.
 */
export const ownerSubscriptionTestProbe = { appendBogusTable: false };

export const FILTERED_SUBSCRIPTION_TABLES = [
	"manifest_applyset",
	"manifest_applyset_part",
	"manifest_applyset_export_hash",
	"manifest_authored_entity",
	"entity_tag",
	"autonomy_job",
	"arbitration_request",
	"arbitration_response",
	"arbitration_rejection",
	"arbitration_fallback",
	"actor_identity",
	"actor_driver_control",
	"actor_control_transition",
	"control_continuation",
	"control_continuation_refusal",
	"event_steering",
	"evaluation_provenance",
	"object_state",
	"target_condition",
	// sk-jay0.6.15.56.16.12.5.2.1: the turn singleton is private; a caller
	// reads `visible_turn_state` (its own session's rotation only).
	"turn_state",
	"world_event",
] as const;

/**
 * Compute the SELECT-* subscribe set: CONNECTION_BASELINE ∪ reader-union,
 * minus any tables that use filtered subscriptions.
 * Falls back to READER_SCOPED_TABLES when registry is empty so Phase 1
 * behavior is preserved until Phase 2 readers register their manifests.
 */
export function buildSubscribeSet(manifests?: readonly ReaderManifest[]): string[] {
	const readerTables =
		manifests === undefined
			? [...READER_SCOPED_TABLES, ...getRegisteredReaderTables()]
			: manifests.flatMap((manifest) => manifest.requiredTables);
	const optional = new Set<string>(OPTIONAL_SATELLITE_TABLES);

	return Array.from(new Set([...CONNECTION_BASELINE, ...readerTables])).filter(
		(t) => !(FILTERED_SUBSCRIPTION_TABLES as readonly string[]).includes(t) && !optional.has(t),
	);
}

/**
 * Public catalog satellites a module may predate. Each is subscribed only when
 * the live server surface lists it, so new bindings still connect to an older
 * module. `session_turn_eligibility`: ADR-0143 D-5 (the live author target
 * reconstructs `session_definitions.turn_eligibility_pred` from it).
 */
export const OPTIONAL_SATELLITE_TABLES = [
	"condition_definition_description",
	"session_turn_eligibility",
	// ADR-0149: the export view. A module published before this change does
	// not list it. Subscribing it unconditionally would fail that connect.
	"visible_observed_container_content",
	"visible_observed_container_coverage",
	"visible_manifest_export_result",
	"visible_clock_pacer",
	"visible_event_pace_time",
	"visible_manifest_apply_provenance",
	"manipulation_contract",
] as const;

export function subscribeSetForSurface(
	serverSurface: { tables: readonly string[] },
	manifests?: readonly ReaderManifest[],
): string[] {
	const optional = new Set<string>(OPTIONAL_SATELLITE_TABLES);
	const tables = buildSubscribeSet(manifests).filter((table) => !optional.has(table));
	for (const satellite of OPTIONAL_SATELLITE_TABLES) {
		if (serverSurface.tables.includes(satellite) && !tables.includes(satellite)) {
			tables.push(satellite);
		}
	}
	return tables;
}

export interface ConnectArgs {
	url: string;
	db: string;
	/** Auth token. `undefined` permits the host's SPELLKAVE_CONNECT_TOKEN
	 * default; `null` explicitly connects anonymously. */
	token: string | null | undefined;
	/** The in-world actor id bound to this session. Used for filtered provenance subscriptions. */
	connectedActorId: string;
	/** Optional JSONL diagnostic sink (D-C). Called with structured log lines.
	 *  Defaults to `console.warn(JSON.stringify(line))` when omitted. */
	onDiagnostic?: (line: object) => void;
	/** Ring buffer size config (D3). Defaults: connectedCap=512, perSubjectCap=200. */
	provenanceBufferSize?: Partial<ProvenanceBufferConfig>;
	/** Optional reader profile for callers that only need a narrowed live-cache slice. */
	readerManifests?: readonly ReaderManifest[];
	/**
	 * When true, and only when this connection's identity is the module
	 * publisher, open a second subscription over `OWNER_SUBSCRIPTION_TABLES`
	 * after the reader subscription applies (ADR-0150). Default false. `sk`
	 * is the one production caller.
	 */
	ownerTables?: boolean;
	/**
	 * Connect-time shape check mode (sk-jay0.7.389.3). `"strict"` (default:
	 * CI, tests, local dev): throw {@link BindingShapeError} when the served
	 * world module breaks a consumed row or reducer shape. `"warn"` (hosted
	 * apps and services opt in explicitly): connect anyway and emit one
	 * `contract_shape_mismatch` diagnostic per mismatch, plus the same event to
	 * OpenObserve when the host has `SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT`. See
	 * {@link resolveShapeCheck} for the global and environment fallbacks.
	 */
	shapeCheck?: ShapeCheckMode;
}

export type ShapeCheckMode = "strict" | "warn";

/**
 * The shape-check mode: the `shapeCheck` option; else `globalThis.SPELLKAVE_SHAPE_CHECK`
 * (a browser app sets it at start-up from its build configuration, e.g. Play's
 * `VITE_SPELLKAVE_SHAPE_CHECK`); else the `SPELLKAVE_SHAPE_CHECK` environment
 * variable where a process env exists. Only the exact value `"warn"` relaxes
 * it; anything else, absence included, is `"strict"`.
 */
export function resolveShapeCheck(option: ConnectArgs["shapeCheck"]): ShapeCheckMode {
	const g = globalThis as {
		SPELLKAVE_SHAPE_CHECK?: unknown;
		process?: { env?: Record<string, string | undefined> };
	};
	const sources: [string, unknown][] = [
		["connect({ shapeCheck })", option],
		["globalThis.SPELLKAVE_SHAPE_CHECK", g.SPELLKAVE_SHAPE_CHECK],
		["SPELLKAVE_SHAPE_CHECK", g.process?.env?.SPELLKAVE_SHAPE_CHECK],
	];
	for (const [source, value] of sources) {
		if (value === undefined || value === null || value === "") continue;
		if (value === "strict" || value === "warn") return value;
		throw new ShapeCheckConfigError(source, value);
	}
	return "strict";
}

/** An unknown shape-check mode: a configuration error in every mode, never a guess. */
export class ShapeCheckConfigError extends Error {
	constructor(source: string, value: unknown) {
		super(`${source} must be "strict" or "warn", got ${JSON.stringify(value)}`);
		this.name = "ShapeCheckConfigError";
	}
}

export interface SpellkaveSession {
	readonly grantProtocolSupported?: boolean;
	readonly handOverProtocolSupported?: boolean;
	conn: DbConnection;
	/** Resolves on first `onApplied`; rejects if the connection ends before then. */
	ready: Promise<void>;
	disconnect(): void;
	/** Per-session tick-interval estimator (D7). Updated on every world_time mutation. */
	estimator: TickIntervalEstimator;
	/** Latest world_time.tick from the live cache; 0n if cache empty (Phase 5.2 fails-closed on this). */
	currentWorldTick(): bigint;
	/** The in-world actor id bound at connect time. */
	readonly connectedActorId: string;
	/** Identity returned by the SDK authentication callback for this connection. */
	readonly authenticatedIdentity: DbConnection["identity"];
	/** Token returned by the SDK authentication callback for this connection. */
	readonly authenticatedToken: string | undefined;
	/** Per-session provenance ring buffer (D3). Populated via onInsert hooks. */
	readonly provenanceBuffer: ProvenanceRingBuffer;
	/** True when the published module lists `visible_manifest_export_result`. */
	readonly exportViewSubscribed: boolean;
	/**
	 * Replace the live reader set without replacing this connection. The next
	 * subscription is applied before the previous one is removed, so callers
	 * retain an overlap while their cache hydrates. This is transport/cache
	 * lifecycle only; callers still decide when it is safe to change profiles.
	 */
	replaceReaderManifests(manifests: readonly ReaderManifest[]): Promise<void>;
	/**
	 * The one world-event cursor for this session (one per session, lazily
	 * memoized on first access). First access CONSTRUCTS the builder; it does
	 * NOT prime it. Access after `ready`, then prime once with
	 * `diffAndAdvance()` at the moment your host considers itself "arrived" —
	 * that moment is a host decision the SDK cannot make for you. See
	 * `ledger/designs/session-owns-the-world-event-cursor.md`.
	 */
	readonly worldEvents: WorldEventFanout;
	/** True only after the owner subscription's `onApplied`. */
	readonly readsAsPublisher: boolean;
	/** Last subscribe-time error of the owner subscription, if any. */
	readonly ownerSubscriptionError: Error | null;
	/**
	 * Resolves when the owner subscription applies, or at once when the
	 * option is off or the identity is not the publisher. Rejects on a
	 * subscribe-time owner error, which is stored in `ownerSubscriptionError`.
	 * If still pending when the connection ends, it rejects as a connection
	 * failure and that rejection is not stored in `ownerSubscriptionError`.
	 * An error after the owner subscription has applied disconnects the whole
	 * connection and cannot be attributed to this query
	 * (`db_connection_impl.ts:1019-1031`, `:1390`, tag `v2.10.0`). A settled
	 * promise is not settled again. The SDK attaches a no-op `catch`.
	 * `ready` does not wait for this.
	 */
	readonly ownerRowsReady: Promise<void>;
}

/**
 * Open a connection, subscribe to the first-slice table set, and resolve
 * `ready` once the initial snapshot has applied. Errors propagate to the
 * `onError` callback and reject `ready` if they occur before first apply.
 *
 * Async (D-B): fetches the live schema before opening the WebSocket. Strict
 * name mismatch → throws BindingDriftError before .build(). A consumed row,
 * argument or type shape this client cannot decode or call (against the
 * generated KERNEL_CONTRACT, connect-time rules) → throws BindingShapeError
 * before .build() in "strict" mode (the default); in "warn" mode it connects
 * and emits one `contract_shape_mismatch` per change (diagnostic, plus OTLP
 * when configured). Other shape differences are a `binding_shape_diagnostic`.
 */
export async function connect(
	args: ConnectArgs,
	callbacks: {
		onError: (err: Error) => void;
		onDisconnect: (err: Error | undefined) => void;
		/** Cache mutation. Per-table hooks pass the snake_case table name; the initial (and later) subscription `onApplied` path passes {@link CACHE_APPLIED_MARKER}. Nullary listeners remain valid. */
		onUpdate: (table?: string) => void;
	},
): Promise<SpellkaveSession> {
	ensurePromiseWithResolvers();
	const diagnostic = args.onDiagnostic ?? ((line: object) => console.warn(JSON.stringify(line)));

	const shapeMode = resolveShapeCheck(args.shapeCheck);
	const served = await fetchServerSchema(args.url, args.db);
	const serverSurface = served.surface;
	const expected = {
		tables: [...STRICT_TABLES].sort(),
		reducers: [...STRICT_REDUCERS].sort(),
	};
	const expectedTableSet: ReadonlySet<string> = new Set(expected.tables);
	const expectedReducerSet: ReadonlySet<string> = new Set(expected.reducers);
	const actualStrict = {
		tables: serverSurface.tables.filter((t) => expectedTableSet.has(t)),
		reducers: serverSurface.reducers.filter((r) => expectedReducerSet.has(r)),
	};
	const missingTables = expected.tables.filter((t) => !serverSurface.tables.includes(t));
	if (missingTables.length > 0) {
		throw new BindingDriftError(expected, actualStrict, "table");
	}
	const missingReducers = expected.reducers.filter((r) => !serverSurface.reducers.includes(r));
	if (missingReducers.length > 0) {
		throw new BindingDriftError(expected, actualStrict, "reducer");
	}

	const shape = compareServedShape(served.schema, KERNEL_CONTRACT);
	const line = (c: { item: string; detail: string }) => `${c.item}: ${c.detail}`;
	if (shape.breaking.length > 0) {
		if (shapeMode === "strict") {
			throw new BindingShapeError(expected, actualStrict, shape.breaking, KERNEL_CONTRACT_EPOCH);
		}
		const mismatches = unreportedShapeMismatches(
			shapeMismatchFields(shape.breaking, args.db, KERNEL_CONTRACT_EPOCH),
		);
		for (const fields of mismatches) diagnostic({ kind: CONTRACT_SHAPE_MISMATCH, ...fields });
		void exportShapeMismatches(
			shapeMismatchEvents(mismatches, {
				runId: `contract-check-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
				actorId: args.connectedActorId,
				driver: shapeTelemetryDriver(),
				now: new Date(),
			}),
		);
	}
	if (shape.diagnostics.length > 0 || shape.unchecked.length > 0) {
		diagnostic({
			kind: "binding_shape_diagnostic",
			client_epoch: KERNEL_CONTRACT_EPOCH,
			changes: shape.diagnostics.map(line),
			unchecked: shape.unchecked.map((u) => `${u.item}: ${u.error}`),
		});
	}

	const additiveTables = serverSurface.tables.filter((t) => !expectedTableSet.has(t));
	const additiveReducers = serverSurface.reducers.filter((r) => !expectedReducerSet.has(r));
	if (additiveTables.length > 0 || additiveReducers.length > 0) {
		diagnostic({
			kind: "binding_drift_additive",
			additions: {
				tables: additiveTables,
				reducers: additiveReducers,
			},
		});
	}

	let resolveReady: () => void;
	let rejectReady: (err: Error) => void;
	const ready = new Promise<void>((resolve, reject) => {
		resolveReady = resolve;
		rejectReady = reject;
	});
	let resolveOwnerReady: () => void;
	let rejectOwnerReady: (err: Error) => void;
	const ownerRowsReady = new Promise<void>((resolve, reject) => {
		resolveOwnerReady = resolve;
		rejectOwnerReady = reject;
	});
	// An unobserved rejection must not end the process.
	ownerRowsReady.catch(() => {});
	let ownerSettled = false;
	const settleOwnerReady = (): void => {
		if (ownerSettled) return;
		ownerSettled = true;
		resolveOwnerReady();
	};
	const rejectOwnerWait = (error: Error, attributedToOwnerQuery: boolean): void => {
		if (ownerSettled) return;
		ownerSettled = true;
		if (attributedToOwnerQuery) ownerSubscriptionError = error;
		readsAsPublisher = false;
		rejectOwnerReady(error);
	};
	const failOwnerConnection = (err: unknown): void => {
		if (!args.ownerTables) return;
		rejectOwnerWait(
			err instanceof Error
				? err
				: new Error(String(err ?? "connection ended before owner rows were ready")),
			false,
		);
	};
	let readsAsPublisher = false;
	let ownerSubscriptionError: Error | null = null;
	let ownerOpened = false;
	if (!args.ownerTables) settleOwnerReady();

	let applied = false;
	const failInitialConnection = (error?: Error): void => {
		if (!applied)
			rejectReady(error ?? new Error("connection ended before initial subscription was ready"));
	};
	let conn: DbConnection | undefined;
	let activeSubscription: SubscriptionHandle | undefined;
	let subscriptionTail: Promise<void> = Promise.resolve();
	let authenticatedIdentity: DbConnection["identity"];
	let authenticatedToken: string | undefined;
	const estimator = new TickIntervalEstimator();
	const provenanceBuffer = new ProvenanceRingBuffer(
		args.connectedActorId,
		args.provenanceBufferSize ?? {},
	);

	const subscribe = (
		live: DbConnection,
		manifests: readonly ReaderManifest[] | undefined,
		onApplied: () => void,
		onError: (ctx: unknown, err?: unknown) => void,
	): SubscriptionHandle =>
		live
			.subscriptionBuilder()
			.onApplied(onApplied)
			.onError(onError)
			.subscribe(
				subscribeSetForSurface(serverSurface, manifests).map(
					// ci-allow(raw-sql): canonical SDK derivation from validated reader manifests and the published surface.
					(t) => `SELECT * FROM ${t}`,
				),
			);

	const openOwnerSubscription = (live: DbConnection): void => {
		if (!args.ownerTables || ownerOpened) return;
		ownerOpened = true;
		if (!isPublisherIdentity(live, authenticatedIdentity)) {
			settleOwnerReady();
			return;
		}
		const tables: string[] = [...OWNER_SUBSCRIPTION_TABLES];
		if (ownerSubscriptionTestProbe.appendBogusTable) {
			tables.push("spellkave_owner_probe_missing_table");
		}
		live
			.subscriptionBuilder()
			.onApplied(() => {
				if (ownerSettled) return;
				readsAsPublisher = true;
				settleOwnerReady();
			})
			.onError((_ctx: unknown, err?: unknown) => {
				rejectOwnerWait(toSubscriptionError(err ?? _ctx), true);
			})
			.subscribe(
				tables.map(
					// ci-allow(raw-sql): ADR-0150 owner set bypasses buildSubscribeSet and its filter on purpose.
					(table) => `SELECT * FROM ${table}`,
				),
			);
	};

	const replaceReaderManifests = (manifests: readonly ReaderManifest[]): Promise<void> => {
		const operation = subscriptionTail.then(
			() =>
				new Promise<void>((resolve, reject) => {
					const live = conn ?? built;
					const previous = activeSubscription;
					let next: SubscriptionHandle | undefined;
					let settled = false;
					next = subscribe(
						live,
						manifests,
						() => {
							// The upstream callback is normally asynchronous, but defer one
							// turn so a synchronous test/client callback still sees the
							// handle returned by subscribe before it becomes active.
							queueMicrotask(() => {
								if (settled) return;
								settled = true;
								activeSubscription = next;
								previous?.unsubscribe();
								callbacks.onUpdate(CACHE_APPLIED_MARKER);
								resolve();
							});
						},
						(ctx, err) => {
							if (settled) return;
							settled = true;
							const error =
								err instanceof Error
									? err
									: ctx instanceof Error
										? ctx
										: new Error(String(err ?? ctx ?? "subscription replacement failed"));
							callbacks.onError(error);
							reject(error);
						},
					);
				}),
		);
		subscriptionTail = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	};

	// SpacetimeDB 2.10.0 WebsocketDecompressAdapter can deliver an
	// uncompressed frame before an earlier gzip frame, corrupting caches.
	// Repro: src/__tests__/connection_transport.test.ts (no timing controls).
	// Re-enable only after an upstream ordering fix and this regression passes
	// with compression on. Correct subscription state takes priority over bytes.
	const builder = DbConnection.builder()
		.withCompression("none")
		.withUri(args.url)
		.withDatabaseName(args.db)
		.onConnect((live, identity, token) => {
			conn = live;
			authenticatedIdentity = identity;
			authenticatedToken = token;
			activeSubscription = subscribe(
				live,
				args.readerManifests,
				() => {
					if (!applied) {
						applied = true;
						resolveReady();
						openOwnerSubscription(live);
					}
					callbacks.onUpdate(CACHE_APPLIED_MARKER);
				},
				(ctx: unknown, err?: unknown) => {
					const error =
						err instanceof Error
							? err
							: ctx instanceof Error
								? ctx
								: new Error(String(err ?? ctx ?? "subscription failed"));
					callbacks.onError(error);
					if (!applied) rejectReady(error);
				},
			);
			// Re-render on any cache mutation across the subscribed tables. The
			// callback receives the moved table so a consumer (NPC seat) can
			// ignore baseline-only churn; a nullary widget listener still works.
			installRefreshHooks(live, callbacks.onUpdate);
			// Feed world_time updates into the per-session tick-interval estimator (D7).
			installTickEstimatorHook(live, estimator);
			// Feed evaluation_provenance inserts into the per-session ring buffer (D3).
			installProvenanceBufferHook(live, provenanceBuffer);
		})
		.onConnectError((_ctx, err) => {
			callbacks.onError(err);
			if (!applied) rejectReady(err);
			failOwnerConnection(err);
		})
		.onDisconnect((_ctx, err) => {
			failInitialConnection(err);
			callbacks.onDisconnect(err);
			failOwnerConnection(err);
		});

	const token = args.token === null ? undefined : (args.token ?? resolveConnectTokenFromEnv());
	if (token !== undefined) {
		builder.withToken(token);
	}

	const built = builder.build();

	// Memoized lazily by the `worldEvents` getter below — first access
	// constructs the one cursor for this session; every later access returns
	// the same object. See the interface doc comment and
	// `ledger/designs/session-owns-the-world-event-cursor.md`.
	let worldEvents: WorldEventFanout | undefined;

	const session: SpellkaveSession = {
		connectedActorId: args.connectedActorId,
		grantProtocolSupported: serverSurface.tables.includes("grant_inventory"),
		handOverProtocolSupported:
			serverSurface.tables.includes("role_binding_hand_over_context") &&
			serverSurface.tables.includes("visible_role_binding_transfer"),
		get authenticatedIdentity(): DbConnection["identity"] {
			return authenticatedIdentity ?? (conn ?? built).identity;
		},
		get authenticatedToken(): string | undefined {
			return authenticatedToken ?? (conn ?? built).token;
		},
		get conn(): DbConnection {
			// Returns the live connection only after onConnect — callers should
			// await `ready` first. We surface the post-connect handle by closure
			// so `tool.ts` can reach `conn.reducers`.
			return conn ?? built;
		},
		ready,
		replaceReaderManifests,
		disconnect() {
			failInitialConnection();
			failOwnerConnection(new Error("connection ended before owner rows were ready"));
			try {
				(conn ?? built).disconnect();
			} catch {
				// ignore disconnect-after-disconnect
			}
		},
		estimator,
		provenanceBuffer,
		exportViewSubscribed: serverSurface.tables.includes("visible_manifest_export_result"),
		currentWorldTick(): bigint {
			if (!conn) return 0n;
			const db = conn.db as unknown as Record<string, TableHandle | undefined>;
			const handle = db.worldTime ?? db.world_time;
			if (!handle) return 0n;
			for (const row of handle.iter()) {
				const r = row as unknown as WorldTimeRow;
				return typeof r.tick === "bigint" ? r.tick : BigInt(String(r.tick ?? 0));
			}
			return 0n;
		},
		get readsAsPublisher(): boolean {
			return readsAsPublisher;
		},
		get ownerSubscriptionError(): Error | null {
			return ownerSubscriptionError;
		},
		ownerRowsReady,
		get worldEvents(): WorldEventFanout {
			// CONSTRUCTS only — never primes. Priming is a host decision (see
			// the doc comment on `SpellkaveSession.worldEvents`).
			if (worldEvents === undefined) {
				worldEvents = createWorldEventFanout(
					createWorldEventBuilder(
						() => snapshotDb(session),
						() => session.connectedActorId,
					),
				);
			}
			return worldEvents;
		},
	};
	return session;
}

function toSubscriptionError(value: unknown): Error {
	if (value instanceof Error) return value;
	return new Error(String(value ?? "owner subscription failed"));
}

function identityHex(value: unknown): string {
	if (typeof value === "string") return value.replace(/^0x/i, "").toLowerCase();
	if (value && typeof value === "object" && "toHexString" in value) {
		const hex = (value as { toHexString?: () => string }).toHexString;
		if (typeof hex === "function") return hex.call(value).replace(/^0x/i, "").toLowerCase();
	}
	return "";
}

function isPublisherIdentity(live: DbConnection, authenticated: unknown): boolean {
	const mine = identityHex(authenticated);
	if (mine.length === 0) return false;
	const db = live.db as unknown as {
		config?: { iter?: () => Iterable<{ operatorIdentity?: unknown; operator_identity?: unknown }> };
	};
	const handle = db.config;
	if (!handle?.iter) return false;
	for (const row of handle.iter()) {
		const owner = identityHex(row.operatorIdentity ?? row.operator_identity);
		return owner.length > 0 && owner === mine;
	}
	return false;
}

function resolveConnectTokenFromEnv(): string | undefined {
	if (typeof process === "undefined") return undefined;
	const token = process.env.SPELLKAVE_CONNECT_TOKEN;
	return token !== undefined && token.length > 0 ? token : undefined;
}

/**
 * Wire world_time mutations into the per-session TickIntervalEstimator (D7).
 * Called once from onConnect so the estimator accumulates deltas from the
 * moment the subscription applies.
 */
function installTickEstimatorHook(conn: DbConnection, estimator: TickIntervalEstimator): void {
	const db = conn.db as unknown as Record<string, TableHandle | undefined>;
	const handle = db.worldTime ?? db.world_time;
	if (!handle) return;

	const sample = (): void => {
		for (const row of handle.iter()) {
			const r = row as unknown as WorldTimeRow;
			const tick = typeof r.tick === "bigint" ? r.tick : BigInt(String(r.tick ?? 0));
			estimator.record(tick, Date.now());
			return; // world_time is a singleton — first row is the only row
		}
	};

	handle.onInsert?.(sample);
	handle.onUpdate?.(sample);
}

/**
 * Wire visible_evaluation_provenance inserts into the per-session ring buffer (D3).
 * Updates are not wired — provenance rows are immutable once written.
 */
function installProvenanceBufferHook(conn: DbConnection, buffer: ProvenanceRingBuffer): void {
	const db = conn.db as unknown as Record<string, TableHandle | undefined>;
	const handle =
		db.visibleEvaluationProvenance ??
		db.visible_evaluation_provenance ??
		db.evaluationProvenance ??
		db.evaluation_provenance;
	if (!handle) return;

	handle.onInsert?.(() => {
		for (const raw of handle.iter()) {
			const r = raw as unknown as EvaluationProvenanceRow;
			buffer.insert({
				id: r.provenanceId,
				kind: tagString(r.kind),
				status: tagString(r.status),
				subject_id: r.subjectId,
				failure_kind: r.failureKind,
				failure_detail: r.failureDetail,
				selected_template_ids: Array.isArray(r.selectedTemplateIds)
					? r.selectedTemplateIds.map(String)
					: [],
				created_at_tick: r.createdAtTick,
				bundle_id: r.bundleId,
			});
		}
	});
}

function tagString(v: unknown): string {
	if (typeof v === "string") return v;
	if (v && typeof v === "object") {
		const tag = (v as { tag?: unknown }).tag;
		if (typeof tag === "string") return tag;
	}
	return String(v ?? "");
}

/** Distinct marker `onApplied` reports — never a real table name. Consumers
 * that filter wakes treat this as always-observable (the snapshot is new). */
export const CACHE_APPLIED_MARKER = "__applied";

/**
 * Wire `onUpdate` to fire whenever any subscribed table mutates. Passes the
 * snake_case table name so a consumer can filter; a nullary listener still
 * compiles. Wrapping is required — the SDK's `onInsert`/`onUpdate`/`onDelete`
 * invoke with `(ctx, row)`, which must not leak into `onUpdate`'s table arg.
 */
export function installRefreshHooks(conn: DbConnection, onUpdate: (table: string) => void): void {
	// The SDK's table accessors live under `conn.db`. Each accessor exposes
	// `onInsert/onUpdate/onDelete`. We dispatch by name so we don't depend on
	// the exact camelCased accessor identifiers being unique to this slice.
	const db = conn.db as unknown as Record<string, TableHandle | undefined>;
	// Apply bookkeeping is deliberately outside the PLAYER reader baseline.
	// An elevated caller subscribing it still needs seal/failure notifications.
	for (const t of [
		...CONNECTION_BASELINE,
		...READER_SCOPED_TABLES,
		...MANIFEST_APPLY_WAIT_TABLES,
		...OPTIONAL_SATELLITE_TABLES,
	]) {
		const handle = db[toCamel(t)] ?? db[t];
		if (!handle) continue;
		const fire = (): void => onUpdate(t);
		handle.onInsert?.(fire);
		handle.onDelete?.(fire);
		handle.onUpdate?.(fire);
	}
}

interface TableHandle {
	iter(): Iterable<Record<string, unknown>>;
	onInsert?: (cb: () => void) => void;
	onDelete?: (cb: () => void) => void;
	onUpdate?: (cb: () => void) => void;
}

function toCamel(snake: string): string {
	return snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Public live-cache view for read-model helpers. */
export function snapshotDb(session: SpellkaveSession): SnapshotDb {
	return session.conn.db as unknown as SnapshotDb;
}

/**
 * Build the readers consumed by `core/actor.ts` and `core/movement.ts` from
 * the live SDK caches. Called every time the widget re-renders.
 */
export function snapshot(conn: DbConnection): {
	actors: LiveActorReader;
	controlledActors: LiveActorReader;
	movement: LiveMovementReader;
} {
	return snapshotFromDb(conn.db as unknown as SnapshotDb);
}

export function snapshotFromDb(db: SnapshotDb): {
	actors: LiveActorReader;
	controlledActors: LiveActorReader;
	movement: LiveMovementReader;
} {
	const locationsHandle = db.visibleActorSpatialLocation ?? db.visible_actor_spatial_location;
	const controlledLocationsHandle =
		db.directlyControlledActorSpatialLocation ?? db.directly_controlled_actor_spatial_location;
	const authoredEntityHandle =
		db.visibleManifestAuthoredEntity ?? db.visible_manifest_authored_entity;
	const edgesHandle = db.visiblePlaceEdge ?? db.visible_place_edge;
	const nodesHandle = db.visiblePlaceNode ?? db.visible_place_node;
	const entityAliases = new Map<string, string[]>();
	const mappingCoverage = [
		...((
			db.visibleManifestAuthoredEntityCoverage ?? db.visible_manifest_authored_entity_coverage
		)?.iter() ?? []),
	] as Array<{ status?: string; projectionVersion?: number }>;
	const mappingComplete =
		mappingCoverage.length === 1 &&
		mappingCoverage[0]?.status === "complete" &&
		mappingCoverage[0]?.projectionVersion === 1;
	for (const r of mappingComplete ? (authoredEntityHandle?.iter() ?? []) : []) {
		const row = r as unknown as { entityId?: bigint | number; manifestKey?: string };
		if (row.entityId === undefined || row.manifestKey === undefined) continue;
		const alias = row.manifestKey.includes(":")
			? row.manifestKey.slice(row.manifestKey.indexOf(":") + 1)
			: row.manifestKey;
		const key = String(row.entityId);
		const aliases = entityAliases.get(key) ?? [];
		aliases.push(alias);
		entityAliases.set(key, aliases);
	}

	const actorReader = (handle: TableHandle | undefined): LiveActorReader => ({
		locations: () =>
			Array.from(handle?.iter() ?? []).map((r) => {
				const row = r as unknown as ActorSpatialLocationRow;
				const entityId = String(row.entityId);
				const out: {
					entity_id: EntityId;
					aliases?: string[];
					node_id: string | undefined;
				} = {
					entity_id: asEntityId(entityId),
					node_id: optionalString(row.placeNodeId),
				};
				const aliases = entityAliases.get(entityId);
				if (aliases !== undefined && aliases.length > 0) out.aliases = aliases;
				return out;
			}),
	});

	return {
		// Broad scene/perception projection: includes direct, extent, and co-located bodies.
		actors: actorReader(locationsHandle as TableHandle | undefined),
		// Strict server-attested control projection for connection activation.
		controlledActors: actorReader(controlledLocationsHandle as TableHandle | undefined),
		movement: {
			// `visible_place_edge.edgeId` is `u64` in the generated table, but `r_move`
			// accepts a string `edgeId` in its reducer schema (see
			// `@spellkave/bindings`: `visible_place_edge_table.ts`, `r_move_reducer.ts`).
			// Stringify here so widget display, LLM tool input, and reducer call
			// all share one identifier shape.
			edges: () =>
				Array.from(edgesHandle?.iter() ?? []).map((r) => {
					const row = r as unknown as PlaceEdgeRow;
					return {
						edge_id: String(row.edgeId),
						from_node_id: row.fromNodeId,
						to_node_id: row.toNodeId,
					};
				}),
			nodes: () =>
				Array.from(nodesHandle?.iter() ?? []).map((r) => {
					const row = r as unknown as PlaceNodeRow;
					return { node_id: row.nodeId };
				}),
		},
	};
}

function optionalString(v: unknown): string | undefined {
	if (v === undefined || v === null) return undefined;
	const s = String(v);
	return s.length > 0 ? s : undefined;
}
