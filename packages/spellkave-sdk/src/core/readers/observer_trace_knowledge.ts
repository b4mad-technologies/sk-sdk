import type { ObserverTraceKnowledgeRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, rows } from "./_helpers";

// `observer_trace_knowledge` is private (ADR-0120, #915 sweep PR-2);
// subscribe + read the per-caller `visible_observer_trace_knowledge` view.
// NOT to be confused with `visible_trace` (traces.ts), which reads this
// table server-internally to gate delivery of the (also private) `trace`
// row itself.
export const requiredTables: RequiredTables<["visible_observer_trace_knowledge"]> = [
	"visible_observer_trace_knowledge",
];
registerReaderManifest({ requiredTables });

export interface ObserverTraceKnowledgeEntry {
	observer_entity_id: string;
	known_trace_id: string;
	content: string;
	learned_at_tick: number;
}

/**
 * Returns all trace-knowledge entries for the given observer entity id.
 * Empty array if the entity has not perceived any inscribed traces yet.
 * A dangling known_trace_id (trace decayed) is intentional — caller should
 * cross-reference with the live trace table if freshness is needed. The
 * content field is the perceived trace payload captured at first perception.
 */
export function readObserverTraceKnowledge(
	db: SnapshotDb,
	observerEntityId: string,
): ObserverTraceKnowledgeEntry[] {
	return rows<ObserverTraceKnowledgeRow>(db, "visible_observer_trace_knowledge")
		.filter((r) => asString(r.observerEntityId) === observerEntityId)
		.map((r) => ({
			observer_entity_id: asString(r.observerEntityId),
			known_trace_id: asString(r.knownTraceId),
			content: asString(r.content),
			learned_at_tick: asNumber(r.learnedAtTick),
		}));
}
