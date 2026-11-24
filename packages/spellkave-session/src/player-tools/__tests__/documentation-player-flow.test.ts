import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { playerFacingToolDefinitions } from "../tools";

// T7: spellkave_move left this list — the act_scene -> spellkave_move rename
// absorbed the deprecated raw edge-id wrapper of that same name into the
// live, non-deprecated PLAYER movement tool, so "spellkave_move" now
// legitimately appears in PLAYER tool descriptions (spellkave_scene,
// spellkave_affordance_verbs/targets, ...).
const DEPRECATED_PLAYER_NAMES = [
	"spellkave_actor_snapshot",
	"spellkave_location_snapshot",
	"spellkave_entity_contents",
	"spellkave_object_state",
	"spellkave_inscribe_trace",
	"spellkave_react",
] as const;

function section(file: string, heading: string): string {
	const text = readFileSync(file, "utf8");
	const start = text.indexOf(heading);
	if (start < 0) throw new Error(`${file} is missing ${heading}`);
	const rest = text.slice(start + heading.length);
	const next = rest.search(/\n## /);
	return next < 0 ? rest : rest.slice(0, next);
}

function schemaTexts(schema: unknown): string[] {
	if (schema === null || typeof schema !== "object") return [];
	const rec = schema as {
		description?: unknown;
		properties?: Record<string, unknown>;
		anyOf?: unknown[];
	};
	const out: string[] = [];
	if (typeof rec.description === "string") out.push(rec.description);
	if (rec.properties !== undefined) {
		for (const child of Object.values(rec.properties)) out.push(...schemaTexts(child));
	}
	if (Array.isArray(rec.anyOf)) {
		for (const child of rec.anyOf) out.push(...schemaTexts(child));
	}
	return out;
}

function collectPlayerFacingText(
	definition: (typeof playerFacingToolDefinitions)[number],
): string[] {
	const extra = definition as {
		promptSnippet?: string;
		promptGuidelines?: string[];
	};
	return [
		definition.description,
		...(extra.promptSnippet === undefined ? [] : [extra.promptSnippet]),
		...(extra.promptGuidelines ?? []),
		...schemaTexts(definition.parameters),
	];
}

describe("PLAYER documentation flow", () => {
	it("never recommends deprecated tools from a PLAYER tool description", () => {
		for (const definition of playerFacingToolDefinitions) {
			for (const deprecated of DEPRECATED_PLAYER_NAMES) {
				expect(definition.description, `${definition.name} recommends ${deprecated}`).not.toMatch(
					new RegExp(`${deprecated}(?![A-Za-z0-9_])`),
				);
			}
		}
	});

	it("PLAYER-facing descriptions and examples do not leak worlds, slugs, or other surfaces", () => {
		const forbidden: { name: string; pattern: RegExp }[] = [
			{ name: "elven-mini campaign", pattern: /playing the elven-mini campaign/i },
			{ name: "Aldwin", pattern: /\bAldwin\b/ },
			{ name: "Renn", pattern: /\bRenn\b/ },
			{ name: "place_node_set", pattern: /place_node_set:/ },
			{ name: "srd/ slug", pattern: /\bsrd\// },
			{ name: "core/ slug", pattern: /\bcore\// },
			{ name: "spellkave_define_behavior", pattern: /spellkave_define_behavior/ },
			{ name: "spellkave_observer_place_knowledge", pattern: /spellkave_observer_place_knowledge/ },
			{
				name: "spellkave_subscribe_affordance_cache",
				pattern: /spellkave_subscribe_affordance_cache/,
			},
			{ name: "r_move", pattern: /\br_move\b/ },
			{ name: "r_manipulate", pattern: /\br_manipulate\b/ },
			{ name: "r_react", pattern: /\br_react\b/ },
			{ name: "ADR id", pattern: /\bADR-\d+/ },
			{ name: "map_layers toml", pattern: /\[\[map_layers\]\]/ },
			{ name: "Core Drop", pattern: /Core Drop/ },
			{ name: "common-room example", pattern: /03-common-room-arrival/ },
			{ name: "town/inn example", pattern: /town\/inn/ },
		];
		for (const definition of playerFacingToolDefinitions) {
			const texts = collectPlayerFacingText(definition);
			for (const { name, pattern } of forbidden) {
				for (const text of texts) {
					expect(text, `${definition.name} leaks ${name}`).not.toMatch(pattern);
				}
			}
		}
	});

	it("pins summary-to-direct-attempt guidance in tool-player and authoring docs", () => {
		const root = path.resolve(process.cwd(), "../..");
		const sections = [
			section(path.join(root, "packages/spellkave-tool-player/README.md"), "## PLAYER workflow"),
			section(path.join(root, "packages/spellkave-sdk/README.md"), "## PLAYER projection flow"),
			section(
				path.join(root, "packages/spellkave-world-author/docs/running-an-authored-act.md"),
				"## Player-facing proof flow",
			),
		];
		for (const playerSection of sections) {
			expect(playerSection).toMatch(/spellkave_manipulation_context/);
			expect(playerSection).toMatch(/spellkave_manipulate/);
			for (const deprecated of DEPRECATED_PLAYER_NAMES) {
				expect(playerSection).not.toMatch(new RegExp(`${deprecated}(?![A-Za-z0-9_])`));
			}
		}
	});
});
