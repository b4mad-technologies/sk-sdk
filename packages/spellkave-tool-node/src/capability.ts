import type { NodeToolCapability } from "@spellkave/tool-runtime";
import { nodeFilesystem } from "./filesystem";
import { nodeMapPort } from "./raster";
import { nodeTelemetryPort } from "./telemetry";

/** The single explicit Node opt-in consumed by host composition. */
export const nodeToolCapability: NodeToolCapability = {
	filesystem: nodeFilesystem,
	map: nodeMapPort,
	telemetry: nodeTelemetryPort,
};
