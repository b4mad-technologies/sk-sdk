// Per-subject FIFO ring buffer for evaluation_provenance rows.
//
// D-B note: EvaluationProvenanceRow has no correlationId field.
// Secondary index uses bundleId as the correlation key.
// This was verified against the generated binding at
// packages/spellkave-bindings/src/module_bindings/visible_evaluation_provenance_table.ts.

import type { ProvenanceRow, ProvenanceWatermark } from "../provenance";

export interface ProvenanceBufferConfig {
	connectedCap: number;
	perSubjectCap: number;
}

const DEFAULT_CONFIG: ProvenanceBufferConfig = {
	connectedCap: 512,
	perSubjectCap: 200,
};

export class ProvenanceRingBuffer {
	private readonly config: ProvenanceBufferConfig;
	private readonly connectedActorId: string;
	// Primary index: subjectId → ordered ProvenanceRow[] (insertion order, oldest first)
	private readonly bySubject = new Map<string, ProvenanceRow[]>();
	// Secondary index: bundleId → ProvenanceRow[] (multiple rows can share a bundle)
	private readonly byBundle = new Map<string, ProvenanceRow[]>();

	constructor(connectedActorId: string, config: Partial<ProvenanceBufferConfig> = {}) {
		this.connectedActorId = connectedActorId;
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	insert(row: ProvenanceRow): void {
		const cap =
			row.subject_id === this.connectedActorId
				? this.config.connectedCap
				: this.config.perSubjectCap;

		let bucket = this.bySubject.get(row.subject_id);
		if (!bucket) {
			bucket = [];
			this.bySubject.set(row.subject_id, bucket);
		}

		// Evict oldest if at capacity
		while (bucket.length >= cap) {
			const evicted = bucket.shift();
			if (evicted) this._removeFromBundleIndex(evicted);
		}

		bucket.push(row);
		this._addToBundleIndex(row);
	}

	forSubject(subjectId: string): ProvenanceRow[] {
		return this.bySubject.get(subjectId)?.slice() ?? [];
	}

	subjectIds(): readonly string[] {
		return [...this.bySubject.keys()];
	}

	byCorrelationId(bundleId: string): ProvenanceRow[] {
		return this.byBundle.get(bundleId)?.slice() ?? [];
	}

	latestWatermark(): ProvenanceWatermark | null {
		let max: ProvenanceWatermark | null = null;
		for (const bucket of this.bySubject.values()) {
			for (const row of bucket) {
				const wm: ProvenanceWatermark = { created_at_tick: row.created_at_tick, id: row.id };
				if (!max || compareWatermark(wm, max) > 0) max = wm;
			}
		}
		return max;
	}

	private _addToBundleIndex(row: ProvenanceRow): void {
		if (!row.bundle_id) return;
		let bucket = this.byBundle.get(row.bundle_id);
		if (!bucket) {
			bucket = [];
			this.byBundle.set(row.bundle_id, bucket);
		}
		bucket.push(row);
	}

	private _removeFromBundleIndex(row: ProvenanceRow): void {
		if (!row.bundle_id) return;
		const bucket = this.byBundle.get(row.bundle_id);
		if (!bucket) return;
		const idx = bucket.findIndex((r) => r.id === row.id);
		if (idx !== -1) bucket.splice(idx, 1);
		if (bucket.length === 0) this.byBundle.delete(row.bundle_id);
	}
}

function compareWatermark(a: ProvenanceWatermark, b: ProvenanceWatermark): number {
	if (a.created_at_tick < b.created_at_tick) return -1;
	if (a.created_at_tick > b.created_at_tick) return 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
