// Vitest globalSetup: bundles bin/world-map.js once into
// behaviour/.bin/world-map.mjs, which the scenarios run with plain node
// instead of starting tsx each time. The built-in behaviour setup has already
// cleared the results. Each scenario makes its own directory (steps.ts), so
// there is nothing else to prepare.
import { bundleCli } from "@spellkave/behaviour/setup";

import { BUNDLE, LAUNCHERS } from "./paths.ts";

export function setup(): void {
	bundleCli(LAUNCHERS["world-map"], BUNDLE);
}
