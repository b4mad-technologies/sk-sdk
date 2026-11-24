import type {
	ConditionBoundaryExpiryRow as DbConditionBoundaryExpiryRow,
	EventActionRechargeFiredRow as DbEventActionRechargeFiredRow,
	EventBoundaryFiredRow as DbEventBoundaryFiredRow,
	EventChannelSpendRow as DbEventChannelSpendRow,
	EventChannelWindowRefreshRow as DbEventChannelWindowRefreshRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString, rows } from "./_helpers";

export const channelSpendRequiredTables: RequiredTables<["event_channel_spend"]> = [
	"event_channel_spend",
];
export const boundaryFiredRequiredTables: RequiredTables<["event_boundary_fired"]> = [
	"event_boundary_fired",
];
export const channelWindowRefreshRequiredTables: RequiredTables<["event_channel_window_refresh"]> =
	["event_channel_window_refresh"];
export const actionRechargeFiredRequiredTables: RequiredTables<["event_action_recharge_fired"]> = [
	"event_action_recharge_fired",
];
export const conditionBoundaryExpiryRequiredTables: RequiredTables<
	["visible_condition_boundary_expiry"]
> = ["visible_condition_boundary_expiry"];
registerReaderManifest({ requiredTables: channelSpendRequiredTables });
registerReaderManifest({ requiredTables: boundaryFiredRequiredTables });
registerReaderManifest({ requiredTables: channelWindowRefreshRequiredTables });
registerReaderManifest({ requiredTables: actionRechargeFiredRequiredTables });
registerReaderManifest({ requiredTables: conditionBoundaryExpiryRequiredTables });

export interface ChannelSpendEventRow {
	event_id: string;
	actor: string;
	channel: string;
	cost_ms: string;
	remaining_ms: string;
	window: string;
}

export interface BoundaryFiredEventRow {
	event_id: string;
	boundary: string;
	owner: string;
	source: string;
	window: string;
}

export interface ChannelWindowRefreshEventRow {
	event_id: string;
	actor: string;
	boundary: string;
	window: string;
}

export interface ActionRechargeFiredEventRow {
	event_id: string;
	actor: string;
	affordance: string;
	boundary: string;
}

export interface ConditionBoundaryExpiryRow {
	target_condition_row_id: string;
	owner_actor: string;
	boundary_id: string;
	armed_at_window_ms: string;
	out_of_session_due_tick: string;
}

function newestFirst<T extends { event_id: string }>(values: T[], n: number): T[] {
	if (n <= 0) return [];
	values.sort((a, b) => b.event_id.localeCompare(a.event_id, undefined, { numeric: true }));
	return values.slice(0, n);
}

export function readRecentChannelSpends(db: SnapshotDb, n: number): ChannelSpendEventRow[] {
	const values = rows<DbEventChannelSpendRow>(db, "event_channel_spend").map((row) => ({
		event_id: asString(row.eventId),
		actor: asString(row.actor),
		channel: row.channel,
		cost_ms: asString(row.costMs),
		remaining_ms: asString(row.remainingMs),
		window: asString(row.window),
	}));
	return newestFirst(values, n);
}

export function readRecentBoundaryFirings(db: SnapshotDb, n: number): BoundaryFiredEventRow[] {
	const values = rows<DbEventBoundaryFiredRow>(db, "event_boundary_fired").map((row) => ({
		event_id: asString(row.eventId),
		boundary: row.boundary,
		owner: asString(row.owner),
		source: row.source,
		window: asString(row.window),
	}));
	return newestFirst(values, n);
}

export function readRecentChannelWindowRefreshes(
	db: SnapshotDb,
	n: number,
): ChannelWindowRefreshEventRow[] {
	const values = rows<DbEventChannelWindowRefreshRow>(db, "event_channel_window_refresh").map(
		(row) => ({
			event_id: asString(row.eventId),
			actor: asString(row.actor),
			boundary: row.boundary,
			window: asString(row.window),
		}),
	);
	return newestFirst(values, n);
}

export function readRecentActionRechargeFirings(
	db: SnapshotDb,
	n: number,
): ActionRechargeFiredEventRow[] {
	const values = rows<DbEventActionRechargeFiredRow>(db, "event_action_recharge_fired").map(
		(row) => ({
			event_id: asString(row.eventId),
			actor: asString(row.actor),
			affordance: row.affordance,
			boundary: row.boundary,
		}),
	);
	return newestFirst(values, n);
}

/** Owner-scoped condition expiry arms. A caller never receives another
 * actor's rows because the server view applies the visibility boundary. */
export function readConditionBoundaryExpiries(db: SnapshotDb): ConditionBoundaryExpiryRow[] {
	return rows<DbConditionBoundaryExpiryRow>(db, "visible_condition_boundary_expiry")
		.map((row) => ({
			target_condition_row_id: asString(row.targetConditionRowId),
			owner_actor: asString(row.ownerActor),
			boundary_id: row.boundaryId,
			armed_at_window_ms: asString(row.armedAtWindowMs),
			out_of_session_due_tick: asString(row.outOfSessionDueTick),
		}))
		.sort((a, b) =>
			a.target_condition_row_id.localeCompare(b.target_condition_row_id, undefined, {
				numeric: true,
			}),
		);
}
