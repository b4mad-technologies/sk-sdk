// Telemetry for the connect-time shape check in "warn" mode (sk-jay0.7.389.3).
//
// One `contract_shape_mismatch` event per breaking change the client connected
// past. Two carriers, one shape:
//   - always: a diagnostic line through connect()'s `onDiagnostic` sink
//     (a browser app forwards it to its own telemetry, e.g. Play's RUM);
//   - in a Node host with `SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT` set (every hosted
//     pod that already ships `world_actor_run_events`): the same event as an
//     `agent-run-events/v1` OTLP log record, so it lands in OpenObserve with no
//     host wiring.
import {
	AGENT_RUN_EVENTS_VERSION,
	type AgentRunEvent,
	createOtlpHttpSink,
} from "@spellkave/agent-observability";
import {
	logSinkResourceAttributesFromEnv,
	parseOtelPairs,
	serviceVersionFromEnv,
} from "@spellkave/agent-observability/resource";
import type { RuntimeChange } from "./world-contract/index.ts";

export const CONTRACT_SHAPE_MISMATCH = "contract_shape_mismatch";

/** The fields of one mismatch, as the diagnostic line and the OTLP event carry them. */
export interface ShapeMismatchFields {
	readonly shape_mode: "warn";
	readonly shape_database: string;
	readonly shape_item: string;
	readonly shape_detail: string;
	readonly client_epoch: number;
}

/** Longest `shape_detail` carried; a shifted row can list many columns. */
export const SHAPE_DETAIL_MAX = 1000;

/** One entry per mismatched ITEM (its changes joined), not per shifted column. */
export function shapeMismatchFields(
	changes: readonly RuntimeChange[],
	database: string,
	clientEpoch: number,
): ShapeMismatchFields[] {
	const byItem = new Map<string, string[]>();
	for (const c of changes) byItem.set(c.item, [...(byItem.get(c.item) ?? []), c.detail]);
	return [...byItem.entries()].map(([item, details]) => {
		const detail = details.join("; ");
		return {
			shape_mode: "warn",
			shape_database: database,
			shape_item: item,
			shape_detail:
				detail.length > SHAPE_DETAIL_MAX ? `${detail.slice(0, SHAPE_DETAIL_MAX - 1)}…` : detail,
			client_epoch: clientEpoch,
		};
	});
}

const reported = new Set<string>();

/**
 * The mismatches this process has not reported yet. Hosts such as the api and
 * the gateway connect per request; one report per distinct mismatch per
 * process keeps the volume independent of the request rate.
 */
export function unreportedShapeMismatches(
	fields: readonly ShapeMismatchFields[],
): ShapeMismatchFields[] {
	const fresh = fields.filter(
		(f) => !reported.has(JSON.stringify([f.shape_database, f.shape_item, f.shape_detail])),
	);
	for (const f of fresh)
		reported.add(JSON.stringify([f.shape_database, f.shape_item, f.shape_detail]));
	return fresh;
}

/** Test seam: forget what this process reported. */
export function resetReportedShapeMismatches(): void {
	reported.clear();
}

/** The `agent-run-events/v1` form of the mismatches (a service row, no actor decision). */
export function shapeMismatchEvents(
	fields: readonly ShapeMismatchFields[],
	envelope: {
		readonly runId: string;
		readonly actorId: string;
		readonly driver: string;
		readonly now: Date;
	},
): AgentRunEvent[] {
	return fields.map((data) => ({
		v: AGENT_RUN_EVENTS_VERSION,
		run_id: envelope.runId,
		run_kind: "contract_check",
		actor_id: envelope.actorId,
		role: "SERVICE",
		controller_kind: "service",
		driver: envelope.driver,
		seed: "",
		ts: envelope.now.toISOString(),
		type: CONTRACT_SHAPE_MISMATCH,
		data: { ...data },
	}));
}

type Env = Record<string, string | undefined>;

function processEnv(): Env | undefined {
	return (globalThis as { process?: { env?: Env } }).process?.env;
}

/**
 * Ships the events to the world-actor OTLP logs endpoint when the host has
 * one configured; resolves `false` (and sends nothing) otherwise. Never
 * throws: a lost telemetry copy must not change whether the client connects.
 */
export async function exportShapeMismatches(
	events: readonly AgentRunEvent[],
	env: Env | undefined = processEnv(),
	fetchFn?: typeof fetch,
): Promise<boolean> {
	const endpoint = env?.SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT?.trim();
	if (!endpoint || events.length === 0) return false;
	try {
		const serviceVersion = serviceVersionFromEnv(env as NodeJS.ProcessEnv);
		const sink = createOtlpHttpSink({
			endpoint,
			headers: parseOtelPairs(
				env?.OTEL_EXPORTER_OTLP_LOGS_HEADERS ?? env?.OTEL_EXPORTER_OTLP_HEADERS,
			),
			resourceAttributes: logSinkResourceAttributesFromEnv(env as NodeJS.ProcessEnv),
			...(serviceVersion === undefined ? {} : { serviceVersion }),
			...(fetchFn === undefined ? {} : { fetchFn }),
		});
		for (const event of events) sink.write(event);
		await sink.close?.();
		return true;
	} catch {
		return false;
	}
}

/** The driver name for the OTLP envelope: the host's own service name when set. */
export function shapeTelemetryDriver(env: Env | undefined = processEnv()): string {
	return env?.OTEL_SERVICE_NAME?.trim() || env?.SPELLKAVE_SERVICE_NAME?.trim() || "spellkave-sdk";
}
