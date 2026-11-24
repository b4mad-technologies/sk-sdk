// embedded-manifest: {"category":"production_schema_constructor","rationale":"The local ordinary-kind compiler publishes bounded client-readable configuration through existing metadata namespaces and narrow read grants.","signatures":["schema_object","schema_shape"]}
/** Ordinary-kind metadata compiler. No world connection, engine callbacks,
 * bindings, drive authority, scripts or hosted publication side effects. */
import { serviceOnlyAudienceTag } from "./service-only-audience";

export { SERVICE_ONLY_AUDIENCE_TAG } from "./service-only-audience";

export type NpcKindJson =
	| null
	| boolean
	| number
	| string
	| NpcKindJson[]
	| { [key: string]: NpcKindJson };
type Row = Record<string, NpcKindJson>;
export type OrdinaryNpcKind = "menu-talker" | "role-combatant" | "companion";
export interface NpcKindActor {
	readonly actor_key: string;
	/** An unplaced late-cast blueprint receives only metadata-read capabilities. */
	readonly blueprint_id?: string;
}
export interface NpcKindGroup {
	readonly key: string;
	readonly npc_kind: OrdinaryNpcKind;
	readonly actors: readonly NpcKindActor[];
	readonly config: Row;
}
export interface NpcKindSource {
	readonly bundle_id: string;
	readonly namespace_prefix: string;
	readonly catalog: Row;
	readonly groups: readonly NpcKindGroup[];
}
export interface NpcKindMount {
	actor_key: string;
	npc_kind: OrdinaryNpcKind;
	schema_version: 1;
	document_namespace: string;
	catalog_namespace: string;
	catalog_content_hash: string;
}
export interface NpcKindArtifact {
	schema_version: 1;
	source_content_hash: string;
	/** The fixed-point source every row below is derived from: integer-only
	 * wire values, the form `source_content_hash` is taken over. A consumer
	 * that may not run the authoring code re-derives the artifact from it
	 * (`parseNpcKindArtifact`). */
	source: NpcKindSource;
	manifest: Row;
	mounts: NpcKindMount[];
}
/** Add only the compiler-owned metadata/read-grant tables to a transient
 * local world. Existing loader validation still owns all row references. */
export function composeNpcKindWorld(
	world: Record<string, unknown>,
	artifact: NpcKindArtifact,
): Record<string, unknown> {
	const result = { ...world };
	for (const [kind, rows] of Object.entries(artifact.manifest)) {
		if (kind === "schema_version") continue;
		if (
			![
				"capability_definitions",
				"capability_definition_tag",
				"role_definitions",
				"role_bindings",
				"actor_capabilities",
				"entity_definition_initial_capability",
				"metadata_namespaces",
				"metadata_attachments",
			].includes(kind) ||
			!Array.isArray(rows) ||
			(result[kind] !== undefined && !Array.isArray(result[kind]))
		)
			throw new Error("Invalid NPC kind composition table");
		result[kind] = [...((result[kind] as unknown[] | undefined) ?? []), ...rows];
	}
	return result;
}
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
			.join(",")}}`;
	const encoded = JSON.stringify(value);
	if (
		encoded === undefined ||
		(typeof value === "number" && (!Number.isSafeInteger(value) || value < 0))
	)
		throw new Error("NPC kind documents require unsigned JSON-safe integer wire values");
	return encoded;
}
async function hash(value: unknown): Promise<string> {
	const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
	return `sha256:${Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function bounded(payload: unknown): string {
	const encoded = canonical(payload);
	if (new TextEncoder().encode(encoded).byteLength > 256 * 1024)
		throw new Error("NPC kind document exceeds the metadata admission bound");
	return encoded;
}
const PARAM_UNITS = {
	minRangeCells: "minRangeCellsMilli",
	fleeHpFraction: "fleeHpPermille",
	holdUntilCells: "holdUntilCellsMilli",
	healAllyBelowFraction: "healAllyBelowPermille",
};
const VOCABULARY_UNITS = {
	defaultMeleeReach: "defaultMeleeReachCellsMilli",
	flankBonus: "flankBonusPermille",
	adjacencyCells: "adjacencyCellsMilli",
};
function scaled(value: NpcKindJson): NpcKindJson {
	if (value === null) return null;
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		!Number.isSafeInteger(value * 1000) ||
		(value * 1000) / 1000 !== value
	)
		throw new Error("Ordinary NPC numeric parameter is not exact at milli/permille scale");
	return value * 1000;
}
function fixedFields(
	value: NpcKindJson | undefined,
	units: Record<string, string>,
): NpcKindJson | undefined {
	if (value === undefined || value === null) return value;
	if (typeof value !== "object" || Array.isArray(value))
		throw new Error("Ordinary NPC parameter object required");
	const result = { ...value };
	for (const [source, target] of Object.entries(units))
		if (Object.hasOwn(value, source)) {
			if (Object.hasOwn(value, target)) throw new Error("Duplicate ordinary NPC parameter unit");
			result[target] = scaled(value[source]!);
			delete result[source];
		}
	return result;
}
function fixedActions(value: NpcKindJson | undefined): NpcKindJson | undefined {
	if (value === undefined || value === null) return value;
	if (typeof value !== "object" || Array.isArray(value))
		throw new Error("Ordinary NPC action object required");
	const result = { ...value };
	if (Object.hasOwn(value, "attackRangeCells")) {
		const ranges = value.attackRangeCells;
		if (
			ranges === null ||
			typeof ranges !== "object" ||
			Array.isArray(ranges) ||
			Object.hasOwn(value, "attackRangeCellsMilli")
		)
			throw new Error("Ordinary NPC action range object required");
		result.attackRangeCellsMilli = Object.fromEntries(
			Object.entries(ranges).map(([id, range]) => [id, scaled(range)]),
		);
		delete result.attackRangeCells;
	}
	return result;
}
function fixedCombat(config: Row): Row {
	const result = { ...config };
	if (Object.hasOwn(result, "params")) result.params = fixedFields(result.params, PARAM_UNITS)!;
	if (Object.hasOwn(result, "actions")) result.actions = fixedActions(result.actions)!;
	return result;
}
/** UAC16744: ordinary envelopes use named fixed-point integers. The shared
 * quest/DM hash continues to admit only unsigned JSON-safe integers. */
