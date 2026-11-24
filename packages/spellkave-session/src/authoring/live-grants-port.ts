/** Caller-only adapter; complete inventory is a server projection, never owner-token fallback. */
import type { SpellkaveSession } from "@spellkave/sdk";
import type { GrantSnapshot, GrantsPort } from "@spellkave/tool-authoring";

function identity(value: unknown): string {
	if (value && typeof value === "object" && "toHexString" in value)
		return (value as { toHexString(): string }).toHexString();
	return String(value ?? "");
}
export function createLiveGrantsPort(deps: {
	session(): SpellkaveSession;
	endpoint(): string;
	apply(toml: string): Promise<{ ok: boolean; detail?: string }>;
	writeArtifact?: (path: string, text: string) => Promise<void>;
}): GrantsPort {
	let observed: SpellkaveSession | undefined;
	let barrier: Promise<void> | undefined;
	let handoverSession: SpellkaveSession | undefined;
	let handoverBarrier: Promise<void> | undefined;
	async function handoverReady() {
		const session = deps.session();
		if (!session.handOverProtocolSupported)
			throw new Error("handover protocol unsupported by this module");
		if (handoverSession !== session) {
			handoverSession = session;
			handoverBarrier = new Promise<void>((resolve, reject) =>
				session.conn
					.subscriptionBuilder()
					.onApplied(() => resolve())
					.onError(() => reject(new Error("handover subscription failed")))
					.subscribe((tables) => [
						tables.roleBindingHandOverContext!.build(),
						tables.visibleRoleBindingTransfer!.build(),
					]),
			);
		}
		await handoverBarrier;
		return session;
	}
	const json = (value: unknown): Record<string, unknown> =>
		JSON.parse(
			JSON.stringify(value, (_key, item: unknown) =>
				typeof item === "bigint" ? String(item) : item,
			),
		);
	return {
		async snapshot(): Promise<GrantSnapshot> {
			const session = deps.session();
			if (!session.grantProtocolSupported)
				throw new Error("grant protocol unsupported by this module");
			if (observed !== session) {
				observed = session;
				barrier = new Promise<void>((resolve, reject) =>
					session.conn
						.subscriptionBuilder()
						.onApplied(() => resolve())
						.onError(() => reject(new Error("grant protocol subscription failed")))
						.subscribe((tables) => [
							tables.grantInventory!.build(),
							tables.visibleRoleBinding!.build(),
						]),
				);
			}
			await barrier;
			const db = session.conn.db;
			const inventory = [...db.grant_inventory!.iter()];
			const first = inventory[0];
			if (!first) throw new Error("grant inventory unavailable; no complete snapshot");
			if (
				inventory.some(
					(row) =>
						row.protocolVersion !== first.protocolVersion ||
						row.worldInstanceId !== first.worldInstanceId ||
						row.observedTick !== first.observedTick,
				)
			)
				throw new Error("incoherent grant inventory; reconnect and preview again");
			return {
				protocolVersion: first.protocolVersion,
				identity: identity(session.authenticatedIdentity),
				endpoint: deps.endpoint(),
				worldInstanceId: first.worldInstanceId,
				tick: String(first.observedTick),
				publisher: first.publisher,
				completeInventory: true,
				inventory: inventory.map((r) => ({
					role: r.roleId,
					kind: r.extentKindRef,
					reference: r.extentRef,
					canBind: r.canBind,
					expansionMember: r.expansionMember,
					expansionComplete: r.expansionComplete,
				})),
				bindings: [...db.visible_role_binding!.iter()].map((r) => ({
					binding_id: r.bindingId,
					bundle_id: r.bundleId,
					subject: r.subject,
					role_id: r.roleId,
					extent_kind_ref: r.extentKindRef,
					extent_ref: r.extentRef,
					expires_at_tick:
						r.expiresAtTick === undefined || r.expiresAtTick === 0n
							? null
							: String(r.expiresAtTick),
					description: r.description,
					handover_note: r.handoverNote ?? null,
				})),
			};
		},
		async prepareHandOver(bindingId) {
			const session = await handoverReady();
			const row = [...session.conn.db.role_binding_hand_over_context!.iter()].find(
				(r) => r.binding.bindingId === bindingId,
			);
			if (!row) return undefined;
			const r = row.binding;
			return {
				binding: {
					binding_id: r.bindingId,
					bundle_id: r.bundleId,
					subject: r.subject,
					role_id: r.roleId,
					extent_kind_ref: r.extentKindRef,
					extent_ref: r.extentRef,
					expires_at_tick: r.expiresAtTick === undefined ? null : String(r.expiresAtTick),
					description: r.description,
					handover_note: r.handoverNote ?? null,
				},
				expected_digest: row.authorityDigest,
				expected_merged_role_digest: row.mergedRoleDigest,
				expected_incarnation: r.incarnation,
				expected_revision: String(r.revision),
				source_tick: String(row.sourceTick),
				context: json({
					pending_requests: row.pendingRequests,
					scheduled_jobs: row.scheduledJobs,
					coverage: row.coverage,
					held_blockers: row.heldBlockers,
					held_status: row.heldStatus,
					clock_paused: row.clockPaused,
				}),
			};
		},
		async transferReceipt(requestId, bindingId) {
			const session = await handoverReady();
			const row = [...session.conn.db.visible_role_binding_transfer!.iter()].find(
				(r) => r.requestId === requestId && r.bindingId === bindingId,
			);
			if (!row) return undefined;
			return {
				key: row.key,
				request_id: row.requestId,
				binding_id: row.bindingId,
				presence_entity_id: String(row.presenceEntityId),
				old_subject: row.oldSubject,
				new_subject: row.newSubject,
				applied_by: identity(row.appliedBy),
				applied_via: row.appliedVia,
				tick: String(row.tick),
				reason: row.reason,
				incarnation: row.incarnation,
				old_revision: String(row.oldRevision),
				new_revision: String(row.newRevision),
				old_digest: row.oldDigest,
				new_digest: row.newDigest,
				merged_role_digest: row.mergedRoleDigest,
			};
		},
		apply: deps.apply,
		...(deps.writeArtifact === undefined ? {} : { writeArtifact: deps.writeArtifact }),
	};
}
