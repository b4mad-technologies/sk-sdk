// The gateway's production code keeps using the canonical tool contracts and the
// session-owned relay, and never reaches back into retired runtimes. If it breaks, a
// forbidden import has slipped in. Reads source files, no setup.

// keep-file(K4): import-graph drift gate

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production runtime imports", () => {
	it("uses canonical contracts and the session-owned relay seam", () => {
		const descriptorSource = readFileSync(resolve(import.meta.dirname, "../tools.ts"), "utf8");
		const relaySource = readFileSync(resolve(import.meta.dirname, "../daemon-handler.ts"), "utf8");
		expect(descriptorSource).toContain('from "@spellkave/tool-contracts"');
		expect(relaySource).toContain('from "@spellkave/session/player-tools"');
		expect(relaySource).not.toContain("@spellkave/tool-runtime");
		expect(`${descriptorSource}\n${relaySource}`).not.toContain("@spellkave/companion-agent");
		const sessionDaemon = resolve(
			import.meta.dirname,
			"../../../spellkave-session/src/node/daemon.ts",
		);
		const sessionObservability = resolve(
			import.meta.dirname,
			"../../../spellkave-session/src/node/observability.ts",
		);
		const sessionPackage = resolve(import.meta.dirname, "../../../spellkave-session/package.json");
		// Session is the serialized execution owner; MCP only attaches and relays.
		expect(readFileSync(sessionDaemon, "utf8")).toContain("createPlayerFacingTools");
		expect(readFileSync(sessionDaemon, "utf8")).not.toContain("@spellkave/companion-agent");
		expect(readFileSync(sessionObservability, "utf8")).toContain("PLAYER_TOOL_NAMES");
		// MCP -> session must not gain a transitive Pi adapter/runtime edge.
		expect(readFileSync(sessionPackage, "utf8")).not.toContain("@spellkave/tool-agent-adapter");
		expect(readFileSync(sessionPackage, "utf8")).not.toContain("@earendil-works/pi-agent-core");
	});

	it("never imports the companion-agent root barrel from any production source", () => {
		// The barrel re-exports spatial-graph, which imports @earendil-works/pi-tui —
		// a dev-only dependency absent from the pruned gateway image. A root-barrel
		// import took the public gateway down on 2026-08-20; import subpaths only.
		const srcDir = resolve(import.meta.dirname, "..");
		for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
			const contents = readFileSync(resolve(srcDir, entry.name), "utf8");
			expect(contents, entry.name).not.toContain("@spellkave/companion-agent");
		}
	});

	it("does not construct a PLAYER runtime or session", () => {
		const srcDir = resolve(import.meta.dirname, "..");
		for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
			const contents = readFileSync(resolve(srcDir, entry.name), "utf8");
			expect(contents, entry.name).not.toContain("createPlayerFacingTools");
			expect(contents, entry.name).not.toContain("createToolRuntime");
			expect(contents, entry.name).not.toContain("openSession");
		}
	});
});
