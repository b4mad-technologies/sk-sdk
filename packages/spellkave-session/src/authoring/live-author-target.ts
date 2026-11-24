// The connection-level `AuthorTarget` (#1968 "Decision: connection-level
// target for the author tools"): a uniform backend interface every AUTHOR
// write verb's reference checks and `spellkave_apply_manifest_delta` flush
// against, replacing the ad hoc "check the workspace, then optionally check
// `context.db` if it's wired" pattern each verb used to hand-roll.
//
// This session adapter owns only `live`: it reads through the connected SDK
// snapshot thunk and dispatches `applyBatch` through the optional
// `r_apply_manifest_delta` port. The filesystem-backed `local` adapter is
// exclusively `@spellkave/tool-node/authoring`.
//
// Dependency-direction note: `resolveRef`/`lookup` take a manifest ROW-KIND
// name (a key of `@spellkave/world-author`'s `ROW_KIND_NATURAL_KEY`) — the
// SAME vocabulary the workspace's own upsert-by-key merge already uses
// (`authoring-verbs.ts`), not a new verb-facing enum. `live` is a BOUNDED,
// honestly-documented table (`LIVE_TABLE_ACCESSORS` below) —
// only the row kinds an actual AUTHOR-tool ref-check or `spellkave_lookup`
// kind needs, because (unlike `local`, which just returns parsed TOML rows
// verbatim) mapping a LIVE table's camelCase SDK row shape back to the
// manifest's snake_case row shape needs a per-table accessor, and inventing
// one for a row kind nothing currently queries would be untested guesswork.

import type { AuthorSnapshotDb, AuthorTarget, ManifestRow } from "@spellkave/tool-authoring";
import {
	type ScopedInstanceSnapshot,
	type ScopedSnapshotPort,
	scopedInlineDeltaPreflight,
} from "@spellkave/world-author/tooling";

// ---------------------------------------------------------------------------
// `live` driver
// ---------------------------------------------------------------------------

interface TableHandleLike {
	iter(): Iterable<Record<string, unknown>>;
}

/**
 * SpacetimeDB no-payload-enum shape: a client-side row field for a Rust
 * `#[derive(SpacetimeType)]` unit-variant enum (e.g. `ModifierTargetShape`,
 * `ModifierDeltaTag`) surfaces as a tagged object `{ tag: "VariantName" }`,
 * never a bare string — confirmed against the generated bindings
 * (`packages/spellkave-bindings/src/module_bindings/types.ts`'s
 * `__t.enum(...)` builders for both types) and the repo-wide convention
 * `@spellkave/sdk`'s own internal `core/readers/_helpers.ts` `tagString`
 * documents ("SpacetimeDB tagged-enum shape: `{ tag: "VariantName", value?:
 * ... }`. Used by world_event.kind, evaluation_provenance.kind/status,
 * etc."). Duplicated here (not imported — that helper is `@spellkave/sdk`
 * package-internal, not part of its public surface) rather than widening a
 * cross-package dependency for four lines of tag-unwrapping.
 */
function liveEnumTag(value: unknown): string {
	if (typeof value === "string") return value;
	if (value !== null && typeof value === "object") {
		const tag = (value as { tag?: unknown }).tag;
		if (typeof tag === "string") return tag;
	}
	return String(value);
}

/** Optional u64 wire values remain exact beyond the JSON safe-integer range. */
function optionalTick(value: unknown): number | string | null {
	if (value === undefined || value === null) return null;
	if (typeof value === "bigint")
		return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : String(value);
	return typeof value === "number" ? value : String(value);
}

/**
 * Unwrap a live `i64`/`u64` column back to a plain JS number. The manifest
 * schema's own integer fields are never BigInt-typed, but the generated SDK
 * surfaces every i64/u64 column as a genuine `bigint` — confirmed empirically
 * against a real live connection (`resource_definition.minValue`/
 * `action_definition.costTimeMs` etc. are `typeof value === "bigint"`, never
 * `"number"`), NOT against `i32`/`u8`-shaped columns (`modifier_template.
 * priority`, `economy_channel_definitions.pool_ms_per_round`), which the same
 * probe showed already surface as plain `number`. Executable finding #44
 * (`@spellkave/srd-cc`'s `ledger/findings.md`): `toolResult`'s
 * `JSON.stringify` (`authoring-verbs.ts`) throws outright on a raw `bigint`
 * ("Do not know how to serialize a BigInt") — this was never exercised
 * before the DISCOVERY-CLOSURE test's live tier, because no prior test drove
 * `spellkave_query`'s own JSON-serializing tool-result path against a REAL
 * connected db (`fixtures-author-tool.test.ts` only exercises the `local`
 * target, whose parsed-TOML rows are already plain numbers). Safe to
 * `Number(...)`: every value these columns carry in practice (resource
 * bounds, ms-scoped time costs, DC integers) sits far under
 * `Number.MAX_SAFE_INTEGER`.
 */
function liveInt(value: unknown): number | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "bigint") {
		// Fail CLOSED on precision loss instead of silently narrowing: every
		// current consumer's domain sits far under 2^53 (doc note above), so a
		// violation here means the domain assumption broke — surface it loudly.
		if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new Error(
				`liveInt: bigint ${value} exceeds Number.MAX_SAFE_INTEGER — refusing silent precision loss.`,
			);
		}
		return Number(value);
	}
	if (typeof value === "number") return value;
	return Number(value);
}

