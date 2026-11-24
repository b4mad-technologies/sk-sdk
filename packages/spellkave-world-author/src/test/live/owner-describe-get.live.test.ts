/**
 * Publisher `describe` / `get` over the owner cache, proven on private scenes of the package's
 * one shared database. Re-homed from the elven-mini live file `owner-get-describe`
 * (ledger/designs/rehome-map-kernel-sdk.md): the world-author half that the sdk could not hold
 * because world-author depends on the sdk. Every assertion is scoped to the test's own scene.
 */
import { READER_SCOPED_TABLES } from "@spellkave/sdk";
import { readCurrentScene } from "@spellkave/sdk/readers";
import type { SnapshotDb } from "@spellkave/sdk/replay";
import { type Scene, waitForEvent } from "@spellkave/test-lab";
import { afterAll, describe, expect, it } from "vitest";
import { AUTHORED_ENTITIES_ONLY } from "../../owner-instance-read";
import {
	asWorld,
	buildChestScene,
	closeExtrasOwner,
	liveWorldRef,
	localNode,
	openOwnerSession,
	ownerReader,
} from "./support";

describe.skipIf(!localNode)("owner describe / get on private scenes", () => {
	const scenes: Scene[] = [];
	const sessions: Awaited<ReturnType<typeof openOwnerSession>>[] = [];
	afterAll(async () => {
		for (const session of sessions) session.disconnect();
		for (const s of scenes) await s.close();
		await closeExtrasOwner();
	});
	const track = async (): Promise<Scene> => {
		const s = await buildChestScene();
		scenes.push(s);
		return s;
	};
	const open = async (token: string | null) => {
		const session = await openOwnerSession(token);
		sessions.push(session);
		return session;
	};
	const key = (s: Scene, name: string) => `${s.prefix}/${name}`;

	it("publisher describe of the chest names its key, place, tick, label and contents; get returns the row", async () => {
		const s = await track();
		const publisher = await open(liveWorldRef().token);
		expect(publisher.readsAsPublisher).toBe(true);
		const reader = ownerReader(publisher);
		const chestKey = key(s, "chest");
		await waitForEvent(
			asWorld(publisher),
			() => {
				const d = reader.describe({ kind: "entities", key: chestKey });
				return (
					d.ok &&
					d.belonging.some((b) => b.relation === "containment" && b.entity_key === key(s, "gem"))
				);
			},
			"owner cache converges on the chest containing the gem",
		);
		const described = reader.describe({ kind: "entities", key: chestKey });
		expect(described.ok).toBe(true);
		if (!described.ok) return;
		expect(described.labels).toContain(AUTHORED_ENTITIES_ONLY);
		expect(BigInt(described.tick)).toBeGreaterThanOrEqual(publisher.currentWorldTick());
		expect(described.row.entity_key).toBe(chestKey);
		expect(described.place).toBe(s.reads.nodeId("yard"));
		expect(described.numeric_id).toMatch(/^\d+$/);
		const inChest = described.belonging.filter(
			(row) => row.relation === "containment" && row.belongs_to_key === chestKey,
		);
		expect(inChest.map((row) => row.entity_key)).toEqual([key(s, "gem")]);
		const listed = reader.get({ kind: "entities", key: chestKey });
		expect(listed.ok).toBe(true);
		if (listed.ok) expect(listed.row?.entity_key).toBe(chestKey);
	}, 60_000);

	it("the PLAYER scene target id of the chest round-trips through describe(key=id)", async () => {
		const s = await track();
		const hero = s.heroOf("hero");
		const publisher = await open(liveWorldRef().token);
		await hero.world.subscribeReaders([{ requiredTables: READER_SCOPED_TABLES }]);
		const heroRef = String(hero.entityId);
		await waitForEvent(
			hero.world,
			() =>
				readCurrentScene(hero.world.db() as unknown as SnapshotDb, heroRef as never)?.node_id ===
				s.reads.nodeId("yard"),
			"hero scene resolves",
		);
		const chestId = s.reads.entityId("chest");
		const target = (
			readCurrentScene(hero.world.db() as unknown as SnapshotDb, heroRef as never)?.targets ?? []
		).find((t) => t.kind === "entity" && String(t.id) === String(chestId));
		expect(target?.id).toBeDefined();
		const reader = ownerReader(publisher);
		await waitForEvent(
			asWorld(publisher),
			() => reader.describe({ kind: "entities", key: String(target?.id) }).ok,
			"owner cache resolves the PLAYER target id",
		);
		// from owner-get-describe.test.ts:188-198
		const described = reader.describe({ kind: "entities", key: key(s, "chest") });
		expect(described.ok).toBe(true);
		if (described.ok) expect(described.numeric_id).toBe(String(target?.id));
		const byId = reader.describe({ kind: "entities", key: String(target?.id) });
		expect(byId.ok).toBe(true);
		if (byId.ok) expect(byId.row.entity_key).toBe(key(s, "chest"));
	}, 60_000);

	it("after a PLAYER pickup, describe of the item names the hero in its container chain at the scene place", async () => {
		const s = await track();
		const hero = s.heroOf("hero");
		const coin = s.reads.entityId("coin");
		if (coin === null) throw new Error("coin not authored");
		const publisher = await open(liveWorldRef().token);
		const reader = ownerReader(publisher);
		const coinKey = key(s, "coin");
		await waitForEvent(
			asWorld(publisher),
			() => {
				const d = reader.describe({ kind: "entities", key: coinKey });
				return d.ok && d.place === s.reads.nodeId("yard");
			},
			"coin starts on the ground of the yard",
		);
		const before = reader.describe({ kind: "entities", key: coinKey });
		expect(before.ok && before.container_chain).toEqual([]);
		await hero.world.conn.reducers.takeItem({
			actingAs: hero.actorId,
			entityId: hero.entityId,
			itemEntityId: coin,
		});
		await waitForEvent(
			asWorld(publisher),
			() => {
				const again = reader.describe({ kind: "entities", key: coinKey });
				return (
					again.ok &&
					again.place === s.reads.nodeId("yard") &&
					again.container_chain.some((step) => step.entity_key === key(s, "hero"))
				);
			},
			"describe follows the pickup: hero in the chain, place still the yard",
		);
		// from owner-get-describe.test.ts:213-235
		const described = reader.describe({ kind: "entities", key: coinKey });
		expect(described.ok).toBe(true);
		if (!described.ok) return;
		expect(described.labels).toContain(AUTHORED_ENTITIES_ONLY);
		expect(described.place).toBe(s.reads.nodeId("yard"));
		expect(described.container_chain.some((step) => step.entity_key === key(s, "hero"))).toBe(true);
	}, 60_000);
});
