// Vitest globalSetup: one run, one result set; scenarios build their own world.
import { resolve } from "node:path";

import { startRun } from "@spellkave/behaviour/setup";

import docs from "../docs.config.ts";

export function setup(): void {
	startRun(
		resolve(import.meta.dirname, "../.results"),
		resolve(import.meta.dirname, "../../../.."),
		docs.watched,
	);
}
