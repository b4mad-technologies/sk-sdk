import { OTLP_LOG_SAFE_RESOURCE_ATTRIBUTE_KEYS } from "./otel.ts";

export function parseOtelPairs(value: string | undefined): Record<string, string> {
	const out: Record<string, string> = {};
	if (value === undefined) return out;
	for (const pair of value.split(",")) {
		const separator = pair.indexOf("=");
		if (separator <= 0) continue;
		const key = pair.slice(0, separator).trim();
		const raw = pair.slice(separator + 1).trim();
		if (key === "") continue;
		try {
			out[key] = decodeURIComponent(raw);
		} catch {
			out[key] = raw;
		}
	}
	return out;
}

/** Environment variable carrying the deployed application revision. */
export const IMAGE_TAG_ENV = "SPELLKAVE_IMAGE_TAG";

/** The deployed revision for OTel `service.version`, or undefined when the
 * host did not declare one (local dev) — never a placeholder. */
export function serviceVersionFromEnv(env: NodeJS.ProcessEnv): string | undefined {
	const tag = env[IMAGE_TAG_ENV]?.trim();
	return tag ? tag : undefined;
}

/** Stable host identity wins over generic OTel resource configuration. A
 * multi-world gateway sets this only on the per-world child process; NPC
 * systemd instances derive it from their catalog slug (`%i`). The deployed
 * revision rides along as `service.version` for traces and metrics; the logs
 * projection reads the same env through `createOtlpHttpSink`'s
 * `serviceVersion` (sk-0m4.120.13). */
export function worldActorResourceAttributes(env: NodeJS.ProcessEnv): Record<string, string> {
	const attributes = parseOtelPairs(env.OTEL_RESOURCE_ATTRIBUTES);
	const worldSlug = env.SPELLKAVE_WORLD_SLUG?.trim();
	if (worldSlug) attributes["spellkave.world_slug"] = worldSlug;
	const serviceVersion = serviceVersionFromEnv(env);
	if (serviceVersion !== undefined) attributes["service.version"] = serviceVersion;
	return attributes;
}

/** The allowlisted subset of `OTEL_RESOURCE_ATTRIBUTES` for the logs sink
 * (sk-jay0.6.38.13). Lets the four Node logs-sink call sites pass one call
 * instead of hand-filtering the raw env var against
 * `OTLP_LOG_SAFE_RESOURCE_ATTRIBUTE_KEYS` themselves. */
export function logSinkResourceAttributesFromEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	const attributes = parseOtelPairs(env.OTEL_RESOURCE_ATTRIBUTES);
	const filtered: Record<string, string> = {};
	for (const [key, value] of Object.entries(attributes)) {
		if (OTLP_LOG_SAFE_RESOURCE_ATTRIBUTE_KEYS.has(key)) filtered[key] = value;
	}
	return filtered;
}

/** One-line description of an export failure, for a console log.
 *
 * Both `name` and `message`, because either alone misleads
 * (sk-jay0.6.15.56.21). Node's `fetch` reports every network-level failure as
 * `TypeError: fetch failed`, so a reporter printing only `error.name` writes
 * "TypeError" — which reads as a code defect and is really a dropped
 * connection. The metrics and traces exporters did exactly that while the logs
 * exporter printed only `message`, so one intermittent network fault appeared
 * in the same pod log under two unrelated-looking descriptions, and the metrics
 * one was unactionable: no type, no reason, no stack.
 *
 * Deliberately no stack and no `cause` message: this string goes to a console
 * that ships to the operator log, and an exporter failure's cause can carry a
 * request URL. The one exception is the cause's `code` when it is a bare
 * error-code token (`UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET`, `EAI_AGAIN`):
 * `fetch failed` alone does not say whether the connect timed out, the peer
 * reset it or DNS failed. A token
 * that matches the pattern cannot carry a URL; anything else is left out.
 */
export function describeExportError(error: unknown): string {
	if (!(error instanceof Error)) return typeof error;
	const base = error.message === "" ? error.name : `${error.name}: ${error.message}`;
	const code = causeCode(error);
	return code === undefined ? base : `${base} [${code}]`;
}

const ERROR_CODE_TOKEN = /^[A-Z][A-Z0-9_]{1,63}$/u;

function causeCode(error: Error): string | undefined {
	const cause: unknown = (error as { cause?: unknown }).cause;
	if (typeof cause !== "object" || cause === null) return undefined;
	const code: unknown = (cause as { code?: unknown }).code;
	return typeof code === "string" && ERROR_CODE_TOKEN.test(code) ? code : undefined;
}
