// The `sk` host's scratch-bundle persistence — this CLI's implementation of
// `@spellkave/tool-authoring`'s `AuthorWorkspace` port (#1983).
//
// Sibling to `.pi/extensions/spellkave/src/extension/workspace.ts`. Two
// deliberate differences from the Pi one, both flowing from the different
// host:
//
//  1. NOT cwd-repointable. Pi binds one `AuthorToolContext` for a whole
//     session whose cwd moves per tool call; a `sk` process is one
//     invocation against one directory, fixed at construction.
//  2. A NARROWER write guard. Pi's `assertScratchTomlShape` additionally
//     pins `bundle_id = "pi_author_scratch"` + `depends_on = ["core"]`,
//     because a Pi session authors into ONE anonymous scratch bundle. `sk`
//     is pointed at a real bundle by the caller (`--bundle`, `--target
//     world-fixtures/<mod>`), so pinning an id here would make the CLI
//     unable to do its actual job. What survives is the one invariant the
//     wasm validator genuinely does not hold — never poison the `core`
//     profile — which is host policy in EVERY host, Pi included.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { AuthorWorkspace } from "@spellkave/tool-authoring";

/** Default scratch location under the caller's cwd, distinct from Pi's `.local/pi-author-scratch`. */
export const SK_SCRATCH_DIR = join(".local", "sk-author-scratch");

/**
 * The "never poison core" fence (see this module's header). Throws on
 * violation so a write verb reports an honest rejection rather than a
 * poisoned bundle landing on disk.
 */
export function assertNotCoreProfile(toml: string): void {
	if (/^\s*profile\s*=\s*"core"/m.test(toml)) {
		throw new Error('sk: authored TOML must never set profile = "core".');
	}
}

/** Absolute path to the scratch `manifest.toml` under `dir`, whether or not it exists yet. */
export function scratchManifestPath(dir: string): string {
	return join(dir, "manifest.toml");
}

/**
 * Build the `AuthorWorkspace` bound into this invocation's
 * `AuthorToolContext`. `dir` is the scratch bundle's own directory — the
 * accumulating manifest every write verb reads back and rewrites.
 */
export function createFileAuthorWorkspace(dir: string): AuthorWorkspace {
	return {
		readToml(): string | null {
			try {
				return readFileSync(scratchManifestPath(dir), "utf8");
			} catch {
				return null;
			}
		},
		writeToml(toml: string): string {
			assertNotCoreProfile(toml);
			const path = scratchManifestPath(dir);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, toml, "utf8");
			return dir;
		},
	};
}
