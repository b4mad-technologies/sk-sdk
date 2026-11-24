// Live-test helpers shared by the session package's legacy companion tests: the persisted local
// dev credential (`liveNodeToken`), the operator-credential `spacetime sql` shell-out and the
// shared-hero self-positioning idioms.
//
// The two-connection caster/observer harness this file used to hold (`connectCasterAndObserver`,
// `releaseActorClaims`, the observed readers and `awaitObserved`) is gone: the kernel-convergence
// twins are now `src/live/*-convergence.live.test.ts` on private scenes, where the observer is a
// scene hero and `probe` syncs its cache (`src/live/kernel-convergence-support.ts`).

import { execFileSync } from "node:child_process";

export { liveNodeToken } from "@spellkave/tool-node";

const DB = process.env.SPELLKAVE_DB ?? "spellkave-dev";

export function spacetimeSql(query: string): string {
	const args = ["sql", "--server", "local", DB, query];
	if (process.env.SPACETIME_CONFIG_PATH) {
		args.unshift("--config-path", process.env.SPACETIME_CONFIG_PATH);
	}
	return execFileSync("spacetime", args, { encoding: "utf8" });
}

/**
 * Force a shared, niche-anchored actor back onto its required home cell
 * before a `range_m=0` cast that depends on it, with a SQL readback to
 * confirm the write landed.
 *
 * ROOT CAUSE (flake diagnosis, #1968): several SRD twins share `srd/regdar`
 * as CASTER — every twin's caster connection authenticates through the same
 * persistent `liveNodeToken()` credential, so many actors end up bound to
 * ONE underlying identity. A neighboring twin deriving "its own body"
 * incorrectly (e.g. off `bindings[0]`, see
 * `phandelver-915-world-event-parent-visibility-twin.test.ts`) can drive a
 * `moveEntity` call against the wrong shared actor and, via an unordered SQL
 * `LIMIT 1` edge pick, land it on an unrelated (possibly fly-gated) node —
 * physically relocating Regdar off the `srd_outdoor/cell_a` home cell every
 * `range_m=0`, self-anchored SRD spell affordance (Find Familiar, Cure
 * Wounds, Acid Arrow, …) requires. Belt-and-suspenders alongside the actor-
 * selection / edge-pick root fix: any twin whose cast is niche-anchored at a
 * fixed node should self-position before relying on it, exactly as a PLAYER
 * would never assume a scene partner left them standing still.
 *
 * Same shared-actor self-positioning idiom as `walkHeroTowardGate` /
 * `placeHeroAt` (post-#1514/#1516) — reset via the admin-only
 * `actor_spatial_location_set` setup reducer (no gameplay authority
 * implied), then read back the raw row to confirm the write landed before
 * the caller proceeds.
 */
export async function forceActorHomeNode(
	session: { conn: { reducers: unknown } },
	actorEntityId: bigint,
	homeNodeId: string,
	bundleId: string,
): Promise<void> {
	const reducers = session.conn.reducers as {
		actorSpatialLocationSet(params: {
			actorId: string;
			placeNodeId: string;
			bundleId: string;
		}): Promise<void>;
	};
	await reducers.actorSpatialLocationSet({
		actorId: String(actorEntityId),
		placeNodeId: homeNodeId,
		bundleId,
	});
	const row = spacetimeSql(
		`SELECT place_node_id FROM entity_location WHERE entity_id = ${actorEntityId}`,
	);
	if (!row.includes(homeNodeId)) {
		throw new Error(`actor ${actorEntityId} did not land on '${homeNodeId}' after reset: ${row}`);
	}
}

// ── Shared-hero self-positioning (post-#1514 un-quarantine) ─────────────────
// The live twin suite shares ONE seeded world; several twins drive the same
// phandelver/hero along the trail, and vitest file order is alphabetical, not
// curated. A twin that needs the hero at the Neverwinter gate WALKS it back
// from wherever the previous file left it. Static toward-gate map over the
// known trail/Phandalin topology; unknown nodes fall through so the caller's
// own precondition assert produces the diagnostic.
export const GATE_NODE_ID = "triboar_trail/neverwinter_gate";
const STEP_TOWARD_GATE: Record<string, string> = {
	"stonehill_inn/common_room": "phandalin/stonehill_inn",
	"phandalin/stonehill_inn": "phandalin/town_green",
	"phandalin/town_green": "triboar_trail/phandalin_outskirts",
	"triboar_trail/phandalin_outskirts": "triboar_trail/ambush_site",
	"triboar_trail/ambush_site": "triboar_trail/triboar_turnoff",
	"triboar_trail/cragmaw_approach": "triboar_trail/old_goblin_camp",
	"triboar_trail/old_goblin_camp": "triboar_trail/triboar_turnoff",
	"triboar_trail/triboar_turnoff": "triboar_trail/high_road_south",
	"triboar_trail/high_road_south": GATE_NODE_ID,
};

export async function walkHeroTowardGate(
	client: {
		adjacentMoves(): Array<{ edge_id: string; to_node: string }>;
		move(edgeId: string): Promise<unknown>;
	},
	currentNodeId: () => string | undefined,
): Promise<void> {
	for (let step = 0; step < 12; step++) {
		const cur = currentNodeId();
		if (!cur || cur === GATE_NODE_ID) return;
		const next = STEP_TOWARD_GATE[cur];
		if (!next) return;
		const edge = client.adjacentMoves().find((m) => m.to_node === next);
		if (!edge) return;
		await client.move(edge.edge_id).catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
}
