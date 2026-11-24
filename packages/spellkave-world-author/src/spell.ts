// One spell = ONE identity (#835).
//
// `emitSpell` builds the IDENTITY/binding rows for a single catalog spell —
// capability_definition (+tags), the cast action_definition (+tags), and its
// outcome_template — from ONE declaration, all bound to the SAME catalog id:
//
//   capability_id == entity_def_id == action_definition.required_capability
//
// This is the authoring primitive #835 lever 3 asks for: "add a spell" becomes one
// declaration, not ~10 hand-wired rows across two delimiters with the catalog entity
// orphaned. Tags are single-sourced (one list → both the capability and the action,
// no 3× repetition). The cast ACTION keeps its own verb id (e.g. `srd/cast_fire_bolt`),
// distinct from the spell IDENTITY — only the identity is unified.
//
// Pure row emitter, no filesystem (this package publishes only `src/`, and the
// validator stays the single source of truth for parsing/type-checking — same posture
// as `routeDamage` in damage.ts). The catalog-existence check therefore takes the known
// entity ids as INPUT, so the fs-having caller (an authoring driver) supplies them.

const SPELL_CATALOG_PREFIX = "srd/spell/";

/** One row table fragment keyed by table name (schema-shaped, ready to render). */
export interface SpellIdentityRows {
	capability_definitions: Record<string, unknown>[];
	capability_definition_tag: Record<string, unknown>[];
	action_definitions: Record<string, unknown>[];
	action_definition_tag: Record<string, unknown>[];
	outcome_templates: Record<string, unknown>[];
}

export interface EmitSpellInput {
	/** The single spell identity, `srd/spell/<slug>`. MUST equal the catalog entity_def_id. */
	capabilityId: string;
	/** The cast action verb id (e.g. `srd/cast_fire_bolt`, `srd/bless`) — distinct from the identity. */
	actionId: string;
	bundleId: string;
	displayName: string;
	description?: string;
	/** Single-sourced: applied to BOTH the capability and the action (no 3× repetition). */
	tags?: string[];
	/** The outcome_template id wired as the action's `on_success`. Defaults to `<actionId>/outcome`. */
	outcomeTemplateId?: string;
}

export interface EmitSpellOptions {
	/**
	 * The catalog `entity_definition.entity_def_id` set. When provided, `emitSpell`
	 * asserts the `srd/spell/*` capability binds to a matching catalog entity (see
	 * `assertSpellCatalogBinding`). Omit to skip the check (e.g. when intentionally
	 * reusing an externally-authored capability).
	 */
	catalogEntityIds?: Iterable<string>;
}

/**
 * Assert a spell capability binds to a catalog entity_definition of the SAME id (#835).
 *
 * Throws when `capabilityId` is a `srd/spell/*` identity with no matching catalog entity
 * in `knownEntityIds` — the author-time form of the validator's MF-VAL-264 convention
 * warning, surfaced as an immediate error where the spell is authored instead of a
 * post-hoc merged-bundle warning. Non-`srd/spell/*` ids (synthetic consumer affordances,
 * monster actions, routing variants) are never asserted — they legitimately have no
 * catalog entity, exactly the carve-out MF-VAL-264 keeps non-fatal.
 */
export function assertSpellCatalogBinding(
	capabilityId: string,
	knownEntityIds: Iterable<string>,
): void {
	if (!capabilityId.startsWith(SPELL_CATALOG_PREFIX)) return;
	const set =
		knownEntityIds instanceof Set ? (knownEntityIds as Set<string>) : new Set(knownEntityIds);
	if (!set.has(capabilityId)) {
		throw new Error(
			`emitSpell: capability '${capabilityId}' has no matching catalog entity_definition with the same id. ` +
				`A catalog spell is ONE identity (#835): author the entity_definition '${capabilityId}' before binding ` +
				`behavior to it, or use a non-srd/spell capability id for a synthetic affordance.`,
		);
	}
}

/** Build the identity-binding rows for one catalog spell from a single declaration. */
export function emitSpell(input: EmitSpellInput, opts: EmitSpellOptions = {}): SpellIdentityRows {
	if (opts.catalogEntityIds) assertSpellCatalogBinding(input.capabilityId, opts.catalogEntityIds);
	const outcome = input.outcomeTemplateId ?? `${input.actionId}/outcome`;
	const tags = input.tags ?? [];
	const tagRows = (idKey: "capability_id" | "action_id", idValue: string) =>
		tags.map((tag) => ({ [idKey]: idValue, tag, bundle_id: input.bundleId, source: "manifest" }));
	return {
		capability_definitions: [
			{
				capability_id: input.capabilityId,
				bundle_id: input.bundleId,
				actor_kind: "entity",
				display_name: input.displayName,
				description: input.description ?? "",
			},
		],
		capability_definition_tag: tagRows("capability_id", input.capabilityId),
		action_definitions: [
			{
				action_id: input.actionId,
				bundle_id: input.bundleId,
				required_capability: input.capabilityId,
				on_success: outcome,
				display_name: input.displayName,
			},
		],
		action_definition_tag: tagRows("action_id", input.actionId),
		outcome_templates: [
			{
				outcome_template_id: outcome,
				bundle_id: input.bundleId,
				display_name: input.actionId,
				outcome_bool: true,
				manipulation_action_id: input.actionId,
			},
		],
	};
}
