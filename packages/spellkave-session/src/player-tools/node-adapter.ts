import { nodeToolCapability } from "@spellkave/tool-node";
import type { NodeToolCapabilities } from "@spellkave/tool-runtime";

/**
 * Transitional Node/Pi composition boundary for legacy companion factories.
 * Portable definition bodies receive this only through runtime `bindTool`;
 * browser hosts bind tool-runtime directly and intentionally omit it.
 */
export const companionNodeCapabilities: NodeToolCapabilities = { node: nodeToolCapability };
