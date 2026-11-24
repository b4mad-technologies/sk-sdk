// live-phase: final
/**
 * Session lifecycle through the PLAYER tools, on a private scene: `spellkave_session_open` ->
 * an off-turn attack is rejected as `not_your_turn` (distinct from `action_budget_exhausted`) ->
 * the foe's turn ends -> the attack succeeds on the hero's turn -> `spellkave_session_close`.
 * Ported from the fast-lane T8 twin (ledger/test-triage/spellkave-session.jsonl): the same
 * mechanic, but on this test's own hero and foe instead of the fixed `fastlane/hero` and
 * `fastlane/foe`, so a second run on the same database passes.
 *
 * Final phase: a session turn writes the world-global `turn_state` row. The definitions (strike
 * action, combat session def, turn scheduler) come from the seeded `fastlane` bundle; the scene
 * attaches the strike niche to its own arena. Like the original, hero and foe are bound to the
 * SAME connection identity: `r_session_open` needs the caller to control every participant, and
 * `r_advance_turn` needs it to control the outgoing one (the foe, who holds the first turn).
 */
import { createActorClient, READER_SCOPED_TABLES } from "@spellkave/sdk";
import type { SnapshotDb } from "@spellkave/sdk/replay";
import {
	advanceSessionTurn,
	probe,
	type Scene,
	scene,
	sceneEntityKey,
	syncConnection,
} from "@spellkave/test-lab";
import {
	SPELLKAVE_MANIPULATE_TOOL,
	SPELLKAVE_SELF_SUMMARY_TOOL,
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
): Promise<{ details: T; contentText: string }> {
	const tool = tools.find((t) => t.name === name);
	if (tool === undefined) throw new Error(`tool '${name}' not registered`);
	const result = await tool.execute(`session-lifecycle-${name}`, params as never);
	const first = (result.content ?? [])[0] as { type: string; text: string } | undefined;
	return { details: result.details as T, contentText: first?.text ?? "" };
}

describe.skipIf(!localNode)("session lifecycle through the PLAYER tools (final phase)", () => {
	const scenes: Scene[] = [];
	afterAll(async () => {
		for (const s of scenes) await s.close();
		await closeExtrasOwner();
	});

	it("open -> not_your_turn distinct from action_budget -> attack succeeds on-turn -> close", async () => {
		const s = await scene(liveWorldRef(), undefined, { bundleDeps: DEPS });
		scenes.push(s);
		s.place("arena")
			.hero("hero", { at: "arena", capabilities: [STRIKE_CAPABILITY] })
			.npc("foe", { at: "arena", actor: true });
		await s.apply();
		const hero = s.heroOf("hero");
		await applySceneExtras(
			s,
			`[[spatial_niche_attachments]]
bundle_id = "${s.prefix}"
place_node_id = "${s.reads.nodeId("arena")}"
niche_id = "capability:${STRIKE_CAPABILITY}"
condition_bool = true
ecological_invariant = false
visibility = "Public"

[[actor_identities]]
bundle_id = "${s.prefix}"
entity_key = "${sceneEntityKey(s.prefix, "foe")}"
identity = "${hero.identity}"
role = "primary"
provenance = "person"
`,
			DEPS,
		);
		const foeId = s.reads.entityId("foe");
		if (foeId === null) throw new Error("foe not applied");
		await hero.world.subscribeReaders([{ requiredTables: READER_SCOPED_TABLES }]);
		await syncConnection(hero.world);
		const tools = createSpellkaveTools({
			db: () => hero.world.db() as unknown as SnapshotDb,
			act: {
				actorId: String(hero.entityId),
				actorClient: createActorClient(hero.world.conn, String(hero.entityId), {
					successOnProvenance: true,
				}),
				callRSessionOpen: sessionOpenPort(hero.world),
			},
		});
		const attack = () =>
			callTool<{ receipt: { manipulate: { status: string; failure_detail?: string } } }>(
				tools,
				SPELLKAVE_MANIPULATE_TOOL,
				{ target_id: `entity:${foeId}`, action_id: ATTACK_ACTION },
			);

		// Precondition: the hero stands in this scene's arena.
		const start = await callTool<{ self: { current_node_id?: string } | null }>(
			tools,
			SPELLKAVE_SELF_SUMMARY_TOOL,
			{},
		);
		expect(start.details.self?.current_node_id).toBe(s.reads.nodeId("arena"));

		// Open the combat session (hero, foe). `r_session_open` hands the first turn to
		// participants[1] (the foe) right away.
		const opened = await probe({
			scene: s,
			act: () =>
				callTool<{ session: { status: string; sessionId?: string | number } }>(
					tools,
					SPELLKAVE_SESSION_OPEN_TOOL,
					{
						session_def_id: SESSION_DEF_ID,
						participants_csv: `${hero.entityId},${foeId}`,
					},
				),
		});
		if (!opened.verdict.ok) throw opened.verdict.error;
		const open = opened.verdict.value.details.session;
		expect(open.status, `session open failed: ${show(open)}`).toBe("success");
		const sessionId = BigInt(open.sessionId ?? "0");
		expect(sessionId, "sessionId should be non-zero").toBeGreaterThan(0n);

		// Off-turn: the hero's attack is rejected as not_your_turn, in the LLM-facing content too,
		// and never conflated with action_budget_exhausted.
		const offTurn = await probe({ scene: s, act: attack });
		if (!offTurn.verdict.ok) throw offTurn.verdict.error;
		const rejected = offTurn.verdict.value;
		expect(
			rejected.details.receipt.manipulate.status,
			`expected an off-turn rejection right after session_open, got: ${show(rejected.details.receipt.manipulate)}`,
		).not.toBe("success");
		expect(
			rejected.details.receipt.manipulate.failure_detail ?? "",
			`expected not_your_turn, got: ${show(rejected.details.receipt.manipulate)}`,
		).toContain("not_your_turn");
		expect(rejected.contentText, "not_your_turn not visible in the LLM-facing content").toContain(
			"not_your_turn",
		);
		expect(
			rejected.contentText,
			"not_your_turn content unexpectedly contains action_budget_exhausted",
		).not.toContain("action_budget_exhausted");

		// The hero's connection ends the foe's turn (it controls both); the hero's attack then succeeds.
		await probe({ scene: s, act: () => advanceSessionTurn(hero.world, sessionId) });
		const onTurn = await probe({ scene: s, act: attack });
		if (!onTurn.verdict.ok) throw onTurn.verdict.error;
		expect(
			onTurn.verdict.value.details.receipt.manipulate.status,
			`attack did not succeed on the hero's turn: ${show(onTurn.verdict.value.details.receipt.manipulate)}`,
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
		expect(
			closed.verdict.value.details.session.status,
			`session close failed: ${show(closed.verdict.value.details.session)}`,
		).toBe("success");
	}, 90_000);
});
