// Map backdrop images live outside the repository. The resolver finds them
// only through roots the operator names; no asset module or folder name is
// built in.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveMapAssetsRoot, resolveMapLayerAssetPath } from "../backdrop-resolve.ts";

describe("resolveMapLayerAssetPath", () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "map-assets-"));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function writeAsset(...segments: string[]): string {
		const file = join(root, ...segments);
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, "x");
		return file;
	}

	it("reads the assets root from SPELLKAVE_MAP_ASSETS_ROOT only", () => {
		expect(resolveMapAssetsRoot({})).toBeNull();
		expect(resolveMapAssetsRoot({ SPELLKAVE_MAP_ASSETS_ROOT: " /srv/maps " })).toBe("/srv/maps");
	});

	it("resolves <root>/<asset_module>/<asset_path>", () => {
		const file = writeAsset("sample-maps", "maps", "hamlet.jpg");
		expect(
			resolveMapLayerAssetPath(
				{ asset_module: "sample-maps", asset_path: "maps/hamlet.jpg" },
				{ SPELLKAVE_MAP_ASSETS_ROOT: root },
			),
		).toBe(file);
	});

	it("accepts an asset_path without the maps/ prefix", () => {
		const file = writeAsset("sample-maps", "maps", "hamlet.jpg");
		expect(
			resolveMapLayerAssetPath(
				{ asset_module: "sample-maps", asset_path: "hamlet.jpg" },
				{ SPELLKAVE_MAP_ASSETS_ROOT: root },
			),
		).toBe(file);
	});

	it("falls back to the root itself when the module folder has no such file", () => {
		const file = writeAsset("maps", "hamlet.jpg");
		expect(
			resolveMapLayerAssetPath(
				{ asset_module: "sample-maps", asset_path: "maps/hamlet.jpg" },
				{ SPELLKAVE_MAP_ASSETS_ROOT: root },
			),
		).toBe(file);
	});

	it("does not look in another module's folder", () => {
		writeAsset("other-maps", "maps", "hamlet.jpg");
		expect(
			resolveMapLayerAssetPath(
				{ asset_module: "sample-maps", asset_path: "maps/hamlet.jpg" },
				{ SPELLKAVE_MAP_ASSETS_ROOT: root, FVTT_DATA_ROOT: join(root, "none") },
			),
		).toBeNull();
	});
});
