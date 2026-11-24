// embedded-manifest: {"category": "production_schema_constructor", "rationale": "production renderer constructs a schema document from typed caller input", "signatures": ["schema_object", "schema_shape"]}
// Typed world-manifest authoring surface (#504).
//
// Builds typed manifest rows → a single-file world manifest (TOML). This is the
// authoring counterpart to @spellkave/sdk's runtime actor surface, and it obeys
// the same boundary (sdk CLAUDE §1/§3): it serializes *typed rows*, it does NOT
// validate. `crates/spellkave-validate` (via `r_apply_world_manifest`) is the
// only source of truth — a validator rejection is a finding, not a bug here. A
// future addition may *call* the wasm validator (`spellkave-validate-wasm`) for
// pre-apply feedback, but must never re-implement its rules.
//
// The row vocabulary is the union of what the world-explorer co-evolution loops
// author: presence (entities + actors + spatial locations) and an actionable
// affordance chain (capability → niche → affordance → action → consequence).
// Every array is optional; `renderManifest` emits only the rows present.

import { render_manifest_json_to_toml } from "@spellkave/validate-wasm";
import {
	type MetadataAttachmentRow,
	type MetadataNamespaceRow,
	toSchemaMetadataNamespaceRows,
	toSchemaMetadataRows,
} from "./metadata";

// ── Row types ────────────────────────────────────────────────────────────────

export interface BundleHeader {
	bundleId: string;
	displayName: string;
	author: string;
	version: string;
	description: string;
	dependsOn: string[];
}

export interface EntityRow {
	entityKey: string;
	name: string;
	kind: string;
	placeNodeId: string;
}

export interface ActorRow {
	entityKey: string;
	name: string;
}

export interface ActorSpatialLocationRow {
	entityKey: string;
	placeNodeId: string;
	selectionPath: string;
}

export interface ObjectStateDefinitionRow {
	stateId: string;
	/** What the flag attaches to: "entity" | "item". */
	targetKind: string;
	displayName: string;
	defaultVisibility?: string;
}

export interface CapabilityDefinitionRow {
	capabilityId: string;
	actorKind: string;
	displayName: string;
}

export interface ExtentKindDefinitionRow {
	kindId: string;
	resolutionShape: "PlaceGraph" | "Party";
	description: string;
}

export interface NicheDefinitionRow {
	nicheId: string;
	displayName: string;
}

/**
 * Binds a niche to a place node, so any target standing at that node exposes
 * the niche to affordance selection. Without this an affordance is perceived
 * but `manipulate` rejects with `predicate_rejected` (no template selected) —
 * the niche is the seam between "perceivable" and "actionable" (#504 L0c).
 */
export interface SpatialNicheAttachmentRow {
	placeNodeId: string;
	nicheId: string;
	/** Optional action dispatched after successful entry into `placeNodeId`. */
	onEntryActionId?: string;
	/** Manifest entity key passed as the entry action's target. */
	onEntryTargetEntityKey?: string;
}

export interface OutcomeTemplateRow {
	outcomeTemplateId: string;
	displayName: string;
	/** Action id this outcome resolves to (rendered as a `manipulation.action_id=` tag). */
	actionId: string;
	/** Consequence applied when an outcome graph commits this template. */
	consequenceTemplateId?: string;
}

export interface AffordanceTemplateRow {
	templateId: string;
	nicheId: string;
	capabilityId: string;
	displayName: string;
	outcomeTemplateId: string;
	rangeM?: number;
}

export interface ActionDefinitionRow {
	actionId: string;
	requiredCapability: string;
	onSuccess: string;
	displayName: string;
}

/** A single SetEntityFlag frame write — the simplest write (no item args). */
export interface SetEntityFlagWrite {
	/** Binding token: "TargetEntity" | "Actor" | a literal entity ref. */
	entity: string;
	/** Must match an authored object_state_definition.state_id. */
	flag: string;
	value: boolean;
}

export interface ConsequenceRow {
	templateId: string;
	writes: SetEntityFlagWrite[];
}

export interface ActorCapabilityGrant {
	/**
	 * Manifest key of the actor body. Cross-bundle grants (to a base actor) must
	 * use the fully-qualified `bundle:key` form (e.g. "core:core/player"); a bare
	 * key is resolved within the authoring bundle only (#504 L0c finding).
	 */
	actorEntityKey: string;
	capabilityId: string;
	source: string;
	extentRef?: string;
	extentKindRef?: string;
}

