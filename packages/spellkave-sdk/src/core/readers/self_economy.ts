import type { VisibleEconomyChannelSpendRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asString, resolveEntityId, rows } from "./_helpers";
import { readRecentChannelSpends } from "./action_economy_events";
import { isDirectlyControlled } from "./self";

export const requiredTables: RequiredTables<
	[
		"visible_economy_channel_spend",
		"event_channel_spend",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"directly_controlled_actor_spatial_location",
	]
> = [
	"visible_economy_channel_spend",
	"event_channel_spend",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"directly_controlled_actor_spatial_location",
];
registerReaderManifest({ requiredTables });

const RECENT_EVENT_SCAN_CAP = 2_000;

export interface CompactSelfEconomyLastSpend {
	event_id: string;
	cost_ms: string;
	remaining_ms: string;
}

export interface CompactSelfEconomySpend {
	channel_id: string;
	/** Cumulative fiction-ms spent from this channel in `window_start_ms`
	 * (current-window standing, `visible_economy_channel_spend`). */
	spent_ms: string;
	window_start_ms: string;
	/** The most recent same-window `event_channel_spend` line for this
	 * channel — the exact `cost_ms` an action drew and the `remaining_ms`
	 * left afterward (#2096: "how much of my turn is left"). Absent when no
	 * matching event is present in the reader's scan window (should not
	 * happen for a live connection: every `consume()` call writes both rows
	 * in the same reducer transaction). Sourced from a table the server does
	 * NOT scope per caller (see the `RECENT_EVENT_SCAN_CAP` comment above) —
	 * client-side filtering only, tracked for a proper view in #2110. */
	last_spend?: CompactSelfEconomyLastSpend;
}

/** Full authorized self-economy projection: the connected actor's OWN
 * `visible_economy_channel_spend` current-window standing (owner-body-bounded
 * by the server view, ADR-0120, #915), one row per channel the actor has
 * touched, joined against the latest same-window `event_channel_spend` row
 * for that channel's exact `cost_ms`/`remaining_ms` (#2083's typed-reader-home
 * ask plus #2096's quantitative budget projection, in one place). Gated
 * behind `isDirectlyControlled`, matching `readSelfCapabilities`/
 * `readSelfRecentEvaluations`'s own posture for the `spent_ms`/`window_start_ms`
 * half — but see `last_spend`'s own doc comment and the `RECENT_EVENT_SCAN_CAP`
 * comment above: that half's actor scoping is this reader's own filter, not a
 * server-enforced boundary (#2110). */
export function readSelfEconomyChannelSpends(
	db: SnapshotDb,
	actorId: EntityRef,
): CompactSelfEconomySpend[] {
	if (!isDirectlyControlled(db, actorId)) return [];
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return [];
	const state = rows<VisibleEconomyChannelSpendRow>(db, "visible_economy_channel_spend").filter(
		(row) => String(row.actorId) === String(entityId),
	);
	const events = readRecentChannelSpends(db, RECENT_EVENT_SCAN_CAP).filter(
		(row) => row.actor === String(entityId),
	);
	return state
		.map((row) => {
			const channelId = asString(row.channelId);
			const windowStartMs = asString(row.windowStartMs);
			const lastEvent = events.find(
				(event) => event.channel === channelId && event.window === windowStartMs,
			);
			return {
				channel_id: channelId,
				spent_ms: asString(row.spentMs),
				window_start_ms: windowStartMs,
				...(lastEvent === undefined
					? {}
					: {
							last_spend: {
								event_id: lastEvent.event_id,
								cost_ms: lastEvent.cost_ms,
								remaining_ms: lastEvent.remaining_ms,
							},
						}),
			};
		})
		.sort((a, b) => a.channel_id.localeCompare(b.channel_id));
}