/** Convert the generated SDK's tag-prefix mirror back to manifest field names. */
function liveTagPrefixes(value: unknown): ManifestRow[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter(
			(entry): entry is Record<string, unknown> => entry !== null && typeof entry === "object",
		)
		.map((entry) => ({
			prefix: entry.prefix,
			target_kind: entry.targetKind ?? entry.target_kind,
			natural_key_field: entry.naturalKeyField ?? entry.natural_key_field,
		}));
}

/**
 * Read a live table by its snake_case accessor — finding ledger entry
 * #5: the real generated `DbConnection.db` keys every table accessor by its
 * schema object-literal key verbatim, always snake_case; there is no
 * camelCase table accessor on any current surface (live connection or
 * `SnapshotDb` fixture/replay — audited repo-wide). Throws (never silently
 * returns `[]`) when `table` resolves to nothing, naming the row kind and the
 * accessor tried, so a typo'd or stale table name fails loudly instead of
 * looking like an empty live world.
 */
function liveTableRows(
	db: AuthorSnapshotDb,
	table: string,
	rowKind: string,
): Record<string, unknown>[] {
	const bag = db as Record<string, TableHandleLike | undefined>;
	// Prefer snake_case (generated schema name); some snapshot wrappers also expose camelCase.
	const camel = table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
	const handle = bag[table] ?? bag[camel];
	if (handle === undefined) {
		throw new Error(
			`liveTableRows: rowKind "${rowKind}" has no live accessor "${table}" (or "${camel}") on the connected db — ` +
				"check the table name against the schema.",
		);
	}
	return Array.from(handle.iter());
}

/**
 * `rowKind` -> live-table accessor (the accessor is ALWAYS the live table's
 * real snake_case name — see `liveTableRows`'s header; there is no camelCase
 * variant to fall back to) + the shape mapper back to the manifest's own row
 * fields. BOUNDED, not exhaustive over `ROW_KIND_NATURAL_KEY` — see this
 * file's header note. Grow this table only when a real verb/lookup consumer
 * needs another row kind resolved live.
 */
export const LIVE_TABLE_ACCESSORS: Readonly<
	Record<string, { table: string; toManifestRow: (live: Record<string, unknown>) => ManifestRow }>
