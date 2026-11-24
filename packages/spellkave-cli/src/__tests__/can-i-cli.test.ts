// A world author asks `sk can-i <action> --as <body> --target <target>`
// whether a body may act now and which check decides. These tests check the
// command between the shell and the world's admission probe: the same answer
// as `sk tool spellkave_can_i`, refusals that name what is wrong without
// leaking a verdict, and arguments converted to the probe's shape. A fake
// probe stands in for the world; no node.
// Guide: packages/spellkave-world-author/docs/can-i.md.
import type { CanIPort, CanIProbeAnswer } from "@spellkave/tool-authoring";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveCanIPort, mapProcedureResult } from "../can-i-port";
import { type ConnectLive, runCli } from "../cli";
import { collect } from "./helpers";

type CanIVerdict = Extract<CanIProbeAnswer, { kind: "verdict" }>["verdict"];

const verdict: CanIVerdict = {
	admitted: true,
	checks: [{ label: "resolution", result: "not_run" }],
	refusing_check: "",
	failure_kind: "",
	errored_check: "",
	template_id: "core/mark",
	niche_id: "core/mark",
	draws: [],
	repeat_may_differ: false,
	disclosed: true,
};

beforeEach(() => {
	vi.stubEnv("SPELLKAVE_URL", "http://127.0.0.1:1");
	vi.stubEnv("SPELLKAVE_DB", "can-i-test");
});
afterEach(() => vi.unstubAllEnvs());

function connection(port: CanIPort): ConnectLive {
	return async () => ({
		target: {
			kind: "live",
			resolveRef: () => false,
			lookup: () => [],
			applyBatch: async () => ({ ok: true }),
		},
		canI: port,
		readsAsPublisher: true,
		connectedIdentity: "publisher",
		close: () => {},
	});
}

const params = ["core/cast_mark", "--as", "core/hero", "--target", "core/mark"];

