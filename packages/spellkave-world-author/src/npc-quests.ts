// embedded-manifest: {"category":"production_schema_constructor","rationale":"The quest compiler constructs a transient schema envelope from validated authored rows for metadata publication and reference closure.","signatures":["schema_object","schema_shape"]}
/** ADR-0165: one authoring compiler, JSON carrier, no adventure code at publish. */
import { parse } from "smol-toml";
import {
	validate_npc_quest_references_json,
	validate_npc_quest_source_json,
} from "@spellkave/validate-wasm";
import { serviceOnlyAudienceTag } from "./service-only-audience";

export { SERVICE_ONLY_AUDIENCE_TAG } from "./service-only-audience";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };
interface Source extends Row {
	schema_version: number;
	bundle_id: string;
	catalog_namespace: string;
	catalog_read_capability_id: string;
	publisher_reader_role_id: string;
	publisher_reader_binding_id: string;
	known_missing_flags: Row;
	bindings: Row;
	quests: Row[];
	givers: Row[];
}
export interface NpcQuestMount {
	actor_key: string;
	npc_kind: "quest-giver";
	schema_version: 1;
	document_namespace: string;
	catalog_namespace: string;
	catalog_content_hash: string;
}
/** Job-only authoring carrier. Never mount this source/artifact in the host. */
export interface NpcQuestArtifact {
	schema_version: 1;
	artifact_digest: string;
	source_content_hash: string;
	catalog_content_hash: string;
	source: Source;
	manifest: Row;
	mounts: NpcQuestMount[];
	reference_diagnostics: NpcQuestReferenceDiagnostic[];
}
export interface NpcQuestReferenceDiagnostic {
	severity: "error" | "known-missing";
	code: string;
	reference_kind: string;
	reference_id: string;
	bead?: string;
}
export interface CompiledNpcQuests {
	artifact: NpcQuestArtifact;
	/** Static loader input for existing TS consumers, generated from the SAME source. */
	legacy: {
		quests: Row[];
		promptLinesByQuest: Row;
		spokenLinesByQuest: Row;
		bindingsByQuest: Row;
		runtimeBindings: Row;
	};
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object") {
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, value]) => `${JSON.stringify(key)}:${canonical(value)}`)
			.join(",")}}`;
	}
	const encoded = JSON.stringify(value);
	if (encoded === undefined) throw new Error("NPC documents require JSON values");
	return encoded;
}
async function digest(value: unknown): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
	return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function checkedSource(value: unknown): Source {
	const encoded = JSON.stringify(value);
	if (encoded === undefined) throw new Error("NPC quest source is missing");
	const errors: string[] = JSON.parse(validate_npc_quest_source_json(encoded));
	if (errors.length) throw new Error(`Invalid NPC quest source: ${errors.join("; ")}`);
	return JSON.parse(encoded) as Source;
}
const legacyKeys = [
	"id",
	"name",
	"rung",
	"giverKey",
	"giverName",
	"acceptSlot",
	"declineSlot",
	"promptId",
	"slotAcceptText",
	"slotDeclineText",
	"objective",
	"terminal",
	"rewardXp",
	"bonusXp",
	"bonusFlag",
	"killXpCreatures",
];
const driverKeys = [
	"minimum_level",
	"progress_home",
	"progress_state_id",
	"rewarded_state_id",
	"awarded_state_id",
	"acceptance_action_id",
	"award_action_id",
	"settle_action_id",
];
function pick(row: Row, keys: string[]): Row {
	return Object.fromEntries(keys.filter((key) => key in row).map((key) => [key, row[key]!]));
}
async function compileSource(
	source: Source,
	referenceDiagnostics: NpcQuestReferenceDiagnostic[],
): Promise<CompiledNpcQuests> {
	const sourceHash = await digest(source);
	const publication = `source:${sourceHash}`;
	const vocabulary: Row = {
		speechTraceKindId: source.bindings.speech_trace_kind_id!,
		speakActionId: source.bindings.speak_action_id!,
		choiceActions: source.bindings.choice_actions!,
		openActions: source.bindings.open_actions!,
		promptActions: source.bindings.prompt_actions!,
	};
	const runtimeBindings = {
		hero_blueprint_id: source.bindings.hero_blueprint_id!,
		level_state_id: source.bindings.level_state_id!,
		drafting_condition_id: source.bindings.drafting_condition_id!,
		answer_count: source.bindings.answer_count!,
		flag_state_ids: source.bindings.flag_state_ids!,
		vocabulary,
	};
	const catalogContent = {
		schema_version: 1,
		bindings: runtimeBindings,
		quests: source.quests.map((quest) => pick(quest, [...legacyKeys, ...driverKeys])),
	};
	const catalogHash = await digest(catalogContent);
	const catalog = { ...catalogContent, content_hash: catalogHash, publication_id: publication };
	const bundle = source.bundle_id;
	const capability = (id: string) => ({
		bundle_id: bundle,
		capability_id: id,
		actor_kind: "entity",
		display_name: "Read NPC authoring document",
		description: "Read only the declared NPC metadata audience",
		default_visibility: "Public",
	});
	const role = (id: string, capabilities: string[]) => ({
		bundle_id: bundle,
		role_id: id,
		display_name: "NPC document reader",
		description: "Read declared NPC metadata without action or authoring authority",
		capability_ids: capabilities,
	});
	const binding = (id: string, subject: string, roleId: string) => ({
		bundle_id: bundle,
		binding_id: id,
		subject,
		role_id: roleId,
		extent_kind_ref: "bundle",
		extent_ref: bundle,
		description: "Read NPC authoring documents",
	});
	const namespace = (name: string, audience: string) => ({
		bundle_id: bundle,
		namespace: name,
		audience,
		on_demand: false,
	});
	const attachment = (kind: string, ref: string, name: string, payload: unknown) => ({
		bundle_id: bundle,
		target_kind: kind,
		target_ref: ref,
		namespace: name,
		payload_json: canonical(payload),
		source: "manifest",
	});
	const privateCaps = source.givers.map((giver) => String(giver.read_capability_id));
	const publisherRole = source.publisher_reader_role_id;
	const manifests: Record<string, Row[]> = {
		capability_definitions: [
			capability(source.catalog_read_capability_id),
			...privateCaps.map(capability),
		],
		capability_definition_tag: [source.catalog_read_capability_id, ...privateCaps].map((id) =>
			serviceOnlyAudienceTag(bundle, id),
		),
		role_definitions: [role(publisherRole, [source.catalog_read_capability_id, ...privateCaps])],
		role_bindings: [binding(source.publisher_reader_binding_id, "$sender", publisherRole)],
		actor_capabilities: [],
		metadata_namespaces: [namespace(source.catalog_namespace, source.catalog_read_capability_id)],
		metadata_attachments: [attachment("bundle", bundle, source.catalog_namespace, catalog)],
	};
	const mounts: NpcQuestMount[] = [];
	for (const giver of source.givers) {
		const actor = String(giver.actor_key);
		const refs = giver.quest_refs as string[];
		const lines = Object.fromEntries(
			refs.map((id) => [id, source.quests.find((quest) => quest.id === id)!.spoken_lines!]),
		);
		const content = {
			schema_version: 1,
			npc_kind: "quest-giver",
			adapter_id: "quest-board/v1",
			catalog_content_hash: catalogHash,
			quest_refs: refs,
			lines,
			hooks: {},
		};
		const payload = {
			...content,
			content_hash: await digest(content),
			publication_id: publication,
		};
		for (const capabilityId of [
			String(giver.read_capability_id),
			source.catalog_read_capability_id,
		]) {
			manifests.actor_capabilities!.push({
				actor_entity_key: actor,
				bundle_id: bundle,
				capability_id: capabilityId,
				source: bundle,
				source_args_hash: "",
				elevation_class: "",
				extent_kind_ref: "",
				extent_ref: "",
			});
		}
		manifests.metadata_namespaces!.push(
			namespace(String(giver.namespace), String(giver.read_capability_id)),
		);
		manifests.metadata_attachments!.push(
			attachment("entity", actor, String(giver.namespace), payload),
		);
		mounts.push({
			actor_key: actor,
			npc_kind: "quest-giver",
			schema_version: 1,
			document_namespace: String(giver.namespace),
			catalog_namespace: source.catalog_namespace,
			catalog_content_hash: catalogHash,
		});
	}
	const manifest: Row = { schema_version: "1.0.0", ...manifests };
	const body = {
		schema_version: 1 as const,
		source_content_hash: sourceHash,
		catalog_content_hash: catalogHash,
		source,
		manifest,
		mounts,
		reference_diagnostics: referenceDiagnostics,
	};
	return {
		artifact: { ...body, artifact_digest: await digest(body) },
		legacy: {
			quests: source.quests.map((quest) => pick(quest, legacyKeys)),
			promptLinesByQuest: Object.fromEntries(
				source.quests.map((quest) => [String(quest.id), quest.prompt_lines!]),
			),
			spokenLinesByQuest: Object.fromEntries(
				source.quests.map((quest) => [String(quest.id), quest.spoken_lines!]),
			),
			bindingsByQuest: Object.fromEntries(
				source.quests.map((quest) => [String(quest.id), pick(quest, driverKeys)]),
			),
			runtimeBindings,
		},
	};
}
/** No random publication ids, IO, world connection or authority-bearing callbacks. */
export async function compileNpcQuestSource(
	toml: string,
	canonicalWorlds: readonly unknown[],
): Promise<CompiledNpcQuests> {
	const source = checkedSource(parse(toml));
	return compileSource(source, checkedReferences(source, canonicalWorlds));
}
/** Loader generation precedes world generation. This returns no publishable
 * artifact; sealing one requires compileNpcQuestSource's canonical world input. */
export async function compileNpcQuestLegacySource(
	toml: string,
): Promise<CompiledNpcQuests["legacy"]> {
	return (await compileSource(checkedSource(parse(toml)), [])).legacy;
}
function checkedReferences(
	source: Source,
	canonicalWorlds: readonly unknown[],
): NpcQuestReferenceDiagnostic[] {
	const diagnostics: NpcQuestReferenceDiagnostic[] = JSON.parse(
		validate_npc_quest_references_json(JSON.stringify(source), JSON.stringify(canonicalWorlds)),
	);
	if (diagnostics.some((diagnostic) => diagnostic.severity === "error"))
		throw new Error(`Invalid NPC quest references: ${JSON.stringify(diagnostics)}`);
	return diagnostics;
}
/** Future artifact-consumer integration is owned by sk-jay0.3.33.32.
 * Re-derive the complete row set from the Rust-validated sealed source. Extra
 * rows, changed grants, changed private content or unknown envelope fields refuse. */
export async function parseNpcQuestArtifact(
	json: string,
	canonicalWorlds: readonly unknown[],
): Promise<NpcQuestArtifact> {
	const value: unknown = JSON.parse(json);
	const source = (value as { source?: unknown } | null)?.source;
	const admitted = checkedSource(source);
	const expected = (await compileSource(admitted, checkedReferences(admitted, canonicalWorlds)))
		.artifact;
	if (canonical(value) !== canonical(expected))
		throw new Error("NPC quest artifact digest or derived rows mismatch");
	return expected;
}
