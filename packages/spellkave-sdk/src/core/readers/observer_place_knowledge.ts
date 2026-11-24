import type { ObserverPlaceKnowledgeRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, rows } from "./_helpers";

// `observer_place_knowledge` is private (ADR-0120, #915 sweep PR-2);
// subscribe + read the per-caller `visible_observer_place_knowledge` view.
export const requiredTables: RequiredTables<["visible_observer_place_knowledge"]> = [
	"visible_observer_place_knowledge",
];
registerReaderManifest({ requiredTables });

export interface ObserverPlaceKnowledgeEntry {
	observer_entity_id: string;
	known_node_id: string;
	learned_at_tick: number;
}

/**
 * Returns all place-knowledge entries for the given observer entity id.
 * Empty array if the entity has not perceived any place nodes yet.
 */
export function readObserverPlaceKnowledge(
	db: SnapshotDb,
	observerEntityId: string,
): ObserverPlaceKnowledgeEntry[] {
	return rows<ObserverPlaceKnowledgeRow>(db, "visible_observer_place_knowledge")
		.filter((r) => asString(r.observerEntityId) === observerEntityId)
		.map((r) => ({
			observer_entity_id: asString(r.observerEntityId),
			known_node_id: asString(r.knownNodeId),
			learned_at_tick: asNumber(r.learnedAtTick),
		}));
}
