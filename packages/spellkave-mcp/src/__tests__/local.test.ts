// A player runs the local stdio MCP and gets the same tools as the hosted gateway, with
// identity taken from a persona profile on disk. If it breaks, local play differs from
// hosted play or binds the wrong hero. In-process client with injected gh and worktree
// profiles; the live half needs a staged adventure on this worktree's node
// (SPELLKAVE_LOCAL_NODE, `just play-stage <adventure>`). Bead: sk-jay0.7.170.

// keep-file(K2): the local stdio MCP through an in-process client, injected gh and worktree profiles; its binary needs a staged node

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DOCS_TOOL, PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { SPELLKAVE_FEEDBACK_TOOL } from "../feedback.ts";
import {
	createGhFeedbackSink,
	createLocalFeedbackSink,
	createLocalPlayerMcp,
	LOCAL_PLAYER_MCP_SERVER_NAME,
	LOCAL_PLAYER_PROFILE_ENV,
	LocalPlayerMcpUsageError,
	resolveLocalPlayerBinding,
	withJsonlFallback,
} from "../local.ts";
import { PLAYER_MCP_INITIALIZE_INSTRUCTIONS } from "../tools.ts";

const TOKEN = "test-token-abc";

function fakeWorktree(profiles: Record<string, string> = {}): string {
	const root = mkdtempSync(join(tmpdir(), "sk-player-mcp-local-"));
	mkdirSync(join(root, ".git"));
	mkdirSync(join(root, ".local", "profiles"), { recursive: true });
	const tokenPath = join(root, ".local", "token");
	writeFileSync(tokenPath, `${TOKEN}\n`, { mode: 0o600 });
	for (const [name, actor] of Object.entries(profiles)) {
		writeFileSync(
			join(root, ".local", "profiles", `${name}.toml`),
			[
				"[connection]",
				'url = "http://127.0.0.1:4242"',
				'db = "spellkave-test"',
				"",
				"[identity]",
				'role = "player"',
				`in_world_self = "${actor}"`,
				"",
				"[identity.credential]",
				'kind = "file"',
				`path = "${tokenPath}"`,
				"",
			].join("\n"),
		);
	}
	return root;
}

