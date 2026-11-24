// Behaviour suite: Gherkin scenarios in behaviour/*.feature drive the real
// `world-map` CLI in a throwaway directory per scenario and read only what it
// prints, its exit code and the files it writes; no step imports `src/`. The
// tool runs from a bundle behaviour/support/setup.ts builds once; the
// @launcher scenarios start the real bin/world-map and bin/world-osm.
// The scenarios use SDK-owned inputs with no world or network connection.
// Scenarios share nothing, so feature files run in
// parallel. The default `vitest run` does not pick it up; `test:behaviour`
// runs it.
import { behaviourConfig } from "@spellkave/behaviour/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig(
	behaviourConfig({
		steps: ["behaviour/steps.ts"],
		globalSetup: ["behaviour/support/setup.ts"],
		parallel: true,
	}),
);
