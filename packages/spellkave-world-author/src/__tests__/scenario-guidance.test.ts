import { describe, expect, it } from "vitest";
import {
	projectScenarioGuide,
	type ScenarioCapture,
	sanitizeScenarioArgv,
	sanitizeScenarioText,
} from "../scenario-guidance";

const capture: ScenarioCapture = {
	scenario: "AUTH-56-01",
	test: "installed consumer proof",
	state: "proven",
	implementing_revision: "commit-a",
	fixture_revision: "fixture-a",
	source_revision: "source-a",
	surface: "installed-cli",
	surface_revision: "artifact-a",
	tested_at: "2026-10-01T00:00:00Z",
	assertions: ["isolated consumer directory unchanged"],
	evidence_doc: "evidence/auth-56-installed-cli",
	interactions: [
		{
			argv: ["docs", "patterns/container-with-loot", "--full"],
			stdout: "synthetic public guide",
			stderr: "",
			exit_code: 0,
		},
	],
};
const current = {
	source_revision: "source-a",
	surface: "installed-cli",
	surface_revision: "artifact-a",
};

describe("scenario capture to guide projection", () => {
	it("derives commands from captured argv and retains test/artifact/fixture identity", () => {
		const result = projectScenarioGuide(capture, current);
		expect(result.status).toBe("verified");
		expect(result.body).toContain(
			JSON.stringify({ argv: capture.interactions[0]?.argv, exit_code: 0 }),
		);
		expect(result.body).toContain("fixture-a");
		expect(result.body).toContain("evidence/auth-56-installed-cli");
		const edited = {
			...capture,
			interactions: [{ ...capture.interactions[0]!, argv: ["docs", "different-example"] }],
		};
		expect(projectScenarioGuide(edited, current).body).toContain("different-example");
		expect(projectScenarioGuide(edited, current).body).not.toContain("container-with-loot");
	});
	it("derives exact MCP requests without executing them and refuses unsafe payloads", () => {
		const mcp_request = {
			method: "tools/call",
			params: { name: "spellkave_docs", arguments: { query: "container loot" } },
		};
		const recorded: ScenarioCapture = {
			...capture,
			surface: "hosted-mcp",
			interactions: [{ mcp_request, stdout: "synthetic result", stderr: "", exit_code: 0 }],
		};
		const context = { ...current, surface: "hosted-mcp" };
		const result = projectScenarioGuide(recorded, context);
		expect(result.status).toBe("verified");
		expect(result.body).toContain(JSON.stringify({ mcp_request, exit_code: 0 }));
		expect(result.body).toContain(
			`spellkave_docs with ${JSON.stringify({ doc: recorded.evidence_doc, full: true })}`,
		);
		expect(result.body).not.toContain("sk docs");
		const unsafe = {
			...recorded,
			interactions: [
				{
					...recorded.interactions[0]!,
					mcp_request: {
						method: "tools/call",
						params: { authorization: "bearer synthetic-short" },
					},
				},
			],
		};
		const refused = projectScenarioGuide(unsafe, context);
		expect(refused.status).toBe("unverified");
		expect(JSON.stringify(refused)).not.toContain("synthetic-short");
	});
	it("refuses a claimed capture with no recorded command or MCP request", () => {
		const missing = { ...capture, interactions: [{ stdout: "answer", stderr: "", exit_code: 0 }] };
		expect(projectScenarioGuide(missing, current).reasons).toContain("missing captured operation");
	});
	it.each([
		"failed",
		"not-run",
		"unencoded",
		"reproduced",
	] as const)("does not promote %s evidence", (state) => {
		const result = projectScenarioGuide({ ...capture, state }, current);
		expect(result.status).toBe("unverified");
		expect(result.body).not.toContain("container-with-loot");
	});
	it("refuses command/example drift, stale surfaces and unknown versions", () => {
		for (const changed of [
			{ ...current, source_revision: "new-command-contract" },
			{ ...current, surface_revision: "artifact-b" },
			{ ...current, surface_revision: "unknown" },
			{ ...current, surface: "hosted-mcp" },
		]) {
			expect(projectScenarioGuide(capture, changed).status).toBe("unverified");
		}
	});
	it("requires independent assertions and executed provenance", () => {
		for (const changed of [
			{ ...capture, assertions: [] },
			{ ...capture, tested_at: "not-executed" },
			{ ...capture, implementing_revision: "" },
		]) {
			expect(projectScenarioGuide(changed, current).status).toBe("unverified");
		}
	});
	it("redacts credentials, private payloads/principals and local paths before publication", () => {
		const raw =
			"Authorization: bearer synthetic-short\npassword=secret /Users/alice/private payload=hidden principal=other-id";
		const sanitized = sanitizeScenarioText(raw, {
			hidden: "<private-payload>",
			"other-id": "<other-principal>",
		});
		expect(sanitized).toBe(
			"Authorization: <redacted>\npassword=<redacted> <private-path> payload=<private-payload> principal=<other-principal>",
		);
		const unsafe = { ...capture, interactions: [{ ...capture.interactions[0]!, stdout: raw }] };
		expect(projectScenarioGuide(unsafe, current).reasons).toContain(
			"transcript requires redaction",
		);
		expect(
			projectScenarioGuide(
				{ ...unsafe, interactions: [{ ...unsafe.interactions[0]!, stdout: sanitized }] },
				current,
			).status,
		).toBe("verified");
	});
	it.each([
		"bearer",
		"Bearer",
		"BEARER",
		"Basic",
	])("PG-3 removes complete %s authorization values before sanitize -> project", (scheme) => {
		const raw = `Authorization: ${scheme} synthetic-short`;
		const nested = JSON.stringify({
			headers: { Authorization: `${scheme} synthetic-short` },
			stdout: JSON.stringify({ authorization: `${scheme} synthetic-short` }),
		});
		for (const text of [raw, nested, `Proxy-Authorization: ${scheme} synthetic-short`]) {
			const sanitized = sanitizeScenarioText(text, {});
			expect(sanitized).not.toContain("synthetic-short");
			expect(sanitizeScenarioText(sanitized, {})).toBe(sanitized);
			const safe = {
				...capture,
				interactions: [{ ...capture.interactions[0]!, stdout: sanitized }],
			};
			expect(projectScenarioGuide(safe, current).status).toBe("verified");
			expect(
				projectScenarioGuide(
					{ ...safe, interactions: [{ ...safe.interactions[0]!, stdout: text }] },
					current,
				).status,
			).toBe("unverified");
		}
		expect(sanitizeScenarioText("Bearer calls a companion", {})).toBe("Bearer calls a companion");
	});
	it("PG-3 redacts separated/equal-form argv credentials and header arguments", () => {
		const argv = [
			"docs",
			"--token",
			"synthetic-short",
			"--api-key=synthetic-key",
			"-H",
			"Authorization: bearer synthetic-header",
		];
		const sanitized = sanitizeScenarioArgv(argv, {});
		expect(sanitized.join(" ")).not.toMatch(/synthetic-(short|key|header)/);
		const unsafe = { ...capture, interactions: [{ ...capture.interactions[0]!, argv }] };
		expect(projectScenarioGuide(unsafe, current).status).toBe("unverified");
		expect(
			projectScenarioGuide(
				{ ...unsafe, interactions: [{ ...unsafe.interactions[0]!, argv: sanitized }] },
				current,
			).status,
		).toBe("verified");
	});
	it("refuses unsanitized non-interaction provenance and assertion text", () => {
		for (const unsafe of [
			{ ...capture, test: "/Users/alice/private/test.ts" },
			{ ...capture, assertions: ["Authorization: bearer synthetic-short"] },
			{ ...capture, fixture_revision: JSON.stringify({ authorization: "bearer synthetic-short" }) },
		]) {
			const result = projectScenarioGuide(unsafe, current);
			expect(result.status).toBe("unverified");
			expect(result.reasons).toContain("provenance or assertions require redaction");
			expect(result.body).not.toMatch(/synthetic-short|alice/);
		}
	});
	it.each([
		"AUTH-56-01",
		"WE-01",
		"WE-10",
		"OTHER.owner-01",
	])("PG-5 preserves owning public scenario ID %s", (scenario) => {
		const result = projectScenarioGuide({ ...capture, scenario }, current);
		expect(result.status).toBe("verified");
		expect(result.body).toContain(scenario);
	});
	it.each([
		"/Users/alice/private/scenario",
		"Authorization: bearer synthetic-short",
		"WE-01\nAuthorization: Basic synthetic-short",
		"A".repeat(81),
	])("PG-5 never serializes unsafe scenario IDs or runtime state: %s", (scenario) => {
		for (const extra of [
			{},
			{ state: "Authorization: bearer synthetic-state", source_revision: "stale", assertions: [] },
		]) {
			const result = projectScenarioGuide(
				{ ...capture, scenario, ...extra } as ScenarioCapture,
				current,
			);
			expect(result.status).toBe("unverified");
			expect(result.reasons).toContain("invalid public scenario ID");
			expect(JSON.stringify(result)).not.toMatch(
				/alice|private\/scenario|Authorization|synthetic-(short|state)/,
			);
			expect(result.body).toMatch(/^Unverified scenario: unverified/);
		}
	});
});