> = {
	area_shape_definitions: {
		table: "area_shape_definition",
		toManifestRow: (live) => ({
			shape_id: live.shapeId ?? live.shape_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			description: live.description,
		}),
	},
	economy_channel_definitions: {
		table: "economy_channel_definitions",
		toManifestRow: (live) => ({
			id: live.id,
			bundle_id: live.bundleId ?? live.bundle_id,
			pool_ms_per_round: live.poolMsPerRound ?? live.pool_ms_per_round,
			resets_on: live.resetsOn ?? live.resets_on,
			off_turn_eligible: live.offTurnEligible ?? live.off_turn_eligible ?? false,
		}),
	},
	resource_definitions: {
		table: "resource_definition",
		toManifestRow: (live) => ({
			resource_definition_id: live.resourceDefinitionId ?? live.resource_definition_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			display_name: live.displayName ?? live.display_name,
			value_kind: live.valueKind ?? live.value_kind,
			// `recovery_rule` is REQUIRED (ResourceDefinitionRow, no serde default) —
			// #1968 gap② surfaced this mapping was missing it: `spellkave_lookup`
			// never rendered these rows through the schema (harmless there), but
			// `commitOrReport`'s target-aware validation augmentation DOES render
			// them, so an omitted `recovery_rule` broke the render outright.
			recovery_rule: live.recoveryRule ?? live.recovery_rule,
			min_value: liveInt(live.minValue ?? live.min_value),
			max_value: liveInt(live.maxValue ?? live.max_value),
			initial_value: liveInt(live.initialValue ?? live.initial_value),
			description: live.description,
		}),
	},
	object_state_definitions: {
		table: "object_state_definition",
		toManifestRow: (live) => ({
			state_id: live.stateId ?? live.state_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			target_kind: live.targetKind ?? live.target_kind,
			display_name: live.displayName ?? live.display_name,
			default_visibility: liveEnumTag(live.defaultVisibility ?? live.default_visibility),
			description: live.description,
		}),
	},
	// Exact tag values are description-only vocabulary rows. Their `tag`
	// natural key is a complete dotted value, so the generic target/query path
	// can resolve them without a vocabulary-specific fallback.
	tag_value_definitions: {
		table: "tag_value_definition",
		toManifestRow: (live) => ({
			tag: live.tag,
			prefix: live.prefix,
			bundle_id: live.bundleId ?? live.bundle_id,
			description: live.description,
		}),
	},
	containment_policy_definition: {
		table: "containment_policy_definition",
		toManifestRow: (live) => ({
			policy_id: live.policyId ?? live.policy_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			exposure_predicate_source: live.exposurePredicateSource ?? live.exposure_predicate_source,
			access_predicate_source: live.accessPredicateSource ?? live.access_predicate_source,
		}),
	},
	entity_definitions: {
		table: "entity_definition",
		toManifestRow: (live) => ({
			entity_def_id: live.entityDefId ?? live.entity_def_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			display_name: live.displayName ?? live.display_name,
			description: live.description,
			slot_compatibility_predicate:
				live.slotCompatibilityPredicate ?? live.slot_compatibility_predicate,
			stackable: live.stackable,
		}),
	},
	place_nodes: {
		table: "visible_place_node",
		// Full spatial projection so map_graph / preferred list can draw live nodes
		// (pos_*, substrate, display_name) — thin id-only rows left the map empty.
		toManifestRow: (live) => ({
			node_id: live.nodeId ?? live.node_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			place_graph_id: live.placeGraphId ?? live.place_graph_id,
			local_id: live.localId ?? live.local_id,
			substrate_id: live.substrateId ?? live.substrate_id,
			display_name: live.displayName ?? live.display_name,
			description: live.description,
			pos_x: live.posX ?? live.pos_x,
			pos_y: live.posY ?? live.pos_y,
			pos_present: live.posPresent ?? live.pos_present,
			pose_elevation: live.poseElevation ?? live.pose_elevation,
			pose_elevation_present: live.poseElevationPresent ?? live.pose_elevation_present,
			extent_shape_id: live.extentShapeId ?? live.extent_shape_id,
			extent_params_json: live.extentParamsJson ?? live.extent_params_json,
		}),
	},
	// Edges for map_graph routes when reading live.
	place_edges: {
		table: "visible_place_edge",
		toManifestRow: (live) => ({
			edge_key: live.edgeKey ?? live.edge_key,
			bundle_id: live.bundleId ?? live.bundle_id,
			place_graph_id: live.placeGraphId ?? live.place_graph_id,
			from_node_id: live.fromNodeId ?? live.from_node_id,
			to_node_id: live.toNodeId ?? live.to_node_id,
			description: live.description,
		}),
	},
	place_graphs: {
		table: "visible_place_graph_definition",
		toManifestRow: (live) => ({
			place_graph_id: live.placeGraphId ?? live.place_graph_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			substrate_id: live.substrateId ?? live.substrate_id,
			display_name: live.displayName ?? live.display_name,
			description: live.description,
			// `live.metresPerUnit` is the generated binding field (sk-yze);
			// `live.metres_per_unit` covers a raw manifest-shaped row, which this
			// same function is also fed. Both spellings are live, neither is stale.
			metres_per_unit: live.metresPerUnit ?? live.metres_per_unit,
			bearing: live.bearing,
			anchor_node_id: live.anchorNodeId ?? live.anchor_node_id,
			parent_graph_id: live.parentGraphId ?? live.parent_graph_id,
			blueprint_id: live.blueprintId ?? live.blueprint_id,
			is_ephemeral_instance: live.isEphemeralInstance ?? live.is_ephemeral_instance,
		}),
	},
	substrate_definitions: {
		table: "substrate_definition",
		toManifestRow: (live) => ({
			substrate_id: live.substrateId ?? live.substrate_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			coordinate_kind_id: live.coordinateKindId ?? live.coordinate_kind_id,
			description: live.description,
		}),
	},
	coordinate_kind_definitions: {
		table: "coordinate_kind_definition",
		toManifestRow: (live) => ({
			coordinate_kind_id: live.coordinateKindId ?? live.coordinate_kind_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			description: live.description,
		}),
	},
	session_definitions: {
		table: "session_definition",
		toManifestRow: (live) => ({
			session_def_id: live.sessionDefId ?? live.session_def_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			participants_pred: live.participantsPred ?? live.participants_pred,
			initial_state: live.initialState ?? live.initial_state,
			legal_moves_csv: live.legalMovesCsv ?? live.legal_moves_csv,
			turn_rule: live.turnRule ?? live.turn_rule,
			visibility_policy: live.visibilityPolicy ?? live.visibility_policy,
			termination_pred: live.terminationPred ?? live.termination_pred,
			on_terminate: live.onTerminate ?? live.on_terminate,
			stakes_required: live.stakesRequired ?? live.stakes_required,
			winner_predicate: live.winnerPredicate ?? live.winner_predicate,
			turn_scheduler_id: live.turnSchedulerId ?? live.turn_scheduler_id,
			round_duration_ms: liveInt(live.roundDurationMs ?? live.round_duration_ms),
			auto_join_on_targeting: live.autoJoinOnTargeting ?? live.auto_join_on_targeting,
			combat_grid_blueprint_id: live.combatGridBlueprintId ?? live.combat_grid_blueprint_id,
			grid_edge_affordance_template_id:
				live.gridEdgeAffordanceTemplateId ?? live.grid_edge_affordance_template_id,
			grid_edge_affordance_bindings_json:
				live.gridEdgeAffordanceBindingsJson ?? live.grid_edge_affordance_bindings_json,
		}),
	},
	turn_scheduler: {
		table: "turn_scheduler",
		toManifestRow: (live) => ({
			id: live.id,
			bundle_id: live.bundleId ?? live.bundle_id,
			// `scheduler_kind` is a no-payload `SchedulerKind` enum — same
			// `{tag: ...}` client shape as the other enum columns above.
			scheduler_kind: liveEnumTag(live.schedulerKind ?? live.scheduler_kind),
			order_roll_source: live.orderRollSource ?? live.order_roll_source,
			active: live.active,
		}),
	},
	// srd-cc executable finding #69: `session_definitions.combat_grid_
	// blueprint_id` is a genuinely authored outbound ref, but this map had no
	// entry for its target kind, so the live-detail path started blind —
	// identical failure class to the five accessors added for findings
	// #42-44 above. Column shape mirrors the generated binding
	// (`packages/spellkave-bindings/src/module_bindings/
	// combat_grid_blueprint_table.ts`) 1:1; `cell_size` is an f32 and passes
	// through as a plain number (NOT liveInt — 1.524m cells are legal).
	combat_grid_blueprints: {
		table: "combat_grid_blueprint",
		toManifestRow: (live) => ({
			blueprint_id: live.blueprintId ?? live.blueprint_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			width: liveInt(live.width),
			height: liveInt(live.height),
			topology: live.topology,
			cell_size: live.cellSize ?? live.cell_size,
			edge_affordance_template_id:
				live.edgeAffordanceTemplateId ?? live.edge_affordance_template_id,
			edge_affordance_bindings_json:
				live.edgeAffordanceBindingsJson ?? live.edge_affordance_bindings_json,
			edge_overrides_json: live.edgeOverridesJson ?? live.edge_overrides_json,
		}),
	},
	role_definitions: {
		table: "role_definition",
		toManifestRow: (live) => ({
			role_id: live.roleId ?? live.role_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			display_name: live.displayName ?? live.display_name,
			description: live.description,
			capability_ids: live.capabilityIds ?? live.capability_ids,
		}),
	},
	place_seals: {
		table: "visible_place_seal",
		toManifestRow: (live) => ({
			place_graph_id: live.placeGraphId ?? live.place_graph_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			description: live.description,
		}),
	},
	role_bindings: {
		table: "visible_role_binding",
		toManifestRow: (live) => ({
			binding_id: live.bindingId ?? live.binding_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			subject: live.subject,
			role_id: live.roleId ?? live.role_id,
			extent_kind_ref: live.extentKindRef ?? live.extent_kind_ref,
			extent_ref: live.extentRef ?? live.extent_ref,
			expires_at_tick: optionalTick(live.expiresAtTick ?? live.expires_at_tick),
			description: live.description,
			presence_entity_id: String(live.presenceEntityId ?? live.presence_entity_id ?? 0),
			realised_at_tick: optionalTick(live.realisedAtTick ?? live.realised_at_tick),
		}),
	},
	role_aggregations: {
		table: "role_aggregation",
		toManifestRow: (live) => ({
			role_id: live.roleId ?? live.role_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			description: live.description,
			capability_ids: live.capabilityIds ?? live.capability_ids,
		}),
	},
	extent_kind_definitions: {
		table: "extent_kind_definition",
		toManifestRow: (live) => ({
			kind_id: live.kindId ?? live.kind_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			description: live.description,
			resolution_shape: liveEnumTag(live.resolutionShape ?? live.resolution_shape),
		}),
	},
	capability_definitions: {
		table: "capability_definition",
		toManifestRow: (live) => ({
			capability_id: live.capabilityId ?? live.capability_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			actor_kind: live.actorKind ?? live.actor_kind,
			display_name: live.displayName ?? live.display_name,
			description: live.description,
			// VisibilityClass is a no-payload enum `{ tag: "Public" | ... }` on the wire.
			default_visibility: liveEnumTag(live.defaultVisibility ?? live.default_visibility),
		}),
	},
	metadata_namespaces: {
		table: "metadata_namespace_definition",
		toManifestRow: (live) => ({
			namespace: live.namespace,
			audience: live.audience,
			bundle_id: live.bundleId ?? live.bundle_id,
			description: live.description,
			on_demand: live.onDemand ?? live.on_demand,
		}),
	},
	// `metadata_attachments` deliberately has NO entry here (ADR-0130 D-1):
	// `metadata_attachment` is now a private table read through three views
	// (`public_metadata_attachment`, `visible_metadata_attachment`,
	// `public_reference_metadata`) that share this row shape but have no
	// single table name a LIVE_TABLE_ACCESSORS entry can point at —
	// `lookupLiveMetadataAttachments` below unions all three and is
	// special-cased in `lookup()`, the same pattern `actor_spatial_locations`
	// already uses (no accessor entry, no LIVE_ID_FIELD entry: attachment
	// rows have no single-column natural id (their key is composite), so
	// resolveRef stays unsupported for this kind).
	affordance_templates: {
		table: "affordance_template",
		toManifestRow: (live) => ({
			template_id: live.templateId ?? live.template_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			niche_id: live.nicheId ?? live.niche_id,
			capability_id: live.capabilityId ?? live.capability_id,
			display_name: live.displayName ?? live.display_name,
			predicate_source: live.predicateSource ?? live.predicate_source,
			outcome_template_id: live.outcomeTemplateId ?? live.outcome_template_id,
			range_m: live.rangeM ?? live.range_m,
			// `locality_class` is a no-payload `LocalityClass` enum — same
			// `{tag: ...}` client-side shape as `modifier_target_definitions.shape`
			// (executable finding #44).
			locality_class: liveEnumTag(live.localityClass ?? live.locality_class),
			reads_occupancy: live.readsOccupancy ?? live.reads_occupancy,
			spends_channel: live.spendsChannel ?? live.spends_channel,
			recharges_on: live.rechargesOn ?? live.recharges_on,
			composes: live.composes,
			description: live.description,
		}),
	},
	action_definitions: {
		table: "action_definition",
		toManifestRow: (live) => ({
			// NOTE: no `description` mapping — the live `action_definition` table
			// has no `description` column (unlike the manifest schema's row,
			// which defaults it to `""` when absent); this is an honest gap in
			// the live SDK bindings, not an oversight here.
			action_id: live.actionId ?? live.action_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			required_capability: live.requiredCapability ?? live.required_capability,
			on_success: live.onSuccess ?? live.on_success,
			on_failure: live.onFailure ?? live.on_failure,
			// `resolution_mode` is a no-payload `ActionResolutionMode` enum — same
			// `{tag: ...}` client-side shape as `modifier_target_definitions.shape`
			// (executable finding #44).
			resolution_mode: liveEnumTag(live.resolutionMode ?? live.resolution_mode),
			resolution_predicate_source:
				live.resolutionPredicateSource ?? live.resolution_predicate_source ?? "",
			resolution_scope: live.resolutionScope ?? live.resolution_scope ?? "",
			non_steering: Boolean(live.nonSteering ?? live.non_steering),
			display_name: live.displayName ?? live.display_name,
			cost_time_ms: liveInt(live.costTimeMs ?? live.cost_time_ms),
			session_def_id: live.sessionDefId ?? live.session_def_id,
			reaction_eligibility: live.reactionEligibility ?? live.reaction_eligibility,
			reaction_window_ms: liveInt(live.reactionWindowMs ?? live.reaction_window_ms),
			reaction_trigger: live.reactionTrigger ?? live.reaction_trigger,
			self_eligible: live.selfEligible ?? live.self_eligible,
			self_only: live.selfOnly ?? live.self_only,
			spends_channel: live.spendsChannel ?? live.spends_channel,
		}),
	},
	outcome_templates: {
		table: "outcome_template",
		toManifestRow: (live) => ({
			outcome_template_id: live.outcomeTemplateId ?? live.outcome_template_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			display_name: live.displayName ?? live.display_name,
			outcome_expression_source: live.outcomeExpressionSource ?? live.outcome_expression_source,
			manipulation_action_id: live.manipulationActionId ?? live.manipulation_action_id,
			communication_speech_act_id:
				live.communicationSpeechActId ?? live.communication_speech_act_id,
			movement_descriptor: live.movementDescriptor ?? live.movement_descriptor,
			sense_query_kind: live.senseQueryKind ?? live.sense_query_kind,
			sense_visibility: live.senseVisibility ?? live.sense_visibility,
			consequence_template_id: live.consequenceTemplateId ?? live.consequence_template_id,
			discovery_validated: live.discoveryValidated ?? live.discovery_validated,
			description: live.description,
		}),
	},
	bundles: {
		table: "mod_bundle",
		toManifestRow: (live) => ({
			bundle_id: live.bundleId ?? live.bundle_id,
			display_name: live.displayName ?? live.display_name,
			author: live.author,
			version: live.version,
			tag_prefixes: liveTagPrefixes(live.tagPrefixes ?? live.tag_prefixes),
			allow_flat_tags: live.allowFlatTags ?? live.allow_flat_tags,
			// Server-side `depends_on` is a comma-joined STRING column
			// (`bundle.rs`'s own `deps` module splits it), unlike the manifest
			// schema's `array<string>` — left as the live shape rather than
			// invented-split here (no current consumer parses this field
			// through a live target; `resolveQueryDetail`'s ref heuristic never
			// treats `depends_on` as a ref field either way, since it doesn't
			// carry an `_id`/`_key`/`_ref` suffix).
			depends_on: live.dependsOn ?? live.depends_on,
			description: live.description,
			default_extent_shape_id: live.defaultExtentShapeId ?? live.default_extent_shape_id,
			default_extent_params_json: live.defaultExtentParamsJson ?? live.default_extent_params_json,
		}),
	},
	condition_definitions: {
		table: "condition_definition",
		toManifestRow: (live) => ({
			// Prose is NOT on the catalog row (binary-compat satellite
			// `condition_definition_description`). Overlay in lookup().
			description: "",
			condition_definition_id: live.conditionDefinitionId ?? live.condition_definition_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			display_name: live.displayName ?? live.display_name,
			stacking_rule: live.stackingRule ?? live.stacking_rule,
			remove_time_policy: live.removeTimePolicy ?? live.remove_time_policy,
			gate_predicate_source: live.gatePredicateSource ?? live.gate_predicate_source,
			modifier_template_id: live.modifierTemplateId ?? live.modifier_template_id,
			observable: live.observable,
			grants_capability_while_active:
				live.grantsCapabilityWhileActive ?? live.grants_capability_while_active,
			suppresses_capability_while_active:
				live.suppressesCapabilityWhileActive ?? live.suppresses_capability_while_active,
			implies: live.implies,
		}),
	},
	consequence_templates: {
		table: "consequence_template",
		toManifestRow: (live) => ({
			// NOTE: no `description` mapping — `consequence_template` has no
			// catalog column and no prose satellite (unlike condition_definitions).
			template_id: live.templateId ?? live.template_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			effect_refs_csv: live.effectRefsCsv ?? live.effect_refs_csv,
			traces_json: live.tracesJson ?? live.traces_json,
		}),
	},
	modifier_target_definitions: {
		table: "modifier_target_definition",
		toManifestRow: (live) => ({
			target_id: live.targetId ?? live.target_id,
			// `shape` is a no-payload `ModifierTargetShape` enum — unwrap its
			// `{tag: "Numeric"|"Mode"|"Reference"}` client shape to the plain
			// string the manifest schema's own `shape` field carries.
			shape: liveEnumTag(live.shape),
			display_name: live.displayName ?? live.display_name,
			bundle_id: live.bundleId ?? live.bundle_id,
		}),
	},
	// sk-9ll.3: bundle-scoped catalog vocabulary, same shape/rationale as
	// `modifier_target_definitions` above — backs the NEW `spellkave_equip_item`
	// verb's `slot_id` existence pre-check (dual-source lookup) and the shared
	// `MF_VAL_ACTOR_EQUIP_SLOT_DEF_REF` validator rule's target-augmentation
	// (`VALIDATION_AUGMENT_KINDS`, `authoring-verbs.ts`).
	equipment_slot_definitions: {
		table: "equipment_slot_definition",
		toManifestRow: (live) => ({
			slot_id: live.slotId ?? live.slot_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			label: live.label,
			default_compatibility_predicate:
				live.defaultCompatibilityPredicate ?? live.default_compatibility_predicate,
		}),
	},
	modifier_templates: {
		table: "modifier_template",
		toManifestRow: (live) => ({
			modifier_template_id: live.modifierTemplateId ?? live.modifier_template_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			applies_to: live.appliesTo ?? live.applies_to,
			display_name: live.displayName ?? live.display_name,
			predicate_source: live.predicateSource ?? live.predicate_source,
			modifier_expression_source: live.modifierExpressionSource ?? live.modifier_expression_source,
			priority: live.priority,
			// `delta_kind` is a no-payload `ModifierDeltaTag` enum — same
			// `{tag: ...}` unwrap as `modifier_target_definitions.shape` above.
			delta_kind: liveEnumTag(live.deltaKind ?? live.delta_kind),
			replace_template_id: live.replaceTemplateId ?? live.replace_template_id,
		}),
	},
	dsl_macro_definitions: {
		table: "dsl_macro_definition",
		toManifestRow: (live) => ({
			macro_id: live.macroId ?? live.macro_id,
			bundle_id: live.bundleId ?? live.bundle_id,
			return_type: liveEnumTag(live.returnType ?? live.return_type),
			parameters: JSON.parse(String(live.parametersJson ?? live.parameters_json ?? "[]")),
			body_source: live.bodySource ?? live.body_source,
			description: live.description,
		}),
	},
	capability_definition_tag: {
		table: "capability_definition_tag",
		toManifestRow: (live) => ({
			capability_id: live.capabilityId ?? live.capability_id,
			tag: live.tag,
			bundle_id: live.bundleId ?? live.bundle_id,
			source: live.source,
		}),
	},
	resource_definition_tag: {
		table: "resource_definition_tag",
		toManifestRow: (live) => ({
			resource_definition_id: live.resourceDefinitionId ?? live.resource_definition_id,
			tag: live.tag,
			bundle_id: live.bundleId ?? live.bundle_id,
			source: live.source,
		}),
	},
	entity_definition_tag: {
		table: "entity_definition_tag",
		toManifestRow: (live) => ({
			entity_def_id: live.entityDefId ?? live.entity_def_id,
			tag: live.tag,
			bundle_id: live.bundleId ?? live.bundle_id,
			source: live.source,
		}),
	},
	modifier_template_tag: {
		table: "modifier_template_tag",
		toManifestRow: (live) => ({
			modifier_template_id: live.modifierTemplateId ?? live.modifier_template_id,
			tag: live.tag,
			bundle_id: live.bundleId ?? live.bundle_id,
			source: live.source,
		}),
	},
};

