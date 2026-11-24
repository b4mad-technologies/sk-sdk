// keep-file(K2): control reducer and cache delivery independently to prove wakeups and cleanup without clock races.
import { afterEach, expect, it, vi } from "vitest";
import { observeReducerAttempt } from "../provenance";
import type { SnapshotDb } from "../replay";

function cache() {
	const listeners = {
		insert: new Set<() => void>(),
		update: new Set<() => void>(),
		delete: new Set<() => void>(),
	};
	const table = {
		iter: (): Iterable<Record<string, unknown>> => [],
		onInsert: (fn: () => void) => {
			listeners.insert.add(fn);
		},
		removeOnInsert: (fn: () => void) => {
			listeners.insert.delete(fn);
		},
		onUpdate: (fn: () => void) => {
			listeners.update.add(fn);
		},
		removeOnUpdate: (fn: () => void) => {
			listeners.update.delete(fn);
		},
		onDelete: (fn: () => void) => {
			listeners.delete.add(fn);
		},
		removeOnDelete: (fn: () => void) => {
			listeners.delete.delete(fn);
		},
	};
	const db: SnapshotDb & { state: typeof table } = { state: table };
	return {
		db,
		listeners,
		emit: (kind: keyof typeof listeners) => {
			for (const fn of listeners[kind]) fn();
		},
		count: () => Object.values(listeners).reduce((n, s) => n + s.size, 0),
	};
}
afterEach(() => vi.useRealTimers());

it("settles on a reducer result without waiting for the poll interval", async () => {
	vi.useFakeTimers();
	const c = cache();
	let changed = false;
	let result: unknown;
	const pending = observeReducerAttempt({
		db: () => c.db,
		subjectId: "1",
		invoke: async () => {
			changed = true;
		},
		successPredicate: () => changed,
		collectSnapshot: () => changed,
		timeoutMs: 2000,
		pollMs: 40,
	}).then((value) => {
		result = value;
		return value;
	});
	await vi.advanceTimersByTimeAsync(0);
	expect(result).toMatchObject({ status: "success", snapshot: true });
	await pending;
	expect(c.count()).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});

it.each([
	"insert",
	"update",
	"delete",
] as const)("settles on %s delivery after the reducer result", async (kind) => {
	vi.useFakeTimers();
	const c = cache();
	let changed = false;
	let result: unknown;
	const pending = observeReducerAttempt({
		db: () => c.db,
		subjectId: "1",
		invoke: async () => {},
		successPredicate: () => changed,
		collectSnapshot: () => changed,
		timeoutMs: 2000,
		pollMs: 40,
	}).then((value) => {
		result = value;
		return value;
	});
	await vi.advanceTimersByTimeAsync(0);
	expect(result).toBeUndefined();
	changed = true;
	c.emit(kind);
	await vi.advanceTimersByTimeAsync(0);
	expect(result).toMatchObject({ status: "success", snapshot: true });
	await pending;
	expect(c.count()).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});

it("reports a reducer refusal immediately and removes cache listeners", async () => {
	vi.useFakeTimers();
	const c = cache();
	let result: unknown;
	const pending = observeReducerAttempt({
		db: () => c.db,
		subjectId: "1",
		invoke: async () => {
			throw Error("refused");
		},
		successPredicate: () => false,
		collectSnapshot: () => null,
		timeoutMs: 2000,
		pollMs: 40,
	}).then((value) => {
		result = value;
		return value;
	});
	await vi.advanceTimersByTimeAsync(0);
	expect(result).toMatchObject({ status: "rejected" });
	await pending;
	expect(c.count()).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});

it("keeps the observation deadline when neither result nor rows arrive", async () => {
	vi.useFakeTimers();
	const c = cache();
	const pending = observeReducerAttempt({
		db: () => c.db,
		subjectId: "1",
		invoke: () => new Promise<void>(() => {}),
		successPredicate: () => false,
		collectSnapshot: () => null,
		timeoutMs: 2000,
		pollMs: 40,
	});
	await vi.advanceTimersByTimeAsync(2041);
	expect(await pending).toMatchObject({ status: "unobserved_timeout" });
	expect(c.count()).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});

it.each([
	["Succeeded", "success"],
	["Failed", "rejected"],
	["RolledBack", "rejected"],
] as const)("classifies %s provenance delivered before the reducer result", async (status, expected) => {
	vi.useFakeTimers();
	const c = cache();
	const rows: Record<string, unknown>[] = [];
	c.db.state.iter = () => rows;
	c.db.visible_evaluation_provenance = c.db.state;
	let result: unknown;
	const pending = observeReducerAttempt({
		db: () => c.db,
		subjectId: "1",
		invoke: () => new Promise<void>(() => {}),
		successPredicate: () => false,
		successOnProvenance: true,
		collectSnapshot: () => null,
		timeoutMs: 2000,
		pollMs: 40,
	}).then((value) => {
		result = value;
		return value;
	});
	await vi.advanceTimersByTimeAsync(0);
	expect(result).toBeUndefined();
	rows.push({
		provenanceId: "attempt:1",
		subjectId: "1",
		status,
		kind: "Manipulate",
		createdAtTick: 1n,
		selectedTemplateIds: [],
		failureKind: "",
		failureDetail: "",
		bundleId: "",
	});
	c.emit("insert");
	await vi.advanceTimersByTimeAsync(0);
	expect(result).toMatchObject({ status: expected, provenance: { id: "attempt:1", status } });
	await pending;
	expect(c.count()).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});

it("removes listeners when a caller predicate throws", async () => {
	vi.useFakeTimers();
	const c = cache();
	const pending = observeReducerAttempt({
		db: () => c.db,
		subjectId: "1",
		invoke: async () => {},
		successPredicate: () => {
			throw Error("predicate failed");
		},
		collectSnapshot: () => null,
		timeoutMs: 2000,
		pollMs: 40,
	});
	await expect(pending).rejects.toThrow("predicate failed");
	expect(c.count()).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});

it("keeps another attempt's listeners when one observation completes", async () => {
	vi.useFakeTimers();
	const c = cache();
	let first = false;
	let second = false;
	const observe = (subjectId: string, predicate: () => boolean) =>
		observeReducerAttempt({
			db: () => c.db,
			subjectId,
			invoke: async () => {},
			successPredicate: predicate,
			collectSnapshot: () => predicate(),
			timeoutMs: 2000,
			pollMs: 40,
		});
	const a = observe("1", () => first);
	const b = observe("2", () => second);
	await vi.advanceTimersByTimeAsync(0);
	expect(c.count()).toBe(6);
	first = true;
	c.emit("update");
	await vi.advanceTimersByTimeAsync(0);
	expect(await a).toMatchObject({ status: "success" });
	expect(c.count()).toBe(3);
	second = true;
	c.emit("delete");
	await vi.advanceTimersByTimeAsync(0);
	expect(await b).toMatchObject({ status: "success" });
	expect(c.count()).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});
