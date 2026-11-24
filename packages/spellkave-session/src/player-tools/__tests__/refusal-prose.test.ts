import { describe, expect, it } from "vitest";
import { describeRefusal, describeRefusalToolHint } from "../refusal-prose";
import { slimActResultForPlayer, slimMoveResultForPlayer } from "../resolution";

const MANIPULATE_REFUSAL_REASONS = [
	"action_budget_exhausted",
	"action_recharging",
	"unknown_economy_channel",
	"action_economy_observability_error",
	"not_your_turn",
	"actor_authorization_failed",
	"predicate_rejected",
	"affordance_selection_failed",
	"bound_exhausted",
	"claim_contended",
	"insufficient_item_quantity",
	"invalid_args",
	"invalid_outcome_template",
	"invalid_resolution_mode",
	"manipulation_rejected",
	"missing_action_definition",
	"out_of_range",
	"precondition_failed",
	"self_target_not_eligible",
	"stale_item_source",
	"stale_target",
	"unreachable_target",
	"abandoned",
	"felicity_rejected",
	"prompt_context_required",
] as const;

// Engine/schema tokens a blind player must never be asked to parse.
const ENGINE_TOKEN =
	/_|\bpredicate\b|\baffordance\b|\btemplate\b|\bbudget\b|\bchannel\b|\bobservability\b|\bauthorization\b|\bfelicity\b|\bresolution\b|\bschema\b|\breducer\b|\bprovenance\b|\bargs\b|\bjson\b|\bdsl\b|\bentity_id\b/i;

const LIVE_BUDGET_DETAIL =
	'{"reason":"action_budget_exhausted","channel":"srd/economy_channel/primary","spent_ms":6000,"pool_ms":6000}';

describe("describeRefusal", () => {
	it("maps every listed manipulate refusal code to a world-legible sentence", () => {
		for (const reason of MANIPULATE_REFUSAL_REASONS) {
			const prose = describeRefusal(reason);
			expect(prose, reason).toMatch(/^[A-Z].*\.$/);
			expect(prose, reason).not.toMatch(ENGINE_TOKEN);
			expect(prose, reason).not.toContain(reason);
		}
	});

	// sk-jay0.1.46: the prompt-bound refusal's remedy is a tool-surface fact,
	// so it carries a second, tool-facing register beside the world sentence.
	it("gives prompt_context_required a tool hint naming the tool and field", () => {
		const hint = describeRefusalToolHint("prompt_context_required");
		expect(hint).toContain("spellkave_manipulation_context");
		expect(hint).toContain("prompts[]");
		expect(hint).toContain('args_json as {"semantic_context": <row>}');
		expect(describeRefusalToolHint("action_budget_exhausted")).toBeUndefined();
		expect(describeRefusalToolHint("brand_new_engine_code")).toBeUndefined();
	});

	it("uses the generic fallback for an unknown code so a future reason cannot leak raw", () => {
		expect(describeRefusal("brand_new_engine_code")).toBe("That did not work.");
		expect(describeRefusal("")).toBe("That did not work.");
	});

	it("uses the approved wording for the codes the playtest named", () => {
		expect(describeRefusal("action_budget_exhausted")).toBe(
			"No effort is available for that action.",
		);
		expect(describeRefusal("not_your_turn")).toBe("It is not your turn.");
		expect(describeRefusal("out_of_range")).toBe("That is too far away to reach.");
		expect(describeRefusal("stale_target")).toBe("That is no longer where you saw it.");
	});
});

const MOVE_REFUSAL_KINDS = [
	"predicate_no_longer_holds",
	"movement_reach_exceeded",
	"movement_budget_exhausted",
	"spatial_missing_edge_or_relation",
	"spatial_blocked_substrate_crossing",
	"spatial_invalid_target_reference",
	"actor_authorization_failed",
	"predicate_rejected",
] as const;

describe("slimMoveResultForPlayer — refused receipt (sk-jay0.1.76.10)", () => {
	it("gives every listed movement class its own world-legible sentence", () => {
		for (const kind of MOVE_REFUSAL_KINDS) {
			const prose = describeRefusal(kind);
			expect(prose, kind).toMatch(/^[A-Z].*\.$/);
			expect(prose, kind).not.toMatch(ENGINE_TOKEN);
			expect(prose, kind).not.toBe(describeRefusal("no_such_code"));
		}
	});

	it("carries the class and its sentence beside the raw evaluation trail", () => {
		const trail =
			"affordance_template=srd/affordance/grid-step;mode=;predicate_source=canonical(template=srd/affordance/grid-step,root_node_id=6,nodes=6);span=unavailable;predicate_value=false";
		const slim = slimMoveResultForPlayer({
			status: "rejected",
			reason: "r_move rejected by server",
			provenance: {
				id: "r_move:9",
				failure_kind: "predicate_no_longer_holds",
				failure_detail: trail,
			},
		});
		expect(slim.failure_kind).toBe("predicate_no_longer_holds");
		expect(slim.player_message).toBe("The way is closed to you right now.");
		expect(slim.failure_detail).toBe(trail);
		expect(slim.reason).toBe("r_move rejected by server");
	});

	it("adds neither field to an accepted move or to one without a class", () => {
		const accepted = slimMoveResultForPlayer({
			status: "success",
			provenance: { id: "r_move:1", failure_kind: "" },
		});
		expect(accepted).not.toHaveProperty("failure_kind");
		expect(accepted).not.toHaveProperty("player_message");
		const unclassed = slimMoveResultForPlayer({
			status: "rejected",
			reason: "r_move rejected by server",
		});
		expect(unclassed).not.toHaveProperty("failure_kind");
		expect(unclassed).not.toHaveProperty("player_message");
	});
});

