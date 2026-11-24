// The portable proof (`scripts/prove-portable.mjs`) reports what a recorded
// CLI session cost an agent: calls, retries, failed attempts, bytes and
// tokens. Token counts must not depend on a model or the network, so
// `scripts/journey-cost.mjs` uses pinned js-tiktoken ranks. This test checks
// those counts on two fixed steps, one of them a failure. No node.
import { expect, it } from "vitest";
import { journeyCost } from "../../scripts/journey-cost.mjs";

it("counts request/response text with pinned ranks even without a model, including failures", () => {
	const steps = [
		{
			argv: ["docs", "café"],
			stdout: "hello world",
			stderr: "",
			exit_code: 2,
			expected_exit_code: 0,
		},
		{
			argv: ["docs"],
			stdout: "",
			stderr: "denied",
			exit_code: 2,
			expected_exit_code: 2,
			retry_of: 0,
		},
	];
	const cost = journeyCost(steps, 123);
	const bytes = steps.reduce(
		(sum, step) => sum + Buffer.byteLength(JSON.stringify({ argv: step.argv, stdin: "" })),
		0,
	);
	expect(cost).toMatchObject({
		request_bytes: bytes,
		response_bytes: 17,
		schema_bytes: 0,
		calls: 2,
		retries: 1,
		failed_attempts: 1,
		expected_refusals: 1,
	});
	expect(cost.token_accounting).toMatchObject({
		version: "1.0.21",
		encoding: "o200k_base",
		response_tokens: 4,
		agent_context_tokens: 0,
		schema_tokens: 0,
	});
});
