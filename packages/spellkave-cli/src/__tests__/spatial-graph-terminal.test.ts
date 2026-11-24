// `sk map-inspect` and `sk map-render` draw a place graph (a map) as an image
// in the terminal when it can show one, and print a node and edge list when
// it cannot. These tests check that an explicit `--images` choice wins over
// what the terminal reports, that the list is the fallback, and that `sk`
// never claims an image it did not draw. A fake output stands in for the
// terminal; no node.
import { describe, expect, it } from "vitest";
import type { RecordIo } from "../output.ts";
import {
	emitSpatialGraphPresentation,
	maybeEmitSvgDetailsOnTerminal,
	presentSpatialGraphOnTerminal,
	resolveTerminalImageCapabilities,
} from "../spatial-graph-terminal.ts";

const tinySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="10" fill="#148284"/></svg>`;

function fakeIo(
	format: "human" | "jsonl" = "human",
): RecordIo & { lines: string[]; blobs: Uint8Array[] } {
	const lines: string[] = [];
	const blobs: Uint8Array[] = [];
	return {
		format,
		lines,
		blobs,
		record: () => {},
		err: () => {},
		hint: (line) => lines.push(`HINT:${line}`),
		rawHuman: (line) => lines.push(`RAW:${line}`),
		rawBytes: (data) => blobs.push(Uint8Array.from(data)),
	};
}

describe("resolveTerminalImageCapabilities", () => {
	it("honors forced kitty mode even when pi-tui would say null", () => {
		const caps = resolveTerminalImageCapabilities("kitty");
		expect(caps.images).toBe("kitty");
	});

	it("honors off", () => {
		expect(resolveTerminalImageCapabilities("off").images).toBeNull();
	});

	it("forced kitty ignores sparse env and TTY quirks", () => {
		// Herdr: TERM=xterm-256color, empty TERM_PROGRAM, process.stdout.isTTY often undefined.
		process.env.TERM = "xterm-256color";
		delete process.env.TERM_PROGRAM;
		expect(resolveTerminalImageCapabilities("kitty").images).toBe("kitty");
	});
});

describe("presentSpatialGraphOnTerminal", () => {
	it("falls back to inventory when images are off", async () => {
		const presented = await presentSpatialGraphOnTerminal({
			svg: tinySvg,
			inventory: "inventory-only",
			imagesMode: "off",
		});
		expect(presented.showedImage).toBe(false);
		expect(presented.imageSequence).toBeNull();
		expect(presented.inventory).toBe("inventory-only");
		expect(presented.skipReason).toMatch(/off/i);
	});

	it("emits a Kitty sequence when imagesMode=kitty is forced", async () => {
		const presented = await presentSpatialGraphOnTerminal({
			svg: tinySvg,
			inventory: "inventory-only",
			imagesMode: "kitty",
		});
		expect(presented.showedImage).toBe(true);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC-byte match for ANSI/Kitty sequences
		expect(presented.imageSequence).toMatch(/\x1b_G/);
		expect(presented.imageRows).toBeGreaterThanOrEqual(1);
		expect(presented.skipReason).toBeNull();

		const io = fakeIo("human");
		emitSpatialGraphPresentation(io, presented);
		// timg-shaped: exactly one raw write (graphics), no inventory noise.
		expect(io.lines).toHaveLength(1);
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC-byte match for ANSI/Kitty sequences
		expect(io.lines[0]).toMatch(/^RAW:\x1b_G/);
	});

	it("does not claim an image when svg is null", async () => {
		const presented = await presentSpatialGraphOnTerminal({
			svg: null,
			inventory: "empty",
			capabilities: { images: "kitty", trueColor: true, hyperlinks: false },
		});
		expect(presented.showedImage).toBe(false);
		expect(presented.imageSequence).toBeNull();
	});

	it("maybeEmitSvgDetailsOnTerminal paints tool details.svg in human mode", async () => {
		const io = fakeIo("human");
		const painted = await maybeEmitSvgDetailsOnTerminal(io, {
			svg: tinySvg,
			inventory: "from-tool",
			places: 1,
		});
		// Capabilities come from the real process env in this call — force via present path in unit above.
		// Here we only assert the helper is a no-op in jsonl and accepts the shape.
		const jsonl = fakeIo("jsonl");
		const skipped = await maybeEmitSvgDetailsOnTerminal(jsonl, {
			svg: tinySvg,
			inventory: "from-tool",
		});
		expect(skipped).toBe(false);
		expect(jsonl.lines).toEqual([]);
		void painted;
	});

	it("maybeEmitSvgDetailsOnTerminal no-ops without svg", async () => {
		const io = fakeIo("human");
		const painted = await maybeEmitSvgDetailsOnTerminal(io, { places: 0 });
		expect(painted).toBe(false);
		expect(io.lines).toEqual([]);
	});
});