describe("slimActResultForPlayer — refused receipt", () => {
	it("carries player_message alongside the raw reason and failure_detail", () => {
		const slimmed = slimActResultForPlayer({
			status: "rejected",
			reason: "action_budget_exhausted",
			actor_id: "hero",
			snapshot: { leak: true },
			provenance: { failure_detail: '{"kind":"action_budget_exhausted"}' },
		});
		expect(slimmed.reason).toBe("action_budget_exhausted");
		expect(slimmed.failure_detail).toBe('{"kind":"action_budget_exhausted"}');
		expect(slimmed.player_message).toBe("No effort is available for that action.");
		expect(slimmed.actor_id).toBe("hero");
		expect(slimmed).not.toHaveProperty("snapshot");
		expect(slimmed).not.toHaveProperty("provenance");
	});

	it("carries tool_hint only for a refusal whose remedy is a tool-surface fact", () => {
		const live = slimActResultForPlayer({
			status: "rejected",
			reason: "r_manipulate rejected by server",
			provenance: {
				failure_kind: "prompt_context_required",
				failure_detail:
					"prompt_context_required: action 'dm/dialog/choice/5' is prompt-bound and requires semantic_context (missing or unparseable)",
			},
		});
		expect(live.failure_kind).toBe("prompt_context_required");
		expect(live.player_message).toBe(
			"That answer belongs to a question nobody is asking you right now.",
		);
		expect(live.tool_hint).toContain("spellkave_manipulation_context");
		const budget = slimActResultForPlayer({
			status: "rejected",
			reason: "r_manipulate rejected by server",
			provenance: { failure_kind: "action_budget_exhausted", failure_detail: LIVE_BUDGET_DETAIL },
		});
		expect(budget).not.toHaveProperty("tool_hint");
	});

	it("omits player_message on a success that carries no reason", () => {
		const slimmed = slimActResultForPlayer({ status: "success" });
		expect(slimmed).not.toHaveProperty("player_message");
		expect(slimmed).not.toHaveProperty("reason");
		expect(slimmed).not.toHaveProperty("failure_detail");
	});

	// keep(K2): injects both distinct engine receipts into the PLAYER projection boundary.
	it.each([
		["spent budget", LIVE_BUDGET_DETAIL],
		[
			"zeroed budget before any expenditure",
			'{"reason":"action_budget_exhausted","channel":"srd/economy_channel/primary","spent_ms":0,"pool_ms":0}',
		],
	])("uses neutral prose for %s and retains the engine receipt", (_case, detail) => {
		const slimmed = slimActResultForPlayer({
			status: "rejected",
			actor_id: "1",
			target_id: "entity:10",
			action_id: "srd/attack/melee",
			reason: "r_manipulate rejected by server",
			snapshot: null,
			provenance: {
				failure_kind: "action_budget_exhausted",
				failure_detail: detail,
			},
		});
		expect(slimmed.reason).toBe("r_manipulate rejected by server");
		expect(slimmed.failure_kind).toBe("action_budget_exhausted");
		expect(slimmed.failure_detail).toBe(detail);
		expect(slimmed.player_message).toBe("No effort is available for that action.");
	});

	it("reads failure_detail.reason when failure_kind is absent", () => {
		const slimmed = slimActResultForPlayer({
			status: "rejected",
			reason: "r_manipulate rejected by server",
			provenance: { failure_detail: LIVE_BUDGET_DETAIL },
		});
		expect(slimmed.reason).toBe("r_manipulate rejected by server");
		expect(slimmed.player_message).toBe("No effort is available for that action.");
	});

	it("does not throw on malformed failure_detail and falls back to the wrapper reason", () => {
		expect(() =>
			slimActResultForPlayer({
				status: "rejected",
				reason: "r_manipulate rejected by server",
				provenance: { failure_detail: "not-json{" },
			}),
		).not.toThrow();
		const slimmed = slimActResultForPlayer({
			status: "rejected",
			reason: "r_manipulate rejected by server",
			provenance: { failure_detail: "not-json{" },
		});
		expect(slimmed.failure_detail).toBe("not-json{");
		expect(slimmed.reason).toBe("r_manipulate rejected by server");
		expect(slimmed.player_message).toBe("That did not work.");
	});
});

