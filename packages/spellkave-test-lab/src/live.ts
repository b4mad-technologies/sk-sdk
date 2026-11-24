// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "Per-call isolated worlds vary topology, actors, capabilities, resources, and instance options."}
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { DbConnection, ErrorContext, SubscriptionEventContext } from "@spellkave/bindings";
import type { SnapshotDb as ReaderSnapshotDb, SpatialEnvironmentStateRow } from "@spellkave/sdk";
// Historical-client admission probes load their pinned reader module during
// bootstrap. Resolve the new export only when a current-client state helper runs.
import * as environmentStateReader from "@spellkave/sdk";
import {
	buildSubscribeSet,
	connect,
	createManifestApplyLane,
	emptyManipulationArgs,
	enqueueAndWaitManifestApply,
	FILTERED_SUBSCRIPTION_TABLES,
	getRegisteredReaderTables,
	ManifestApplyError,
	READER_SCOPED_TABLES,
	type ReaderManifest,
	type SpellkaveSession,
	type TableName,
	targetRefFromString,
} from "@spellkave/sdk";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
// Side-effect import: loads EVERY core reader module so each one registers its
// ReaderManifest before any test-lab connect computes the default subscribe
// set below. Tables that live only in reader registrations (e.g.
// `visible_entity_location` via co_location, `session_participant`/turn tables
// via session) are otherwise silently absent — exactly the narrowing that made
// the first manifest-only run of the srd-cc arena proofs go blind (#2080).
import * as coreReaders from "@spellkave/sdk/readers";
import { countedStep, requireFinalPhase } from "./steps";

const DEFAULT_URL = "http://127.0.0.1:3000";
const DEFAULT_DB = "spellkave-dev";
// Provenance-buffer bookkeeping only. A generic test connection may be
// privileged or not yet actor-bound; callers with a meaningful actor id can
// override this through ConnectTestWorldOptions.
const DEFAULT_CONNECTED_ACTOR_ID = "test-lab";
// Default bundle id for `sharedBundleWorldSpecs` callers that don't supply
// their own. This is the generic test-lab harness, so it does not export a
// bundle-namespaced constant (that lives in `@spellkave/srd`'s
// `src/test/live-preseeded/srd-harness-extras.ts` as `SRD_TEST_LAB_BUNDLE_ID`, same
// value, since #1968 slice 5 absorbed the old `@spellkave/srd-runner` shim) —
// the literal is inlined here purely as a default parameter value, byte-
// identical to the pre-extraction behavior.
const DEFAULT_SHARED_BUNDLE_ID = "test_srd_runner_lab";
// Production apply wait tables (`MANIFEST_APPLY_WAIT_TABLES` in
// `manifest-apply.ts`) that this file's apply wrappers subscribe so the
// production primitive can drain. Always folded into the connect-time
// reader-manifest set — see `resolveInitialReaderManifests` below — so a
// caller that narrows `readerManifests` can never silently drop them out from
// under that machinery (ledger finding #12,
// `packages/spellkave-srd-cc/ledger/findings.md`: a first attempt did exactly
// that, and every later `applyManifestSource`/`applyManifestFixture` call hung
// forever waiting on a digest row nothing had subscribed). These tables are
// apply-drain bookkeeping, not a domain reader's dependency, so their
// `TableName` home is `REPLAY_PANEL_TABLES` (reader-manifest.ts), not
// `READER_SCOPED_TABLES`.
export const MANIFEST_SETUP_READER_MANIFEST: ReaderManifest = {
	requiredTables: ["manifest_apply_digest", "manifest_apply_outcome"],
};

// The reader-manifest set `connectTestWorld` opens with when the caller
// passes no `readerManifests` at all: the full reader-scoped table catalog
// PLUS the registered-reader union PLUS the always-on core manifest above —
// mirroring `buildSubscribeSet()`'s own fallback-when-no-manifests shape
// (`READER_SCOPED_TABLES ∪ getRegisteredReaderTables()`). The registered union
// is deterministic here because the `import "@spellkave/sdk/readers"` side-effect above
// loads the complete core reader barrel before this function can run; a
// static-catalog-only default silently narrowed relative to production
// connects and blinded the srd-cc arena proofs on their first manifest-only
// run (#2080). Computed per call, not at module load, so late reader
// registrations are never dropped.
function defaultTestWorldReaderManifests(): readonly ReaderManifest[] {
	return [
		{ requiredTables: READER_SCOPED_TABLES },
		// ADR-0130 D-4 keeps the `on_demand` reference namespaces (`srd.text`,
		// the advancement/equipment/spellcasting creation data, docs) out of the
		// play-session default: `public_reference_metadata` lives in
		// `REPLAY_PANEL_TABLES`, not `READER_SCOPED_TABLES`. A test world is not
		// a play session — it already takes the whole reader catalog above, and
		// every harness that drives a live `AuthorTarget` (DM creation,
		// advancement, discovery) reads those rows. Subscribe it here so a
		// harness cannot silently read an empty table.
		{ requiredTables: ["public_reference_metadata"] },
		// Registered tables are declared by their reader modules against the
		// TableName catalog; the Set<string> return shape just erases that.
		{ requiredTables: [...getRegisteredReaderTables()] as unknown as readonly TableName[] },
		MANIFEST_SETUP_READER_MANIFEST,
	];
}

export interface ConnectTestWorldOptions {
	url?: string;
	db?: string;
	/// Actor key used by the SDK connection's provenance buffer. It need not
	/// resolve for privileged setup or pre-claim connections.
	connectedActorId?: string;
	/// A custom reader-manifest set, EXTENDING (never replacing) the always-on
	/// core manifest (`MANIFEST_SETUP_READER_MANIFEST`) — see
	/// `resolveInitialReaderManifests`. Omit entirely to get the full
	/// reader-scoped table catalog instead of a narrowed set.
	readerManifests?: readonly ReaderManifest[];
	token?: string | null | undefined;
	/// Hard deadline for the initial connect + subscribe round-trip. Defaults to
	/// `DEFAULT_CONNECT_TIMEOUT_MS`. See `connectTestWorld` for why this exists.
	connectTimeoutMs?: number;
}

/// Compute the reader-manifest set `connectTestWorld` opens with: the full
/// `defaultTestWorldReaderManifests()` default (static catalog ∪ registered
/// readers ∪ core manifest) when the caller passes no `readerManifests` option
/// at all, otherwise the caller's own manifests EXTENDED with the always-on
/// core manifest (`MANIFEST_SETUP_READER_MANIFEST`) — a narrowing caller can
/// never end up without the table this file's own drain-wait machinery needs.
/// Exported as a pure function so its behavior is unit-testable without a
/// live node (see `live.subscriptions.test.ts`).
export function resolveInitialReaderManifests(
	readerManifests?: readonly ReaderManifest[],
): readonly ReaderManifest[] {
	if (readerManifests === undefined) return defaultTestWorldReaderManifests();
	return [...readerManifests, MANIFEST_SETUP_READER_MANIFEST];
}

/**
 * Build a reader manifest for OPERATOR / TEST-OBSERVER scope only (god view)
 * — e.g. a harness that needs a domain-specific table this SDK's central
 * reader-manifest catalog (`READER_SCOPED_TABLES`/`REPLAY_PANEL_TABLES` in
 * `reader-manifest.ts`) doesn't (yet) know about. `tables` bypasses the
 * `TableName` catalog entirely: the caller is asserting these names exist on
 * the server and accepting that a typo fails at subscribe time, not at
 * `tsc`. NEVER use this to widen a player-seat connection — a PLAYER surface
 * must declare its dependencies through the normal `ReaderManifest`/
 * `TableName` catalog so the D2 completeness gate can see it. `name` is
 * carried for diagnostics only and has no effect on the resulting subscribe
 * set.
 */
export function operatorScopeManifest(name: string, tables: readonly string[]): ReaderManifest {
	if (tables.length === 0) {
		throw new Error(`operatorScopeManifest(${JSON.stringify(name)}): tables must not be empty`);
	}
	return { requiredTables: tables as unknown as readonly TableName[] };
}

/// A connect-time row-deserialization error (e.g. a TS-bindings/server-schema
/// mismatch) is thrown by the SpacetimeDB SDK from inside an `async` WebSocket
/// `onmessage` handler (`WebsocketDecompressAdapter#onmessage` in the SDK),
/// which the caller never awaits — it surfaces only as a Node
/// `unhandledRejection`, past both `onConnectError` and `onApplied`. Without a
/// deadline, `connectTestWorld` hangs until the *outer* test-hook timeout
/// (issue #1260: 15 minutes, burying the real error). 45s comfortably covers a
/// healthy local-node connect + subscribe.
const DEFAULT_CONNECT_TIMEOUT_MS = 45_000;

export interface TestWorld {
	conn: DbConnection;
	identity?: string;
	token?: string;
	db(): SnapshotDb;
	subscribeReaders(manifests: readonly ReaderManifest[]): Promise<void>;
	disconnect(): void;
}

export interface SnapshotDb {
	[accessor: string]: { iter(): Iterable<unknown> } | undefined;
}

export interface IsolatedWorldOptions {
	bundleId?: string;
	capabilityIds?: readonly string[];
	supportCapabilityIds?: readonly string[];
	bundleDeps?: readonly string[];
	dummyHp?: number | null;
	casterDefId?: string;
	dummyDefId?: string;
	includePortal?: boolean;
	includeSupport?: boolean;
	instanced?: boolean;
	extraSpatialNicheIds?: readonly string[];
	// Place the dummy (target) on the SECOND grid cell (`cell_b`, one grid step
	// from the caster's `cell`) instead of co-located. Mirrors a tactical-grid
	// combat where two figures stand on adjacent cells: the act-path reachability
	// gate must span the inter-cell distance for a melee affordance to land. The
	// capability niches are re-attached at `cell_b` so the act-path
	// `attachment_presence` precondition is satisfied (the live ephemeral grid
	// inherits the same niches from its anchor node; here we author them directly).
	dummyOnSecondCell?: boolean;
	// `place_graph.metres_per_unit` (graph-unit → metres). The two cells are
	// unit spaced (`pos = i`, like a live ADR-0052 grid), so the metric
	// distance between adjacent cells is exactly `graphScale`. Default schema
	// value 1.0.
	graphScale?: number;
	// Instance-level `object_state` seeds (REP-CP4B) on the CASTER's own entity_key
	// (`casterKey`). A resource-gated capability (e.g. Magic Missile's
	// `srd/spell_slot_1` slot cost) needs its pool seeded on the ISOLATED caster —
	// this world's caster is a fresh per-test instance, never the canonical
	// `srd/regdar` a hand-authored `[[object_state]]` row would target. Do NOT
	// weaken the affordance gate to work around a missing seed here — size the
	// seed for the caller's test instead.
	casterObjectStateSeeds?: readonly { stateId: string; valueInt: number }[];
	/** Authored in the same scene, after its owner, so containment resolves locally. */
	casterEquipment?: readonly {
		entityDefId: string;
		slotId: string;
		stateSeeds?: readonly { stateId: string; valueInt: number }[];
	}[];
}

export interface IsolatedWorldSpec {
	slug: string;
	options?: IsolatedWorldOptions;
}

export interface WorldHandle {
	manifestReceipt: ManifestProbeReceipt;
	slug: string;
	bundleId: string;
	blueprintGraphId: string;
	instanceId: string;
	blueprintNodeId: string;
	blueprintNodeBId: string;
	instanceNodeId: string;
	instanceNodeBId: string;
	instanceEdgeKey: string;
	instanceReverseEdgeKey: string;
	casterDefId: string;
	dummyDefId: string;
	supportDefId: string;
	casterEntityId: bigint;
	dummyEntityId: bigint;
	supportEntityId: bigint | null;
	casterActorId: bigint;
	dispose(): Promise<void>;
}

export interface ConditionRow {
	rowId: bigint;
	conditionDefinitionId: string;
	sourceId: string;
	parentRowId: bigint | null;
}

export interface CapabilityRow {
	capabilityId: string;
	source: string;
}

export interface ActionDefinitionRow {
	actionId: string;
	requiredCapability: string;
	onSuccess: string;
	selfEligible: boolean;
}

export async function connectTestWorld(options: ConnectTestWorldOptions = {}): Promise<TestWorld> {
	const ready = promiseWithResolvers<void>();
	let session: SpellkaveSession | undefined;
	const activeTables = new Set<string>();
	const initialManifests = resolveInitialReaderManifests(options.readerManifests);

	// Route an async SDK failure (see `DEFAULT_CONNECT_TIMEOUT_MS` above) onto
	// `ready` so the real error rejects the hook instead of vanishing, and cap
	// the wait so any other failure mode this can't observe still fails fast.
	const onUnhandledRejection = (reason: unknown) => {
		ready.reject(reason instanceof Error ? reason : new Error(String(reason)));
	};
	process.on("unhandledRejection", onUnhandledRejection);
	const timeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
	const timeout = setTimeout(() => {
		ready.reject(
			new Error(`connectTestWorld: connect/subscribe did not settle within ${timeoutMs}ms`),
		);
	}, timeoutMs);
	let abandoned = false;
	void connect(
		{
			url: options.url ?? process.env.SPELLKAVE_URL ?? DEFAULT_URL,
			db: options.db ?? process.env.SPELLKAVE_DB ?? DEFAULT_DB,
			token: options.token,
			connectedActorId: options.connectedActorId ?? DEFAULT_CONNECTED_ACTOR_ID,
			readerManifests: initialManifests,
		},
		{ onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} },
	).then(
		(connected) => {
			if (abandoned) {
				connected.disconnect();
				return;
			}
			session = connected;
			void connected.ready.then(ready.resolve, ready.reject);
		},
		(error: unknown) => ready.reject(error),
	);

	try {
		await ready.promise;
		const connectedSession = session;
		if (connectedSession === undefined) {
			throw new Error("connectTestWorld: SDK connection became ready without a session handle");
		}
		const conn = connectedSession.conn;
		for (const table of buildSubscribeSet(initialManifests)) activeTables.add(table);
		return {
			conn,
			identity: String(connectedSession.authenticatedIdentity),
			token: connectedSession.authenticatedToken,
			db: () => conn.db as unknown as SnapshotDb,
			subscribeReaders: (manifests) => subscribeMissingTables(conn, activeTables, manifests),
			disconnect: () => connectedSession.disconnect(),
		};
	} catch (err) {
		abandoned = true;
		session?.disconnect();
		throw err;
	} finally {
		clearTimeout(timeout);
		process.off("unhandledRejection", onUnhandledRejection);
	}
}

