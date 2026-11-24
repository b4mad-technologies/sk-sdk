// The gateway's status snapshot is written even when the mounted state directory belongs
// to another user, so health checks never go silent; any other write failure still
// surfaces. Uses a mocked fs in its own file so the observability suite keeps the real one.
// Bead: sk-jay0.6.15.31.

// keep-file(K2): injected chmod faults

import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const chmodFailures = new Map<string, NodeJS.ErrnoException>();

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		chmod: async (path: Parameters<typeof actual.chmod>[0], mode: number) => {
			const failure = chmodFailures.get(String(path));
			if (failure !== undefined) {
				throw failure;
			}
			return actual.chmod(path, mode);
		},
	};
});

const { mkdtemp, readFile, rm, stat } = await import("node:fs/promises");
const { createPrivateStatusFileWriter } = await import("../observability.ts");

function errnoError(code: string): NodeJS.ErrnoException {
	const error = new Error(`${code}: operation not permitted`) as NodeJS.ErrnoException;
	error.code = code;
	return error;
}

describe("private status writer on a directory it does not own", () => {
	beforeEach(() => {
		chmodFailures.clear();
	});

	it.each([
		"EPERM",
		"EACCES",
	])("still writes the snapshot when the directory chmod fails with %s", async (code) => {
		const root = await mkdtemp(join(tmpdir(), "spellkave-status-perm-"));
		const directory = join(root, "state");
		const path = join(directory, "status.json");
		chmodFailures.set(directory, errnoError(code));
		try {
			await createPrivateStatusFileWriter(path)({
				v: "player-mcp-status/v1",
				status: "ok",
			});
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
				v: "player-mcp-status/v1",
				status: "ok",
			});
			// The snapshot's privacy is the file mode, and that one is not best-effort.
			expect((await stat(path)).mode & 0o777).toBe(0o600);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("still fails loudly when the directory chmod fails for any other reason", async () => {
		const root = await mkdtemp(join(tmpdir(), "spellkave-status-perm-"));
		const directory = join(root, "state");
		chmodFailures.set(directory, errnoError("EIO"));
		try {
			await expect(
				createPrivateStatusFileWriter(join(directory, "status.json"))({
					v: "player-mcp-status/v1",
					status: "ok",
				}),
			).rejects.toThrow(/EIO/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("still fails loudly when the FILE chmod is refused", async () => {
		const root = await mkdtemp(join(tmpdir(), "spellkave-status-perm-"));
		const directory = join(root, "state");
		const path = join(directory, "status.json");
		chmodFailures.set(`${path}.${process.pid}.tmp`, errnoError("EPERM"));
		try {
			await expect(
				createPrivateStatusFileWriter(path)({ v: "player-mcp-status/v1", status: "ok" }),
			).rejects.toThrow(/EPERM/);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
