/** One isolated caller-authenticated cache; one group, retired before reapplication. */
import { DbConnection, type SubscriptionHandle } from "@spellkave/bindings";
import type { SpellkaveSession } from "@spellkave/sdk";
import type { ScopedReadSource } from "@spellkave/tool-contracts";
import type {
	OwnerSnapshot,
	ScopedInstanceSnapshot,
	ScopedSnapshotPort,
} from "@spellkave/world-author";

const TABLES = {
	visible_manifest_authored_entity: "authoring_authored_entity",
	entity: "authoring_entity",
	actor: "authoring_actor",
	actor_spatial_location: "authoring_actor_spatial_location",
	capability: "authoring_capability",
	entity_equipment_slot: "authoring_entity_equipment_slot",
	entity_containment: "authoring_entity_containment",
	entity_tag: "authoring_entity_tag",
	object_state: "authoring_object_state",
	entity_location: "authoring_entity_location",
	entity_description: "authoring_entity_description",
	coverage: "authoring_coverage",
	binding_context: "visible_role_binding",
	binding_inventory: "grant_inventory",
	runtime_entity_tag: "visible_entity_tag",
	runtime_tag_coverage: "visible_entity_tag_coverage",
	pending_request: "pending_arbitration_request",
	pending_response: "pending_arbitration_response",
	pending_rejection: "pending_arbitration_rejection",
	pending_fallback: "pending_arbitration_fallback",
	pending_job: "pending_autonomy_job",
	pending_coverage: "pending_context_coverage",
} as const;
let nextConnectionEpoch = 0;
const MAX_PENDING_READS = 16;
const KINDS = [
	"entities",
	"actors",
	"actor_spatial_locations",
	"actor_capabilities",
	"actor_equipment_slots",
	"entity_containment",
	"entity_tag",
	"object_state",
];
function hex(identity: unknown): string {
	if (identity && typeof identity === "object" && "toHexString" in identity) {
		return (identity as { toHexString(): string }).toHexString();
	}
	return String(identity ?? "");
}
function tableRows(
	db: Record<string, { iter(): Iterable<Record<string, unknown>> }>,
	table: string,
) {
	const handle =
		db[table.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase())] ?? db[table];
	if (!handle) throw new Error("reader_unavailable: scoped view accessor missing");
	return handle.iter();
}
function freeze<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
export function createLiveScopedSnapshotPort(deps: {
	session: SpellkaveSession | (() => SpellkaveSession);
	world: { url: string; db: string } | (() => { url: string; db: string });
	/**
	 * Additional family name -> server view or public catalog table, read in the
	 * SAME isolated group and copied in the same `onApplied` (persona exploration).
	 * Existing callers pass nothing and keep the eight-kind group unchanged.
	 */
	extraTables?: Readonly<Record<string, string>>;
}): ScopedSnapshotPort {
	for (const name of Object.keys(deps.extraTables ?? {}))
		if (name in TABLES) throw new Error(`extraTables: '${name}' shadows a scoped family`);
	const tables: Readonly<Record<string, string>> = { ...TABLES, ...deps.extraTables };
	// ci-allow(raw-sql): D-2 isolated scoped authoring snapshot group; names are server-admitted views or public catalogs
	const queries = Object.values(tables).map((table) => `SELECT * FROM ${table}`);
	const current = () => (typeof deps.session === "function" ? deps.session() : deps.session);
	const world = () => (typeof deps.world === "function" ? deps.world() : deps.world);
	let connection: DbConnection | undefined;
	let handle: SubscriptionHandle | undefined;
	let ready: Promise<void> | undefined;
	let closed = false;
	let ownerKey = "";
	let parentConnection: SpellkaveSession["conn"] | undefined;
	let connectionEpoch = 0;
	let fingerprint = "";
	let sourceEpoch = 0;
	let queue: Promise<unknown> = Promise.resolve();
	let pending = 0;
	let failPending: ((error: Error) => void) | undefined;
	const unavailable = () =>
		new Error("reader_unavailable: isolated caller-scoped snapshot unavailable");
	function invalidate(error: Error) {
		failPending?.(error);
	}
	function endConnection() {
		invalidate(unavailable());
		failPending = undefined;
		connectionEpoch = ++nextConnectionEpoch;
		const old = connection;
		connection = undefined;
		handle = undefined;
		ready = undefined;
		ownerKey = "";
		old?.disconnect();
	}
	function currentKey() {
		const endpoint = world();
		return JSON.stringify([endpoint.url, endpoint.db, hex(current().authenticatedIdentity)]);
	}
	async function ensureConnection() {
		const session = current();
		if (!session.conn.isActive || !session.authenticatedToken) throw unavailable();
		const endpoint = world();
		const key = currentKey();
		if (
			key !== ownerKey ||
			parentConnection !== session.conn ||
			(connection !== undefined && !connection.isActive)
		) {
			endConnection();
			fingerprint = "";
		}
		if (!connection) {
			ownerKey = key;
			parentConnection = session.conn;
			connectionEpoch = ++nextConnectionEpoch;
			const createdEpoch = connectionEpoch;
			ready = new Promise<void>((resolve, reject) => {
				failPending = reject;
				connection = DbConnection.builder()
					.withUri(endpoint.url)
					.withDatabaseName(endpoint.db)
					.withToken(session.authenticatedToken)
					.onConnect((_conn, identity) => {
						if (createdEpoch !== connectionEpoch || closed) {
							reject(unavailable());
							return;
						}
						if (hex(identity) !== hex(session.authenticatedIdentity)) {
							reject(unavailable());
							endConnection();
						} else {
							failPending = undefined;
							resolve();
						}
					})
					.onConnectError((_ctx, error) => {
						if (createdEpoch !== connectionEpoch) return;
						reject(error);
						invalidate(error);
					})
					.onDisconnect(() => {
						if (createdEpoch !== connectionEpoch) return;
						invalidate(unavailable());
						ready = undefined;
						handle = undefined;
					})
					.build();
			});
		}
		await ready;
		if (
			closed ||
			!connection?.isActive ||
			ownerKey !== key ||
			currentKey() !== key ||
			current().conn !== parentConnection
		)
			throw unavailable();
		return {
			conn: connection,
			key,
			identity: hex(session.authenticatedIdentity),
			world: `${endpoint.url}/${endpoint.db}`,
		};
	}
	async function capture(): Promise<ScopedInstanceSnapshot> {
		if (closed) throw unavailable();
		let live = await ensureConnection();
		if (handle) {
			const old = handle;
			handle = undefined;
			await new Promise<void>((resolve, reject) => {
				failPending = reject;
				old.unsubscribeThen(() => {
					if (closed || connection !== live.conn) {
						reject(unavailable());
						return;
					}
					failPending = undefined;
					resolve();
				});
			});
		}
		const cache = () =>
			live.conn.db as unknown as Record<string, { iter(): Iterable<Record<string, unknown>> }>;
		const residue = () =>
			Object.values(tables).some((table) => [...tableRows(cache(), table)].length !== 0);
		if (residue()) {
			// The retired group left rows behind: the SDK cache drifted while the
			// group was live ("Deleting a row that was not present in the cache",
			// sk-jay0.7.123.20.38). A new connection starts empty, so read there.
			endConnection();
			live = await ensureConnection();
			if (residue()) {
				endConnection();
				throw unavailable();
			}
		}
		const db = cache();
		return new Promise<ScopedInstanceSnapshot>((resolve, reject) => {
			failPending = reject;
			handle = live.conn
				.subscriptionBuilder()
				.onError(() => {
					if (connection !== live.conn) return;
					invalidate(unavailable());
					endConnection();
				})
				.onApplied(() => {
					// Installed SDK calls onApplied after applying ALL table updates. Copy
					// every family synchronously here, before any table callback can yield.
					try {
						if (
							!current().conn.isActive ||
							current().conn !== parentConnection ||
							live.key !== ownerKey ||
							currentKey() !== live.key ||
							!live.conn.isActive ||
							closed
						)
							throw unavailable();
						const families: Record<string, readonly Record<string, unknown>[]> = {};
						for (const [name, table] of Object.entries(tables))
							families[name] = freeze(structuredClone([...tableRows(db, table)]));
						const coverageRows = families.coverage;
						if (
							!coverageRows?.length ||
							KINDS.some((kind) => !coverageRows.some((row) => row.kind === kind)) ||
							coverageRows.some((row) => row.projectionVersion !== 1)
						)
							throw unavailable();
						const scopes = [...new Set(coverageRows.flatMap((row) => row.scopes as string[]))];
						if (scopes.length === 0) throw unavailable();
						const next = JSON.stringify(
							Object.entries(families).map(([name, rows]) => [
								name,
								rows
									.map((row) =>
										JSON.stringify(row, (_key, value) =>
											typeof value === "bigint" ? String(value) : value,
										),
									)
									.sort(),
							]),
							(_key, value) => (typeof value === "bigint" ? String(value) : value),
						);
						if (next !== fingerprint) {
							fingerprint = next;
							sourceEpoch++;
						}
						const source: ScopedReadSource = freeze({
							reads_as_publisher: false,
							identity: live.identity,
							world: live.world,
							connection_epoch: connectionEpoch,
							source_epoch: sourceEpoch,
							tick: String(coverageRows[0]?.tick ?? 0),
							projection_version: 1,
							authorized_scopes: scopes,
							read_depths: [
								...new Map(
									coverageRows.flatMap((row) =>
										((row.readDepths ?? []) as { bindingId: string; depth: { tag: string } }[]).map(
											(item) => {
												if (item.depth.tag !== "Internal" && item.depth.tag !== "Hidden")
													throw unavailable();
												const depth =
													item.depth.tag === "Internal"
														? ("internal" as const)
														: ("hidden" as const);
												return [
													`${item.bindingId}:${depth}`,
													{ binding_id: item.bindingId, depth },
												] as const;
											},
										),
									),
								).values(),
							],
							authorized_bundles: [
								...new Set(coverageRows.flatMap((row) => row.bundleScopes as string[])),
							],
							coverage: Object.fromEntries([
								...coverageRows.map((row) => [String(row.kind), String(row.status)]),
								[
									"binding_context",
									families.binding_inventory?.length &&
									families.binding_inventory.every(
										(row) => row.protocolVersion === 1 && row.expansionComplete === true,
									)
										? "scoped"
										: "reader_unavailable",
								],
								[
									"runtime_entity_tag",
									String(families.runtime_tag_coverage?.[0]?.status ?? "reader_unavailable"),
								],
								[
									"pending_context",
									String(families.pending_coverage?.[0]?.status ?? "reader_unavailable"),
								],
							]),
							labels: ["authored_entities_only"],
						});
						const snapshot: OwnerSnapshot = {};
						for (const [name, rows] of Object.entries(families))
							if (name !== "coverage") snapshot[name] = { iter: () => rows };
						failPending = undefined;
						resolve({ snapshot: freeze(snapshot), source });
					} catch {
						reject(unavailable());
						if (connection === live.conn) endConnection();
					}
				})
				.subscribe(queries);
		});
	}
	return {
		read() {
			if (pending >= MAX_PENDING_READS) return Promise.reject(unavailable());
			pending++;
			const result = queue.then(capture, capture);
			queue = result
				.finally(() => {
					pending--;
				})
				.catch(() => undefined);
			return result;
		},
		close() {
			closed = true;
			invalidate(unavailable());
			endConnection();
		},
	};
}
