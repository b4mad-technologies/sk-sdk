import { snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it, vi } from "vitest";

import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools";

describe("PLAYER direct sensing", () => {
	it("reads factual query syntax and dispatches it without an affordance handle", async () => {
		const sense = vi.fn(async (_queryKind: string, _visibility: string) => ({
			status: "success" as const,
			provenance: { selected_template_ids: ["demo/look", "demo/look/outcome"] },
		}));
		const map = createPlayerFacingToolMap({
			db: snapshotDbFromFixture({
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
				entity: [{ entityId: 1n, name: "Observer" }],
				visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "inn/bar" }],
				visible_spatial_niche_attachment: [{ nicheId: "place:inn/bar", placeNodeId: "inn/bar" }],
				visible_capability: [{ entityId: 1n, capabilityId: "demo/observe" }],
				affordance_template: [
					{
						templateId: "demo/look",
						nicheId: "place:inn/bar",
						capabilityId: "demo/observe",
						outcomeTemplateId: "demo/look/outcome",
					},
				],
				outcome_template: [
					{
						outcomeTemplateId: "demo/look/outcome",
						senseQueryKind: "look",
						senseVisibility: "Local",
						displayName: "Look Around",
					},
				],
			}),
			act: { actorId: "1", actorClient: { sense } },
		} as unknown as SpellkaveToolContext);

		await expect(map.senseContext.execute("context", {})).resolves.toMatchObject({
			details: {
				sense_context: {
					status: "ready",
					queries: [{ query_kind: "look", visibility: "Local" }],
				},
			},
		});
		await map.sense.execute("attempt", { query_kind: "look", visibility: "Local" });
		expect(sense).toHaveBeenCalledExactlyOnceWith("look", "Local");
	});
});
