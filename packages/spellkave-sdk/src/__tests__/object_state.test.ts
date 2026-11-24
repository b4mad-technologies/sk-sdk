import { afterEach, describe, expect, it, vi } from "vitest";

import type { SnapshotDb } from "../connection";
import { awaitObjectStateApplied, readObjectStateInt } from "../core/readers/object_state";

interface FakeRow {
	[k: string]: unknown;
}

function table(rows: FakeRow[]): { iter: () => Iterable<FakeRow> } {
	return { iter: () => rows };
}

function makeDb(rows: FakeRow[]): SnapshotDb {
	return {
		visible_object_state: table(rows),
	};
}

describe("object_state reader", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("reads tagged Int DslValue rows by target and state", () => {
		const db = makeDb([
			{
				targetKind: "entity",
				targetId: 14n,
				stateId: "srd/hp",
				value: { tag: "Int", value: 13n },
			},
		]);

		expect(
			readObjectStateInt(db, {
				targetKind: "entity",
				targetId: "14",
				stateId: "srd/hp",
			}),
		).toBe(13n);
	});

	it("waits for a reducer-applied object_state delta to reach the local cache", async () => {
		vi.useFakeTimers();

		const rows: FakeRow[] = [
			{
				targetKind: "entity",
				targetId: "14",
				stateId: "srd/hp",
				value: { tag: "Int", value: 5n },
			},
		];
		const db = makeDb(rows);

		const wait = awaitObjectStateApplied(() => db, {
			targetKind: "entity",
			targetId: "14",
			stateId: "srd/hp",
			previousValue: 5n,
			delta: 8n,
			timeoutMs: 100,
			pollMs: 10,
		});

		setTimeout(() => {
			rows[0] = {
				targetKind: "entity",
				targetId: "14",
				stateId: "srd/hp",
				value: { tag: "Int", value: 13n },
			};
		}, 20);

		await vi.runAllTimersAsync();
		await expect(wait).resolves.toBe(13n);
	});

	it("returns null when the expected object_state value is not observed before timeout", async () => {
		vi.useFakeTimers();

		const db = makeDb([
			{
				targetKind: "entity",
				targetId: "14",
				stateId: "srd/hp",
				value: { tag: "Int", value: 5n },
			},
		]);

		const wait = awaitObjectStateApplied(() => db, {
			targetKind: "entity",
			targetId: "14",
			stateId: "srd/hp",
			expectedValue: 13n,
			timeoutMs: 20,
			pollMs: 5,
		});

		await vi.runAllTimersAsync();
		await expect(wait).resolves.toBeNull();
	});
});
