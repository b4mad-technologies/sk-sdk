import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { nodeFilesystem, nodeMapPort } from "../index";

describe("Node capability adapters", () => {
	it("owns filesystem and path persistence through the runtime port", () => {
		const dir = mkdtempSync(join(tmpdir(), "spellkave-tool-node-"));
		try {
			const path = nodeFilesystem.join(dir, "nested", "manifest.toml");
			nodeFilesystem.ensureDirectory(nodeFilesystem.dirname(path));
			nodeFilesystem.writeText(path, 'schema_version = "1.0.0"\n');
			expect(nodeFilesystem.exists(path)).toBe(true);
			expect(nodeFilesystem.isFile(path)).toBe(true);
			expect(nodeFilesystem.readText(path)).toContain("schema_version");
			expect(readFileSync(path, "utf8")).toContain("1.0.0");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("exposes raster output as an explicit Node capability", () => {
		expect(typeof nodeMapPort.writeJpeg).toBe("function");
	});
});
