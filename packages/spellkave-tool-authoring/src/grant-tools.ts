// embedded-manifest: {"category": "production_empty_manifest", "rationale": "workspace grants begin with a schema-directed empty manifest; the renderer composes validated binding rows"}
/** Canonical grant verbs. Read facts and mutations always use the caller's port. */
import {
	EXPORT_GRANTS_PARAMS,
	EXPORT_GRANTS_TOOL,
	GRANT_ROLE_PARAMS,
	GRANT_ROLE_TOOL,
	HAND_OVER_ROLE_TOOL,
	LIST_GRANTS_PARAMS,
	LIST_GRANTS_TOOL,
	PREPARE_HAND_OVER_TOOL,
	REVOKE_ROLE_PARAMS,
	REVOKE_ROLE_TOOL,
} from "@spellkave/tool-contracts/schemas";
import {
	composeGrant,
	type GrantInput,
	type GrantRow,
	grantDelta,
} from "@spellkave/world-author/tooling";
import { defineTool } from "./tool-registry";

function authoringToolResult<T>(details: T) {
	return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
}

import { resolveAuthorTarget } from "./author-target";
import type { AuthorToolContext } from "./authoring";

export interface GrantExtent {
	role: string;
	kind: string;
	reference: string;
	canBind: boolean;
	expansionMember: boolean;
	expansionComplete: boolean;
}
export interface GrantSnapshot {
	protocolVersion: number;
	identity: string;
	endpoint: string;
	worldInstanceId: string;
	tick: string;
	publisher: boolean;
	/** The caller protocol projection completed its subscription transaction; per-role expansionComplete establishes whole-world completeness. */
	completeInventory: boolean;
	inventory: GrantExtent[];
	bindings: GrantRow[];
}
export interface GrantsPort {
	prepareHandOver?(
		bindingId: string,
	): Promise<import("./hand-over-tools").HandOverPreview | undefined>;
	transferReceipt?(
		requestId: string,
		bindingId: string,
	): Promise<import("./hand-over-tools").HandOverReceipt | undefined>;
	snapshot(): Promise<GrantSnapshot>;
	apply(toml: string): Promise<{ ok: boolean; detail?: string }>;
	writeArtifact?(path: string, text: string): Promise<void>;
}
export async function grantSnapshot(context: AuthorToolContext): Promise<GrantSnapshot> {
	if (!context.grants)
		throw new Error("grant protocol unsupported: connect to a supporting module as the caller");
	const snapshot = await context.grants.snapshot();
	if (snapshot.protocolVersion !== 1)
		throw new Error("grant protocol unsupported by the connected module");
	if (!snapshot.identity || !snapshot.worldInstanceId)
		throw new Error("unknown caller or world instance; reconnect and preview again");
	return snapshot;
}
async function digest(text: string): Promise<string> {
	const bytes = new TextEncoder().encode(text);
	const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function orderedInventory(snapshot: GrantSnapshot, role: string): GrantExtent[] {
	const sorted = snapshot.inventory
		.filter((e) => e.role === role && e.expansionMember === true)
		.sort((a, b) => a.kind.localeCompare(b.kind) || a.reference.localeCompare(b.reference));
	return sorted.filter(
		(e, i) => i === 0 || e.kind !== sorted[i - 1]?.kind || e.reference !== sorted[i - 1]?.reference,
	);
}
function preview(snapshot: GrantSnapshot, row: GrantRow): "admitted" | "denied" | "server-decides" {
	if (snapshot.publisher) return "admitted";
	const fact = snapshot.inventory.find(
		(e) =>
			e.role === row.role_id && e.kind === row.extent_kind_ref && e.reference === row.extent_ref,
	);
	return fact === undefined ? "server-decides" : fact.canBind ? "admitted" : "denied";
}
function pin(snapshot: GrantSnapshot): string {
	return JSON.stringify([snapshot.identity, snapshot.endpoint, snapshot.worldInstanceId]);
}
function unchangedRefusal(message: string): boolean {
	const start = message.indexOf("{");
	if (start >= 0) {
		try {
			return JSON.parse(message.slice(start)).code === "MF-APPLY-012";
		} catch {
			return false;
		}
	}
	return /^(?:Error: )?MF-APPLY-012(?:[: ]|$)/.test(message);
}
async function apply(
	context: AuthorToolContext,
	snapshot: GrantSnapshot,
	rows: GrantRow[],
	revoke: string[] = [],
) {
	for (const row of rows)
		if (preview(snapshot, row) === "denied")
			throw new Error("D-6 grant preview refused; no binding written");
	const latest = await grantSnapshot(context);
	if (pin(latest) !== pin(snapshot)) throw new Error("grant destination changed; preview again");
	const toml = grantDelta(rows, revoke, snapshot.worldInstanceId);
	try {
		const result = await context.grants!.apply(toml);
		return !result.ok && unchangedRefusal(result.detail ?? "")
			? { ok: true, detail: "unchanged authorized retry" }
			: result;
	} catch (err) {
		// The server rechecked D-6 before digest-idempotency refusal.
		if (unchangedRefusal(String(err))) return { ok: true, detail: "unchanged authorized retry" };
		throw err;
	}
}
export async function grantRole(context: AuthorToolContext, input: GrantInput) {
	const target = resolveAuthorTarget(context.target);
	if (!context.grants && target?.kind !== "live") {
		const bundle =
			input.bundle ??
			(typeof context.defaultBundle === "function"
				? context.defaultBundle()
				: context.defaultBundle);
		if (!bundle) throw new Error("workspace grant requires an explicitly selected bundle");
		if (input.subject === "$sender")
			throw new Error("workspace grant requires a concrete subject identity or NPC key");
		if (input.extent === "*")
			throw new Error("whole-world grant requires a complete live inventory");
		const row = composeGrant({ ...input, bundle }, "", []);
		const toml = grantDelta([row]);
		if (target?.kind === "local")
			return { ...(await target.applyBatch(toml)), binding_ids: [row.binding_id], scripted: true };
		const { parseSchemaManifestToml, renderSchemaManifest, validateManifestToml } = await import(
			"@spellkave/world-author/tooling"
		);
		const current =
			context.workspace.readToml() ?? renderSchemaManifest({ schema_version: "1.0.0" });
		const manifest = parseSchemaManifestToml(current);
		const existing = (manifest.role_bindings ?? []) as GrantRow[];
		composeGrant({ ...input, bundle }, "", existing);
		manifest.role_bindings = [...existing.filter((r) => r.binding_id !== row.binding_id), row];
		const composed = renderSchemaManifest(manifest);
		const fatal = validateManifestToml(composed).filter((d) => d.severity === "fatal");
		if (fatal.length)
			throw new Error(`workspace grant validation failed: ${JSON.stringify(fatal)}`);
		context.workspace.writeToml(composed);
		return { ok: true, binding_ids: [row.binding_id], scripted: true, authority: "server-decides" };
	}
	const snapshot = await grantSnapshot(context);
	let rows: GrantRow[];
	let coverage: unknown;
	if (input.extent === "*") {
		if (!snapshot.completeInventory)
			throw new Error("inventory-incomplete: whole-world grant refused without writes");
		const inventory = orderedInventory(snapshot, input.role);
		if (inventory.length === 0 || inventory.some((e) => !e.canBind || e.expansionComplete !== true))
			throw new Error("inventory-incomplete: D-6 does not cover every whole-world expansion row");
		rows = inventory.map((e) =>
			composeGrant(
				{
					...input,
					bundle: "",
					extent_kind: e.kind,
					extent: e.reference,
					description: `Whole-world expansion at tick ${snapshot.tick}; inventory ${e.kind}:${e.reference}. ${input.description ?? ""}`,
				},
				snapshot.identity,
				snapshot.bindings,
			),
		);
		coverage = {
			observed_tick: snapshot.tick,
			inventory_digest: await digest(JSON.stringify(inventory)),
			extents: inventory.map(({ kind, reference }) => ({ kind, reference })),
		};
	} else {
		rows = [composeGrant({ ...input, bundle: "" }, snapshot.identity, snapshot.bindings)];
		coverage = { extents: rows.map((r) => ({ kind: r.extent_kind_ref, reference: r.extent_ref })) };
	}
	return {
		...(await apply(context, snapshot, rows)),
		binding_ids: rows.map((r) => r.binding_id),
		coverage,
		preview: rows.map((r) => preview(snapshot, r)),
	};
}
/** Connected discovery uses caller-filtered server verdicts, never a preset. */
export async function offeredGrantTools(context: AuthorToolContext): Promise<string[]> {
	const snapshot = await grantSnapshot(context);
	const bind = snapshot.publisher || snapshot.inventory.some((row) => row.canBind);
	const read = bind || snapshot.bindings.length > 0;
	return [
		...(bind ? [GRANT_ROLE_TOOL, REVOKE_ROLE_TOOL] : []),
		...(read ? [LIST_GRANTS_TOOL, EXPORT_GRANTS_TOOL] : []),
		...(bind && context.grants?.prepareHandOver && context.grants.transferReceipt
			? [PREPARE_HAND_OVER_TOOL, HAND_OVER_ROLE_TOOL]
			: []),
	];
}
export async function revokeRole(context: AuthorToolContext, id: string) {
	const snapshot = await grantSnapshot(context);
	const destination = pin(snapshot);
	const row = snapshot.bindings.find((r) => r.binding_id === id);
	if (!row) throw new Error("binding unavailable on this caller connection");
	if (preview(snapshot, row) === "denied")
		throw new Error("binding is subject-owned but not manageable under D-6");
	const result = await apply(context, snapshot, [], [id]);
	if (!result.ok) return { ...result, binding_ids: [id] };
	// A historical digest acknowledges an earlier request, not the current
	// binding's absence: it may have been restored since that request committed.
	const after = await grantSnapshot(context);
	if (pin(after) !== destination) throw new Error("grant destination changed; inspect again");
	if (after.bindings.some((binding) => binding.binding_id === id))
		return {
			ok: false,
			detail: "revocation not confirmed: binding remains on the caller connection",
			binding_ids: [id],
		};
	// Losing D-6 visibility can also remove a foreign binding from this view.
	// Absence is confirmable only in a complete, still-admitted read scope.
	if (
		!after.completeInventory ||
		(row.subject !== after.identity && preview(after, row) !== "admitted")
	)
		return {
			ok: false,
			detail: "revocation not confirmed: current binding read authority unavailable",
			binding_ids: [id],
		};
	return { ...result, binding_ids: [id] };
}
export interface GrantArtifact {
	format: "spellkave-grants/v1";
	manifest: string;
	receipt: {
		endpoint: string;
		world_instance_id: string;
		export_tick: string;
		coverage: "complete" | "scoped";
		artifact_digest: string;
		original_expiry: Array<{ binding_id: string; expires_at_tick: string | null }>;
	};
	envelope_digest: string;
}
export async function exportGrants(
	context: AuthorToolContext,
	out?: string,
): Promise<GrantArtifact> {
	const snapshot = await grantSnapshot(context);
	const bindings = snapshot.bindings
		.filter((r) => r.bundle_id === "")
		.sort((a, b) => a.binding_id.localeCompare(b.binding_id));
	if (bindings.some((r) => !r.subject || r.subject.startsWith("$")))
		throw new Error("export requires concrete subjects");
	const { renderSchemaManifest } = await import("@spellkave/world-author/tooling");
	const manifest = renderSchemaManifest({ schema_version: "1.0.0", role_bindings: bindings });
	const receipt: GrantArtifact["receipt"] = {
		endpoint: snapshot.endpoint,
		world_instance_id: snapshot.worldInstanceId,
		export_tick: snapshot.tick,
		coverage: snapshot.publisher ? "complete" : "scoped",
		artifact_digest: await digest(manifest),
		original_expiry: bindings.map((r) => ({
			binding_id: r.binding_id,
			expires_at_tick: r.expires_at_tick,
		})),
	};
	const artifact: GrantArtifact = {
		format: "spellkave-grants/v1",
		manifest,
		receipt,
		envelope_digest: await digest(JSON.stringify({ manifest, receipt })),
	};
	if (out) {
		if (!context.grants!.writeArtifact)
			throw new Error("this host cannot write files; omit out to receive the artifact");
		await context.grants!.writeArtifact(out, JSON.stringify(artifact, null, 2));
	}
	return artifact;
}
export interface RestorePreview {
	artifact: GrantArtifact;
	destination: string;
	sourceDigest: string;
	planDigest: string;
	rows: GrantRow[];
	expectedInstance: string;
}
export async function previewRestore(
	context: AuthorToolContext,
	artifact: GrantArtifact,
	rebase: boolean,
): Promise<RestorePreview> {
	if (artifact.format !== "spellkave-grants/v1" || !artifact.receipt.world_instance_id)
		throw new Error("invalid export envelope or unknown source instance");
	if (
		(await digest(artifact.manifest)) !== artifact.receipt.artifact_digest ||
		(await digest(JSON.stringify({ manifest: artifact.manifest, receipt: artifact.receipt }))) !==
			artifact.envelope_digest
	)
		throw new Error("modified grant artifact; export again");
	const snapshot = await grantSnapshot(context);
	const same = snapshot.worldInstanceId === artifact.receipt.world_instance_id;
	if (!same && !rebase) throw new Error("cross-epoch restore requires explicit expiry rebase");
	const { parseSchemaManifestToml } = await import("@spellkave/world-author/tooling");
	const rows = (parseSchemaManifestToml(artifact.manifest).role_bindings ?? []) as GrantRow[];
	for (const row of rows) {
		const original = artifact.receipt.original_expiry.find((r) => r.binding_id === row.binding_id);
		row.expires_at_tick = row.expires_at_tick == null ? null : String(row.expires_at_tick);
		if (!original || original.expires_at_tick !== row.expires_at_tick)
			throw new Error("export expiry receipt differs from artifact");
		if (row.expires_at_tick !== null && row.expires_at_tick !== undefined) {
			const remaining = BigInt(row.expires_at_tick) - BigInt(artifact.receipt.export_tick);
			if (remaining <= 0n) throw new Error("source grant expired; refusing reactivation");
			if (!same) row.expires_at_tick = String(BigInt(snapshot.tick) + remaining);
		}
		if (preview(snapshot, row) === "denied") throw new Error("restorer lacks D-6 authority");
	}
	grantDelta(rows, [], snapshot.worldInstanceId);
	return {
		artifact,
		destination: pin(snapshot),
		sourceDigest: artifact.envelope_digest,
		planDigest: await digest(JSON.stringify(rows)),
		rows,
		expectedInstance: snapshot.worldInstanceId,
	};
}
export async function restoreGrants(context: AuthorToolContext, prepared: RestorePreview) {
	if (
		prepared.sourceDigest !== prepared.artifact.envelope_digest ||
		(await digest(
			JSON.stringify({ manifest: prepared.artifact.manifest, receipt: prepared.artifact.receipt }),
		)) !== prepared.sourceDigest
	)
		throw new Error("artifact changed after restore preview");
	if ((await digest(JSON.stringify(prepared.rows))) !== prepared.planDigest)
		throw new Error("restore plan changed after preview");
	const snapshot = await grantSnapshot(context);
	if (pin(snapshot) !== prepared.destination)
		throw new Error("destination changed after restore preview");
	return apply(context, snapshot, prepared.rows);
}
export const grantRoleToolDef = defineTool({
	contract: GRANT_ROLE_TOOL,
	schema: GRANT_ROLE_PARAMS,
	run: async (context: AuthorToolContext, params) =>
		authoringToolResult(await grantRole(context, params)),
});
export const revokeRoleToolDef = defineTool({
	contract: REVOKE_ROLE_TOOL,
	schema: REVOKE_ROLE_PARAMS,
	run: async (context: AuthorToolContext, params) =>
		authoringToolResult(await revokeRole(context, params.binding_id)),
});
export const listGrantsToolDef = defineTool({
	contract: LIST_GRANTS_TOOL,
	schema: LIST_GRANTS_PARAMS,
	run: async (context: AuthorToolContext, params) => {
		const snapshot = await grantSnapshot(context);
		const rows = snapshot.bindings.filter(
			(r) =>
				(params.subject === undefined || r.subject === params.subject) &&
				(params.role === undefined || r.role_id === params.role) &&
				(params.extent === undefined || r.extent_ref === params.extent),
		);
		return authoringToolResult({
			ok: true,
			bindings: rows,
			coverage: snapshot.publisher ? "complete" : "scoped",
		});
	},
});
export const exportGrantsToolDef = defineTool({
	contract: EXPORT_GRANTS_TOOL,
	schema: EXPORT_GRANTS_PARAMS,
	run: async (context: AuthorToolContext, params) =>
		authoringToolResult({ ok: true, artifact: await exportGrants(context, params.out) }),
});
