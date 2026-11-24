// Vitest globalSetup: one run, one result set (run.json names this package
// and the behaviour tooling as watched paths). Then bundles the gateway's two
// entries once into behaviour/.bin/, so a scenario starts the gateway with
// plain node in a few hundred milliseconds instead of a tsx start of one to
// two seconds. The @launcher scenario runs the real bin/spellkave-player-mcp.js.
import { resolve } from "node:path";

import { bundleCli, startRun } from "@spellkave/behaviour/setup";

import docs from "../docs.config.ts";
import { BUNDLE, HEALTH_BUNDLE, PKG, REPO } from "./gateway.ts";

export function setup(): void {
	startRun(resolve(import.meta.dirname, "../.results"), REPO, docs.watched);
	// The npm Wasm packages load their sidecars relative to the package entry.
	const options = {
		external: ["@resvg/resvg-js", "@spellkave/authoring-wasm", "@spellkave/validate-wasm"],
	};
	bundleCli(resolve(PKG, "src/runtime-main.ts"), BUNDLE, options);
	bundleCli(resolve(PKG, "src/health-main.ts"), HEALTH_BUNDLE, options);
}
