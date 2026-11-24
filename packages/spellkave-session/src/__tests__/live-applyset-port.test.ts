import { OWNER_SUBSCRIPTION_TABLES } from "@spellkave/sdk";
import { type SnapshotLike, worldRowSnapshotAccessors } from "@spellkave/tool-authoring";
import { describe, expect, it } from "vitest";
import {
	type ApplysetPortSession,
	createLiveApplysetPort,
} from "../authoring/live-applyset-port.ts";

function session(args: { publisher: boolean; db?: SnapshotLike }): ApplysetPortSession {
	return {
		readsAsPublisher: args.publisher,
		conn: {
			db: args.db ?? {},
			subscriptionBuilder: () => ({
				onApplied: (cb: () => void) => {
					cb();
					return {
						onError: () => ({ subscribe: () => ({}) }),
					};
				},
			}),
			reducers: {
				rApplyBundle: async () => {},
			},
		},
	} as unknown as ApplysetPortSession;
}

describe("createLiveApplysetPort worldRows", () => {
	it("authority preview uses only sender-controlled bodies and never carries binding subjects", async () => {
		const self = { toHexString: () => "a".repeat(64) } as NonNullable<
			ApplysetPortSession["authenticatedIdentity"]
		>;
		const handle = (values: Record<string, unknown>[]) => ({ iter: () => values });
		const db = {
			visible_actor_identity: handle([
				{ actorId: 1n, identity: self },
				{ actorId: 2n, identity: "perceived" },
			]),
			actor: handle([
				{ actorId: 1n, currentBody: 10n },
				{ actorId: 2n, currentBody: 20n },
			]),
			visible_capability: handle([
				{
					entityId: 10n,
					capabilityId: "custom/a",
					extentKindRef: "bundle",
					extentRef: "own",
					source: "authored",
					expiresAtTick: undefined,
				},
				{
					entityId: 20n,
					capabilityId: "frontier.escalate",
					extentKindRef: "bundle",
					extentRef: "foreign",
					source: "authored",
					expiresAtTick: undefined,
				},
			]),
			visible_role_binding: handle([
				{
					bindingId: "public",
					bundleId: "own",
					roleId: "dm",
					extentKindRef: "bundle",
					extentRef: "own",
					presenceEntityId: 10n,
					subject: "private",
					subjectActorId: 99n,
				},
			]),
			role_definition: handle([]),
			role_aggregation: handle([]),
			capability_definition: handle([]),
			world_time: handle([{ tick: 10n }]),
		};
		const connection = session({ publisher: false, db: db as unknown as SnapshotLike });
		connection.authenticatedIdentity = self;
		const port = createLiveApplysetPort({ session: connection, rootPathFor: (file) => file });
		const snapshot = await port.readAuthoritySnapshot?.();
		expect(snapshot?.complete).toBe(true);
		expect(snapshot?.grants.map((row) => row.capability_id)).toEqual(["custom/a"]);
		expect(JSON.stringify(snapshot?.bindings)).not.toContain("subject");
		expect(JSON.stringify(snapshot)).not.toContain("private");
	});
	it("returns not_subscribed when the publisher flag or definition tables are off", () => {
		const empty = snapshotProxy();
		const unpublished = createLiveApplysetPort({
			session: session({ publisher: false, db: empty.db }),
			rootPathFor: (file) => file,
			definitionTablesSubscribed: true,
		});
		expect(unpublished.readsAsPublisher?.()).toBe(false);
		expect(unpublished.worldRows?.("10")).toBe("not_subscribed");
		expect(empty.accessed.size).toBe(0);

		const noDefs = createLiveApplysetPort({
			session: session({ publisher: true, db: empty.db }),
			rootPathFor: (file) => file,
		});
		expect(noDefs.readsAsPublisher?.()).toBe(true);
		expect(noDefs.worldRows?.("10")).toBe("not_subscribed");
		expect(empty.accessed.size).toBe(0);
	});

	it("reads the eight prune-owner tables plus definition seeds, entity, authored-key map, and actor", () => {
		const pruneOwnerTables = OWNER_SUBSCRIPTION_TABLES.filter(
			(table) =>
				![
					"entity_tag",
					"autonomy_job",
					"operator_manifest_authored_entity",
					"arbitration_request",
					"arbitration_response",
					"arbitration_rejection",
					"arbitration_fallback",
				].includes(table),
		);
		expect(pruneOwnerTables).toHaveLength(8);
		// Pin is per `rowsOf` read inside `collectWorldRows`, not a preamble
		// `void db[name]` touch: a missing read fails this equality.
		const { db, accessed } = snapshotProxy();
		const port = createLiveApplysetPort({
			session: session({ publisher: true, db }),
			rootPathFor: (file) => file,
			definitionTablesSubscribed: true,
		});
		const rows = port.worldRows?.("10");
		expect(rows).not.toBe("not_subscribed");
		expect([...accessed].sort()).toEqual(worldRowSnapshotAccessors(pruneOwnerTables).sort());
		expect(accessed.has("actor")).toBe(true);
		expect(accessed.has("operatorManifestAuthoredEntity")).toBe(true);
		for (const table of pruneOwnerTables) {
			expect(accessed.has(worldRowSnapshotAccessors([table])[0] ?? "")).toBe(true);
		}
	});
});

