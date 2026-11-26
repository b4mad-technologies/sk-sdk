// Player feedback becomes one GitHub issue, deduplicated and free of secrets, and a
// GitHub outage never loses or duplicates a report. If it breaks, maintainers get
// duplicate, leaky or missing issues. Runs against a fake GitHub fetch and a generated
// app key, no network.

// keep-file(K2): fake GitHub fetch

import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	buildFeedbackIssueBody,
	buildFeedbackIssueTitle,
	bundleDedupHash,
	createFeedbackSinkFromEnv,
	createGitHubFeedbackSink,
	createGitHubFeedbackSinkFromAppEnvFile,
	FEEDBACK_ISSUE_LABEL,
	FeedbackSinkError,
	type FeedbackSubmission,
	feedbackIssueLabels,
	handleSpellkaveFeedback,
	mintGitHubAppJwt,
	parseAppEnvFile,
} from "../feedback.ts";
import { MUST_GATHER_BUNDLE_VERSION } from "../must-gather.ts";
import { hashTranscriptSubject } from "../transcript.ts";

const { privateKey } = generateKeyPairSync("rsa", {
	modulusLength: 2048,
	privateKeyEncoding: { type: "pkcs8", format: "pem" },
	publicKeyEncoding: { type: "spki", format: "pem" },
});
const TEST_PEM = privateKey;

const INSTALLATION_TOKEN_PREFIX = "ghs" + "_";
const SAMPLE_TOKEN = INSTALLATION_TOKEN_PREFIX + "x".repeat(36);

function sampleSubmission(overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
	return {
		message: "The exit to the crypt looked walkable but move failed.",
		category: "bug",
		seat: { actor_id: "hero_42", world_slug: "elven-mini" },
		submitted_at: "2026-08-22T16:00:00.000Z",
		bundle: {
			v: MUST_GATHER_BUNDLE_VERSION,
			collected_at: "2026-08-22T16:00:00.000Z",
			world: { slug: "elven-mini", db: "elven-mini" },
			seat: { actor_id: "hero_42", role: "PLAYER" },
			versions: { gateway: "0.0.0", module: "0.0.0" },
			session_status: {},
			run: { run_id: "mcp-1", events_count: 0, events: [] },
			traces_summary: {},
			recent_tool_errors: [],
			timestamps: { collected_at: "2026-08-22T16:00:00.000Z" },
			diagnostics: { size_bytes: 128, truncated: false },
		},
		...overrides,
	};
}