export async function applyManifestFixture(
	world: TestWorld,
	fixturePath: string,
	options: ApplyManifestOptions = {},
): Promise<void> {
	await applyWorldManifestAsPublisher(
		world,
		readManifestWithIncludes(findRepoPath(fixturePath)),
		options,
	);
}

export async function isolatedWorld(
	world: TestWorld,
	slug: string,
	options: IsolatedWorldOptions = {},
): Promise<WorldHandle> {
	const [handle] = await isolatedWorlds(world, [{ slug, options }]);
	if (handle === undefined) throw new Error(`isolated world '${slug}' did not resolve`);
	return handle;
}

/**
 * Stage a fresh scene for a sequential probe on an exclusively owned database.
 * Reuses the canonical authority bootstrap and Isolated Cell authoring/bindings.
 * Required content dependencies (core by default) must already be admitted.
 * Existing scenes remain intact; this is not a concurrent namespace allocator.
 */
export async function freshIsolatedWorld(
	world: TestWorld,
	prefix: string,
	options: Omit<IsolatedWorldOptions, "bundleId"> = {},
): Promise<WorldHandle> {
	await ensureApplyManifestAuthority(world);
	await world.subscribeReaders([{ requiredTables: ["mod_bundle"] }]);
	const existing = new Set(Array.from(world.conn.db.modBundle.iter(), (row) => row.bundleId));
	const normalized = normalizeSlug(prefix);
	let ordinal = 1;
	while (existing.has(isolatedWorldModel(`${normalized}-${ordinal}`, options).bundleId))
		ordinal += 1;
	return isolatedWorld(world, `${normalized}-${ordinal}`, options);
}

/** Render Isolated Cell helper TOML without applying it (offline field checks). */
export function isolatedWorldManifestSource(specs: readonly IsolatedWorldSpec[]): string {
	const models = specs.map((spec) => isolatedWorldModel(spec.slug, spec.options ?? {}));
	return renderIsolatedWorldManifest(models);
}

export async function isolatedWorlds(
	world: TestWorld,
	specs: readonly IsolatedWorldSpec[],
): Promise<WorldHandle[]> {
	const models = specs.map((spec) => isolatedWorldModel(spec.slug, spec.options ?? {}));
	if (models.length === 0) return [];
	const timing = srdRunnerTimings();
	let phaseStarted = Date.now();
	const manifestReceipt = await applyWorldManifestAsPublisherWithReceipt(
		world,
		renderIsolatedWorldManifest(models),
	);
	phaseStarted = timing("isolatedWorlds.apply", phaseStarted);
	// Upgrade to the full reader-scoped table catalog regardless of what the
	// caller's connection was narrowed to at connect time — `resolveIsolatedWorld`
	// below reads `visible_manifest_authored_entity` and `actor`, both in
	// `READER_SCOPED_TABLES`.
	await world.subscribeReaders([{ requiredTables: READER_SCOPED_TABLES }]);
	phaseStarted = timing("isolatedWorlds.subscribe", phaseStarted);
	const handles = await Promise.all(
		models.map((model) => resolveIsolatedWorld(world, model, manifestReceipt)),
	);
	timing("isolatedWorlds.resolve", phaseStarted);
	return handles;
}

export function sharedBundleWorldSpecs(
	specs: readonly IsolatedWorldSpec[],
	bundleId = DEFAULT_SHARED_BUNDLE_ID,
): IsolatedWorldSpec[] {
	return specs.map((spec) => ({
		...spec,
		options: {
			...spec.options,
			bundleId,
		},
	}));
}

async function resolveIsolatedWorld(
	world: TestWorld,
	model: ReturnType<typeof isolatedWorldModel>,
	manifestReceipt: ManifestProbeReceipt,
): Promise<WorldHandle> {
	const manifestEntity = (entityKey: string): bigint | null =>
		entityIdByManifestKey(world.db(), `${model.bundleId}:${entityKey}`);
	await waitForEvent(
		world,
		() => manifestEntity(model.casterKey) !== null,
		`isolated world '${model.slug}' caster did not appear`,
	);
	const casterEntityId = manifestEntity(model.casterKey);
	if (casterEntityId === null) throw new Error(`isolated world '${model.slug}' caster disappeared`);
	// Resolve authored probe IDs through the staging manifest map, not remote
	// live-location rows. The latter are caller-scoped and intentionally omit an
	// adjacent dummy until gameplay establishes the relevant observation extent.
	await waitForEvent(
		world,
		() => manifestEntity(model.dummyKey) !== null,
		`isolated world '${model.slug}' dummy did not appear`,
	);
	const dummyEntityId = manifestEntity(model.dummyKey);
	if (dummyEntityId === null) throw new Error(`isolated world '${model.slug}' dummy disappeared`);
	if (model.includeSupport) {
		await waitForEvent(
			world,
			() => manifestEntity(model.supportKey) !== null,
			`isolated world '${model.slug}' support did not appear`,
		);
	}
	const supportEntityId = model.includeSupport ? manifestEntity(model.supportKey) : null;
	await waitForEvent(
		world,
		() => actorIdForBody(world.db(), casterEntityId) !== null,
		`isolated world '${model.slug}' caster actor binding did not appear`,
	);
	const casterActorId = requireActorForBody(world.db(), casterEntityId);

	return {
		...model,
		manifestReceipt,
		casterEntityId,
		dummyEntityId,
		supportEntityId,
		casterActorId,
		dispose: async () => {
			await bestEffortDeleteBundle(world, model.bundleId);
		},
	};
}

export async function bindActor(
	world: TestWorld,
	actorId: bigint,
	role = "primary",
): Promise<void> {
	await world.conn.reducers.rClaimActor({ actorId, role });
	await waitForEvent(
		world,
		() => actorIdentityCount(world.db(), actorId) > 0,
		`actor ${actorId} was not claimed by the test connection`,
	);
}

/** Explicit operator setup for unoffered fixture actors. This is never a
 * fallback from a refused claim, and never marks a fixture body as playable. */
export async function bindActorAsOperator(
	world: TestWorld,
	actorId: bigint,
	role = "primary",
): Promise<void> {
	const token = resolveSpacetimeConfigPathToken();
	if (!token || !world.identity)
		throw new Error("operator actor setup requires publisher and receiving identity");
	const publisher = world.token === token ? world : await connectTestWorld({ token });
	try {
		await publisher.conn.reducers.rBindActorIdentity({
			actorId,
			identityHex: world.identity,
			role,
			provenance: "person",
		});
		await waitForEvent(
			world,
			() => actorIdentityCount(world.db(), actorId) > 0,
			`operator fixture binding for actor ${actorId} was not observed`,
		);
	} finally {
		if (publisher !== world) publisher.disconnect();
	}
}

/** Drive authority is deliberately a separate caller from the named seat. */
export async function assignDriver(
	host: TestWorld,
	presenceActorId: bigint,
	actorId: bigint,
	seatIdentity: string,
): Promise<void> {
	await host.conn.reducers.rAssignDriver({ presenceActorId, actorId, identityHex: seatIdentity });
}

export async function connectDedicatedClaimWorld(
	options: ConnectTestWorldOptions = {},
	credentialSlot?: string,
): Promise<TestWorld> {
	const url = options.url ?? process.env.SPELLKAVE_URL ?? DEFAULT_URL;
	const db = options.db ?? process.env.SPELLKAVE_DB ?? DEFAULT_DB;
	const tokenPath = dedicatedClaimTokenPath(url, db, credentialSlot);
	const existingToken = readDedicatedClaimToken(tokenPath);
	const world = await connectTestWorld({ ...options, token: existingToken });
	if (existingToken === undefined && world.token !== undefined) {
		persistDedicatedClaimToken(tokenPath, world.token);
	}
	return world;
}

function dedicatedClaimTokenPath(url: string, db: string, credentialSlot?: string): string {
	let key = "";
	const slotSuffix = credentialSlot === undefined ? "" : `-${credentialSlot}`;
	for (const ch of `${url}-${db}${slotSuffix}`) {
		key += /[A-Za-z0-9_-]/.test(ch) ? ch : "_";
	}
	return path.join(repoLocalDir(), "test-lab-claim-credentials", `${key}.token`);
}

/// Locate the repo root by walking UP from `process.cwd()` looking for a
/// repo marker (`pnpm-workspace.yaml` — this is a pnpm workspace — or
/// `.git`, which also matches a worktree's `.git` FILE), rather than
/// assuming a fixed cwd-to-root relation (canon-warden finding: the
/// previous cwd-then-`../..` heuristic could write a claim credential
/// OUTSIDE the repo entirely — e.g. a fresh worktree invoked with
/// cwd = repo root and no `.local/` yet would silently resolve to the
/// GRANDPARENT of the repo). Bounded to 20 levels (generously covers any
/// real monorepo nesting depth) — never guesses past that; throws instead
/// of returning a path that might not be inside the repo.
function repoLocalDir(): string {
	let dir = process.cwd();
	for (let i = 0; i < 20; i++) {
		if (existsSync(path.join(dir, "pnpm-workspace.yaml")) || existsSync(path.join(dir, ".git"))) {
			return path.join(dir, ".local");
		}
		const parent = path.dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	throw new Error(
		`connectDedicatedClaimWorld: could not locate the repo root (no pnpm-workspace.yaml or ` +
			`.git found walking up from ${process.cwd()}) — refusing to guess a claim-credential ` +
			`path that might land outside the repo.`,
	);
}

function readDedicatedClaimToken(tokenPath: string): string | undefined {
	try {
		const raw = readFileSync(tokenPath, "utf8").trim();
		return raw.length > 0 ? raw : undefined;
	} catch {
		return undefined;
	}
}

function persistDedicatedClaimToken(tokenPath: string, token: string): void {
	mkdirSync(path.dirname(tokenPath), { recursive: true });
	writeFileSync(tokenPath, token, "utf8");
}

/** One step: advance the clock one turn, then act. Final phase only in an opted-in lane. */
export async function castAction(
	world: TestWorld,
	actorEntityId: bigint,
	targetEntityId: bigint,
	actionId: string,
): Promise<void> {
	requireFinalPhase("castAction");
	await countedStep("castAction", 1, async () => {
		await advanceTurn(world);
		await manipulateAction(world, actorEntityId, targetEntityId, actionId);
	});
}

/** One step: one manual world tick (a test-lab turn is a tick). Final phase only in an opted-in lane. */
export async function advanceTurn(world: TestWorld): Promise<void> {
	requireFinalPhase("advanceTurn");
	await countedStep("advanceTurn", 1, () => manualTick(world));
}

/** Thrown before dispatch when `advanceSessionTurn` cannot succeed for this caller. */
export class SessionTurnRefusedError extends Error {}

/**
 * One step: advance a session's turn as the controller of its current outgoing
 * actor (wraps `r_advance_turn`, design D-9).
 *
 * Fails before dispatch, without counting a step, when the session is not
 * visible on `world`, when it awaits reactions (ADR-0093 D-7), or when `world`
 * does not control the outgoing body (ADR-0037 postscript of 2026-07-18). A
 * session turn writes the world-global `turn_state` row, so the calling file
 * must carry `// live-phase: final` in an opted-in lane. The test authors its
 * own prefixed `session_definition` and turn scheduler through a manifest delta.
 */
export async function advanceSessionTurn(
	world: TestWorld,
	sessionId: bigint,
	driverToken?: ReturnType<typeof captureTestDriverToken>,
): Promise<void> {
	requireFinalPhase("advanceSessionTurn");
	await world.subscribeReaders([
		{ requiredTables: ["visible_session", "visible_actor_driver_control"] },
	]);
	const sessions = [...(table(world.db(), "visibleSession", "visible_session")?.iter() ?? [])] as {
		sessionId: bigint;
		lifecycle: string;
		currentActor: string;
	}[];
	const session = sessions.find((row) => row.sessionId === sessionId);
	if (session === undefined) {
		throw new SessionTurnRefusedError(
			`advanceSessionTurn: session ${sessionId} is not visible on connection ${world.identity ?? "<unknown>"}`,
		);
	}
	if (session.lifecycle === "awaiting-reactions") {
		throw new SessionTurnRefusedError(
			`advanceSessionTurn: session ${sessionId} awaits reactions; resolve them with r_react first`,
		);
	}
	const token = driverToken ?? captureTestDriverToken(world, session.currentActor);
	if (token === undefined || String(token.bodyEntityId) !== String(session.currentActor)) {
		throw new SessionTurnRefusedError(
			`advanceSessionTurn: connection ${world.identity ?? "<unknown>"} does not control outgoing actor ${session.currentActor} of session ${sessionId}`,
		);
	}
	await countedStep("advanceSessionTurn", 1, () =>
		world.conn.reducers.rAdvanceTurn({ sessionId, driverToken: token }),
	);
}

/** Snapshot the current observations for an immediate test-lab decision.
 * Carry these values through dispatch; a caller with an earlier decision must
 * keep its earlier tokens instead of calling this helper again. */
export function captureTestDriverToken(world: TestWorld, body: string | bigint) {
	// The pinned pre-gate SDK used by historical admission proofs has no
	// control reader. Current helpers still capture before their dispatch.
	return coreReaders.captureDriverToken?.(world.db() as ReaderSnapshotDb, body);
}

export function captureTestDriverTokens(world: TestWorld, bodies: readonly bigint[]) {
	return bodies.flatMap((body) => {
		const token = captureTestDriverToken(world, body);
		return token === undefined ? [] : [token];
	});
}

export async function manipulateAction(
	world: TestWorld,
	actorEntityId: bigint,
	targetEntityId: bigint,
	actionId: string,
): Promise<void> {
	await world.conn.reducers.rManipulate({
		actorId: actorEntityId,
		driverToken: captureTestDriverToken(world, actorEntityId),
		targetRef: targetRefFromString(`entity:${targetEntityId}`),
		actionId,
		args: emptyManipulationArgs(),
	});
}

/** Sibling of `manipulateAction` for callers that already hold a wire-form
 * target ref string (e.g. `item:<id>`, not just `entity:<id>`) — a CONTAINED
 * item has no `entity_location` row of its own, so it is only reachable
 * through the `item:` prefix (`TargetRef::Item`), which `manipulateAction`'s
 * hardcoded `entity:` prefix cannot express. Both dispatch through the same
 * `r_manipulate` reducer a PLAYER-facing tool calls internally. */
export async function manipulateTargetRef(
	world: TestWorld,
	actorEntityId: bigint,
	targetRef: string,
	actionId: string,
): Promise<void> {
	await world.conn.reducers.rManipulate({
		actorId: actorEntityId,
		driverToken: captureTestDriverToken(world, actorEntityId),
		targetRef: targetRefFromString(targetRef),
		actionId,
		args: emptyManipulationArgs(),
	});
}

export async function setTestRng(world: TestWorld, seed: bigint | number | null): Promise<void> {
	await requireTestReducer<{ seed: bigint | undefined }>(world, "debugSetRngSeed")({
		seed: seed === null ? undefined : BigInt(seed),
	});
}

/** Thrown when `syncConnection` does not get its no-op reducer result in time. */
export class SyncConnectionTimeoutError extends Error {}

function requireTestReducer<Args>(world: TestWorld, accessor: string): (args: Args) => Promise<void> {
	const reducers = world.conn.reducers;
	const reducer: unknown = Reflect.get(reducers, accessor);
	if (typeof reducer !== "function") {
		throw new Error(`Test world does not expose the ${accessor} reducer. Use the server test harness.`);
	}
	return reducer.bind(reducers);
}

/** Wait for the test world's connection barrier before reading its subscription cache. */
export async function syncConnection(world: TestWorld, timeoutMs = 5_000): Promise<void> {
	const label = world.identity ?? "<unknown identity>";
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(
				new SyncConnectionTimeoutError(
					`syncConnection: debug_sync_marker on connection ${label} did not return within ${timeoutMs} ms; the recorder cannot prove this connection's cache is current`,
				),
			);
		}, timeoutMs);
	});
	try {
		await Promise.race([
			Promise.resolve().then(() => requireTestReducer<Record<string, never>>(world, "debugSyncMarker")({})).catch((cause: unknown) => {
				const detail = cause instanceof Error ? cause.message : String(cause);
				throw new Error(
					`syncConnection: debug_sync_marker failed on connection ${label}: ${detail} (use a test world with a connection barrier)`,
					{ cause },
				);
			}),
			timeout,
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

export async function pauseTicks(world: TestWorld): Promise<void> {
	requireFinalPhase("pauseTicks");
	await world.conn.reducers.pauseTick({});
}

export async function resumeTicks(world: TestWorld): Promise<void> {
	requireFinalPhase("resumeTicks");
	await world.conn.reducers.resumeTick({});
}

/** One step: one manual world tick. Final phase only in an opted-in lane. */
export async function manualTick(world: TestWorld): Promise<void> {
	requireFinalPhase("manualTick");
	await countedStep("manualTick", 1, () => world.conn.reducers.manualTick({}));
}

/**
 * `ticks` steps in one reducer call. The budget is checked before dispatch, so
 * `manualTicks(world, { ticks: 31 })` fails at once instead of after 31 ticks.
 */
export async function manualTicks(world: TestWorld, options: { ticks: number }): Promise<void> {
	requireFinalPhase("manualTicks");
	await countedStep("manualTicks", options.ticks, () =>
		world.conn.reducers.manualTicks({ ticks: options.ticks }),
	);
}

// `hp()` (the `"srd/hp"`-keyed convenience wrapper over `intState`) lives in
// `@spellkave/srd`'s `src/test/live-preseeded/srd-harness-extras.ts` per design.md D-2
// (moved there by #1968 slice 5, absorbing the old `@spellkave/srd-runner`
// shim) — the SDK exposes only the generic, caller-parameterized `intState`
// below.
export function intState(db: SnapshotDb, entityId: bigint, stateId: string): number | null {
	const handle = table(db, "visibleObjectState", "visible_object_state");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.targetId ?? row.target_id) !== String(entityId)) continue;
		if (String(row.stateId ?? row.state_id) !== stateId) continue;
		const value = row.value;
		if (
			typeof value === "object" &&
			value !== null &&
			"tag" in value &&
			(value as { tag: string }).tag === "Int"
		) {
			return Number((value as unknown as { value: bigint | number }).value);
		}
		const direct = row.valueInt ?? row.value_int;
		if (direct !== undefined && direct !== null) return Number(direct);
	}
	return null;
}

