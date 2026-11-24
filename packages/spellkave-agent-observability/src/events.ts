// `agent-run-events/v1` — Spellkave's OWN versioned JSONL contract for WORLD
// ACTOR runs (ADR-0074, #1857 S2). The schema's spine is the RUN with a
// `run_kind` discriminator — "episode" was wanderer vocabulary, one run kind
// among several, never the schema's spine.
//
// Naming disambiguation (binding, ADR-0074): this package observes WORLD
// ACTORS. It is NOT ADR-0030 coding-agent trace/metric telemetry. The OTel sink
// uses distinct resource/service names and never writes into coding-agent
// streams; the canonical store is file-based run artifacts.
//
// Contract rules:
// - The version field (`v`) is MANDATORY on every line.
// - Readers are unknown-field-tolerant: they ignore fields they don't know
//   and never throw on extra data (see `reader.ts`).
// - LLM actors (via agent-runtime, S3) and deterministic NPC/companion
//   runners (ADR-0034 — no agent-runtime dependency) emit the SAME stream,
//   which is why this package depends on nothing LLM-specific.

/** The one schema version this package writes. Readers accept only this. */
export const AGENT_RUN_EVENTS_VERSION = "agent-run-events/v1" as const;

/** What KIND of run this is. Open set — the union names today's known kinds,
 * but the contract tolerates future kinds (readers must not exhaustively
 * switch without a default). */
export type RunKind = "campaign_playthrough" | "world_observation" | "combat_beat" | (string & {});

/** The actor's role profile (ADR-0074 role seam). */
export type RunRole = "PLAYER" | "DM" | "ADMIN" | (string & {});

/** Who is driving the actor. `service` marks a host process (the remote MCP
 * gateway) reporting its OWN lifecycle rather than an actor it drives
 * (sk-0m4.120.12) — such rows carry no actor decision. */
export type ControllerKind = "llm_player" | "deterministic_npc" | "companion" | "human" | "service";

/** The per-run envelope stamped onto every event line. */
export interface AgentRunEnvelope {
	v: typeof AGENT_RUN_EVENTS_VERSION;
	run_id: string;
	run_kind: RunKind;
	actor_id: string;
	role: RunRole;
	controller_kind: ControllerKind;
	/** The driver behind the runtime interface (e.g. "pi-agent") or the
	 * deterministic runner's name (e.g. "npc-fleet"). */
	driver: string;
	model?: string;
	/** World/session seed for reproducibility; empty string when seedless. */
	seed: string;
	/** ISO-8601 emission timestamp. */
	ts: string;
}