/**
 * A complete single-file world manifest. Every array is optional; presence
 * bundles populate {entities, actors, actorSpatialLocations}, actionable
 * bundles add the affordance chain. The validator decides what is admissible.
 */
export interface WorldManifest {
	header: BundleHeader;
	entities?: EntityRow[];
	actors?: ActorRow[];
	actorSpatialLocations?: ActorSpatialLocationRow[];
	objectStateDefinitions?: ObjectStateDefinitionRow[];
	capabilityDefinitions?: CapabilityDefinitionRow[];
	extentKindDefinitions?: ExtentKindDefinitionRow[];
	nicheDefinitions?: NicheDefinitionRow[];
	spatialNicheAttachments?: SpatialNicheAttachmentRow[];
	outcomeTemplates?: OutcomeTemplateRow[];
	affordanceTemplates?: AffordanceTemplateRow[];
	actionDefinitions?: ActionDefinitionRow[];
	consequences?: ConsequenceRow[];
	actorCapabilities?: ActorCapabilityGrant[];
	metadataNamespaces?: MetadataNamespaceRow[];
	metadataAttachments?: MetadataAttachmentRow[];
}

type SchemaManifest = Record<string, unknown>;

function withRows<T>(target: SchemaManifest, key: string, rows: T[] | undefined): void {
	if (rows && rows.length > 0) target[key] = rows;
}

export function toSchemaManifest(manifest: WorldManifest): SchemaManifest {
	const b = manifest.header;
	const schema: SchemaManifest = {
		schema_version: "1.0.0",
		metadata: { profile: b.bundleId },
	};

	withRows(schema, "bundles", [
		{
			bundle_id: b.bundleId,
			display_name: b.displayName,
			author: b.author,
			version: b.version,
			depends_on: b.dependsOn,
			description: b.description,
		},
	]);
	withRows(
		schema,
		"entities",
		manifest.entities?.map((e) => ({
			entity_key: e.entityKey,
			bundle_id: b.bundleId,
			name: e.name,
			kind: e.kind,
			place_node_id: e.placeNodeId,
		})),
	);
	withRows(
		schema,
		"actors",
		manifest.actors?.map((a) => ({
			entity_key: a.entityKey,
			bundle_id: b.bundleId,
			name: a.name,
		})),
	);
	withRows(
		schema,
		"actor_spatial_locations",
		manifest.actorSpatialLocations?.map((l) => ({
			entity_key: l.entityKey,
			place_node_id: l.placeNodeId,
			bundle_id: b.bundleId,
			selection_path: l.selectionPath,
		})),
	);
	withRows(
		schema,
		"object_state_definitions",
		manifest.objectStateDefinitions?.map((s) => ({
			state_id: s.stateId,
			bundle_id: b.bundleId,
			target_kind: s.targetKind,
			display_name: s.displayName,
			default_visibility: s.defaultVisibility ?? "Public",
		})),
	);
	withRows(
		schema,
		"capability_definitions",
		manifest.capabilityDefinitions?.map((c) => ({
			capability_id: c.capabilityId,
			bundle_id: b.bundleId,
			actor_kind: c.actorKind,
			display_name: c.displayName,
			description: c.displayName,
		})),
	);
	withRows(
		schema,
		"extent_kind_definitions",
		manifest.extentKindDefinitions?.map((e) => ({
			kind_id: e.kindId,
			resolution_shape: e.resolutionShape,
			bundle_id: b.bundleId,
			description: e.description,
		})),
	);
	withRows(
		schema,
		"niche_definitions",
		manifest.nicheDefinitions?.map((n) => ({
			niche_id: n.nicheId,
			bundle_id: b.bundleId,
			display_name: n.displayName,
			description: n.displayName,
		})),
	);
	withRows(
		schema,
		"spatial_niche_attachments",
		manifest.spatialNicheAttachments?.map((a) => ({
			bundle_id: b.bundleId,
			place_node_id: a.placeNodeId,
			niche_id: a.nicheId,
			...(a.onEntryActionId === undefined ? {} : { on_entry_action_id: a.onEntryActionId }),
			...(a.onEntryTargetEntityKey === undefined
				? {}
				: { on_entry_target_entity_key: a.onEntryTargetEntityKey }),
		})),
	);
	withRows(
		schema,
		"outcome_templates",
		manifest.outcomeTemplates?.map((o) => ({
			outcome_template_id: o.outcomeTemplateId,
			bundle_id: b.bundleId,
			display_name: o.displayName,
			outcome_bool: true,
			manipulation_action_id: o.actionId,
			...(o.consequenceTemplateId === undefined
				? {}
				: { consequence_template_id: o.consequenceTemplateId }),
		})),
	);
	withRows(
		schema,
		"affordance_templates",
		manifest.affordanceTemplates?.map((a) => ({
			template_id: a.templateId,
			bundle_id: b.bundleId,
			niche_id: a.nicheId,
			capability_id: a.capabilityId,
			display_name: a.displayName,
			predicate_bool: true,
			outcome_template_id: a.outcomeTemplateId,
			...(a.rangeM === undefined ? {} : { range_m: a.rangeM }),
		})),
	);
	withRows(
		schema,
		"action_definitions",
		manifest.actionDefinitions?.map((a) => ({
			action_id: a.actionId,
			bundle_id: b.bundleId,
			required_capability: a.requiredCapability,
			on_success: a.onSuccess,
			display_name: a.displayName,
		})),
	);
	withRows(
		schema,
		"consequence_templates",
		manifest.consequences?.map((c) => ({
			template_id: c.templateId,
			bundle_id: b.bundleId,
		})),
	);
	withRows(
		schema,
		"consequence_frame_writes",
		manifest.consequences?.flatMap((c) =>
			c.writes.map((write, ordinal) => ({
				template_id: c.templateId,
				ordinal,
				frame_write: {
					SetEntityFlag: {
						entity: write.entity,
						flag: write.flag,
						value: write.value,
					},
				},
			})),
		),
	);
	withRows(
		schema,
		"actor_capabilities",
		manifest.actorCapabilities?.map((g) => ({
			actor_entity_key: g.actorEntityKey,
			capability_id: g.capabilityId,
			source: g.source,
			bundle_id: b.bundleId,
			extent_ref: g.extentRef ?? "",
			extent_kind_ref: g.extentKindRef ?? "",
		})),
	);
	withRows(
		schema,
		"metadata_namespaces",
		toSchemaMetadataNamespaceRows(b.bundleId, manifest.metadataNamespaces),
	);
	withRows(
		schema,
		"metadata_attachments",
		toSchemaMetadataRows(b.bundleId, manifest.metadataAttachments),
	);

	return schema;
}

