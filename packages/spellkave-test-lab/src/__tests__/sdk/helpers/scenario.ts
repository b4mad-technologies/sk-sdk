/**
 * Scenario: lifecycle owner for one SDK integration test scenario.
 *
 * Operator-scoped, using the explicit seeder token or worktree publisher.
 * Synthetic graphs get unique bundleIds; core-baseline's actor is shared.
 * Live files serialize and must reset shared actor state before assertions.
 * PLAYER authorization/visibility proofs use a dedicated claimed connection
 * from test-lab instead, never this operator session.
 *
 * Usage:
 *   const s = await Scenario.create("my-feature");
 *   try { ... } finally { await s.dispose(); }
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DbConnection } from "@spellkave/bindings";
import {
	asEntityRef,
	connect,
	createManifestApplyLane,
	enqueueAndWaitManifestApply,
	type ManifestApplyHandle,
	type ProvenanceRow,
	READER_SCOPED_TABLES,
	readActorSnapshot,
	readRecentProvenance,
	type SnapshotDb,
	type SpellkaveSession,
} from "@spellkave/sdk";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	actorIdForBody,
	bindActorAsOperator,
	connectTestWorld,
	ensureApplyManifestAuthority,
	operatorScopeManifest,
} from "../../../live";

const URL = process.env.SPELLKAVE_URL ?? "http://127.0.0.1:3000";
const DB = process.env.SPELLKAVE_DB ?? "spellkave-dev";
const manifestApplyLane = createManifestApplyLane();

/** Explicit seeder token wins; never fall back to an anonymous setup identity. */
export function localOperatorToken(): string {
	const token = process.env.SPELLKAVE_CONNECT_TOKEN || resolveSpacetimeConfigPathToken();
	if (!token) {
		throw new Error(
			"Scenario requires the local publisher credential: source scripts/dev/node-env.sh after sk dev publish, or set SPELLKAVE_CONNECT_TOKEN",
		);
	}
	return token;
}

interface LiveReducers {
	manualTick(params: Record<string, never>): Promise<void>;
	actorSpatialLocationSet(params: {
		actorId: string;
		placeNodeId: string;
		bundleId: string;
	}): Promise<void>;
	rApplyWorldManifest(params: { toml: string }): Promise<void>;
}

function reducers(conn: DbConnection): LiveReducers {
	return conn.reducers as unknown as LiveReducers;
}

function snapshotDb(conn: DbConnection): SnapshotDb {
	return conn.db as unknown as SnapshotDb;
}

function randomHex(): string {
	return Math.random().toString(36).slice(2, 10);
}

async function waitFor(
	predicate: () => boolean,
	message: string,
	timeoutMs = 3_000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(message);
}

// `core`/`core-baseline` moved from `archive/world-fixtures/{core,
// core-baseline}` to `packages/spellkave-mechanics/{fixtures,fixtures-baseline}`
// (world-fixtures-retirement Phase C, D6).
function findCoreFixturePath(): string {
	const candidates = [
		path.resolve(process.cwd(), "packages/spellkave-mechanics/fixtures/core"),
		path.resolve(process.cwd(), "../..", "packages/spellkave-mechanics/fixtures/core"),
	];
	const found = candidates.find(existsSync);
	if (!found) {
		throw new Error(`core fixture not found from cwd '${process.cwd()}'`);
	}
	return found;
}

function findCoreBaselineFixturePath(): string {
	const candidates = [
		path.resolve(process.cwd(), "packages/spellkave-mechanics/fixtures-baseline"),
		path.resolve(process.cwd(), "../..", "packages/spellkave-mechanics/fixtures-baseline"),
	];
	const found = candidates.find(existsSync);
	if (!found) {
		throw new Error(`core-baseline fixture not found from cwd '${process.cwd()}'`);
	}
	return found;
}

