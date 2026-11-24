// Read/projection API (ADR-0074 S2) — the single consumption path for the
// playtest judge, progress-explorer, and future inspection layers. Emission
// and consumption live in ONE package on purpose: the moment they separate,
// schemas drift apart again (the ADR's stated enforcement mechanism).
//
// Readers are TOLERANT by contract: unknown fields are preserved untouched,
// unparseable or foreign lines are counted and skipped, never thrown on.
import {
	type AgentRunEvent,
	isAgentRunEvent,
	type RunEndData,
	type TerminalData,
} from "./events.ts";

export interface ParsedRunEvents {
	events: AgentRunEvent[];
	/** Lines that failed JSON.parse or are not agent-run-events/v1. */
	skipped: number;
}

/** Parse a JSONL document into v1 events, tolerantly. */
export function parseRunEvents(jsonl: string): ParsedRunEvents {
	const events: AgentRunEvent[] = [];
	let skipped = 0;
	for (const line of jsonl.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "") continue;
		let value: unknown;
		try {
			value = JSON.parse(trimmed);
		} catch {
			skipped += 1;
			continue;
		}
		if (!isAgentRunEvent(value)) {
			skipped += 1;
			continue;
		}
		// Normalise a missing payload; never strip unknown fields.
		if (typeof (value as { data?: unknown }).data !== "object" || value.data === null) {
			(value as { data: Record<string, unknown> }).data = {};
		}
		events.push(value);
	}
	return { events, skipped };
}

// --- Aggregations: the first two the playtest judge actually needs. ---

export interface RunTotals {
	run_id: string;
	tool_calls: number;
	/** Tool calls whose payload flagged `is_error: true`. */
	tool_errors: number;
	turns: number;
	input_tokens: number;
	output_tokens: number;
	gap_reports: number;
}

/** Per-run token/tool-call totals. Counts `tool_call` / `turn_end` /
 * `gap_report` events; token fields sum whatever `turn_end` payloads carry
 * (absent fields count 0 — tolerant readers never assume payload fields). */
export function aggregateRunTotals(events: readonly AgentRunEvent[]): RunTotals {
	const totals: RunTotals = {
		run_id: events[0]?.run_id ?? "",
		tool_calls: 0,
		tool_errors: 0,
		turns: 0,
		input_tokens: 0,
		output_tokens: 0,
		gap_reports: 0,
	};
	for (const event of events) {
		if (event.type === "tool_call") {
			totals.tool_calls += 1;
			if (event.data.is_error === true) totals.tool_errors += 1;
		} else if (event.type === "turn_end") {
			totals.turns += 1;
			totals.input_tokens += numberField(event.data, "input_tokens");
			totals.output_tokens += numberField(event.data, "output_tokens");
		} else if (event.type === "gap_report") {
			totals.gap_reports += 1;
		}
	}
	return totals;
}

export interface TerminalClassification {
	/** The terminal from the `terminal` event (preferred) or `run_end.terminal`. */
	terminal: string | null;
	reason: string | null;
	/** A `run_start` without any `run_end` — the run died or is still live. */
	incomplete: boolean;
}

/** Terminal classification for one run's event stream. */
export function classifyTerminal(events: readonly AgentRunEvent[]): TerminalClassification {
	let terminal: string | null = null;
	let reason: string | null = null;
	let sawStart = false;
	let sawEnd = false;
	for (const event of events) {
		if (event.type === "run_start") sawStart = true;
		if (event.type === "terminal") {
			const data = event.data as Partial<TerminalData>;
			if (typeof data.terminal === "string") terminal = data.terminal;
			if (typeof data.reason === "string") reason = data.reason;
		}
		if (event.type === "run_end") {
			sawEnd = true;
			const data = event.data as Partial<RunEndData>;
			if (terminal === null && typeof data.terminal === "string") terminal = data.terminal;
		}
	}
	return { terminal, reason, incomplete: sawStart && !sawEnd };
}

function numberField(data: Record<string, unknown>, key: string): number {
	const value = data[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
