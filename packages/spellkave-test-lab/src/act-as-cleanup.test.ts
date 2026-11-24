// keep-file(K2): injected cleanup faults/admission controls must not mutate a real world.
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { actAsFixtureCleanup } from "./act-as-cleanup";
import { rows } from "./environment-ownership-fixture";
import { applyManifestSource, connectTestWorld, type TestWorld } from "./live";

vi.mock("@spellkave/sdk/node", () => ({ resolveSpacetimeConfigPathToken: vi.fn() }));
vi.mock("./live", () => ({
	connectTestWorld: vi.fn(),
	applyManifestDelta: vi.fn(),
	applyManifestSource: vi.fn(),
}));
vi.mock("./environment-ownership-fixture", async (original) => ({
	...(await original<typeof import("./environment-ownership-fixture")>()),
	rows: vi.fn(),
}));

const bundle = `act41_${"a".repeat(32)}`;
const disconnect = vi.fn();

beforeEach(() => {
	vi.resetAllMocks();
	vi.stubEnv("SPELLKAVE_LOCAL_NODE", "1");
	vi.stubEnv("SPELLKAVE_URL", "http://127.0.0.1:7649");
	vi.mocked(resolveSpacetimeConfigPathToken).mockReturnValue("synthetic-publisher");
	vi.mocked(connectTestWorld).mockResolvedValue({ disconnect } as unknown as TestWorld);
	vi.mocked(rows).mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("AUTH-41 fixture cleanup boundaries", () => {
	it("refuses tracking a foreign bundle before opening a connection", () => {
		expect(() => actAsFixtureCleanup("test").track("core")).toThrow("foreign fixture namespace");
		expect(connectTestWorld).not.toHaveBeenCalled();
	});

	it("refuses remote cleanup before opening a connection", async () => {
		vi.stubEnv("SPELLKAVE_URL", "https://hosted.example");
		const cleanup = actAsFixtureCleanup("test");
		cleanup.track(bundle);
		await expect(cleanup.run()).rejects.toThrow("owned loopback");
		expect(connectTestWorld).not.toHaveBeenCalled();
	});

	it("refuses missing publisher credentials without an anonymous fallback", async () => {
		vi.mocked(resolveSpacetimeConfigPathToken).mockReturnValue(undefined);
		const cleanup = actAsFixtureCleanup("test");
		cleanup.track(bundle);
		await expect(cleanup.run()).rejects.toThrow("publisher credential");
		expect(connectTestWorld).not.toHaveBeenCalled();
	});

	it("surfaces a cleanup refusal and closes its publisher connection", async () => {
		const failure = new Error("fixture retraction refused");
		vi.mocked(applyManifestSource).mockRejectedValue(failure);
		const cleanup = actAsFixtureCleanup("test");
		cleanup.track(bundle);
		await expect(cleanup.run()).rejects.toBe(failure);
		expect(disconnect).toHaveBeenCalledOnce();
	});

	it("fails if cleanup changes a foreign mapping", async () => {
		vi.mocked(rows).mockResolvedValueOnce([
			{ bundle_id: "foreign", manifest_key: "foreign:body", entity_id: 42 },
		]);
		const cleanup = actAsFixtureCleanup("test");
		cleanup.track(bundle);
		await expect(cleanup.run()).rejects.toThrow("changed foreign mappings or bindings");
		expect(disconnect).toHaveBeenCalledOnce();
	});
});
