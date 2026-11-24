// D7 tick-interval estimator (design.md:167; spec.md "Floor applies before five deltas").

export class TickIntervalEstimator {
	private readonly _window = 5;
	private readonly _floor = 200;
	// Ring buffer of the last 5 (tick, wallMs) observations.
	private _obs: Array<{ tick: bigint; ms: number }> = [];

	/** Wall-clock ms of the most recent recorded observation, or null if no observations. */
	lastObservedAtMs(): number | null {
		if (this._obs.length === 0) return null;
		// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
		return this._obs[this._obs.length - 1]!.ms;
	}

	record(tick: bigint, observedAtMs: number): void {
		this._obs.push({ tick, ms: observedAtMs });
		if (this._obs.length > this._window + 1) {
			this._obs.shift();
		}
	}

	/** True once five tick-to-tick deltas have been recorded. Until then
	 * {@link estimateMs} returns the 200ms floor, which is *not* a measured
	 * cadence — callers that scale an observation window from it must treat
	 * a cold estimator as unknown rather than as a 200ms world. */
	hasMeasuredCadence(): boolean {
		return this.measuredDeltas() !== null;
	}

	estimateMs(): number {
		const deltas = this.measuredDeltas();
		if (deltas === null) return this._floor;

		const sorted = deltas.slice().sort((a, b) => a - b);
		// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
		const median = sorted[Math.floor(sorted.length / 2)]!;
		// Floor applies only before 5 deltas are observed; once we have enough data,
		// return the measured median directly (spec.md "Floor applies before five deltas").
		return median;
	}

	private measuredDeltas(): number[] | null {
		// Need at least 2 observations to compute 1 delta; 6 to get 5 deltas.
		if (this._obs.length < this._window + 1) return null;

		const deltas: number[] = [];
		for (let i = 1; i < this._obs.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
			const prev = this._obs[i - 1]!;
			// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
			const curr = this._obs[i]!;
			if (curr.tick > prev.tick) {
				const tickSpan = Number(curr.tick - prev.tick);
				deltas.push((curr.ms - prev.ms) / tickSpan);
			}
		}
		if (deltas.length < this._window) return null;
		return deltas;
	}
}