export function hasSpatialState(
	db: SnapshotDb,
	stateId: string,
	target: { placeNodeId?: string; placeEdgeId?: bigint },
	value?: { tag: "Int" } | { tag: "Bool"; value: boolean },
): boolean {
	const handle = table(db, "visibleSpatialEnvironmentState", "visible_spatial_environment_state");
	for (const raw of environmentStateReader.resolveEffectiveSpatialEnvironmentStates(
		(handle?.iter() ?? []) as Iterable<SpatialEnvironmentStateRow>,
	)) {
		const row = raw as Record<string, unknown>;
		if (String(row.stateId ?? row.state_id) !== stateId) continue;
		if (
			target.placeNodeId !== undefined &&
			String(row.placeNodeId ?? row.place_node_id) !== target.placeNodeId
		) {
			continue;
		}
		if (
			target.placeEdgeId !== undefined &&
			String(row.placeEdgeId ?? row.place_edge_id) !== String(target.placeEdgeId)
		) {
			continue;
		}
		if (value === undefined) return true;
		if (dslValueMatches(row.value, value)) return true;
	}
	return false;
}

export function autonomyJobPresent(db: SnapshotDb, jobIdIncludes: string): boolean {
	return autonomyJobs(db, jobIdIncludes).length > 0;
}

export function autonomyJobHasAnchor(db: SnapshotDb, jobIdIncludes: string): boolean {
	return autonomyJobs(db, jobIdIncludes).some(
		(row) => optionalString(row.anchorPlaceNodeId ?? row.anchor_place_node_id) !== null,
	);
}

export function autonomyJobDisabled(db: SnapshotDb, jobIdIncludes: string): boolean {
	const handle = table(db, "eventAutonomyJob", "event_autonomy_job");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (!String(row.jobId ?? row.job_id).includes(jobIdIncludes)) continue;
		if (row.disabled) return true;
	}
	return false;
}

export function placeEdgeId(db: SnapshotDb, edgeKey: string): bigint {
	const handle = table(db, "visiblePlaceEdge", "visible_place_edge");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.edgeKey ?? row.edge_key) === edgeKey) {
			return BigInt(String(row.edgeId ?? row.edge_id));
		}
	}
	throw new Error(`could not resolve place edge ${edgeKey}`);
}

/// The directed `place_edge` connecting `fromNode` → `toNode`, mirroring the Rust
/// twins' `edge_id(from, to)` lookup (the SDK `r_move` needs the concrete edge id).
export function placeEdgeIdBetween(
	db: SnapshotDb,
	fromNode: string,
	toNode: string,
): bigint | null {
	const handle = table(db, "visiblePlaceEdge", "visible_place_edge");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (
			String(row.fromNodeId ?? row.from_node_id) === fromNode &&
			String(row.toNodeId ?? row.to_node_id) === toNode
		) {
			return BigInt(String(row.edgeId ?? row.edge_id));
		}
	}
	return null;
}

export function actorNodeId(db: SnapshotDb, entityId: bigint): string | null {
	const handle = table(db, "visibleActorSpatialLocation", "visible_actor_spatial_location");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.entityId ?? row.entity_id) === String(entityId)) {
			return String(row.placeNodeId ?? row.place_node_id);
		}
	}
	return null;
}

export function entityIdsByDefinition(db: SnapshotDb, entityDefId: string): bigint[] {
	const handle = table(db, "entity");
	const ids: bigint[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.entityDefId ?? row.entity_def_id) === entityDefId) {
			ids.push(BigInt(String(row.entityId ?? row.entity_id)));
		}
	}
	return ids;
}

/// Read a committed fixture's manifest source (with includes resolved).
export function readFixtureSource(fixturePath: string): string {
	return readManifestWithIncludes(findRepoPath(fixturePath));
}

/// Count rows in a subscribed table by SDK accessor (+ optional snake_case
/// fallback) — for "rejection-before-writes" falsifiers that assert a reducer
/// branch grew no table except provenance.
export function countRows(db: SnapshotDb, accessor: string, snakeName?: string): number {
	const handle = snakeName === undefined ? table(db, accessor) : table(db, accessor, snakeName);
	let n = 0;
	for (const _ of handle?.iter() ?? []) n += 1;
	return n;
}

export interface EntityRow {
	entityId: bigint;
	name: string;
	entityDefId: string;
	kind: string;
	quantity: number;
	ownedByEntityId: bigint;
}

export function entityRows(db: SnapshotDb): EntityRow[] {
	const handle = table(db, "entity");
	const rows: EntityRow[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		rows.push({
			entityId: BigInt(String(row.entityId ?? row.entity_id)),
			name: String(row.name ?? ""),
			entityDefId: String(row.entityDefId ?? row.entity_def_id ?? ""),
			kind: String(row.kind ?? ""),
			quantity: Number(row.quantity ?? 0),
			ownedByEntityId: BigInt(String(row.ownedByEntityId ?? row.owned_by_entity_id ?? 0)),
		});
	}
	return rows;
}

export function hasEntityWithDefAndQuantity(
	db: SnapshotDb,
	entityDefId: string,
	quantity: number,
): boolean {
	const handle = table(db, "entity");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.entityDefId ?? row.entity_def_id) !== entityDefId) continue;
		if (Number(row.quantity ?? -1) === quantity) return true;
	}
	return false;
}

export function entityContainer(db: SnapshotDb, entityId: bigint): bigint | null {
	const handle = table(db, "visibleEntityContainment", "visible_entity_containment");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.entityId ?? row.entity_id) !== String(entityId)) continue;
		return BigInt(String(row.containerId ?? row.container_id));
	}
	return null;
}

export function objectStateBoolTrueFor(db: SnapshotDb, targetId: bigint, stateId: string): boolean {
	const handle = table(db, "visibleObjectState", "visible_object_state");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.targetId ?? row.target_id) !== String(targetId)) continue;
		if (String(row.stateId ?? row.state_id) !== stateId) continue;
		const value = row.value;
		if (
			typeof value === "object" &&
			value !== null &&
			"tag" in value &&
			(value as { tag: string }).tag === "Bool" &&
			(value as { value?: unknown }).value === true
		) {
			return true;
		}
		if ((row.valueBool ?? row.value_bool) === true) return true;
	}
	return false;
}

/// The `source_template_id` of a `visible_object_state` row (which authored
/// consequence stamped the state), or null if absent — lets a falsifier prove a
/// derived state came from the expected outcome template, not a seed default.
export function objectStateSourceTemplate(
	db: SnapshotDb,
	targetId: bigint,
	stateId: string,
): string | null {
	const handle = table(db, "visibleObjectState", "visible_object_state");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.targetId ?? row.target_id) !== String(targetId)) continue;
		if (String(row.stateId ?? row.state_id) !== stateId) continue;
		return String(row.sourceTemplateId ?? row.source_template_id ?? "");
	}
	return null;
}

export async function waitForEntityNamed(
	world: TestWorld,
	name: string,
	timeoutMs = 12_000,
): Promise<bigint> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const id = entityIdByName(world.db(), name);
		if (id !== null) return id;
		await new Promise((r) => setTimeout(r, 60));
	}
	throw new Error(`entity '${name}' not authored within ${timeoutMs}ms`);
}

export async function waitForEntityByDef(
	world: TestWorld,
	entityDefId: string,
	timeoutMs = 12_000,
): Promise<bigint> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const id = entityIdsByDefinition(world.db(), entityDefId).at(0);
		if (id !== undefined) return id;
		await new Promise((r) => setTimeout(r, 60));
	}
	throw new Error(`no entity with definition '${entityDefId}' within ${timeoutMs}ms`);
}

export function entityIdByName(db: SnapshotDb, name: string): bigint | null {
	const handle = table(db, "entity");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.name ?? "") === name) return BigInt(String(row.entityId ?? row.entity_id));
	}
	return null;
}

export function placeNodeIdByDisplayName(db: SnapshotDb, displayName: string): string | null {
	const handle = table(db, "visiblePlaceNode", "visible_place_node");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.displayName ?? row.display_name) === displayName) {
			return String(row.nodeId ?? row.node_id);
		}
	}
	return null;
}

/// All `place_node` ids whose node_id starts with `prefix` — proves a place-graph
/// INSTANCE materialised (instance nodes are keyed `<graph>#<suffix>/<local>`),
/// without reading the raw `place_graph_definition` table.
export function placeNodeIdsWithPrefix(db: SnapshotDb, prefix: string): string[] {
	const handle = table(db, "visiblePlaceNode", "visible_place_node");
	const ids: string[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		const nodeId = String(row.nodeId ?? row.node_id);
		if (nodeId.startsWith(prefix)) ids.push(nodeId);
	}
	return ids;
}

export function entityIdsAtNode(db: SnapshotDb, nodeId: string): bigint[] {
	const handle = table(db, "visibleEntityLocation", "visible_entity_location");
	const ids: bigint[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.placeNodeId ?? row.place_node_id) === nodeId) {
			ids.push(BigInt(String(row.entityId ?? row.entity_id)));
		}
	}
	return ids;
}

export function entityNodeId(db: SnapshotDb, entityId: bigint): string | null {
	const handle = table(db, "visibleEntityLocation", "visible_entity_location");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.entityId ?? row.entity_id) === String(entityId)) {
			return String(row.placeNodeId ?? row.place_node_id);
		}
	}
	return null;
}

export function actorIdForBody(db: SnapshotDb, bodyEntityId: bigint): bigint | null {
	const handle = table(db, "actor");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.currentBody ?? row.current_body) === String(bodyEntityId)) {
			return BigInt(String(row.actorId ?? row.actor_id));
		}
	}
	return null;
}

export function effectDefinitionParams(db: SnapshotDb, effectDefId: string): string | null {
	const handle = table(db, "effectDefinition", "effect_definition");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.effectDefId ?? row.effect_def_id) === effectDefId) {
			return String(row.parametersSchemaJson ?? row.parameters_schema_json);
		}
	}
	return null;
}

export async function manipulatePlaceNodeAction(
	world: TestWorld,
	actorEntityId: bigint,
	placeNodeId: string,
	actionId: string,
): Promise<void> {
	await world.conn.reducers.rManipulate({
		actorId: actorEntityId,
		driverToken: captureTestDriverToken(world, actorEntityId),
		targetRef: targetRefFromString(`place_node:${placeNodeId}`),
		actionId,
		args: emptyManipulationArgs(),
	});
}

export async function moveActor(
	world: TestWorld,
	actorEntityId: bigint,
	fromNodeId: string,
	toNodeId: string,
	edgeId: bigint,
): Promise<void> {
	await world.conn.reducers.rMove({
		actorId: actorEntityId,
		driverToken: captureTestDriverToken(world, actorEntityId),
		fromNode: fromNodeId,
		toNode: toNodeId,
		edgeId: String(edgeId),
	});
}

