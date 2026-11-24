import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	currentWorktreeRoot,
	readLastUsedProfile,
	resolveCliPaths,
	writeLastUsedProfile,
} from "../core/node-io";
import { lastUsedProfileFile } from "../core/paths";

const savedHome = process.env.SPELLKAVE_HOME;

describe("worktree-scoped last-used profile", () => {
	afterEach(() => {
		if (savedHome === undefined) delete process.env.SPELLKAVE_HOME;
		else process.env.SPELLKAVE_HOME = savedHome;
	});

	it("round-trips for the current worktree and ignores the legacy global file", () => {
		const home = mkdtempSync(join(tmpdir(), "sk-last-used-"));
		process.env.SPELLKAVE_HOME = home;
		const paths = resolveCliPaths();
		mkdirSync(paths.state, { recursive: true });
		expect(currentWorktreeRoot()).toBeDefined();
		expect(readLastUsedProfile(paths)).toBeUndefined();

		writeFileSync(lastUsedProfileFile(paths), "legacy\n", "utf8");
		expect(readLastUsedProfile(paths)).toBeUndefined();

		expect(writeLastUsedProfile(paths, "scout")).toBeDefined();
		expect(readLastUsedProfile(paths)).toBe("scout");
	});
});
