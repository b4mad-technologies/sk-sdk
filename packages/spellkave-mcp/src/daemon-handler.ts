import type { CallToolResult } from "@modelcontextprotocol/server";
import type { WorldActorCausalContext } from "@spellkave/agent-observability";
import type { Response, SessionDaemonStatus, SessionNotice } from "@spellkave/session/node";
import { renderWorldEventLine, type WorldEvent } from "@spellkave/session/player-tools";
import { TOOL_CONTRACTS } from "@spellkave/tool-contracts";
import { type FeedbackToolOptions, handleSpellkaveFeedback } from "./feedback.ts";
import { SPELLKAVE_FEEDBACK_TOOL } from "./feedback-constants.ts";
import {
	currentRemoteMcpCorrelationId,
	OFF_REMOTE_MCP_RUN_OBSERVER,
	type RemoteMcpLifecycleEmit,
	type RemoteMcpRunObserver,
} from "./observability.ts";
import {
	awaitingResponseCommunicationReceipt,
	COMMUNICATE_TOOL,
	SESSION_INVOKE_TIMEOUT_HINT,
	WORLD_RESET_OR_RESTARTING_HINT,
} from "./runtime.ts";
import { classifySessionError, isInvokeTimeout, unknownErrorClass } from "./session-errors.ts";
import type { PlayerMcpToolHandler } from "./tools.ts";
import { NOOP_PUBLIC_TRANSCRIPT_RECORDER, type PublicTranscriptRecorder } from "./transcript.ts";

/** Hosted MCP gateway tool name that may carry a maps.spellkave.com deep link. */
export const SPELLKAVE_MAP_TOOL = "spellkave_map";

export interface MapDeepLinkOptions {
	/** Base URL for apps/maps (e.g. https://maps.spellkave.com). Trailing slash stripped. */
	readonly mapsBaseUrl?: string;
	/** Seat world slug for the current MCP subject; omit / empty ⇒ no link line. */
	readonly resolveWorldSlug?: () => string | undefined | Promise<string | undefined>;
}

/** Strip trailing slashes; empty / whitespace → undefined (local dev: no link). */
export function normalizeMapsBaseUrl(raw: string | undefined | null): string | undefined {
	const value = raw?.trim() ?? "";
	if (value === "") return undefined;
	return value.replace(/\/+$/, "");
}

/**
 * Append one text block linking to the interactive browser map for this world.
 * Host-agnostic MCP contract stays text + image — the browser app is optional.
 * Only `spellkave_map`, only when base URL + slug are both known, only on success.
 */
export function withMapDeepLink(
	result: CallToolResult,
	toolName: string,
	mapsBaseUrl: string | undefined,
	worldSlug: string | undefined,
): CallToolResult {
	if (toolName !== SPELLKAVE_MAP_TOOL) return result;
	if (result.isError === true) return result;
	const base = normalizeMapsBaseUrl(mapsBaseUrl);
	const slug = worldSlug?.trim() ?? "";
	if (base === undefined || slug === "") return result;
	const url = `${base}/w/${encodeURIComponent(slug)}`;
	return {
		...result,
		content: [...result.content, { type: "text" as const, text: `Interactive map: ${url}` }],
	};
}

interface PlayerToolTextContent {
	type: "text";
	text: string;
}

interface PlayerToolImageContent {
	type: "image";
	data: string;
	mimeType: string;
}

export interface PlayerToolResult {
	content: Array<PlayerToolTextContent | PlayerToolImageContent>;
	details?: unknown;
}

export interface PlayerSessionClient {
	invoke(
		tool: string,
		args: unknown,
		causalContext?: WorldActorCausalContext,
	): Promise<Response<PlayerToolResult>>;
	toolNames?(): Promise<Response<string[]>>;
	status?(): Promise<Response<SessionDaemonStatus>>;
	/** sk-0m4.120.12: let the gateway hand the client its lifecycle emitter
	 * (`session_attach` / `subscription_lost` / `session_resubscribed` /
	 * `session_detach`). Optional — test doubles and plain clients omit it. */
	bindLifecycle?(emit: RemoteMcpLifecycleEmit): void;
}