/// Drive `r_move` with a raw `edgeId` string so a no-state-change rejection
/// branch (e.g. a non-parseable edge ref) can be exercised. `moveActor` coerces
/// a `bigint`; the provenance falsifiers need to pass deliberately invalid refs.
export async function moveActorRaw(
	world: TestWorld,
	actorEntityId: bigint,
	fromNodeId: string,
	toNodeId: string,
	edgeId: string,
): Promise<void> {
	await world.conn.reducers.rMove({
		actorId: actorEntityId,
		driverToken: captureTestDriverToken(world, actorEntityId),
		fromNode: fromNodeId,
		toNode: toNodeId,
		edgeId,
	});
}

export async function senseAction(
	world: TestWorld,
	actorEntityId: bigint,
	queryKind: string,
	visibilityClass: string,
): Promise<void> {
	await world.conn.reducers.rSense({
		actorId: actorEntityId,
		driverToken: captureTestDriverToken(world, actorEntityId),
		queryKind,
		visibilityClass,
	});
}

export async function manipulateActionWithArgs(
	world: TestWorld,
	actorEntityId: bigint,
	targetEntityId: bigint,
	actionId: string,
	args: Parameters<TestWorld["conn"]["reducers"]["rManipulate"]>[0]["args"],
): Promise<void> {
	await world.conn.reducers.rManipulate({
		actorId: actorEntityId,
		driverToken: captureTestDriverToken(world, actorEntityId),
		targetRef: targetRefFromString(`entity:${targetEntityId}`),
		actionId,
		args,
	});
}

/// Sibling of `manipulateActionWithArgs` for an affordance whose target is
/// the place sentinel (`target_entity_id = 0`, `TargetRef::PlaceNode`) rather
/// than an entity — e.g. an addressee-less communicate row materialised by
/// an actor-provided niche (ADR-0137). `manipulatePlaceNodeAction` above
/// covers the same target shape but hardcodes `emptyManipulationArgs()`;
/// this variant threads real `args` (e.g. `dispatch_text`) the same way
/// `manipulateActionWithArgs` does for an entity target.
export async function manipulatePlaceNodeActionWithArgs(
	world: TestWorld,
	actorEntityId: bigint,
	placeNodeId: string,
	actionId: string,
	args: Parameters<TestWorld["conn"]["reducers"]["rManipulate"]>[0]["args"],
): Promise<void> {
	await world.conn.reducers.rManipulate({
		actorId: actorEntityId,
		driverToken: captureTestDriverToken(world, actorEntityId),
		targetRef: targetRefFromString(`place_node:${placeNodeId}`),
		actionId,
		args,
	});
}

export interface FailureProvenanceRow {
	subjectId: string;
	status: string;
	failureKind: string;
	failureDetail: string;
	terminalEventIdCount: number;
}

function terminalEventIdCount(value: unknown): number {
	if (Array.isArray(value)) return value.length;
	return 0;
}

/// Read `visible_evaluation_provenance` rows for one subject. The substrate
/// proof these back (#1219 stream B) is "a rejected no-state-change reducer
/// branch writes a Failed provenance row" — the SDK can read this table
/// directly, so the assertion ports cleanly from the deleted Rust twins.
export function failureProvenanceFor(
	db: SnapshotDb,
	subjectId: bigint | string,
): FailureProvenanceRow[] {
	const handle = table(db, "visibleEvaluationProvenance", "visible_evaluation_provenance");
	const rows: FailureProvenanceRow[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.subjectId ?? row.subject_id) !== String(subjectId)) continue;
		rows.push({
			subjectId: String(row.subjectId ?? row.subject_id),
			status: provenanceStatusTag(row.status),
			failureKind: String(row.failureKind ?? row.failure_kind ?? ""),
			failureDetail: String(row.failureDetail ?? row.failure_detail ?? ""),
			terminalEventIdCount: terminalEventIdCount(row.terminalEventIds ?? row.terminal_event_ids),
		});
	}
	return rows;
}

export async function waitForFailureProvenance(
	world: TestWorld,
	subjectId: bigint | string,
	match: (row: FailureProvenanceRow) => boolean,
	timeoutMs = 5_000,
): Promise<FailureProvenanceRow> {
	let found: FailureProvenanceRow | undefined;
	await waitFor(
		() => {
			found = failureProvenanceFor(world.db(), subjectId).find(
				(row) => row.status === "Failed" && match(row),
			);
			return found !== undefined;
		},
		`no Failed evaluation_provenance row for subject ${subjectId}`,
		timeoutMs,
	);
	if (found === undefined) throw new Error(`unreachable: provenance row for ${subjectId}`);
	return found;
}

/// Resolve a manifest-authored entity by its `bundle:entity_key` manifest key
/// (the `visible_manifest_authored_entity` projection). Runtime-spawned entities are not
/// authored, so resolve those via `entityIdsByDefinition` instead.
export function entityIdByManifestKey(db: SnapshotDb, manifestKey: string): bigint | null {
	// The pinned privileged-namespace predecessor predates admitted views. This
	// branch is restricted to its disposable before-stage client; current clients
	// never fall back to a raw baseline.
	const historical =
		process.env.SPELLKAVE_NAMESPACE_STAGE === "before" &&
		process.env.SPELLKAVE_NAMESPACE_DISPOSABLE === "1" &&
		Boolean(process.env.SPELLKAVE_NAMESPACE_PREDECESSOR_CLIENT);
	const handle = historical
		? table(db, "manifestAuthoredEntity", "manifest_authored_entity")
		: table(db, "visibleManifestAuthoredEntity", "visible_manifest_authored_entity");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.manifestKey ?? row.manifest_key) === manifestKey) {
			return BigInt(String(row.entityId ?? row.entity_id));
		}
	}
	return null;
}

/// All integer `visible_object_state` values for one (entity, state) pair. The
/// seed-collision proof asserts exactly one row survives (explicit author value
/// wins over the definition seed), so callers need the full multiset, not the
/// first match `intState` returns.
export function objectStateInts(db: SnapshotDb, entityId: bigint, stateId: string): number[] {
	const handle = table(db, "visibleObjectState", "visible_object_state");
	const values: number[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.targetId ?? row.target_id) !== String(entityId)) continue;
		if (String(row.stateId ?? row.state_id) !== stateId) continue;
		const value = row.value;
		if (
			typeof value === "object" &&
			value !== null &&
			"tag" in value &&
			(value as { tag: string }).tag === "Int"
		) {
			values.push(Number((value as unknown as { value: bigint | number }).value));
			continue;
		}
		const direct = row.valueInt ?? row.value_int;
		if (direct !== undefined && direct !== null) values.push(Number(direct));
	}
	return values;
}

export interface ActorSpatialLocationRow {
	placeNodeId: string;
	selectionPath: string;
}

export function actorSpatialLocationRow(
	db: SnapshotDb,
	entityId: bigint,
): ActorSpatialLocationRow | null {
	const handle = table(db, "visibleActorSpatialLocation", "visible_actor_spatial_location");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.entityId ?? row.entity_id) !== String(entityId)) continue;
		return {
			placeNodeId: String(row.placeNodeId ?? row.place_node_id),
			selectionPath: String(row.selectionPath ?? row.selection_path ?? ""),
		};
	}
	return null;
}

// `actor_identity` is private (#915 PR-5); every call site of this helper
// checks the CONNECTING client's own binding (post-claim, post-release, or a
// spawn inheriting the summoner's own identity), so the self-only
// `visible_actor_identity` view (ADR-0084 D-5 Family 1 shape) is sufficient —
// there is no cross-identity read here.
export function actorIdentityRoles(db: SnapshotDb, actorId: bigint): string[] {
	const handle = table(db, "visibleActorIdentity", "visible_actor_identity");
	const roles: string[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.actorId ?? row.actor_id) !== String(actorId)) continue;
		roles.push(String(row.role ?? ""));
	}
	return roles;
}

function provenanceStatusTag(value: unknown): string {
	if (typeof value === "string") return value;
	if (typeof value === "object" && value !== null && "tag" in value) {
		return String((value as { tag: unknown }).tag);
	}
	return "";
}

export function conditionsFor(db: SnapshotDb, entityId: bigint): ConditionRow[] {
	const handle = table(db, "visibleTargetCondition", "visible_target_condition");
	const rows: ConditionRow[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.targetId ?? row.target_id) !== String(entityId)) continue;
		rows.push({
			rowId: BigInt(String(row.rowId ?? row.row_id)),
			conditionDefinitionId: String(row.conditionDefinitionId ?? row.condition_definition_id),
			sourceId: String(row.sourceId ?? row.source_id),
			parentRowId: optionalBigInt(row.parentRowId ?? row.parent_row_id),
		});
	}
	return rows;
}

export function hasCondition(
	db: SnapshotDb,
	entityId: bigint,
	conditionDefinitionId: string,
): boolean {
	return conditionsFor(db, entityId).some(
		(row) => row.conditionDefinitionId === conditionDefinitionId,
	);
}

export function capabilitiesFor(db: SnapshotDb, entityId: bigint): CapabilityRow[] {
	const handle = table(db, "visibleCapability", "visible_capability");
	const rows: CapabilityRow[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.entityId ?? row.entity_id) !== String(entityId)) continue;
		rows.push({
			capabilityId: String(row.capabilityId ?? row.capability_id),
			source: String(row.source),
		});
	}
	return rows;
}

/// True when a *Hidden*-visibility capability row for `entityId` is present in
/// this connection's `visible_capability` projection. Hidden rows are only
/// projected to callers the see-as broadening admits, so this distinguishes a DM
/// inside a grant's extent (sees the foreign body's Hidden capability) from a
/// passive player outside it (does not). The SDK enum lands as `{ tag: "Hidden" }`.
export function hasHiddenCapability(db: SnapshotDb, entityId: bigint): boolean {
	const handle = table(db, "visibleCapability", "visible_capability");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.entityId ?? row.entity_id) !== String(entityId)) continue;
		const visibility = row.visibility;
		const tag =
			typeof visibility === "object" && visibility !== null && "tag" in visibility
				? String((visibility as { tag: unknown }).tag)
				: String(visibility);
		if (tag === "Hidden") return true;
	}
	return false;
}

export function visibleCapabilityCount(db: SnapshotDb, entityId: bigint): number {
	return capabilitiesFor(db, entityId).length;
}

export function hasCapabilitySource(
	db: SnapshotDb,
	entityId: bigint,
	capabilityId: string,
	source: string,
): boolean {
	return capabilitiesFor(db, entityId).some(
		(row) => row.capabilityId === capabilityId && row.source.includes(source),
	);
}

export function actionDefinition(db: SnapshotDb, actionId: string): ActionDefinitionRow | null {
	const handle = table(db, "actionDefinition", "action_definition");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.actionId ?? row.action_id) !== actionId) continue;
		return {
			actionId,
			requiredCapability: String(row.requiredCapability ?? row.required_capability),
			onSuccess: String(row.onSuccess ?? row.on_success),
			selfEligible: Boolean(row.selfEligible ?? row.self_eligible),
		};
	}
	return null;
}

export function consequenceFrameWriteJsons(db: SnapshotDb, templateId: string): string[] {
	const handle = table(db, "consequenceTemplateFrameWrite", "consequence_template_frame_write");
	const rows: string[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.templateId ?? row.template_id) === templateId) {
			rows.push(String(row.frameWriteJson ?? row.frame_write_json));
		}
	}
	return rows;
}

export function assertDelta(
	label: string,
	before: number,
	after: number,
	min: number,
	max: number,
): number {
	const delta = before - after;
	if (delta < min) throw new Error(`${label}: delta ${delta} < floor ${min}`);
	if (delta > max) throw new Error(`${label}: delta ${delta} > max ${max}`);
	return delta;
}

// `waitForHpChange()` stays behind in the shim alongside `hp()` (it polls via
// `hp()`, so it travels with it) — reimplemented there against this module's
// exported `waitFor`.

function isolatedWorldModel(slug: string, options: IsolatedWorldOptions) {
	const normalized = normalizeSlug(slug);
	const bundleId = options.bundleId ?? `test_isolated_world_${normalized}`;
	const rootId = `test-isolated-world-${normalized}`;
	const blueprintGraphId = `${rootId}-blueprint`;
	const instanceId = `${rootId}-instance`;
	const blueprintNodeId = `${blueprintGraphId}/cell`;
	const instanced = options.instanced ?? false;
	// A tiny self-authored anchor graph the instance welds onto (#1968: core ships
	// no place nodes of its own, so an instanced isolated world can no longer
	// borrow a village node — mirrors spatial_phase5.ts's own `hb_anchor` graph).
	const anchorGraphId = `${rootId}-anchor`;
	const anchorNodeId = `${anchorGraphId}/root`;
	const instanceNodeId = instanced ? `${instanceId}/cell` : blueprintNodeId;
	const blueprintNodeBId = `${blueprintGraphId}/cell_b`;
	const blueprintEdgeKey = `${blueprintGraphId}/edge/cell-cell_b`;
	const blueprintReverseEdgeKey = `${blueprintGraphId}/edge/cell_b-cell`;
	const instanceNodeBId = instanced ? `${instanceId}/cell_b` : blueprintNodeBId;
	const instanceEdgeKey = instanced ? `${instanceId}/edge/cell-cell_b` : blueprintEdgeKey;
	const instanceReverseEdgeKey = instanced
		? `${instanceId}/edge/cell_b-cell`
		: blueprintReverseEdgeKey;
	const posX = 10_000 + stableSlugOffset(normalized);
	const casterDefId = options.casterDefId ?? `${rootId}/caster-def`;
	const dummyDefId = options.dummyDefId ?? `${rootId}/dummy-def`;
	const dummyOnSecondCell = options.dummyOnSecondCell ?? false;
	// The dummy authoring/resolve node: `cell_b` when on the second cell, else
	// co-located with the caster. (Monster cases are non-instanced, so blueprint
	// and instance nodes coincide; the resolve node mirrors the authoring node.)
	const dummyNodeId = dummyOnSecondCell ? blueprintNodeBId : blueprintNodeId;
	const dummyResolveNodeId = dummyOnSecondCell ? instanceNodeBId : instanceNodeId;
	// `cell_b` must exist either for a movement portal OR to host a second-cell dummy.
	const needSecondCell = (options.includePortal ?? false) || dummyOnSecondCell;
	return {
		slug: normalized,
		bundleId,
		rootId,
		blueprintGraphId,
		instanceId,
		instanced,
		anchorGraphId,
		anchorNodeId,
		blueprintNodeId,
		blueprintNodeBId,
		posX,
		blueprintEdgeKey,
		blueprintReverseEdgeKey,
		instanceNodeId,
		instanceNodeBId,
		instanceEdgeKey,
		instanceReverseEdgeKey,
		dummyOnSecondCell,
		dummyNodeId,
		dummyResolveNodeId,
		needSecondCell,
		graphScale: options.graphScale,
		casterDefId,
		dummyDefId,
		supportDefId: `${rootId}/support-def`,
		casterKey: `${rootId}/caster`,
		dummyKey: `${rootId}/dummy`,
		supportKey: `${rootId}/support`,
		includePortal: options.includePortal ?? false,
		includeSupport:
			(options.includeSupport ?? false) || (options.supportCapabilityIds?.length ?? 0) > 0,
		// The retired core/apply_consequence token has no authored definition or consumer.
		// Callers supply the actual declared vocabulary their scene exercises.
		capabilityIds: options.capabilityIds ?? [],
		supportCapabilityIds: options.supportCapabilityIds ?? [],
		bundleDeps: options.bundleDeps ?? ["core"],
		dummyHp: options.dummyHp,
		defineCaster: options.casterDefId === undefined,
		defineDummy: options.dummyDefId === undefined,
		extraSpatialNicheIds: options.extraSpatialNicheIds ?? [],
		casterObjectStateSeeds: options.casterObjectStateSeeds ?? [],
		casterEquipment: options.casterEquipment ?? [],
	};
}

