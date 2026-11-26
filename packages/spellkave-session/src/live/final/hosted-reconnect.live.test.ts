// live-phase: final
/**
 * A RECONNECTED hosted PLAYER session receives a committed scheduled arrival. Re-homed from the
 * kavemouth live file `travel-hold-brain` (:412-433, `syncHostedSeat`;
 * ledger/designs/rehome-map-kernel-sdk.md): the hosted-session type lives in this package, which
 * the sdk (that holds the travel-clock test) cannot depend on.
 * Final phase: `timeStep` pauses the node clock every other test sees, advances it and resumes it
 * (the pattern owns the pause/resume pair, so the run leaves the node as found).
 *
 * The claim is the event itself: the reconnected session's OWN cache (an independent cache from
 * the connection that started the journey) holds the arrival once `timeStep` has synced it. Every
 * read is behind a `syncConnection` barrier; there is no wait and no marker reducer of our own.
 */
import { readActorSnapshot } from "@spellkave/sdk";
import type { SnapshotDb } from "@spellkave/sdk/replay";
import {
	newScenePrefix,
	type Scene,
	scene,
	syncConnection,
	type TestWorld,
	timeStep,
} from "@spellkave/test-lab";
import { afterAll, describe, expect, it } from "vitest";
import { type LiveSession, openSession } from "../../session";
import { applySceneExtras, closeExtrasOwner, liveWorldRef, localNode } from "../support";

/** The hosted session's own connection as a sync target. */
const world = (live: LiveSession): TestWorld => ({ conn: live.session.conn }) as TestWorld;

describe.skipIf(!localNode)(
	"reconnected hosted session sees the committed arrival (final phase)",
	() => {
		const scenes: Scene[] = [];
		const lives: LiveSession[] = [];
		afterAll(async () => {
			for (const live of lives) live.close();
			for (const s of scenes) await s.close();
			await closeExtrasOwner();
		});

		it("a session reopened mid-journey observes the scheduled arrival after the DM clock", async () => {
			const p = newScenePrefix();
			// Over-reach: the exit costs 3 cells, the walker's reach is 1 cell, so r_move promotes the
			// step to a travel session (see the sdk travel-clock test for the same shape).
			const bindings = JSON.stringify({
				movement_reach_resource: `${p}/speed`,
				movement_cost_cells: "3",
				long_running_move_session: "core/long_running_move",
			});
			const w = liveWorldRef();
			const s = await scene(w, p);
			scenes.push(s);
			s.place("yard", { exits: ["cellar"], exitBindings: { cellar: bindings } })
				.place("cellar")
				.hero("walker", { at: "yard", capabilities: ["core/walk"] });
			await s.apply();
			await applySceneExtras(
				s,
				`[[spatial_niche_attachments]]
bundle_id = "${p}"
place_node_id = "${s.reads.nodeId("cellar")}"
niche_id = "core/passable_portal"

[[resource_definitions]]
bundle_id = "${p}"
description = "Movement reach of the scene walker."
display_name = "Reach"
initial_value = 1
max_value = 12
min_value = 0
recovery_rule = "persistent"
resource_definition_id = "${p}/speed"
value_kind = "int"
`,
			);
			const walker = s.heroOf("walker");
			const binding = {
				url: w.url,
				db: w.db,
				identity: walker.identity,
				actorId: String(walker.entityId),
			};
			const host = async (): Promise<LiveSession> => {
				const live = await openSession(binding, { token: walker.world.token });
				lives.push(live);
				return live;
			};
			const nodeOf = (live: LiveSession) =>
				readActorSnapshot(
					live.session.conn.db as unknown as SnapshotDb,
					String(walker.entityId) as never,
				)?.current_node_id;
			const destination = s.reads.nodeId("cellar");

			// The first host starts the journey, then goes away (a crashed or restarted host).
			const first = await host();
			await syncConnection(world(first));
			const exit = first.actorClient.adjacentMoves()[0];
			if (!exit) throw new Error("walker has no exit");
			const receipt = await first.actorClient.move(exit.edge_id);
			expect(receipt.status).toBe("travelling");
			if (receipt.status !== "travelling") return;
			first.close();

			// The reconnected host resumes mid-journey: still at the origin, nothing arrived yet.
			const second = await host();
			await syncConnection(world(second));
			expect(nodeOf(second)).toBe(s.reads.nodeId("yard"));

			// The DM clock advances the journey's ticks; `timeStep` syncs the reconnected host after.
			await timeStep({
				scene: s,
				ticks: receipt.arrives_in_ticks + 1,
				observe: [s.owner, world(second)],
			});
			expect(nodeOf(second)).toBe(destination);
		}, 120_000);
	},
);