export type AgentRunEventType =
	| "run_start"
	| "run_end"
	| "turn_start"
	| "turn_end"
	| "tool_call"
	| "budget_tick"
	| "terminal"
	| "gap_report"
	// N2 (@spellkave/npc's seat library): one per perceive→decide→act cycle,
	// carrying the brain's `SeatDecision.reasoning` (summary + optional scored
	// candidates). Additive only — readers are unknown-type-tolerant by
	// contract (see the module doc above), so no consumer needs a matching
	// change to keep working.
	| "brain_decision"
	// ADR-0093 P2 (D-2/D-4): one per delivered `WorldEvent` (session lifecycle,
	// turn transition, self-hit, reaction window) — emitted by
	// `@spellkave/agent-runtime`'s push-delivery adapter at DELIVERY time (the
	// turn boundary `steer`/idle `followUp` fires), never at observation time;
	// the tick the underlying change was OBSERVED travels inside the payload's
	// `observed_at_tick` field instead (D-4 record determinism). Additive only,
	// same precedent as `brain_decision` above.
	| "world_event"
	// sk-jay0.6.31.7: one per visible `world_event` TABLE header row, emitted
	// by the adventure NPC host over the existing world-actor OTLP path.
	// Distinct from `world_event` above (player-facing delivery vocabulary in
	// `@spellkave/world-events`). Payload is the scalar allowlist only.
	| "world_table_event"
	// A self-driven actor cycle failed after its trigger had already been
	// accepted. This is distinct from the initiating transport/tool result.
	| "cycle_error"
	// sk-jay0.7.389.3: one per consumed world-module shape the SDK's connect()
	// could not decode or call, emitted when the shape check runs in "warn"
	// mode (it connected anyway). Additive, same precedent as above.
	| "contract_shape_mismatch"
	// sk-jay0.6.15.56.24.9: exactly one per scheduled self-driven seat run,
	// naming the subscribed tables whose cache mutation woke it and what the
	// seat did with that wake (ran, or skipped at which gate). The only record
	// of WHY a seat cycled; without it "every seat perceives on every tick"
	// could not be attributed to a table. Additive only, same precedent as
	// `brain_decision` above.
	| "cycle_wake"
	// One completed passive-reader phase change. This is intentionally separate
	// from `cycle_wake`: a quiet watch seat emits no cycles, so phase/liveness
	// evidence needs its own bounded JSONL record.
	| "subscription_transition"
	// Hardening (2026-08-06, wedged-session incident): emitted exactly once by
	// a size-capped sink (`createMemorySink`'s optional `maxEvents`, `emit.ts`)
	// in place of the event that would have exceeded the cap — bounds
	// worst-case memory growth from a runaway/wedged run without silently
	// losing the fact that truncation happened. Additive only, same precedent
	// as `brain_decision`/`world_event` above.
	| "sink_truncated"
	// Remote MCP `spellkave_feedback` (sk-rax8.7): one per submit attempt on the
	// same run as the tool_call envelope. Payload carries issue reference +
	// bundle hash only — never the must-gather body.
	| "player_feedback"
	// Gateway HTTP edge (sk-0m4.120.11): one per handled request on the run
	// `mcp-<correlation_id>` (the same run the tool_call uses), carrying the
	// matched route pattern, status, duration and the Cloudflare `CF-Ray` id —
	// never a URL, query string, body, or bearer token.
	| "http_request"
	// Host / session lifecycle (sk-0m4.120.12) — scalars only. Emitted by the
	// remote MCP gateway (`gateway_start`, `session_attach`,
	// `subscription_lost`, `session_resubscribed`, `session_detach`,
	// `session_token_refreshed`) and by the
	// PLAYER session daemon itself (`daemon_exit`) so a pod restart, a dead
	// daemon, and a dropped world subscription stop sharing one doctor signature.
	| "gateway_start"
	| "session_attach"
	| "subscription_lost"
	| "session_resubscribed"
	| "session_detach"
	// sk-jay0.5.14.15: the gateway accepted a refreshed OAuth access token for
	// the SAME subject and kept the live session and route (no detach, no
	// re-probe). Additive only, same precedent as `brain_decision` above.
	| "session_token_refreshed"
	| "daemon_exit"
	// World lifecycle (sk-jay0.6.38): one `world_lifecycle` event type with a
	// `phase` field carries every step of load → boot → ready → unload,
	// emitted by three services (the Account API, npc-host, and the gateway)
	// rather than one event type per phase — see `WorldLifecycleData` below.
	// Additive only — readers are unknown-type-tolerant by contract (see the
	// module doc above), so no consumer needs a matching change to keep
	// working.
	| "world_lifecycle";

/** One JSONL line: envelope + event type + type-specific payload. Payloads
 * are open records — emitters may add fields; readers tolerate unknowns. */
export interface AgentRunEvent extends AgentRunEnvelope {
	type: AgentRunEventType;
	data: Record<string, unknown>;
}

// --- Well-known payload shapes (advisory: emitters SHOULD provide these
// fields; readers MUST NOT assume they are present). ---

export interface ToolCallData {
	tool_name: string;
	is_error?: boolean;
	/** Emitter-chosen compact summary — never the full result payload. */
	summary?: string;
	duration_ms?: number;
}

export interface BudgetTickData {
	tool_calls_used?: number;
	max_tool_calls?: number;
	dry_streak?: number;
	max_dry_streak?: number;
	tokens_used?: number;
	token_budget?: number;
}

export interface TurnEndData {
	turn?: number;
	input_tokens?: number;
	output_tokens?: number;
	tool_calls?: number;
}

/** Payload for the one `sink_truncated` line a capped sink ever emits. */
export interface SinkTruncatedData {
	/** The cap that was hit (`maxEvents` the sink was constructed with). */
	max_events: number;
	/** How many events this sink had already accepted before truncating. */
	events_written: number;
}

