/** Five public `entity_definition_initial_*` catalogs the apply tool needs
 * for D-8's expected set. Named here so `sk` can pass them as a reader
 * manifest without this package depending on the SDK. */
export const APPLYSET_DEFINITION_TABLES = [
	"entity_definition_initial_state",
	"entity_definition_initial_capability",
	"entity_definition_initial_condition",
	"entity_definition_initial_containment",
	"entity_definition_initial_equipment",
] as const;

export type ApplysetDefinitionTable = (typeof APPLYSET_DEFINITION_TABLES)[number];
