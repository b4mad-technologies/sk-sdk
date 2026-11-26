import { describe, expect, it } from "vitest";

import { subscribeSetForSurface } from "../connection";
import {
	assertManifestExportAvailable,
	MANIFEST_EXPORT_VIEW,
	ManifestExportUnavailableError,
	readManifestExport,
} from "../core/readers/manifest_export";

describe("manifest export view subscription", () => {
	it("subscribes the view when the module lists it", () => {
		const set = subscribeSetForSurface({
			tables: ["config", "world_time", MANIFEST_EXPORT_VIEW],
		});
		expect(set).toContain(MANIFEST_EXPORT_VIEW);
		expect(set).not.toContain("manifest_export");
	});

	it("does not subscribe the view when the module does not list it", () => {
		const set = subscribeSetForSurface({ tables: ["config", "world_time"] });
		expect(set).not.toContain(MANIFEST_EXPORT_VIEW);
		expect(set).not.toContain("manifest_export");
	});

	it("reports that the export is not available against a module without the view", () => {
		expect(() => assertManifestExportAvailable(["config", "manifest_export"])).toThrow(
			ManifestExportUnavailableError,
		);
		expect(() => assertManifestExportAvailable(["config", "manifest_export"])).toThrow(
			"manifest export is not available",
		);
	});

	it("reads the caller's row from the view", () => {
		const db = {
			visibleManifestExportResult: {
				iter: () => [
					{
						bundleId: "kavemouth",
						requestedAtTick: 4,
						manifestJson: '{"bundles":[]}',
						status: "complete",
						rowCount: 1,
						diagnostics: "ok",
					},
				],
			},
		};
		expect(readManifestExport(db, "kavemouth")).toEqual({
			bundleId: "kavemouth",
			requestedAtTick: 4,
			manifestJson: '{"bundles":[]}',
			status: "complete",
			rowCount: 1,
			diagnostics: "ok",
		});
		expect(readManifestExport(db, "other")).toBeUndefined();
	});
});
