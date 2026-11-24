import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { RecordIo } from "./output.ts";

export async function prepareAuthoring(io: RecordIo): Promise<number> {
	const root = fileURLToPath(new URL("../../..", import.meta.url));
	const generator = fileURLToPath(new URL("../../../scripts/generate-authoring-corpus.ts", import.meta.url));
	if (!existsSync(generator)) {
		throw new Error("sk authoring prepare requires an sk-sdk source checkout with dependencies installed");
	}
	const args = [generator, "--prepare"];
	const ok = await new Promise<boolean>((resolve, reject) => {
		const child = spawn(process.execPath, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
		for (const stream of [child.stdout, child.stderr]) {
			stream.on("data", (chunk: Buffer) => io.err(chunk.toString("utf8").trimEnd()));
		}
		child.once("error", reject);
		child.once("close", (code) => resolve(code === 0));
	});
	io.record({ kind: "authoring_step", phase: "generate", command: ["node", "scripts/generate-authoring-corpus.ts", "--prepare"], ok });
	return ok ? 0 : 1;
}
