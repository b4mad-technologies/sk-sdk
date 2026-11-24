import { createHash } from "node:crypto";

import type { CallToolResult } from "@modelcontextprotocol/server";

import {
	FEEDBACK_CLIENT_SECTION_MAX_BYTES,
	FEEDBACK_MESSAGE_MAX_BYTES,
	FEEDBACK_RATE_LIMIT_MAX,
	FEEDBACK_RATE_LIMIT_WINDOW_MS,
	type FeedbackCategory,
} from "./feedback-constants.ts";

export {
	FEEDBACK_CLIENT_SECTION_MAX_BYTES,
	FEEDBACK_MESSAGE_MAX_BYTES,
	FEEDBACK_RATE_LIMIT_MAX,
	FEEDBACK_RATE_LIMIT_WINDOW_MS,
	FEEDBACK_TOOL_DESCRIPTION,
	FEEDBACK_TOOL_INPUT_SCHEMA,
	type FeedbackCategory,
	SPELLKAVE_FEEDBACK_TOOL,
} from "./feedback-constants.ts";

import type { PlayerSessionClient } from "./daemon-handler.ts";
import {
	createGitHubFeedbackSinkFromAppEnvFile,
	FeedbackSinkError,
	type GitHubFeedbackSinkOptions,
} from "./github-feedback-sink.ts";
import { buildMustGather, type MustGatherBundle, type MustGatherContext } from "./must-gather.ts";
import {
	currentRemoteMcpCorrelationId,
	currentRemoteMcpRequestSubject,
	emitOnCurrentRemoteMcpRun,
	type RemoteMcpRunObserver,
} from "./observability.ts";
import { classifySessionError } from "./session-errors.ts";
import { playerMcpServerInfo } from "./tools.ts";
import { hashTranscriptSubject } from "./transcript.ts";

export {
	buildFeedbackIssueBody,
	buildFeedbackIssueTitle,
	bundleDedupHash,
	createGitHubFeedbackSink,
	createGitHubFeedbackSinkFromAppEnvFile,
	FEEDBACK_ISSUE_LABEL,
	FeedbackSinkError,
	feedbackIssueLabels,
	type GitHubFeedbackAppConfig,
	type GitHubFeedbackSink,
	type GitHubFeedbackSinkOptions,
	loadGitHubFeedbackAppConfig,
	mintGitHubAppJwt,
	mintInstallationToken,
	parseAppEnvFile,
} from "./github-feedback-sink.ts";

/** SHA-256 hex of the must-gather JSON — never the body itself (sk-rax8.7). */
function bundleSha256(bundle: MustGatherBundle): string {
	return createHash("sha256").update(JSON.stringify(bundle), "utf8").digest("hex");
}

export interface FeedbackSubmission {
	readonly message: string;
	readonly category?: FeedbackCategory;
	readonly bundle?: MustGatherBundle;
	readonly seat: {
		readonly actor_id: string;
		readonly subject?: string;
		readonly world_slug?: string;
	};
	readonly submitted_at: string;
}

/**
 * Where player feedback lands after the gateway packages it.
 * Pattern mirrors AgentRunSink: one interface, swappable implementations.
 * Memory sink for tests / local; GitHub Issues sink arrives in sk-rax8.6.
 */
export interface FeedbackSink {
	submit(feedback: FeedbackSubmission): Promise<{ reference: string }>;
}

export interface MemoryFeedbackSink extends FeedbackSink {
	readonly submissions: readonly FeedbackSubmission[];
	clear(): void;
}

export interface FeedbackRateLimiter {
	/** Record one attempt. Returns rate_limited details when the seat is over quota. */
	attempt(actorId: string): { allowed: true } | { allowed: false; retryAfterMs: number };
	clear(): void;
}

export interface CreateMemoryFeedbackSinkOptions {
	/** Deterministic id factory for snapshot tests. */
	readonly idFactory?: () => string;
}

/**
 * Gateway start selector: `SPELLKAVE_FEEDBACK_APP_ENV` path → GitHub Issues sink;
 * unset/empty → in-memory sink (local + tests).
 */
export async function createFeedbackSinkFromEnv(
	env: NodeJS.ProcessEnv = process.env,
	options: Omit<GitHubFeedbackSinkOptions, "config"> = {},
): Promise<FeedbackSink> {
	const appEnvPath = env.SPELLKAVE_FEEDBACK_APP_ENV?.trim() ?? "";
	if (appEnvPath === "") return createMemoryFeedbackSink();
	return createGitHubFeedbackSinkFromAppEnvFile(appEnvPath, options);
}

