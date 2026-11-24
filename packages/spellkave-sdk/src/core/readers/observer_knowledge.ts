import type { ObserverKnowledgeRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, rows } from "./_helpers";

// `observer_knowledge` is private (ADR-0120, #915 sweep PR-2); subscribe +
// read the per-caller `visible_observer_knowledge` view — a body sees only
// its own perception rows (own bodies + ADR-0007 D-4 extent grants). Raw
// god-view → operator `just sql`.
export const requiredTables: RequiredTables<["visible_observer_knowledge"]> = [
	"visible_observer_knowledge",
];
registerReaderManifest({ requiredTables });

export interface ObserverKnowledgeEntry {
	// Post Phase 6 (Item 16 — 16-observer-knowledge-projection.md):
	// observer_knowledge is entity-keyed; the field is now `observer_entity_id`.
	observer_entity_id: string;
	known_entity_id: string;
	learned_at_tick: number;
}

/**
 * Returns all knowledge entries for the given observer entity id.
 * Empty array if the entity has no rows yet (learn hook not fired, or no anchored entities).
 */
export function readObserverKnowledge(
	db: SnapshotDb,
	observerEntityId: string,
): ObserverKnowledgeEntry[] {
	return rows<ObserverKnowledgeRow>(db, "visible_observer_knowledge")
		.filter((r) => asString(r.observerEntityId) === observerEntityId)
		.map((r) => ({
			observer_entity_id: asString(r.observerEntityId),
			known_entity_id: asString(r.knownEntityId),
			learned_at_tick: asNumber(r.learnedAtTick),
		}));
}
