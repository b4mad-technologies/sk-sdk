/**
 * Scene builder for the failure-recovery claims (neutral `mech_failure_recovery` fixture: a
 * capacity pool that, at 0, puts an actor at risk; turn-gated risk-check rolls that resolve to
 * failed or recovered; an ally's assist that recovers). Shared by the parallel test
 * (`failure-recovery-clock.local-node.test.ts`) and the final-phase session tests
 * (`final/failure-recovery.local-node.test.ts`).
 *
 * The fixture hard-codes four fixed actors. A scene brings its own: a hero (the subject) and the
 * support bodies (`pressure`, `recovery`), which are bound to the SAME identity as the hero, because
 * `r_session_open` needs the caller to control every participant and `r_advance_turn` the outgoing one.
 */
import { type Scene, scene } from "../scene";
import {
	type ActingBody,
	actingBody,
	applyRows,
	authoredIds,
	heroBody,
	identityRow,
	intStateRow,
	nicheRow,
} from "./claims";
import { entityKey, liveWorldRef } from "./support";

export const FR = "mech_failure_recovery";
export const CAPACITY = `${FR}/capacity`;
export const LAST_ROLL = `${FR}/last_roll`;
export const RECOVERY_TALLY = `${FR}/recovery_tally`;
export const FAILURE_TALLY = `${FR}/failure_tally`;
export const RISK_CHECK_CAPABILITY = `${FR}/capability/risk_check`;
export const ASSIST_RECOVERY_CAPABILITY = `${FR}/capability/assist_recovery`;
export const APPLY_PRESSURE_ACTION = `${FR}/apply_pressure`;
export const RISK_CHECK_ACTION = `${FR}/risk_check/roll`;
export const ASSIST_RECOVERY_ACTION = `${FR}/assist_recovery`;
export const AT_RISK = `${FR}/at_risk`;
export const RECOVERED = `${FR}/recovered`;
export const FAILED = `${FR}/failed`;
export const SESSION_DEF = `${FR}/session/rounds`;
export const ASSISTANCE_TAG = "actor.skill_proficiency.assistance";
export const STARTING_CAPACITY = 4;
export const STARTING_FAILURES = 2;
const STRIKEABLE_NICHE = `${FR}/niche/strikeable_target`;
export const DEPS = ["core", FR] as const;

export interface FailureRecoveryOptions {
	/** Starting `failure_tally` / `recovery_tally` of the subject (defaults: 2 / 0, the fixture's preset). */
	failures?: number;
	recoveries?: number;
	/** Add a `recovery` body with the assist capability, the assistance tag and this `wis` score. */
	assistWis?: number;
}

export interface FailureRecoveryScene {
	s: Scene;
	/** The hero the connection controls: the at-risk subject. */
	subject: ActingBody;
	/** A body bound to the hero's identity that applies the pressure. */
	pressure: ActingBody;
	/** A body bound to the hero's identity that assists; only with `assistWis`. */
	recovery: ActingBody | null;
}

/** Build the scene and return the acting bodies. Registered in `scenes` for teardown. */
export async function failureRecoveryScene(
	scenes: Scene[],
	options: FailureRecoveryOptions = {},
): Promise<FailureRecoveryScene> {
	const s = await scene(liveWorldRef(), undefined, { bundleDeps: DEPS });
	scenes.push(s);
	s.place("arena")
		.hero("subject", { at: "arena", capabilities: [RISK_CHECK_CAPABILITY] })
		.npc("pressure", { at: "arena", actor: true });
	if (options.assistWis !== undefined) {
		s.npc("recovery", { at: "arena", actor: true, capabilities: [ASSIST_RECOVERY_CAPABILITY] });
	}
	await s.apply();
	const subjectHero = s.heroOf("subject");
	const p = s.prefix;
	const states = (name: string, capacity: number, failures: number, recoveries: number) => [
		intStateRow(p, name, CAPACITY, capacity),
		intStateRow(p, name, FAILURE_TALLY, failures),
		intStateRow(p, name, RECOVERY_TALLY, recoveries),
		intStateRow(p, name, LAST_ROLL, 0),
	];
	await applyRows(
		s,
		{
			spatial_niche_attachments: [
				nicheRow(s, "arena", STRIKEABLE_NICHE),
				nicheRow(s, "arena", `capability:${RISK_CHECK_CAPABILITY}`),
			],
			actor_identities: [
				identityRow(s, "pressure", subjectHero),
				...(options.assistWis === undefined ? [] : [identityRow(s, "recovery", subjectHero)]),
			],
			object_state: [
				...states(
					"subject",
					STARTING_CAPACITY,
					options.failures ?? STARTING_FAILURES,
					options.recoveries ?? 0,
				),
				...states("pressure", 20, 0, 0),
				...(options.assistWis === undefined
					? []
					: [
							...states("recovery", 10, 0, 0),
							intStateRow(p, "recovery", "wis", options.assistWis),
						]),
			],
			...(options.assistWis === undefined
				? {}
				: {
						// A delta validates on its own: the tagged entity is restated verbatim (same def, same place).
						entities: [
							{
								bundle_id: p,
								entity_key: entityKey(p, "recovery"),
								entity_def_id: "core/creature/wolf",
								name: "recovery",
								kind: "npc",
								place_node_id: s.reads.nodeId("arena"),
							},
						],
						entity_tag: [
							{
								bundle_id: p,
								entity_key: entityKey(p, "recovery"),
								tag: ASSISTANCE_TAG,
								source: "manifest",
							},
						],
					}),
		},
		DEPS,
	);
	const names = options.assistWis === undefined ? ["pressure"] : ["pressure", "recovery"];
	const ids = await authoredIds(s, names);
	const subject = await heroBody(subjectHero);
	const pressure = await actingBody(subjectHero.world, ids[0] as bigint);
	const recovery =
		options.assistWis === undefined ? null : await actingBody(subjectHero.world, ids[1] as bigint);
	return { s, subject, pressure, recovery };
}
