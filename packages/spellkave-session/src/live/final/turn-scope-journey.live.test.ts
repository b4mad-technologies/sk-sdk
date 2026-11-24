// live-phase: final
/**
 * A fight keeps its turn scope while a journey beside it runs and ends (bead sk-jay0.1.55.60.21,
 * ADR-0037 Postscript 2026-11-10, world-action-economy "A clock-only heartbeat does not take the
 * turn scope of a live session").
 *
 * `turn_state` is one row per world. The world-tick heartbeat of a promoted clock-only session
 * used to record that session as the turn scope on every tick and to reset the scope to 0 when
 * it closed. A fight running beside it then lost its row in `visible_turn_state`, and no
 * participant was delivered its turn again.
 *
 * The scene is two rooms that never meet: an arena with a fight (hero, foe; the fastlane combat
 * session of the session-lifecycle test) and a yard whose exit a walker over-reaches, so its
 * move is promoted to a journey (the shape of the hosted-reconnect test). The walker is no
 * participant of the fight.
 * Final phase: a session turn writes the world-global `turn_state` row, and `timeStep` pauses
 * and advances the node clock every other test sees.
 */
import { createActorClient, READER_SCOPED_TABLES, readActorSnapshot } from "@spellkave/sdk";
import { readTurnState } from "@spellkave/sdk/readers";
import type { SnapshotDb } from "@spellkave/sdk/replay";
import {
	advanceSessionTurn,
	newScenePrefix,
	probe,
	type Scene,
	scene,
	sceneEntityKey,
	syncConnection,
	timeStep,
} from "@spellkave/test-lab";
import {
	SPELLKAVE_MANIPULATE_TOOL,
	SPELLKAVE_SESSION_CLOSE_TOOL,
	SPELLKAVE_SESSION_OPEN_TOOL,
} from "@spellkave/tool-contracts/schemas";
import { afterAll, describe, expect, it } from "vitest";
import { createSpellkaveTools, type SpellkaveCompanionTool } from "../../player-tools/tools";
import {
	applySceneExtras,
	closeExtrasOwner,
	liveWorldRef,
	localNode,
	sessionOpenPort,
} from "../support";

const DEPS = ["core", "fastlane"] as const;
const STRIKE_CAPABILITY = "fastlane/combat/strike";
const ATTACK_ACTION = "fastlane/attack_strike";
const SESSION_DEF_ID = "fastlane/session/combat";

function show(value: unknown): string {
	return JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}

async function callTool<T>(
	tools: SpellkaveCompanionTool[],
	name: string,
	params: Record<string, unknown>,
): Promise<T> {
	const tool = tools.find((t) => t.name === name);
	if (tool === undefined) throw new Error(`tool '${name}' not registered`);
	const result = await tool.execute(`turn-scope-journey-${name}`, params as never);
	return result.details as T;
}