function renderIsolatedWorldManifest(
	models: readonly ReturnType<typeof isolatedWorldModel>[],
): string {
	return `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[metadata]
profile = "spellkave-srd-runner-isolated-worlds"

${renderIsolatedWorldBundleRows(models)}
${models.map(renderIsolatedWorldManifestBody).join("\n")}`;
}

function renderIsolatedWorldBundleRows(
	models: readonly ReturnType<typeof isolatedWorldModel>[],
): string {
	const bundleDeps = new Map<string, Set<string>>();
	for (const model of models) {
		const deps = bundleDeps.get(model.bundleId) ?? new Set<string>();
		for (const dep of model.bundleDeps) deps.add(dep);
		bundleDeps.set(model.bundleId, deps);
	}
	return Array.from(bundleDeps.entries())
		.map(
			([bundleId, deps]) => `[[bundles]]
bundle_id = "${bundleId}"
display_name = "Isolated World ${bundleId}"
author = "spellkave-test"
version = "0.0.0"
description = "Ephemeral isolated-world helper fixture."
depends_on = [${Array.from(deps)
				.sort()
				.map((dep) => `"${dep}"`)
				.join(", ")}]`,
		)
		.join("\n\n");
}

// KNOWN RESIDUAL SRD LITERAL (flagged, not silently introduced — see slice 4's
// landing report; still unresolved after #1968 slice 5's pure relocation):
// this manifest renderer is otherwise fully generic, but the
// `"srd/spell/darkness"` capability check below (and the matching
// `"srd/dark_focus"` niche further down) is a bundle-specific convention baked
// into `isolatedWorlds`' private internals. `zones.ts` (now at
// `packages/spellkave-srd/src/test/live-preseeded/zones.ts`) calls
// `isolatedWorld`/`isolatedWorlds` unchanged and relies on this exact branch,
// so extracting it cleanly would require adding an explicit override option
// and updating that call site — out of scope for slice 4's additive,
// mechanical-move mandate, and out of scope for slice 5's pure relocation too
// (D-7 mechanism conversion, not this literal, is slice 6b). Tracked as
// follow-up cleanup, not resolved here.
function renderIsolatedWorldManifestBody(model: ReturnType<typeof isolatedWorldModel>): string {
	const capabilities = [...model.capabilityIds, ...model.supportCapabilityIds];
	const edgeAffordanceTemplate = capabilities.includes("srd/spell/darkness")
		? "srd/affordance/traverse_darkness_gate"
		: "core/affordance/traverse_open_portal";
	return `[[place_graphs]]
place_graph_id = "${model.blueprintGraphId}"
bundle_id = "${model.bundleId}"
substrate_id = "outdoor"
display_name = "Isolated Blueprint ${model.slug}"
anchor_node_id = "${model.blueprintNodeId}"
${model.graphScale === undefined ? "" : `metres_per_unit = ${model.graphScale}`}

${placeNode(model.blueprintNodeId, model.bundleId, model.blueprintGraphId, "cell", model.posX)}
${model.needSecondCell ? placeNode(model.blueprintNodeBId, model.bundleId, model.blueprintGraphId, "cell_b", model.posX + 1) : ""}
${model.includePortal ? placeEdge(model.blueprintEdgeKey, model.bundleId, model.blueprintGraphId, model.blueprintNodeId, model.blueprintNodeBId) : ""}
${model.includePortal ? placeEdge(model.blueprintReverseEdgeKey, model.bundleId, model.blueprintGraphId, model.blueprintNodeBId, model.blueprintNodeId) : ""}

${model.includePortal ? edgeAffordance(model.blueprintEdgeKey, edgeAffordanceTemplate) : ""}
${model.includePortal ? edgeAffordance(model.blueprintReverseEdgeKey, edgeAffordanceTemplate) : ""}
${model.includePortal && model.instanced ? edgeAffordance(model.instanceEdgeKey, edgeAffordanceTemplate) : ""}
${model.includePortal && model.instanced ? edgeAffordance(model.instanceReverseEdgeKey, edgeAffordanceTemplate) : ""}

${model.defineCaster ? entityDefinition(model.casterDefId, model.bundleId, "Isolated Caster") : ""}
${model.defineDummy ? entityDefinition(model.dummyDefId, model.bundleId, "Isolated Dummy") : ""}
${model.includeSupport ? entityDefinition(model.supportDefId, model.bundleId, "Isolated Support") : ""}

${entity(model.casterKey, model.bundleId, model.casterDefId, `Isolated Caster ${model.slug}`, model.blueprintNodeId)}
${entity(model.dummyKey, model.bundleId, model.dummyDefId, `Isolated Dummy ${model.slug}`, model.dummyNodeId)}
${model.casterEquipment
	.map((item, ordinal) => {
		const key = `${model.casterKey}/equipment/${ordinal}`;
		return `[[entities]]
entity_key = "${key}"
entity_def_id = "${item.entityDefId}"
bundle_id = "${model.bundleId}"
name = "Isolated equipment ${ordinal}"
kind = "item"
place_node_id = "${model.blueprintNodeId}"
owned_by_entity_key = "${model.casterKey}"

[[entity_containment]]
entity_key = "${key}"
container_entity_key = "${model.casterKey}"

[[actor_equipment_slots]]
actor_entity_key = "${model.casterKey}"
slot_id = "${item.slotId}"
item_key = "${key}"

${(item.stateSeeds ?? [])
	.map(
		(seed) => `[[object_state]]
entity_key = "${key}"
bundle_id = "${model.bundleId}"
state_id = "${seed.stateId}"
value_int = ${seed.valueInt}
source_template_id = "${model.bundleId}"
`,
	)
	.join("\n")}`;
	})
	.join("\n")}
${model.includeSupport ? entity(model.supportKey, model.bundleId, model.supportDefId, `Isolated Support ${model.slug}`, model.blueprintNodeId) : ""}

${actor(model.casterKey, model.bundleId, `Isolated Caster Actor ${model.slug}`)}
${actor(model.dummyKey, model.bundleId, `Isolated Dummy Actor ${model.slug}`)}
${model.includeSupport ? actor(model.supportKey, model.bundleId, `Isolated Support Actor ${model.slug}`) : ""}

${actorIdentity(model.casterKey, model.bundleId)}
${model.includeSupport ? actorIdentity(model.supportKey, model.bundleId) : ""}

${actorLocation(model.casterKey, model.blueprintNodeId, model.bundleId)}
${actorLocation(model.dummyKey, model.dummyNodeId, model.bundleId)}
${model.includeSupport ? actorLocation(model.supportKey, model.blueprintNodeId, model.bundleId) : ""}

${actorCapabilities(model.casterKey, model.capabilityIds, model.bundleId)}
${model.includeSupport ? actorCapabilities(model.supportKey, model.supportCapabilityIds, model.bundleId) : ""}
${objectState(model)}
${casterInitialState(model)}

${niche(model.bundleId, model.blueprintNodeId, "core/consequence_application")}
${capabilities
	.filter((capabilityId) => capabilityId !== "core/apply_consequence")
	.map((capabilityId) => niche(model.bundleId, model.blueprintNodeId, `capability:${capabilityId}`))
	.join("\n")}
${capabilities.includes("srd/spell/darkness") ? niche(model.bundleId, model.blueprintNodeId, "srd/dark_focus") : ""}
${model.extraSpatialNicheIds.map((nicheId) => niche(model.bundleId, model.blueprintNodeId, nicheId)).join("\n")}
${
	model.dummyNodeId === model.blueprintNodeId
		? ""
		: capabilities
				.filter((capabilityId) => capabilityId !== "core/apply_consequence")
				.map((capabilityId) =>
					niche(model.bundleId, model.dummyNodeId, `capability:${capabilityId}`),
				)
				.join("\n")
}

${
	model.instanced
		? `[[place_graphs]]
place_graph_id = "${model.anchorGraphId}"
bundle_id = "${model.bundleId}"
substrate_id = "outdoor"
display_name = "Isolated Anchor ${model.slug}"
anchor_node_id = "${model.anchorNodeId}"

${placeNode(model.anchorNodeId, model.bundleId, model.anchorGraphId, "root", model.posX)}

[[place_graph_instances]]
blueprint_id = "${model.blueprintGraphId}"
instance_id = "${model.instanceId}"
anchor = { kind = "place_node", id = "${model.anchorNodeId}" }
`
		: ""
}`;
}

function placeNode(
	id: string,
	bundleId: string,
	graphId: string,
	localId: string,
	x: number,
): string {
	return `[[place_nodes]]
node_id = "${id}"
bundle_id = "${bundleId}"
place_graph_id = "${graphId}"
local_id = "${localId}"
substrate_id = "outdoor"
display_name = "Isolated Cell"
pos_x = ${x}
pos_y = 0
pos_present = true
pose_elevation = 0.0
pose_elevation_present = true
extent_shape_id = "core/area/cube"
extent_params_json = '{"extent_m": 0.5}'`;
}

function placeEdge(
	key: string,
	bundleId: string,
	graphId: string,
	from: string,
	to: string,
): string {
	return `[[place_edges]]
edge_key = "${key}"
bundle_id = "${bundleId}"
place_graph_id = "${graphId}"
from_node_id = "${from}"
to_node_id = "${to}"`;
}

function edgeAffordance(edgeKey: string, template: string): string {
	return `[[place_edge_affordance]]
edge_key = "${edgeKey}"
affordance_template_id = "${template}"`;
}

function entityDefinition(entityDefId: string, bundleId: string, displayName: string): string {
	return `[[entity_definitions]]
entity_def_id = "${entityDefId}"
bundle_id = "${bundleId}"
display_name = "${displayName}"`;
}

function entity(
	key: string,
	bundleId: string,
	defId: string,
	name: string,
	nodeId: string,
): string {
	return `[[entities]]
entity_key = "${key}"
bundle_id = "${bundleId}"
entity_def_id = "${defId}"
name = "${name}"
kind = "npc"
place_node_id = "${nodeId}"`;
}

function actor(entityKey: string, bundleId: string, name: string): string {
	return `[[actors]]
entity_key = "${entityKey}"
bundle_id = "${bundleId}"
name = "${name}"`;
}

function actorIdentity(entityKey: string, bundleId: string): string {
	return `[[actor_identities]]
entity_key = "${entityKey}"
bundle_id = "${bundleId}"
identity = "$sender"
role = "primary"`;
}

function actorLocation(entityKey: string, nodeId: string, bundleId: string): string {
	return `[[actor_spatial_locations]]
entity_key = "${entityKey}"
place_node_id = "${nodeId}"
bundle_id = "${bundleId}"
selection_path = "manifest:${entityKey}"`;
}

function actorCapabilities(
	entityKey: string,
	capabilityIds: readonly string[],
	bundleId: string,
): string {
	return capabilityIds
		.map(
			(capabilityId) => `[[actor_capabilities]]
actor_entity_key = "${entityKey}"
capability_id = "${capabilityId}"
source = "${bundleId}"
bundle_id = "${bundleId}"`,
		)
		.join("\n");
}

// REP-CP4B: instance-level seed on the ISOLATED caster's own entity_key
// (`model.casterKey`, not the canonical `srd/regdar`, which this world never
// places). Mirrors `objectState()` below (the dummy's HP seed) rather than
// `entity_definition_initial_state`: a definition-level seed's `state_id` ref
// is checked bundle-locally at admission (MF-VAL-253) and fatally rejects a
// cross-bundle reference into `srd`'s vocabulary from this ephemeral test
// bundle, exactly like the proven-working dummy HP seed below sidesteps it.
function casterInitialState(model: ReturnType<typeof isolatedWorldModel>): string {
	return model.casterObjectStateSeeds
		.map(
			(seed) => `[[object_state]]
bundle_id = "${model.bundleId}"
entity_key = "${model.casterKey}"
source_template_id = "${model.casterKey}"
state_id = "${seed.stateId}"
value_bool = true
value_int = ${seed.valueInt}
visibility = "Public"`,
		)
		.join("\n");
}

// KNOWN RESIDUAL SRD LITERAL (flagged — see slice 4's landing report): the
// `IsolatedWorldOptions.dummyHp` convenience seeds the dummy's HP under the
// `"srd/hp"` state id specifically. Same rationale as the darkness-gate
// comment above: this is `isolatedWorlds`' private internals, relied on
// unchanged by every SRD test file that passes `dummyHp`, so extracting it
// cleanly needs an explicit stateId override option — out of scope here.
function objectState(model: ReturnType<typeof isolatedWorldModel>): string {
	if (model.dummyHp === undefined || model.dummyHp === null) return "";
	return `[[object_state]]
bundle_id = "${model.bundleId}"
entity_key = "${model.dummyKey}"
source_template_id = "${model.dummyKey}"
state_id = "srd/hp"
value_bool = true
value_int = ${model.dummyHp}
visibility = "Public"`;
}

function niche(bundleId: string, nodeId: string, nicheId: string): string {
	return `[[spatial_niche_attachments]]
bundle_id = "${bundleId}"
place_node_id = "${nodeId}"
niche_id = "${nicheId}"`;
}

function entityAtNode(db: SnapshotDb, entityDefId: string, placeNodeId: string): bigint | null {
	const entities = table(db, "entity");
	const locations = table(db, "visibleEntityLocation", "visible_entity_location");
	if (!entities || !locations) return null;
	const atNode = new Set<string>();
	for (const raw of locations.iter()) {
		const row = raw as Record<string, unknown>;
		if (String(row.placeNodeId ?? row.place_node_id) === placeNodeId) {
			atNode.add(String(row.entityId ?? row.entity_id));
		}
	}
	for (const raw of entities.iter()) {
		const row = raw as Record<string, unknown>;
		const id = String(row.entityId ?? row.entity_id);
		if (String(row.entityDefId ?? row.entity_def_id) === entityDefId && atNode.has(id)) {
			return BigInt(id);
		}
	}
	return null;
}

