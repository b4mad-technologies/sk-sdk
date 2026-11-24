import { join } from "node:path";

import { type AgentRunSink, createRunEmitter } from "@spellkave/agent-observability";
import {
	AGENT_RUN_EVENTS_FILENAME,
	createJsonlFileSink,
} from "@spellkave/agent-observability/node";

export const PI_AGENT_DRIVER = "pi-dev";
export const PI_AGENT_EXPERIMENT_ID = "pi-agent";

export interface PlayerRunObserverOptions {
	actorId: string;
	url: string;
	db: string;
	cwd: string;
	env?: NodeJS.ProcessEnv;
	now?: () => Date;
	sinks?: readonly AgentRunSink[];
	driver?: string;
	experimentId?: string;
	artifactsRoot?: string;
}

export interface PlayerRunObserver {
	readonly runId: string;
	readonly artifactPath: string;
	observeToolCall<T>(toolName: string, operation: () => Promise<T>): Promise<T>;
	end(terminal?: string): Promise<void>;
}

export function piAgentRunId(now: Date): string {
	return `run-${now.toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
}

export function piAgentArtifactPath(options: {
	cwd: string;
	runId: string;
	env?: NodeJS.ProcessEnv;
	experimentId?: string;
	artifactsRoot?: string;
}): string {
	const root =
		options.artifactsRoot ??
		options.env?.CAMPAIGN_ARTIFACTS_ROOT ??
		join(options.cwd, ".local", "campaign-runs");
	return join(
		root,
		"experiments",
		options.experimentId ?? PI_AGENT_EXPERIMENT_ID,
		"runs",
		options.runId,
		AGENT_RUN_EVENTS_FILENAME,
	);
}

export function createPlayerRunObserver(options: PlayerRunObserverOptions): PlayerRunObserver {
	const now = options.now ?? (() => new Date());
	const startedAt = now();
	const runId = piAgentRunId(startedAt);
	const artifactPath = piAgentArtifactPath({
		cwd: options.cwd,
		runId,
		env: options.env,
		experimentId: options.experimentId,
		artifactsRoot: options.artifactsRoot,
	});
	const sinks = options.sinks ?? [createJsonlFileSink(artifactPath)];
	const emitter = createRunEmitter(
		{
			run_id: runId,
			run_kind: "campaign_playthrough",
			actor_id: options.actorId,
			role: "PLAYER",
			controller_kind: "llm_player",
			driver: options.driver ?? PI_AGENT_DRIVER,
			now,
		},
		sinks,
	);
	let ended = false;

	emitter.emit("run_start", {
		url: options.url,
		db: options.db,
		artifact_path: artifactPath,
	});

	return {
		runId,
		artifactPath,
		async observeToolCall(toolName, operation) {
			const toolStartedAt = now().getTime();
			try {
				const result = await operation();
				emitter.emit("tool_call", {
					tool_name: toolName,
					is_error: false,
					duration_ms: Math.max(0, now().getTime() - toolStartedAt),
				});
				return result;
			} catch (error) {
				emitter.emit("tool_call", {
					tool_name: toolName,
					is_error: true,
					duration_ms: Math.max(0, now().getTime() - toolStartedAt),
					summary: "tool execution failed",
				});
				throw error;
			}
		},
		async end(terminal = "disconnect") {
			if (ended) return;
			ended = true;
			emitter.emit("run_end", {
				terminal,
				duration_ms: Math.max(0, now().getTime() - startedAt.getTime()),
			});
			await emitter.close();
		},
	};
}
