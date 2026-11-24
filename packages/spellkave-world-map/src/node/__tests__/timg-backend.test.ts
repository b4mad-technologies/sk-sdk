// A terminal without a graphics protocol still gets a map picture: `sk map`
// draws the rendered PNG with timg's quarter/half Unicode blocks. The two timg
// cases skip on a machine without timg.
// keep-file(K2): needs the timg binary and a forced terminal mode; the CLI draws nothing
import { describe, expect, it } from "vitest";
import { rasterizeSvgToPng } from "../rasterize.ts";
import {
	findTimgBinary,
	preferTimgUnicodeBlocks,
	renderPngWithTimg,
	timgBytesToLines,
} from "../timg-backend.ts";

const tinySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10" fill="#148284"/></svg>`;

describe("timg-backend", () => {
	// keep(K1): rule cases of the pure mode choice; no timg needed
	it("preferTimgUnicodeBlocks honors forced quarter/half", () => {
		expect(preferTimgUnicodeBlocks("quarter", true)).toBe("quarter");
		expect(preferTimgUnicodeBlocks("half", true)).toBe("half");
		expect(preferTimgUnicodeBlocks("kitty", false)).toBeNull();
		expect(preferTimgUnicodeBlocks("auto", true)).toBeNull();
	});

	it("preferTimgUnicodeBlocks auto uses quarter without native graphics when timg exists", () => {
		if (findTimgBinary() === null) return;
		expect(preferTimgUnicodeBlocks("auto", false)).toBe("quarter");
	});

	it("timgBytesToLines strips cursor hide and yields block lines", async () => {
		if (findTimgBinary() === null) return;
		const { png } = await rasterizeSvgToPng(tinySvg);
		const rendered = renderPngWithTimg(png, { pixelation: "quarter", cols: 30, rows: 12 });
		expect(rendered.ok).toBe(true);
		if (!rendered.ok) return;
		const lines = timgBytesToLines(rendered.bytes);
		expect(lines.length).toBeGreaterThan(2);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC-byte match for ANSI/Kitty sequences
		expect(lines.join("\n")).not.toMatch(/\x1b\[\?25/);
		// quarter/half use lower/upper half block U+2584 or similar
		expect(lines.some((line) => /[\u2580-\u259F]/.test(line))).toBe(true);
	});
});
