/** Hosted composition uses only this session's authenticated connection. */
import {
	createActorClient,
	enqueueAndWaitManifestApply,
	OWNER_SUBSCRIPTION_TABLES,
	snapshotDb,
	subscribeManifestApplyWait,
} from "@spellkave/sdk";
import { type AuthorToolContext, createAuthorFacingBoundTools } from "@spellkave/tool-authoring";
import { toolContractsForAuthority } from "@spellkave/tool-contracts";
import {
	createPaceTimeTools,
	createSpellkaveTools,
	type SpellkaveToolContext,
} from "@spellkave/tool-player";
import { createScopedInstanceRead } from "@spellkave/world-author";
import {
	callerToolAuthority,
	createActingContextSelector,
	createActingContextTool,
} from "../acting-context";
import type { ToolResult } from "../player-tools/tool-registry";
import type { LiveSession } from "../session";
import { createLiveApplysetPort } from "./live-applyset-port";
import { createLiveAuthorTarget } from "./live-author-target";
import { createLiveCanIPort } from "./live-can-i-port";
import { createLiveGrantsPort } from "./live-grants-port";
import { createLiveScenesPort } from "./live-scenes-port";
import { createLiveScopedSnapshotPort } from "./live-scoped-instance-port";

export function createCallerSessionTools(live: LiveSession, playerContext: SpellkaveToolContext) {
	const session = live.session;
	const selector = createActingContextSelector(session, { boundBodyId: live.actorId });
	const ownerAccessors = new Set<string>(
		OWNER_SUBSCRIPTION_TABLES.flatMap((name) => [
			name,
			name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
		]),
	);
	// User tool readers cannot even dereference a publisher-only base handle.
	const callerDb = new Proxy(snapshotDb(session), {
		get: (db, name, receiver) =>
			typeof name === "string" && ownerAccessors.has(name)
				? undefined
				: Reflect.get(db, name, receiver),
	});
	const scoped = createLiveScopedSnapshotPort({ session, world: live.binding });
	let scratch: string | null = null;
	let waitReady: Promise<void> | undefined;
	const apply = async (toml: string) => {
		waitReady ??= subscribeManifestApplyWait(session.conn.subscriptionBuilder());
		await waitReady;
		const result = await enqueueAndWaitManifestApply({
			digestHandle: session.conn.db.manifestApplyDigest,
			outcomeHandle: session.conn.db.manifestApplyOutcome,
			onUpdate: live.onUpdate,
			enqueue: () => session.conn.reducers.rApplyManifestDelta({ toml }),
		});
		return result.ok ? { ok: true } : { ok: false, detail: result.detail };
	};
	const applysetBackend = createLiveApplysetPort({
		session,
		rootPathFor: (path) => path,
		scopedSnapshot: scoped,
	});
	const applyset: typeof applysetBackend = {
		...applysetBackend,
		applyBundle: async (call) => {
			waitReady ??= subscribeManifestApplyWait(session.conn.subscriptionBuilder());
			await waitReady;
			return applysetBackend.applyBundle(call);
		},
	};
	const author: AuthorToolContext = {
		workspace: {
			readToml: () => scratch,
			writeToml: (text) => {
				scratch = text;
				return "session-scratch";
			},
		},
		applyDelta: apply,
		applyset,
		canI: createLiveCanIPort({
			conn: session.conn as never,
			db: () => ({}),
			resolveAuthoredEntity: async (key) => {
				const captured = await scoped.read();
				for (const row of captured.snapshot.visible_manifest_authored_entity?.iter() ?? []) {
					if (row.manifestKey === key || String(row.manifestKey).endsWith(`:${key}`))
						return String(row.entityId);
				}
				return null;
			},
		}),
		readInstance: createScopedInstanceRead(scoped),
		scenes: createLiveScenesPort({
			session: () => session,
			endpoint: () => `${live.binding.url}/${live.binding.db}`,
			apply,
		}),
		grants: createLiveGrantsPort({
			session: () => session,
			endpoint: () => `${live.binding.url}/${live.binding.db}`,
			apply,
		}),
		target: createLiveAuthorTarget({
			db: () => callerDb,
			readsAsPublisher: () => false,
			scopedSnapshot: scoped,
			applyDelta: apply,
		}),
	};
	const actorClients = new Map<string, ReturnType<typeof createActorClient>>();
	const actorClient = (bodyId: string) => {
		let client = actorClients.get(bodyId);
		if (!client) {
			client = createActorClient(session, bodyId, { successOnProvenance: true });
			actorClients.set(bodyId, client);
		}
		return client;
	};
	let invocationBody: string | undefined;
	const context: SpellkaveToolContext = {
		...playerContext,
		db: () => callerDb,
		act: {
			actorId: () => invocationBody ?? selector.resolve().bodyId,
			actorClient: () => actorClient(invocationBody ?? selector.resolve().bodyId),
		},
	};
	const selection = createActingContextTool(() => selector);
	const ports = [
		"canI",
		"actingContext",
		"control",
		"paceTime",
		"applyDelta",
		"applyset",
		"readInstance",
		"grants",
		"scenes",
	];
	const bound = [
		...createSpellkaveTools(context),
		...createAuthorFacingBoundTools(author),
		...createPaceTimeTools({ connection: session.conn }),
		selection,
	];
	function tools() {
		const contracts = toolContractsForAuthority(callerToolAuthority(session, live.actorId), ports);
		return contracts.flatMap((contract) => {
			const tool = bound.find((candidate) => candidate.name === contract.name);
			if (!tool) return [];
			return [
				{
					...tool,
					execute: async (id: string, args: never) => {
						if (
							!toolContractsForAuthority(callerToolAuthority(session, live.actorId), ports).some(
								(row) => row.name === tool.name,
							)
						)
							throw new Error(
								"authority_unavailable: current authority no longer offers this tool",
							);
						if (tool.name === "spellkave_manipulate") {
							const action = (args as { action_id: string }).action_id;
							const db = session.conn.db;
							const outcomeIds = new Set(
								[...db.outcomeTemplate.iter()]
									.filter((row) => row.manipulationActionId === action)
									.map((row) => row.outcomeTemplateId),
							);
							// A custom action may have several authored providers. Discovery is a
							// superset; never let arbitrary catalog iteration pick a provider.
							const capabilities = [...db.affordanceTemplate.iter()]
								.filter(
									(row) =>
										outcomeIds.has(row.outcomeTemplateId) &&
										row.capabilityId.startsWith("frontier."),
								)
								.map((row) => row.capabilityId);
							const choice = selector.resolve(capabilities.length ? capabilities : undefined);
							// The daemon serializes invocations. Keep the same event/provenance
							// executor while selecting this call's eligible acting body.
							invocationBody = choice.bodyId;
							try {
								const result = await tool.execute(id, args);
								if (
									!result ||
									typeof result !== "object" ||
									!("content" in result) ||
									!Array.isArray(result.content)
								)
									throw new Error("invalid tool result envelope");
								return result as ToolResult<unknown>;
							} finally {
								invocationBody = undefined;
							}
						}
						if (
							tool.name === "spellkave_move" &&
							(args as { as_body_id?: string }).as_body_id === undefined &&
							selector.resolve().kind !== "character"
						)
							throw new Error(
								"presence_movement_unavailable: select a character or consent-checked as_body_id",
							);
						// Author registries erase their result type at the heterogeneous boundary.
						// Check the shared result envelope before crossing the IPC boundary.
						const result = await tool.execute(id, args);
						if (
							result === null ||
							typeof result !== "object" ||
							!("content" in result) ||
							!Array.isArray(result.content)
						)
							throw new Error("invalid tool result envelope");
						return result as ToolResult<unknown>;
					},
				},
			];
		});
	}
	return { tools, close: () => scoped.close() };
}