/**
 * The `rowKind`'s own natural-key field, verified against the live row
 * shapes above (never inferred). Deliberately has NO entries for the four
 * `ROW_KIND_COMPOSITE_KEY` kinds added above (finding #42) — a composite-key
 * kind's identity is the ORDERED PAIR `[parent_field, "tag"]`, not a single
 * field, so it has nothing to put here; `resolveRef` (this file's only
 * `LIVE_ID_FIELD` consumer) is never called with a composite-keyed `rowKind`
 * anywhere in `authoring-verbs.ts` (grep-verified — every call site names a
 * natural-key kind), and `lookup()` (the composite kinds' only live
 * consumer, via `spellkave_query`'s list/detail/summary paths) never reads
 * `LIVE_ID_FIELD` at all.
 */
const LIVE_ID_FIELD: Readonly<Record<string, string>> = {
	area_shape_definitions: "shape_id",
	economy_channel_definitions: "id",
	resource_definitions: "resource_definition_id",
	object_state_definitions: "state_id",
	tag_value_definitions: "tag",
	entity_definitions: "entity_def_id",
	containment_policy_definition: "policy_id",
	place_nodes: "node_id",
	place_graphs: "place_graph_id",
	place_edges: "edge_key",
	substrate_definitions: "substrate_id",
	coordinate_kind_definitions: "coordinate_kind_id",
	session_definitions: "session_def_id",
	turn_scheduler: "id",
	combat_grid_blueprints: "blueprint_id",
	capability_definitions: "capability_id",
	role_definitions: "role_id",
	role_bindings: "binding_id",
	place_seals: "place_graph_id",
	extent_kind_definitions: "kind_id",
	affordance_templates: "template_id",
	action_definitions: "action_id",
	outcome_templates: "outcome_template_id",
	bundles: "bundle_id",
	condition_definitions: "condition_definition_id",
	consequence_templates: "template_id",
	modifier_target_definitions: "target_id",
	modifier_templates: "modifier_template_id",
	dsl_macro_definitions: "macro_id",
	equipment_slot_definitions: "slot_id",
};

