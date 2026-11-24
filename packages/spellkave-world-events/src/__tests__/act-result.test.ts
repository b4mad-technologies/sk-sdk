import { describe, expect, it } from "vitest";
import { type ActPlayerResult, classifyActResult, renderActResultLine } from "../act-result.ts";

const MANIPULATE_GAP =
	"Nothing you can perceive changed, and this action has no narrative of its own.";
const SENSE_GAP = "This action has no narrative of its own.";
const COMMUNICATE_GAP =
	"No spoken utterance was supplied (pass `utterance` to speak aloud); communicate outcomes carry no authored per-action narrative otherwise.";
const UNKNOWN_HANDLE_REASON =
	"Handle is not present in the current affordance cache; call spellkave_affordance_targets or spellkave_affordance_actions for a fresh one.";
const AMBIGUOUS_HANDLE_REASON =
	"Handle matches more than one current affordance; call spellkave_affordance_targets or spellkave_affordance_actions and choose an unambiguous action.";
const DEFECT = "The world answered, but this client cannot render it.";
const QUIET = "Nothing you notice changes.";

function dispatched(
	verb: "manipulate" | "communicate" | "sensing",
	outcome: "accepted" | "rejected" | "unobserved" | "travelling",
	inner: Record<string, unknown>,
	rest: Record<string, unknown> = {},
): Record<string, unknown> {
	const verbKey = verb === "sensing" ? "sense" : verb;
	return {
		receipt: {
			status: "dispatched",
			verb_class: verb,
			handle: "h1",
			outcome,
			[verbKey]: inner,
		},
		...rest,
	};
}

const cases: Array<{
	name: string;
	input: unknown;
	kind: ActPlayerResult["kind"];
	line: string;
	check?: (result: ActPlayerResult) => void;
}> = [
	{
		name: "kernel refused: observation 'Nothing happens.' does not hide player_message",
		input: dispatched(
			"manipulate",
			"rejected",
			{
				status: "rejected",
				reason: "r_manipulate rejected by server",
				player_message: "It is not your turn.",
			},
			{ observation: "Nothing happens." },
		),
		kind: "rejected",
		line: "It is not your turn.",
		check: (result) => {
			if (result.kind !== "rejected") throw new Error("expected rejected");
			expect(result.admission).toBe("rejected");
		},
	},
	{
		name: "unobserved dispatched without player_message does not leak the wrapper reason",
		input: dispatched(
			"manipulate",
			"unobserved",
			{ status: "unobserved_timeout", reason: "r_manipulate rejected by server" },
			{ observation: "Nothing happens." },
		),
		kind: "rejected",
		line: "The world refused.",
		check: (result) => {
			if (result.kind !== "rejected") throw new Error("expected rejected");
			expect(result.admission).toBe("unobserved");
		},
	},
	{
		name: "accepted authored observation",
		input: dispatched(
			"manipulate",
			"accepted",
			{ status: "success" },
			{ observation: "The worn map shows a route." },
		),
		kind: "happened",
		line: "The worn map shows a route.",
	},
	{
		name: "accepted hit/miss player_message when observation is null",
		input: dispatched(
			"manipulate",
			"accepted",
			{ status: "success", player_message: "Your Strike lands on the watcher." },
			{ observation: null, observation_gap: MANIPULATE_GAP },
		),
		kind: "happened",
		line: "Your Strike lands on the watcher.",
	},
	{
		name: "accepted quiet: null observation plus gap, never the old fallback",
		input: dispatched(
			"manipulate",
			"accepted",
			{ status: "success" },
			{ observation: null, observation_gap: MANIPULATE_GAP },
		),
		kind: "quiet",
		line: QUIET,
		check: (result) => {
			if (result.kind !== "quiet") throw new Error("expected quiet");
			expect(result.gap).toBe(MANIPULATE_GAP);
		},
	},
	{
		name: "sensing accepted with authored observation",
		input: dispatched(
			"sensing",
			"accepted",
			{ status: "success" },
			{ observation: "Dust hangs in the still air." },
		),
		kind: "happened",
		line: "Dust hangs in the still air.",
	},
	{
		name: "sensing accepted quiet",
		input: dispatched(
			"sensing",
			"accepted",
			{ status: "success" },
			{ observation: null, observation_gap: SENSE_GAP },
		),
		kind: "quiet",
		line: QUIET,
	},
	{
		name: "communicate reply object beats You say echo",
		input: dispatched(
			"communicate",
			"accepted",
			{ status: "success" },
			{
				observation: 'You say: "Well met!"',
				conversation: {
					spoken_by_player: "Well met!",
					response: {
						speaker: "2",
						speaker_name: "Guide",
						text: "The way is open.",
						trace_id: "1",
					},
					awaiting_response: false,
					continuity: null,
				},
			},
		),
		kind: "happened",
		line: 'Guide says: "The way is open."',
	},
	{
		name: "communicate reply with no perceivable speaker name",
		input: dispatched(
			"communicate",
			"accepted",
			{ status: "success" },
			{
				observation: 'You say: "Anyone there?"',
				conversation: {
					spoken_by_player: "Anyone there?",
					response: { speaker: "2", speaker_name: null, text: "Keep walking.", trace_id: "1" },
					awaiting_response: false,
					continuity: null,
				},
			},
		),
		kind: "happened",
		line: 'Someone says: "Keep walking."',
	},
	{
		name: "silent communicate with no reply is quiet, not refused",
		input: dispatched(
			"communicate",
			"accepted",
			{ status: "success" },
			{
				observation: null,
				observation_gap: COMMUNICATE_GAP,
				conversation: {
					spoken_by_player: null,
					response: null,
					awaiting_response: true,
					continuity: null,
				},
			},
		),
		kind: "quiet",
		line: QUIET,
	},
	{
		name: "travelling is happened with departure prose",
		input: dispatched(
			"manipulate",
			"travelling",
			{ status: "travelling" },
			{ observation: "You set off toward the gate — a journey of about 3 ticks." },
		),
		kind: "happened",
		line: "You set off toward the gate — a journey of about 3 ticks.",
	},
	{
		name: "unknown handle uses the tool reason",
		input: { status: "unknown_handle", handle: "h1", reason: UNKNOWN_HANDLE_REASON },
		kind: "rejected",
		line: UNKNOWN_HANDLE_REASON,
		check: (result) => {
			if (result.kind !== "rejected") throw new Error("expected rejected");
			expect(result.admission).toBe("not_offered");
		},
	},
	{
		name: "ambiguous handle uses the tool reason",
		input: { status: "ambiguous_handle", handle: "h1", reason: AMBIGUOUS_HANDLE_REASON },
		kind: "rejected",
		line: AMBIGUOUS_HANDLE_REASON,
	},
	{
		name: "invalid sensing descriptor",
		input: {
			status: "invalid_sensing_descriptor",
			handle: "h1",
			reason: "Sensing affordance is missing typed visibility.",
		},
		kind: "rejected",
		line: "Sensing affordance is missing typed visibility.",
	},
	{
		name: "unsupported verb class",
		input: {
			status: "unsupported_verb_class",
			verb_class: "other",
			handle: "h1",
			reason:
				"This affordance verb class is not executable by handle yet; use the specific verb tool if available.",
		},
		kind: "rejected",
		line: "This affordance verb class is not executable by handle yet; use the specific verb tool if available.",
	},
	{
		name: "move in flight",
		input: {
			status: "move_in_flight",
			verb_class: "movement",
			handle: "h1",
			reason:
				"Another move is already in progress for this actor; wait for it to resolve before retrying.",
		},
		kind: "rejected",
		line: "Another move is already in progress for this actor; wait for it to resolve before retrying.",
		check: (result) => {
			if (result.kind !== "rejected") throw new Error("expected rejected");
			expect(result.admission).toBe("in_flight");
		},
	},
	{
		name: "empty object is undescribable, not quiet",
		input: {},
		kind: "undescribable",
		line: DEFECT,
		check: (result) => {
			if (result.kind !== "undescribable") throw new Error("expected undescribable");
			expect(result.keys).toEqual([]);
		},
	},
	{
		name: "bare observation without a dispatched receipt is undescribable",
		input: { observation: "The worn map shows a route." },
		kind: "undescribable",
		line: DEFECT,
		check: (result) => {
			if (result.kind !== "undescribable") throw new Error("expected undescribable");
			expect(result.keys).toEqual(["observation"]);
		},
	},
	{
		name: "tool-result wrapper unwraps details",
		input: {
			content: [{ type: "text", text: "{}" }],
			details: dispatched(
				"manipulate",
				"accepted",
				{ status: "success" },
				{ observation: "The worn map shows a route." },
			),
		},
		kind: "happened",
		line: "The worn map shows a route.",
	},
	{
		name: "non-record input is undescribable",
		input: null,
		kind: "undescribable",
		line: DEFECT,
	},
];

