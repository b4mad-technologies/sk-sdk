import { snapshotDbFromFixture } from "@spellkave/sdk";
import { expect, it, vi } from "vitest";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools";

function fixture(status: string) {
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		visible_manifest_authored_entity: [],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		world_time: [{ tick: 1n }],
		entity: [
			{ entityId: 1n, name: "Actor" },
			{ entityId: 2n, name: "Listener" },
		],
		action_definition: [
			{ actionId: "lab/act", displayName: "Act", selfOnly: false, selfEligible: false },
		],
		visible_manipulation_context: [
			{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true },
		],
	});
	const reason =
		status === "rejected"
			? "r_manipulate rejected by server"
			: "settled without an attributable receipt";
	const manipulate = vi.fn(async () => ({
		status,
		actor_id: "1",
		target_id: "entity:2",
		action_id: "lab/act",
		snapshot: null,
		reason,
		...(status === "unobserved_no_provenance"
			? {
					provenance: {
						id: "predicate:1",
						kind: "Predicate",
						status: "Succeeded",
						failure_kind: "",
						failure_detail: "",
						selected_template_ids: ["resolution_mode:stochastic", "resolution_result:true"],
					},
				}
			: {}),
		...(status === "rejected"
			? { provenance: { id: "refusal:1", failure_kind: "out_of_range", failure_detail: "" } }
			: {}),
	}));
	const map = createPlayerFacingToolMap({
		db,
		act: { actorId: "1", actorClient: { manipulate } },
	} as unknown as SpellkaveToolContext);
	return { map, manipulate, reason };
}

const verbs = ["manipulate", "communicate"] as const;
const uncertainStatuses = ["unobservable", "unobserved_timeout", "unobserved_no_provenance"];
for (const verb of verbs) {
	it.each(
		uncertainStatuses,
	)(`${verb}: %s describes uncertainty without inventing refusal or no effect`, async (status) => {
		const x = fixture(status);
		const request =
			verb === "manipulate"
				? { target_id: "entity:2", action_id: "lab/act", args_json: "{}" }
				: { target_id: "entity:2", speech_act_id: "lab/act", utterance: "Wait for my signal." };
		const result = await x.map[verb].execute("uncertain", request);
		expect(x.manipulate).toHaveBeenCalledOnce();
		expect(result.details).toMatchObject({
			receipt: {
				outcome: "unobserved",
				[verb]: { status, reason: x.reason, player_message: "The outcome could not be confirmed." },
			},
			observation: null,
			observation_gap: "The outcome could not be confirmed.",
		});
		expect(result.details).not.toHaveProperty(`receipt.${verb}.failure_kind`);
		expect(result.details).not.toHaveProperty(`receipt.${verb}.provenance_id`);
		expect(result.details).not.toHaveProperty("receipt.provenance_id");
		expect(result.details).not.toHaveProperty("receipt.resolution");
		expect(JSON.stringify(result)).not.toMatch(/Nothing happens\.|That did not work\./);
		if (verb === "communicate")
			expect(result.details).toMatchObject({
				conversation: { spoken_by_player: null, response: null },
			});
	});

	it(`${verb}: retains a confirmed refusal and its existing advice`, async () => {
		const x = fixture("rejected");
		const request =
			verb === "manipulate"
				? { target_id: "entity:2", action_id: "lab/act", args_json: "{}" }
				: { target_id: "entity:2", speech_act_id: "lab/act", utterance: "Wait for my signal." };
		const result = await x.map[verb].execute("refused", request);
		expect(result.details).toMatchObject({
			receipt: {
				outcome: "rejected",
				[verb]: {
					status: "rejected",
					player_message: "That is too far away to reach.",
					failure_kind: "out_of_range",
					provenance_id: "refusal:1",
				},
			},
			observation: "Nothing happens.",
		});
		expect(result.details).not.toHaveProperty("observation_gap");
	});
}
