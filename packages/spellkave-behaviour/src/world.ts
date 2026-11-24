/**
 * A world for one behaviour scenario (D-6 in
 * ledger/designs/behaviour-first-tests.md). Scenarios never start nodes; they
 * get a world source and read the world only through
 * `{url}/v1/database/{db}/sql` with `token`. `url`, `db` and `token` may change
 * after `reset`, so read them after every `await reset(...)`.
 *
 * - "wiped": the module is published, nothing is seeded.
 * - "seeded": the module plus the standard seed manifest.
 */
export type WorldBaseline = "wiped" | "seeded";

export interface WorldSource {
	readonly url: string;
	readonly db: string;
	readonly token: string;
	reset(baseline: WorldBaseline): Promise<void>;
}
