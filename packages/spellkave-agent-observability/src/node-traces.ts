import {
	describeExportError,
	parseOtelPairs,
	worldActorResourceAttributes,
} from "./node-resource.ts";
import { createOtlpHttpTracer, type WorldActorTracer } from "./traces.ts";

/** Standard OTel environment bootstrap for Node hosts. Disabled when no OTLP
 * endpoint is configured; observability never becomes a gameplay dependency. */
export function createWorldActorTracerFromEnv(
	env: NodeJS.ProcessEnv = process.env,
): WorldActorTracer | undefined {
	if (env.SPELLKAVE_OTEL_DISABLED === "1") return undefined;
	const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? env.OTEL_EXPORTER_OTLP_ENDPOINT;
	if (endpoint === undefined || endpoint.trim() === "") return undefined;
	return createOtlpHttpTracer({
		endpoint,
		serviceName: env.OTEL_SERVICE_NAME ?? "spellkave-world-actors",
		headers: parseOtelPairs(
			env.OTEL_EXPORTER_OTLP_TRACES_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS,
		),
		resourceAttributes: worldActorResourceAttributes(env),
		onError: (error) => {
			console.error(`world-actor trace export failed (${describeExportError(error)})`);
		},
	});
}
