import { isatty } from "node:tty";
import {
	detectCapabilities,
	setCapabilities,
	type TerminalCapabilities,
} from "@earendil-works/pi-tui";

export type TerminalImagesMode = "auto" | "kitty" | "iterm2" | "off";

/**
 * Resolve terminal image protocol for sk + Pi hosts.
 *
 * Nested hosts (Herdr panes) often leave TERM=xterm-256color with empty
 * TERM_PROGRAM even when the outer Ghostty window supports Kitty graphics.
 */
export function resolveTerminalImageCapabilities(
	imagesMode: TerminalImagesMode = "auto",
	explicit?: TerminalCapabilities,
): TerminalCapabilities {
	if (explicit !== undefined) return explicit;

	const mode =
		normalizeImagesMode(imagesMode) ??
		normalizeImagesMode(process.env.SPELLKAVE_TERMINAL_IMAGES) ??
		"auto";
	if (mode === "off") {
		return { images: null, trueColor: true, hyperlinks: false };
	}
	if (mode === "kitty" || mode === "iterm2") {
		return { images: mode, trueColor: true, hyperlinks: true };
	}

	const detected = detectCapabilities();
	if (detected.images !== null) return detected;

	if (stdoutIsTerminal() && !isMultiplexerTerm() && !isKnownNonGraphicsTerminal()) {
		return { images: "kitty", trueColor: true, hyperlinks: detected.hyperlinks };
	}
	return detected;
}

/**
 * Install resolved capabilities into pi-tui's process-global cache so Pi's
 * ToolExecution Image renderer (which calls getCapabilities()) enables Kitty.
 * Safe to call at extension load / session_start.
 */
export function ensureSpellkaveTerminalImageCapabilities(
	imagesMode: TerminalImagesMode = "auto",
): TerminalCapabilities {
	const caps = resolveTerminalImageCapabilities(imagesMode);
	setCapabilities(caps);
	return caps;
}

export function stdoutIsTerminal(): boolean {
	try {
		return isatty(1);
	} catch {
		return process.stdout.isTTY === true;
	}
}

export function parseImagesModeFlag(raw: string | undefined): TerminalImagesMode | undefined {
	return normalizeImagesMode(raw);
}

function normalizeImagesMode(raw: string | undefined | null): TerminalImagesMode | undefined {
	if (raw === undefined || raw === null) return undefined;
	const value = raw.trim().toLowerCase();
	if (value === "auto" || value === "kitty" || value === "iterm2" || value === "off") return value;
	return undefined;
}

function isMultiplexerTerm(): boolean {
	const term = process.env.TERM?.toLowerCase() ?? "";
	return Boolean(process.env.TMUX) || term.startsWith("tmux") || term.startsWith("screen");
}

function isKnownNonGraphicsTerminal(): boolean {
	const termProgram = process.env.TERM_PROGRAM?.toLowerCase() ?? "";
	const term = process.env.TERM?.toLowerCase() ?? "";
	const emulator = process.env.TERMINAL_EMULATOR?.toLowerCase() ?? "";
	if (term === "dumb" || term === "") return true;
	if (termProgram === "apple_terminal" || termProgram === "vscode") return true;
	if (termProgram === "alacritty") return true;
	if (emulator === "jetbrains-jediterm") return true;
	if (process.env.WT_SESSION) return true;
	return false;
}