describe("parseAppEnvFile + issue shaping", () => {
	// keep(K1): pure env-file parser and issue formatter
	it("parses KEY=value with comments and export", () => {
		const parsed = parseAppEnvFile(
			[
				"# comment",
				"export GITHUB_REPO=example/repo",
				"APP_ID=4683273",
				"APP_INSTALLATION_ID=155718000",
				'APP_PRIVATE_KEY_FILE="/credentials/feedback-gh-app.pem"',
				"",
			].join("\n"),
		);
		expect(parsed.GITHUB_REPO).toBe("example/repo");
		expect(parsed.APP_ID).toBe("4683273");
		expect(parsed.APP_PRIVATE_KEY_FILE).toBe("/credentials/feedback-gh-app.pem");
	});

	// keep(K1): pure env-file parser and issue formatter
	it("builds title, labels, body with collapsed must-gather details", () => {
		const feedback = sampleSubmission();
		expect(buildFeedbackIssueTitle(feedback)).toBe(
			"feedback(elven-mini): The exit to the crypt looked walkable but move failed.",
		);
		expect(feedbackIssueLabels(feedback)).toEqual([
			FEEDBACK_ISSUE_LABEL,
			"world:elven-mini",
			"seat:hero_42",
		]);
		const body = buildFeedbackIssueBody(feedback);
		expect(body).toContain("<details>");
		expect(body).toContain("spellkave-must-gather/v1");
		expect(body).toContain("do not treat it as an implementation trigger");
		expect(bundleDedupHash(feedback)).toMatch(/^[a-f0-9]{64}$/u);
	});

	// keep(K1): pure env-file parser and issue formatter
	it("renders a `### Client` section ahead of the must-gather details when client_info is present (sk-jay0.5.8)", () => {
		const withoutClient = buildFeedbackIssueBody(sampleSubmission());
		expect(withoutClient).not.toContain("### Client");

		const base = sampleSubmission();
		if (base.bundle === undefined) throw new Error("sampleSubmission() bundle is missing");
		const feedback = sampleSubmission({
			bundle: {
				...base.bundle,
				client_info: {
					viewport: { width: 390, height: 844 },
					layout: { table: "stage", place: "card" },
					trail: [
						{ kind: "layout", id: 1, at: 1000, tick: 40, tile: "table", level: "stage" },
						{ kind: "act", id: 2, at: 1500, tick: 41, tool: "spellkave_communicate" },
					],
				},
			},
		});
		const body = buildFeedbackIssueBody(feedback);
		const clientIndex = body.indexOf("### Client");
		const mustGatherIndex = body.indexOf("must-gather bundle");
		expect(clientIndex).toBeGreaterThan(-1);
		expect(mustGatherIndex).toBeGreaterThan(-1);
		expect(clientIndex).toBeLessThan(mustGatherIndex);
		expect(body).toContain("**Viewport:** 390×844");
		expect(body).toContain("**Layout:** table: stage, place: card");
		expect(body).toContain("client trail (2 entries)");
	});

	// keep(K1): pure env-file parser and issue formatter
	it("renders the RUM run id, sampled flag and a bounded oo timeline command (sk-jay0.6.38.24)", () => {
		const base = sampleSubmission();
		if (base.bundle === undefined) throw new Error("sampleSubmission() bundle is missing");
		const withRum = (rum: unknown) =>
			buildFeedbackIssueBody(
				sampleSubmission({
					bundle: {
						...base.bundle,
						client_info: { viewport: { width: 1, height: 1 }, rum },
					} as never,
				}),
			);
		const runId = "d54646db-291f-4666-b197-54cfb6833c9f";
		const submittedUs = Date.parse("2026-08-22T16:00:00.000Z") * 1000;
		const body = withRum({ run_id: runId, sampled: true });
		expect(body).toContain(`**RUM:** sampled=true, run \`${runId}\``);
		expect(body).toContain(
			`bin/sko11y @otel --start-us ${submittedUs - 86_400_000_000} --end-us ${submittedUs + 600_000_000} rum timeline ${runId}`,
		);
		const unsampled = withRum({ run_id: runId, sampled: false });
		expect(unsampled).toContain("**RUM:** sampled=false");
		expect(unsampled).not.toContain("rum timeline");
		const hostile = withRum({ run_id: "x`; rm -rf /", sampled: true });
		expect(hostile).toContain("**RUM:** sampled=true, no run id");
		expect(hostile).not.toContain("rum timeline");
	});

	// keep(K1): pure env-file parser and issue formatter
	it("renders the hashed subject prefix, never the raw WorkOS user id (sk-0m4.120.19)", () => {
		const subject = "user_01M13FABNDQ7EXAMPLE0000";
		const body = buildFeedbackIssueBody(
			sampleSubmission({ seat: { actor_id: "hero_42", world_slug: "elven-mini", subject } }),
		);
		// Same value the bundle's `seat.subject_prefix` carries (feedback.ts).
		expect(body).toContain(`**Subject prefix:** \`${hashTranscriptSubject(subject)}\``);
		expect(body).not.toContain("user_");
		expect(body).not.toContain(subject.slice(0, 16));
	});

	// keep(K1): pure env-file parser and issue formatter
	it("mints a three-part RS256 JWT without embedding the PEM", () => {
		const jwt = mintGitHubAppJwt("4683273", TEST_PEM, 1_700_000_000);
		const parts = jwt.split(".");
		expect(parts).toHaveLength(3);
		const payloadPart = parts[1] ?? "";
		const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as {
			iss: string;
			iat: number;
			exp: number;
		};
		expect(payload.iss).toBe("4683273");
		expect(payload.exp - payload.iat).toBe(600);
		expect(jwt).not.toContain("PRIVATE KEY");
	});
});

