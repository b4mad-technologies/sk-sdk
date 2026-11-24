// Emit API (ADR-0074 S2). Two callers, one stream:
// - `@spellkave/agent-runtime` (S3) emits NATIVELY from inside
//   `runAgentSession` — hosts inject sinks, they cannot bypass emission
//   (today's three-partial-channels failure mode is prevented by
//   construction).
// - Deterministic NPC/companion runners (ADR-0034) call this API directly —
//   they never touch agent-runtime, which is why this module has zero
//   LLM/pi dependencies.
import {
	AGENT_RUN_EVENTS_VERSION,
	type AgentRunEnvelope,
	type AgentRunEvent,
	type AgentRunEventType,
	type ControllerKind,
	type RunKind,
	type RunRole,
	type SinkTruncatedData,
} from "./events.ts";

/** Where emitted events go. Sinks must never throw into the actor's run —
 * the emitter guards every write (a failing sink loses ITS copy only). */
export interface AgentRunSink {
	write(event: AgentRunEvent): void;
	/** Flush/close when the run ends. Optional; errors are swallowed. */
	close?(): void | Promise<void>;
}

/**
 * Synthetic clock for commit-stable / replayable run artifacts.
 * Envelope `ts` is required by agent-run-events/v1 — freeze it rather than omit.
 */
export interface DeterministicClockOptions {
	/** Epoch for the first emit. Default: 2026-01-01T00:00:00.000Z UTC. */
	epochMs?: number;
	/** Advance per emit call. Default: 1. */
	stepMs?: number;
}

/** Default epoch used when `deterministic: true` with no custom options. */
export const DETERMINISTIC_TS_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);

/**
 * Clock that returns epoch, then epoch+step, epoch+2*step, … — one tick per call.
 * Pass as `now` to {@link createRunEmitter}, or enable via `deterministic: true`.
 */
export function createDeterministicClock(
	options: DeterministicClockOptions | number = {},
): () => Date {
	const opts: DeterministicClockOptions =
		typeof options === "number" ? { epochMs: options } : options;
	const epochMs = opts.epochMs ?? DETERMINISTIC_TS_EPOCH_MS;
	const stepMs = opts.stepMs ?? 1;
	let tick = 0;
	return () => {
		const d = new Date(epochMs + tick * stepMs);
		tick += 1;
		return d;
	};
}

/** Static (per-run) envelope fields — everything but `ts`. */
export interface RunEmitterOptions {
	run_id: string;
	run_kind: RunKind;
	actor_id: string;
	role: RunRole;
	controller_kind: ControllerKind;
	driver: string;
	model?: string;
	seed?: string;
	/**
	 * Injectable clock. Defaults to wall clock, unless `deterministic` is set
	 * (then a synthetic advancing clock from {@link DETERMINISTIC_TS_EPOCH_MS}).
	 * Explicit `now` always wins over `deterministic`.
	 */
	now?: () => Date;
	/**
	 * Commit-stable / replayable timestamps at the emitter (not post-process):
	 * - `true` → {@link createDeterministicClock} with package defaults
	 * - options object → same with overrides
	 * Does not change `run_id` (caller chooses a stable id when wanted).
	 */
	deterministic?: boolean | DeterministicClockOptions;
	/**
	 * When true, any `duration_ms` / `durationMs` on the event `data` payload
	 * is forced to `0` at emit time (wall-clock timing is the usual churn
	 * source in committed JSONL). Defaults to `true` when `deterministic` is
	 * set, else `false`. Explicit value always wins.
	 */
	freezeDurationMs?: boolean;
}

export interface RunEmitter {
	/** The frozen envelope this emitter stamps (without `ts`). */
	readonly envelope: Omit<AgentRunEnvelope, "ts">;
	emit(type: AgentRunEventType, data?: Record<string, unknown>): void;
	/** Close every sink (best-effort, errors swallowed). */
	close(): Promise<void>;
}

function resolveNow(options: RunEmitterOptions): () => Date {
	if (options.now !== undefined) return options.now;
	if (options.deterministic === undefined || options.deterministic === false) {
		return () => new Date();
	}
	if (options.deterministic === true) return createDeterministicClock();
	return createDeterministicClock(options.deterministic);
}

