// embedded-manifest: {"category":"schema_object_oracle","rationale":"Minimal quest source objects exercise the compiler version envelope and refusal behavior without embedding a reusable world fixture.","signatures":["schema_shape"]}
import { stringify } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
	compileNpcQuestSource,
	parseNpcQuestArtifact,
	SERVICE_ONLY_AUDIENCE_TAG,
} from "../npc-quests";

/** Every capability that is the audience of a namespace in these rows. */
function unmarkedAudiences(manifest: Record<string, unknown>): string[] {
	const rows = (table: string) => (manifest[table] ?? []) as Record<string, string>[];
	const marked = new Set(
		rows("capability_definition_tag")
			.filter((row) => row.tag === SERVICE_ONLY_AUDIENCE_TAG && row.source === "manifest")
			.map((row) => row.capability_id),
	);
	return rows("metadata_namespaces")
		.map((row) => row.audience!)
		.filter((audience) => !marked.has(audience));
}

function source() {
	const lines = { greeting: "A request.", accept: "Agreed.", decline: "Later.", complete: "Done." };
	return {
		schema_version: 1,
		bundle_id: "example",
		catalog_namespace: "example.npc_quests",
		catalog_read_capability_id: "example/npc-data/read-quests",
		publisher_reader_role_id: "example/npc-data/publisher-reader",
		publisher_reader_binding_id: "example/npc-data/publisher-reader",
		known_missing_flags: {},
		bindings: {
			flag_state_ids: { delivered: "example/delivered" },
			hero_blueprint_id: "example/hero",
			level_state_id: "rules/level",
			drafting_condition_id: "rules/drafting",
			speech_trace_kind_id: "rules/speech",
			speak_action_id: "rules/speak",
			answer_count: 2,
			choice_actions: { "rules/yes": 1, "rules/no": 2 },
			open_actions: { 0: "rules/close", 2: "rules/open" },
			prompt_actions: { 0: "rules/clear", 1: "rules/request" },
		},
		quests: [
			{
				id: "request",
				name: "A request",
				rung: "I",
				giverKey: "example/giver",
				giverName: "Giver",
				acceptSlot: 1,
				declineSlot: 2,
				slotAcceptText: "Yes",
				slotDeclineText: "No",
				promptId: 1,
				objective: "Deliver the request",
				terminal: { kind: "flag", flag: "delivered" },
				rewardXp: 5,
				killXpCreatures: [],
				minimum_level: 1,
				progress_home: "self",
				progress_state_id: "example/progress",
				rewarded_state_id: "example/rewarded",
				awarded_state_id: "example/awarded",
				acceptance_action_id: "example/accept",
				award_action_id: "example/award",
				settle_action_id: "example/settle",
				prompt_lines: lines,
				spoken_lines: { ...lines, greeting: "The spoken request." },
			},
		],
		givers: [
			{
				actor_key: "example/giver",
				npc_kind: "quest-giver",
				schema_version: 1,
				namespace: "example.npc.giver",
				read_capability_id: "example/npc-data/read-giver",
				quest_refs: ["request"],
				hooks: {},
			},
		],
	};
}

function worlds() {
	return [
		{
			bundles: [{ bundle_id: "example" }],
			entities: [{ entity_key: "example/giver" }],
			entity_definitions: [{ entity_def_id: "example/hero" }],
			condition_definitions: [{ condition_definition_id: "rules/drafting" }],
			trace_kind_definitions: [{ kind_id: "rules/speech" }],
			resource_definitions: [
				"rules/level",
				"example/progress",
				"example/rewarded",
				"example/awarded",
				"example/delivered",
			].map((resource_definition_id) => ({ resource_definition_id })),
			action_definitions: [
				"rules/speak",
				"rules/yes",
				"rules/no",
				"rules/close",
				"rules/open",
				"rules/clear",
				"rules/request",
				"example/accept",
				"example/award",
				"example/settle",
			].map((action_id) => ({ action_id })),
		},
	];
}

