// When `sk can-i` connects to a live world, its answer also says who asked:
// whether the session reads as the world's publisher and which identity it
// connected as, so an author can tell a real refusal from a wrong login.
// These tests check that those fields stay on the answer next to the can-i
// result, also when the probe fails or the identity is not the publisher.
// A fake connection stands in for the world; no node.
import type { CanIPort } from "@spellkave/tool-authoring";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConnectLive, runCli } from "../cli";
import { collect } from "./helpers";

const verdict = {
	admitted: true,
	checks: [{ label: "resolution", result: "not_run" as const }],
	refusing_check: "",
	failure_kind: "",
	errored_check: "",
	template_id: "core/mark",
	niche_id: "core/mark",
	draws: [],
	repeat_may_differ: false,
	disclosed: true,
};

function connection(fields: { readsAsPublisher: boolean; connectedIdentity: string }): ConnectLive {
	const port: CanIPort = {
		resolveAuthoredEntity: async (key) => (key === "core/hero" ? "1" : "2"),
		probe: async () => ({ kind: "verdict", verdict }),
	};
	return async () => ({
		target: {
			kind: "live",
			resolveRef: () => false,
			lookup: () => [],
			applyBatch: async () => ({ ok: true }),
		},
		canI: port,
		readsAsPublisher: fields.readsAsPublisher,
		connectedIdentity: fields.connectedIdentity,
		close: () => {},
	});
}

beforeEach(() => {
	vi.stubEnv("SPELLKAVE_URL", "http://127.0.0.1:1");
	vi.stubEnv("SPELLKAVE_DB", "publisher-answer");
});
afterEach(() => vi.unstubAllEnvs());

describe("connected author answers", () => {
	it("states a publisher session and keeps the can-i result", async () => {
		const io = collect();
		const code = await runCli(
			[
				"--format",
				"jsonl",
				"can-i",
				"core/cast_mark",
				"--as",
				"core/hero",
				"--target",
				"core/mark",
			],
			io.io,
			connection({ readsAsPublisher: true, connectedIdentity: "aa11" }),
		);
		expect(code).toBe(0);
		const line = JSON.parse(io.out.at(-1) ?? "{}") as Record<string, unknown>;
		expect(line.reads_as_publisher).toBe(true);
		expect(line.connected_identity).toBe("aa11");
		expect(line.note).toBeUndefined();
		expect(line.ok).toBe(true);
	});

	it("keeps the infra exit and the publisher fields when can-i throws", async () => {
		const port: CanIPort = {
			resolveAuthoredEntity: async () => {
				throw new Error("probe transport dropped");
			},
			probe: async () => ({ kind: "verdict", verdict }),
		};
		const io = collect();
		let closed = false;
		const code = await runCli(
			[
				"--format",
				"jsonl",
				"can-i",
				"core/cast_mark",
				"--as",
				"core/hero",
				"--target",
				"core/mark",
			],
			io.io,
			async () => ({
				target: {
					kind: "live",
					resolveRef: () => false,
					lookup: () => [],
					applyBatch: async () => ({ ok: true }),
				},
				canI: port,
				readsAsPublisher: false,
				connectedIdentity: "bb22",
				close: () => {
					closed = true;
				},
			}),
		);
		expect(code).toBe(1);
		expect(closed).toBe(true);
		const line = JSON.parse(io.out.at(-1) ?? "{}") as Record<string, unknown>;
		expect(line.scope).toBe("infra");
		expect(line.reads_as_publisher).toBe(false);
		expect(line.connected_identity).toBe("bb22");
		expect(line.note).toEqual(
			expect.stringContaining("Scoped instance reads use the current role grants"),
		);
		expect(line.note).toEqual(expect.stringContaining("report coverage"));
		expect(String(line.note)).not.toContain("SPELLKAVE_CONNECT_TOKEN");
		expect(String(line.note)).not.toContain("not in this cache");
	});

	it("names a non-publisher identity and keeps the can-i result", async () => {
		const io = collect();
		const code = await runCli(
			[
				"--format",
				"jsonl",
				"can-i",
				"core/cast_mark",
				"--as",
				"core/hero",
				"--target",
				"core/mark",
			],
			io.io,
			connection({ readsAsPublisher: false, connectedIdentity: "bb22" }),
		);
		expect(code).toBe(0);
		const line = JSON.parse(io.out.at(-1) ?? "{}") as Record<string, unknown>;
		expect(line.reads_as_publisher).toBe(false);
		expect(line.connected_identity).toBe("bb22");
		expect(line.note).toEqual(expect.stringContaining("bb22"));
		expect(line.note).toEqual(expect.stringContaining("sk config view"));
		expect(line.ok).toBe(true);
	});
});
