// A committed map JPEG is re-rendered only when its logical input changes.
// The same graph and the same authored backdrop must give the same provenance
// hash from any checkout path, or every worktree and runner sees churn.
// Pure function, no ffmpeg. Bead: sk-h5tv.
// keep-file(K3): a cross-host invariant of the hash; the CLI writes no JPEG
import { describe, expect, it } from "vitest";

import { mapLayerFingerprint, provenanceHash } from "../jpeg-write.ts";

const LAYER_ROWS = [
	{
		place_graph_id: "town",
		display_name: "Town backdrop",
		asset_module: "sample-maps",
		asset_path: "maps/Sample Map.jpg",
		image_width_px: 100,
		image_height_px: 100,
		grid_size_px: 50,
		local_width_cells: 4,
		local_height_cells: 4,
		image_origin_x: -1,
		image_origin_y: -1,
		rotation_deg: 0,
		state: "aligned",
	},
] as const;

const SVG_PREFIX = '<svg xmlns="http://www.w3.org/2000/svg"><image href="';
const SVG_SUFFIX = '" x="0" y="0" width="10" height="10" /></svg>';

describe("provenanceHash (sk-h5tv)", () => {
	it("is stable across checkout-path contexts for the same logical backdrop", () => {
		const fingerprint = mapLayerFingerprint(LAYER_ROWS);
		const fromPrimary =
			SVG_PREFIX +
			"file:///tmp/example-checkout/example-content/assets/sample-maps/maps/Sample%20Map.jpg" +
			SVG_SUFFIX;
		const fromSibling =
			SVG_PREFIX +
			"file:///tmp/example-checkout/.local/repo-symlink/example-content/assets/sample-maps/maps/Sample%20Map.jpg" +
			SVG_SUFFIX;

		expect(provenanceHash(fromPrimary, 900, fingerprint)).toBe(
			provenanceHash(fromSibling, 900, fingerprint),
		);
	});
});