/** Payload for `player_feedback` — join key to the issue/local reference;
 * never includes the must-gather bundle body. Envelope already carries
 * `run_id` / `actor_id`; `world_slug` may also appear on the envelope data
 * identity bits from the remote-MCP observer. */
export interface PlayerFeedbackData {
	/** Issue URL or local reference id returned by the feedback sink. */
	reference?: string;
	/** Player-selected category when provided. */
	category?: "bug" | "confusing" | "idea" | string;
	/** UTF-16 code-unit length of the player message (not the text). */
	message_chars?: number;
	/** SHA-256 hex of the must-gather JSON when a report was attached. */
	bundle_sha256?: string;
	world_slug?: string;
	correlation_id?: string;
	is_error?: boolean;
}

export interface TerminalData {
	/** Terminal classification, e.g. "explored_enough" | "converged" |
	 * "budget_exhausted" | "timeout" | "error" — an open set. */
	terminal: string;
	reason?: string;
}

export interface RunEndData {
	terminal?: string;
	turns?: number;
	tool_calls?: number;
	input_tokens?: number;
	output_tokens?: number;
	duration_ms?: number;
}

/** Safe, stable diagnostics for asynchronous actor-cycle failures. Arbitrary
 * error text remains host-local and is never part of this shared event. */
export interface CycleErrorData {
	step: string;
	tool_name?: string;
	failure_class: string;
	error_code?: string;
	retry_count: number;
	cause_kind?: string;
	cause_id?: string;
}

/** Payload for `cycle_wake`. `tables` are the snake_case table names (or the
 * SDK's `__applied` marker) accumulated by `notify()` since the previous
 * scheduled run — empty for an explicit table-less `notify()`. `outcome`:
 * `run` (perceive + decide ran), `skip_baseline` (only baseline singletons
 * moved), `skip_revision` (cache revision unchanged), `skip_fingerprint`
 * (perceived, view identical, decision skipped), `skip_parked` (authoring
 * rejections parked the seat), `coalesced` (a run was in flight; folded into
 * its rerun). Bounded vocabulary — safe as a metric dimension. */
export interface CycleWakeData {
	tables: string[];
	outcome: CycleWakeOutcome;
	revision?: number;
}

export type CycleWakeOutcome =
	| "run"
	| "skip_baseline"
	| "skip_revision"
	| "skip_fingerprint"
	| "skip_parked"
	| "coalesced";

export const CYCLE_WAKE_OUTCOMES: readonly CycleWakeOutcome[] = [
	"run",
	"skip_baseline",
	"skip_revision",
	"skip_fingerprint",
	"skip_parked",
	"coalesced",
];

/** Payload for `brain_decision`. `rule` and admitted input keys are hoisted
 * to the top of `data` by `emitBrainDecision`. `cause_kind`/`cause_id` name
 * the world row the brain acted on when it can attribute one; they stay
 * absent when several identifiable events were in the batch and the brain
 * did not name which, or when the typed view supplied no stable reference. */
export interface BrainDecisionData {
	view_kind?: string;
	intent?: unknown;
	rule?: string;
	cause_kind?: string;
	cause_id?: string;
	reasoning?: unknown;
}

/** Runtime guard for one parsed line. Tolerance means UNKNOWN EXTRA fields
 * are preserved — it never means required envelope fields may be absent: a
 * line missing any envelope field is skipped, so strict consumers (the run
 * index, aggregations) can rely on every accepted event being complete. */
export function isAgentRunEvent(value: unknown): value is AgentRunEvent {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	return (
		record.v === AGENT_RUN_EVENTS_VERSION &&
		typeof record.run_id === "string" &&
		typeof record.run_kind === "string" &&
		typeof record.actor_id === "string" &&
		typeof record.role === "string" &&
		typeof record.controller_kind === "string" &&
		typeof record.driver === "string" &&
		typeof record.seed === "string" &&
		typeof record.ts === "string" &&
		typeof record.type === "string"
	);
}

/** Payload for `http_request` (sk-0m4.120.11). `route` is the matched route
 * PATTERN (e.g. `/mcp`, `/w/*`), never the raw URL. */