export function createMemoryFeedbackSink(
	options: CreateMemoryFeedbackSinkOptions = {},
): MemoryFeedbackSink {
	const submissions: FeedbackSubmission[] = [];
	let seq = 0;
	const idFactory =
		options.idFactory ??
		(() => {
			seq += 1;
			return `local-feedback-${seq}`;
		});
	return {
		get submissions(): readonly FeedbackSubmission[] {
			return [...submissions];
		},
		async submit(feedback) {
			submissions.push(feedback);
			return { reference: idFactory() };
		},
		clear() {
			submissions.length = 0;
			seq = 0;
		},
	};
}

export interface CreateFeedbackRateLimiterOptions {
	readonly max?: number;
	readonly windowMs?: number;
	readonly now?: () => number;
}

/** In-memory sliding-window limiter keyed by actor id (gateway is single-process). */
export function createInMemoryFeedbackRateLimiter(
	options: CreateFeedbackRateLimiterOptions = {},
): FeedbackRateLimiter {
	const max = options.max ?? FEEDBACK_RATE_LIMIT_MAX;
	const windowMs = options.windowMs ?? FEEDBACK_RATE_LIMIT_WINDOW_MS;
	const now = options.now ?? Date.now;
	const hits = new Map<string, number[]>();

	return {
		attempt(actorId: string) {
			const key = actorId.trim() === "" ? "unresolved" : actorId.trim();
			const t = now();
			const windowStart = t - windowMs;
			const recent = (hits.get(key) ?? []).filter((ts) => ts > windowStart);
			if (recent.length >= max) {
				const oldest = recent[0] ?? t;
				return { allowed: false as const, retryAfterMs: Math.max(0, oldest + windowMs - t) };
			}
			recent.push(t);
			hits.set(key, recent);
			return { allowed: true as const };
		},
		clear() {
			hits.clear();
		},
	};
}

export interface FeedbackToolOptions {
	readonly sink?: FeedbackSink;
	readonly rateLimiter?: FeedbackRateLimiter;
	readonly resolveSeat?: () =>
		| { actorId: string; worldSlug?: string }
		| undefined
		| Promise<{ actorId: string; worldSlug?: string } | undefined>;
	readonly mustGatherContext?: () => MustGatherContext | Promise<MustGatherContext>;
	readonly now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}

function feedbackError(
	code: string,
	message: string,
	category: "domain" | "protocol" | "internal" = "domain",
): CallToolResult {
	return {
		isError: true,
		content: [{ type: "text", text: message }],
		structuredContent: { error: { category, code, message } },
	};
}

function parseFeedbackArgs(args: unknown):
	| {
			ok: true;
			message: string;
			category?: FeedbackCategory;
			includeReport: boolean;
			/** Loosely typed: `FEEDBACK_TOOL_INPUT_SCHEMA`'s `client` shape is
			 * already enforced by the MCP host's schema validation before this
			 * function ever runs (`validateToolInput`, ajv-backed) — this parse
			 * only re-checks what the schema cannot express (the byte cap) for
			 * callers that reach `handleSpellkaveFeedback` directly, e.g. tests. */
			client?: Record<string, unknown>;
	  }
	| { ok: false; result: CallToolResult } {
	if (!isRecord(args)) {
		return {
			ok: false,
			result: feedbackError(
				"invalid_args",
				"spellkave_feedback requires an object argument.",
				"protocol",
			),
		};
	}
	const message = args.message;
	if (typeof message !== "string" || message.trim() === "") {
		return {
			ok: false,
			result: feedbackError(
				"invalid_args",
				"message is required and must be a non-empty string.",
				"protocol",
			),
		};
	}
	if (utf8ByteLength(message) > FEEDBACK_MESSAGE_MAX_BYTES) {
		return {
			ok: false,
			result: feedbackError(
				"message_too_large",
				`message exceeds the ${FEEDBACK_MESSAGE_MAX_BYTES} byte limit.`,
			),
		};
	}
	let category: FeedbackCategory | undefined;
	if (args.category !== undefined) {
		if (args.category !== "bug" && args.category !== "confusing" && args.category !== "idea") {
			return {
				ok: false,
				result: feedbackError(
					"invalid_args",
					"category must be one of: bug, confusing, idea.",
					"protocol",
				),
			};
		}
		category = args.category;
	}
	const includeReport = args.include_report === undefined ? true : args.include_report === true;
	if (args.include_report !== undefined && typeof args.include_report !== "boolean") {
		return {
			ok: false,
			result: feedbackError(
				"invalid_args",
				"include_report must be a boolean when set.",
				"protocol",
			),
		};
	}
	let client: Record<string, unknown> | undefined;
	if (args.client !== undefined) {
		if (!isRecord(args.client)) {
			return {
				ok: false,
				result: feedbackError("invalid_args", "client must be an object when set.", "protocol"),
			};
		}
		if (utf8ByteLength(JSON.stringify(args.client)) > FEEDBACK_CLIENT_SECTION_MAX_BYTES) {
			return {
				ok: false,
				result: feedbackError(
					"client_section_too_large",
					`client exceeds the ${FEEDBACK_CLIENT_SECTION_MAX_BYTES} byte limit.`,
				),
			};
		}
		client = args.client;
	}
	return { ok: true, message: message.trim(), category, includeReport, client };
}