const PRIVATE_BINDING_KEYS = new Set([
	"actorId",
	"actor_id",
	"binding",
	"database",
	"db",
	"identity",
	"role",
	"url",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlayerToolResult(value: unknown): value is PlayerToolResult {
	if (!isRecord(value) || !Array.isArray(value.content)) return false;
	return value.content.every((block) => {
		if (!isRecord(block)) return false;
		if (block.type === "text") return typeof block.text === "string";
		return (
			block.type === "image" && typeof block.data === "string" && typeof block.mimeType === "string"
		);
	});
}

function isWorldEvent(value: unknown): value is WorldEvent {
	return isRecord(value) && typeof value.kind === "string";
}

/**
 * Relay the daemon's piggybacked `pushes` (sk-0m4.22) into the MCP tool
 * result (sk-0m4.73). Before this, every MCP tools/call drained the daemon's
 * ONE WorldEventBuilder and then silently dropped the events — an MCP client
 * (which has no unsolicited push channel) never saw hits taken, XP, turn
 * transitions, or an NPC's late reply. Each event becomes one extra text
 * block (same renderer `sk` uses for its `push` JSONL lines) and the raw
 * events ride an ADDITIVE `structuredContent.world_events` array. Additive
 * only: clients that ignore unknown blocks/fields keep working.
 */
function withWorldEvents(
	result: CallToolResult,
	pushes: readonly unknown[] | undefined,
): CallToolResult {
	if (pushes === undefined) return result;
	const events = pushes.filter(isWorldEvent);
	if (events.length === 0) return result;
	const content = [
		...result.content,
		...events.map((event) => ({ type: "text" as const, text: renderWorldEventLine(event) })),
	];
	// Only merge into an object-shaped structuredContent; a non-object
	// `details` is kept verbatim and the text blocks alone carry the events.
	if (result.structuredContent !== undefined && !isRecord(result.structuredContent)) {
		return { ...result, content };
	}
	return {
		...result,
		content,
		structuredContent: { ...(result.structuredContent ?? {}), world_events: events },
	};
}

/**
 * sk-0m4.74: relay an act tool's `consequences` register (additive to
 * `details`, already riding in `structuredContent` via the existing
 * `details` merge below) as its OWN labelled text blocks, BEFORE the
 * `world_events` (`pushes`) blocks `withWorldEvents` appends — an MCP client
 * with no unsolicited push channel would otherwise only see consequences
 * inside the raw `structuredContent` JSON, never as readable text. Absent/
 * empty `consequences` is silence, same discipline as `withWorldEvents`.
 */
function withConsequences(result: CallToolResult, details: unknown): CallToolResult {
	if (!isRecord(details)) return result;
	const raw = details.consequences;
	if (!Array.isArray(raw)) return result;
	const events = raw.filter(isWorldEvent);
	if (events.length === 0) return result;
	return {
		...result,
		content: [
			...result.content,
			...events.map((event) => ({
				type: "text" as const,
				text: `Consequence: ${renderWorldEventLine(event)}`,
			})),
		],
	};
}

/**
 * sk-uglp: relay session-lifecycle notices (today: `world_reset`) as a
 * leading text block the model cannot miss, plus an additive
 * `structuredContent.session_notices` array. Leading, not trailing: a reset
 * notice reframes everything after it.
 */
function withNotices(
	result: CallToolResult,
	notices: readonly SessionNotice[] | undefined,
): CallToolResult {
	if (notices === undefined || notices.length === 0) return result;
	const content = [
		...notices.map((notice) => ({ type: "text" as const, text: `Notice: ${notice.text}` })),
		...result.content,
	];
	if (result.structuredContent !== undefined && !isRecord(result.structuredContent)) {
		return { ...result, content };
	}
	return {
		...result,
		content,
		structuredContent: { ...(result.structuredContent ?? {}), session_notices: notices },
	};
}

function containsPrivateBindingOverride(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(containsPrivateBindingOverride);
	if (!isRecord(value)) return false;
	return Object.entries(value).some(
		([key, nested]) => PRIVATE_BINDING_KEYS.has(key) || containsPrivateBindingOverride(nested),
	);
}

/**
 * sk-0m4.120.36: player text when this subject's seat queue is already at its
 * in-flight cap. The call never reached the world — safe to retry once the
 * earlier calls settle.
 */
export const SEAT_BUSY_HINT =
	"Your seat is still busy with earlier tool calls. The world was not reset and this call was not delivered — wait for the earlier calls to finish, then retry.";

function errorResult(
	category: "domain" | "transport" | "protocol" | "gateway" | "internal",
	message: string,
	code: string,
	extra: Record<string, unknown> = {},
): CallToolResult {
	return {
		isError: true,
		content: [{ type: "text", text: message }],
		structuredContent: { error: { category, code, message, ...extra } },
	};
}

function thrownErrorResult(error: unknown, toolName?: string, args?: unknown): CallToolResult {
	// sk-0m4.94: a slow tool (communicate reply window) is not a world wipe.
	// sk-0m4.100: on communicate, return the normal awaiting_response receipt
	// so a slow NPC reply never prompts a retry/double-speak. Defence in depth
	// for callers that do not go through JwtBoundPlayerSessionClient's own map.
	if (isInvokeTimeout(error) && toolName === COMMUNICATE_TOOL) {
		const receipt = awaitingResponseCommunicationReceipt(args);
		return {
			content: receipt.content,
			...(receipt.details === undefined ? {} : { structuredContent: receipt.details }),
		};
	}
	// sk-0m4.120.24: category + code come from the ONE classifier the
	// must-gather `session_status` shares (`session-errors.ts`).
	if (error instanceof Error && "code" in error && error.code === "ambiguous_authority_world")
		return errorResult("gateway", error.message, "ambiguous_authority_world");
	const { category, code } = classifySessionError(error);
	if (isInvokeTimeout(error)) return errorResult(category, SESSION_INVOKE_TIMEOUT_HINT, code);
	switch (category) {
		case "transport":
			return errorResult(category, WORLD_RESET_OR_RESTARTING_HINT, code);
		case "protocol":
			return errorResult(category, "The PLAYER session daemon returned an invalid response.", code);
		case "gateway":
			return errorResult(category, SEAT_BUSY_HINT, code);
		default:
			// Genuinely unknown throw: keep `internal_error`, but name the class
			// (constructor name only — never the message) so the tool_call row
			// can tell a ZodError from a TypeError (sk-0m4.120.36).
			return errorResult(category, "The PLAYER tool call failed.", code, {
				error_class: unknownErrorClass(error),
			});
	}
}

/** Map one canonical daemon invocation into an MCP tools/call result. */
export function createSessionToolHandler(
	client: PlayerSessionClient,
	observer: RemoteMcpRunObserver = OFF_REMOTE_MCP_RUN_OBSERVER,
	transcript: PublicTranscriptRecorder = NOOP_PUBLIC_TRANSCRIPT_RECORDER,
	now: () => number = () => Date.now(),
	feedback: FeedbackToolOptions = {},
	mapLink: MapDeepLinkOptions = {},
): PlayerMcpToolHandler {
	const mapsBaseUrl = normalizeMapsBaseUrl(mapLink.mapsBaseUrl);
	const resolveWorldSlug = mapLink.resolveWorldSlug;
	const invoke = async (
		toolName: string,
		args: unknown,
		causalContext?: WorldActorCausalContext,
	): Promise<CallToolResult> => {
		if (toolName === SPELLKAVE_FEEDBACK_TOOL) {
			// Gateway-local ops tool — never reaches the session daemon.
			return handleSpellkaveFeedback(args, client, feedback, observer);
		}
		// Canonical grant/consent fields such as role and identity describe the
		// requested operation, never the authenticated session binding. Keep
		// rejecting undeclared binding overrides, including nested ones.
		const schema = TOOL_CONTRACTS.find((contract) => contract.name === toolName)?.parameters;
		const properties =
			schema && "properties" in schema && isRecord(schema.properties) ? schema.properties : {};
		const bindingArgs = isRecord(args)
			? Object.fromEntries(
					Object.entries(args).filter(
						([key, value]) =>
							!(
								typeof value === "string" &&
								(key === "role" ||
									(key === "identity" &&
										(toolName === "spellkave_offer_control" ||
											toolName === "spellkave_withdraw_control"))) &&
								Object.hasOwn(properties, key)
							),
					),
				)
			: args;
		if (containsPrivateBindingOverride(bindingArgs)) {
			return errorResult(
				"domain",
				"PLAYER session identity is fixed by the server.",
				"binding_override_denied",
			);
		}
		let response: Response<PlayerToolResult>;
		try {
			response = await client.invoke(toolName, args, causalContext);
		} catch (error) {
			return thrownErrorResult(error, toolName, args);
		}

		if (!response.ok) {
			// A tool_error frame carries `pushes` too (protocol.ts) — relay them,
			// a rejected act must not eat the world events that arrived meanwhile.
			return withNotices(
				withWorldEvents(
					errorResult("domain", response.error.message, response.error.code ?? "tool_error"),
					response.pushes,
				),
				response.notices,
			);
		}
		if (!isPlayerToolResult(response.result)) {
			return errorResult(
				"protocol",
				"The PLAYER session daemon returned a malformed tool result.",
				"malformed_tool_result",
			);
		}

		const baseResult = withNotices(
			withWorldEvents(
				withConsequences(
					{
						content: response.result.content,
						...(response.result.details === undefined
							? {}
							: { structuredContent: response.result.details }),
					},
					response.result.details,
				),
				response.pushes,
			),
			response.notices,
		);
		// Deep link only when maps URL is configured and the seat's world is known.
		let worldSlug: string | undefined;
		if (mapsBaseUrl !== undefined && toolName === SPELLKAVE_MAP_TOOL) {
			try {
				worldSlug = (await resolveWorldSlug?.())?.trim() || undefined;
			} catch {
				worldSlug = undefined;
			}
			// Prefer dedicated resolveWorldSlug; fall back to feedback seat resolver.
			if (worldSlug === undefined && feedback.resolveSeat !== undefined) {
				try {
					const seat = await feedback.resolveSeat();
					worldSlug = seat?.worldSlug?.trim() || undefined;
				} catch {
					worldSlug = undefined;
				}
			}
		}
		return withMapDeepLink(baseResult, toolName, mapsBaseUrl, worldSlug);
	};
	return (toolName, args) =>
		observer.observeToolCall(toolName, async (causalContext) => {
			const started = now();
			const result = await invoke(toolName, args, causalContext);
			transcript.record({
				toolName,
				params: args,
				result,
				durationMs: Math.max(0, now() - started),
				correlationId: currentRemoteMcpCorrelationId(),
			});
			return result;
		});
}