describe("GitHubFeedbackSink (fake fetch)", () => {
	it("mints an installation token and opens a labeled issue with the bundle", async () => {
		const calls: { url: string; init?: RequestInit }[] = [];
		const logs: string[] = [];
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			calls.push({ url, init });
			if (url.endsWith("/access_tokens")) {
				return new Response(JSON.stringify({ token: SAMPLE_TOKEN }), { status: 201 });
			}
			if (url.endsWith("/issues")) {
				const auth = new Headers(init?.headers).get("authorization") ?? "";
				expect(auth).toBe(`Bearer ${SAMPLE_TOKEN}`);
				const body = JSON.parse(String(init?.body)) as {
					title: string;
					body: string;
					labels: string[];
				};
				expect(body.labels).toContain(FEEDBACK_ISSUE_LABEL);
				expect(body.body).toContain("<details>");
				expect(body.title.startsWith("feedback(elven-mini):")).toBe(true);
				return new Response(
					JSON.stringify({
						number: 4242,
						html_url: "https://github.com/example/repo/issues/4242",
					}),
					{ status: 201 },
				);
			}
			return new Response("not found", { status: 404 });
		};

		const sink = createGitHubFeedbackSink({
			config: {
				repo: "example/repo",
				appId: "4683273",
				installationId: "155718000",
				privateKeyPem: TEST_PEM,
			},
			fetch: fetchImpl,
			now: () => 1_700_000_000_000,
			log: (line) => logs.push(line),
		});

		const result = await sink.submit(sampleSubmission());
		expect(result.reference).toBe("https://github.com/example/repo/issues/4242");
		expect(sink.issuesCreated).toBe(1);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toContain("/app/installations/155718000/access_tokens");
		expect(calls[1]?.url).toContain("/repos/example/repo/issues");

		// Token must never appear in sink logs.
		expect(logs.join("\n")).not.toContain(SAMPLE_TOKEN);
		expect(logs.join("\n")).not.toContain(INSTALLATION_TOKEN_PREFIX);
		expect(logs.some((line) => line.includes("issue_opened"))).toBe(true);
	});

	it("dedups by bundle hash within 24h without a second create-issue", async () => {
		let issuePosts = 0;
		const fetchImpl: typeof fetch = async (input) => {
			const url = String(input);
			if (url.endsWith("/access_tokens")) {
				return new Response(JSON.stringify({ token: SAMPLE_TOKEN }), { status: 201 });
			}
			if (url.endsWith("/issues")) {
				issuePosts += 1;
				return new Response(
					JSON.stringify({
						number: 7,
						html_url: "https://github.com/example/repo/issues/7",
					}),
					{ status: 201 },
				);
			}
			return new Response("nope", { status: 404 });
		};
		let t = 1_000;
		const sink = createGitHubFeedbackSink({
			config: {
				repo: "example/repo",
				appId: "1",
				installationId: "2",
				privateKeyPem: TEST_PEM,
			},
			fetch: fetchImpl,
			now: () => t,
		});
		const first = await sink.submit(sampleSubmission());
		t += 60_000;
		const second = await sink.submit(sampleSubmission());
		expect(first.reference).toBe(second.reference);
		expect(issuePosts).toBe(1);
		expect(sink.issuesCreated).toBe(1);
	});

	it("retries create-issue with only feedback when extra labels 422", async () => {
		let issueAttempts = 0;
		const fetchImpl: typeof fetch = async (input, init) => {
			const url = String(input);
			if (url.endsWith("/access_tokens")) {
				return new Response(JSON.stringify({ token: SAMPLE_TOKEN }), { status: 201 });
			}
			if (url.endsWith("/issues")) {
				issueAttempts += 1;
				const body = JSON.parse(String(init?.body)) as { labels: string[] };
				if (body.labels.length > 1) {
					return new Response(JSON.stringify({ message: "Invalid labels" }), {
						status: 422,
					});
				}
				expect(body.labels).toEqual([FEEDBACK_ISSUE_LABEL]);
				return new Response(
					JSON.stringify({
						number: 9,
						html_url: "https://github.com/example/repo/issues/9",
					}),
					{ status: 201 },
				);
			}
			return new Response("nope", { status: 404 });
		};
		const sink = createGitHubFeedbackSink({
			config: {
				repo: "example/repo",
				appId: "1",
				installationId: "2",
				privateKeyPem: TEST_PEM,
			},
			fetch: fetchImpl,
		});
		const result = await sink.submit(sampleSubmission());
		expect(result.reference).toContain("/issues/9");
		expect(issueAttempts).toBe(2);
	});

	it("surfaces ok:false with a reason when GitHub fails (no token leak)", async () => {
		const logs: string[] = [];
		const sink = createGitHubFeedbackSink({
			config: {
				repo: "example/repo",
				appId: "1",
				installationId: "2",
				privateKeyPem: TEST_PEM,
			},
			fetch: async (input) => {
				if (String(input).endsWith("/access_tokens")) {
					return new Response(JSON.stringify({ token: SAMPLE_TOKEN }), { status: 201 });
				}
				return new Response("boom", { status: 500 });
			},
			log: (line) => logs.push(line),
		});
		const result = await handleSpellkaveFeedback(
			{ message: "broken path", include_report: false },
			{ invoke: async () => ({ id: 1, ok: true, result: { content: [] } }) },
			{
				sink,
				resolveSeat: () => ({ actorId: "hero_1", worldSlug: "elven-mini" }),
				now: () => new Date("2026-08-22T16:00:00.000Z"),
			},
		);
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			ok: false,
			error: { code: "feedback_failed" },
		});
		const reason = (result.structuredContent as { reason?: string }).reason ?? "";
		expect(reason).toMatch(/HTTP 500/i);
		expect(reason).not.toContain(SAMPLE_TOKEN);
		expect(logs.join("\n")).not.toContain(SAMPLE_TOKEN);
	});

	it("loads config from an app env file and resolves sibling PEM paths", async () => {
		const dir = await mkdtemp(join(tmpdir(), "sk-feedback-"));
		const pemPath = join(dir, "feedback-gh-app.pem");
		const envPath = join(dir, "feedback-app.env");
		await writeFile(pemPath, TEST_PEM, { mode: 0o600 });
		// Host-style PEM path that does not exist here — sibling fallback must win.
		await writeFile(
			envPath,
			[
				"GITHUB_REPO=example/repo",
				"APP_ID=4683273",
				"APP_INSTALLATION_ID=155718000",
				"APP_PRIVATE_KEY_FILE=/home/nope/.config/spellkave/player-mcp/feedback-gh-app.pem",
				"",
			].join("\n"),
			{ mode: 0o600 },
		);

		const fetchImpl: typeof fetch = async (input) => {
			if (String(input).endsWith("/access_tokens")) {
				return new Response(JSON.stringify({ token: SAMPLE_TOKEN }), { status: 201 });
			}
			return new Response(
				JSON.stringify({
					number: 1,
					html_url: "https://github.com/example/repo/issues/1",
				}),
				{ status: 201 },
			);
		};
		const sink = await createGitHubFeedbackSinkFromAppEnvFile(envPath, { fetch: fetchImpl });
		const result = await sink.submit(sampleSubmission({ bundle: undefined }));
		expect(result.reference).toContain("/issues/1");
	});

	it("createFeedbackSinkFromEnv uses memory when unset and GitHub when set", async () => {
		const memory = await createFeedbackSinkFromEnv({});
		const memRef = await memory.submit(sampleSubmission({ bundle: undefined }));
		expect(memRef.reference).toMatch(/^local-feedback-/);

		const dir = await mkdtemp(join(tmpdir(), "sk-feedback-env-"));
		const pemPath = join(dir, "feedback-gh-app.pem");
		const envPath = join(dir, "feedback-app.env");
		await writeFile(pemPath, TEST_PEM, { mode: 0o600 });
		await writeFile(
			envPath,
			[
				"GITHUB_REPO=example/repo",
				"APP_ID=1",
				"APP_INSTALLATION_ID=2",
				`APP_PRIVATE_KEY_FILE=${pemPath}`,
				"",
			].join("\n"),
			{ mode: 0o600 },
		);
		const sink = await createFeedbackSinkFromEnv(
			{ SPELLKAVE_FEEDBACK_APP_ENV: envPath },
			{
				fetch: async (input) => {
					if (String(input).endsWith("/access_tokens")) {
						return new Response(JSON.stringify({ token: SAMPLE_TOKEN }), {
							status: 201,
						});
					}
					return new Response(
						JSON.stringify({
							html_url: "https://github.com/example/repo/issues/99",
						}),
						{ status: 201 },
					);
				},
			},
		);
		const ref = await sink.submit(sampleSubmission({ bundle: undefined }));
		expect(ref.reference).toContain("/issues/99");
	});

	it("throws FeedbackSinkError on missing env keys", async () => {
		const dir = await mkdtemp(join(tmpdir(), "sk-feedback-bad-"));
		const envPath = join(dir, "feedback-app.env");
		await writeFile(envPath, "APP_ID=1\n", { mode: 0o600 });
		await expect(createGitHubFeedbackSinkFromAppEnvFile(envPath)).rejects.toBeInstanceOf(
			FeedbackSinkError,
		);
	});
});
