// What a recorded CLI session cost an agent: calls, retries, failed attempts,
// bytes and tokens of requests and responses. Token counts use pinned
// js-tiktoken ranks (o200k_base), so they do not depend on a model or the
// network. Used by prove-portable.mjs and a sandbox handoff proof; tested
// in src/__tests__/journey-cost.test.js.
import { getEncoding } from "js-tiktoken";

// Exact dev dependency + bundled ranks: no network/model-dependent accounting.
const encoding = getEncoding("o200k_base");
const measure = (text) => ({ bytes: Buffer.byteLength(text), tokens: encoding.encode(text).length });

export function journeyCost(interactions, elapsedMs) {
	const request = interactions.map((step) => measure(JSON.stringify({ argv: step.argv, stdin: step.stdin ?? "" })));
	const response = interactions.map((step) => measure(step.stdout + step.stderr));
	const total = (values, key) => values.reduce((sum, value) => sum + value[key], 0);
	return {
		calls: interactions.length,
		retries: interactions.filter((step) => step.retry_of !== undefined).length,
		failed_attempts: interactions.filter((step) => step.exit_code !== (step.expected_exit_code ?? 0)).length,
		expected_refusals: interactions.filter((step) => step.expected_exit_code !== undefined && step.expected_exit_code !== 0).length,
		elapsed_ms: elapsedMs,
		request_bytes: total(request, "bytes"), response_bytes: total(response, "bytes"), schema_bytes: 0,
		token_accounting: {
			package: "js-tiktoken", version: "1.0.21", encoding: "o200k_base",
			request_tokens: total(request, "tokens"), response_tokens: total(response, "tokens"), schema_tokens: 0,
			basis: "UTF-8 JSON {argv,stdin} requests; sanitized stdout+stderr responses, per call; no CLI schema transmitted",
			agent_context_tokens: 0, model: null,
		},
		image_accounting: { images: 0, tokens: 0 },
	};
}
