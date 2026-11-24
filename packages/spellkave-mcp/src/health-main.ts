import { request } from "node:http";

import { PLAYER_MCP_DEFAULT_HOST, PLAYER_MCP_DEFAULT_PORT } from "./runtime.ts";

const origin = process.env.SPELLKAVE_MCP_CANONICAL_ORIGIN;
if (origin === undefined || origin.trim() === "") {
	process.stderr.write("SPELLKAVE_MCP_CANONICAL_ORIGIN is required\n");
	process.exit(1);
}
const publicHostname = new URL(origin).hostname;
const port = Number(process.env.SPELLKAVE_MCP_LISTEN_PORT ?? PLAYER_MCP_DEFAULT_PORT);
const probe = request(
	{
		host: process.env.SPELLKAVE_MCP_LISTEN_HOST ?? PLAYER_MCP_DEFAULT_HOST,
		port,
		path: "/healthz",
		method: "GET",
		headers: { host: publicHostname },
		timeout: 3_000,
	},
	(response) => {
		response.resume();
		process.exit(response.statusCode === 200 ? 0 : 1);
	},
);
probe.once("timeout", () => probe.destroy(new Error("health request timed out")));
probe.once("error", () => process.exit(1));
probe.end();
