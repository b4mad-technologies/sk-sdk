// Trace-row lookup for r_inscribe_trace — split out to keep the wrapper
// itself under the sdk_loc_ceiling (LR-102).

import type { SnapshotDb } from "../../connection";

export function findTraceId(
	db: SnapshotDb,
	kind: string,
	locationRef: string,
	inscribedBy: string,
): bigint | undefined {
	// `trace` is private (ADR-0120, #915); read back through `visible_trace`. The
	// inscriber perceives its own fresh trace at inscription time (ADR-0040 seam A),
	// so the just-written row is in the inscriber's perception-bounded view.
	const handle = db.visible_trace;
	if (!handle) return undefined;
	for (const raw of handle.iter()) {
		const r = raw as unknown as {
			kind: string;
			locationRef: string;
			inscribedBy: string;
			traceId: unknown;
		};
		if (r.kind === kind && r.locationRef === locationRef && r.inscribedBy === inscribedBy) {
			return typeof r.traceId === "bigint" ? r.traceId : BigInt(String(r.traceId ?? 0));
		}
	}
	return undefined;
}
