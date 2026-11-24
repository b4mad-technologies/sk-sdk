/**
 * The installed CLI's view of an actor's economy channel budget (`spellkave turn inspect <actor>`),
 * for the parity claim "the CLI agrees with the PLAYER projection". A harness read, not an action:
 * a test calls it between probes, on a connection the preceding probe already synced.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ActingBody } from "./claims";
import { liveWorldRef } from "./support";

const TOKEN_ENV = "SPELLKAVE_ECONOMY_PROOF_TOKEN";

function repoRoot(): string {
	let dir = process.cwd();
	for (let depth = 0; depth < 12; depth++) {
		if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
		dir = dirname(dir);
	}
	throw new Error(`could not locate repository root from ${process.cwd()}`);
}

/** The prepared CLI: `SPELLKAVE_CLIENT_BIN`, `SPELLKAVE_CLI_BIN`, or the repo's debug build. */
export function cliBinary(): string {
	const built =
		process.env.SPELLKAVE_CLIENT_BIN ??
		process.env.SPELLKAVE_CLI_BIN ??
		join(repoRoot(), "client", "target", "debug", "spellkave");
	if (!existsSync(built)) {
		throw new Error(
			`the spellkave CLI is missing at ${built}: set SPELLKAVE_CLI_BIN to the prepared client binary (or run \`cargo build --manifest-path client/Cargo.toml --bin spellkave\`)`,
		);
	}
	return built;
}

export interface CliBudgetChannel {
	actor_id: string;
	channel_id: string;
	status: string;
	pool_ms_per_round: string;
	spent_ms: string;
	grant_ms: string;
	remaining_ms?: string;
	current_window_start_ms: string;
}

/** `turn inspect` channel_budget lines of `body`, authenticated as `body`'s own connection. */
export function cliBudget(body: ActingBody, inWorldSelf: string): CliBudgetChannel[] {
	const token = body.world.token;
	if (token === undefined) throw new Error("the connection exposes no credential for the CLI");
	const world = liveWorldRef();
	const home = mkdtempSync(join(tmpdir(), "spellkave-economy-cli-"));
	try {
		const profileDir = join(home, "config", "profiles");
		mkdirSync(profileDir, { recursive: true });
		writeFileSync(
			join(profileDir, "economy-proof.toml"),
			`[connection]\nurl = ${JSON.stringify(world.url)}\ndb = ${JSON.stringify(world.db)}\nenv = "local-proof"\n\n[identity]\nrole = "player"\nin_world_self = ${JSON.stringify(inWorldSelf)}\ncredential = { kind = "env_var", name = ${JSON.stringify(TOKEN_ENV)} }\n`,
		);
		const stdout = execFileSync(
			cliBinary(),
			["--profile", "economy-proof", "turn", "inspect", body.ref],
			{
				cwd: home,
				encoding: "utf8",
				env: { ...process.env, SPELLKAVE_HOME: home, [TOKEN_ENV]: token },
			},
		);
		return stdout
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>)
			.filter((line) => line.kind === "channel_budget")
			.map((line) => ({
				actor_id: String(line.actor),
				channel_id: String(line.channel),
				status: String(line.status),
				pool_ms_per_round: String(line.pool_ms_per_round),
				spent_ms: String(line.spent_ms),
				grant_ms: String(line.grant_ms),
				...(line.remaining_disclosed ? { remaining_ms: String(line.remaining_ms) } : {}),
				current_window_start_ms: String(line.window),
			}))
			.sort((a, b) => a.channel_id.localeCompare(b.channel_id));
	} finally {
		rmSync(home, { recursive: true, force: true });
	}
}

/** The PLAYER projection of the same rows, reduced to the fields the CLI prints. */
export function playerBudget(
	channels: readonly {
		actor_id: string;
		channel_id: string;
		status: string;
		pool_ms_per_round: string;
		spent_ms: string;
		grant_ms: string;
		remaining_ms?: string;
		current_window_start_ms: string;
	}[],
): CliBudgetChannel[] {
	return channels
		.map((row) => ({
			actor_id: row.actor_id,
			channel_id: row.channel_id,
			status: row.status,
			pool_ms_per_round: row.pool_ms_per_round,
			spent_ms: row.spent_ms,
			grant_ms: row.grant_ms,
			...(row.remaining_ms === undefined ? {} : { remaining_ms: row.remaining_ms }),
			current_window_start_ms: row.current_window_start_ms ?? "",
		}))
		.sort((a, b) => a.channel_id.localeCompare(b.channel_id));
}