async function resolveActorId(
	options: FeedbackToolOptions,
	client: PlayerSessionClient,
): Promise<{ actorId: string; worldSlug?: string; subject?: string }> {
	const subject = currentRemoteMcpRequestSubject();
	const resolved = await options.resolveSeat?.();
	if (resolved !== undefined && resolved.actorId.trim() !== "") {
		return {
			actorId: resolved.actorId.trim(),
			...(resolved.worldSlug !== undefined ? { worldSlug: resolved.worldSlug } : {}),
			...(subject !== undefined ? { subject } : {}),
		};
	}
	if (client.status !== undefined) {
		try {
			const status = await client.status();
			if (status.ok) {
				const actorId = status.result.binding?.actorId?.trim() ?? "";
				if (actorId !== "") {
					return {
						actorId,
						...(subject !== undefined ? { subject } : {}),
					};
				}
			}
		} catch {
			// Fall through to subject / unresolved.
		}
	}
	if (subject !== undefined && subject.trim() !== "") {
		return { actorId: subject.trim(), subject: subject.trim() };
	}
	return { actorId: "unresolved", ...(subject !== undefined ? { subject } : {}) };
}

/**
 * Build default must-gather context from the live request + session client +
 * run-events ring buffer. Callers may override via FeedbackToolOptions.
 */
export async function defaultMustGatherContext(input: {
	client: PlayerSessionClient;
	observer?: RemoteMcpRunObserver;
	seat: { actorId: string; worldSlug?: string; subject?: string };
	now: () => Date;
	/** The caller-supplied `client` argument (sk-jay0.5.8), passed straight
	 * through to `MustGatherContext.clientInfo` — `buildMustGather` already
	 * forwards that into `bundle.client_info`, and the bundle-wide
	 * `redactSensitiveData` pass (`must-gather.ts`) already walks it, so no
	 * separate redaction step is needed here. */
	clientInfo?: Record<string, unknown>;
}): Promise<MustGatherContext> {
	const correlationId = currentRemoteMcpCorrelationId();
	// An unreachable session is a finding, not a blank: say so instead of `{}`.
	let sessionStatus: MustGatherContext["sessionStatus"];
	if (input.client.status === undefined) {
		sessionStatus = {
			status: "unavailable",
			error_category: "protocol",
			error_code: "status_unsupported",
		};
	} else {
		try {
			const status = await input.client.status();
			sessionStatus = status.ok
				? status.result
				: {
						status: "unavailable",
						error_category: "protocol",
						...(status.error.code !== undefined ? { error_code: status.error.code } : {}),
					};
		} catch (error) {
			// sk-0m4.120.24: the structured gateway code (`session_invoke_timeout`,
			// a transport code, `session_unavailable`, …), never `error.name`.
			const { category, code } = classifySessionError(error, "status_failed");
			sessionStatus = { status: "unavailable", error_category: category, error_code: code };
		}
	}
	// Whole ring buffer (process-wide): buildMustGather keeps only this
	// subject's rows and derives recent_tool_errors from them.
	const runEvents = input.observer?.eventsSink?.getEvents();
	const subject = input.seat.subject?.trim() ?? "";
	return {
		correlationId,
		runId: `mcp-${correlationId}`,
		world:
			input.seat.worldSlug !== undefined
				? { slug: input.seat.worldSlug, db: input.seat.worldSlug }
				: undefined,
		seat: {
			actorId: input.seat.actorId,
			// Same SHA-256 prefix the run events and public transcripts carry —
			// never a slice of the raw OAuth sub (the issue body is public-ish).
			...(subject !== "" ? { subjectPrefix: hashTranscriptSubject(subject) } : {}),
			role: "PLAYER",
		},
		// sk-0m4.120.13: the deployed image tag when the host declares one.
		versions: { gateway: playerMcpServerInfo().version },
		sessionStatus,
		...(runEvents === undefined ? {} : { runEvents }),
		...(input.clientInfo === undefined ? {} : { clientInfo: input.clientInfo }),
		now: input.now,
	};
}