function requireActorForBody(db: SnapshotDb, bodyId: bigint): bigint {
	const actors = table(db, "actor");
	for (const raw of actors?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.currentBody ?? row.current_body) === String(bodyId)) {
			return BigInt(String(row.actorId ?? row.actor_id));
		}
	}
	throw new Error(`could not resolve actor for body ${bodyId}`);
}

// Self-scoped (see `actorIdentityRoles` above): checks the connecting
// client's own post-claim binding.
function actorIdentityCount(db: SnapshotDb, actorId: bigint): number {
	const identities = table(db, "visibleActorIdentity", "visible_actor_identity");
	let count = 0;
	for (const raw of identities?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.actorId ?? row.actor_id) === String(actorId)) count += 1;
	}
	return count;
}

function table(db: SnapshotDb, ...names: string[]): { iter(): Iterable<unknown> } | undefined {
	const record = db as unknown as Record<string, unknown>;
	for (const name of names) {
		const handle = record[name];
		if (handle && typeof handle === "object" && "iter" in handle) {
			return handle as { iter(): Iterable<unknown> };
		}
	}
	return undefined;
}

function autonomyJobs(db: SnapshotDb, jobIdIncludes: string): Record<string, unknown>[] {
	const handle = table(db, "visibleAutonomyJob", "visible_autonomy_job");
	return Array.from(handle?.iter() ?? [])
		.map((row) => row as Record<string, unknown>)
		.filter((row) => String(row.jobId ?? row.job_id).includes(jobIdIncludes));
}

function dslValueMatches(
	value: unknown,
	expected: { tag: "Int" } | { tag: "Bool"; value: boolean },
): boolean {
	if (typeof value !== "object" || value === null || !("tag" in value)) return false;
	const tagged = value as { tag: string; value?: unknown };
	if (tagged.tag !== expected.tag) return false;
	if (expected.tag === "Int") return true;
	return Boolean(tagged.value) === expected.value;
}

function optionalString(value: unknown): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value === "string") return value.length > 0 ? value : null;
	if (typeof value === "object" && value !== null && "tag" in value) {
		const tagged = value as { tag?: string; value?: unknown };
		if (tagged.tag === "some" || tagged.tag === "Some") return optionalString(tagged.value);
		return null;
	}
	return String(value);
}

function optionalBigInt(value: unknown): bigint | null {
	if (value === undefined || value === null) return null;
	if (typeof value === "bigint") return value;
	if (typeof value === "number") return BigInt(value);
	if (typeof value === "string" && value.length > 0) return BigInt(value);
	if (typeof value === "object" && value !== null && "value" in value) {
		const inner = (value as { value?: unknown }).value;
		return inner === undefined || inner === null ? null : optionalBigInt(inner);
	}
	return null;
}

function readManifestWithIncludes(root: string): string {
	const manifestPath = existsSync(path.join(root, "manifest.toml"))
		? path.join(root, "manifest.toml")
		: root;
	const source = readFileSync(manifestPath, "utf8");
	const dir = path.dirname(manifestPath);
	const fragments = Array.from(
		source.matchAll(/^\[\[include\]\]\s*\npath\s*=\s*"([^"]+)"/gm),
		(match) => readFileSync(path.resolve(dir, match[1] ?? ""), "utf8"),
	);
	// Match client/src/cli/manifest.rs exactly: root gets one appended newline;
	// every included source gets one inside its recursive load and one more
	// from its caller. This keeps CLI-seeded fixtures idempotent in live tests.
	return `${source}\n${fragments.map((fragment) => `${fragment}\n\n`).join("")}`;
}

export interface ApplyManifestOptions {
	/// Tolerate `MF-APPLY-012` ("manifest already applied" — the server's
	/// digest check rejected this exact byte-identical TOML because it is
	/// already sealed) as a no-op success instead of throwing. Off by default,
	/// so every existing caller keeps fail-loud semantics; a live-self-seeding
	/// test whose bundle id is stable per file (not re-randomized per run)
	/// legitimately re-hits its own already-committed digest on a re-run
	/// against a node that was never wiped in between — ADR-0085 upsert
	/// idempotency is the guarantee that makes swallowing this safe. See
	/// `ensureApplyManifestAuthority`, which always sets this. Forwarded to
	/// the production primitive (`enqueueAndWaitManifestApply`).
	tolerateAlreadyApplied?: boolean;
	/// Folded into the thrown error message if the drain does not seal in
	/// time, so a timeout across many sequential live-self-seeding test files
	/// (`test:live-self-seeding` runs one node per suite) names which call hung.
	label?: string;
}

/// Re-export of the production predicate. Kept on this module so existing
/// test-lab imports (`live.manifest-apply.test.ts`) stay stable.
export { isManifestAlreadyApplied } from "@spellkave/sdk";

/// Test-only process-wide lane. Not moved into `manifest-apply.ts` (ADR-0103
/// D-2: production serialization is per caller-owned lane).
const manifestApplyLane = createManifestApplyLane();

async function runManifestApply(
	world: TestWorld,
	apply: () => Promise<void>,
	options: ApplyManifestOptions,
): Promise<{ ok: true; alreadyApplied?: true; digest?: string }> {
	return manifestApplyLane.run(async () => {
		await synchronizeManifestSnapshot(world);
		const result = await enqueueAndWaitManifestApply({
			digestHandle: table(world.db(), "manifestApplyDigest", "manifest_apply_digest"),
			outcomeHandle: table(world.db(), "manifestApplyOutcome", "manifest_apply_outcome"),
			enqueue: apply,
			label: options.label,
			onUpdate: (notify) => {
				const handles = [world.conn.db.manifestApplyDigest, world.conn.db.manifestApplyOutcome];
				const inserted = () => notify();
				for (const handle of handles) handle.onInsert(inserted);
				return () => {
					for (const handle of handles) handle.removeOnInsert(inserted);
				};
			},
			tolerateAlreadyApplied: options.tolerateAlreadyApplied,
		});
		if (!result.ok) {
			throw new ManifestApplyError(result);
		}
		return result;
	});
}

/** A subscription acknowledgement fences prior commits on this connection's cache.
 * Keep this inside the lane: another connection may still be receiving the
 * previous caller's seal after that caller has already completed. */
async function synchronizeManifestSnapshot(world: TestWorld): Promise<void> {
	const ready = promiseWithResolvers<void>();
	const watchdog = setTimeout(
		() => ready.reject(new Error("Manifest snapshot subscription did not complete")),
		DEFAULT_CONNECT_TIMEOUT_MS,
	);
	let subscription: LiveSubscription | undefined;
	try {
		subscription = subscribeTableSnapshot(
			world.conn,
			["manifest_apply_digest", "manifest_apply_outcome"],
			() => ready.resolve(),
			(ctx) =>
				ready.reject(
					new Error("Manifest snapshot subscription failed", { cause: ctx.event ?? ctx }),
				),
		);
		await ready.promise;
	} finally {
		clearTimeout(watchdog);
		if (subscription !== undefined && !subscription.isEnded()) subscription.unsubscribe();
	}
}

export interface ManifestProbeReceipt {
	/** Exact submitted bytes, including expanded includes when supplied by the caller. */
	toml: string;
	submittedSha256: string;
	/** Server seal after sender substitution; absent when a tolerated reapply emits no seal. */
	digest: string | null;
	alreadyApplied: boolean;
}

/** Capture a confirmed admission through the existing apply lane and observer. */
export async function applyManifestSourceWithReceipt(
	world: TestWorld,
	toml: string,
	options: ApplyManifestOptions = {},
): Promise<ManifestProbeReceipt> {
	const submittedSha256 = createHash("sha256").update(toml, "utf8").digest("hex");
	const result = await runManifestApply(
		world,
		() => world.conn.reducers.rApplyWorldManifest({ toml }),
		options,
	);
	// The server resolves $sender and re-renders before sealing. Never infer
	// that seal from source bytes or reproduce the server's authoring transform.
	return {
		toml,
		submittedSha256,
		digest: result.digest ?? null,
		alreadyApplied: result.alreadyApplied === true,
	};
}

/// Whole-bundle apply. Thin throwing wrapper over the production primitive
/// (ADR-0103 D-2); see `runManifestApply`.
export async function applyManifestSource(
	world: TestWorld,
	toml: string,
	options: ApplyManifestOptions = {},
): Promise<void> {
	await runManifestApply(world, () => world.conn.reducers.rApplyWorldManifest({ toml }), options);
}

/** Whole-world fixture setup uses the task-owned publisher explicitly.
 * The fixture's sender macros keep the receiving test principal. Consumer admission
 * tests use applyManifestSource/applyManifestSourceWithReceipt with their own token;
 * those wrappers never elevate credentials and scoped presences receive MF-APPLY-044.
 */
export async function applyWorldManifestAsPublisherWithReceipt(
	world: TestWorld,
	toml: string,
	options: ApplyManifestOptions = {},
): Promise<ManifestProbeReceipt> {
	const token = resolveSpacetimeConfigPathToken();
	if (!token || !world.identity)
		throw new Error(
			"publisher fixture setup requires the task-owned credential and receiving principal",
		);
	const publisher = world.token === token ? world : await connectTestWorld({ token });
	try {
		return await applyManifestSourceWithReceipt(
			publisher,
			publisher === world ? toml : toml.replaceAll("$sender", world.identity),
			options,
		);
	} finally {
		if (publisher !== world) publisher.disconnect();
	}
}

export async function applyWorldManifestAsPublisher(
	world: TestWorld,
	toml: string,
	options: ApplyManifestOptions = {},
): Promise<void> {
	await applyWorldManifestAsPublisherWithReceipt(world, toml, options);
}

/// `r_apply_manifest_delta`'s upsert counterpart to `applyManifestSource`
/// (ADR-0085): submits `toml` as one delta rather than a whole-bundle
/// clear-then-insert. Thin throwing wrapper over the production primitive in
/// `manifest-apply.ts` (ADR-0103 D-2). Promoted from three near-identical
/// per-package copies (`packages/spellkave-srd`, `packages/spellkave-phandelver`,
/// `packages/spellkave-srd-cc` — ledger finding #15,
/// `packages/spellkave-srd-cc/ledger/findings.md`); each package's own
/// `src/test/live-self-seeding/live-self-seeding.ts` now delegates here instead of
/// re-deriving the drain-wait/tolerance plumbing.
export async function applyManifestDelta(
	world: TestWorld,
	toml: string,
	options: ApplyManifestOptions = {},
): Promise<void> {
	await runManifestApply(world, () => world.conn.reducers.rApplyManifestDelta({ toml }), options);
}

/** Ensure the test caller has authored apply and pace authority.
 * The publisher credential is mandatory in both CLI-as-owner modes. Never
 * submit authority bindings using an ordinary shared test identity.
 * `publisherToken` overrides the filesystem credential (a leased DB owner
 * token has no `SPACETIME_CONFIG_PATH`); scenes pass their own owner token.
 */
export async function ensureWorldAuthority(
	world: TestWorld,
	options: { publisherToken?: string; manifestPath?: string } = {},
): Promise<void> {
	const token = options.publisherToken ?? resolveSpacetimeConfigPathToken();
	if (!token) throw new Error("ensureWorldAuthority: local publisher credential unavailable");
	if (!world.identity)
		throw new Error("ensureWorldAuthority: authenticated test identity unavailable");
	const manifestPath = options.manifestPath ?? process.env.SPELLKAVE_TEST_AUTHORITY_MANIFEST;
	if (!manifestPath) {
		throw new Error("ensureWorldAuthority: set SPELLKAVE_TEST_AUTHORITY_MANIFEST to the test world's setup manifest");
	}
	const source = readFixtureSource(manifestPath).replaceAll("$sender", world.identity);
	const publisher = world.token === token ? world : await connectTestWorld({ token });
	try {
		await applyManifestDelta(publisher, source, { tolerateAlreadyApplied: true });
	} finally {
		if (publisher !== world) publisher.disconnect();
	}
}

/** Compatibility alias for existing fixture setup callers. */
export const ensureApplyManifestAuthority = ensureWorldAuthority;

async function subscribeMissingTables(
	conn: DbConnection,
	activeTables: Set<string>,
	manifests: readonly ReaderManifest[],
): Promise<void> {
	const requested = new Set<string>();
	for (const manifest of manifests) {
		for (const table of manifest.requiredTables) requested.add(table);
	}
	const filtered = [...requested].filter((t) =>
		(FILTERED_SUBSCRIPTION_TABLES as readonly string[]).includes(t),
	);
	if (filtered.length > 0) {
		throw new Error(
			`subscribeReaders: table(s) ${filtered.join(", ")} are per-identity server-filtered ` +
				"(FILTERED_SUBSCRIPTION_TABLES) — hand-subscribing them bypasses the visible_* " +
				"per-caller view; declare the visible_* table in the reader manifest instead.",
		);
	}
	const missing = [...requested].filter((t) => !activeTables.has(t));
	if (missing.length === 0) return;
	const ready = promiseWithResolvers<void>();
	subscribeTableSnapshot(
		conn,
		missing,
		() => ready.resolve(),
		(ctx) => ready.reject(new Error(String(ctx))),
	);
	await ready.promise;
	for (const table of missing) activeTables.add(table);
}

/** Handle returned by `subscribe()`. Named structurally so `--include-private`
 * `DbConnection` does not instantiate `SubscriptionHandleImpl` (TS2589). */
type LiveSubscription = {
	isEnded(): boolean;
	unsubscribe(): void;
};

/** Same builder chain `subscribeManifestApplyWait` takes, without `DbConnection`. */
type LiveSubscribeChain = {
	onApplied(cb: (ctx: SubscriptionEventContext) => void): LiveSubscribeChain;
	onError(cb: (ctx: ErrorContext) => void): LiveSubscribeChain;
	subscribe(queries: string[]): LiveSubscription;
};

/** Shared construction for reader top-ups and acknowledged apply-bookkeeping snapshots. */
function subscribeTableSnapshot(
	conn: DbConnection,
	tables: readonly string[],
	onApplied: (ctx: SubscriptionEventContext) => void,
	onError: (ctx: ErrorContext) => void,
): LiveSubscription {
	const adapter = conn as unknown as { subscriptionBuilder(): LiveSubscribeChain };
	return (
		adapter
			.subscriptionBuilder()
			.onApplied(onApplied)
			.onError(onError)
			// ci-allow(raw-sql): canonical test-lab derivation for reader top-ups and apply-bookkeeping snapshots
			.subscribe(tables.map((table) => `SELECT * FROM ${table}`))
	);
}