// sk-jay0.1.23.36.1: the deterministic NPC player learns from the server's
// own failure CLASS, not prose — `failure_kind` must reach a rejected
// receipt.
describe("slimActResultForPlayer — failure_kind (sk-jay0.1.23.36.1)", () => {
	it("takes failure_kind from provenance.failure_kind on a rejected result", () => {
		const slimmed = slimActResultForPlayer({
			status: "rejected",
			reason: "r_manipulate rejected by server",
			provenance: {
				failure_kind: "out_of_range",
				failure_detail: '{"reason":"out_of_range"}',
			},
		});
		expect(slimmed.failure_kind).toBe("out_of_range");
	});

	it("falls back to the failure_detail JSON .reason when failure_kind is absent", () => {
		const slimmed = slimActResultForPlayer({
			status: "rejected",
			reason: "r_manipulate rejected by server",
			provenance: { failure_detail: LIVE_BUDGET_DETAIL },
		});
		expect(slimmed.failure_kind).toBe("action_budget_exhausted");
	});

	it("records unclassified — not the raw wrapper reason — when there is no provenance at all", () => {
		const slimmed = slimActResultForPlayer({
			status: "rejected",
			reason: "r_manipulate rejected by server",
		});
		expect(slimmed.failure_kind).toBe("unclassified");
	});

	it("is absent from an accepted result", () => {
		const slimmed = slimActResultForPlayer({ status: "success" });
		expect(slimmed).not.toHaveProperty("failure_kind");
	});
});

describe("receipt provenance_id retention", () => {
	it("retains provenance_id on an accepted act", () => {
		const slimmed = slimActResultForPlayer({
			status: "success",
			actor_id: "1",
			provenance: {
				provenance_id: "eval:accepted-1",
				id: "eval:accepted-1",
			},
		});
		expect(slimmed.provenance_id).toBe("eval:accepted-1");
		expect(slimmed).not.toHaveProperty("provenance");
	});

	it("retains provenance_id on a rejected act", () => {
		const slimmed = slimActResultForPlayer({
			status: "rejected",
			reason: "r_manipulate rejected by server",
			actor_id: "1",
			provenance: {
				provenance_id: "eval:rejected-1",
				failure_kind: "predicate_rejected",
				failure_detail: '{"reason":"predicate_rejected"}',
			},
		});
		expect(slimmed.provenance_id).toBe("eval:rejected-1");
		expect(slimmed.failure_kind).toBe("predicate_rejected");
		expect(slimmed.failure_detail).toBe('{"reason":"predicate_rejected"}');
		expect(slimmed).not.toHaveProperty("provenance");
	});

	it("omits provenance_id on an unobserved act", () => {
		const slimmed = slimActResultForPlayer({
			status: "success",
			actor_id: "1",
		});
		expect(slimmed).not.toHaveProperty("provenance_id");

		const slimmedNull = slimActResultForPlayer({
			status: "rejected",
			reason: "unobserved_timeout",
			provenance: undefined,
		});
		expect(slimmedNull).not.toHaveProperty("provenance_id");
	});

	it("retains provenance_id on slimMoveResultForPlayer for both accepted and rejected moves", () => {
		const acceptedMove = slimMoveResultForPlayer({
			status: "success",
			provenance: {
				provenance_id: "eval:move-1",
			},
		});
		expect(acceptedMove.provenance_id).toBe("eval:move-1");
		expect(acceptedMove).not.toHaveProperty("provenance");

		const rejectedMove = slimMoveResultForPlayer({
			status: "rejected",
			reason: "blocked",
			provenance: {
				provenance_id: "eval:move-2",
				failure_detail: "door is locked",
			},
		});
		expect(rejectedMove.provenance_id).toBe("eval:move-2");
		expect(rejectedMove.failure_detail).toBe("door is locked");
		expect(rejectedMove).not.toHaveProperty("provenance");

		const unobservedMove = slimMoveResultForPlayer({
			status: "rejected",
			reason: "unobserved_timeout",
		});
		expect(unobservedMove).not.toHaveProperty("provenance_id");
	});

	it("names the distinct records matched when one body performs two acts in quick succession", () => {
		const firstReceipt = slimActResultForPlayer({
			status: "success",
			actor_id: "hero",
			provenance: {
				provenance_id: "eval:hero-act-1",
				id: "eval:hero-act-1",
			},
		});
		const secondReceipt = slimActResultForPlayer({
			status: "rejected",
			reason: "action_budget_exhausted",
			actor_id: "hero",
			provenance: {
				provenance_id: "eval:hero-act-2",
				id: "eval:hero-act-2",
				failure_kind: "action_budget_exhausted",
				failure_detail: LIVE_BUDGET_DETAIL,
			},
		});

		expect(firstReceipt.provenance_id).toBe("eval:hero-act-1");
		expect(secondReceipt.provenance_id).toBe("eval:hero-act-2");
		expect(firstReceipt.provenance_id).not.toBe(secondReceipt.provenance_id);
	});
});
