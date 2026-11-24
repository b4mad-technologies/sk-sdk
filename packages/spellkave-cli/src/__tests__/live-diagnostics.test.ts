// Exercise the production CLI connector's SDK diagnostic callback. The SDK
// double emits connection metadata, then refuses the transport so the same
// call also proves failure diagnostics, stdout, and exit status stay intact.
import { connect } from "@spellkave/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_USAGE, runCli } from "../cli.ts";
import { collect } from "./helpers.ts";

vi.mock("@spellkave/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@spellkave/sdk")>()),
	connect: vi.fn(),
}));

describe("CLI live connection diagnostics", () => {
	beforeEach(() => {
		vi.stubEnv("SPELLKAVE_URL", "http://127.0.0.1:4001");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	async function connectWithDiagnostic(diagnostic: object) {
		const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.mocked(connect).mockImplementation(async (args) => {
			if (args.onDiagnostic) args.onDiagnostic(diagnostic);
			else console.warn(JSON.stringify(diagnostic));
			throw new Error("transport refused after schema inspection");
		});
		const io = collect();
		const code = await runCli(["--live", "apply_manifest_delta", "--toml", "irrelevant"], io.io);
		expect(code).toBe(EXIT_USAGE);
		expect(io.out).toHaveLength(1);
		expect(JSON.parse(io.out[0] as string)).toMatchObject({
			kind: "error",
			scope: "infra",
			message: "transport refused after schema inspection",
		});
		return warnings.mock.calls.map((call) => call[0]);
	}

	// keep(K1): exercise the SDK callback shape and failure boundary independently of transport timing.
	it("silences known additive metadata without losing the connection failure", async () => {
		const warnings = await connectWithDiagnostic({
			kind: "binding_drift_additive",
			additions: {
				tables: Array.from({ length: 300 }, (_, index) => `additional_table_${index}`),
				reducers: Array.from({ length: 200 }, (_, index) => `additional_reducer_${index}`),
			},
		});
		expect(warnings).toEqual([]);
	});

	// keep(K1): enumerate unknown diagnostic shapes that must remain visible.
	it.each([
		{
			kind: "binding_drift_failure",
			missing: { tables: ["entity"] },
			detail: "required name absent",
		},
		{
			kind: "binding_drift_additive",
			additions: { tables: ["extra"], reducers: [] },
			detail: "new metadata",
		},
		{
			kind: "binding_drift_additive",
			additions: { tables: ["extra"], reducers: [], warnings: ["review"] },
		},
		{ kind: "binding_drift_additive", additions: { tables: ["extra"], reducers: "invalid" } },
	])("preserves unrecognized diagnostic metadata: $kind", async (diagnostic) => {
		expect(await connectWithDiagnostic(diagnostic)).toEqual([JSON.stringify(diagnostic)]);
	});
});
