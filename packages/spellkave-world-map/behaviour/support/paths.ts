// Where the suite finds the tool and the adventure it exports.
import { join, resolve } from "node:path";

export const PKG = resolve(import.meta.dirname, "../..");
export const REPO = resolve(PKG, "../..");
/** The real front doors, started through tsx: `world-map` and its one-release alias. */
export const LAUNCHERS = {
	"world-map": join(PKG, "bin/world-map.js"),
	"world-osm": join(PKG, "bin/world-osm.js"),
} as const;
/** The bundle setup.ts builds once from the front door, started with plain node. */
export const BUNDLE = join(PKG, "behaviour/.bin/world-map.mjs");
/** The committed elven-mini adventure bundle (its manifest plus the files it includes). */
/** Where `tsx` lives, for the launchers' `#!/usr/bin/env tsx` line. */
export const TSX_BIN = join(PKG, "node_modules/.bin");