/** Handle one spellkave_feedback tools/call. Never throws into the MCP host. */
export async function handleSpellkaveFeedback(
	args: unknown,
	client: PlayerSessionClient,
	options: FeedbackToolOptions = {},
	observer?: RemoteMcpRunObserver,
): Promise<CallToolResult> {
	const parsed = parseFeedbackArgs(args);
	if (!parsed.ok) return parsed.result;

	const now = options.now ?? (() => new Date());
	const sink = options.sink ?? createMemoryFeedbackSink();
	const rateLimiter =
		options.rateLimiter ?? createInMemoryFeedbackRateLimiter({ now: () => now().getTime() });

	try {
		const seat = await resolveActorId(options, client);
		const rate = rateLimiter.attempt(seat.actorId);
		if (!rate.allowed) {
			const seconds = Math.ceil(rate.retryAfterMs / 1000);
			return feedbackError(
				"rate_limited",
				`Feedback rate limit reached for this seat. Try again in about ${seconds}s.`,
			);
		}

		let bundle: MustGatherBundle | undefined;
		if (parsed.includeReport) {
			const ctx =
				(await options.mustGatherContext?.()) ??
				(await defaultMustGatherContext({
					client,
					observer,
					seat,
					now,
					clientInfo: parsed.client,
				}));
			bundle = buildMustGather(ctx);
		}

		const submission: FeedbackSubmission = {
			message: parsed.message,
			...(parsed.category !== undefined ? { category: parsed.category } : {}),
			...(bundle !== undefined ? { bundle } : {}),
			seat: {
				actor_id: seat.actorId,
				...(seat.subject !== undefined ? { subject: seat.subject } : {}),
				...(seat.worldSlug !== undefined ? { world_slug: seat.worldSlug } : {}),
			},
			submitted_at: now().toISOString(),
		};

		const { reference } = await sink.submit(submission);
		// Same run_id/world attrs as the gateway tool_call (observeToolCall ALS).
		const correlationId = currentRemoteMcpCorrelationId();
		emitOnCurrentRemoteMcpRun("player_feedback", {
			reference,
			message_chars: parsed.message.length,
			correlation_id: correlationId,
			...(parsed.category !== undefined ? { category: parsed.category } : {}),
			...(bundle !== undefined ? { bundle_sha256: bundleSha256(bundle) } : {}),
			...(seat.worldSlug !== undefined && seat.worldSlug !== ""
				? { world_slug: seat.worldSlug }
				: {}),
		});
		const payload = {
			ok: true as const,
			reference,
			...(parsed.category !== undefined ? { category: parsed.category } : {}),
			include_report: parsed.includeReport,
		};
		return {
			content: [
				{
					type: "text",
					text: `Feedback recorded. Reference: ${reference}`,
				},
			],
			structuredContent: payload,
		};
	} catch (error) {
		// Sink failures stay ok:false with a reason (no tokens); the failure is
		// still visible on the run timeline (sk-rax8.7).
		emitOnCurrentRemoteMcpRun("player_feedback", {
			is_error: true,
			message_chars: parsed.message.length,
			correlation_id: currentRemoteMcpCorrelationId(),
			...(parsed.category !== undefined ? { category: parsed.category } : {}),
		});
		const reason =
			error instanceof FeedbackSinkError
				? error.publicMessage
				: "Could not record feedback right now.";
		return {
			isError: true,
			content: [{ type: "text", text: reason }],
			structuredContent: {
				ok: false as const,
				reason,
				error: { category: "internal" as const, code: "feedback_failed", message: reason },
			},
		};
	}
}
