import type { SnapshotDb } from "../../connection";
import type { ProvenanceRow } from "../../provenance";
import type { RManipulateFn } from "../actor_control_source";

function record(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

/** The pinned SpacetimeDB transport retains params.args by reference in the
 * caller's ReducerResult event. Other sockets deliver Transaction events.
 * Match this per-call object, never serialized values, subject, or timing.
 * Driver-token wrappers copy the outer params but retain this inner object.
 * Missing/ambiguous delivery context cannot establish a receipt. */
export function manipulationReceipt(
	db: SnapshotDb,
	subjectId: string,
	args: () => Parameters<RManipulateFn>[0]["args"] | undefined,
) {
	const table = db.visibleEvaluationProvenance ?? db.visible_evaluation_provenance;
	const terminal = new Map<string, string>();
	let settled = false;
	const onInsert = (context?: unknown, value?: unknown) => {
		const event = record(record(context)?.event);
		const reducer = record(record(event?.value)?.reducer);
		const payload = record(reducer?.args);
		const row = record(value);
		const expected = args();
		if (
			!row ||
			row.subjectId !== subjectId ||
			!expected ||
			event?.tag !== "Reducer" ||
			reducer?.name !== "r_manipulate" ||
			payload?.args !== expected ||
			(row?.kind !== "Affordance" && record(row?.kind)?.tag !== "Affordance")
		)
			return;
		const status = typeof row.status === "string" ? row.status : record(row.status)?.tag;
		if (
			typeof row.provenanceId === "string" &&
			typeof status === "string" &&
			["Succeeded", "Failed", "RolledBack"].includes(status)
		)
			terminal.set(row.provenanceId, status);
	};
	if (table?.onInsert && table.removeOnInsert) table.onInsert(onInsert);
	return {
		settle: () => {
			settled = true;
		},
		fail: () => {
			terminal.clear();
			settled = true;
		},
		matches: (row: ProvenanceRow) => settled && terminal.size === 1 && terminal.has(row.id),
		succeeded: () => settled && terminal.size === 1 && [...terminal.values()][0] === "Succeeded",
		// Caller ReducerResult rows arrive before the reducer promise resolves.
		// A settled call cannot gain an attributable terminal receipt later.
		unattributable: () => settled && terminal.size !== 1,
		close: () => {
			table?.removeOnInsert?.(onInsert);
		},
	};
}
