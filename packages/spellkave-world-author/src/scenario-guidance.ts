export type DocEvidenceState =
	| "proven"
	| "reproduced"
	| "unencoded"
	| "not-run"
	| "failed"
	| "not-applicable";

/** Captured artifacts supplied by feature owners, using existing evidence states. */
export interface ScenarioCapture {
	scenario: string;
	test: string;
	state: DocEvidenceState;
	implementing_revision: string;
	fixture_revision: string;
	source_revision: string;
	surface: string;
	surface_revision: string;
	tested_at: string;
	assertions: readonly string[];
	interactions: readonly {
		argv?: readonly string[];
		/** Exact captured MCP frame; data only, never dispatched by projection. */
		mcp_request?: { method: string; params?: unknown };
		stdout: string;
		stderr: string;
		exit_code: number;
	}[];
	evidence_doc: string;
}

/** Redaction happens before projection; aliases retain the synthetic proof's meaning. */
export function sanitizeScenarioText(
	text: string,
	aliases: Readonly<Record<string, string>>,
): string {
	let sanitized = text;
	for (const [privateValue, alias] of Object.entries(aliases).sort(
		(a, b) => b[0].length - a[0].length,
	)) {
		if (privateValue.length === 0 || !/^<[a-z0-9-]+>$/i.test(alias))
			throw new Error("Invalid fixture alias");
		sanitized = sanitized.replaceAll(privateValue, alias);
	}
	// Parse serialized captures before matching strings: escaped quotes/newlines
	// must not turn a complete JSON header value into a partial redaction.
	if (/^\s*[[{]/.test(sanitized)) {
		try {
			const parsed: unknown = JSON.parse(sanitized);
			const redact = (value: unknown, key = ""): unknown => {
				if (
					/^(?:authorization|proxy-authorization|password|access_token|api_key|token|secret)$/i.test(
						key,
					)
				)
					return "<redacted>";
				if (Array.isArray(value)) {
					if (key === "argv") return sanitizeScenarioArgv(value.map(String), aliases);
					return value.map((entry) => redact(entry));
				}
				if (value && typeof value === "object")
					return Object.fromEntries(
						Object.entries(value).map(([name, entry]) => [name, redact(entry, name)]),
					);
				return typeof value === "string" ? sanitizeScenarioText(value, aliases) : value;
			};
			const cleaned = redact(parsed);
			if (JSON.stringify(cleaned) !== JSON.stringify(parsed)) return JSON.stringify(cleaned);
			return sanitized;
		} catch {
			/* Ordinary prose/code is not necessarily JSON. */
		}
	}
	return sanitized
		.replace(/(\b(?:proxy-)?authorization\s*[:=]\s*)[^\r\n]+/gi, "$1<redacted>")
		.replace(/((?:password|access_token|api_key)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, "$1<redacted>")
		.replace(/\/(?:Users|home|private|tmp|var)\/[^\s"']+/g, "<private-path>");
}

export function sanitizeScenarioArgv(
	argv: readonly string[],
	aliases: Readonly<Record<string, string>>,
): string[] {
	let credentialValue = false;
	return argv.map((arg) => {
		if (credentialValue) {
			credentialValue = false;
			return "<redacted>";
		}
		if (
			/^--(?:authorization|proxy-authorization|password|access-token|access_token|api-key|api_key|token|secret)$/i.test(
				arg,
			)
		) {
			credentialValue = true;
			return arg;
		}
		if (
			/^--(?:authorization|proxy-authorization|password|access-token|access_token|api-key|api_key|token|secret)=/i.test(
				arg,
			)
		)
			return `${arg.split("=", 1)[0]}=<redacted>`;
		return sanitizeScenarioText(arg, aliases);
	});
}

/** Fail closed: stale/failed/unexecuted captures cannot produce verified commands. */
export function projectScenarioGuide(
	capture: ScenarioCapture,
	current: { source_revision: string; surface: string; surface_revision: string },
): { status: "verified" | "unverified"; reasons: string[]; body: string } {
	const reasons: string[] = [];
	const scenario =
		typeof capture.scenario === "string" &&
		/^[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)*$/.test(capture.scenario) &&
		capture.scenario.length <= 80
			? capture.scenario
			: "Unverified scenario";
	if (scenario === "Unverified scenario") reasons.push("invalid public scenario ID");
	if (capture.state !== "proven") reasons.push("capture was not proven");
	if (
		!capture.test ||
		!capture.implementing_revision ||
		!capture.fixture_revision ||
		!Number.isFinite(Date.parse(capture.tested_at))
	)
		reasons.push("incomplete provenance");
	if (!capture.source_revision || capture.source_revision !== current.source_revision)
		reasons.push("source changed");
	if (
		capture.surface !== current.surface ||
		!capture.surface_revision ||
		capture.surface_revision === "unknown" ||
		current.surface_revision === "unknown" ||
		capture.surface_revision !== current.surface_revision
	)
		reasons.push("surface revision unavailable or stale");
	if (capture.assertions.length === 0 || capture.interactions.length === 0)
		reasons.push("missing captured interaction or independent assertions");
	if (!/^evidence\/[a-z0-9-]+$/.test(capture.evidence_doc))
		reasons.push("missing packaged evidence ID");
	if (
		capture.interactions.some(
			(step) =>
				(!Array.isArray(step.argv) || step.argv.length === 0) &&
				(!step.mcp_request ||
					typeof step.mcp_request.method !== "string" ||
					!step.mcp_request.method.trim()),
		)
	)
		reasons.push("missing captured operation");
	if (
		capture.interactions.some((step) => {
			const transcript = JSON.stringify(step);
			return sanitizeScenarioText(transcript, {}) !== transcript;
		})
	)
		reasons.push("transcript requires redaction");
	const { interactions: _interactions, ...provenance } = capture;
	const serializedProvenance = JSON.stringify(provenance);
	if (sanitizeScenarioText(serializedProvenance, {}) !== serializedProvenance)
		reasons.push("provenance or assertions require redaction");
	if (reasons.length)
		return {
			status: "unverified",
			reasons,
			body: `${scenario}: unverified (${reasons.join("; ")}).`,
		};
	// Never hand-copy argv into a second source. JSON preserves argument boundaries.
	const commands = capture.interactions
		.slice(0, 3)
		.map(
			(step) =>
				`\`\`\`json\n${JSON.stringify({ ...(step.mcp_request ? { mcp_request: step.mcp_request } : { argv: step.argv }), exit_code: step.exit_code })}\n\`\`\``,
		)
		.join("\n\n");
	const evidenceRoute = capture.interactions.some((step) => step.mcp_request)
		? `spellkave_docs with ${JSON.stringify({ doc: capture.evidence_doc, full: true })}`
		: `sk docs ${capture.evidence_doc} --full`;
	return {
		status: "verified",
		reasons,
		body: `${capture.scenario} — verified on ${capture.surface} ${capture.surface_revision}.\n\nTest: ${capture.test}; implementation: ${capture.implementing_revision}; fixture: ${capture.fixture_revision}; source: ${capture.source_revision}; captured: ${capture.tested_at}.\n\n${commands}\n\nFull sanitized interactions and assertions: \`${evidenceRoute}\`.`,
	};
}
