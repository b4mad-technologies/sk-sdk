import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Pixelation modes that always go through the timg binary.
 * Native kitty/iterm2 stay on pi-tui; half/quarter/sixel are remote-friendly.
 */
export type TimgPixelation = "half" | "quarter" | "sixel";

const PIXEL_FLAG: Record<TimgPixelation, string> = {
	half: "h",
	quarter: "q",
	sixel: "s",
};

export function isTimgPixelation(mode: string): mode is TimgPixelation {
	return mode in PIXEL_FLAG;
}

export function findTimgBinary(env: NodeJS.ProcessEnv = process.env): string | null {
	const override = env.SPELLKAVE_TIMG?.trim();
	if (override) return override;
	const which = spawnSync("which", ["timg"], { encoding: "utf8" });
	if (which.status === 0) {
		const path = which.stdout.trim().split("\n")[0]?.trim();
		if (path) {
			const probe = spawnSync(path, ["--version"], { encoding: "utf8" });
			if (probe.status === 0) return path;
		}
	}
	return null;
}

/**
 * Render a PNG buffer through timg into terminal escape/unicode bytes.
 * Uses -g when stdout is not a size-queryable TTY (required by timg).
 */
export function renderPngWithTimg(
	png: Buffer,
	options: {
		pixelation: TimgPixelation;
		/** Terminal cells; used for -g WxH. */
		cols?: number;
		rows?: number;
		timgPath?: string;
	},
): { ok: true; bytes: Buffer } | { ok: false; error: string } {
	const timg = options.timgPath ?? findTimgBinary();
	if (timg === null) {
		return {
			ok: false,
			error: "timg not found on PATH (install: brew install timg; or set SPELLKAVE_TIMG)",
		};
	}
	const cols = Math.max(20, options.cols ?? process.stdout.columns ?? 80);
	// Image aspect ~1200x760 → rows ≈ cols * 0.45 for half/quarter cell pixels
	const rows = Math.max(8, options.rows ?? Math.ceil(cols * 0.45));
	const dir = mkdtempSync(join(tmpdir(), "sk-timg-"));
	const pngPath = join(dir, "map.png");
	try {
		writeFileSync(pngPath, png);
		const args = [
			`-p${PIXEL_FLAG[options.pixelation]}`,
			`-g${cols}x${rows}`,
			"--frames=1",
			pngPath,
		];
		const result = spawnSync(timg, args, {
			encoding: "buffer",
			maxBuffer: 32 * 1024 * 1024,
		});
		if (result.error) {
			return { ok: false, error: `timg spawn failed: ${result.error.message}` };
		}
		if (result.status !== 0) {
			const err = (result.stderr ?? Buffer.alloc(0)).toString("utf8").trim();
			return {
				ok: false,
				error: `timg exited ${result.status}${err ? `: ${err.split("\n")[0]}` : ""}`,
			};
		}
		const out = result.stdout ?? Buffer.alloc(0);
		if (out.length === 0) {
			return { ok: false, error: "timg produced empty output" };
		}
		return { ok: true, bytes: out };
	} finally {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			// ignore cleanup errors
		}
	}
}

/**
 * Convert timg stdout into line-oriented strings safe for pi-tui Components.
 * Strips cursor hide/show; keeps truecolor SGR + half/quarter block glyphs.
 */
export function timgBytesToLines(bytes: Buffer): string[] {
	let text = bytes.toString("utf8");
	// Cursor visibility / alternate-screen noise — not line content.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC-byte match for ANSI stripping
	text = text.replace(/\x1b\[\?25[lh]/g, "");
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC-byte match for ANSI stripping
	text = text.replace(/\x1b\[\?1049[lh]/g, "");
	text = text.replace(/\r/g, "");
	const raw = text.split("\n");
	// Drop trailing empties; keep interior blank rows for aspect.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ESC-byte match for ANSI stripping
	while (raw.length > 0 && raw[raw.length - 1]?.replace(/\x1b\[[0-9;]*m/g, "").trim() === "") {
		raw.pop();
	}
	return raw;
}

/** Prefer unicode blocks when forced, or when native graphics are unavailable. */
export function preferTimgUnicodeBlocks(
	imagesMode: string | undefined,
	hasNativeGraphics: boolean,
	env: NodeJS.ProcessEnv = process.env,
): TimgPixelation | null {
	const mode =
		(imagesMode ?? env.SPELLKAVE_TERMINAL_IMAGES ?? "auto").trim().toLowerCase() || "auto";
	if (mode === "half" || mode === "h") return "half";
	if (mode === "quarter" || mode === "q" || mode === "timg") return "quarter";
	if (mode === "sixel" || mode === "s") return "sixel";
	if (mode === "kitty" || mode === "iterm2" || mode === "off") return null;
	// auto: unicode when no Kitty/iTerm2
	if (mode === "auto" && !hasNativeGraphics && findTimgBinary(env) !== null) {
		return "quarter";
	}
	return null;
}
