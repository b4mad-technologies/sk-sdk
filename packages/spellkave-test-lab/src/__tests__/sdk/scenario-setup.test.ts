import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
	resolveToken: vi.fn(),
	connect: vi.fn(),
	connectWorld: vi.fn(),
	bootstrap: vi.fn(),
	setupDisconnect: vi.fn(),
	sessionDisconnect: vi.fn(),
}));
vi.mock("@spellkave/sdk/node", () => ({ resolveSpacetimeConfigPathToken: harness.resolveToken }));
vi.mock("@spellkave/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@spellkave/sdk")>()),
	connect: harness.connect,
	READER_SCOPED_TABLES: [],
}));
vi.mock("../../live", () => ({
	connectTestWorld: harness.connectWorld,
	ensureApplyManifestAuthority: harness.bootstrap,
	operatorScopeManifest: (_name: string, requiredTables: string[]) => ({ requiredTables }),
}));

import { Scenario } from "./helpers/scenario";

describe("Scenario authorized setup", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.stubEnv("SPELLKAVE_CONNECT_TOKEN", "");
		harness.resolveToken.mockReturnValue("publisher-token");
		harness.connectWorld.mockResolvedValue({ disconnect: harness.setupDisconnect });
		harness.connect.mockResolvedValue({
			ready: Promise.resolve(),
			disconnect: harness.sessionDisconnect,
		});
	});
	afterEach(() => vi.unstubAllEnvs());

	it("retains a new provenance ID in the same tick even when it sorts before the baseline", async () => {
		const rows = [{ provenanceId: "z-old", subjectId: "42", createdAtTick: 7n }];
		harness.connect.mockResolvedValue({
			ready: Promise.resolve(),
			disconnect: harness.sessionDisconnect,
			conn: { db: { visibleEvaluationProvenance: { iter: () => rows } } },
		});
		const scenario = await Scenario.create("same-tick");
		scenario.markProvenanceBaseline();
		rows.push({ provenanceId: "a-new", subjectId: "42", createdAtTick: 7n });
		expect(scenario.provenanceSinceBaseline({ subjectId: "42" }).map((row) => row.id)).toEqual([
			"a-new",
		]);
	});

	it("fails before connecting when no explicit or worktree credential exists", async () => {
		harness.resolveToken.mockReturnValue(undefined);
		await expect(Scenario.create("missing")).rejects.toThrow("source scripts/dev/node-env.sh");
		expect(harness.connectWorld).not.toHaveBeenCalled();
		expect(harness.connect).not.toHaveBeenCalled();
	});

	it("bootstraps with the publisher before opening the same-identity scenario", async () => {
		const scenario = await Scenario.create("cold");
		expect(harness.connectWorld).toHaveBeenCalledWith(
			expect.objectContaining({ token: "publisher-token" }),
		);
		expect(harness.bootstrap).toHaveBeenCalledWith(
			expect.objectContaining({ disconnect: harness.setupDisconnect }),
		);
		expect(harness.bootstrap.mock.invocationCallOrder[0]).toBeLessThan(
			Number(harness.connect.mock.invocationCallOrder[0]),
		);
		expect(harness.setupDisconnect).toHaveBeenCalledOnce();
		expect(harness.connect).toHaveBeenCalledWith(
			expect.objectContaining({
				token: "publisher-token",
				readerManifests: expect.arrayContaining([
					{ requiredTables: ["visible_manifest_authored_entity"] },
				]),
			}),
			expect.anything(),
		);
		await scenario.dispose();
		expect(harness.sessionDisconnect).toHaveBeenCalledOnce();
	});

	it("honors the explicit CI/seeder token without consulting a credential cache", async () => {
		vi.stubEnv("SPELLKAVE_CONNECT_TOKEN", "explicit-token");
		await Scenario.create("explicit");
		expect(harness.resolveToken).not.toHaveBeenCalled();
		expect(harness.connectWorld).toHaveBeenCalledWith(
			expect.objectContaining({ token: "explicit-token" }),
		);
		expect(harness.connect).toHaveBeenCalledWith(
			expect.objectContaining({ token: "explicit-token" }),
			expect.anything(),
		);
	});

	it("disconnects the bootstrap connection on authority rejection and preserves the error", async () => {
		const failure = new Error("MF-APPLY-015");
		harness.bootstrap.mockRejectedValue(failure);
		await expect(Scenario.create("denied")).rejects.toBe(failure);
		expect(harness.setupDisconnect).toHaveBeenCalledOnce();
		expect(harness.connect).not.toHaveBeenCalled();
	});

	it("disconnects the scenario connection when its subscription fails", async () => {
		const failure = new Error("subscription failed");
		harness.connect.mockImplementation(async () => ({
			ready: Promise.reject(failure),
			disconnect: harness.sessionDisconnect,
		}));
		await expect(Scenario.create("subscription")).rejects.toBe(failure);
		expect(harness.sessionDisconnect).toHaveBeenCalledOnce();
	});
});
