import {
	allocateImageId,
	type ImageProtocol,
	renderImage,
	setCapabilities,
	type TerminalCapabilities,
} from "@earendil-works/pi-tui";
import { rasterizeSvgToPng } from "@spellkave/world-map/node";
import {
	parseImagesModeFlag as parseSharedImagesModeFlag,
	resolveTerminalImageCapabilities,
	type TerminalImagesMode as SharedImagesMode,
	stdoutIsTerminal,
} from "@spellkave/world-map/node/terminal";

import type { RecordIo } from "./output.ts";
import {
	findTimgBinary,
	isTimgPixelation,
	renderPngWithTimg,
	type TimgPixelation,
} from "./timg-backend.ts";

/** sk image backends: shared kitty/iterm2/off/auto + timg unicode/sixel modes. */
export type TerminalImagesMode = SharedImagesMode | TimgPixelation | "timg";

export type { TerminalCapabilities, ImageProtocol };
export { resolveTerminalImageCapabilities, stdoutIsTerminal };

export interface TerminalGraphPresentation {
	imageSequence: string | null;
	imageRows: number;
	showedImage: boolean;
	inventory: string;
	svg: string | null;
	capabilities: TerminalCapabilities;
	skipReason: string | null;
	/** Which backend produced the sequence. */
	backend: "kitty" | "iterm2" | "timg" | "none";
}

export function parseImagesModeFlag(raw: string | undefined): TerminalImagesMode | undefined {
	if (raw === undefined) return undefined;
	const value = raw.trim().toLowerCase();
	const shared = parseSharedImagesModeFlag(value);
	if (shared !== undefined) return shared;
	if (value === "timg") return "timg";
	if (isTimgPixelation(value)) return value;
	// short aliases (timg -p letters + protocol shortcuts)
	if (value === "h") return "half";
	if (value === "q") return "quarter";
	if (value === "s") return "sixel";
	if (value === "k") return "kitty";
	if (value === "i") return "iterm2";
	return undefined;
}

/**
 * Present SVG on a terminal.
 *
 * Backends:
 * - kitty/iterm2 — pi-tui graphics protocols (local Ghostty/Kitty best)
 * - half/quarter/sixel/timg — shell out to `timg` (remote-friendly unicode blocks)
 * - auto — prefer kitty when capable, else quarter via timg if installed
 */
export async function presentSpatialGraphOnTerminal(input: {
	svg: string | null;
	inventory: string;
	maxWidthCells?: number;
	maxHeightCells?: number;
	capabilities?: TerminalCapabilities;
	imagesMode?: TerminalImagesMode;
}): Promise<TerminalGraphPresentation> {
	const mode = resolvePresentationMode(input.imagesMode);

	if (input.svg === null) {
		return emptyPresentation(input.inventory, null, null);
	}

	if (mode === "off") {
		return {
			...emptyPresentation(input.inventory, input.svg, null),
			skipReason: "images mode is off",
		};
	}

	const { png } = await rasterizeSvgToPng(input.svg);
	const maxWidth = Math.max(20, input.maxWidthCells ?? 100);

	// --- timg backends (unicode / sixel / optional kitty via timg) ---
	if (isTimgBackend(mode)) {
		const pixelation: TimgPixelation = mode === "timg" ? "quarter" : mode;
		const rendered = renderPngWithTimg(png, {
			pixelation,
			cols: maxWidth,
			rows: input.maxHeightCells ?? Math.ceil(maxWidth * 0.45),
		});
		if (!rendered.ok) {
			return {
				...emptyPresentation(input.inventory, input.svg, null),
				skipReason: rendered.error,
				backend: "none",
			};
		}
		return {
			imageSequence: rendered.bytes.toString("binary"),
			// approximate; timg already embeds cursor motion
			imageRows: 1,
			showedImage: true,
			inventory: input.inventory,
			svg: input.svg,
			capabilities: { images: null, trueColor: true, hyperlinks: false },
			skipReason: null,
			backend: "timg",
		};
	}

	// --- native pi-tui kitty/iterm2 ---
	const capabilities = resolveTerminalImageCapabilities(
		mode === "auto" ? "auto" : mode,
		input.capabilities,
	);
	if (capabilities.images === null) {
		// auto fallback to timg quarter when native graphics unavailable
		// (only when caller did not force capabilities.images=null explicitly).
		if (mode === "auto" && input.capabilities === undefined && findTimgBinary() !== null) {
			return presentSpatialGraphOnTerminal({
				...input,
				imagesMode: "quarter",
			});
		}
		return {
			...emptyPresentation(input.inventory, input.svg, capabilities),
			skipReason: graphicsSkipReason(),
			backend: "none",
		};
	}

	setCapabilities(capabilities);
	const base64 = png.toString("base64");
	const defaultMaxHeight = Math.max(8, Math.ceil(maxWidth * 0.55));
	const isKitty = capabilities.images === "kitty";
	const rendered = renderImage(
		base64,
		{ widthPx: 1200, heightPx: 760 },
		{
			maxWidthCells: maxWidth,
			maxHeightCells: input.maxHeightCells ?? defaultMaxHeight,
			moveCursor: isKitty,
			imageId: isKitty ? allocateImageId() : undefined,
			preserveAspectRatio: true,
		},
	);
	if (rendered === null) {
		if (mode === "auto" && findTimgBinary() !== null) {
			return presentSpatialGraphOnTerminal({ ...input, imagesMode: "quarter" });
		}
		return {
			...emptyPresentation(input.inventory, input.svg, capabilities),
			skipReason: "Terminal image encode returned null despite graphics capability.",
			backend: "none",
		};
	}
	return {
		imageSequence: rendered.sequence,
		imageRows: Math.max(1, rendered.rows),
		showedImage: true,
		inventory: input.inventory,
		svg: input.svg,
		capabilities,
		skipReason: null,
		backend: isKitty ? "kitty" : "iterm2",
	};
}