function fixedSource(source: NpcKindSource): NpcKindSource {
	const catalog = { ...source.catalog };
	if (catalog.role_vocabulary !== undefined)
		catalog.role_vocabulary = fixedFields(catalog.role_vocabulary, VOCABULARY_UNITS)!;
	if (catalog.roles !== undefined) {
		if (catalog.roles === null || typeof catalog.roles !== "object" || Array.isArray(catalog.roles))
			throw new Error("Ordinary NPC role map required");
		catalog.roles = Object.fromEntries(
			Object.entries(catalog.roles).map(([role, params]) => [
				role,
				fixedFields(params, PARAM_UNITS)!,
			]),
		);
	}
	if (
		catalog.combat !== undefined &&
		catalog.combat !== null &&
		typeof catalog.combat === "object" &&
		!Array.isArray(catalog.combat)
	)
		catalog.combat = fixedCombat(catalog.combat);
	return {
		...source,
		catalog,
		groups: source.groups.map((group) => {
			if (group.npc_kind === "role-combatant")
				return { ...group, config: fixedCombat(group.config) };
			if (
				group.npc_kind === "companion" &&
				group.config.combat !== null &&
				typeof group.config.combat === "object" &&
				!Array.isArray(group.config.combat)
			)
				return { ...group, config: { ...group.config, combat: fixedCombat(group.config.combat) } };
			return group;
		}),
	};
}
/** One shared role document covers an authored encounter cast. Other groups
 * have an entity-targeted document unless a late blueprint requires a bundle
 * attachment. Every document lists its admitted actor keys explicitly. */