function findRepoPath(relativePath: string): string {
	const candidates = [
		path.resolve(process.cwd(), relativePath),
		path.resolve(process.cwd(), "../..", relativePath),
	];
	const found = candidates.find(existsSync);
	if (found === undefined) throw new Error(`could not find ${relativePath} from ${process.cwd()}`);
	return found;
}

function normalizeSlug(slug: string): string {
	const normalized = slug.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^[-_]+|[-_]+$/g, "");
	if (normalized.length === 0) throw new Error("isolatedWorld slug must not be empty");
	return normalized;
}

function stableSlugOffset(slug: string): number {
	let hash = 0;
	for (const char of slug) {
		hash = (hash * 31 + char.charCodeAt(0)) % 1_000_000;
	}
	return hash * 10;
}

function srdRunnerTimings(): (label: string, started: number) => number {
	if (process.env.SPELLKAVE_SRD_RUNNER_TIMINGS !== "1") {
		return (_label: string, _started: number) => Date.now();
	}
	return (label: string, started: number) => {
		const now = Date.now();
		console.log(`${label}: ${now - started}ms`);
		return now;
	};
}

// An explicit opt-in ceiling for waits that must fail fast. Without it a
// subscription wait has no ceiling and vitest's testTimeout is the only
// watchdog, which reports "Test timed out" and drops the wait's own message.
// CI sets SPELLKAVE_LIVE_WAIT_TIMEOUT_MS=60000 in srd-integration.yml,
// story-re-record.yml and selected kernel-live.yml jobs/steps (grep the
// workflows for the full list), and `just srd-cc-live` defaults to the same,
// so a stalled wait names itself after 60 s (PR #3625 post-mortem, 2026-09-24).
const LIVE_WAIT_TIMEOUT_ENV = "SPELLKAVE_LIVE_WAIT_TIMEOUT_MS";
export const LIVE_WAIT_TIMEOUT_MS = (() => {
	const configured = process.env[LIVE_WAIT_TIMEOUT_ENV];
	if (configured === undefined) return undefined;
	const timeoutMs = Number(configured);
	if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
		throw new Error(`${LIVE_WAIT_TIMEOUT_ENV} must be a positive integer, got '${configured}'`);
	}
	return timeoutMs;
})();

export class WaitForTimeoutError extends Error {}

type SubscriptionTableHandle = {
	onInsert?: (callback: () => void) => void;
	removeOnInsert?: (callback: () => void) => void;
	onDelete?: (callback: () => void) => void;
	removeOnDelete?: (callback: () => void) => void;
	onUpdate?: (callback: () => void) => void;
	removeOnUpdate?: (callback: () => void) => void;
};

/**
 * Wait for a predicate over one or more connections' subscription caches.
 * Every subscribed table on every listed world is watched: generic predicates
 * cannot declare their read set, while a connection-wide watch is safe and
 * makes all callers unambiguously event-driven. One wait, one predicate: an
 * event on *any* listed world re-evaluates (same-tick split: the other cache
 * may be the only one that moves). The predicate runs before hooks attach so
 * an already-delivered row resolves immediately, then after every table event.
 */
export async function waitForEvent(
	world: TestWorld | readonly TestWorld[],
	predicate: () => boolean | Promise<boolean>,
	message: string | (() => string),
	timeoutMs: number | undefined = LIVE_WAIT_TIMEOUT_MS,
): Promise<void> {
	if (await predicate()) return;

	const worlds = Array.isArray(world) ? world : [world];
	if (worlds.length === 0) {
		throw new Error("waitForEvent requires at least one TestWorld");
	}
	const handles = worlds.flatMap((item) =>
		Object.values(item.conn.db as Record<string, SubscriptionTableHandle>).filter(
			(handle) =>
				typeof handle?.onInsert === "function" ||
				typeof handle?.onUpdate === "function" ||
				typeof handle?.onDelete === "function",
		),
	);
	if (handles.length === 0) {
		throw new Error("waitFor requires a connection with subscribed table hooks");
	}

	const { promise, resolve, reject } = promiseWithResolvers<void>();
	let settled = false;
	let evaluating = false;
	let pending = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const cleanups: (() => void)[] = [];
	const finish = (error?: unknown): void => {
		if (settled) return;
		settled = true;
		if (timeout !== undefined) clearTimeout(timeout);
		for (const cleanup of cleanups) cleanup();
		cleanups.length = 0;
		if (error === undefined) resolve();
		else reject(error);
	};
	const evaluate = (): void => {
		if (settled) return;
		if (evaluating) {
			pending = true;
			return;
		}
		evaluating = true;
		void Promise.resolve()
			.then(() => predicate())
			.then(
				(matches) => {
					evaluating = false;
					if (matches) finish();
					else if (pending) {
						pending = false;
						evaluate();
					}
				},
				(error: unknown) => {
					evaluating = false;
					finish(error);
				},
			);
	};
	const seenHandles = new Set<SubscriptionTableHandle>();
	try {
		for (const handle of handles) {
			if (seenHandles.has(handle)) continue;
			seenHandles.add(handle);
			for (const [on, remove] of [
				[handle.onInsert, handle.removeOnInsert],
				[handle.onUpdate, handle.removeOnUpdate],
				[handle.onDelete, handle.removeOnDelete],
			]) {
				if (on === undefined) continue;
				cleanups.push(() => remove?.call(handle, evaluate));
				on.call(handle, evaluate);
			}
		}
	} catch (error) {
		finish(error);
		return promise;
	}
	if (timeoutMs !== undefined) {
		timeout = setTimeout(() => {
			const detail = typeof message === "function" ? message() : message;
			finish(
				new WaitForTimeoutError(
					`${detail} (timed out after ${timeoutMs}ms; ceiling ${timeoutMs}ms)`,
				),
			);
		}, timeoutMs);
	}
	// Covers an event that lands between the required first evaluation and hook installation.
	evaluate();
	return promise;
}

/** Polling is intentionally named at every call site; do not use it for a
 * subscription-cache wait. */
export async function waitFor(
	predicate: () => boolean | Promise<boolean>,
	message: string | (() => string),
	timeoutMs: number = LIVE_WAIT_TIMEOUT_MS ?? 40_000,
): Promise<void> {
	const started = Date.now();
	const deadline = started + timeoutMs;
	while (Date.now() < deadline) {
		if (await predicate()) return;
		await settle(40);
	}
	const detail = typeof message === "function" ? message() : message;
	throw new WaitForTimeoutError(
		`${detail} (timed out after ${Date.now() - started}ms; ceiling ${timeoutMs}ms)`,
	);
}

/** Live clients subscribe `visible_session` / `visible_session_participant`
 * (raw `session` is private, ADR-0057 / sk-2qt). Unit fixtures may still
 * inject the pre-privacy names — prefer the first populated handle. */
export function iterVisibleSessionRows<T>(db: {
	visible_session?: { iter(): Iterable<T> };
	session?: { iter(): Iterable<T> };
}): T[] {
	return Array.from((db.visible_session ?? db.session)?.iter() ?? []);
}

export function iterVisibleSessionParticipantRows<T>(db: {
	visible_session_participant?: { iter(): Iterable<T> };
	session_participant?: { iter(): Iterable<T> };
}): T[] {
	return Array.from((db.visible_session_participant ?? db.session_participant)?.iter() ?? []);
}

/** Wait until THIS connection's snapshot lists `actorEntityId` as a
 * participant of `sessionId`.
 *
 * Same cross-connection subscription-ordering class as combat-arena
 * `session-open.ts` Step 3 / Finding #72: `r_session_open` on another
 * connection lands the rows on the server immediately, but a claim
 * connection's cache can still be empty for a beat. Perceive + `wait` is
 * cache-only, so a tight stepped loop can burn its whole budget before the
 * insert arrives (sk-awlo.5). Do not skip this wait and do not substitute a
 * reducer round-trip — measured 2026-08-28, the rows appear on their own
 * (~50ms) once the event loop is allowed to flush websocket inserts. */
export async function waitForSessionParticipation(
	world: TestWorld,
	sessionId: bigint,
	actorEntityId: bigint | string,
	message = "connection did not observe session_participant for the opened session",
	timeoutMs = 5_000,
): Promise<void> {
	const wantedActor = String(actorEntityId);
	const wantedSession = String(sessionId);
	await waitFor(
		() => {
			const rows = iterVisibleSessionParticipantRows<{
				sessionId?: unknown;
				actorId?: unknown;
			}>(world.db());
			return rows.some(
				(row) => String(row.sessionId) === wantedSession && String(row.actorId) === wantedActor,
			);
		},
		message,
		timeoutMs,
	);
}

function settle(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function promiseWithResolvers<T>(): {
	promise: Promise<T>;
	resolve: (value: T | PromiseLike<T>) => void;
	reject: (reason?: unknown) => void;
} {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolveFn, rejectFn) => {
		resolve = resolveFn;
		reject = rejectFn;
	});
	return { promise, resolve, reject };
}

export interface VisibleModifierRow {
	modifierId: string;
	affectsWhat: string;
	affectsWhatTargetId: string;
	deltaKind: string;
	deltaValueI64: number;
	deltaValueStr: string;
	hasExpiry: boolean;
}

export function visibleModifier(db: SnapshotDb, modifierId: string): VisibleModifierRow | null {
	const handle = table(db, "visibleModifier", "visible_modifier");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.modifierId ?? row.modifier_id) !== modifierId) continue;
		const expiry = row.expiresAtTick ?? row.expires_at_tick;
		return {
			modifierId,
			affectsWhat: String(row.affectsWhat ?? row.affects_what ?? ""),
			affectsWhatTargetId: String(row.affectsWhatTargetId ?? row.affects_what_target_id ?? ""),
			deltaKind: String(row.deltaKind ?? row.delta_kind ?? ""),
			deltaValueI64: Number(row.deltaValueI64 ?? row.delta_value_i_64 ?? 0),
			deltaValueStr: String(row.deltaValueStr ?? row.delta_value_str ?? ""),
			hasExpiry:
				expiry !== undefined &&
				expiry !== null &&
				!(
					typeof expiry === "object" &&
					expiry !== null &&
					"tag" in expiry &&
					(expiry as { tag: string }).tag.toLowerCase() === "none"
				),
		};
	}
	return null;
}

export interface EventApplyConsequenceRow {
	templateId: string;
	outcomeTag: string;
	frameWritesCount: number;
	modifiersComposedCount: number;
}

export function eventApplyConsequence(
	db: SnapshotDb,
	templateId: string,
): EventApplyConsequenceRow | null {
	// event_apply_consequence is private (ADR-0120, #915); read the
	// per-caller visible_event_apply_consequence view instead.
	const handle = table(db, "visibleEventApplyConsequence", "visible_event_apply_consequence");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.templateId ?? row.template_id) !== templateId) continue;
		const outcome = row.outcome;
		const outcomeTag =
			typeof outcome === "object" && outcome !== null && "tag" in outcome
				? String((outcome as { tag: unknown }).tag)
				: String(outcome ?? "");
		return {
			templateId,
			outcomeTag,
			frameWritesCount: Number(row.frameWritesCount ?? row.frame_writes_count ?? 0),
			modifiersComposedCount: Number(
				row.modifiersComposedCount ?? row.modifiers_composed_count ?? 0,
			),
		};
	}
	return null;
}

export interface ActorBodySwapRow {
	eventId: bigint;
	actorId: bigint;
	previousBodyEntityId: bigint;
	newBodyEntityId: bigint;
}

/// Read the `event_actor_body_swapped` detail row recorded by a `PossessBody`
/// primitive, keyed on the consequence template that applied it (#1219 / #338).
export function eventActorBodySwapped(
	db: SnapshotDb,
	consequenceTemplateId: string,
): ActorBodySwapRow | null {
	// event_actor_body_swapped is private (ADR-0120, #915); read the
	// per-caller visible_event_actor_body_swapped view instead.
	const handle = table(db, "visibleEventActorBodySwapped", "visible_event_actor_body_swapped");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.consequenceTemplateId ?? row.consequence_template_id) !== consequenceTemplateId)
			continue;
		return {
			eventId: BigInt(String(row.eventId ?? row.event_id)),
			actorId: BigInt(String(row.actorId ?? row.actor_id)),
			previousBodyEntityId: BigInt(String(row.previousBodyEntityId ?? row.previous_body_entity_id)),
			newBodyEntityId: BigInt(String(row.newBodyEntityId ?? row.new_body_entity_id)),
		};
	}
	return null;
}

/// Read a `world_event` header's `kind` discriminant as a flat dotted tag, e.g.
/// `Layer2:ApplyConsequence`, so a nested `EventKind::Layer2(Layer2Kind::…)`
/// assertion ports without re-deriving the enum nesting at each call site.
export function worldEventKindTag(db: SnapshotDb, eventId: bigint): string | null {
	// `world_event` is private (#915 PR-8); read the per-caller
	// `visible_world_event` dispatch view instead of the raw table.
	const handle = table(db, "visibleWorldEvent", "visible_world_event");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.id) !== String(eventId)) continue;
		const kind = row.kind as { tag?: unknown; value?: unknown } | string | undefined;
		if (typeof kind === "string") return kind;
		if (kind && typeof kind === "object" && "tag" in kind) {
			const outer = String(kind.tag);
			const inner = kind.value;
			if (inner && typeof inner === "object" && "tag" in inner) {
				return `${outer}:${String((inner as { tag: unknown }).tag)}`;
			}
			return outer;
		}
		return null;
	}
	return null;
}

function eventKindTagOf(row: Record<string, unknown>): string | null {
	const kind = row.kind as { tag?: unknown; value?: unknown } | string | undefined;
	if (typeof kind === "string") return kind;
	if (kind && typeof kind === "object" && "tag" in kind) {
		const outer = String(kind.tag);
		const inner = kind.value;
		if (inner && typeof inner === "object" && "tag" in inner) {
			return `${outer}:${String((inner as { tag: unknown }).tag)}`;
		}
		return outer;
	}
	return null;
}

/// `world_event` headers whose flat kind tag (see `worldEventKindTag`) matches,
/// returned as `{ id, tick }`. Used to assert e.g. a `Manual:ClockAdvance` event
/// landed at a tick beyond a captured baseline.
export function worldEventsByKind(db: SnapshotDb, kindTag: string): { id: bigint; tick: bigint }[] {
	// `world_event` is private (#915 PR-8); read the per-caller
	// `visible_world_event` dispatch view instead of the raw table.
	const handle = table(db, "visibleWorldEvent", "visible_world_event");
	const rows: { id: bigint; tick: bigint }[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (eventKindTagOf(row) !== kindTag) continue;
		rows.push({ id: BigInt(String(row.id)), tick: BigInt(String(row.tick)) });
	}
	return rows;
}

