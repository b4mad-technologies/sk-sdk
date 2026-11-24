/** Rehearse the actual local MCP executable using a disposable caller profile. */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionDaemonClient, socketPath } from "@spellkave/session/node";
import { resolveLocalPlayerBinding } from "../local";

interface Reply {
	id: number;
	result?: {
		serverInfo?: { name: string };
		tools?: { name: string }[];
		isError?: boolean;
		structuredContent?: Record<string, unknown>;
	};
	error?: { message: string };
}
export async function rehearseLocalStdio(options: {
	profile: string;
	body: string;
	token: string;
	runtimeDir: string;
	bindingId: string;
	source: object;
	capture: (call: unknown) => void;
}) {
	const root = fileURLToPath(new URL("../../../../", import.meta.url));
	const profile = resolve(root, ".local/profiles", `${options.profile}.toml`);
	const credential = resolve(options.runtimeDir, "local-caller-token");
	mkdirSync(resolve(root, ".local/profiles"), { recursive: true });
	writeFileSync(credential, options.token, { mode: 0o600 });
	writeFileSync(
		profile,
		`[connection]\nurl=${JSON.stringify(process.env.SPELLKAVE_URL)}\ndb=${JSON.stringify(process.env.SPELLKAVE_DB)}\n[identity]\nrole="player"\nin_world_self="${options.body}"\n[identity.credential]\nkind="file"\npath=${JSON.stringify(credential)}\n`,
		{ mode: 0o600 },
	);
	const env = {
		...process.env,
		XDG_RUNTIME_DIR: options.runtimeDir,
		SPELLKAVE_RUN_EVENTS: "off",
		SPELLKAVE_FEEDBACK_GH_REPO: "",
	};
	const binding = resolveLocalPlayerBinding({
		worktreeRoot: root,
		profileName: options.profile,
		env,
	}).binding;
	const child = spawn(resolve(root, "bin/sk-player-mcp"), ["--profile", options.profile], {
		cwd: root,
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const exited = new Promise<void>((done) => child.once("exit", () => done()));
	const pending = new Map<number, (reply: Reply) => void>();
	let buffer = "",
		sequence = 0;
	child.stderr.on("data", () => {}); // Do not publish private startup diagnostics.
	child.stdout.on("data", (chunk) => {
		buffer += String(chunk);
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";
		for (const line of lines.filter(Boolean)) {
			const reply = JSON.parse(line) as Reply;
			pending.get(reply.id)?.(reply);
		}
	});
	async function send(method: string, params: object = {}) {
		const body = { jsonrpc: "2.0", id: ++sequence, method, params };
		const request = JSON.stringify(body) + "\n",
			at = Date.now();
		const response = await new Promise<Reply>((done, reject) => {
			const timer = setTimeout(() => {
				pending.delete(body.id);
				reject(new Error(`local MCP response missing: ${method}`));
			}, 15_000);
			pending.set(body.id, (value) => {
				clearTimeout(timer);
				pending.delete(body.id);
				done(value);
			});
			child.stdin.write(request);
		});
		options.capture({
			surface: "local stdio MCP Claude Code contract",
			principal: "presence-author",
			request: body,
			response,
			requestBytes: Buffer.byteLength(request),
			responseBytes: Buffer.byteLength(JSON.stringify(response) + "\n"),
			elapsedMs: Date.now() - at,
		});
		return response;
	}
	try {
		const initialized = await send("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "authority-proof", version: "1" },
		});
		child.stdin.write(
			JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n",
		);
		const listed = await send("tools/list");
		const selected = await send("tools/call", {
			name: "spellkave_acting_context",
			arguments: { binding_id: options.bindingId },
		});
		const applied = await send("tools/call", {
			name: "spellkave_applyset_apply",
			arguments: { source: options.source },
		});
		return { initialized, listed, selected, applied };
	} finally {
		await new SessionDaemonClient({ socketPath: socketPath(binding, env), spawned: true })
			.shutdown()
			.catch(() => {});
		child.kill();
		await exited;
		rmSync(profile, { force: true });
		rmSync(credential, { force: true });
	}
}
