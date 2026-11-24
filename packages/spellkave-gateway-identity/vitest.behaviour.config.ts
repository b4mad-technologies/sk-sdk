// Behaviour suite: behaviour/*.feature drive the real authkit-refresh-token
// binary against a fake HTTPS AuthKit, each scenario in its own temp HOME.
// Needs the openssl CLI and the repository's tsx; no node, no outside network.
// `pnpm guide` turns the last run into docs/guide.md and docs/scenarios.md.
import { behaviourConfig } from "@spellkave/behaviour/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig(
	behaviourConfig({
		steps: ["behaviour/steps.ts"],
		globalSetup: ["behaviour/support/setup.ts"],
		parallel: true,
	}),
);