function resolveFreezeDurationMs(options: RunEmitterOptions): boolean {
	if (options.freezeDurationMs !== undefined) return options.freezeDurationMs;
	return options.deterministic !== undefined && options.deterministic !== false;
}

/** Zero volatile duration fields on a data payload (emit-time, not post-hoc). */
export function freezeDurationFields(data: Record<string, unknown>): Record<string, unknown> {
	let out: Record<string, unknown> | undefined;
	for (const key of ["duration_ms", "durationMs"] as const) {
		if (key in data && data[key] !== 0) {
			out ??= { ...data };
			out[key] = 0;
		}
	}
	return out ?? data;
}

/**
 * Create a per-run emitter that stamps the `agent-run-events/v1` envelope on
 * every event and fans it out to the injected sinks.
 */
export function createRunEmitter(
	options: RunEmitterOptions,
	sinks: readonly AgentRunSink[],
): RunEmitter {
	const now = resolveNow(options);
	const freezeDurations = resolveFreezeDurationMs(options);
	const envelope: Omit<AgentRunEnvelope, "ts"> = {
		v: AGENT_RUN_EVENTS_VERSION,
		run_id: options.run_id,
		run_kind: options.run_kind,
		actor_id: options.actor_id,
		role: options.role,
		controller_kind: options.controller_kind,
		driver: options.driver,
		...(options.model !== undefined ? { model: options.model } : {}),
		seed: options.seed ?? "",
	};
	return {
		envelope,
		emit(type, data = {}) {
			const payload = freezeDurations ? freezeDurationFields(data) : data;
			const event: AgentRunEvent = {
				...envelope,
				ts: now().toISOString(),
				type,
				data: payload,
			};
			for (const sink of sinks) {
				try {
					sink.write(event);
				} catch {
					// Observability must never break the observed run: a failing sink
					// loses its own copy of the event, nothing else.
				}
			}
		},
		async close() {
			for (const sink of sinks) {
				try {
					await sink.close?.();
				} catch {
					// best-effort close
				}
			}
		},
	};
}

/** Hardening (2026-08-06, wedged-session incident): a live incident wedged a
 * deterministic-NPC fight loop for 150s and grew that seat's `createMemorySink`
 * transcript to 1.1GB via a zero-delay spin — the `events` array is the actual
 * unbounded-growth vector IN MEMORY (`createJsonlFileSink` appends straight to
 * disk per line and never buffers). `maxEvents` bounds it.
 *
 * That parenthesis was read as "the file sink is safe" and it is not: a 24/7
 * appender fills a disk just as surely, only slower (sk-jay0.6.15.40 — 150-250MB
 * per seat on a shared transcript volume). The file sink's own bound is `maxBytes`
 * (rotation) in `./node.ts`; the two caps are independent and neither implies
 * the other. */
export interface MemorySinkOptions {
	/** Stop appending once this many events have been accepted, and emit
	 * exactly one `sink_truncated` marker in place of the event that would
	 * have exceeded the cap — every write after that is a silent no-op (the
	 * marker is emitted once, not once per dropped event). Default:
	 * `undefined` (uncapped) — existing behavior, byte-identical. */
	maxEvents?: number;
}

/** In-memory sink — tests and the browser gateway's buffer. */
export function createMemorySink(
	options: MemorySinkOptions = {},
): AgentRunSink & { events: AgentRunEvent[] } {
	const { maxEvents } = options;
	const events: AgentRunEvent[] = [];
	let truncated = false;
	return {
		events,
		write(event) {
			if (truncated) return;
			if (maxEvents !== undefined && events.length >= maxEvents) {
				truncated = true;
				const data: SinkTruncatedData = { max_events: maxEvents, events_written: events.length };
				events.push({ ...event, type: "sink_truncated", data: { ...data } });
				return;
			}
			events.push(event);
		},
	};
}

/**
 * Browser-gateway sink: hands each event to a host callback (the chat UI's
 * live turn status). Deliberately dependency-free — the host owns transport.
 */
export function createGatewaySink(onEvent: (event: AgentRunEvent) => void): AgentRunSink {
	return {
		write(event) {
			onEvent(event);
		},
	};
}
