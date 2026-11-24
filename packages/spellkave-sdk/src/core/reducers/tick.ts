import type { SpellkaveSession } from "../../connection";

export async function pauseWorldTicks(session: SpellkaveSession): Promise<void> {
	await (
		session.conn.reducers as unknown as {
			pauseTick(args: Record<string, never>): Promise<void>;
		}
	).pauseTick({});
}

// Advances one world clock tick at a logical scene boundary.
// Wraps the `manual_tick` reducer (ManualClockAdvance event kind), requiring
// the publisher credential or a directly bound body with live frontier.pace_time.
// `world_tick` remains scheduler-only.
// Convention (#675 CR-5): call once per logical scene boundary in walkthrough
// scripts so the per-tick consequence cascade (autonomy jobs, claim TTLs,
// affordance re-derivation) fires at each scene transition.
export async function advanceScene(session: SpellkaveSession): Promise<void> {
	await (
		session.conn.reducers as unknown as {
			manualTick(args: Record<string, never>): Promise<void>;
		}
	).manualTick({});
}

export async function advanceScenes(session: SpellkaveSession, ticks: number): Promise<void> {
	if (!Number.isInteger(ticks) || ticks < 0) {
		throw new Error(`advanceScenes requires a non-negative integer, got ${ticks}`);
	}
	await (
		session.conn.reducers as unknown as {
			manualTicks(args: { ticks: number }): Promise<void>;
		}
	).manualTicks({ ticks });
}

export async function advanceTurns(
	session: SpellkaveSession,
	sessionId: bigint,
	count: number,
): Promise<void> {
	if (!Number.isInteger(count) || count < 0) {
		throw new Error(`advanceTurns requires a non-negative integer, got ${count}`);
	}
	await (
		session.conn.reducers as unknown as {
			rAdvanceTurns(args: { sessionId: bigint; count: number }): Promise<void>;
		}
	).rAdvanceTurns({ sessionId, count });
}

export async function setDebugRngSeed(
	session: SpellkaveSession,
	seed: bigint | number | string | null,
): Promise<void> {
	const reducers = session.conn.reducers as unknown as {
		debugSetRngSeed?: (args: { seed?: bigint }) => Promise<void>;
	};
	if (typeof reducers.debugSetRngSeed !== "function") {
		throw new Error(
			"debugSetRngSeed reducer is unavailable; publish the module with --features test-rng-seed",
		);
	}
	await reducers.debugSetRngSeed({ seed: seed === null ? undefined : BigInt(seed) });
}