describe("applyset comparable memory subscription", () => {
	it("refuses non-publisher memory before reading caches or subscribing", async () => {
		const accesses: string[] = [];
		const enqueues: string[] = [];
		const refusal = {
			name: "Error",
			code: "baseline_unavailable",
			message: "baseline_unavailable: publisher baseline access required",
		};
		const value = session({ publisher: false });
		Object.assign(value.conn, {
			db: new Proxy(
				{},
				{
					get(_target, key) {
						accesses.push(String(key));
						throw new Error("cache read");
					},
				},
			),
			subscriptionBuilder: () => {
				throw new Error("subscription attempted");
			},
			reducers: {
				rApplyBundle: async () => {
					enqueues.push("root");
				},
				rApplyBundleScoped: async () => {
					enqueues.push("scoped");
				},
			},
		});
		const port = createLiveApplysetPort({ session: value, rootPathFor: (f) => f });
		await expect(port.readApplyset("foreign")).rejects.toMatchObject(refusal);
		await expect(port.readExtentScope?.()).rejects.toMatchObject(refusal);
		await expect(
			port.applyBundle({
				deltaToml: "",
				applyset: "foreign",
				rootPath: "manifest.toml",
				partsJson: "[]",
				expectedGeneration: 0,
				force: true,
			}),
		).rejects.toMatchObject(refusal);
		expect(accesses).toEqual([]);
		expect(enqueues).toEqual([]);
	});
	function subscribedSession(error?: string) {
		const queries: string[][] = [];
		const value = session({
			publisher: true,
			db: {
				operatorManifestApplyset: {
					iter: () => [
						{
							applyset: "demo",
							rootPath: "manifest.toml",
							generation: 1n,
							baseState: { tag: "Known" },
						},
					],
				},
				operatorManifestApplysetPart: { iter: () => [] },
				operatorManifestApplysetExportHash: {
					iter: () => [
						{ applyset: "demo", kind: "entities", key: "chest", exportHash: "recorded" },
					],
				},
			} as SnapshotLike,
		});
		Object.assign(value.conn, {
			subscriptionBuilder: () => {
				let applied = () => {};
				let failed = (_ctx: { event?: Error }) => {};
				return {
					onApplied: (cb: () => void) => {
						applied = cb;
						return {
							onError: (cb: (ctx: { event?: Error }) => void) => {
								failed = cb;
								return {
									subscribe: (requested: string[]) => {
										queries.push(requested);
										if (
											error !== undefined &&
											requested.some((q) => q.includes("operator_manifest_applyset_export_hash"))
										)
											failed({ event: new Error(error) });
										else applied();
										return {};
									},
								};
							},
						};
					},
				};
			},
		});
		return { value, queries };
	}
	it("reads all baseline families from one coherent subscription group", async () => {
		const { value, queries } = subscribedSession();
		const port = createLiveApplysetPort({ session: value, rootPathFor: (f) => f });
		expect((await port.readApplyset("demo"))?.export_hashes).toEqual([
			{ kind: "entities", key: "chest", export_hash: "recorded" },
		]);
		await port.readApplyset("demo");
		expect(queries).toHaveLength(1);
		expect(queries[0]?.map((query) => query.split(" ").at(-1))).toEqual([
			"operator_manifest_applyset",
			"operator_manifest_applyset_part",
			"operator_manifest_applyset_export_hash",
		]);
	});
	it("fails closed when a secure hash view is absent on an old module", async () => {
		const { value } = subscribedSession("no such table operator_manifest_applyset_export_hash");
		const port = createLiveApplysetPort({ session: value, rootPathFor: (f) => f });
		await expect(port.readApplyset("demo")).rejects.toThrow("reader_unavailable");
	});
	it("keeps other comparable-table subscription errors fatal", async () => {
		const { value } = subscribedSession("permission denied operator_manifest_applyset_export_hash");
		const port = createLiveApplysetPort({ session: value, rootPathFor: (f) => f });
		await expect(port.readApplyset("demo")).rejects.toThrow("permission denied");
	});
});

function snapshotProxy(): { db: SnapshotLike; accessed: Set<string> } {
	const accessed = new Set<string>();
	const db = new Proxy({} as SnapshotLike, {
		get(_target, prop) {
			if (typeof prop === "string") accessed.add(prop);
			return { iter: () => [] };
		},
	});
	return { db, accessed };
}