/// Read an actor's `current_body` entity id (the inverse of `actorIdForBody`).
export function actorCurrentBody(db: SnapshotDb, actorId: bigint): bigint | null {
	const handle = table(db, "actor");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.actorId ?? row.actor_id) !== String(actorId)) continue;
		return BigInt(String(row.currentBody ?? row.current_body));
	}
	return null;
}

/// Read a `spatial_environment_state` row's `DslValue::Text` value by `state_id`
/// (e.g. the seeded `core/weather.daylight_phase`).
export function spatialEnvStateText(db: SnapshotDb, stateId: string): string | null {
	const handle = table(db, "visibleSpatialEnvironmentState", "visible_spatial_environment_state");
	for (const raw of environmentStateReader.resolveEffectiveSpatialEnvironmentStates(
		(handle?.iter() ?? []) as Iterable<SpatialEnvironmentStateRow>,
	)) {
		const row = raw as Record<string, unknown>;
		if (String(row.stateId ?? row.state_id) !== stateId) continue;
		const value = row.value;
		if (
			typeof value === "object" &&
			value !== null &&
			"tag" in value &&
			(value as { tag: string }).tag === "Text"
		) {
			return String((value as unknown as { value: unknown }).value);
		}
	}
	return null;
}

/** Independent publisher postcondition for a private containment row; never an admission fallback. */
export async function ownerEntityContainmentRow(
	entityId: bigint,
): Promise<{ entityId: bigint; containerId: bigint } | undefined> {
	const rows = await ownerSqlRows(
		`SELECT entity_id, container_id FROM entity_containment WHERE entity_id = ${entityId}`,
	);
	const row = rows[0];
	return row
		? { entityId: BigInt(String(row.entity_id)), containerId: BigInt(String(row.container_id)) }
		: undefined;
}

/** Independent publisher postcondition: the identities bound to one actor, from the raw per-identity table. */
export async function ownerActorIdentities(actorId: bigint): Promise<string[]> {
	const rows = await ownerSqlRows(
		`SELECT identity FROM actor_identity WHERE actor_id = ${actorId}`,
	);
	return rows.map((row) => JSON.stringify(row.identity));
}

/// Stable, sorted `observer_knowledge` keys for one observer body — used to prove
/// a body-swap leaves the OLD body's knowledge rows byte-equal (no churn).
///
/// Reads the per-caller `visible_observer_knowledge` view (ADR-0120, #915
/// sweep PR-2), so results are bounded to bodies the CONNECTED caller
/// currently occupies. That is the correct read-visibility question for a
/// live client, but NOT the right tool to prove a substrate invariant across
/// an identity change (e.g. a body swap): once the caller no longer occupies
/// the old body, this legitimately returns nothing for it, regardless of
/// whether the underlying row still exists unmutated. Use
/// [`ownerObserverKnowledgeKeys`] for that case instead.
export function observerKnowledgeKeys(db: SnapshotDb, observerEntityId: bigint): string[] {
	const handle = table(db, "visibleObserverKnowledge", "visible_observer_knowledge");
	const keys: string[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.observerEntityId ?? row.observer_entity_id) !== String(observerEntityId))
			continue;
		keys.push(
			[
				String(row.knowledgeId ?? row.knowledge_id),
				String(row.knownEntityId ?? row.known_entity_id),
				String(row.learnedAtTick ?? row.learned_at_tick),
			].join("|"),
		);
	}
	return keys.sort();
}

let cachedOwnerToken: string | null | undefined;

/// The database OWNER token, parsed from `SPACETIME_CONFIG_PATH`'s `cli.toml`
/// — the same mechanism `just sql` and `scripts/endurance/probes.ts`'s
/// sampler use (`resolveSqlToken`). A private table's raw SUBSTRATE
/// invariant (e.g. "a body swap does not churn the vacated body's knowledge
/// rows") is not a read-visibility question; it needs the owner's unbounded
/// god-view, not a per-caller `visible_*` view scoped to the connected
/// identity's CURRENT bodies (ADR-0120 postscript: "the unbounded operator
/// god-view remains available through `just sql`").
function resolveOwnerToken(): string | null {
	if (cachedOwnerToken !== undefined) return cachedOwnerToken;
	const configPath = process.env.SPACETIME_CONFIG_PATH;
	if (!configPath || !existsSync(configPath)) {
		cachedOwnerToken = null;
		return cachedOwnerToken;
	}
	const match = readFileSync(configPath, "utf8").match(/spacetimedb_token\s*=\s*"([^"]+)"/);
	cachedOwnerToken = match ? (match[1] ?? null) : null;
	return cachedOwnerToken;
}

/// POST a restricted `SELECT` to the node's HTTP SQL surface with the owner
/// token and decode the BSATN-JSON result into name→value row objects
/// (mirrors `scripts/endurance/probes.ts`'s `sqlRows`).
async function ownerSqlRows(query: string): Promise<Record<string, unknown>[]> {
	const url = `${(process.env.SPELLKAVE_URL ?? DEFAULT_URL).replace(/\/$/, "")}/v1/database/${
		process.env.SPELLKAVE_DB ?? DEFAULT_DB
	}/sql`;
	const token = resolveOwnerToken();
	if (!token) {
		throw new Error(
			"ownerSqlRows: no owner token resolvable from SPACETIME_CONFIG_PATH — cannot read the raw private table",
		);
	}
	const resp = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "text/plain", Authorization: `Bearer ${token}` },
		body: query,
	});
	if (!resp.ok) throw new Error(`sql ${resp.status}: ${await resp.text()}`);
	const results = (await resp.json()) as Array<{
		schema: { elements: Array<{ name: { some?: string } }> };
		rows: unknown[][];
	}>;
	const out: Record<string, unknown>[] = [];
	for (const stmt of results) {
		const cols = stmt.schema.elements.map((el, i) => el.name.some ?? `col${i}`);
		for (const row of stmt.rows) {
			out.push(Object.fromEntries(cols.map((c, i) => [c, row[i]])));
		}
	}
	return out;
}

/// Stable, sorted `observer_knowledge` keys for one observer body, read via
/// the OWNER-token raw table (not the per-caller `visible_observer_knowledge`
/// view `observerKnowledgeKeys` reads). Use this to prove a SUBSTRATE
/// invariant across an identity change (e.g. a body swap), since the
/// connected caller's own visibility legitimately narrows once it no longer
/// occupies the body being inspected.
export async function ownerObserverKnowledgeKeys(observerEntityId: bigint): Promise<string[]> {
	const rows = await ownerSqlRows(
		`SELECT knowledge_id, known_entity_id, learned_at_tick FROM observer_knowledge WHERE observer_entity_id = ${observerEntityId}`,
	);
	return rows
		.map(
			(row) =>
				`${String(row.knowledge_id)}|${String(row.known_entity_id)}|${String(row.learned_at_tick)}`,
		)
		.sort();
}

export interface DeferralRequestRow {
	requestId: bigint;
	causeTag: string;
	consequenceTemplateId: string;
	actorRef: string | null;
	openedAt: bigint;
	timeoutAt: bigint;
}

/// Read `deferral_request` rows (a parked external resolution) via the
/// per-caller `visible_deferral_request` view — the raw table is private
/// (ADR-0120, #915 PR-7). `cause` is a `DeferralCause` tagged enum;
/// `originating_intent` is a nested `IntentSnapshot` struct whose
/// `consequence_template_id` / `actor_ref` are lifted to the row.
export function deferralRequests(db: SnapshotDb): DeferralRequestRow[] {
	const handle = table(db, "visibleDeferralRequest", "visible_deferral_request");
	const rows: DeferralRequestRow[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		const cause = row.cause as { tag?: unknown } | string | undefined;
		const causeTag =
			typeof cause === "object" && cause !== null && "tag" in cause
				? String(cause.tag)
				: String(cause ?? "");
		const intent = (row.originatingIntent ?? row.originating_intent) as
			| Record<string, unknown>
			| undefined;
		const actorRefRaw = intent?.actorRef ?? intent?.actor_ref;
		rows.push({
			requestId: BigInt(String(row.requestId ?? row.request_id)),
			causeTag,
			consequenceTemplateId: String(
				intent?.consequenceTemplateId ?? intent?.consequence_template_id ?? "",
			),
			actorRef: actorRefRaw === undefined || actorRefRaw === null ? null : String(actorRefRaw),
			openedAt: BigInt(String(row.openedAt ?? row.opened_at)),
			timeoutAt: BigInt(String(row.timeoutAt ?? row.timeout_at)),
		});
	}
	return rows;
}

export function placeKnown(db: SnapshotDb, observerEntityId: bigint, nodeId: string): boolean {
	const handle = table(db, "visibleObserverPlaceKnowledge", "visible_observer_place_knowledge");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.observerEntityId ?? row.observer_entity_id) !== String(observerEntityId))
			continue;
		if (String(row.knownNodeId ?? row.known_node_id) === nodeId) return true;
	}
	return false;
}

export function entityKnowledgeCount(db: SnapshotDb, observerEntityId: bigint): number {
	const handle = table(db, "visibleObserverKnowledge", "visible_observer_knowledge");
	let count = 0;
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.observerEntityId ?? row.observer_entity_id) === String(observerEntityId))
			count += 1;
	}
	return count;
}

export function currentTick(db: SnapshotDb): bigint {
	const handle = table(db, "worldTime", "world_time");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		const tick = row.currentTick ?? row.current_tick ?? row.tick;
		if (tick !== undefined && tick !== null) return BigInt(String(tick));
	}
	return 0n;
}

export function visibleTraceIdsByKind(db: SnapshotDb, kind: string): bigint[] {
	const handle = table(db, "visibleTrace", "visible_trace");
	const ids: bigint[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.kind) !== kind) continue;
		ids.push(BigInt(String(row.traceId ?? row.trace_id)));
	}
	return ids;
}

/// The `(location_kind, location_ref)` anchor of a `visible_trace` row, or null
/// when the caller cannot see that trace. Bead sk-n16: the anchor answers WHERE
/// a trace is and nothing else — who an utterance was aimed at lives in its
/// payload — so a proof about anchoring reads exactly these two columns.
export function visibleTraceAnchor(
	db: SnapshotDb,
	traceId: bigint,
): { locationKind: string; locationRef: string } | null {
	const handle = table(db, "visibleTrace", "visible_trace");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (BigInt(String(row.traceId ?? row.trace_id)) !== traceId) continue;
		return {
			locationKind: String(row.locationKind ?? row.location_kind),
			locationRef: String(row.locationRef ?? row.location_ref),
		};
	}
	return null;
}

/// The `trace_id` of the (first) `visible_trace` row whose `payload_json` matches,
/// or null. Used to find a trace this test inscribed by its opaque content.
export function visibleTraceIdByPayload(db: SnapshotDb, payloadJson: string): bigint | null {
	const handle = table(db, "visibleTrace", "visible_trace");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.payloadJson ?? row.payload_json) === payloadJson) {
			return BigInt(String(row.traceId ?? row.trace_id));
		}
	}
	return null;
}

/// `observer_trace_knowledge.content` durably captured by one observer for one
/// trace (survives the source `visible_trace` row's decay), or null if uncaptured.
export function traceKnowledgeContent(
	db: SnapshotDb,
	observerEntityId: bigint,
	traceId: bigint,
): string | null {
	const handle = table(db, "visibleObserverTraceKnowledge", "visible_observer_trace_knowledge");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.observerEntityId ?? row.observer_entity_id) !== String(observerEntityId))
			continue;
		if (String(row.knownTraceId ?? row.known_trace_id) !== String(traceId)) continue;
		return String(row.content ?? "");
	}
	return null;
}

/// Count of `observer_trace_knowledge` rows referencing one trace (across all
/// observers) — used to prove a Hidden trace is captured by nobody.
export function traceKnowledgeCount(db: SnapshotDb, traceId: bigint): number {
	const handle = table(db, "visibleObserverTraceKnowledge", "visible_observer_trace_knowledge");
	let n = 0;
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.knownTraceId ?? row.known_trace_id) === String(traceId)) n += 1;
	}
	return n;
}

/// True if ANY observer captured `observer_trace_knowledge` with this content —
/// used to prove a Hidden trace's payload is captured by nobody without needing
/// its (presence-scoped, hidden-from-visible_trace) id.
export function traceKnowledgeContentExists(db: SnapshotDb, content: string): boolean {
	const handle = table(db, "visibleObserverTraceKnowledge", "visible_observer_trace_knowledge");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.content ?? "") === content) return true;
	}
	return false;
}

export function modifierTargetDefinitionIds(db: SnapshotDb): string[] {
	const handle = table(db, "modifierTargetDefinition", "modifier_target_definition");
	const ids: string[] = [];
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		ids.push(String(row.targetId ?? row.target_id));
	}
	return ids;
}

export interface ModifierTargetRow {
	targetId: string;
	bundleId: string;
}

export function modifierTargetDefinition(
	db: SnapshotDb,
	targetId: string,
): ModifierTargetRow | null {
	const handle = table(db, "modifierTargetDefinition", "modifier_target_definition");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.targetId ?? row.target_id) !== targetId) continue;
		return { targetId, bundleId: String(row.bundleId ?? row.bundle_id) };
	}
	return null;
}

export interface ModifierTemplateRow {
	modifierTemplateId: string;
	bundleId: string;
	appliesTo: string;
	appliesToTargetId: string;
}

export function modifierTemplate(db: SnapshotDb, templateId: string): ModifierTemplateRow | null {
	const handle = table(db, "modifierTemplate", "modifier_template");
	for (const raw of handle?.iter() ?? []) {
		const row = raw as Record<string, unknown>;
		if (String(row.modifierTemplateId ?? row.modifier_template_id) !== templateId) continue;
		return {
			modifierTemplateId: templateId,
			bundleId: String(row.bundleId ?? row.bundle_id),
			appliesTo: String(row.appliesTo ?? row.applies_to),
			appliesToTargetId: String(row.appliesToTargetId ?? row.applies_to_target_id ?? ""),
		};
	}
	return null;
}

export async function bestEffortDeleteBundle(world: TestWorld, bundleId: string): Promise<void> {
	try {
		await world.conn.reducers.bundleDelete({ bundleId, cascade: true });
	} catch {
		// Cleanup must not mask the real test failure.
	}
}
