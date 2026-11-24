import { join } from "node:path";

import type { HostDeps } from "@spellkave/cli-plugin";

const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let index = 0; index < 256; index++) {
		let crc = index << 24;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc << 1) ^ ((crc & 0x80000000) ? 0x04c11db7 : 0);
		}
		table[index] = crc >>> 0;
	}
	return table;
})();

function posixCksum(data: Uint8Array): number {
	let crc = 0;
	const feed = (byte: number) => {
		crc = ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
	};
	for (const byte of data) feed(byte);
	for (let length = data.length; length > 0; length = Math.floor(length / 256)) {
		feed(length & 0xff);
	}
	return ~crc >>> 0;
}

/** Find a development world's existing credentials using its worktree identity. */
export function localNodeIdentity(host: HostDeps) {
	const env = host.env;
	const git = (...args: string[]) => {
		const result = host.run("git", args);
		return result.status === 0 ? result.stdout.trimEnd() || undefined : undefined;
	};
	const worktreeRoot = git("rev-parse", "--show-toplevel");
	if (!worktreeRoot) return undefined;

	const seed = env.SPELLKAVE_NODE_SEED || git("symbolic-ref", "--short", "HEAD") ||
		git("rev-parse", "--short", "HEAD") || "default";
	const port = env.SPACETIME_PORT || String(3000 + posixCksum(new TextEncoder().encode(seed)) % 10000);
	const localDir = env.SPELLKAVE_LOCAL_DIR || join(worktreeRoot, ".local");
	const dataDir = env.SPACETIME_DATA_DIR || join(localDir, "nodes", port);
	return {
		worktreeRoot,
		configPath: join(dataDir, "cli.toml"),
		url: env.SPELLKAVE_URL || `http://127.0.0.1:${port}`,
		db: env.SPELLKAVE_DB || "spellkave-dev",
	};
}
