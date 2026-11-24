import type { ActionDefinitionTagRow, EntityTagRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { rows } from "./_helpers";

// Readers over the relational tag tables. Both are type-level reads (SDK §1) —
// they surface author-given tags so a host (e.g. the world-explorer NPC bot) can
// classify by tag instead of by hard-coded identity:
//
//   - visible_entity_tag (X11/CR-4): admitted instance tags (by numeric entity_id).
//     The bot reads `faction:*` here to know whom to oppose.
//   - action_definition_tag: tags on an action (by action_id string). The bot
//     reads `combat` / `attack:*` here to know which affordances are hostile.
//
// Definition-level tags (entity_definition_tag) are deliberately NOT unioned in
// here: that union is the server-side `has_tag` DSL fact's job (ADR-0038 D-3).
// These readers expose admitted instance rows and public action tag rows; a host that needs the
// def-tag union should gate through an affordance predicate, not re-derive it.

export const entityTagTables: RequiredTables<
	["visible_entity_tag", "visible_entity_tag_coverage"]
> = ["visible_entity_tag", "visible_entity_tag_coverage"];
export const actionTagTables: RequiredTables<["action_definition_tag"]> = ["action_definition_tag"];
registerReaderManifest({ requiredTables: entityTagTables });
registerReaderManifest({ requiredTables: actionTagTables });

/** All admitted instance tags set on an entity, by its numeric entity id. */
export function readEntityTags(db: SnapshotDb, entityId: string | bigint): string[] {
	const target = String(entityId);
	return rows<EntityTagRow>(db, "visible_entity_tag")
		.filter((row) => String((row as unknown as { entityId: unknown }).entityId) === target)
		.map((row) => (row as unknown as { tag: string }).tag);
}

/** The first `srd.faction.<name>` or legacy `faction:<name>` tag on an entity, or null if it has no faction.
 * The "<name>" suffix is returned (e.g. "monsters", "cragmaw"), not the full tag. */
export function readEntityFaction(db: SnapshotDb, entityId: string | bigint): string | null {
	const tags = readEntityTags(db, entityId);
	for (const t of tags) {
		if (t.startsWith("srd.faction.")) return t.slice("srd.faction.".length);
		if (t.startsWith("faction:")) return t.slice("faction:".length);
	}
	return null;
}

/** All tags on an action definition, by its action_id. */
export function readActionTags(db: SnapshotDb, actionId: string): string[] {
	return rows<ActionDefinitionTagRow>(db, "action_definition_tag")
		.filter((row) => (row as unknown as { actionId: string }).actionId === actionId)
		.map((row) => (row as unknown as { tag: string }).tag);
}
