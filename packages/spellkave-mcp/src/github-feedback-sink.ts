/**
 * GitHub Issues FeedbackSink (sk-rax8.6).
 *
 * Mints a 1 h GitHub App installation token (RS256 JWT dance ported from
 * a retired helper) and opens one
 * issue per submission. Never logs tokens or PEMs.
 */
import { createHash, createSign } from "node:crypto";
import { access, constants, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { FeedbackSink, FeedbackSubmission } from "./feedback.ts";
import { FEEDBACK_RUM_RUN_ID_PATTERN } from "./feedback-constants.ts";
import { hashTranscriptSubject } from "./transcript.ts";

export const FEEDBACK_ISSUE_LABEL = "feedback" as const;
export const GITHUB_API_BASE = "https://api.github.com";
export const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Safe-to-surface sink failure (no secrets). */
export class FeedbackSinkError extends Error {
	readonly publicMessage: string;

	constructor(publicMessage: string, cause?: unknown) {
		super(publicMessage);
		this.name = "FeedbackSinkError";
		this.publicMessage = publicMessage;
		if (cause !== undefined) {
			(this as Error & { cause?: unknown }).cause = cause;
		}
	}
}

export interface GitHubFeedbackAppConfig {
	readonly repo: string; // owner/name
	readonly appId: string;
	readonly installationId: string;
	readonly privateKeyPem: string;
}

export interface GitHubFeedbackSinkOptions {
	readonly config: GitHubFeedbackAppConfig;
	/** Injectable fetch for unit tests (no network). */
	readonly fetch?: typeof fetch;
	readonly apiBase?: string;
	readonly now?: () => number;
	/** Optional logger — must never receive tokens. */
	readonly log?: (line: string) => void;
	readonly dedupWindowMs?: number;
}

export interface GitHubFeedbackSink extends FeedbackSink {
	/** Test/inspection: how many create-issue HTTP calls succeeded. */
	readonly issuesCreated: number;
}

function b64urlJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** RS256 JWT for GitHub App authentication (iat backdated 60s, exp +540s). */
export function mintGitHubAppJwt(
	appId: string,
	privateKeyPem: string,
	nowSec: number = Math.floor(Date.now() / 1000),
): string {
	const header = b64urlJson({ alg: "RS256", typ: "JWT" });
	const payload = b64urlJson({
		iat: nowSec - 60,
		exp: nowSec + 540,
		iss: appId,
	});
	const unsigned = `${header}.${payload}`;
	const signer = createSign("RSA-SHA256");
	signer.update(unsigned);
	signer.end();
	const signature = signer.sign(privateKeyPem).toString("base64url");
	return `${unsigned}.${signature}`;
}

export async function mintInstallationToken(
	config: GitHubFeedbackAppConfig,
	options: {
		fetch?: typeof fetch;
		apiBase?: string;
		now?: () => number;
	} = {},
): Promise<string> {
	const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
	const apiBase = options.apiBase ?? GITHUB_API_BASE;
	const nowSec = Math.floor((options.now ?? Date.now)() / 1000);
	const jwt = mintGitHubAppJwt(config.appId, config.privateKeyPem, nowSec);
	const url = `${apiBase}/app/installations/${config.installationId}/access_tokens`;
	let response: Response;
	try {
		response = await fetchImpl(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${jwt}`,
				Accept: "application/vnd.github+json",
				"X-GitHub-Api-Version": "2022-11-28",
			},
		});
	} catch (cause) {
		throw new FeedbackSinkError("GitHub installation token request failed", cause);
	}
	if (!response.ok) {
		throw new FeedbackSinkError(`GitHub installation token mint returned HTTP ${response.status}`);
	}
	const body = (await response.json()) as { token?: unknown };
	if (typeof body.token !== "string" || body.token.trim() === "") {
		throw new FeedbackSinkError("GitHub installation token response missing token");
	}
	return body.token;
}

function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

/** Parse KEY=value env files (comments + optional export/quotes). */
export function parseAppEnvFile(content: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const rawLine of content.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("#")) continue;
		const cleaned = line.replace(/^export\s+/u, "");
		const eq = cleaned.indexOf("=");
		if (eq <= 0) continue;
		const key = cleaned.slice(0, eq).trim();
		let value = cleaned.slice(eq + 1);
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

async function resolvePrivateKeyPath(configured: string, appEnvPath: string): Promise<string> {
	const expanded = expandHome(configured);
	try {
		await access(expanded, constants.R_OK);
		return expanded;
	} catch {
		// Container mounts env + PEM as siblings under /credentials/ while the
		// host-staged env still names the host PEM path — fall back to sibling.
		const sibling = join(dirname(appEnvPath), basename(expanded));
		try {
			await access(sibling, constants.R_OK);
			return sibling;
		} catch {
			throw new FeedbackSinkError(`feedback App private key unreadable at ${basename(expanded)}`);
		}
	}
}

export async function loadGitHubFeedbackAppConfig(
	appEnvPath: string,
): Promise<GitHubFeedbackAppConfig> {
	let content: string;
	try {
		content = await readFile(appEnvPath, "utf8");
	} catch (cause) {
		throw new FeedbackSinkError(`feedback App env unreadable at ${basename(appEnvPath)}`, cause);
	}
	const env = parseAppEnvFile(content);
	const repo = (env.GITHUB_REPO ?? "").trim();
	const appId = (env.APP_ID ?? "").trim();
	const installationId = (env.APP_INSTALLATION_ID ?? "").trim();
	const keyFile = (env.APP_PRIVATE_KEY_FILE ?? "").trim();
	if (repo === "" || !repo.includes("/")) {
		throw new FeedbackSinkError("feedback App env missing GITHUB_REPO=owner/name");
	}
	if (appId === "") throw new FeedbackSinkError("feedback App env missing APP_ID");
	if (installationId === "") {
		throw new FeedbackSinkError("feedback App env missing APP_INSTALLATION_ID");
	}
	if (keyFile === "") {
		throw new FeedbackSinkError("feedback App env missing APP_PRIVATE_KEY_FILE");
	}
	const pemPath = await resolvePrivateKeyPath(keyFile, appEnvPath);
	let privateKeyPem: string;
	try {
		privateKeyPem = await readFile(pemPath, "utf8");
	} catch (cause) {
		throw new FeedbackSinkError("feedback App private key read failed", cause);
	}
	if (!privateKeyPem.includes("PRIVATE KEY")) {
		throw new FeedbackSinkError("feedback App private key file is not a PEM");
	}
	return { repo, appId, installationId, privateKeyPem };
}

function firstChars(message: string, max: number): string {
	const oneLine = message.replace(/\s+/gu, " ").trim();
	if (oneLine.length <= max) return oneLine;
	return `${oneLine.slice(0, max - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const RUM_RUN_ID = new RegExp(FEEDBACK_RUM_RUN_ID_PATTERN, "u");
/** RUM rows of the reported run lie before the submission; one day back covers a long session. */
const RUM_LOOKBACK_US = 24 * 60 * 60 * 1_000_000;
const RUM_LOOKAHEAD_US = 10 * 60 * 1_000_000;

/** RUM linkage lines (sk-jay0.6.38.24): sampled flag, run id, and a ready
 * `sko11y` command whose absolute window brackets the submission time, so it
 * still works after the default one-hour window has passed. */
function rumMarkdown(rum: unknown, submittedAt: string): string[] {
	if (!isRecord(rum)) return ["**RUM:** (not reported)"];
	const sampled = rum.sampled === true;
	const runId =
		typeof rum.run_id === "string" && RUM_RUN_ID.test(rum.run_id) ? rum.run_id : undefined;
	if (runId === undefined) return [`**RUM:** sampled=${sampled}, no run id`];
	const lines = [`**RUM:** sampled=${sampled}, run \`${runId}\``];
	const submittedMs = Date.parse(submittedAt);
	if (!sampled || Number.isNaN(submittedMs)) return lines;
	const startUs = submittedMs * 1000 - RUM_LOOKBACK_US;
	const endUs = submittedMs * 1000 + RUM_LOOKAHEAD_US;
	return [
		...lines,
		"",
		"```bash",
		`bin/sko11y @otel --start-us ${startUs} --end-us ${endUs} rum timeline ${runId}`,
		"```",
	];
}

/** Markdown for `bundle.client_info` (sk-jay0.5.8), or `undefined` when the
 * feedback carried no client section — kept separate from the collapsed
 * must-gather `<details>` block below so a reviewer sees it without expanding
 * anything. Loosely typed and defensive throughout: `client_info` is
 * `Record<string, unknown>` on the bundle, shaped by Play's own
 * `feedback.ts`, not guaranteed here beyond what the gateway's schema
 * enforced on the way in. */
function clientSectionMarkdown(clientInfo: Record<string, unknown>, submittedAt: string): string[] {
	const viewport = isRecord(clientInfo.viewport) ? clientInfo.viewport : undefined;
	const viewportText =
		viewport !== undefined
			? `${String(viewport.width ?? "?")}×${String(viewport.height ?? "?")}`
			: "(unknown)";
	const layout = isRecord(clientInfo.layout) ? clientInfo.layout : undefined;
	const layoutText =
		layout !== undefined && Object.keys(layout).length > 0
			? Object.entries(layout)
					.map(([tile, level]) => `${tile}: ${String(level)}`)
					.join(", ")
			: "(none)";
	const trail = Array.isArray(clientInfo.trail) ? clientInfo.trail : [];
	return [
		"### Client",
		"",
		`**Viewport:** ${viewportText}`,
		`**Layout:** ${layoutText}`,
		...rumMarkdown(clientInfo.rum, submittedAt),
		"",
		"<details>",
		`<summary>client trail (${trail.length} ${trail.length === 1 ? "entry" : "entries"})</summary>`,
		"",
		"```json",
		JSON.stringify(trail, null, 2),
		"```",
		"",
		"</details>",
		"",
	];
}

export function buildFeedbackIssueTitle(feedback: FeedbackSubmission): string {
	const world =
		feedback.seat.world_slug?.trim() || feedback.bundle?.world.slug?.trim() || "unknown";
	return `feedback(${world}): ${firstChars(feedback.message, 60)}`;
}

export function buildFeedbackIssueBody(feedback: FeedbackSubmission): string {
	const lines: string[] = [
		"## Player feedback",
		"",
		`**Category:** ${feedback.category ?? "(none)"}`,
		`**World:** ${feedback.seat.world_slug ?? feedback.bundle?.world.slug ?? "(unknown)"}`,
		`**Seat actor_id:** \`${feedback.seat.actor_id}\``,
		// sk-0m4.120.19: the hashed prefix — the same value the bundle's
		// `seat.subject_prefix` carries — never the raw WorkOS `user_…` id,
		// which would land in a public issue.
		feedback.seat.subject !== undefined
			? `**Subject prefix:** \`${hashTranscriptSubject(feedback.seat.subject)}\``
			: undefined,
		`**Submitted at:** ${feedback.submitted_at}`,
		"",
		"### Message",
		"",
		feedback.message,
		"",
	].filter((line): line is string => line !== undefined);

	if (feedback.bundle !== undefined) {
		if (feedback.bundle.client_info !== undefined) {
			lines.push(...clientSectionMarkdown(feedback.bundle.client_info, feedback.submitted_at));
		}
		const json = JSON.stringify(feedback.bundle, null, 2);
		lines.push(
			"<details>",
			"<summary>must-gather bundle (spellkave-must-gather/v1)</summary>",
			"",
			"```json",
			json,
			"```",
			"",
			"</details>",
			"",
		);
	} else {
		lines.push("_No must-gather bundle attached (`include_report=false`)._", "");
	}

	lines.push(
		"---",
		"_Opened by the PLAYER MCP `spellkave_feedback` tool (sk-feedback App).",
		"Label `feedback` records product feedback; do not treat it as an implementation trigger._",
	);
	return lines.join("\n");
}

export function feedbackIssueLabels(feedback: FeedbackSubmission): string[] {
	const labels: string[] = [FEEDBACK_ISSUE_LABEL];
	const world = feedback.seat.world_slug?.trim() || feedback.bundle?.world.slug?.trim();
	if (world !== undefined && world !== "") {
		// GitHub label names: keep short + filesystem-safe.
		const worldLabel = `world:${world}`.slice(0, 50);
		labels.push(worldLabel);
	}
	const seat = feedback.seat.actor_id.trim();
	if (seat !== "" && seat !== "unresolved") {
		labels.push(`seat:${seat}`.slice(0, 50));
	}
	return labels;
}

export function bundleDedupHash(feedback: FeedbackSubmission): string {
	const payload =
		feedback.bundle !== undefined
			? JSON.stringify(feedback.bundle)
			: JSON.stringify({
					message: feedback.message,
					category: feedback.category ?? null,
					seat: feedback.seat,
				});
	return createHash("sha256").update(payload).digest("hex");
}

export function createGitHubFeedbackSink(options: GitHubFeedbackSinkOptions): GitHubFeedbackSink {
	const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
	const apiBase = options.apiBase ?? GITHUB_API_BASE;
	const now = options.now ?? Date.now;
	const log = options.log ?? ((line: string) => console.error(line));
	const dedupWindowMs = options.dedupWindowMs ?? DEDUP_WINDOW_MS;
	const dedup = new Map<string, { reference: string; expiresAt: number }>();
	let issuesCreated = 0;

	const prune = (t: number) => {
		for (const [key, entry] of dedup) {
			if (entry.expiresAt <= t) dedup.delete(key);
		}
	};

	return {
		get issuesCreated() {
			return issuesCreated;
		},
		async submit(feedback) {
			const t = now();
			prune(t);
			const hash = bundleDedupHash(feedback);
			const hit = dedup.get(hash);
			if (hit !== undefined && hit.expiresAt > t) {
				log(`feedback_sink dedup hit reference=${hit.reference}`);
				return { reference: hit.reference };
			}

			const token = await mintInstallationToken(options.config, {
				fetch: fetchImpl,
				apiBase,
				now,
			});

			const title = buildFeedbackIssueTitle(feedback);
			const body = buildFeedbackIssueBody(feedback);
			const labels = feedbackIssueLabels(feedback);
			const [owner, repo, ...rest] = options.config.repo.split("/");
			if (
				owner === undefined ||
				repo === undefined ||
				rest.length > 0 ||
				owner === "" ||
				repo === ""
			) {
				throw new FeedbackSinkError("feedback App GITHUB_REPO must be owner/name");
			}
			const url = `${apiBase}/repos/${owner}/${repo}/issues`;

			const postIssue = async (issueLabels: string[]): Promise<Response> => {
				try {
					return await fetchImpl(url, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${token}`,
							Accept: "application/vnd.github+json",
							"Content-Type": "application/json",
							"X-GitHub-Api-Version": "2022-11-28",
						},
						body: JSON.stringify({ title, body, labels: issueLabels }),
					});
				} catch (cause) {
					throw new FeedbackSinkError("GitHub create-issue request failed", cause);
				}
			};

			let response = await postIssue(labels);
			// world:/seat: labels may not exist yet — retry with the required label only.
			if (response.status === 422 && labels.length > 1) {
				response = await postIssue([FEEDBACK_ISSUE_LABEL]);
			}
			if (!response.ok) {
				log(`feedback_sink create_issue_failed status=${response.status}`);
				throw new FeedbackSinkError(`GitHub create-issue returned HTTP ${response.status}`);
			}
			const created = (await response.json()) as {
				html_url?: unknown;
				number?: unknown;
			};
			const reference =
				typeof created.html_url === "string" && created.html_url.trim() !== ""
					? created.html_url.trim()
					: typeof created.number === "number"
						? `${options.config.repo}#${created.number}`
						: `${options.config.repo}#(unknown)`;

			issuesCreated += 1;
			dedup.set(hash, { reference, expiresAt: t + dedupWindowMs });
			// Log only non-secret identifiers.
			log(`feedback_sink issue_opened reference=${reference} labels=${FEEDBACK_ISSUE_LABEL}`);
			return { reference };
		},
	};
}

export async function createGitHubFeedbackSinkFromAppEnvFile(
	appEnvPath: string,
	options: Omit<GitHubFeedbackSinkOptions, "config"> = {},
): Promise<GitHubFeedbackSink> {
	const config = await loadGitHubFeedbackAppConfig(appEnvPath);
	return createGitHubFeedbackSink({ ...options, config });
}
