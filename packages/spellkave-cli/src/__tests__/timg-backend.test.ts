// In terminals without Kitty graphics (SSH, remote panes), `sk` draws maps
// with the external `timg` program as Unicode block characters. These tests
// render a small picture through `timg` in quarter and half blocks. They
// need `timg` on the PATH (`brew install timg`) and pass without checking
// anything when it is missing.
import { rasterizeSvgToPng } from "@spellkave/world-map/node";
import { describe, expect, it } from "vitest";
import { presentSpatialGraphOnTerminal } from "../spatial-graph-terminal.ts";
import { findTimgBinary, renderPngWithTimg } from "../timg-backend.ts";

const tinySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#148284"/><circle cx="40" cy="20" r="12" fill="#fff"/></svg>`;

describe("timg backend", () => {
	const timg = findTimgBinary();

	it("finds timg on this machine or skips", () => {
		// CI without timg should still pass the suite; local dev with brew has it.
		if (timg === null) {
			expect(timg).toBeNull();
			return;
		}
		expect(timg.length).toBeGreaterThan(0);
	});

	it("renders quarter blocks via timg when available", async () => {
		if (timg === null) return;
		const presented = await presentSpatialGraphOnTerminal({
			svg: tinySvg,
			inventory: "inv",
			imagesMode: "quarter",
			maxWidthCells: 40,
		});
		expect(presented.showedImage).toBe(true);
		expect(presented.backend).toBe("timg");
		expect(presented.imageSequence?.length).toBeGreaterThan(100);
		// half-block / quarter output is mostly ESC + printable, not kitty _G
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC-byte match for ANSI/Kitty sequences
		expect(presented.imageSequence).not.toMatch(/\x1b_G/);
	});

	it("renders half blocks via timg when available", async () => {
		if (timg === null) return;
		const { png } = await rasterizeSvgToPng(tinySvg);
		const result = renderPngWithTimg(png, { pixelation: "half", cols: 50, rows: 18 });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.bytes.length).toBeGreaterThan(100);
	});
});
