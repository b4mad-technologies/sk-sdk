// Reads the server-admitted direct-child projection; never infers containment.
import type { ObservedContainerContentRow, ObservedContainerCoverageRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asString, resolveEntityId, rows } from "./_helpers";

export const requiredTables: RequiredTables<
	[
		"visible_observed_container_content",
		"visible_observed_container_coverage",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
	]
> = [
	"visible_observed_container_content",
	"visible_observed_container_coverage",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
];
registerReaderManifest({ requiredTables });

export interface ObservedContainerItem {
	target_ref: string;
	parent_ref: string;
	name: string;
	quantity: number;
	entity_def_id: string;
}

export interface ObservedContainerContents {
	container_ref: string;
	scope: "direct";
	revision: string;
	status: "available" | "empty" | "unavailable" | "truncated";
	items: ObservedContainerItem[];
}

/** Older modules or absent coverage return the same unavailable envelope. */
export function readContainerContents(
	db: SnapshotDb,
	actor: EntityRef,
	containerRef: string,
): ObservedContainerContents {
	const result: ObservedContainerContents = {
		container_ref: containerRef,
		scope: "direct",
		revision: "unavailable",
		status: "unavailable",
		items: [],
	};
	const actorId = resolveEntityId(db, actor);
	const containerId = /^(?:entity|item):(\d+)$/.exec(containerRef)?.[1];
	if (!actorId || !containerId) return result;
	const coverage = rows<ObservedContainerCoverageRow>(
		db,
		"visibleObservedContainerCoverage",
		"visible_observed_container_coverage",
	).find(
		(row) =>
			asString(row.perceiverEntityId) === asString(actorId) &&
			asString(row.containerEntityId) === containerId,
	);
	if (!coverage) return result;
	const items = rows<ObservedContainerContentRow>(
		db,
		"visibleObservedContainerContent",
		"visible_observed_container_content",
	)
		.filter(
			(row) =>
				asString(row.perceiverEntityId) === asString(actorId) &&
				asString(row.containerEntityId) === containerId,
		)
		.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0))
		.map((row) => ({
			target_ref: `item:${row.entityId}`,
			parent_ref: containerRef,
			name: row.name,
			quantity: Number(row.quantity),
			entity_def_id: row.entityDefId,
		}));
	return {
		...result,
		revision: coverage.revision,
		status: !coverage.complete ? "truncated" : items.length ? "available" : "empty",
		items,
	};
}
