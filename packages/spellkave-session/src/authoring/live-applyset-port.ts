// The live `ApplysetPort` (ADR-0145) the two applyset tools
// (`spellkave_applyset_diff` / `_apply`) bind against: it reads the applyset
// memory over an SDK session and sends one `r_apply_bundle` call. Shared by
// `sk` (one connection per invocation) and the Pi extension (the connected
// session).

import { enqueueAndWaitManifestApply, snapshotDb } from "@spellkave/sdk";
import {
	type ApplyBundleCall,
	type ApplysetPort,
	collectLivePlaces,
	collectWorldRows,
	resolveAuthoredEntityId,
	type SnapshotLike,
} from "@spellkave/tool-authoring";
import type { ScopedSnapshotPort } from "@spellkave/world-author";

/** The baseline tables share one required, coherent subscription. */
// ci-allow(raw-sql): indexed publisher views and caller-filtered authority views required by the authoring port
const applysetQuery = (table: string) => `SELECT * FROM ${table}`;
const BASELINE_QUERIES = [
	"operator_manifest_applyset",
	"operator_manifest_applyset_part",
	"operator_manifest_applyset_export_hash",
].map(applysetQuery);
const AUTHORITY_QUERIES = [
	"visible_capability",
	"visible_actor_identity",
	"actor",
	"visible_role_binding",
	"extent_kind_definition",
	"world_time",
	"role_definition",
	"role_aggregation",
	"capability_definition",
].map(applysetQuery);

type Session = Parameters<typeof snapshotDb>[0] & {
	readsAsPublisher?: boolean;
	authenticatedIdentity?: unknown;
	conn: {
		isActive?: boolean;
		subscriptionBuilder(): {
			onApplied(cb: () => void): {
				onError(cb: (ctx: { event?: Error }) => void): { subscribe(queries: string[]): unknown };
			};
		};
		reducers: {
			rApplyBundleScoped(args: {
				deltaToml: string;
				applyset: string;
				rootPath: string;
				partsJson: string;
				expectedGeneration: bigint;
				force: boolean;
				bundleIds: string[];
			}): Promise<void>;
			rApplyBundle(args: {
				deltaToml: string;
				applyset: string;
				rootPath: string;
				partsJson: string;
				expectedGeneration: bigint;
				force: boolean;
			}): Promise<void>;
		};
	};
};

interface RawEntry {
	kind: string;
	key: string;
	bundleId?: string | null;
	hash: string;
}

function rows(handle: { iter(): Iterable<unknown> } | undefined): Record<string, unknown>[] {
	return handle === undefined ? [] : ([...handle.iter()] as Record<string, unknown>[]);
}

function identityText(value: unknown): string {
	if (
		typeof value === "object" &&
		value !== null &&
		"toHexString" in value &&
		typeof value.toHexString === "function"
	)
		return value.toHexString();
	return String(value ?? "");
}

/** SpacetimeDB sum types arrive as `{ tag }`; older snapshots as a bare string. */
function baseState(value: unknown): "known" | "unknown" {
	const tag =
		typeof value === "object" && value !== null ? (value as { tag?: unknown }).tag : value;
	return tag === "Unknown" ? "unknown" : "known";
}

export type ApplysetPortSession = Session;

/**
 * `session` is a value or a thunk (a host whose connection comes and goes
 * wires a thunk); `rootPathFor` is the host's root-path rule
 * (`applysetRootPath` in `@spellkave/tool-node/authoring`).
 */