describe("NPC quest compiler publication boundary", () => {
	it("resolves escort places through canonical node_id and refuses undeclared destinations", async () => {
		const input = source();
		Object.assign(input.quests[0]!, {
			terminal: { kind: "escort_alive_at", escortKey: "example/giver", atNodeId: "example/gate" },
		});
		const closure = { ...worlds()[0], place_nodes: [{ node_id: "example/gate" }] };
		await expect(compileNpcQuestSource(stringify(input), [closure])).resolves.toBeDefined();
		await expect(compileNpcQuestSource(stringify(input), worlds())).rejects.toThrow("example/gate");
	});
	it("ignores TOML presentation, retains distinct prompt/speech, and re-derives the sealed artifact", async () => {
		const toml = stringify(source());
		const compiled = await compileNpcQuestSource(toml, worlds());
		expect(
			await compileNpcQuestSource(`# Formatting has no authority\n${toml}\n`, worlds()),
		).toEqual(compiled);
		expect(compiled.legacy.promptLinesByQuest.request).not.toEqual(
			compiled.legacy.spokenLinesByQuest.request,
		);
		expect(await parseNpcQuestArtifact(JSON.stringify(compiled.artifact), worlds())).toEqual(
			compiled.artifact,
		);
	});

	it("grants private/shared reads to the body without making it a role-binding subject", async () => {
		const { artifact } = await compileNpcQuestSource(stringify(source()), worlds());
		expect(artifact.manifest.actor_capabilities).toEqual([
			expect.objectContaining({
				actor_entity_key: "example/giver",
				capability_id: "example/npc-data/read-giver",
			}),
			expect.objectContaining({
				actor_entity_key: "example/giver",
				capability_id: "example/npc-data/read-quests",
			}),
		]);
		expect(artifact.manifest.role_bindings).toEqual([
			expect.objectContaining({ subject: "$sender" }),
		]);
		// Both read capabilities are service-only audiences.
		expect(artifact.manifest.capability_definition_tag).toHaveLength(2);
		expect(unmarkedAudiences(artifact.manifest as Record<string, unknown>)).toEqual([]);
		const attachments = artifact.manifest.metadata_attachments as {
			namespace: string;
			payload_json: string;
		}[];
		const shared = JSON.parse(
			attachments.find((row) => row.namespace === "example.npc_quests")!.payload_json,
		);
		expect(shared.quests[0]).not.toHaveProperty("spoken_lines");
		expect(shared.quests[0]).not.toHaveProperty("prompt_lines");
		const own = JSON.parse(
			attachments.find((row) => row.namespace === "example.npc.giver")!.payload_json,
		);
		expect(own.lines.request.greeting).toBe("The spoken request.");
		expect(own.catalog_content_hash).toBe(shared.content_hash);
	});

	it.each([
		"artifact_digest",
		"grant",
		"private-document",
		"extra-envelope",
	])("refuses altered %s", async (change) => {
		const { artifact } = await compileNpcQuestSource(stringify(source()), worlds());
		const altered = JSON.parse(JSON.stringify(artifact));
		if (change === "artifact_digest") altered.artifact_digest = "sha256:forged";
		if (change === "grant") altered.manifest.actor_capabilities[0].capability_id = "rules/act";
		if (change === "private-document") altered.manifest.metadata_attachments[1].payload_json = "{}";
		if (change === "extra-envelope") altered.extra = true;
		await expect(parseNpcQuestArtifact(JSON.stringify(altered), worlds())).rejects.toThrow(
			"mismatch",
		);
	});
	it("requires canonical reference closure again when publishing an otherwise intact artifact", async () => {
		const { artifact } = await compileNpcQuestSource(stringify(source()), worlds());
		const missing = worlds();
		missing[0]!.entities = [];
		await expect(parseNpcQuestArtifact(JSON.stringify(artifact), missing)).rejects.toThrow(
			"npc-reference-missing",
		);
	});
});
