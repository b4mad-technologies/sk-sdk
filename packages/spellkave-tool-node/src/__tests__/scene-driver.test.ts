import type { AuthorToolContext } from "@spellkave/tool-authoring";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@spellkave/tool-authoring", () => ({
	createAuthorFacingBoundTools: (context: AuthorToolContext) => [
		{ name: "spellkave_write_rows", execute: (...args: unknown[]) => execute(context, ...args) },
	],
}));
vi.mock("../capability.ts", () => ({ nodeToolCapability: {} }));

import {
	driveManifestScene,
	VerbExecutionError,
	VerbRunnerError,
} from "../authoring/scene-driver.ts";

const call = { toolName: "spellkave_write_rows", label: "actor equipment", params: {} };

describe("scene driver execution", () => {
	beforeEach(() => {
		execute.mockReset();
	});

	// keep(K2): queued Node I/O must run between synchronously completed host-port calls.
	it("services queued I/O between successful synchronous AUTHOR calls", async () => {
		const events: string[] = [];
		execute.mockImplementation((context: AuthorToolContext) => {
			events.push("verb");
			context.workspace.writeToml('schema_version = "1.0.0"\n');
			return { details: { ok: true } };
		});
		const io = new Promise<void>((resolve) => {
			setImmediate(() => {
				events.push("io");
				resolve();
			});
		});
		try {
			await expect(driveManifestScene([call, call])).resolves.toBe('schema_version = "1.0.0"\n');
			expect(events).toEqual(["verb", "io", "verb"]);
			expect(execute).toHaveBeenCalledTimes(2);
		} finally {
			await io;
		}
	});

	it.each([
		new Error("missing description at line 1 column 1992"),
		"transport disconnected",
	])("preserves a thrown cause and identifies the failing step: %s", async (cause) => {
		execute.mockRejectedValue(cause);
		const failure = await driveManifestScene([call]).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(VerbExecutionError);
		expect(failure).not.toBeInstanceOf(VerbRunnerError);
		expect(failure).toMatchObject({ step: call.label, toolName: call.toolName, cause });
		expect((failure as Error).cause).toBe(cause);
		expect((failure as Error).message).toContain("'actor equipment' (spellkave_write_rows)");
		expect(execute).toHaveBeenCalledTimes(1);
	});

	it("keeps returned authoring diagnostics distinct and stops before the next verb", async () => {
		execute.mockResolvedValue({
			details: { ok: false, diagnostics: [{ severity: "fatal", code: "MF-VAL-214" }] },
		});
		await expect(driveManifestScene([call, call])).rejects.toMatchObject({
			name: "VerbRunnerError",
			failureClass: "authoring_rejected",
			errorCode: "MF-VAL-214",
			step: call.label,
			toolName: call.toolName,
		});
		expect(execute).toHaveBeenCalledTimes(1);
	});
});
