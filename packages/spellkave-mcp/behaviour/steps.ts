// The sentences of behaviour/*.feature. Each scenario starts the real PLAYER
// MCP gateway (support/gateway.ts: the runtime bundled once by
// support/setup.ts, or bin/spellkave-player-mcp.js for @launcher) against its
// own fake issuer (support/fake-issuer.ts), and talks to it the way a client
// does: one `curl` per request, whose transcript is attached to the report.
// Nothing under src/ is imported. The roster sentences read the canonical
// PLAYER contracts from @spellkave/tool-contracts, the source the gateway
// projects; that is the contract under test, not a copy of it.
//
// curl runs with `-q` (no ~/.curlrc) and an environment of PATH only, so no
// proxy or config of the developer's shell sits between curl and the gateway.

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cliRunner, type Run } from "@spellkave/behaviour/cli";
import { Given, type NarratedWorld, Then, When } from "@spellkave/behaviour/narrate";
import { DOCS_TOOL, PLAYER_TOOL_CONTRACTS, PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import * as allure from "allure-js-commons";
import { After, type DataTable } from "quickpickle";
import { expect } from "vitest";

import { type FakeIssuer, startFakeIssuer } from "./support/fake-issuer.ts";
import { type FakeWorkosUsers, startFakeWorkosUsers } from "./support/fake-workos-users.ts";
import {
	BUNDLE,
	freePort,
	type Gateway,
	gatewayEnv,
	HEALTH_BUNDLE,
	startGateway,
} from "./support/gateway.ts";

for (const bundle of [BUNDLE, HEALTH_BUNDLE]) {
	if (!existsSync(bundle)) {
		throw new Error(
			`no gateway bundle at ${bundle}: run the suite through its globalSetup (pnpm run test:behaviour)`,
		);
	}
}

const FOREIGN_ISSUER = "https://authkit.staging.example.test";
// No spaces in the header values a transcript shows, so its argv reads as typed.
const MCP_ACCEPT = "application/json,text/event-stream";
const PLAYER = "user_player";

/** What curl printed, split into the parts the sentences talk about. */
interface Answer {
	readonly status: number;
	readonly headers: Map<string, string>;
	readonly body: string;
	/** Headers and body as curl printed them, for "never contains" checks. */
	readonly raw: string;
}

type World = NarratedWorld & {
	issuer: FakeIssuer;
	workos?: FakeWorkosUsers;
	gateway?: Gateway;
	token?: string;
	run?: Run;
	answer?: Answer;
	health?: Run;
	/** How the gateway process ended: after SIGTERM, or a refused start. */
	exit?: number | null;
	refused?: Run;
};

async function issuerOf(world: World): Promise<FakeIssuer> {
	world.issuer ??= await startFakeIssuer();
	return world.issuer;
}

function gatewayOf(world: World): Gateway {
	if (!world.gateway) throw new Error("no gateway yet: this step needs `Given the gateway runs`");
	return world.gateway;
}

function answered(world: World): Answer {
	if (!world.answer) throw new Error("no answer yet: this step needs a preceding When");
	return world.answer;
}

After(async (world: World) => {
	if (world.gateway) {
		await world.gateway.stop();
		const log = redact(world, world.gateway.stderr());
		await allure.attachment("gateway log (stderr)", log, "text/plain");
	}
	await world.issuer?.close();
	await world.workos?.close();
});

/** Machine-specific values a reader does not need, as the sentences name them. */
function redactions(world: World): [string, string][] {
	return [
		...(world.token ? [[world.token, "$TOKEN"] as [string, string]] : []),
		...(world.gateway
			? [
					[world.gateway.dir, "<gateway dir>"] as [string, string],
					[world.gateway.origin, "$MCP"] as [string, string],
				]
			: []),
		...(world.issuer ? [[world.issuer.issuer, "$ISSUER"] as [string, string]] : []),
	];
}

function redact(world: World, text: string): string {
	return redactions(world).reduce((out, [value, label]) => out.replaceAll(value, label), text);
}

/** `$MCP` and `$ISSUER` in a sentence or docstring are this scenario's URLs. */
function expand(world: World, text: string): string {
	return text
		.replaceAll("$MCP", gatewayOf(world).origin)
		.replaceAll("$ISSUER", world.issuer.issuer);
}

function parseCurl(raw: string): Answer {
	const split = raw.indexOf("\r\n\r\n");
	const head = split < 0 ? raw : raw.slice(0, split);
	const body = split < 0 ? "" : raw.slice(split + 4);
	const [statusLine = "", ...lines] = head.split("\r\n");
	const headers = new Map<string, string>();
	for (const line of lines) {
		const colon = line.indexOf(":");
		if (colon > 0) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
	}
	return { status: Number(statusLine.split(" ")[1] ?? 0), headers, body, raw };
}

interface Request {
	readonly method: string;
	readonly path: string;
	readonly headers?: Record<string, string>;
	readonly body?: string;
	/** A file whose bytes are the body (for bodies too big for argv). */
	readonly bodyFile?: string;
}

async function send(world: World, request: Request, role?: "setup"): Promise<Answer> {
	const gateway = gatewayOf(world);
	const argv = ["-q", "-s", "-i", "-X", request.method];
	// A big body skips curl's `Expect: 100-continue` round trip: one answer per request.
	const headers =
		request.bodyFile === undefined ? request.headers : { expect: "", ...request.headers };
	for (const [key, value] of Object.entries(headers ?? {}))
		argv.push("-H", value === "" ? `${key}:` : `${key}: ${value}`);
	if (request.body !== undefined) argv.push("--data-binary", request.body);
	if (request.bodyFile !== undefined) argv.push("--data-binary", `@${request.bodyFile}`);
	argv.push(`${gateway.origin}${request.path}`);
	const curl = cliRunner({
		name: "curl",
		bin: "curl",
		cwd: gateway.dir,
		baseEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
		redactions: redactions(world),
	});
	const run = await curl.runAsync(argv);
	await curl.attach(run, role);
	if (run.exit !== 0) throw new Error(`curl failed (exit ${run.exit}): ${run.stderr}`);
	const answer = parseCurl(run.stdout);
	if (role === undefined) {
		world.run = run;
		world.answer = answer;
	}
	return answer;
}

// ---- tokens ------------------------------------------------------------------

type TokenKind =
	| "valid"
	| "for another audience"
	| "that expired"
	| "from another issuer"
	| "signed with a key it never saw"
	| "issued before the sign-out";

async function token(world: World, kind: TokenKind): Promise<string> {
	const issuer = await issuerOf(world);
	const now = Math.floor(Date.now() / 1000);
	const claims = {
		iss: kind === "from another issuer" ? FOREIGN_ISSUER : issuer.issuer,
		aud:
			kind === "for another audience"
				? "https://wrong.example/mcp"
				: `${gatewayOf(world).origin}/mcp`,
		sub: PLAYER,
		// Two minutes old, still valid: older than a sign-out a minute ago.
		iat: kind === "issued before the sign-out" ? now - 120 : now,
		exp: kind === "that expired" ? now - 10 : now + 300,
	};
	world.token = await issuer.sign(claims, { stranger: kind === "signed with a key it never saw" });
	return world.token;
}

function rpc(method: string, params: Record<string, unknown> = {}): string {
	const initialize = {
		protocolVersion: "2025-11-25",
		capabilities: {},
		clientInfo: { name: "behaviour-suite", version: "1.0.0" },
	};
	return JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method,
		params: method === "initialize" ? { ...initialize, ...params } : params,
	});
}