export interface HttpRequestData {
	http_status: number;
	route: string;
	duration_ms: number;
	correlation_id: string;
	/** Cloudflare request id from the `CF-Ray` header, when present. */
	cf_ray?: string;
	http_method?: string;
}

/** Payloads for the lifecycle events (sk-0m4.120.12). Every field is a
 * closed-vocabulary scalar or a boolean; `image_tag` is the deployed
 * revision (`SPELLKAVE_IMAGE_TAG`), never a build path. */
export interface GatewayStartData {
	image_tag: string;
}
export interface SessionAttachData {
	/** `true` when the attach spawned a new daemon; `false` when it joined one. */
	spawned: boolean;
}
export interface SubscriptionLostData {
	/** Transport code (`ECONNREFUSED`, `ETIMEDOUT`, …) or a lifecycle word. */
	cause: string;
}
export interface SessionDetachData {
	reason: string;
}
export interface DaemonExitData {
	/** The run terminal the daemon closed with (`shutdown`, `idle_timeout`,
	 * `world_connection_lost`, `error`). */
	reason: string;
}

// --- World lifecycle (sk-jay0.6.38.2) ---------------------------------------
// Vocabulary shared by every emitter of `world_lifecycle` rows (Account API
// job watcher, npc-host boot path, gateway route probe) and by the doctor/
// dashboard that reads them back. Field names and phases are canonical in
// `openspec/changes/archive/2026-10-09-world-lifecycle-telemetry/design.md` § "The event
// family" and `ledger/designs/world-lifecycle-telemetry.md` § "The event
// family" — do not fork the vocabulary here.

/** Every phase of load → boot → ready → unload, across all three emitters.
 * Exported as a runtime array (not just a type) so emitters and the
 * doctor/dashboard can validate against and iterate the same vocabulary. */
export const WORLD_LIFECYCLE_PHASES = [
	"load_requested",
	"job_created",
	"job_running",
	"job_succeeded",
	"job_failed",
	"npc_host_restart_requested",
	"world_ready",
	"unloaded",
	"host_start",
	"host_boot_failed",
	"seat_boot_failed",
	"host_ready",
	"route_probe_failed",
] as const;

export type WorldLifecyclePhase = (typeof WORLD_LIFECYCLE_PHASES)[number];

/** Bounded `failure_class` vocabulary for `host_boot_failed` (npc-host).
 * Runtime array for the same reason as `WORLD_LIFECYCLE_PHASES`. */
export const WORLD_LIFECYCLE_FAILURE_CLASSES = [
	"env",
	"node_unreachable",
	"binding_drift",
	"not_provisioned",
	"bootstrap_failed",
	"no_seats",
	"all_seats_failed",
] as const;

export type WorldLifecycleFailureClass = (typeof WORLD_LIFECYCLE_FAILURE_CLASSES)[number];

/** Payload for `world_lifecycle` (sk-jay0.6.38.2). Scalars only — matches the
 * OTLP disclosure boundary in `otel.ts`. `world_slug` is required on every
 * row; job-owned phases (`load_requested` … `world_ready`, `unloaded`) also
 * carry `job_id`/`job_kind`. `boot_ms` is set only on `world_ready`
 * (`ready_ts − load_requested_ts`). */
export interface WorldLifecycleData {
	phase: WorldLifecyclePhase;
	outcome: "started" | "ok" | "failed";
	world_slug: string;
	/** `load.<slug>.<ms>` / `reset.<slug>.<ms>`; absent on host/gateway rows. */
	job_id?: string;
	job_kind?: "load" | "reset";
	/** This phase's duration where it has one. */
	duration_ms?: number;
	/** `world_ready` only: `ready_ts − load_requested_ts`. */
	boot_ms?: number;
	/** `SPELLKAVE_IMAGE_TAG` of the emitting pod. */
	image_tag?: string;
	/** Pinned `sha256:` digest (≤ 256 chars, not secret). */
	artifact_digest?: string;
	/** Bounded per-emitter vocabulary; see `WORLD_LIFECYCLE_FAILURE_CLASSES`
	 * for the npc-host `host_boot_failed` set. */
	failure_class?: WorldLifecycleFailureClass | string;
	/** Constructor name, never a message (sk-0m4.120.36 rule). */
	error_class?: string;
	/** k8s condition `reason` or SDK code. */
	error_code?: string;
}
