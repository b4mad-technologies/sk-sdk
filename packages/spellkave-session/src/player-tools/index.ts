// Node-host compatibility seam. Canonical browser-safe PLAYER/DM execution
// lives in @spellkave/tool-player; this subpath adds explicit Node ports.

// MCP consumes the renderer through the session-owned execution seam, keeping
// its package edge to contracts + session only.
export { renderWorldEventLine } from "@spellkave/tool-runtime";
export * from "./node-adapter.ts";
export * from "./player-host.ts";
export * from "./tools.ts";
export * from "./world-events.ts";