export interface LiveAuthorTargetDeps {
	readsAsPublisher?: () => boolean;
	scopedSnapshot?: ScopedSnapshotPort;
	/** A value or a thunk (mirrors `SpellkaveToolContext.db`/`AuthorToolContext.db`). */
	db: AuthorSnapshotDb | (() => AuthorSnapshotDb | undefined) | undefined;
	/** `r_apply_manifest_delta` port (ADR-0085) — absent = `applyBatch` rejects (no live driver wired). */
	applyDelta?: (toml: string) => Promise<{ ok: boolean; detail?: string }>;
	/**
	 * Memoise `lookup` results for the life of this target. Every uncached `lookup`
	 * copies and re-maps a whole table, so a full read-only walk (one query per row)
	 * is quadratic in world size. Only for a target created for one read-only walk
	 * over a quiescent world: the cache is never invalidated, so a live target that
	 * outlives writes must leave this off (the default).
	 */
	cacheRows?: boolean;
}

function resolveDb(db: LiveAuthorTargetDeps["db"]): AuthorSnapshotDb | undefined {
	if (db === undefined) return undefined;
	try {
		return typeof db === "function" ? db() : db;
	} catch {
		// Mirrors `spellkave_lookup`'s own `currentDb` seam: a host's `db` thunk
		// may throw "not connected" rather than being absent.
		return undefined;
	}
}