function readManifestWithIncludes(root: string): string {
	const manifestPath = existsSync(path.join(root, "manifest.toml"))
		? path.join(root, "manifest.toml")
		: root;
	const source = readFileSync(manifestPath, "utf8");
	const dir = path.dirname(manifestPath);
	const includePaths = Array.from(
		source.matchAll(/^\[\[include\]\]\s*\npath\s*=\s*"([^"]+)"/gm),
		// biome-ignore lint/style/noNonNullAssertion: regex group 1 always present when match succeeds
		(match) => match[1]!,
	);
	const fragments = includePaths.map((includePath) =>
		readFileSync(path.resolve(dir, includePath), "utf8"),
	);
	// Match client/src/cli/manifest.rs: the root gets one appended newline;
	// every included source gets one inside its recursive load and one more
	// from its caller. Digest equality keeps a CLI-seeded fixture idempotent.
	return `${source}\n${fragments.map((fragment) => `${fragment}\n\n`).join("")}`;
}

export class Scenario {
	readonly bundleId: string;
	readonly session: SpellkaveSession;

	private _actorSeq = 0;
	private _provenanceBaseline = new Set<string>();

	private constructor(slug: string, runId: string, session: SpellkaveSession) {
		this.bundleId = `sdk-e2e-${slug}-${runId}`;
		this.session = session;
	}

	static async create(slug: string): Promise<Scenario> {
		// This legacy harness is operator-scoped (including fixture placement),
		// not a PLAYER authorization proof. Use the same identity as the seeder.
		const token = localOperatorToken();
		const setup = await connectTestWorld({ url: URL, db: DB, token });
		try {
			await ensureApplyManifestAuthority(setup);
		} finally {
			setup.disconnect();
		}
		const runId = `${Date.now()}-${randomHex()}`;
		const session = await connect(
			// #1968: core ships no structural player; `connectedActorId` is a
			// pure client-side label (never sent to/validated by the server —
			// see connection.ts), so core_baseline's own bound actor is a
			// reasonable default even for scenarios that never apply core-baseline.
			{
				url: URL,
				db: DB,
				token,
				connectedActorId: "core_baseline/player",
				readerManifests: [
					operatorScopeManifest("SDK Scenario fixture entity lookup", [
						"visible_manifest_authored_entity",
					]),
					{
						requiredTables: [
							...READER_SCOPED_TABLES,
							"manifest_apply_digest",
							"manifest_apply_outcome",
						],
					},
				],
			},
			{
				onError: () => {},
				onDisconnect: () => {},
				onUpdate: () => {},
			},
		);
		try {
			await session.ready;
		} catch (error) {
			session.disconnect();
			throw error;
		}
		return new Scenario(slug, runId, session);
	}

	/** Full node id: `${bundleId}/${local}` */
	nodeId(local: string): string {
		return `${this.bundleId}/${local}`;
	}

	/** Full edge key: `${bundleId}/${local}` */
	edgeKey(local: string): string {
		return `${this.bundleId}/${local}`;
	}

	/** Returns a new unique actor body entity id on each call. */
	freshActorId(): string {
		this._actorSeq += 1;
		return String(9_000_000 + this._actorSeq);
	}

	async applyManifest(toml: string, tolerateAlreadyApplied = false): Promise<void> {
		const db = this.session.conn.db as unknown as Record<string, unknown>;
		const result = await enqueueAndWaitManifestApply({
			digestHandle: (db.manifestApplyDigest ?? db.manifest_apply_digest) as ManifestApplyHandle,
			outcomeHandle: (db.manifestApplyOutcome ?? db.manifest_apply_outcome) as ManifestApplyHandle,
			enqueue: () => reducers(this.session.conn).rApplyWorldManifest({ toml }),
			tolerateAlreadyApplied,
			lane: manifestApplyLane,
		});
		if (!result.ok) throw new Error(result.detail);
	}

	/** Apply Core fixture — idempotent (ignores MF-APPLY-012 already-applied error). */
	async applyCoreFixture(): Promise<void> {
		const toml = readManifestWithIncludes(findCoreFixturePath());
		await this.applyManifest(toml, true);
	}

	/** @deprecated Use applyCoreFixture instead. */
	async applySeedFixture(): Promise<void> {
		return this.applyCoreFixture();
	}