const cleanups: string[] = [];
afterEach(() => {
	for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("resolveLocalPlayerBinding", () => {
	it("takes the single worktree profile when none is named", () => {
		const root = fakeWorktree({ hero: "7" });
		cleanups.push(root);
		const resolved = resolveLocalPlayerBinding({ worktreeRoot: root, env: {} });
		expect(resolved.profileName).toBe("hero");
		expect(resolved.binding).toEqual({
			url: "http://127.0.0.1:4242",
			db: "spellkave-test",
			// sha256 of the token, never the token — same derivation as `sk`.
			identity: expect.stringMatching(/^[0-9a-f]{64}$/),
			actorId: "7",
		});
		expect(resolved.binding.identity).not.toContain(TOKEN);
		expect(resolved.token).toBe(TOKEN);
	});

	it("needs a name when several worktree profiles exist, from the flag or the env", () => {
		const root = fakeWorktree({ hero: "7", sidekick: "9" });
		cleanups.push(root);
		expect(() => resolveLocalPlayerBinding({ worktreeRoot: root, env: {} })).toThrow(
			LocalPlayerMcpUsageError,
		);
		expect(
			resolveLocalPlayerBinding({ worktreeRoot: root, profileName: "sidekick", env: {} }).binding
				.actorId,
		).toBe("9");
		expect(
			resolveLocalPlayerBinding({
				worktreeRoot: root,
				env: { [LOCAL_PLAYER_PROFILE_ENV]: "hero" },
			}).binding.actorId,
		).toBe("7");
	});

	it("names `just play-stage` when the worktree has no profile at all", () => {
		const root = fakeWorktree();
		cleanups.push(root);
		expect(() => resolveLocalPlayerBinding({ worktreeRoot: root, env: {} })).toThrow(
			/just play-stage/,
		);
	});
});

describe("createLocalPlayerMcp", () => {
	it("serves the hosted roster plus spellkave_feedback over a test client", async () => {
		const root = fakeWorktree({ hero: "7" });
		cleanups.push(root);
		const calls: string[] = [];
		const { server, resolved, feedbackPath } = await createLocalPlayerMcp({
			worktreeRoot: root,
			env: {},
			attach: async () => ({
				invoke: async (tool) => {
					calls.push(tool);
					return {
						ok: true,
						result: { content: [{ type: "text", text: `${tool} ok` }] },
					} as never;
				},
			}),
		});
		expect(resolved.binding.actorId).toBe("7");
		expect(feedbackPath).toBe(join(root, ".local", "player-mcp-local", "feedback.jsonl"));
		const lowLevel = (server as unknown as { server: { _instructions?: string } }).server;
		expect(lowLevel._instructions).toBe(PLAYER_MCP_INITIALIZE_INSTRUCTIONS);
		const registered = (server as unknown as { _registeredTools: Record<string, unknown> })
			._registeredTools;
		expect(Object.keys(registered).sort()).toEqual(
			[DOCS_TOOL, ...PLAYER_TOOL_NAMES, SPELLKAVE_FEEDBACK_TOOL].sort(),
		);
	});

	it("appends feedback submissions to the worktree JSONL sink", async () => {
		const root = fakeWorktree();
		cleanups.push(root);
		const sink = createLocalFeedbackSink(root);
		const reference = await sink.submit({
			message: "the torch cannot be picked up",
			seat: { actor_id: "7" },
			submitted_at: "2026-09-25T00:00:00.000Z",
		});
		expect(reference.reference).toBe(`local:${sink.path}#1`);
	});
});

describe("createGhFeedbackSink", () => {
	it("files the hosted issue shape through gh with a local provenance section", async () => {
		const seen: string[][] = [];
		const sink = createGhFeedbackSink(
			"example/repo",
			{ worktreeRoot: "/wt", url: "http://127.0.0.1:11502", db: "spellkave-dev" },
			async (args) => {
				seen.push([...args]);
				return "https://github.com/example/repo/issues/1\n";
			},
		);
		const { reference } = await sink.submit({
			message: "the torch cannot be picked up",
			category: "bug",
			seat: { actor_id: "1", world_slug: "kavemouth-local" },
			submitted_at: "2026-09-25T00:00:00.000Z",
		});
		expect(reference).toBe("https://github.com/example/repo/issues/1");
		expect(seen[0]?.slice(0, 3)).toEqual(["label", "create", "feedback:local"]);
		const args = seen[1] as string[];
		expect(args.slice(0, 4)).toEqual(["issue", "create", "--repo", "example/repo"]);
		expect(args[args.indexOf("--title") + 1]).toBe(
			"feedback(kavemouth-local): the torch cannot be picked up",
		);
		const body = args[args.indexOf("--body") + 1] as string;
		expect(body).toMatch(/## Player feedback/);
		expect(body).toMatch(/### Local provenance/);
		expect(body).toMatch(/127\.0\.0\.1:11502 db=spellkave-dev/);
		const labels = args.filter((_, i) => args[i - 1] === "--label");
		expect(labels).toEqual(["feedback", "world:kavemouth-local", "seat:1", "feedback:local"]);
	});

	it("retries with the guaranteed labels when world:/seat: labels do not exist", async () => {
		const seen: string[][] = [];
		const sink = createGhFeedbackSink(
			"example/repo",
			{ worktreeRoot: "/wt", url: "u", db: "d" },
			async (args) => {
				seen.push([...args]);
				if (args[0] === "issue" && args.includes("world:kavemouth-local")) {
					throw new Error("could not add label: 'world:kavemouth-local' not found");
				}
				return "https://github.com/example/repo/issues/2";
			},
		);
		const { reference } = await sink.submit({
			message: "x",
			seat: { actor_id: "1", world_slug: "kavemouth-local" },
			submitted_at: "2026-09-25T00:00:00.000Z",
		});
		expect(reference).toBe("https://github.com/example/repo/issues/2");
		const retry = seen[2] as string[];
		expect(retry.filter((_, i) => retry[i - 1] === "--label")).toEqual([
			"feedback",
			"feedback:local",
		]);
	});

	it("falls back to the JSONL sink when gh fails", async () => {
		const root = fakeWorktree();
		cleanups.push(root);
		const jsonl = createLocalFeedbackSink(root);
		const sink = withJsonlFallback(
			createGhFeedbackSink(
				"example/repo",
				{ worktreeRoot: root, url: "u", db: "d" },
				async () => {
					throw new Error("gh: not logged in");
				},
			),
			jsonl,
		);
		const { reference } = await sink.submit({
			message: "x",
			seat: { actor_id: "1" },
			submitted_at: "2026-09-25T00:00:00.000Z",
		});
		expect(reference).toBe(`local:${jsonl.path}#1`);
	});

	it("rejects a repo that is not owner/name", () => {
		expect(() =>
			createGhFeedbackSink("spellkave", { worktreeRoot: "/wt", url: "u", db: "d" }, async () => ""),
		).toThrow(LocalPlayerMcpUsageError);
	});
});

// --- live half: a real stdio process against this worktree's staged node -----

const LIVE = process.env.SPELLKAVE_LOCAL_NODE === "1";
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

function rpc(id: number, method: string, params: unknown = {}): string {
	return `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`;
}

describe.skipIf(!LIVE)("bin/sk-player-mcp against the staged node (SPELLKAVE_LOCAL_NODE=1)", () => {
	it("initializes, lists the hosted roster and reads the persona's scene", async () => {
		const child = spawn(join(REPO_ROOT, "bin", "sk-player-mcp"), [], {
			cwd: REPO_ROOT,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		const lines: string[] = [];
		let buffer = "";
		child.stdout.on("data", (chunk: Buffer) => {
			buffer += chunk.toString();
			const parts = buffer.split("\n");
			buffer = parts.pop() ?? "";
			lines.push(...parts.filter((line) => line.trim().length > 0));
		});
		const waitFor = (id: number): Promise<Record<string, unknown>> =>
			new Promise((resolve, reject) => {
				const deadline = Date.now() + 60_000;
				const tick = (): void => {
					for (const line of lines) {
						const message = JSON.parse(line) as Record<string, unknown>;
						if (message.id === id) {
							resolve(message);
							return;
						}
					}
					if (Date.now() > deadline) {
						reject(new Error(`no response for id ${id}; stderr: ${stderr}`));
						return;
					}
					setTimeout(tick, 100);
				};
				tick();
			});
		try {
			child.stdin.write(
				rpc(1, "initialize", {
					protocolVersion: "2025-06-18",
					capabilities: {},
					clientInfo: { name: "local.test", version: "0" },
				}),
			);
			child.stdin.write(
				`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
			);
			const init = (await waitFor(1)).result as {
				serverInfo: { name: string };
				instructions: string;
			};
			expect(init.serverInfo.name).toBe(LOCAL_PLAYER_MCP_SERVER_NAME);
			expect(init.instructions).toBe(PLAYER_MCP_INITIALIZE_INSTRUCTIONS);

			child.stdin.write(rpc(2, "tools/list"));
			const tools = ((await waitFor(2)).result as { tools: Array<{ name: string }> }).tools.map(
				(tool) => tool.name,
			);
			expect(tools).toEqual([DOCS_TOOL, ...PLAYER_TOOL_NAMES, SPELLKAVE_FEEDBACK_TOOL]);

			child.stdin.write(rpc(3, "tools/call", { name: "spellkave_scene", arguments: {} }));
			const scene = (await waitFor(3)).result as {
				content: Array<{ type: string; text?: string }>;
				isError?: boolean;
			};
			expect(scene.isError).not.toBe(true);
			expect(scene.content[0]?.text).toMatch(/"node_id"/);
			expect(stderr).toMatch(/spellkave-player-mcp-local: profile '/);
		} finally {
			child.kill();
		}
	}, 90_000);
});