function liveTableRowsOptional(db: AuthorSnapshotDb, table: string): Record<string, unknown>[] {
	const bag = db as Record<string, TableHandleLike | undefined>;
	const camel = table.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
	const handle = bag[table] ?? bag[camel];
	if (handle === undefined) return [];
	return Array.from(handle.iter());
}

function authoredEntityKey(manifestKey: unknown): string {
	const key = String(manifestKey ?? "");
	const colon = key.indexOf(":");
	return colon >= 0 ? key.slice(colon + 1) : key;
}

/**
 * Live `actor_spatial_location` is id-keyed (`entity_id`) and the public view
 * is visibility-filtered — an operator snapshot often has no `entity_key` and
 * no row for anyone except the bound sender. Authoring verbs still name actors
 * by `entity_key`. Join the operator or coverage-checked admitted authored mapping + `entity` so lookup can
 * answer "is this player/npc already live?" without inventing an `entities`
 * LIVE_TABLE_ACCESSORS entry (that kind stays local-only; see authoring-verbs
 * ENTITY_INSTANCE_AUGMENT_KINDS_LOCAL_ONLY).
 */
function lookupLiveActorSpatialLocations(
	db: AuthorSnapshotDb,
	filter: { bundle?: string } | undefined,
	publisher: boolean,
): ManifestRow[] {
	if (!publisher) {
		const coverage = liveTableRows(
			db,
			"visible_manifest_authored_entity_coverage",
			"actor_spatial_locations",
		);
		if (
			coverage.length !== 1 ||
			coverage[0]?.status !== "complete" ||
			coverage[0]?.projectionVersion !== 1
		)
			throw new Error("reader_unavailable: authored mapping coverage missing or incomplete");
	}
	const authored = liveTableRows(
		db,
		publisher ? "operator_manifest_authored_entity" : "visible_manifest_authored_entity",
		"actor_spatial_locations",
	);
	const entities = liveTableRows(db, "entity", "actor_spatial_locations");
	const visible = liveTableRowsOptional(db, "visible_actor_spatial_location");
	const entityById = new Map<string, Record<string, unknown>>();
	for (const row of entities) {
		entityById.set(String(row.entityId ?? row.entity_id), row);
	}
	const visibleById = new Map<string, Record<string, unknown>>();
	for (const row of visible) {
		visibleById.set(String(row.entityId ?? row.entity_id), row);
	}
	const out: ManifestRow[] = [];
	for (const row of authored) {
		const entityId = String(row.entityId ?? row.entity_id);
		const entity = entityById.get(entityId);
		if (entity === undefined) continue;
		const kind = String(entity.kind ?? "");
		if (kind !== "player" && kind !== "npc") continue;
		const bundleId = String(row.bundleId ?? row.bundle_id ?? "");
		if (filter?.bundle !== undefined && bundleId !== filter.bundle) continue;
		const asl = visibleById.get(entityId);
		out.push({
			entity_key: authoredEntityKey(row.manifestKey ?? row.manifest_key),
			bundle_id: bundleId,
			place_node_id: String(asl?.placeNodeId ?? asl?.place_node_id ?? ""),
			entity_def_id: String(entity.entityDefId ?? entity.entity_def_id ?? ""),
			name: String(entity.name ?? ""),
			kind,
		});
	}
	return out;
}