export async function compileNpcKindDocuments(source: NpcKindSource): Promise<NpcKindArtifact> {
	source = fixedSource(source);
	if (
		!source.bundle_id ||
		!source.namespace_prefix ||
		/\s/.test(source.namespace_prefix) ||
		source.groups.length < 1 ||
		source.groups.length > 128
	)
		throw new Error("Invalid NPC kind source bounds");
	const keys = new Set<string>();
	const actors = new Set<string>();
	for (const group of source.groups) {
		if (
			!/^[a-z0-9-]+$/.test(group.key) ||
			keys.has(group.key) ||
			!["menu-talker", "role-combatant", "companion"].includes(group.npc_kind) ||
			group.actors.length < 1 ||
			group.actors.length > 128 ||
			(group.actors.length > 1 && group.npc_kind !== "role-combatant")
		)
			throw new Error("Invalid or duplicate NPC kind group");
		keys.add(group.key);
		for (const actor of group.actors) {
			if (!actor.actor_key || actors.has(actor.actor_key) || actor.blueprint_id === "")
				throw new Error("Invalid or duplicate NPC kind actor");
			actors.add(actor.actor_key);
		}
	}
	const digest = await hash(source);
	const publication = `source:${digest}`;
	const prefix = source.namespace_prefix;
	const catalogNamespace = `${prefix}/catalog`;
	const catalogCapability = `${prefix}/read-catalog`;
	const catalogContent = { ...source.catalog, schema_version: 1 };
	const catalogHash = await hash(catalogContent);
	const bundle = source.bundle_id;
	const rows: Record<string, Row[]> = {
		capability_definitions: [],
		capability_definition_tag: [],
		role_definitions: [],
		role_bindings: [],
		actor_capabilities: [],
		entity_definition_initial_capability: [],
		metadata_namespaces: [],
		metadata_attachments: [],
	};
	const capability = (id: string) => {
		rows.capability_definitions!.push({
			bundle_id: bundle,
			capability_id: id,
			actor_kind: "entity",
			display_name: "Read NPC configuration",
			description: "Read the declared ordinary-kind metadata audience",
			default_visibility: "Public",
		});
		// Service identities only: no person reads NPC configuration.
		rows.capability_definition_tag!.push(serviceOnlyAudienceTag(bundle, id));
	};
	const attachment = (kind: string, target: string, namespace: string, payload: unknown) =>
		rows.metadata_attachments!.push({
			bundle_id: bundle,
			target_kind: kind,
			target_ref: target,
			namespace,
			payload_json: bounded(payload),
			source: "manifest",
		});
	capability(catalogCapability);
	rows.metadata_namespaces!.push({
		bundle_id: bundle,
		namespace: catalogNamespace,
		audience: catalogCapability,
		on_demand: false,
	});
	attachment("bundle", bundle, catalogNamespace, {
		...catalogContent,
		content_hash: catalogHash,
		publication_id: publication,
	});
	const mounts: NpcKindMount[] = [];
	const privateCaps: string[] = [];
	for (const group of source.groups) {
		const namespace = `${prefix}/${group.key}`;
		const read = `${prefix}/read-${group.key}`;
		privateCaps.push(read);
		capability(read);
		rows.metadata_namespaces!.push({
			bundle_id: bundle,
			namespace,
			audience: read,
			on_demand: false,
		});
		const content = {
			schema_version: 1,
			npc_kind: group.npc_kind,
			actor_keys: group.actors.map((actor) => actor.actor_key),
			adapter_id: `${group.npc_kind}/v1`,
			catalog_content_hash: catalogHash,
			config: group.config,
			hooks: {},
		};
		const single = group.actors.length === 1 && group.actors[0]!.blueprint_id === undefined;
		attachment(
			single ? "entity" : "bundle",
			single ? group.actors[0]!.actor_key : bundle,
			namespace,
			{ ...content, content_hash: await hash(content), publication_id: publication },
		);
		for (const actor of group.actors) {
			for (const capability_id of [catalogCapability, read]) {
				if (actor.blueprint_id !== undefined)
					rows.entity_definition_initial_capability!.push({
						bundle_id: bundle,
						entity_def_id: actor.blueprint_id,
						capability_id,
						extent_kind_ref: "",
						extent_ref: "",
					});
				else
					rows.actor_capabilities!.push({
						bundle_id: bundle,
						actor_entity_key: actor.actor_key,
						capability_id,
						source: bundle,
						source_args_hash: "",
						elevation_class: "",
						extent_kind_ref: "",
						extent_ref: "",
					});
			}
			mounts.push({
				actor_key: actor.actor_key,
				npc_kind: group.npc_kind,
				schema_version: 1,
				document_namespace: namespace,
				catalog_namespace: catalogNamespace,
				catalog_content_hash: catalogHash,
			});
		}
	}
	const role_id = `${prefix}/publisher-reader`;
	rows.role_definitions!.push({
		bundle_id: bundle,
		role_id,
		display_name: "NPC configuration publisher reader",
		description: "Read configuration metadata for publication readback",
		capability_ids: [catalogCapability, ...privateCaps],
	});
	rows.role_bindings!.push({
		bundle_id: bundle,
		binding_id: `${prefix}/publisher-reader`,
		subject: "$sender",
		role_id,
		extent_kind_ref: "bundle",
		extent_ref: bundle,
		description: "Read ordinary-kind publication",
	});
	return {
		schema_version: 1,
		source_content_hash: digest,
		source,
		manifest: { schema_version: "1.0.0", ...rows },
		mounts,
	};
}
/** Admit a sealed ordinary-kind artifact without running the code that
 * authored it. The complete row set is re-derived from the carried source by
 * the generic compiler above and compared canonically, so extra rows, changed
 * grants, changed document content, a source that is not its own fixed point
 * and unknown envelope fields all refuse. Re-derivation also proves that no
 * document carries hooks. Row references are not checked here: the loader
 * that applies the rows owns that, and the caller binds them to a world. */
export async function parseNpcKindArtifact(json: string): Promise<NpcKindArtifact> {
	const refuse = (): never => {
		throw new Error("NPC kind artifact digest or derived rows mismatch");
	};
	let value: unknown;
	let expected: NpcKindArtifact;
	try {
		value = JSON.parse(json);
		const source = (value as { source?: unknown } | null)?.source;
		if (source === null || typeof source !== "object" || Array.isArray(source)) return refuse();
		expected = await compileNpcKindDocuments(source as NpcKindSource);
		if (canonical(value) !== canonical(expected)) return refuse();
	} catch {
		return refuse();
	}
	return expected;
}