describe("can-i command boundary", () => {
	it("accepts the documented authored key and matches explicit tool records", async () => {
		const probe = vi.fn(async (_input: Parameters<CanIPort["probe"]>[0]) => ({
			kind: "verdict" as const,
			verdict,
		}));
		const port: CanIPort = {
			resolveAuthoredEntity: async (key) => (key === "core/hero" ? "1" : "2"),
			probe,
		};
		const shortcut = collect();
		const tool = collect();
		expect(await runCli(["can-i", ...params], shortcut.io, connection(port))).toBe(0);
		expect(await runCli(["tool", "spellkave_can_i", ...params], tool.io, connection(port))).toBe(0);
		expect(shortcut.out).toEqual(tool.out);
		expect(probe).toHaveBeenCalledWith({
			actorId: "1",
			target: { kind: "entity", id: "2" },
			actionId: "core/cast_mark",
			args: {},
		});
	});

	// keep(K1): CLI adapter compatibility for literal JSON arguments, refusal fields and exit codes.
	it.each([
		[undefined, undefined, 0],
		[undefined, "admitted", 2],
		[{ participant_context: "mpc:old" }, undefined, 0],
		[{ participant_context: "mpc:old" }, "admitted", 2],
	] as const)("explains participant refusals without changing inputs or exit (%j, %s)", async (args, expected, code) => {
		const checks = [
			{ label: "declared_participants", result: "refused" as const },
			{ label: "resolution", result: "not_run" as const },
		];
		const probe = vi.fn(async (_input: Parameters<CanIPort["probe"]>[0]) => ({
			kind: "verdict" as const,
			verdict: {
				...verdict,
				admitted: false,
				checks,
				template_id: "",
				niche_id: "",
				refusing_check: "declared_participants",
				failure_kind: "stale_participant_context",
			},
		}));
		const io = collect();
		expect(
			await runCli(
				[
					"can-i",
					...params,
					...(args === undefined ? [] : ["--args", JSON.stringify(args)]),
					...(expected === undefined ? [] : ["--expect", expected]),
				],
				io.io,
				connection({ resolveAuthoredEntity: async () => "1", probe }),
			),
		).toBe(code);
		expect(probe.mock.calls[0]?.[0].args).toEqual(args ?? {});
		const { note, ...legacy } = JSON.parse(io.out[0] ?? "{}").details;
		expect(legacy).toEqual({
			ok: expected === undefined,
			answer: "refused",
			admitted: false,
			checks,
			disclosed: true,
			refusing_check: "declared_participants",
			failure_kind: "stale_participant_context",
			...(expected === undefined ? {} : { expected: "admitted", actual: "refused" }),
		});
		expect(note).toContain("expected_participants");
		expect(note).toContain("participant_context");
		expect(note).toContain("literal");
	});

	it.each([
		[verdict, undefined, 0],
		[verdict, "admitted", 0],
		[
			{
				...verdict,
				admitted: false,
				refusing_check: "select_affordance",
				failure_kind: "capability_not_held",
			},
			undefined,
			0,
		],
		[{ ...verdict, admitted: false, errored_check: "busy", checks: [] }, undefined, 0],
		[{ ...verdict, admitted: false, errored_check: "busy", checks: [] }, "refused", 2],
		[verdict, "refused", 2],
	] as const)("projects answer and expectation to exit %s %s %s", async (answer, expected, code) => {
		const port: CanIPort = {
			resolveAuthoredEntity: async () => "1",
			probe: async () => ({ kind: "verdict", verdict: { ...answer, checks: [...answer.checks] } }),
		};
		const io = collect();
		expect(
			await runCli(
				["can-i", ...params, ...(expected === undefined ? [] : ["--expect", expected])],
				io.io,
				connection(port),
			),
		).toBe(code);
	});

	it("names an unknown authored key without probing", async () => {
		const probe = vi.fn(async (_input: Parameters<CanIPort["probe"]>[0]) => ({
			kind: "verdict" as const,
			verdict,
		}));
		const io = collect();
		expect(
			await runCli(
				["can-i", ...params],
				io.io,
				connection({ resolveAuthoredEntity: async () => null, probe }),
			),
		).toBe(2);
		expect(io.out.join("\n")).toContain("core/hero");
		expect(probe).not.toHaveBeenCalled();
	});
	it("returns no verdict to a refused caller", async () => {
		const io = collect();
		expect(
			await runCli(
				["can-i", ...params],
				io.io,
				connection({
					resolveAuthoredEntity: async () => "1",
					probe: async () => ({ kind: "refused_caller" }),
				}),
			),
		).toBe(2);
		const result = JSON.parse(io.out[0] ?? "{}");
		expect(result.details.cause).toContain("frontier.apply_manifest");
		expect(result.details.checks).toBeUndefined();
	});

	it("parses a structured place target", async () => {
		const probe = vi.fn(async (_input: Parameters<CanIPort["probe"]>[0]) => ({
			kind: "verdict" as const,
			verdict,
		}));
		const io = collect();
		expect(
			await runCli(
				[
					"can-i",
					"core/cast_mark",
					"--as",
					"1",
					"--target",
					'{"kind":"place_node","id":"core/yard"}',
				],
				io.io,
				connection({ resolveAuthoredEntity: async () => null, probe }),
			),
		).toBe(0);
		expect(probe.mock.calls[0]?.[0]).toMatchObject({
			target: { kind: "place_node", id: "core/yard" },
		});
	});

	it("names the remedy when the world is unreachable", async () => {
		const io = collect();
		expect(
			await runCli(["can-i", ...params], io.io, async () => {
				throw new Error("connection refused");
			}),
		).toBe(1);
		expect(io.out.join("\n")).toContain("sk dev up");
	});

	it("converts act arguments before calling the generated procedure", async () => {
		const probeManipulate = vi.fn(async (_input: unknown) => ({ tag: "Errored", value: "busy" }));
		const port = createLiveCanIPort({ conn: { procedures: { probeManipulate } }, db: () => ({}) });
		const answer = await port.probe({
			actorId: "1",
			actionId: "core/respond",
			target: { kind: "entity", id: "2" },
			args: {
				selected_items: [{ binding: "item", item_id: "3", quantity: 1 }],
				dispatch_text: "hello",
				semantic_context: { source_ref: "entity:2", occurrence_id: "4" },
			},
		});
		expect(probeManipulate.mock.calls[0]?.[0]).toMatchObject({
			args: {
				selectedItems: [{ binding: "item", itemId: 3n, quantity: 1 }],
				dispatchText: "hello",
				semanticContext: { sourceRef: "entity:2", occurrenceId: 4n },
			},
		});
		expect(answer).toMatchObject({ kind: "verdict", verdict: { errored_check: "busy" } });
		expect(mapProcedureResult({ tag: "RefusedCaller" })).toEqual({ kind: "refused_caller" });
	});
});