/**
 * ADR-0130 D-6: a live target's `lookup("metadata_attachments", ...)` unions
 * `public_metadata_attachment`, `visible_metadata_attachment`, and
 * `public_reference_metadata` — authors need reference rows
 * (`srd.advancement_grant`/`srd.advancement_choice`/`srd.spell_slot_grant`/
 * `srd.spellcasting_profile`/`srd.equipment_*`/`srd.background_origin_feat`,
 * ADR-0130 Context) alongside the play-session metadata the two other views
 * carry, and this is the ONE seam every DM-runtime reader in
 * `@spellkave/adventure-runtime`'s `src/dm/**` goes through (never the SDK
 * directly, see `dm/data/advancement.ts`'s own header). Deduped by `key`
 * — the three views are disjoint by construction (D-5), so this is
 * defensive, matching `@spellkave/sdk`'s sibling
 * `readMetadataAttachmentRows` (`core/readers/metadata_rows.ts`).
 */
function lookupLiveMetadataAttachments(
	db: AuthorSnapshotDb,
	filter: { bundle?: string } | undefined,
): ManifestRow[] {
	const seen = new Set<string>();
	const out: ManifestRow[] = [];
	for (const table of [
		"public_metadata_attachment",
		"visible_metadata_attachment",
		"public_reference_metadata",
	]) {
		for (const row of liveTableRowsOptional(db, table)) {
			const rowKey = String(row.key ?? "");
			if (rowKey !== "") {
				if (seen.has(rowKey)) continue;
				seen.add(rowKey);
			}
			const bundleId = String(row.bundleId ?? row.bundle_id ?? "");
			if (filter?.bundle !== undefined && bundleId !== filter.bundle) continue;
			out.push({
				target_kind: row.targetKind ?? row.target_kind,
				target_ref: row.targetRef ?? row.target_ref,
				namespace: row.namespace,
				payload_json: row.payloadJson ?? row.payload_json,
				audience: row.audience,
				bundle_id: bundleId,
				source: row.source,
			});
		}
	}
	return out;
}

