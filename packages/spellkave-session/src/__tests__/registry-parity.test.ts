// Mirrors `packages/spellkave-cli/src/__tests__/registry-parity.test.ts`'s
// load-bearing property, for THIS package's consumer of the same registry:
// the daemon dispatches `invoke` frames to whichever tool `createPlayerFacingTools`
// registers, entirely through `SessionDispatcher`'s generic `find-by-name`
// path (`daemon.ts`). If a tool name ever appears as a string literal in this
// package's non-test code, that generic path has been bypassed and the
// parity claim — "adding a tool to the registry makes it callable here with
// zero edits" — no longer holds, no matter what any list says.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import { describe, expect, it } from "vitest";

import { playerFacingToolDefinitions } from "../player-tools/tools.ts";

const SOURCE_FILES = [
	"../binding.ts",
	"../session.ts",
	"../index.ts",
	"../node/paths.ts",
	"../node/protocol.ts",
	"../node/client.ts",
	"../node/daemon.ts",
	"../node/observability.ts",
	"../node/spawn.ts",
	"../node/daemon-entry.ts",
	"../node/index.ts",
	"../node/world-events.ts",
] as const;

/**
 * Source with comment-only lines dropped — the property under test is about
 * CODE. A doc comment explaining an availability rule is free to name a tool.
 */
function readCode(relative: string): string {
	return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
		.split("\n")
		.filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
		.join("\n");
}

describe("registry parity", () => {
	it("has no production companion-agent or Pi-adapter dependency or import", () => {
		const packageJson = readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8");
		expect(packageJson).not.toContain('"@spellkave/companion-agent"');
		expect(packageJson).not.toContain('"@spellkave/tool-agent-adapter"');
		expect(packageJson).not.toContain('"@earendil-works/pi-agent-core"');
		const sourceRoot = resolve(import.meta.dirname, "..");
		const pending = [sourceRoot];
		while (pending.length > 0) {
			const directory = pending.pop();
			if (directory === undefined) continue;
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				const path = resolve(directory, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== "__tests__") pending.push(path);
					continue;
				}
				if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
				expect(readFileSync(path, "utf8"), path).not.toMatch(
					/from\s+["']@spellkave\/companion-agent(?:\/[^"']*)?["']/,
				);
				expect(readFileSync(path, "utf8"), path).not.toMatch(
					/from\s+["']@spellkave\/tool-agent-adapter(?:\/[^"']*)?["']/,
				);
			}
		}
	});

	it("hosts tool-player's canonical PLAYER definitions in roster order", () => {
		expect(playerFacingToolDefinitions.map((tool) => tool.name)).toEqual(PLAYER_TOOL_NAMES);
	});

	it("hard-codes no PLAYER-facing tool name in executable code", () => {
		expect(PLAYER_TOOL_NAMES.length).toBeGreaterThan(0);
		for (const relative of SOURCE_FILES) {
			const code = readCode(relative);
			for (const name of PLAYER_TOOL_NAMES) {
				expect(code, `${relative} hard-codes ${name}`).not.toContain(name);
			}
		}
	});
});
