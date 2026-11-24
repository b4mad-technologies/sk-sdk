// sk-jay0.1.46 (run 3): args_json keys the world does not read are named on
// the receipt instead of vanishing behind "accepted", and a malformed blob on
// spellkave_communicate is rejected here instead of reaching the server as
// `{}`.
import { snapshotDbFromFixture as admittedFixtureSource } from "@spellkave/sdk";
import { describe, expect, it, vi } from "vitest";
import { auditArgsJson, ignoredArgsHint } from "../args-json-audit";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools";

function fixture(
	status: "success" | "rejected" = "success",
	options: { channel?: "utterance" } = {},
) {
	const db = admittedFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		public_metadata_attachment:
			options.channel === undefined
				? []
				: [
						{
							rowId: 1n,
							namespace: "ui.affordance_input",
							targetKind: "affordance_template",
							targetRef: "dm/creation/input/name",
							audience: "public",
							payloadJson: JSON.stringify({
								fields: [
									{ name: "name", label: "Name", control: "text", channel: options.channel },
								],
							}),
						},
					],
		visible_metadata_attachment: [],
		world_time: [{ tick: 1n }],
		entity: [
			{ entityId: 1n, name: "Actor" },
			{ entityId: 3n, name: "Aldwin" },
		],
		affordance_template: [{ templateId: "dm/creation/input/name", displayName: "Name" }],
		action_definition: [
			{
				actionId: "dm/creation/input/name",
				displayName: "Name your character",
				selfOnly: false,
				selfEligible: false,
			},
		],
		outcome_template: [
			{
				outcomeTemplateId: "dm/creation/input/name/outcome",
				manipulationActionId: "dm/creation/input/name",
			},
		],
		visible_manipulation_available_action: [
			{
				perceiverEntityId: 1n,
				actionId: "dm/creation/input/name",
				templateIds: ["dm/creation/input/name"],
				nicheIds: [],
			},
		],
		visible_manipulation_context: [
			{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true },
		],
		visible_manipulation_observed_target: [
			{
				targetFactId: "target:1:entity:3",
				perceiverEntityId: 1n,
				targetRef: { tag: "Entity", value: 3n },
				nicheIds: [],
			},
		],
	});
	const manipulate = vi.fn(async (_target: string, _action: string, _args: string) => ({
		status,
	}));
	const map = createPlayerFacingToolMap({
		db,
		act: { actorId: "1", actorClient: { manipulate } },
	} as unknown as SpellkaveToolContext);
	return { map, manipulate };
}

describe("auditArgsJson", () => {
	it("treats an absent or blank blob as clean", () => {
		expect(auditArgsJson(undefined)).toEqual({ status: "ok", ignored_keys: [] });
		expect(auditArgsJson("  ")).toEqual({ status: "ok", ignored_keys: [] });
		expect(auditArgsJson("{}")).toEqual({ status: "ok", ignored_keys: [] });
	});

	it("keeps every wire key in either spelling and names the rest", () => {
		expect(
			auditArgsJson(
				JSON.stringify({
					semantic_context: { source_ref: "entity:3", occurrence_id: "1" },
					participantContext: "mpc:7",
					dispatch_text: "hi",
					name: "Brannoc",
					mood: "bold",
				}),
			),
		).toEqual({ status: "ok", ignored_keys: ["name", "mood"] });
	});

	it("reports malformed JSON and non-object roots", () => {
		const cut = auditArgsJson('{"semantic_context":{"source_ref":"entity:3"}');
		expect(cut.status).toBe("malformed");
		if (cut.status === "malformed") expect(cut.reason).toMatch(/not valid JSON/);
		expect(auditArgsJson("[1,2]")).toEqual({
			status: "malformed",
			reason: "args_json must be a JSON object",
		});
	});

	it("hints at utterance and lists the readable keys", () => {
		const hint = ignoredArgsHint(["name"]);
		expect(hint).toContain('["name"]');
		expect(hint).toContain("spellkave_communicate's utterance");
		expect(hint).toContain('"quantity"');
		expect(hint).toContain('"semantic_context"');
		expect(hint).not.toContain("semanticContext");
	});
});

