// The root path an applyset apply records (ADR-0145): the root file relative
// to the git worktree that holds it, which is what `sk dev seed` passes from
// the repo root. `sk apply` must send the same path, or the server refuses
// the apply as another root taking over the name (MF-APPLY-031).

import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, relative } from "node:path";

/** Relative to the git worktree root; the absolute path outside a worktree. */
export function applysetRootPath(absoluteRootFile: string): string {
	try {
		const top = execFileSync(
			"git",
			["-C", dirname(absoluteRootFile), "rev-parse", "--show-toplevel"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
		const rel = relative(top, absoluteRootFile);
		if (rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
	} catch {
		// Not in a git worktree: fall through.
	}
	return absoluteRootFile;
}
