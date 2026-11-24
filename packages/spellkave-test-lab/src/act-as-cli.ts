/** Real installed CLI, authenticated as the supplied synthetic principal. */
import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { TestWorld } from "./live";

const execute = promisify(execFile);
export async function actAsCli(world: TestWorld, publisherToken: string, command: string[]) {
	const temporary = mkdtempSync(resolve(tmpdir(), "act-as-cli-"));
	try {
		const configPath = process.env.SPACETIME_CONFIG_PATH;
		const built = process.env.SPELLKAVE_CLIENT_BIN ?? process.env.SPELLKAVE_CLI_BIN;
		if (!configPath || !built || !world.token) throw new Error("owned CLI/config/caller missing");
		const config = readFileSync(configPath, "utf8");
		if (!config.includes(publisherToken)) throw new Error("publisher config mismatch");
		const caller = resolve(temporary, "caller.toml");
		writeFileSync(caller, config.replaceAll(publisherToken, world.token), { mode: 0o600 });
		const binary = resolve(temporary, "spellkave");
		copyFileSync(built, binary);
		const argv = [
			"--no-profile",
			"--url",
			process.env.SPELLKAVE_URL!,
			"--db",
			process.env.SPELLKAVE_DB ?? "spellkave-dev",
			...command,
		];
		let result: { code: number; stdout: string; stderr: string };
		try {
			result = {
				code: 0,
				...(await execute(binary, argv, {
					cwd: temporary,
					env: { ...process.env, SPACETIME_CONFIG_PATH: caller, SPELLKAVE_CLI_AS_OWNER: "1" },
				})),
			};
		} catch (error) {
			const failure = error as typeof result;
			if (typeof failure.code !== "number") throw error;
			result = { code: failure.code, stdout: failure.stdout, stderr: failure.stderr };
		}
		return {
			surface: "installed Rust CLI outside checkout",
			argv,
			result,
			publisherFallback: false,
		};
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}