/**
 * `live`: reads via the DB snapshot thunk (generalizing what `spellkave_lookup`
 * already did per-kind, #1968), commits via the `applyDelta` port
 * (`r_apply_manifest_delta`, ADR-0085, unchanged).
 */
function overlayConditionDefinitionDescriptions(db: AuthorSnapshotDb, rows: ManifestRow[]): void {
	const prose = new Map<string, string>();
	for (const sat of liveTableRowsOptional(db, "condition_definition_description")) {
		const id = String(sat.conditionDefinitionId ?? sat.condition_definition_id ?? "");
		const text = String(sat.description ?? "");
		if (id !== "" && text.trim() !== "") prose.set(id, text);
	}
	for (const row of rows) {
		row.description = prose.get(String(row.condition_definition_id ?? "")) ?? "";
	}
}

/**
 * ADR-0143 D-5: `turn_eligibility_pred` is NOT on the `session_definition`
 * row (binary-compat satellite `session_turn_eligibility`). Overlay it so a
 * live edit that re-declares a session row keeps its predicate — omitting the
 * field on a redeclare deletes the satellite. Set only when authored, so a
 * reconstructed row never carries the field to a module that predates it.
 */
function overlaySessionTurnEligibility(db: AuthorSnapshotDb, rows: ManifestRow[]): void {
	const predicates = new Map<string, string>();
	for (const sat of liveTableRowsOptional(db, "session_turn_eligibility")) {
		const id = String(sat.sessionDefId ?? sat.session_def_id ?? "");
		const source = String(sat.predicateSource ?? sat.predicate_source ?? "");
		if (id !== "" && source.trim() !== "") predicates.set(id, source);
	}
	for (const row of rows) {
		const source = predicates.get(String(row.session_def_id ?? ""));
		if (source !== undefined) row.turn_eligibility_pred = source;
	}
}

export function createLiveAuthorTarget(deps: LiveAuthorTargetDeps): AuthorTarget {
	const rowCache = deps.cacheRows === true ? new Map<string, ManifestRow[]>() : undefined;
	return {
		kind: "live",
		resolveRef(rowKind, id) {
			const db = resolveDb(deps.db);
			if (db !== undefined && rowKind === "actor_spatial_locations") {
				return lookupLiveActorSpatialLocations(
					db,
					undefined,
					deps.readsAsPublisher?.() === true,
				).some((row) => String(row.entity_key) === id);
			}
			const accessor = LIVE_TABLE_ACCESSORS[rowKind];
			const idField = LIVE_ID_FIELD[rowKind];
			if (db === undefined || accessor === undefined || idField === undefined) return false;
			const rows =
				rowKind === "containment_policy_definition"
					? deps.readsAsPublisher?.() === false
						? []
						: liveTableRowsOptional(db, accessor.table)
					: liveTableRows(db, accessor.table, rowKind);
			return rows.some((row) => String(accessor.toManifestRow(row)[idField]) === id);
		},
		lookup(rowKind, filter) {
			const db = resolveDb(deps.db);
			if (db === undefined) return [];
			// Check before the request-local row cache, including a changed seat.
			if (rowKind === "containment_policy_definition" && deps.readsAsPublisher?.() === false)
				return [];
			if (rowKind === "actor_spatial_locations") {
				return lookupLiveActorSpatialLocations(db, filter, deps.readsAsPublisher?.() === true);
			}
			if (rowKind === "metadata_attachments") {
				return lookupLiveMetadataAttachments(db, filter);
			}
			const accessor = LIVE_TABLE_ACCESSORS[rowKind];
			if (accessor === undefined) return [];
			const cacheKey = `${rowKind}\u0000${filter?.bundle ?? ""}`;
			const cached = rowCache?.get(cacheKey);
			if (cached !== undefined) return cached;
			const sourceRows =
				rowKind === "containment_policy_definition"
					? liveTableRowsOptional(db, accessor.table)
					: liveTableRows(db, accessor.table, rowKind);
			const rows = sourceRows
				.map(accessor.toManifestRow)
				.filter((row) => filter?.bundle === undefined || row.bundle_id === filter.bundle);
			if (rowKind === "place_seals") {
				const breaks = liveTableRowsOptional(db, "visible_place_seal_break");
				for (const row of rows) {
					const broken = breaks.find(
						(b) => (b.placeGraphId ?? b.place_graph_id) === row.place_graph_id,
					);
					if (broken !== undefined) {
						row.broken = true;
						row.break_reason = broken.breakReason ?? broken.break_reason;
					}
				}
			}
			if (rowKind === "condition_definitions") {
				overlayConditionDefinitionDescriptions(db, rows);
			}
			if (rowKind === "session_definitions") {
				overlaySessionTurnEligibility(db, rows);
			}
			rowCache?.set(cacheKey, rows);
			return rows;
		},
		async applyBatch(toml) {
			if (deps.applyDelta === undefined) {
				return {
					ok: false,
					detail: "live target has no applyDelta port wired — not connected.",
				};
			}
			if (deps.readsAsPublisher?.() === false) {
				let captured: ScopedInstanceSnapshot | undefined;
				try {
					captured = await deps.scopedSnapshot?.read();
				} catch {
					/* unavailable is a refusal */
				}
				const refusal = scopedInlineDeltaPreflight(toml, captured);
				if (refusal) return { ok: false, detail: refusal };
			}
			return deps.applyDelta(toml);
		},
	};
}

// ---------------------------------------------------------------------------
