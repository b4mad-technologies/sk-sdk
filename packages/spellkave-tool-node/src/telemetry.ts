import {
	createMemorySink,
	createRunEmitter,
	type RunEmitter,
} from "@spellkave/agent-observability";
import type { ToolTelemetryPort } from "@spellkave/tool-runtime";

export type NodeRunEmitter = RunEmitter;

/** Create a throwaway in-memory observability stream for nested Node tool calls. */
export function createNodeMemoryRunEmitter(
	input: Parameters<typeof createRunEmitter>[0],
): RunEmitter {
	return createRunEmitter(input, [createMemorySink()]);
}

export const nodeTelemetryPort: ToolTelemetryPort = {
	createRunEmitter: (input) =>
		createNodeMemoryRunEmitter(input as unknown as Parameters<typeof createRunEmitter>[0]),
};
