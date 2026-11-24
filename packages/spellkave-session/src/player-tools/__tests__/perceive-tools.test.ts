import { asEntityRef, type SnapshotDb } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";
import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

const ACTOR_ID = asEntityRef("1");
function toolByName(context: SpellkaveToolContext, name: string): AgentTool {
	const tool = createSpellkaveTools(context).find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`tool not found: ${name}`);
	return tool as AgentTool;
}
function emptyDb(): SnapshotDb {
	const empty = { iter: () => [].values() };
	return new Proxy({} as SnapshotDb, { get: () => empty });
}

describe("companion typed perception and action tools", () => {
	it("dispatches one direct typed manipulation attempt", async () => {
		const calls: string[] = [];
		const tool = toolByName(
			{
				db: emptyDb(),
				act: {
					actorId: "1",
					actorClient: {
						manipulate: async <T>(target: string, action: string, args: string) => {
							calls.push(`${target}|${action}|${args}`);
							return {
								status: "success" as const,
								actor_id: ACTOR_ID,
								target_id: target,
								action_id: action,
								snapshot: null as T,
								lagWarning: false,
								observedAtTick: 1n,
							};
						},
					},
				},
			},
			"spellkave_manipulate",
		);
		const result = await tool.execute("act", { target_id: "entity:9", action_id: "core/inspect" });
		expect(result.details).toMatchObject({
			receipt: { outcome: "accepted", verb_class: "manipulate" },
		});
		expect(calls).toEqual(["entity:9|core/inspect|{}"]);
	});
	it("dispatches typed communication without a handle", async () => {
		const calls: string[] = [];
		const tool = toolByName(
			{
				db: emptyDb(),
				act: {
					actorId: "1",
					actorClient: {
						manipulate: async <T>(target: string, action: string, args: string) => {
							calls.push(`${target}|${action}|${args}`);
							return {
								status: "success" as const,
								actor_id: ACTOR_ID,
								target_id: target,
								action_id: action,
								snapshot: null as T,
								lagWarning: false,
								observedAtTick: 1n,
							};
						},
					},
				},
			},
			"spellkave_communicate",
		);
		const result = await tool.execute("say", {
			target_id: "entity:7",
			speech_act_id: "core/assert",
			utterance: "Hello.",
		});
		expect(result.details).toMatchObject({
			receipt: { outcome: "accepted", verb_class: "communicate" },
		});
		expect(calls).toEqual(['entity:7|core/assert|{"dispatch_text":"Hello."}']);
	});
});
