import { expect, it } from "vitest";
import { explainVocabularyWith, type VocabularyLookup } from "../explain-core";

it.each(["frontier.despawn", "custom/ordinary"])("marks the actual template lane for %s", (id) => {
	const lookup: VocabularyLookup = (kind) =>
		({
			capability_definitions: [{ capability_id: id }],
			affordance_templates: [{ template_id: "own/act", capability_id: id }],
		})[kind] ?? [];
	expect(explainVocabularyWith("capability", id, "live", lookup, () => [])).toMatchObject({
		ok: true,
		affordance_templates: [{ template_id: "own/act", privileged: id.startsWith("frontier.") }],
	});
});
