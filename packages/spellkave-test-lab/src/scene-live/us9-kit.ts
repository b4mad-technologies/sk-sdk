// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "One generated us9 kit bundle (relieve-puddle capability, niche, Spawn action and puddle definition) is applied once by the scene-live seed; the us9-act live tests bind and act on it from private scenes."}
// ci-allow(embedded-manifest-schema): kit manifest assembler - TOML built from runtime fragments, not a standalone manifest (same shape as prompt-kit.ts)
/**
 * US9 kit for the scene live tests: the definitions behind "a freshly spawned
 * NPC gets an action it can cast". Definitions only, applied ONCE by `seed.ts`:
 * a capability, a place-provided niche, a deterministic cast action and a
 * `Spawn` effect that puts a puddle entity at the caster's location. Each test
 * then builds a private scene (a place, an unbound NPC with the capability,
 * the niche attached to its place) on top of it.
 *
 * Ported from the session package's us9-act seed (`us9act` bundle, authored
 * through the verb tools). Same ids, so the claims name the same action.
 */

import { stringify } from "smol-toml";

export const US9_KIT = "us9act";
export const US9_CAPABILITY = `${US9_KIT}/spell/relieve_puddle`;
export const US9_NICHE = `capability:${US9_CAPABILITY}`;
export const US9_ACTION = `${US9_KIT}/cast_relieve_puddle`;
export const US9_PUDDLE_DEF = `${US9_KIT}/item/puddle`;

type Table = Record<string, unknown>;

/** The kit bundle as TOML. Pure. */
export function us9KitSource(): string {
	const B = { bundle_id: US9_KIT };
	const doc: Record<string, Table[]> = {
		bundles: [
			{
				...B,
				display_name: "Scene-live US9 kit",
				author: "spellkave-test",
				version: "1.0.0",
				depends_on: ["core"],
			},
		],
		capability_definitions: [
			{
				...B,
				capability_id: US9_CAPABILITY,
				actor_kind: "entity",
				default_visibility: "Public",
				display_name: "Cast Relieve Puddle",
				description: "",
			},
		],
		niche_definitions: [
			{
				...B,
				niche_id: US9_NICHE,
				display_name: US9_NICHE,
				description: "Place-provided niche of the US9 cast action.",
				predicate_source: "",
				provider: "place",
			},
		],
		entity_definitions: [
			{
				...B,
				entity_def_id: US9_PUDDLE_DEF,
				display_name: "Puddle",
				description: "A small, harmless puddle left on the ground (US9 kit).",
				stackable: false,
			},
		],
		effect_definitions: [
			{
				...B,
				effect_def_id: `${US9_ACTION}/spawn`,
				primitives_csv: "Spawn",
				parameters_schema_json: JSON.stringify({
					blueprint_id: US9_PUDDLE_DEF,
					location_ref: { kind: "binding", id: "ActorSpatialRef" },
				}),
			},
		],
		consequence_templates: [
			{
				...B,
				template_id: `${US9_ACTION}/success`,
				effect_refs_csv: `${US9_ACTION}/spawn`,
			},
		],
		action_definitions: [
			{
				...B,
				action_id: US9_ACTION,
				display_name: "Cast Relieve Puddle",
				cost_time_ms: 1000,
				on_success: `${US9_ACTION}/success`,
				on_failure: "",
				required_capability: US9_CAPABILITY,
				resolution_mode: "Deterministic",
				resolution_predicate_source: "",
				resumable: false,
				self_eligible: false,
				self_only: false,
				session_def_id: "",
			},
		],
		action_definition_tag: [
			{ ...B, action_id: US9_ACTION, tag: `${US9_KIT}.always_available`, source: "manifest" },
		],
		outcome_templates: [
			{
				...B,
				outcome_template_id: `${US9_ACTION}/outcome`,
				manipulation_action_id: US9_ACTION,
				display_name: US9_ACTION,
				consequence_template_id: "",
				outcome_bool: true,
				sense_visibility: "local",
			},
		],
		affordance_templates: [
			{
				...B,
				template_id: `${US9_ACTION}/affordance`,
				capability_id: US9_CAPABILITY,
				niche_id: US9_NICHE,
				display_name: "Cast Relieve Puddle",
				outcome_template_id: `${US9_ACTION}/outcome`,
				accepts_global_storm: false,
				locality_class: "",
				movement_cost_expression_source: "",
				predicate_bool: true,
				predicate_source: "",
				range_m: 0.0,
				reads_occupancy: false,
				stratification_ok: true,
			},
		],
	};
	return `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n${stringify(doc)}`;
}