/** Serialize a manifest to a single-file world manifest. Validated on apply. */
export function renderManifest(manifest: WorldManifest): string {
	return render_manifest_json_to_toml(JSON.stringify(toSchemaManifest(manifest)));
}

/** Render a typed schema-shaped manifest object through the Rust/wasm renderer. */
export function renderSchemaManifest(manifest: Record<string, unknown>): string {
	return render_manifest_json_to_toml(JSON.stringify(manifest));
}

const APPLYSET_NAME = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Name the applyset a ROOT manifest belongs to (ADR-0145 D-1): sets the
 * top-level `applyset = "<name>"` right after `schema_version`, replacing an
 * existing one. Generators call this on every root they write; include
 * fragments never carry the field.
 */
export function withRootApplyset(rootToml: string, name: string): string {
	if (!APPLYSET_NAME.test(name)) {
		throw new Error(`invalid applyset name '${name}': use [a-z0-9][a-z0-9._-]*`);
	}
	const line = `applyset = "${name}"`;
	if (/^applyset\s*=.*$/m.test(rootToml)) {
		return rootToml.replace(/^applyset\s*=.*$/m, line);
	}
	if (!/^schema_version\s*=.*$/m.test(rootToml)) {
		throw new Error("withRootApplyset: not a root manifest (no schema_version line)");
	}
	return rootToml.replace(/^(schema_version\s*=.*)$/m, `$1\n${line}`);
}

/** Render schema-shaped manifest JSON through the Rust/wasm renderer. */
export function renderSchemaManifestJson(manifestJson: string): string {
	return render_manifest_json_to_toml(manifestJson);
}
