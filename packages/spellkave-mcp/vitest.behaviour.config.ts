// Behaviour suite: Gherkin scenarios in behaviour/*.feature start the real
// PLAYER MCP gateway (bundled once by behaviour/support/setup.ts) against a
// fake issuer on 127.0.0.1, one of each per scenario, and talk to it with
// curl; nothing under `src/` is imported. Scenarios share nothing (own ports,
// own temp dir), so feature files run in parallel. Offline: no world, no
// deployment, no credential, no outside network. The default `vitest run`
// does not pick it up; scripts/ci/run-ci-js.sh runs it as its own step.
//
// `pnpm guide` (`behaviour-docs guide`, from @spellkave/behaviour) turns the
// last run into docs/guide.md and docs/scenarios.md.
import { behaviourConfig } from "@spellkave/behaviour/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig(
	behaviourConfig({
		steps: ["behaviour/steps.ts"],
		globalSetup: ["behaviour/support/setup.ts"],
		parallel: true,
		stepTimeout: 20_000,
	}),
);
