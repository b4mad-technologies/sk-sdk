import type { VisibleEconomyChannelBudgetRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asString, resolveEntityId, rows } from "./_helpers";
import { isDirectlyControlled } from "./self";

export const requiredTables: RequiredTables<
	[
		"visible_economy_channel_budget",
		"world_time",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"directly_controlled_actor_spatial_location",
	]
> = [
	"visible_economy_channel_budget",
	"world_time",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"directly_controlled_actor_spatial_location",
];
registerReaderManifest({ requiredTables });

export type EconomyBudgetEnvelopeStatus = "ok" | "pending_boundary" | "unavailable";

export interface CompactEconomyBudgetChannel {
	actor_id: string;
	channel_id: string;
	pool_ms_per_round: string;
	resets_on: string;
	off_turn_eligible: boolean;
	current_window_start_ms: string;
	spent_ms: string;
	grant_ms: string;
	effective_pool_ms?: string;
	remaining_ms?: string;
	status: string;
}

export interface CompactEconomyBudget {
	status: EconomyBudgetEnvelopeStatus;
	reason?: "world_time";
	channels: CompactEconomyBudgetChannel[];
}

function mapChannel(row: VisibleEconomyChannelBudgetRow): CompactEconomyBudgetChannel {
	const disclosed = Boolean(row.remainingDisclosed);
	const status = asString(row.status);
	return {
		actor_id: asString(row.actorId),
		channel_id: asString(row.channelId),
		pool_ms_per_round: asString(row.poolMsPerRound),
		resets_on: asString(row.resetsOn),
		off_turn_eligible: Boolean(row.offTurnEligible),
		current_window_start_ms: asString(row.currentWindowStartMs),
		spent_ms: asString(row.spentMs),
		grant_ms: asString(row.grantMs),
		...(disclosed && status === "ok"
			? {
					effective_pool_ms: asString(row.effectivePoolMs),
					remaining_ms: asString(row.remainingMs),
				}
			: {}),
		status,
	};
}

/** Authoritative remaining. Does not replace kind=economy spend history. */
export function readSelfEconomyBudget(db: SnapshotDb, actorId: EntityRef): CompactEconomyBudget {
	if (!isDirectlyControlled(db, actorId)) {
		return { status: "ok", channels: [] };
	}
	const timeRows = rows(db, "world_time");
	if (timeRows.length === 0) {
		return { status: "unavailable", reason: "world_time", channels: [] };
	}
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) {
		return { status: "ok", channels: [] };
	}
	const channels = rows<VisibleEconomyChannelBudgetRow>(db, "visible_economy_channel_budget")
		.filter((row) => String(row.actorId) === String(entityId))
		.map(mapChannel)
		.sort((a, b) => a.channel_id.localeCompare(b.channel_id));
	if (channels.some((row) => row.status === "pending_boundary")) {
		return { status: "pending_boundary", channels };
	}
	return { status: "ok", channels };
}
