/** Installed CLI proof transport; credentials stay in a private temporary config. */
import { execFile } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { TestWorld } from "./live";

const execute = promisify(execFile);
export async function installedSetupCall(
	dm: TestWorld,
	publisherToken: string,
	body: bigint,
	target: string,
	action: string,
	args: Record<string, unknown>,
) {
	const temporary = mkdtempSync(resolve(tmpdir(), "authored-session-cli-"));
	try {
		const path = process.env.SPACETIME_CONFIG_PATH;
		const built = process.env.SPELLKAVE_CLIENT_BIN ?? process.env.SPELLKAVE_CLI_BIN;
		if (!path || !built || !dm.token)
			throw new Error("owned CLI build/config or caller credential unavailable");
		const config = readFileSync(path, "utf8");
		if (!config.includes(publisherToken)) throw new Error("owned CLI config credential mismatch");
		const dmConfig = resolve(temporary, "caller.toml");
		writeFileSync(dmConfig, config.replaceAll(publisherToken, dm.token), { mode: 0o600 });
		const binary = resolve(temporary, "spellkave");
		copyFileSync(built, binary);
		const argv = [
			"--no-profile",
			"--url",
			process.env.SPELLKAVE_URL!,
			"--db",
			process.env.SPELLKAVE_DB!,
			"intent",
			"manipulate",
			`entity:${body}`,
			target,
			action,
			"--args-json",
			JSON.stringify(args),
		];
		let result: { code: number; stdout: string; stderr: string };
		try {
			result = {
				code: 0,
				...(await execute(binary, argv, {
					cwd: temporary,
					env: { ...process.env, SPACETIME_CONFIG_PATH: dmConfig, SPELLKAVE_CLI_AS_OWNER: "1" },
				})),
			};
		} catch (error) {
			const failure = error as typeof result;
			if (typeof failure.code !== "number") throw error;
			result = failure;
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
