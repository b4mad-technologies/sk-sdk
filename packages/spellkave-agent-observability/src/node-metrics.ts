import { createOtlpHttpMetrics, type WorldActorMetrics } from "./metrics.ts";
import {
	describeExportError,
	parseOtelPairs,
	worldActorResourceAttributes,
} from "./node-resource.ts";

/** Standard OTel environment bootstrap for Node hosts. Metrics stay disabled
 * when no endpoint is configured and never become a gameplay dependency. */
export function createWorldActorMetricsFromEnv(
	env: NodeJS.ProcessEnv = process.env,
	dimensions: Pick<
		Parameters<typeof createOtlpHttpMetrics>[0],
		| "allowedToolNames"
		| "allowedCycleSteps"
		| "allowedErrorCodes"
		| "serviceName"
		| "logTransportSnapshot"
	> = {},
): WorldActorMetrics | undefined {
	if (env.SPELLKAVE_OTEL_DISABLED === "1") return undefined;
	const endpoint = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT;
	if (endpoint === undefined || endpoint.trim() === "") return undefined;
	return createOtlpHttpMetrics({
		endpoint,
		serviceName: env.OTEL_SERVICE_NAME ?? "spellkave-world-actors",
		headers: parseOtelPairs(
			env.OTEL_EXPORTER_OTLP_METRICS_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS,
		),
		resourceAttributes: worldActorResourceAttributes(env),
		...dimensions,
		onError: (error) => {
			console.error(`world-actor metrics export failed (${describeExportError(error)})`);
		},
	});
}
