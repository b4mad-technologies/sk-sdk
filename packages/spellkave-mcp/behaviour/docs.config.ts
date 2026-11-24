// What the PLAYER MCP gateway's behaviour suite tells the document generators
// of @spellkave/behaviour. The gateway is an HTTP service, not a CLI: its
// "commands" are its two programs and the routes a client calls. There is no
// route registry in src/ to read them from (gateway.ts dispatches on paths
// inline), so the list below is written here, and the scenarios that drive
// each route prove it. This file imports nothing from src/ (ADR-0156 D-4).
// A recipe sentence (`I send "GET /healthz"`, `I send the MCP request
// "tools/list"`) becomes the request it sends; `verbOf` files a usage line and
// a recorded run (`curl … $MCP/<path>`, as steps.ts attaches it) under one
// route, so the command table counts the scenarios that called each route.
import { defineDocs } from "@spellkave/behaviour/docs";

/** The route a path belongs to: `/transcripts/<slug>` and `/w/<slug>/…` are one route each. */
function routeOf(path: string): string {
	const bare = path.split("?")[0] ?? path;
	for (const prefix of ["/.well-known/", "/transcripts/", "/w/"])
		if (bare.startsWith(prefix)) return prefix;
	return bare;
}

export default defineDocs({
	// The generators count a scenario under a command by the runs whose name
	// starts with `binary`. A client uses this service through curl, and the
	// steps attach every request as a curl run, so curl is the binary here.
	binary: "curl",
	title: "PLAYER MCP gateway",
	tagline:
		"The hosted Remote MCP server for players (`mcp.spellkave.com`): an OAuth protected resource in front of the canonical PLAYER tool registry, with the public modding docs, public transcripts and world map tiles beside it.",
	commands: () => [
		{
			usage: "spellkave-player-mcp",
			what: "Start the gateway; the configuration is the environment (`SPELLKAVE_MCP_*`, `WORKOS_ISSUER`, `SPELLKAVE_WORLD_CATALOG`). Logs `spellkave-player-mcp: ready (trust-boundary=…)` and then one JSON operations line per request on stderr; SIGTERM stops it cleanly (through the tsx launcher the exit code is 143, bead sk-jay0.6.116).",
		},
		{
			usage: "spellkave-player-mcp-health",
			what: "The container health check: exit 0 when `GET /healthz` answers 200, else 1.",
		},
		{
			usage: "POST /mcp",
			what: "Stateless Streamable HTTP MCP (JSON-RPC in, one server-sent event out). Needs `Authorization: Bearer <AuthKit access token>`.",
		},
		{
			usage: "GET /.well-known/oauth-protected-resource[/mcp]",
			what: "RFC 9728 protected-resource metadata: the issuer to log in at and the scopes.",
		},
		{ usage: "GET /healthz", what: "Readiness, redacted: `ok` or `unavailable`." },
		{
			usage: "GET /transcripts/<slug>",
			what: "A public world's transcript (JSONL), for logged-in spectators.",
		},
		{
			usage: "GET /w/<slug>/…",
			what: "Map tiles, TileJSON, style and the OSM API 0.6 of a catalog world, for logged-in map clients from any origin.",
		},
	],
	commandsNote:
		"HTTP answers: `401` with a `WWW-Authenticate` challenge for a missing or untrusted token, `403` for an origin outside the allowlist, `404` for a route or world that does not exist (the Account API included: it is `api.spellkave.com`), `413`/`415` for a body a client should not send. The process exits `1` with the setting named on stderr when its configuration is refused.",
	commandOf: (sentence) => {
		const request = sentence.match(/I send "([^"]*)"/)?.[1];
		if (request !== undefined) return request;
		const mcp = sentence.match(/I send the MCP request "([^"]*)"/)?.[1];
		if (mcp !== undefined) return `POST /mcp ${mcp}`;
		const tool = sentence.match(/I call the tool "([^"]*)"/)?.[1];
		if (tool !== undefined) return `POST /mcp tools/call ${tool}`;
		if (/I run the health check/.test(sentence)) return "spellkave-player-mcp-health";
		if (/I start the gateway/.test(sentence)) return "spellkave-player-mcp";
		return undefined;
	},
	verbOf: (command) => {
		const run = command.match(/\$MCP(\/\S*)$/)?.[1];
		if (run !== undefined) return routeOf(run);
		const usage = command.match(/^[A-Z]+ (\/\S*)/)?.[1];
		if (usage !== undefined) return routeOf(usage);
		return command.split(" ")[0] ?? command;
	},
	features: [
		"contract.feature",
		"login.feature",
		"play.feature",
		"browser.feature",
		"operate.feature",
	],
	design: ["src/runtime.ts", "src/gateway.ts", "src/http.ts", "src/tools.ts"],
	suite: [
		"vitest.behaviour.config.ts",
		"behaviour/steps.ts",
		"behaviour/support/gateway.ts",
		"behaviour/support/fake-issuer.ts",
	],
	watched: ["packages/spellkave-mcp", "packages/spellkave-behaviour"],
});
