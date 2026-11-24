// keep-file(K2): independently deliver reducer results and row contexts to expose cross-call receipt borrowing.
import { afterEach, expect, it, vi } from "vitest";
import type { RManipulateFn } from "../core/actor_control_source";
import { asEntityRef } from "../core/ids";
import { rManipulateWrapper } from "../core/reducers/r_manipulate";
import type { SnapshotDb } from "../replay";

function host(copyOuterParams = false) {
	const rows: Record<string, unknown>[] = [];
	const inserts = new Set<(context: unknown, row: Record<string, unknown>) => void>();
	const table = {
		iter: () => rows,
		onInsert: (cb: (context: unknown, row: Record<string, unknown>) => void) => {
			inserts.add(cb);
		},
		removeOnInsert: (cb: (context: unknown, row: Record<string, unknown>) => void) => {
			inserts.delete(cb);
		},
	};
	const calls: {
		args: Parameters<RManipulateFn>[0];
		resolve: () => void;
		reject: (error: Error) => void;
	}[] = [];
	const reducer: RManipulateFn = (args) =>
		new Promise<void>((resolve, reject) => {
			calls.push({ args: copyOuterParams ? { ...args } : args, resolve, reject });
		});
	const db = { visible_evaluation_provenance: table } as unknown as SnapshotDb;
	return {
		calls,
		inserts,
		call: (index: number) => {
			const call = calls[index];
			if (!call) throw Error("missing invocation");
			return call;
		},
		attempt: () =>
			rManipulateWrapper(
				asEntityRef("1"),
				"entity:2",
				"lab/open",
				"{}",
				() => db,
				reducer,
				() => true,
				() => ({}),
				100,
				10,
				undefined,
				undefined,
				true,
			),
		deliver: (
			id: string,
			status: string,
			args?: Parameters<RManipulateFn>[0],
			kind = "Affordance",
		) => {
			const row = {
				provenanceId: id,
				subjectId: "1",
				kind,
				status,
				createdAtTick: 1n,
				selectedTemplateIds: [],
				failureKind: "",
				failureDetail: "",
				bundleId: "lab",
			};
			rows.push(row);
			const event = args
				? { tag: "Reducer", value: { reducer: { name: "r_manipulate", args } } }
				: { tag: "Transaction" };
			for (const cb of inserts) cb({ event }, row);
		},
	};
}
afterEach(() => vi.useRealTimers());

it("attributes identical overlapping calls to their own reducer delivery even in reverse order", async () => {
	vi.useFakeTimers();
	const h = host();
	const a = h.attempt();
	const b = h.attempt();
	await vi.advanceTimersByTimeAsync(0);
	expect(h.calls).toHaveLength(2);
	h.deliver("other-process", "Failed");
	h.deliver("second", "Failed", h.call(1).args);
	h.call(1).resolve();
	h.deliver("first", "Succeeded", h.call(0).args);
	h.call(0).resolve();
	await vi.advanceTimersByTimeAsync(0);
	expect(await a).toMatchObject({ status: "success", provenance: { id: "first" } });
	expect(await b).toMatchObject({ status: "rejected", provenance: { id: "second" } });
	expect(h.inserts.size).toBe(0);
});

it("cannot return borrowed success while its own invocation is pending or after transport rejection", async () => {
	vi.useFakeTimers();
	const h = host();
	let result: unknown;
	const pending = h.attempt().then((value) => {
		result = value;
		return value;
	});
	await vi.advanceTimersByTimeAsync(0);
	h.deliver("winner", "Succeeded");
	await vi.advanceTimersByTimeAsync(0);
	expect(result).toBeUndefined();
	h.call(0).reject(Error("refused"));
	await vi.advanceTimersByTimeAsync(0);
	expect(await pending).toMatchObject({ status: "rejected" });
	expect((await pending).provenance).toBeUndefined();
	expect(h.inserts.size).toBe(0);
});

it("returns uncertainty without borrowing ambient receipts when the host omits reducer context", async () => {
	vi.useFakeTimers();
	const h = host();
	const pending = h.attempt();
	await vi.advanceTimersByTimeAsync(0);
	h.deliver("ambient", "Succeeded");
	h.call(0).resolve();
	await vi.advanceTimersByTimeAsync(101);
	expect(await pending).toMatchObject({ status: "unobservable" });
	expect((await pending).provenance).toBeUndefined();
	expect(h.inserts.size).toBe(0);
});

// keep(K2): independently inject ambiguous terminal rows in one reducer delivery.
it("refuses ambiguous receipts even when the state predicate is true", async () => {
	vi.useFakeTimers();
	const h = host();
	const pending = h.attempt();
	await vi.advanceTimersByTimeAsync(0);
	h.deliver("one", "Succeeded", h.call(0).args);
	h.deliver("two", "Failed", h.call(0).args);
	h.call(0).resolve();
	await vi.advanceTimersByTimeAsync(101);
	expect(await pending).toMatchObject({ status: "unobservable" });
	expect((await pending).provenance).toBeUndefined();
	expect(h.inserts.size).toBe(0);
});

// keep(K2): a driver wrapper clones the outer reducer params but retains the unique nested args.
it("retains attribution through a wrapper that copies outer params", async () => {
	vi.useFakeTimers();
	const h = host(true);
	const pending = h.attempt();
	await vi.advanceTimersByTimeAsync(0);
	h.deliver("own", "Succeeded", h.call(0).args);
	h.call(0).resolve();
	await vi.advanceTimersByTimeAsync(0);
	expect(await pending).toMatchObject({ status: "success", provenance: { id: "own" } });
	expect(h.inserts.size).toBe(0);
});

// keep(K2): a settled reducer may only admit a deferred Predicate, or emit no observable row.
it.each(["none", "Predicate"])("settles promptly without a terminal receipt (%s)", async (kind) => {
	vi.useFakeTimers();
	const h = host();
	let result: unknown;
	const pending = h.attempt().then((value) => {
		result = value;
		return value;
	});
	await vi.advanceTimersByTimeAsync(0);
	if (kind === "Predicate") h.deliver("deferred", "Succeeded", h.call(0).args, kind);
	h.call(0).resolve();
	await vi.advanceTimersByTimeAsync(0);
	expect(result).toMatchObject({ status: "unobservable" });
	expect((await pending).provenance).toBeUndefined();
	expect(h.inserts.size).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});

// keep(K2): no reducer acknowledgement must still retain the configured failure deadline.
it("keeps the deadline when its reducer result never arrives", async () => {
	vi.useFakeTimers();
	const h = host();
	const pending = h.attempt();
	await vi.advanceTimersByTimeAsync(101);
	expect(await pending).toMatchObject({ status: "unobserved_timeout" });
	expect(h.inserts.size).toBe(0);
	expect(vi.getTimerCount()).toBe(0);
});
