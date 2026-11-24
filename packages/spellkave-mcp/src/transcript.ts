import { createHash } from "node:crypto";
import { appendFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import type { WorldCatalog } from "@spellkave/gateway-identity";
import { currentRemoteMcpRequestSubject } from "./observability.ts";

/**
 * Public spectator transcript for catalog worlds with `visibility=public`.
 *
 * This is deliberately NOT the redacted ADR-0074 operator observer in
 * `observability.ts`: that surface stays credential- and content-free for
 * every seat. The recorder here writes the full tool call (params, the
 * human-readable text the player saw, and the structured observation) —
 * only when the routed world is public. The WorkOS subject is stored as a
 * stable SHA-256 prefix, never in the clear. Files are world-readable
 * public site renders. Never point it at a directory that holds private
 * state.
 *
 * Line shape is canonical `agent-run-events/v1` (`type: "tool_call"`) with
 * the additive `params` / `observation` fields the srd-cc story harness
 * already uses, plus `text` (the joined text content blocks) so a viewer can
 * render without re-implementing every tool summariser.
 */

export const PUBLIC_TRANSCRIPT_DIR_ENV = "SPELLKAVE_MCP_PUBLIC_TRANSCRIPT_DIR";
export const PUBLIC_TRANSCRIPT_EVENTS_VERSION = "agent-run-events/v1";
export const PUBLIC_TRANSCRIPT_RUN_KIND = "public_transcript";
export const PUBLIC_TRANSCRIPT_FILENAME = "agent-run-events.jsonl";
/** Cap for one text field; a runaway result must not grow the public file unbounded. */
export const PUBLIC_TRANSCRIPT_MAX_TEXT_CHARS = 16_000;

export interface PublicTranscriptToolCall {
	toolName: string;
	params: unknown;
	result: CallToolResult;
	durationMs: number;
	correlationId: string;
}

export interface PublicTranscriptWorld {
	slug: string;
	actorId: string;
}

export interface PublicTranscriptRecorder {
	record(call: PublicTranscriptToolCall): void;
}

export interface CreatePublicTranscriptRecorderOptions {
	directory: string;
	publicSlugs: ReadonlySet<string>;
	/** Resolved after the PLAYER invoke so the world route is already cached. */
	worldForSubject: (subject: string) => PublicTranscriptWorld | undefined;
	now?: () => Date;
	driver?: string;
	/** Test seam; defaults to a synchronous append. */
	append?: (filePath: string, line: string) => void;
}

const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

export const NOOP_PUBLIC_TRANSCRIPT_RECORDER: PublicTranscriptRecorder = {
	record: () => {},
};

export function publicWorldSlugs(catalog: WorldCatalog): Set<string> {
	return new Set(
		catalog.worlds.filter((world) => world.visibility === "public").map((world) => world.slug),
	);
}

/** Stable public handle for a WorkOS subject. Never write the raw subject. */
export function hashTranscriptSubject(subject: string): string {
	return createHash("sha256").update(subject, "utf8").digest("hex").slice(0, 16);
}

function boundedText(text: string): string {
	if (text.length <= PUBLIC_TRANSCRIPT_MAX_TEXT_CHARS) return text;
	return `${text.slice(0, PUBLIC_TRANSCRIPT_MAX_TEXT_CHARS)}\n…[truncated ${text.length - PUBLIC_TRANSCRIPT_MAX_TEXT_CHARS} chars]`;
}

function textOf(result: CallToolResult): string {
	const blocks = Array.isArray(result.content) ? result.content : [];
	const text = blocks
		.map((block) => (block.type === "text" ? block.text : `[${block.type}]`))
		.join("\n");
	return boundedText(text);
}

/** Drop image payloads and other bulky non-JSON-ish content from the observation. */
function observationOf(result: CallToolResult): unknown {
	if (result.structuredContent !== undefined) return result.structuredContent;
	return null;
}

function defaultAppend(filePath: string, line: string): void {
	appendFileSync(filePath, line, { mode: 0o644 });
}

/** Per-world public JSONL sink; `record` is a no-op for private / unknown worlds. */
export function createPublicTranscriptRecorder(
	options: CreatePublicTranscriptRecorderOptions,
): PublicTranscriptRecorder {
	const now = options.now ?? (() => new Date());
	const append = options.append ?? defaultAppend;
	const driver = options.driver ?? "remote-mcp";
	for (const slug of options.publicSlugs) {
		if (!SLUG_PATTERN.test(slug)) {
			throw new Error(`public transcript slug must match ${SLUG_PATTERN}: ${slug}`);
		}
	}
	const prepared = new Set<string>();
	const fileFor = (slug: string): string => {
		const directory = join(options.directory, slug);
		if (!prepared.has(directory)) {
			mkdirSync(directory, { recursive: true, mode: 0o755 });
			chmodSync(directory, 0o755);
			prepared.add(directory);
		}
		return join(directory, PUBLIC_TRANSCRIPT_FILENAME);
	};
	return {
		record(call) {
			const subject = currentRemoteMcpRequestSubject();
			if (subject === undefined) return;
			const world = options.worldForSubject(subject);
			if (world === undefined) return;
			if (!options.publicSlugs.has(world.slug)) return;
			if (!SLUG_PATTERN.test(world.slug)) return;
			const isError = call.result.isError === true;
			const event = {
				v: PUBLIC_TRANSCRIPT_EVENTS_VERSION,
				run_id: `public-${world.slug}`,
				run_kind: PUBLIC_TRANSCRIPT_RUN_KIND,
				actor_id: world.actorId,
				role: "PLAYER",
				controller_kind: "llm_player",
				driver,
				seed: "",
				ts: now().toISOString(),
				type: "tool_call",
				data: {
					tool_name: call.toolName,
					correlation_id: call.correlationId,
					params: call.params ?? {},
					text: textOf(call.result),
					observation: observationOf(call.result),
					is_error: isError,
					duration_ms: call.durationMs,
					player: hashTranscriptSubject(subject),
				},
			};
			const line = `${JSON.stringify(event)}\n`;
			if (line.includes(subject)) return;
			try {
				append(fileFor(world.slug), line);
			} catch {
				// A public spectator feed must never fail the player's tool call.
			}
		},
	};
}
