// embedded-manifest: {"category": "production_empty_manifest", "rationale": "handover composes exactly one guarded subject replacement from caller-authorized live binding context"}
/** Caller-scoped review and explicit guarded subject replacement. */
import {
	HAND_OVER_ROLE_PARAMS,
	HAND_OVER_ROLE_TOOL,
	PREPARE_HAND_OVER_PARAMS,
	PREPARE_HAND_OVER_TOOL,
} from "@spellkave/tool-contracts/schemas";
import { type GrantRow, renderSchemaManifest } from "@spellkave/world-author/tooling";
import type { Static } from "typebox";
import type { AuthorToolContext } from "./authoring";
import { grantSnapshot } from "./grant-tools";
import { defineTool } from "./tool-registry";

export interface HandOverPreview {
	binding: GrantRow;
	expected_digest: string;
	expected_merged_role_digest: string;
	expected_incarnation: string;
	expected_revision: string;
	source_tick: string;
	context: Record<string, unknown>;
}
export interface HandOverReceipt {
	request_id: string;
	binding_id: string;
	key: string;
	[key: string]: unknown;
}
export type HandOverInput = Static<typeof HAND_OVER_ROLE_PARAMS>;
function canonicalSubject(subject: string, caller: string): string {
	const value = subject.trim() === "$sender" ? caller : subject.trim();
	if (!value) throw new Error("handover requires an explicit subject");
	return /^(?:0x)?[a-f0-9]{64}$/i.test(value) ? value.replace(/^0x/i, "").toLowerCase() : value;
}
export async function prepareHandOver(
	context: AuthorToolContext,
	bindingId: string,
	subject: string,
) {
	const snapshot = await grantSnapshot(context);
	if (!context.grants?.prepareHandOver)
		throw new Error("handover protocol unsupported by this module");
	const prepared = await context.grants.prepareHandOver(bindingId);
	if (!prepared) throw new Error("binding unavailable for handover");
	const target = canonicalSubject(subject, snapshot.identity);
	if (target === prepared.binding.subject)
		throw new Error("proposed holder already holds this binding");
	return {
		...prepared,
		binding_id: bindingId,
		subject: target,
		preview_is_frozen: false,
		personal_consent_transfers: false,
		npc_holds_transfer: false,
	};
}
export async function handOverRole(context: AuthorToolContext, input: HandOverInput) {
	const snapshot = await grantSnapshot(context);
	const port = context.grants;
	if (!port?.prepareHandOver || !port.transferReceipt)
		throw new Error("handover protocol unsupported by this module");
	const prior = await port.transferReceipt(input.request_id, input.binding_id);
	if (prior) {
		// Reconcile only an identical sender-bound operation from its private receipt.
		// The stored request includes the authored preimage; it is not reconstructed from a later holder.
		if (
			prior.applied_by !== snapshot.identity ||
			prior.new_subject !== canonicalSubject(input.subject, snapshot.identity) ||
			prior.old_digest !== input.expected_digest ||
			prior.merged_role_digest !== input.expected_merged_role_digest ||
			prior.incarnation !== input.expected_incarnation ||
			prior.old_revision !== input.expected_revision ||
			prior.reason !== input.reason
		)
			throw new Error("handover request id conflicts with the committed receipt");
		return { ok: true, reconciled: true, receipt: prior };
	}
	const prepared = await port.prepareHandOver(input.binding_id);
	if (!prepared) throw new Error("binding unavailable for handover");
	const row = { ...prepared.binding, subject: canonicalSubject(input.subject, snapshot.identity) };
	const toml = renderSchemaManifest({
		schema_version: "1.0.0",
		metadata: { expected_world_instance_id: snapshot.worldInstanceId },
		role_bindings: [row],
		binding_preconditions: [{ ...input, subject: undefined }].map(
			({ subject: _subject, ...precondition }) => precondition,
		),
	});
	let lost: unknown;
	try {
		const result = await port.apply(toml);
		if (!result.ok) throw new Error(result.detail ?? "handover apply refused");
	} catch (error) {
		lost = error;
	}
	const receipt = await port.transferReceipt(input.request_id, input.binding_id);
	if (!receipt) {
		if (lost) throw lost;
		throw new Error("handover has no committed receipt; reconcile the same request id");
	}
	return { ok: true, reconciled: lost !== undefined, receipt };
}
const result = <T>(details: T) => ({
	content: [{ type: "text" as const, text: JSON.stringify(details) }],
	details,
});
export const prepareHandOverToolDef = defineTool({
	contract: PREPARE_HAND_OVER_TOOL,
	schema: PREPARE_HAND_OVER_PARAMS,
	run: async (context: AuthorToolContext, params) =>
		result(await prepareHandOver(context, params.binding_id, params.subject)),
});
export const handOverRoleToolDef = defineTool({
	contract: HAND_OVER_ROLE_TOOL,
	schema: HAND_OVER_ROLE_PARAMS,
	run: async (context: AuthorToolContext, params) => result(await handOverRole(context, params)),
});