describe("classifyActResult / renderActResultLine", () => {
	it.each(cases)("$name", ({ input, kind, line, check }) => {
		const result = classifyActResult(input);
		expect(result.kind).toBe(kind);
		expect(renderActResultLine(result)).toBe(line);
		check?.(result);
	});

	it("the four kinds render four distinct sentences", () => {
		const lines = [
			renderActResultLine({
				kind: "rejected",
				admission: "rejected",
				player_message: "It is not your turn.",
				reason: null,
			}),
			renderActResultLine({
				kind: "happened",
				observation: "The worn map shows a route.",
				spoken_by_player: null,
				reply: null,
				awaiting_response: false,
				resolution_message: null,
			}),
			renderActResultLine({ kind: "quiet", gap: MANIPULATE_GAP }),
			renderActResultLine({ kind: "undescribable", keys: [] }),
		];
		expect(new Set(lines).size).toBe(4);
		expect(lines).not.toContain("Nothing happens.");
		expect(lines).not.toContain("The world did not accept that action.");
	});
});

describe("renderActResultLine: what was done AND how it came out", () => {
	const happened = {
		kind: "happened" as const,
		spoken_by_player: null,
		reply: null,
		awaiting_response: false,
	};

	it("prints the observation and then the resolution message, so a stochastic act's outcome is never lost", () => {
		expect(
			renderActResultLine({
				...happened,
				observation: "You pull at the stuck lever.",
				resolution_message: "Your attempt fails.",
			}),
		).toBe("You pull at the stuck lever. Your attempt fails.");
	});

	it("does not repeat a message the observation already carries, and still prints either one alone", () => {
		expect(
			renderActResultLine({
				...happened,
				observation: "You pull at the stuck lever. Your attempt fails.",
				resolution_message: "Your attempt fails.",
			}),
		).toBe("You pull at the stuck lever. Your attempt fails.");
		expect(
			renderActResultLine({
				...happened,
				observation: "You pull at the stuck lever.",
				resolution_message: null,
			}),
		).toBe("You pull at the stuck lever.");
		expect(
			renderActResultLine({
				...happened,
				observation: null,
				resolution_message: "Your attempt fails.",
			}),
		).toBe("Your attempt fails.");
	});
});