async function mcp(
	world: World,
	method: string,
	options: {
		token?: TokenKind;
		params?: Record<string, unknown>;
		headers?: Record<string, string>;
		path?: string;
		bodyFile?: string;
	} = {},
): Promise<Answer> {
	const bearer = options.token === undefined ? undefined : await token(world, options.token);
	return send(world, {
		method: "POST",
		path: options.path ?? "/mcp",
		headers: {
			accept: MCP_ACCEPT,
			"content-type": "application/json",
			...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
			...options.headers,
		},
		...(options.bodyFile === undefined
			? { body: rpc(method, options.params) }
			: { bodyFile: options.bodyFile }),
	});
}

/** The JSON-RPC reply inside an SSE answer, or the JSON body of any other answer. */
function json(answer: Answer): Record<string, unknown> {
	if (answer.headers.get("content-type")?.includes("text/event-stream")) {
		const data = answer.body
			.split("\n")
			.find((line) => line.startsWith("data: "))
			?.slice("data: ".length);
		if (data === undefined) throw new Error(`SSE answer without data:\n${answer.body}`);
		return JSON.parse(data) as Record<string, unknown>;
	}
	return JSON.parse(answer.body) as Record<string, unknown>;
}

type ToolResult = {
	content: Array<{ type: string; text: string }>;
	isError?: boolean;
	structuredContent?: unknown;
};

