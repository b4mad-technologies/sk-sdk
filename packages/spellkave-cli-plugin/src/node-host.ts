// The real `HostDeps`, over `node:` APIs. Tests pass their own object.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { HostDeps } from "./index.ts";

export function createNodeHost(
	env: Readonly<Record<string, string | undefined>> = process.env,
	cwd: string = process.cwd(),
): HostDeps {
	return {
		cwd,
		env,
		readFile(filePath) {
			try {
				return readFileSync(filePath, "utf8");
			} catch {
				return null;
			}
		},
		exists: (filePath) => existsSync(filePath),
		writeFile(filePath, contents) {
			mkdirSync(path.dirname(filePath), { recursive: true });
			writeFileSync(filePath, contents);
		},
		run(command, args, options) {
			const result = spawnSync(command, [...args], {
				cwd: options?.cwd ?? cwd,
				env: env as NodeJS.ProcessEnv,
				encoding: "utf8",
			});
			if (result.error !== undefined) {
				return { status: 127, stdout: "", stderr: result.error.message };
			}
			return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
		},
		now: () => Date.now(),
	};
}