export function createLiveApplysetPort(deps: {
	session: Session | (() => Session);
	rootPathFor: (absoluteRootFile: string) => string;
	/** `sk` sets this after passing the five `entity_definition_initial_*`
	 * tables in `readerManifests`. Pi does not. */
	definitionTablesSubscribed?: boolean;
	scopedSnapshot?: ScopedSnapshotPort;
}): ApplysetPort {
	const current = (): Session =>
		typeof deps.session === "function" ? (deps.session as () => Session)() : deps.session;
	const baselines = new WeakMap<Session, Promise<void>>();
	const authority = new WeakMap<Session, Promise<void>>();
	const failed = new WeakSet<Session>();
	const publisher = (session: Session): void => {
		if (session.readsAsPublisher !== true)
			throw Object.assign(new Error("baseline_unavailable: publisher baseline access required"), {
				code: "baseline_unavailable",
			});
	};
	const subscribe = (
		session: Session,
		cache: WeakMap<Session, Promise<void>>,
		queries: string[],
	): Promise<void> => {
		let pending = cache.get(session);
		if (!pending) {
			pending = new Promise<void>((resolve, reject) => {
				session.conn
					.subscriptionBuilder()
					.onApplied(() => resolve())
					.onError((ctx) => {
						failed.add(session);
						reject(
							new Error(
								`reader_unavailable: required authoring views unavailable: ${ctx.event?.message ?? "subscription refused"}`,
							),
						);
					})
					.subscribe(queries);
			});
			cache.set(session, pending);
		}
		return pending;
	};
	const readBaseline = async (session: Session) => {
		publisher(session);
		await subscribe(session, baselines, BASELINE_QUERIES);
		if (failed.has(session) || current() !== session || session.conn.isActive === false)
			throw new Error("reader_unavailable: connection changed");
		const db = snapshotDb(session) as Record<string, { iter(): Iterable<unknown> } | undefined>;
		const required = (snake: string, camel: string) => {
			const handle = db[snake] ?? db[camel];
			if (!handle) throw new Error("reader_unavailable: required publisher baseline view missing");
			return rows(handle);
		};
		// No asynchronous boundary between these copies: all three were installed together.
		return {
			db,
			roots: required("operator_manifest_applyset", "operatorManifestApplyset"),
			parts: required("operator_manifest_applyset_part", "operatorManifestApplysetPart"),
			hashes: required(
				"operator_manifest_applyset_export_hash",
				"operatorManifestApplysetExportHash",
			),
		};
	};
	return {
		readScopedSnapshot: deps.scopedSnapshot?.read.bind(deps.scopedSnapshot),
		readApplyset: async (applyset) => {
			const session = current();
			const { db, roots, parts: baselineParts, hashes } = await readBaseline(session);
			const head = roots.find((row) => row.applyset === applyset);
			if (head === undefined) return null;
			const parts = baselineParts
				.filter((row) => row.applyset === applyset)
				.map((row) => ({
					path: String(row.partPath ?? row.part_path),
					entries: (row.entries as RawEntry[]).map((entry) => ({
						kind: entry.kind,
						key: entry.key,
						bundle_id: entry.bundleId ?? null,
						hash: entry.hash,
					})),
				}));
			return {
				root_path: String(head.rootPath ?? head.root_path),
				generation: Number(head.generation),
				base_state: baseState(head.baseState ?? head.base_state),
				parts,
				export_hashes: hashes
					.filter((r) => r.applyset === applyset)
					.map((r) => ({
						kind: String(r.kind),
						key: String(r.key),
						export_hash: String(r.exportHash ?? r.export_hash),
					})),
			};
		},
		readExtentScope: async () => {
			const session = current();
			const { db, roots, parts: baselineParts } = await readBaseline(session);
			await subscribe(session, authority, AUTHORITY_QUERIES);
			const bindings = rows(db.visible_role_binding ?? db.visibleRoleBinding);
			const controlledActors = new Set(
				rows(db.visible_actor_identity ?? db.visibleActorIdentity)
					.filter(
						(row) => identityText(row.identity) === identityText(session.authenticatedIdentity),
					)
					.map((row) => String(row.actorId)),
			);
			const controlledBodies = new Set(
				rows(db.actor)
					.filter((row) => controlledActors.has(String(row.actorId)))
					.map((row) => String(row.currentBody)),
			);
			const presenceBodies = new Set(bindings.map((row) => String(row.presenceEntityId)));
			const tick = BigInt(String(rows(db.world_time ?? db.worldTime)[0]?.tick ?? 0));
			const grants = rows(db.visible_capability ?? db.visibleCapability).filter(
				(row) =>
					row.capabilityId === "frontier.apply_manifest" &&
					controlledBodies.has(String(row.entityId)) &&
					(row.expiresAtTick == null || BigInt(String(row.expiresAtTick)) > tick),
			);
			// A caller with no apply grant reaches the existing server authority refusal.
			// This preserves prune visibility/force diagnostics without granting admission.
			if (session.readsAsPublisher !== true && grants.length === 0) return undefined;
			// The server retains this adapter for the deployed direct-grant catalog until .67.
			if (
				session.readsAsPublisher !== true &&
				grants.some((row) => !presenceBodies.has(String(row.entityId)))
			)
				return undefined;
			const definitions = rows(db.extent_kind_definition ?? db.extentKindDefinition);
			const bundleExtents = grants
				.filter(
					(grant) =>
						bindings.some(
							(binding) =>
								`role_binding:${String(binding.bindingId)}` === grant.source &&
								(binding.expiresAtTick == null || BigInt(String(binding.expiresAtTick)) > tick) &&
								String(binding.presenceEntityId) === String(grant.entityId),
						) &&
						definitions.some(
							(kind) =>
								kind.kindId === grant.extentKindRef &&
								(kind.resolutionShape as { tag?: string })?.tag === "Bundle",
						),
				)
				.map((row) => String(row.extentRef))
				.filter((reference) => reference.length > 0);
			const parts = baselineParts;
			return {
				publisher: session.readsAsPublisher === true,
				bundle_extents: bundleExtents,
				memory: roots.map((root) => ({
					applyset: String(root.applyset),
					bundle_ids: (root.bundleIds as string[] | undefined) ?? null,
					entries: parts
						.filter((part) => part.applyset === root.applyset)
						.flatMap((part) =>
							(part.entries as RawEntry[]).map((entry) => ({
								kind: entry.kind,
								key: entry.key,
								bundle_id: entry.bundleId ?? null,
								hash: entry.hash,
							})),
						),
				})),
			};
		},
		readAuthoritySnapshot: async () => {
			const session = current();
			await subscribe(session, authority, AUTHORITY_QUERIES);
			const db = snapshotDb(session) as Record<string, { iter(): Iterable<unknown> } | undefined>;
			const actors = new Set(
				rows(db.visible_actor_identity ?? db.visibleActorIdentity)
					.filter(
						(row) => identityText(row.identity) === identityText(session.authenticatedIdentity),
					)
					.map((row) => String(row.actorId)),
			);
			const bodies = new Set(
				rows(db.actor)
					.filter((row) => actors.has(String(row.actorId)))
					.map((row) => String(row.currentBody)),
			);
			const bindings = rows(db.visible_role_binding ?? db.visibleRoleBinding);
			const presences = new Set(bindings.map((row) => String(row.presenceEntityId)));
			const tick = Number(rows(db.world_time ?? db.worldTime)[0]?.tick ?? 0);
			const live = (expiry: unknown) =>
				expiry == null || Number(expiry) === 0 || tick < Number(expiry);
			const grants = rows(db.visible_capability ?? db.visibleCapability).filter(
				(row) =>
					bodies.has(String(row.entityId)) &&
					(row.expiresAtTick == null || tick < Number(row.expiresAtTick)) &&
					(!String(row.source).startsWith("role_binding:") ||
						bindings.some(
							(binding) =>
								`role_binding:${String(binding.bindingId)}` === row.source &&
								String(binding.presenceEntityId) === String(row.entityId) &&
								live(binding.expiresAtTick),
						)),
			);
			return {
				publisher: session.readsAsPublisher === true,
				scoped: !grants.some(
					(row) =>
						row.capabilityId === "frontier.apply_manifest" && !presences.has(String(row.entityId)),
				),
				extent_shapes: Object.fromEntries(
					rows(db.extent_kind_definition ?? db.extentKindDefinition).map((row) => [
						String(row.kindId),
						String((row.resolutionShape as { tag?: string })?.tag ?? row.resolutionShape)
							.replace(/([a-z])([A-Z])/g, "$1_$2")
							.toLowerCase(),
					]),
				),
				complete: [
					"visible_role_binding",
					"role_definition",
					"role_aggregation",
					"capability_definition",
					"visible_capability",
					"visible_actor_identity",
					"actor",
					"world_time",
				].every((name) => db[name] !== undefined),
				tick,
				grants: grants.map((row) => ({
					capability_id: String(row.capabilityId),
					extent_kind_ref: String(row.extentKindRef),
					extent_ref: String(row.extentRef),
					expires_at_tick: row.expiresAtTick == null ? null : Number(row.expiresAtTick),
				})),
				role_definitions: rows(db.role_definition ?? db.roleDefinition).map((row) => ({
					role_id: String(row.roleId),
					bundle_id: String(row.bundleId),
					display_name: String(row.displayName),
					description: String(row.description),
					capability_ids: row.capabilityIds as string[],
				})),
				role_aggregations: rows(db.role_aggregation ?? db.roleAggregation).map((row) => ({
					role_id: String(row.roleId),
					bundle_id: String(row.bundleId),
					description: String(row.description),
					capability_ids: row.capabilityIds as string[],
				})),
				capability_definitions: rows(db.capability_definition ?? db.capabilityDefinition).map(
					(row) => ({
						capability_id: String(row.capabilityId),
						bundle_id: String(row.bundleId),
						actor_kind: String(row.actorKind),
						display_name: String(row.displayName),
						description: String(row.description),
						default_visibility: String(
							(row.defaultVisibility as { tag?: string })?.tag ?? row.defaultVisibility ?? "Public",
						).toLowerCase(),
					}),
				),
				bindings: bindings.map((row) => ({
					binding_id: String(row.bindingId),
					bundle_id: String(row.bundleId),
					role_id: String(row.roleId),
					extent_kind_ref: String(row.extentKindRef),
					extent_ref: String(row.extentRef),
					realised: String(row.presenceEntityId) !== "0",
				})),
			};
		},
		applyBundle: async (call: ApplyBundleCall) => {
			const session = current();
			publisher(session);
			const db = snapshotDb(session);
			const result = await enqueueAndWaitManifestApply({
				digestHandle: db.manifest_apply_digest,
				outcomeHandle: db.manifest_apply_outcome,
				enqueue: () =>
					call.bundleIds === undefined
						? session.conn.reducers.rApplyBundle({
								...call,
								expectedGeneration: BigInt(call.expectedGeneration),
							})
						: session.conn.reducers.rApplyBundleScoped({
								...call,
								bundleIds: call.bundleIds,
								expectedGeneration: BigInt(call.expectedGeneration),
							}),
				label: "sk apply",
			});
			return result.ok ? { ok: true } : { ok: false, detail: result.detail };
		},
		rootPathFor: deps.rootPathFor,
		readsAsPublisher: () => current().readsAsPublisher === true,
		worldRows: (entityId) => {
			const session = current();
			if (session.readsAsPublisher !== true || deps.definitionTablesSubscribed !== true) {
				return "not_subscribed";
			}
			return collectWorldRows(snapshotDb(session) as SnapshotLike, entityId);
		},
		authoredEntityId: (bundleId, entityKey) => {
			const session = current();
			if (session.readsAsPublisher !== true || deps.definitionTablesSubscribed !== true) {
				return null;
			}
			return resolveAuthoredEntityId(snapshotDb(session) as SnapshotLike, bundleId, entityKey);
		},
		livePlaces: () => {
			const session = current();
			if (session.readsAsPublisher !== true || deps.definitionTablesSubscribed !== true) {
				return "not_subscribed";
			}
			return collectLivePlaces(snapshotDb(session) as SnapshotLike);
		},
		publisherIdentity: () => {
			const identity: unknown = current().authenticatedIdentity;
			if (typeof identity === "string") return identity.replace(/^0x/i, "").toLowerCase();
			if (identity && typeof identity === "object" && "toHexString" in identity) {
				const hex = (identity as { toHexString?: () => string }).toHexString;
				if (typeof hex === "function") {
					return hex.call(identity).replace(/^0x/i, "").toLowerCase();
				}
			}
			return identity === undefined || identity === null ? null : String(identity);
		},
	};
}