describe("receipts name ignored args_json keys", () => {
	it("manipulate: an accepted dispatch still says which keys the world never read", async () => {
		const { map, manipulate } = fixture();
		const result = await map.manipulate.execute("manipulate", {
			target_id: "entity:3",
			action_id: "dm/creation/input/name",
			args_json: JSON.stringify({ name: "Brannoc" }),
		});
		expect(manipulate).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			details: {
				receipt: {
					outcome: "accepted",
					manipulate: { status: "success", ignored_args: ["name"] },
				},
			},
		});
		expect(JSON.stringify(result)).toContain("spellkave_communicate's utterance");
	});

	it("manipulate: refuses before dispatch when args_json names an utterance-channel field (sk-jay0.1.46)", async () => {
		const { map, manipulate } = fixture("success", { channel: "utterance" });
		const result = await map.manipulate.execute("manipulate", {
			target_id: "entity:3",
			action_id: "dm/creation/input/name",
			args_json: JSON.stringify({ name: "Brannoc" }),
		});
		expect(manipulate).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			details: { receipt: { status: "rejected", outcome: "utterance_required" } },
		});
		expect(JSON.stringify(result)).toContain("speech_act_id 'dm/creation/input/name'");
	});

	it("communicate: refuses args_json on an utterance-channel field when nothing was said, and dispatches an utterance", async () => {
		const { map, manipulate } = fixture("success", { channel: "utterance" });
		const refused = await map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/creation/input/name",
			args_json: JSON.stringify({ name: "Brannoc" }),
		});
		expect(manipulate).not.toHaveBeenCalled();
		expect(refused).toMatchObject({
			details: { receipt: { status: "rejected", outcome: "utterance_required" } },
		});
		await map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/creation/input/name",
			utterance: "Brannoc",
		});
		expect(manipulate).toHaveBeenCalledOnce();
	});

	it("manipulate: a clean blob carries no ignored_args field", async () => {
		const { map } = fixture();
		const result = await map.manipulate.execute("manipulate", {
			target_id: "entity:3",
			action_id: "dm/creation/input/name",
			args_json: JSON.stringify({ dispatch_text: "Brannoc" }),
		});
		expect(JSON.stringify(result)).not.toContain("ignored_args");
	});

	// keep(K1): malformed arguments are rejected by the actual tool before any world dispatch.
	it("manipulate: rejects malformed JSON before dispatch (AUTH-48-01)", async () => {
		const { map, manipulate } = fixture();
		const result = await map.manipulate.execute("seal-malformed", {
			target_id: "entity:3",
			action_id: "dm/creation/input/name",
			args_json: "{",
		});
		expect(result).toMatchObject({
			details: { receipt: { status: "rejected", outcome: "malformed_args" } },
		});
		// No reducer dispatch can write seal state or publisher audit rows.
		expect(manipulate).not.toHaveBeenCalled();
	});

	it("communicate: rejects a malformed blob before dispatch", async () => {
		const { map, manipulate } = fixture();
		const result = await map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/dialog/choice/5",
			args_json: '{"semantic_context":{"source_ref":"entity:3","occurrence_id":"1"}',
		});
		expect(manipulate).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			details: {
				receipt: { status: "rejected", verb_class: "communicate", outcome: "malformed_args" },
			},
		});
		expect(JSON.stringify(result)).toContain("not valid JSON");
	});

	it("communicate: names ignored keys beside the slimmed result", async () => {
		const { map, manipulate } = fixture();
		const result = await map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/creation/input/name",
			args_json: JSON.stringify({ name: "Brannoc" }),
		});
		expect(manipulate).toHaveBeenCalledOnce();
		expect(result).toMatchObject({
			details: { receipt: { communicate: { status: "success", ignored_args: ["name"] } } },
		});
	});
});

function admittedFixture(parts: Parameters<typeof admittedFixtureSource>[0]) {
	return admittedFixtureSource({
		visible_manifest_authored_entity: [],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		...parts,
	});
}
