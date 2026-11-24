// A world author runs `sk explain role dm` (or a capability, an extent kind,
// a binding) to see what the authored content grants and which bundle
// contributed it. The answer must match the `spellkave_explain` tool, an
// unknown id must exit 2 with the nearest ids, and `--target live` must read
// with the caller's ordinary credentials, never the owner's. A fake
// connection stands in for the live world; no node.
import { createAuthorFacingBoundTools } from "@spellkave/tool-authoring";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ConnectLive, type LiveConnection, runCli } from "../cli";
import { collect } from "./helpers";

afterEach(() => vi.unstubAllEnvs());
describe("sk explain", () => {
	it("shares its structured files answer with the author tool", async () => {
		const { io, out } = collect();
		expect(await runCli(["--no-target", "explain", "role", "dm"], io)).toBe(0);
		const tools = createAuthorFacingBoundTools({
			workspace: { readToml: () => null, writeToml: () => "" },
		});
		const answer = await tools
			.find((t) => t.name === "spellkave_explain")!
			.execute("t", { kind: "role", id: "dm" });
		const result = out.map((line) => JSON.parse(line)).find((row) => row.kind === "explain_result");
		const { kind: _kind, rowKind, ...details } = result;
		expect({ ...details, kind: rowKind }).toEqual((answer as { details: unknown }).details);
	});
	it("unknown ids exit 2 with an authored nearest prefix", async () => {
		const { io, out } = collect();
		expect(await runCli(["--no-target", "explain", "role", "dmm"], io)).toBe(2);
		expect(out.join("\n")).toContain('"nearest_ids":["dm"');
	});
	it("target live connects once with ordinary credentials and never uses an owner read", async () => {
		vi.stubEnv("SPELLKAVE_URL", "http://127.0.0.1:1");
		vi.stubEnv("SPELLKAVE_DB", "explain-test");
		const close = vi.fn();
		const lookup = vi.fn(() => []);
		const connect: ConnectLive = vi.fn(
			async (): Promise<LiveConnection> => ({
				target: {
					kind: "live",
					lookup,
					resolveRef: () => false,
					applyBatch: async () => {
						throw new Error("read only");
					},
				},
				readsAsPublisher: false,
				connectedIdentity: "ordinary",
				close,
			}),
		);
		const { io, out } = collect();
		expect(await runCli(["explain", "role", "dm", "--target", "live"], io, connect)).toBe(2);
		expect(connect).toHaveBeenCalledTimes(1);
		expect(close).toHaveBeenCalledTimes(1);
		expect(lookup).toHaveBeenCalledWith("role_definitions");
		expect(out.join("\n")).toContain('"source":"live"');
	});
	it("accepts a targeted binding inspection and preserves its realised presence instead of choosing another row", async () => {
		vi.stubEnv("SPELLKAVE_URL", "http://127.0.0.1:1");
		vi.stubEnv("SPELLKAVE_DB", "explain-test");
		const identity = "a".repeat(64);
		const connect: ConnectLive = vi.fn(
			async (): Promise<LiveConnection> => ({
				target: {
					kind: "live",
					resolveRef: () => false,
					applyBatch: async () => {
						throw new Error("read only");
					},
					lookup: (kind) =>
						kind === "role_definitions"
							? [
									{
										role_id: "dm",
										bundle_id: "core",
										display_name: "DM",
										description: "",
										capability_ids: ["frontier.read_internal"],
									},
								]
							: kind === "role_bindings"
								? [
										{
											binding_id: "house/chosen",
											role_id: "dm",
											subject: identity,
											extent_ref: "east",
											presence_entity_id: "20",
										},
									]
								: [],
				},
				readsAsPublisher: false,
				connectedIdentity: identity,
				explainDisclosure: { connectedIdentity: identity },
				close: () => {},
			}),
		);
		const { io, out } = collect();
		expect(
			await runCli(["explain", "binding", "house/chosen", "--target", "live"], io, connect),
		).toBe(0);
		expect(
			JSON.parse(out.find((line) => JSON.parse(line).kind === "explain_result")!),
		).toMatchObject({
			rowKind: "binding",
			id: "house/chosen",
			state: "realised",
			definition: { presence_entity_id: "20", extent_ref: "east" },
			identities: [identity],
		});
	});
});
