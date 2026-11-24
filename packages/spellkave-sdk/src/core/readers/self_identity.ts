import type {
	EntityDefinitionTagRow,
	EntityTagRow,
	TagValueDefinitionRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asString, buildEntitySummaryMap, resolveEntityId, rows } from "./_helpers";
import { isDirectlyControlled } from "./self";

// This reader's own direct table access: resolving an actor's identity
// facets needs its `entity_def_id` (via `buildEntitySummaryMap`, which reads
// `entity`), the tags authored against that definition (`entity_definition_tag`),
// the instance tags on this body (`entity_tag`, #2232 / same axis as #2228),
// and the bundle-authored catalog metadata for any of those exact tag
// values (`tag_value_definition`).
export const requiredTables: RequiredTables<
	[
		"entity",
		"entity_definition_tag",
		"visible_entity_tag",
		"visible_entity_tag_coverage",
		"tag_value_definition",
	]
> = [
	"entity",
	"entity_definition_tag",
	"visible_entity_tag",
	"visible_entity_tag_coverage",
	"tag_value_definition",
];
registerReaderManifest({ requiredTables });

export interface SelfIdentityFacet {
	/** The authored dotted tag verbatim (e.g. `"srd.species.human"`, or a
	 * bare tag like `"creature"`). */
	tag: string;
	/** The tag's declared facet prefix (e.g. `"srd.species"`), present only
	 * when a `tag_value_definition` row exists for this exact tag. */
	prefix?: string;
	/** Source-derived discovery prose for this exact tag value, present only
	 * when a `tag_value_definition` row exists for this exact tag. */
	description?: string;
}

/**
 * The connected actor's own authored identity tags (species, class,
 * background, …): definition tags union instance `entity_tag` (#2232),
 * LEFT-joined against the bundle's `tag_value_definition` catalog for
 * `prefix`/`description` where a definition was authored. A bare tag with
 * no catalog row (e.g. `"creature"`) is still returned, just without those
 * two fields — never an empty string in their place.
 *
 * This is the detailed "who am I" surface (#2119 follow-up, 2026-08-03): the
 * ENRICHED facets (tag + catalog prefix + description) are served here at
 * `self_states kind=identity`. #2119 had also removed identity from the
 * recurring glance on the reasoning that it is static and belongs at session
 * start; live play (sk-0m4.120.34) reversed that call — the player-tool
 * `self_summary` now re-surfaces a COMPACT form of these facets (tag + prefix,
 * no description), keeping this reader as the enriched drill-down that carries
 * the descriptions. Content-neutral like
 * `readActorStates`' own `tags` field: this reader does NOT parse a dotted
 * tag into facet/value or mint `species`/`class`/`background` as first-class
 * fields — rendering a phrase like "Human Fighter (Soldier)" from these rows
 * stays the consumer's job.
 *
 * Gated behind `isDirectlyControlled`, matching every other self reader.
 */
export function readSelfIdentity(db: SnapshotDb, actorId: EntityRef): SelfIdentityFacet[] {
	if (!isDirectlyControlled(db, actorId)) return [];
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return [];
	const entityDefId = buildEntitySummaryMap(db).get(String(entityId))?.entity_def_id;
	if (entityDefId === undefined) return [];
	const definitions = new Map(
		rows<TagValueDefinitionRow>(db, "tag_value_definition").map((row) => [asString(row.tag), row]),
	);
	const tags = new Set<string>();
	for (const row of rows<EntityDefinitionTagRow>(db, "entity_definition_tag")) {
		if (asString(row.entityDefId) === entityDefId) tags.add(asString(row.tag));
	}
	const instanceId = String(entityId);
	for (const row of rows<EntityTagRow>(db, "visible_entity_tag")) {
		if (String(row.entityId) === instanceId) tags.add(asString(row.tag));
	}
	return [...tags]
		.map((tag) => {
			const definition = definitions.get(tag);
			return {
				tag,
				...(definition === undefined
					? {}
					: {
							prefix: asString(definition.prefix),
							description: asString(definition.description),
						}),
			};
		})
		.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
}
