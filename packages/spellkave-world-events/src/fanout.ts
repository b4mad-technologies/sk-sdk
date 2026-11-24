import type { WorldEvent, WorldEventBuilder } from "./world-events.ts";

/**
 * One inner cursor, many consumers.
 *
 * `observe()` is the only call that advances the inner builder. Every event
 * it pulls is copied onto a display tap (`drainObserved`) AND into the claim
 * hold. `takeWhere` claims from the hold; leftover `diffAndAdvance` empties
 * whatever was not claimed.
 *
 * Display vs claim are different deliveries of the same occurrence:
 * - **Display** (`drainObserved`): the Play chronicle. A claimed
 *   `speech_heard` still appears here — otherwise Aldwin's line vanishes
 *   when the reply window takes it and `messageForAct` falls through.
 * - **Claim** (`takeWhere` then leftover): single-delivery between the
 *   reply window and a piggyback leftover drain. Leftover must not run
 *   while a claim is in flight.
 */
export interface WorldEventFanout extends WorldEventBuilder {
	/** Pull newly derived events into the hold and the display tap. */
	observe(): void;
	/**
	 * Every event `observe()` (including `takeWhere`'s own observe) pulled
	 * since the last drain. Includes events `takeWhere` later claimed.
	 */
	drainObserved(): WorldEvent[];
}

export function createWorldEventFanout(inner: WorldEventBuilder): WorldEventFanout {
	let hold: WorldEvent[] = [];
	let observed: WorldEvent[] = [];

	function observe(): void {
		const fresh = inner.diffAndAdvance();
		if (fresh.length === 0) return;
		hold = hold.length === 0 ? fresh : [...hold, ...fresh];
		observed = observed.length === 0 ? fresh : [...observed, ...fresh];
	}

	function drainObserved(): WorldEvent[] {
		const out = observed;
		observed = [];
		return out;
	}

	function takeWhere(predicate: (event: WorldEvent) => boolean): WorldEvent[] {
		observe();
		const matched: WorldEvent[] = [];
		const unmatched: WorldEvent[] = [];
		for (const event of hold) {
			if (predicate(event)) matched.push(event);
			else unmatched.push(event);
		}
		hold = unmatched;
		return matched;
	}

	function diffAndAdvance(): WorldEvent[] {
		observe();
		const leftover = hold;
		hold = [];
		return leftover;
	}

	return { observe, drainObserved, takeWhere, diffAndAdvance };
}
