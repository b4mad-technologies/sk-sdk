/**
 * The one verb-scene driver (sk-jay0.7.174.1, ADR-0144 G-1 / D-9): play a
 * list of AUTHOR-facing verb calls against one in-memory workspace and return
 * the accumulated manifest TOML.
 *
 * It lives here, not in `@spellkave/tool-authoring`, because it binds the
 * Node capability and `tool-node` already depends on `tool-authoring`.
 * Callers: `@spellkave/adventure-runtime` (npc-host, so npc-host never loads
 * the srd-cc ruleset compiler) and `@spellkave/srd-cc`, which applies its own
 * `overlayGeneratedToml` afterwards (`driveSrdScene`).
 */
import { setImmediate as yieldToIo } from "node:timers/promises";
import {
	type AuthorTarget,
	type AuthorToolContext,
	type AuthorWorkspace,
	createAuthorFacingBoundTools,
} from "@spellkave/tool-authoring";
import { nodeToolCapability } from "../capability.ts";

/** A pending call against one of the AUTHOR-facing verb tools. */
export interface VerbCall {
	/** e.g. `spellkave_define_resource` / `spellkave_define_capability` / `spellkave_write_rows`. */
	toolName: string;
	params: Record<string, unknown>;
	/** For error reporting only. */
	label: string;
}

/** Structured authoring rejection for host telemetry. */
export class VerbRunnerError extends Error {
	readonly failureClass = "authoring_rejected";
	readonly errorCode: string | undefined;

	constructor(
		readonly step: string,
		readonly toolName: string,
		diagnostics: unknown,
	) {
		const detail = JSON.stringify(diagnostics, null, 2);
		super(`verb-runner: '${step}' (${toolName}) was rejected:\n${detail}`);
		this.name = "VerbRunnerError";
		const rows = Array.isArray(diagnostics)
			? diagnostics.filter(
					(row): row is Record<string, unknown> => row !== null && typeof row === "object",
				)
			: [];
		const fatalCode = rows.find(
			(row) => row.severity === "fatal" && typeof row.code === "string",
		)?.code;
		const firstCode = rows.find((row) => typeof row.code === "string")?.code;
		this.errorCode =
			typeof fatalCode === "string"
				? fatalCode
				: typeof firstCode === "string"
					? firstCode
					: /\bMF-[A-Z]+-\d+\b/.exec(detail)?.[0];
	}
}

/** Execution failed before a structured authoring verdict was returned. */
export class VerbExecutionError extends Error {
	constructor(
		readonly step: string,
		readonly toolName: string,
		cause: unknown,
	) {
		const detail = cause instanceof Error ? cause.message : String(cause);
		super(`verb-runner: '${step}' (${toolName}) failed: ${detail}`, { cause });
		this.name = "VerbExecutionError";
	}
}

function memoryWorkspace(): AuthorWorkspace {
	let current: string | null = null;
	return {
		readToml: () => current,
		writeToml: (toml: string) => {
			current = toml;
			return "(in-memory)";
		},
	};
}

/**
 * Drive a sequence of verb calls against one shared workspace, returning the
 * accumulated manifest TOML.
 */
export async function driveManifestScene(
	calls: readonly VerbCall[],
	target?: AuthorTarget,
): Promise<string> {
	const workspace = memoryWorkspace();
	const context: AuthorToolContext = target === undefined ? { workspace } : { workspace, target };
	const tools = createAuthorFacingBoundTools(context, { node: nodeToolCapability });
	for (const call of calls) {
		const tool = tools.find((t) => t.name === call.toolName);
		if (tool === undefined) {
			throw new Error(`verb-runner: tool '${call.toolName}' is not registered.`);
		}
		let result: Awaited<ReturnType<typeof tool.execute>>;
		try {
			result = await tool.execute(`srd-cc-scene-${call.label}`, call.params);
		} catch (cause) {
			throw new VerbExecutionError(call.label, call.toolName, cause);
		}
		const details = (result as { details: { ok: boolean; diagnostics?: unknown } }).details;
		if (!details.ok) {
			throw new VerbRunnerError(call.label, call.toolName, details.diagnostics);
		}
		// Synchronous AUTHOR results advance only microtasks. Let live sockets
		// service heartbeats between calls, including during large scene builds.
		await yieldToIo();
	}
	const toml = workspace.readToml();
	if (toml === null) {
		throw new Error("verb-runner: driveManifestScene produced no rows.");
	}
	return toml;
}
