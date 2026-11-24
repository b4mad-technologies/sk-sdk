/**
 * The file markers of live tests, in one place. The two gates in
 * `packages/spellkave-gates` (`live-test-shared-db`, `live-test-pattern-api`)
 * read the same markers; their tests pin that each gate literal equals the one
 * here, so the runtime and the gates cannot drift apart.
 */

/**
 * Lets a file mutate global state (clock, turns, restart, republish):
 * `// live-phase: final`, or `// lifecycle-proof: <reason>` when the DB itself
 * is the unit under test. The runtime final-phase check (`steps.ts`) and the
 * `live-test-shared-db` gate both use it.
 */
export const FINAL_PHASE_MARKER = /^\s*\/\/\s*(live-phase:[ \t]*final\b|lifecycle-proof:[ \t]*\S)/m;

/**
 * `// predecessor-module: <reason>` — the file drives a pinned predecessor
 * module that has no `debug_sync_marker` reducer, so `syncConnection` cannot
 * run there. It exempts the file from the wait rule only (`waitForEvent` is
 * allowed); every other rule still applies. The reason is mandatory.
 */
export const PREDECESSOR_MODULE_MARKER = /^\s*\/\/\s*predecessor-module:(.*)$/m;
