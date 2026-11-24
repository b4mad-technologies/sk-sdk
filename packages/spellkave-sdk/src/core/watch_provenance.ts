// Isolated filtered provenance subscription for a specific actor.
//
// Issues a second filtered subscription on the SAME DbConnection as the session.
// Uses a dedicated ProvenanceRingBuffer so it is fully isolated from the default
// session buffer — including when actorId === connectedActorId (past-eviction recovery).

import type { DbConnection } from "@spellkave/bindings";
import type { ProvenanceRow } from "../provenance";
import { ProvenanceRingBuffer } from "./provenance_buffer";

export interface WatchProvenanceHandle {
	/** All rows accumulated since subscription applied, filtered by actorId and sinceTick. */
	rows: ProvenanceRow[];
	/** Unsubscribes the watch subscription and releases resources. */
	close(): void;
}

/**
 * Open a second filtered subscription for `actorId` with rows newer than `sinceTick`.
 * Returns a handle with a snapshot of accumulated rows and a `close()` teardown.
 *
 * Isolated from the default session ring buffer regardless of which actorId is requested.
 * Use for non-default subjects and for connected-actor past-eviction recovery.
 */
export function watchProvenanceFor(
	conn: DbConnection,
	actorId: string,
	sinceTick: bigint,
): WatchProvenanceHandle {
	const isolatedBuffer = new ProvenanceRingBuffer(actorId);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	// biome-ignore lint/suspicious/noExplicitAny: pre-existing debt from #1368 biome onboarding, tracked in #1455
	const handle = conn.subscriptionBuilder().subscribe((tables: any) =>
		tables.visible_evaluation_provenance.where(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			// biome-ignore lint/suspicious/noExplicitAny: pre-existing debt from #1368 biome onboarding, tracked in #1455
			(p: any) => p.subjectId.eq(actorId),
		),
	);

	// Per-row onInsert callback: receives the single new row directly.
	// Storing the reference so removeOnInsert() can deregister it in close().
	const db = conn.db as unknown as Record<string, TableHandle | undefined>;
	const tableHandle = db.visible_evaluation_provenance ?? db.evaluation_provenance;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	// biome-ignore lint/suspicious/noExplicitAny: pre-existing debt from #1368 biome onboarding, tracked in #1455
	const insertCb = (_ctx: any, raw: unknown) => {
		const r = raw as RawProvenanceRow;
		const tick =
			typeof r.createdAtTick === "bigint" ? r.createdAtTick : BigInt(String(r.createdAtTick ?? 0));
		if (tick <= sinceTick) return;
		isolatedBuffer.insert({
			id: r.provenanceId,
			kind: tagString(r.kind),
			status: tagString(r.status),
			subject_id: r.subjectId,
			failure_kind: r.failureKind,
			failure_detail: r.failureDetail,
			selected_template_ids: Array.isArray(r.selectedTemplateIds)
				? r.selectedTemplateIds.map(String)
				: [],
			created_at_tick: tick,
			bundle_id: r.bundleId,
		});
	};

	if (tableHandle?.onInsert) {
		tableHandle.onInsert(insertCb);
	}

	return {
		get rows(): ProvenanceRow[] {
			return isolatedBuffer.forSubject(actorId);
		},
		close(): void {
			// Deregister the insert callback BEFORE unsubscribing so no further
			// rows are routed to isolatedBuffer after close() returns.
			if (tableHandle?.removeOnInsert) {
				tableHandle.removeOnInsert(insertCb);
			}
			handle.unsubscribe();
		},
	};
}

interface TableHandle {
	iter(): Iterable<Record<string, unknown>>;
	onInsert?: (cb: (ctx: unknown, row: unknown) => void) => void;
	removeOnInsert?: (cb: (ctx: unknown, row: unknown) => void) => void;
}

interface RawProvenanceRow {
	provenanceId: string;
	kind: unknown;
	status: unknown;
	subjectId: string;
	failureKind: string;
	failureDetail: string;
	selectedTemplateIds: unknown;
	createdAtTick: unknown;
	bundleId: string;
}

function tagString(v: unknown): string {
	if (typeof v === "string") return v;
	if (v && typeof v === "object") {
		const tag = (v as { tag?: unknown }).tag;
		if (typeof tag === "string") return tag;
	}
	return String(v ?? "");
}
