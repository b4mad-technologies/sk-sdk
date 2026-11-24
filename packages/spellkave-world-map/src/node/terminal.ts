/**
 * Terminal-only entry: pi-tui image-protocol capability resolution.
 * Split from `./index.ts` because pi-tui is an OPTIONAL peer dependency —
 * server hosts (PLAYER MCP gateway) never install it (#2468).
 */
export {
	ensureSpellkaveTerminalImageCapabilities,
	parseImagesModeFlag,
	resolveTerminalImageCapabilities,
	stdoutIsTerminal,
	type TerminalImagesMode,
} from "./terminal-capabilities.ts";
