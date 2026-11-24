import { afterEach, describe, expect, it, vi } from "vitest";
import type { TestWorld } from "./live";
import { receiveNamespaceActor } from "./namespace-proof";

function heldTable() {
	const rows: Record<string, unknown>[] = [];
	const listeners = new Set<() => void>();
	return {
		iter: () => rows,
		onInsert: (notify: () => void) => listeners.add(notify),
		insert(row: Record<string, unknown>) {
			rows.push(row);
			for (const notify of listeners) notify();
		},
	};
}

function ownerCache() {
	const db = { visibleManifestAuthoredEntity: heldTable(), actor: heldTable() };
	const world = { conn: { db }, db: () => db } as unknown as TestWorld;
	return { world, db };
}

const manifestKey = "privileged_namespace_bridge:region_target";
const entity = { manifestKey, entityId: 42n };
const actor = { actorId: 7n, currentBody: 42n };

describe("namespace fixture delivery before actor resolution", () => {
	afterEach(() => vi.useRealTimers());
	it.each([
		"body-first",
		"actor-first",
	])("holds the owner lookup until both rows arrive (%s)", async (order) => {
		vi.useFakeTimers();
		const { world, db } = ownerCache();
		// Hold delivery independently of the already-completed admission.
		let resolved = false;
		const received = receiveNamespaceActor(world, manifestKey).then((result) => {
			resolved = true;
			return result;
		});
		await vi.advanceTimersByTimeAsync(0);
		const resolvedBeforeDelivery = resolved;
		const otherOwner = ownerCache();
		otherOwner.db.visibleManifestAuthoredEntity.insert(entity);
		otherOwner.db.actor.insert(actor);
		db.visibleManifestAuthoredEntity.insert({ manifestKey: "other:actor", entityId: 99n });
		db.actor.insert({ actorId: 9n, currentBody: 99n });
		await vi.advanceTimersByTimeAsync(0);
		const resolvedOnOtherRows = resolved;
		if (order === "body-first") db.visibleManifestAuthoredEntity.insert(entity);
		else db.actor.insert(actor);
		await vi.advanceTimersByTimeAsync(0);
		const resolvedAfterOneRow = resolved;
		if (order === "body-first") db.actor.insert(actor);
		else db.visibleManifestAuthoredEntity.insert(entity);
		const result = await received;
		expect(resolvedBeforeDelivery).toBe(false);
		expect(resolvedOnOtherRows).toBe(false);
		expect(resolvedAfterOneRow).toBe(false);
		expect(result).toEqual({ body: 42n, actor: 7n });
		expect(vi.getTimerCount()).toBe(0);
	});
	it("reads an already hydrated owner cache without a subscription wait", async () => {
		const { world, db } = ownerCache();
		db.visibleManifestAuthoredEntity.insert(entity);
		db.actor.insert(actor);
		await expect(receiveNamespaceActor(world, manifestKey)).resolves.toEqual({
			body: 42n,
			actor: 7n,
		});
	});
});