function toolResult(world: World): ToolResult {
	const reply = json(answered(world));
	expect(reply.error, JSON.stringify(reply.error)).toBeUndefined();
	return reply.result as ToolResult;
}

function logLines(world: World): Record<string, unknown>[] {
	const stderr = world.gateway?.stderr() ?? world.refused?.stderr ?? "";
	return stderr
		.split("\n")
		.filter((line) => line.startsWith("{"))
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ---- Given: the gateway and its issuer ---------------------------------------

Given("the gateway runs", async (world: World) => {
	world.gateway = await startGateway((await issuerOf(world)).issuer);
});
Given("the deployment allows the origins {string}", async (world: World, hostnames: string) => {
	await world.gateway?.stop();
	world.gateway = await startGateway(world.issuer.issuer, {
		env: { SPELLKAVE_MCP_ALLOWED_ORIGIN_HOSTNAMES: hostnames },
	});
});
Given("the gateway runs from its front door", async (world: World) => {
	world.gateway = await startGateway((await issuerOf(world)).issuer, { launcher: true });
});
Given("the issuer publishes its keys", (world: World) => world.issuer.jwks("keys"));
Given("the issuer publishes no keys", (world: World) => world.issuer.jwks("empty"));
Given("the issuer is down", (world: World) => world.issuer.jwks("down"));
Given("the issuer rotated to a new signing key", (world: World) => world.issuer.rotate());
Given(
	"the gateway has accepted a token signed with the issuer's first key",
	async (world: World) => {
		const bearer = await token(world, "valid");
		const answer = await send(
			world,
			{
				method: "POST",
				path: "/mcp",
				headers: {
					accept: MCP_ACCEPT,
					"content-type": "application/json",
					authorization: `Bearer ${bearer}`,
				},
				body: rpc("tools/list"),
			},
			"setup",
		);
		expect(answer.status).toBe(200);
	},
);

// ---- When: one HTTP request each ---------------------------------------------

function methodAndPath(request: string): { method: string; path: string } {
	const [method = "", path = ""] = request.split(" ");
	return { method, path };
}

When("I send {string}", async (world: World, request: string) => {
	await send(world, methodAndPath(request));
});
When("I send {string} with a valid token", async (world: World, request: string) => {
	const bearer = await token(world, "valid");
	await send(world, { ...methodAndPath(request), headers: { authorization: `Bearer ${bearer}` } });
});
When(
	"I send {string} from {string} anonymously",
	async (world: World, request: string, origin: string) => {
		await send(world, { ...methodAndPath(request), headers: { origin } });
	},
);
When(
	"I send {string} from {string} with a valid token",
	async (world: World, request: string, origin: string) => {
		const bearer = await token(world, "valid");
		await send(world, {
			...methodAndPath(request),
			headers: { origin, authorization: `Bearer ${bearer}` },
		});
	},
);
When(
	"I send {string} from {string} asking for {string}",
	async (world: World, request: string, origin: string, headers: string) => {
		const target = methodAndPath(request);
		await send(world, {
			...target,
			headers: {
				origin,
				"access-control-request-method": target.path.startsWith("/mcp") ? "POST" : "GET",
				"access-control-request-headers": headers,
			},
		});
	},
);
When(
	"I send {string} with the MCP request {string}",
	async (world: World, request: string, method: string) => {
		await mcp(world, method, { path: methodAndPath(request).path });
	},
);
When(
	"I send {string} with the MCP request {string} and a valid token",
	async (world: World, request: string, method: string) => {
		await mcp(world, method, { path: methodAndPath(request).path, token: "valid" });
	},
);
When("I send the MCP request {string} with a valid token", async (world: World, method: string) => {
	await mcp(world, method, { token: "valid" });
});
for (const kind of [
	"for another audience",
	"that expired",
	"from another issuer",
	"signed with a key it never saw",
	"issued before the sign-out",
] as const) {
	When(
		`I send the MCP request {string} with a token ${kind}`,
		async (world: World, method: string) => {
			await mcp(world, method, { token: kind });
		},
	);
}
When(
	"I send the MCP request {string} with a token signed with the new key",
	async (world: World, method: string) => {
		await mcp(world, method, { token: "valid" });
	},
);
When(
	"I send the MCP request {string} with a valid token from {string}",
	async (world: World, method: string, origin: string) => {
		await mcp(world, method, { token: "valid", headers: { origin } });
	},
);
When(
	"I send the MCP request {string} with a valid token as {string}",
	async (world: World, method: string, contentType: string) => {
		await mcp(world, method, { token: "valid", headers: { "content-type": contentType } });
	},
);
When(
	"I send the MCP request {string} with a valid token padded to {int} MiB",
	async (world: World, method: string, mib: number) => {
		const file = join(gatewayOf(world).dir, "padded-request.json");
		writeFileSync(file, rpc(method, { padding: "x".repeat(mib * 1024 * 1024) }));
		await mcp(world, method, { token: "valid", bodyFile: file });
	},
);
When(
	"I call the tool {string} with a valid token and the arguments:",
	async (world: World, name: string, args: string) => {
		await mcp(world, "tools/call", {
			token: "valid",
			params: { name, arguments: JSON.parse(args) },
		});
	},
);

// ---- When: the process -------------------------------------------------------

When("I run the health check", async (world: World) => {
	const gateway = gatewayOf(world);
	const health = cliRunner({
		name: "spellkave-player-mcp-health",
		bin: HEALTH_BUNDLE,
		node: true,
		cwd: gateway.dir,
		baseEnv: gateway.env,
		redactions: redactions(world),
	});
	world.health = await health.runAsync([]);
	await health.attach(world.health);
});
When("I stop the gateway with SIGTERM", async (world: World) => {
	world.exit = await gatewayOf(world).stop();
});
When(
	"I start the gateway with {word} set to {string}",
	async (world: World, setting: string, value: string) => {
		const issuer = await issuerOf(world);
		const dir = mkdtempSync(join(tmpdir(), "player-mcp-behaviour-"));
		const env: Record<string, string> = gatewayEnv(dir, issuer.issuer, await freePort());
		if (value === "") delete env[setting];
		else env[setting] = value;
		const gateway = cliRunner({
			name: "spellkave-player-mcp",
			bin: BUNDLE,
			node: true,
			cwd: dir,
			baseEnv: env,
			redactions: [
				[dir, "<gateway dir>"],
				[issuer.issuer, "$ISSUER"],
			],
		});
		world.refused = await gateway.runAsync([]);
		await gateway.attach(world.refused, undefined, { [setting]: value });
		world.exit = world.refused.exit;
		rmSync(dir, { recursive: true, force: true });
	},
);

// ---- Then: the answer --------------------------------------------------------

Then("the answer is {int}", (world: World, status: number) => {
	expect(answered(world).status, answered(world).raw).toBe(status);
});
Then("the header {string} is {string}", (world: World, name: string, value: string) => {
	expect(answered(world).headers.get(name), answered(world).raw).toBe(value);
});
Then("the header {string} contains {string}", (world: World, name: string, text: string) => {
	expect(answered(world).headers.get(name) ?? "", answered(world).raw).toContain(
		expand(world, text),
	);
});
Then("there is no header {string}", (world: World, name: string) => {
	expect(answered(world).headers.has(name), answered(world).raw).toBe(false);
});
Then("the answer has an {string} header", (world: World, name: string) => {
	expect(answered(world).headers.get(name) ?? "").not.toBe("");
});
Then("the CORS headers are:", (world: World, table: DataTable) => {
	for (const [name = "", value] of table.raw().slice(1))
		expect(answered(world).headers.get(name), name).toBe(value);
});
Then("the answer contains {string}", (world: World, text: string) => {
	expect(answered(world).body).toContain(text);
});
Then("the answer does not contain the token", (world: World) => {
	expect(answered(world).raw).not.toContain(world.token ?? "no token sent");
});
Then("the JSON answer is:", (world: World, expected: string) => {
	expect(json(answered(world))).toEqual(JSON.parse(expand(world, expected)));
});
Then("the JSON answer has {string} {string}", (world: World, key: string, value: string) => {
	expect(json(answered(world))[key], answered(world).raw).toBe(value);
});
Then("the error description contains {string}", (world: World, text: string) => {
	expect(String(json(answered(world)).error_description)).toContain(expand(world, text));
});
Then(
	"the answer is one {string} event with the JSON-RPC reply to id {int}",
	(world: World, event: string, id: number) => {
		const lines = answered(world).body.split("\n");
		expect(lines.filter((line) => line.startsWith("event: "))).toEqual([`event: ${event}`]);
		expect(lines.filter((line) => line.startsWith("data: "))).toHaveLength(1);
		expect(json(answered(world))).toMatchObject({ jsonrpc: "2.0", id });
	},
);

// ---- Then: MCP results -------------------------------------------------------

Then("the MCP server is {string}", (world: World, name: string) => {
	expect(json(answered(world)).result).toMatchObject({ serverInfo: { name } });
});
Then("its instructions mention each of:", (world: World, table: DataTable) => {
	const { instructions } = json(answered(world)).result as { instructions?: string };
	// Whole words: "session" must not pass on "no_session" alone.
	const word = (phrase: string) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	for (const [phrase = ""] of table.raw().slice(1))
		expect(instructions ?? "").toMatch(new RegExp(`\\b${word(phrase)}\\b`, "i"));
});

type ListedTool = {
	name: string;
	title?: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
	_meta?: Record<string, unknown>;
};
const listed = (world: World) =>
	(json(answered(world)).result as { tools: ListedTool[] }).tools ?? [];

Then(
	"the tools are the docs tool, the PLAYER contracts in order, and {string}",
	(world: World, gatewayTool: string) => {
		expect(PLAYER_TOOL_NAMES).not.toContain(gatewayTool);
		expect(listed(world).map(({ name }) => name)).toEqual([
			DOCS_TOOL,
			...PLAYER_TOOL_NAMES,
			gatewayTool,
		]);
	},
);
Then(
	"each PLAYER tool carries its contract's title, description, schema and prompt hints",
	(world: World) => {
		const byName = new Map(listed(world).map((tool) => [tool.name, tool]));
		for (const contract of PLAYER_TOOL_CONTRACTS) {
			const tool = byName.get(contract.name);
			expect(tool, contract.name).toBeDefined();
			expect(tool?.title, contract.name).toBe(contract.label);
			expect(tool?.description, contract.name).toBe(contract.description);
			expect(tool?.inputSchema, contract.name).toEqual(contract.parameters);
			expect(tool?._meta?.["spellkave/promptSnippet"], contract.name).toEqual(
				contract.promptSnippet,
			);
			expect(tool?._meta?.["spellkave/promptGuidelines"], contract.name).toEqual(
				contract.promptGuidelines,
			);
		}
	},
);
Then("the tool answers without an error", (world: World) => {
	expect(toolResult(world).isError, answered(world).body).not.toBe(true);
});
Then("the tool's only text is {string}", (world: World, text: string) => {
	expect(toolResult(world).content).toEqual([{ type: "text", text }]);
});
Then(
	"the docs answer names the document {string} with compatibility {string}",
	(world: World, rel: string, compatibility: string) => {
		const docs = JSON.parse(toolResult(world).content[0]?.text ?? "{}");
		expect(docs.doc).toMatchObject({
			rel,
			metadata: { document_id: rel, compatibility },
		});
	},
);
Then("the MCP answer is a tool error saying {string}", (world: World, text: string) => {
	const result = toolResult(world);
	expect(result.isError).toBe(true);
	expect(result.content[0]?.text).toContain(text);
});
Then(
	"the MCP answer is JSON-RPC error {int} saying {string}",
	(world: World, code: number, text: string) => {
		const reply = json(answered(world)) as { error?: { code: number; message: string } };
		expect(reply.error?.code).toBe(code);
		expect(reply.error?.message).toContain(text);
	},
);

// ---- Then: the process and its log -------------------------------------------

Given(
	"WorkOS records that the player signed out everywhere {int} seconds ago",
	async (world: World, ago: number) => {
		world.workos = await startFakeWorkosUsers();
		world.workos.metadata.set(PLAYER, {
			logout_after: String(Math.floor(Date.now() / 1000) - ago),
		});
		// The deployed gateway holds WORKOS_API_KEY (the `workos` Secret).
		await world.gateway?.stop();
		world.gateway = await startGateway((await issuerOf(world)).issuer, {
			env: { WORKOS_API_KEY: world.workos.apiKey, WORKOS_API_BASE_URL: world.workos.url },
		});
	},
);

Then("WorkOS was asked about the player {int} time(s)", (world: World, times: number) => {
	expect(world.workos?.lookups.get(PLAYER) ?? 0).toBe(times);
});

Then("the issuer served its keys {int} times", (world: World, times: number) => {
	expect(world.issuer.requests.filter(({ path }) => path === "/oauth2/jwks")).toHaveLength(times);
});
Then("the health check exits with {int}", (world: World, code: number) => {
	expect(world.health?.exit, world.health?.stderr).toBe(code);
});
Then("the gateway exits with {int}", (world: World, code: number) => {
	expect(world.exit, world.refused?.stderr ?? world.gateway?.stderr()).toBe(code);
});
Then("the gateway logged {string}", (world: World, text: string) => {
	expect(world.refused?.stderr ?? gatewayOf(world).stderr()).toContain(text);
});
Then(
	"the gateway logged one {string} line, for reason {string}",
	(world: World, event: string, reason: string) => {
		const lines = logLines(world).filter((line) => line.event === event);
		expect(lines).toEqual([expect.objectContaining({ reason, issuer: world.issuer.issuer })]);
	},
);
Then(
	"the gateway logged an {string} line for this answer with:",
	(world: World, kind: string, table: DataTable) => {
		const id = answered(world).headers.get("x-request-id");
		const line = logLines(world).find((row) => row.kind === kind && row.correlation_id === id);
		expect(line, `no ${kind} line with correlation_id ${id}`).toBeDefined();
		for (const [field = "", value] of table.raw().slice(1))
			expect(String(line?.[field]), field).toBe(value);
	},
);
Then("the gateway's log does not contain {string}", (world: World, text: string) => {
	expect(gatewayOf(world).stderr()).not.toContain(text);
});
Then("the gateway's log does not contain the token", (world: World) => {
	expect(gatewayOf(world).stderr()).not.toContain(world.token ?? "no token sent");
});