export function emitSpatialGraphPresentation(
	io: RecordIo,
	presented: TerminalGraphPresentation,
): void {
	if (io.format !== "human") return;
	if (presented.showedImage && presented.imageSequence !== null) {
		// timg unicode/sixel is raw bytes; Kitty sequences are ASCII-safe strings.
		if (presented.backend === "timg") {
			io.rawBytes(Buffer.from(presented.imageSequence, "binary"));
		} else {
			io.rawHuman(presented.imageSequence);
		}
		return;
	}
	io.hint(presented.inventory);
	if (presented.skipReason !== null) {
		io.hint(`(Inline map image skipped: ${presented.skipReason})`);
		io.hint(
			"Hint: remote-friendly unicode blocks: `sk map-render --images quarter --graph region` " +
				"(needs `timg`: brew install timg). Or force Kitty: `--images kitty`.",
		);
	}
}

export async function maybeEmitSvgDetailsOnTerminal(
	io: RecordIo,
	details: unknown,
	options: { maxWidthCells?: number; imagesMode?: TerminalImagesMode } = {},
): Promise<boolean> {
	if (io.format !== "human") return false;
	if (typeof details !== "object" || details === null || Array.isArray(details)) return false;
	const record = details as Record<string, unknown>;
	const svg = typeof record.svg === "string" ? record.svg : null;
	if (svg === null || svg.length === 0) return false;
	const inventory =
		typeof record.inventory === "string"
			? record.inventory
			: "Spatial graph SVG (see tool details).";
	const presented = await presentSpatialGraphOnTerminal({
		svg,
		inventory,
		maxWidthCells: options.maxWidthCells ?? Math.max(40, process.stdout.columns ?? 100),
		imagesMode: options.imagesMode,
	});
	emitSpatialGraphPresentation(io, presented);
	return presented.showedImage;
}

function resolvePresentationMode(mode: TerminalImagesMode | undefined): TerminalImagesMode {
	if (mode !== undefined) return mode;
	const env = process.env.SPELLKAVE_TERMINAL_IMAGES?.trim().toLowerCase();
	if (env) {
		const parsed = parseImagesModeFlag(env);
		if (parsed !== undefined) return parsed;
	}
	return "auto";
}

function isTimgBackend(mode: TerminalImagesMode): mode is TimgPixelation | "timg" {
	return mode === "timg" || isTimgPixelation(mode);
}

function emptyPresentation(
	inventory: string,
	svg: string | null,
	capabilities: TerminalCapabilities | null,
): TerminalGraphPresentation {
	return {
		imageSequence: null,
		imageRows: 0,
		showedImage: false,
		inventory,
		svg,
		capabilities: capabilities ?? { images: null, trueColor: true, hyperlinks: false },
		skipReason: null,
		backend: "none",
	};
}

function graphicsSkipReason(): string {
	const term = process.env.TERM?.toLowerCase() ?? "";
	const inTmux = Boolean(process.env.TMUX) || term.startsWith("tmux") || term.startsWith("screen");
	if (inTmux) {
		return "tmux/screen is active — try --images quarter (timg unicode blocks work over remote)";
	}
	if (!stdoutIsTerminal()) {
		return "stdout is not a TTY; try --images quarter or --images kitty";
	}
	return (
		"no native Kitty/iTerm2 capability; try --images quarter (timg) or --images kitty " +
		`(TERM_PROGRAM=${JSON.stringify(process.env.TERM_PROGRAM ?? "")}, TERM=${JSON.stringify(process.env.TERM ?? "")})`
	);
}