	/**
	 * Apply core-baseline on top of core — idempotent (ignores MF-APPLY-012).
	 * #1968: core ships no place nodes / connectable actor of its own; tests
	 * that need SOME seeded actor + spatial topology apply core-baseline too
	 * (its own outdoor plaza/market nodes, `core_baseline/player` bound to
	 * `$sender`).
	 */
	async applyCoreBaselineFixture(): Promise<void> {
		const toml = readManifestWithIncludes(findCoreBaselineFixturePath());
		await this.applyManifest(toml, true);
		// This harness exercises an operator's human body. The baseline's
		// authored $sender binding alone is Service provenance; classify the
		// existing actor explicitly rather than pretending it is claimable.
		const setup = await connectTestWorld({ url: URL, db: DB, token: localOperatorToken() });
		try {
			const bodyId = BigInt(this.authoredEntityId("core_baseline:core_baseline/player"));
			const actorId = actorIdForBody(setup.db(), bodyId);
			if (actorId === null) throw new Error("core baseline actor was not observed");
			await bindActorAsOperator(setup, actorId);
		} finally {
			setup.disconnect();
		}
	}

	async placeActor(actorId: string, nodeId: string): Promise<void> {
		const entityActorId = this.resolveActorEntityId(actorId);
		await reducers(this.session.conn).actorSpatialLocationSet({
			actorId: entityActorId,
			placeNodeId: nodeId,
			bundleId: this.bundleId,
		});
	}

	async waitForActorAt(actorId: string, nodeId: string, timeoutMs = 4_000): Promise<void> {
		const entityActorId = this.resolveActorEntityId(actorId);
		await waitFor(
			() =>
				readActorSnapshot(snapshotDb(this.session.conn), asEntityRef(entityActorId))
					?.current_node_id === nodeId,
			`actor '${actorId}' did not appear at '${nodeId}' within ${timeoutMs}ms`,
			timeoutMs,
		);
	}

	authoredEntityId(manifestKey: string): string {
		const db = this.session.conn.db as unknown as Record<string, unknown>;
		const handle = db.visibleManifestAuthoredEntity ?? db.visible_manifest_authored_entity;
		if (!handle || typeof handle !== "object" || !("iter" in handle)) {
			throw new Error("visible_manifest_authored_entity table is not subscribed");
		}
		for (const row of (handle as { iter(): Iterable<Record<string, unknown>> }).iter()) {
			const key = String(row.manifestKey ?? row.manifest_key ?? "");
			if (key === manifestKey) {
				return String(row.entityId ?? row.entity_id);
			}
		}
		throw new Error(`manifest authored entity '${manifestKey}' not found`);
	}

	private resolveActorEntityId(actorId: string): string {
		const raw = actorId.startsWith("entity:") ? actorId.slice("entity:".length) : actorId;
		if (/^\d+$/.test(raw)) return raw;
		return this.authoredEntityId(`core:${actorId}`);
	}

	authoredItemId(manifestKey: string): string {
		// Items are entities after the entity-unification retirement. Keep the
		// scenario helper's call shape while resolving through the one surviving
		// authored-entity projection.
		return this.authoredEntityId(manifestKey);
	}

	async manualTick(): Promise<void> {
		await reducers(this.session.conn).manualTick({});
	}

	/** Snapshot IDs: new rows in the same tick need not sort after old IDs. */
	markProvenanceBaseline(): void {
		this._provenanceBaseline = new Set(
			readRecentProvenance(snapshotDb(this.session.conn)).map((row) => row.id),
		);
	}

	/**
	 * Returns evaluation_provenance rows added after the last baseline snapshot,
	 * optionally filtered by subjectId. Sorted ascending by createdAtTick.
	 */
	provenanceSinceBaseline(opts: { subjectId?: string } = {}): ProvenanceRow[] {
		return readRecentProvenance(snapshotDb(this.session.conn), {
			excludeIds: this._provenanceBaseline,
			subjectId: opts.subjectId,
		});
	}

	async dispose(): Promise<void> {
		this.session.disconnect();
	}
}