describe.skipIf(!localNode)("a fight keeps its turn scope beside a journey (final phase)", () => {
	const scenes: Scene[] = [];
	afterAll(async () => {
		for (const s of scenes) await s.close();
		await closeExtrasOwner();
	});

	it("journey heartbeat and journey end leave the fight's turn row and end-turn intact", async () => {
		const p = newScenePrefix();
		const bindings = JSON.stringify({
			movement_reach_resource: `${p}/speed`,
			movement_cost_cells: "3",
			long_running_move_session: "core/long_running_move",
		});
		const s = await scene(liveWorldRef(), p, { bundleDeps: DEPS });
		scenes.push(s);
		s.place("arena")
			.place("yard", { exits: ["cellar"], exitBindings: { cellar: bindings } })
			.place("cellar")
			.hero("hero", { at: "arena", capabilities: [STRIKE_CAPABILITY] })
			.npc("foe", { at: "arena", actor: true })
			.hero("walker", { at: "yard", capabilities: ["core/walk"] });
		await s.apply();
		const hero = s.heroOf("hero");
		const walker = s.heroOf("walker");
		await applySceneExtras(
			s,
			`[[spatial_niche_attachments]]
bundle_id = "${p}"
place_node_id = "${s.reads.nodeId("arena")}"
niche_id = "capability:${STRIKE_CAPABILITY}"
condition_bool = true
ecological_invariant = false
visibility = "Public"

[[spatial_niche_attachments]]
bundle_id = "${p}"
place_node_id = "${s.reads.nodeId("cellar")}"
niche_id = "core/passable_portal"

[[actor_identities]]
bundle_id = "${p}"
entity_key = "${sceneEntityKey(p, "foe")}"
identity = "${hero.identity}"
role = "primary"
provenance = "person"

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
			DEPS,
		);
		const foeId = s.reads.entityId("foe");
		if (foeId === null) throw new Error("foe not applied");
		await hero.world.subscribeReaders([{ requiredTables: READER_SCOPED_TABLES }]);
		await walker.world.subscribeReaders([{ requiredTables: READER_SCOPED_TABLES }]);
		await syncConnection(hero.world);
		await syncConnection(walker.world);
		const heroDb = () => hero.world.db() as unknown as SnapshotDb;
		const tools = createSpellkaveTools({
			db: heroDb,
			act: {
				actorId: String(hero.entityId),
				actorClient: createActorClient(hero.world.conn, String(hero.entityId), {
					successOnProvenance: true,
				}),
				callRSessionOpen: sessionOpenPort(hero.world),
			},
		});

		// The fight opens; `r_session_open` hands the first turn to the foe.
		const opened = await probe({
			scene: s,
			act: () =>
				callTool<{ session: { status: string; sessionId?: string | number } }>(
					tools,
					SPELLKAVE_SESSION_OPEN_TOOL,
					{ session_def_id: SESSION_DEF_ID, participants_csv: `${hero.entityId},${foeId}` },
				),
		});
		if (!opened.verdict.ok) throw opened.verdict.error;
		const open = opened.verdict.value.session;
		expect(open.status, `session open failed: ${show(open)}`).toBe("success");
		const sessionId = BigInt(open.sessionId ?? "0");
		expect(sessionId).toBeGreaterThan(0n);
		const fightRow = { scope_session_id: String(sessionId), current_actor: String(foeId) };
		await syncConnection(hero.world);
		expect(readTurnState(heroDb()), "the fight owns the turn scope").toMatchObject(fightRow);
		const turnBefore = readTurnState(heroDb())?.turn;

		// A body that is no participant starts a journey beside the fight.
		const walkerClient = createActorClient(walker.world.conn, String(walker.entityId), {
			successOnProvenance: true,
		});
		const exit = walkerClient.adjacentMoves()[0];
		if (!exit) throw new Error("walker has no exit");
		const receipt = await walkerClient.move(exit.edge_id);
		expect(receipt.status).toBe("travelling");
		if (receipt.status !== "travelling") return;

		// While the journey runs, every world tick is one heartbeat of it.
		await timeStep({ scene: s, ticks: 1, observe: [s.owner, hero.world, walker.world] });
		expect(
			readTurnState(heroDb()),
			"a journey heartbeat must not take the fight's turn scope",
		).toMatchObject({ ...fightRow, turn: turnBefore });

		// The journey ends. Its close must not reset a scope it does not own.
		await timeStep({
			scene: s,
			ticks: receipt.arrives_in_ticks + 1,
			observe: [s.owner, hero.world, walker.world],
		});
		// The journey really is over: the walker stands at its destination.
		expect(
			readActorSnapshot(
				walker.world.db() as unknown as SnapshotDb,
				String(walker.entityId) as never,
			)?.current_node_id,
			"the walker must have arrived, or the close was never exercised",
		).toBe(s.reads.nodeId("cellar"));
		expect(
			readTurnState(heroDb()),
			"the fight must keep its turn row after the journey closed",
		).toMatchObject({ ...fightRow, turn: turnBefore });

		// The fight goes on: the foe's turn ends, the hero's attack succeeds on its turn.
		const advanced = await probe({
			scene: s,
			act: () => advanceSessionTurn(hero.world, sessionId),
		});
		if (!advanced.verdict.ok) throw advanced.verdict.error;
		await syncConnection(hero.world);
		expect(readTurnState(heroDb())).toMatchObject({
			scope_session_id: String(sessionId),
			current_actor: String(hero.entityId),
		});
		const attack = await probe({
			scene: s,
			act: () =>
				callTool<{ receipt: { manipulate: { status: string } } }>(
					tools,
					SPELLKAVE_MANIPULATE_TOOL,
					{ target_id: `entity:${foeId}`, action_id: ATTACK_ACTION },
				),
		});
		if (!attack.verdict.ok) throw attack.verdict.error;
		expect(
			attack.verdict.value.receipt.manipulate.status,
			`attack did not succeed on the hero's turn: ${show(attack.verdict.value.receipt.manipulate)}`,
		).toBe("success");

		const closed = await probe({
			scene: s,
			act: () =>
				callTool<{ session: { status: string } }>(tools, SPELLKAVE_SESSION_CLOSE_TOOL, {
					session_id: Number(sessionId),
					outcome: "abandoned",
				}),
		});
		if (!closed.verdict.ok) throw closed.verdict.error;
		expect(closed.verdict.value.session.status).toBe("success");
	}, 120_000);
});
