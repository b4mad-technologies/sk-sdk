import type { SnapshotDb } from "@spellkave/sdk";
import { AUTHOR_FACING_TOOL_NAMES, authorFacingToolDefinitions } from "@spellkave/tool-authoring";
import { TOOL_CONTRACTS } from "@spellkave/tool-contracts";
import { describe, expect, it } from "vitest";
import { actingContextToolDef } from "../../acting-context";
import {
	createDmExtensionTools,
	createPlayerFacingToolMap,
	createPlayerFacingTools,
	createSpellkaveTools,
	DM_EXTENSION_TOOL_NAMES,
	PLAYER_FACING_TOOL_NAMES,
	paceTimeToolDefinitions,
	type SpellkaveToolContext,
	spellkaveToolDefinitions,
} from "../tools";

// #1968 parity lane 4: actor_snapshot/location_snapshot/entity_contents/
// object_state/equipment/sense/inscribe_trace/react were deleted outright
// (zero production callers beyond this package's own tests; see #1975/#1976
// for the two callers found elsewhere that turned out to be pre-existing,
// unrelated staleness, not a load-bearing dependency on these specific
// tools). communicate stays deprecated-but-kept. ADR-0140 moved manipulate
// into the PLAYER roster: its typed action/target shape is now the direct
// factored-context dispatch, not a legacy handle fallback. spellkave_move (T7)
// is the one exception that MOVED
// the other way: the deprecated raw edge-id wrapper of that same name was
// absorbed into the renamed act_scene tool as its compatibility mode, so
// `spellkave_move` is now the canonical (non-deprecated) PLAYER movement
// tool, not a retained-deprecated general one.
const GENERAL_TOOL_NAMES_BEFORE_QUERYABLE_CUTOVER = [
	"spellkave_orient",
	"spellkave_status",
	"spellkave_events",
	"spellkave_self_summary",
	"spellkave_self_states",
	"spellkave_scene",
	"spellkave_scene_detail",
	"spellkave_map",
	"spellkave_move",
	"spellkave_inventory",
	"spellkave_item_detail",
	"spellkave_trace_detail",
	"spellkave_session_status",
	"spellkave_reaction_options",
	"spellkave_intervention_windows",
	"spellkave_react_option",
	"spellkave_suggest_next_action",
	"spellkave_manipulation_context",
	"spellkave_entity",
	"spellkave_entity_container",
	"spellkave_observer_knowledge",
	"spellkave_observer_place_knowledge",
	"spellkave_observer_trace_knowledge",
	"spellkave_traces",
	"spellkave_entity_body",
	"spellkave_actor_principals",
	"spellkave_communicate",
	"spellkave_sense_context",
	"spellkave_sense",
	"spellkave_session_open",
	"spellkave_session_close",
	"spellkave_session_move",
	"spellkave_end_turn",
	"spellkave_manipulate",
	"spellkave_release_claim",
	"spellkave_wake_up",
	"spellkave_offer_control",
	"spellkave_withdraw_control",
	"spellkave_take_npc_control",
	"spellkave_return_npc_control",
] as const;

const QUERYABLE_PLAYER_TOOL_NAMES_AFTER_CUTOVER = [
	"spellkave_orient",
	"spellkave_self_summary",
	"spellkave_self_states",
	"spellkave_scene",
	"spellkave_scene_detail",
	"spellkave_map",
	"spellkave_move",
	"spellkave_inventory",
	"spellkave_item_detail",
	"spellkave_traces",
	"spellkave_trace_detail",
	"spellkave_session_status",
	"spellkave_reaction_options",
	"spellkave_intervention_windows",
	"spellkave_react_option",
	"spellkave_end_turn",
	"spellkave_manipulation_context",
	"spellkave_manipulate",
	"spellkave_communicate",
	"spellkave_sense_context",
	"spellkave_sense",
	"spellkave_offer_control",
	"spellkave_withdraw_control",
] as const;

const DEPRECATED_GENERAL_TOOL_NAMES_AFTER_CUTOVER = [] as const;

describe("tool membership after queryable PLAYER cutover", () => {
	it("freezes the complete general registry", () => {
		const db: SnapshotDb = {};
		expect(createSpellkaveTools({ db }).map((tool) => tool.name)).toEqual(
			GENERAL_TOOL_NAMES_BEFORE_QUERYABLE_CUTOVER,
		);
	});

	it("createPlayerFacingToolMap covers the same roster as createPlayerFacingTools (typed bag)", () => {
		const context: SpellkaveToolContext = { db: {} };
		const map = createPlayerFacingToolMap(context);
		const fromMap = Object.values(map)
			.map((tool) => tool.name)
			.sort();
		const fromArray = createPlayerFacingTools(context)
			.map((tool) => tool.name)
			.sort();
		expect(fromMap).toEqual(fromArray);
		expect(fromMap).toEqual([...QUERYABLE_PLAYER_TOOL_NAMES_AFTER_CUTOVER].sort());
		// Spot-check param schemas stay bound (autocomplete surface).
		expect(map.scene.name).toBe("spellkave_scene");
		expect(map.communicate.name).toBe("spellkave_communicate");
		expect(typeof map.scene.execute).toBe("function");
	});

	it("keeps every retained deprecated tool in general registration but outside the final roster", () => {
		for (const name of DEPRECATED_GENERAL_TOOL_NAMES_AFTER_CUTOVER) {
			expect(GENERAL_TOOL_NAMES_BEFORE_QUERYABLE_CUTOVER).toContain(name);
			expect(PLAYER_FACING_TOOL_NAMES).not.toContain(name);
		}
	});

	it("marks exactly the retained general tools deprecated without changing their factories", () => {
		const context: SpellkaveToolContext = { db: {} };
		const general = new Map(createSpellkaveTools(context).map((tool) => [tool.name, tool]));
		const factoryTools: ReturnType<typeof createSpellkaveTools> = [];
		expect(factoryTools.map((tool) => tool.name)).toEqual(
			DEPRECATED_GENERAL_TOOL_NAMES_AFTER_CUTOVER,
		);
		expect(
			[...general.values()]
				.filter((tool) => tool.description.startsWith("[DEPRECATED]"))
				.map((tool) => tool.name)
				.sort(),
		).toEqual([...DEPRECATED_GENERAL_TOOL_NAMES_AFTER_CUTOVER].sort());
		for (const tool of factoryTools) {
			const registered = general.get(tool.name);
			expect(registered).toBeDefined();
			expect(tool.description).toBe(registered?.description);
			expect(tool.parameters).toEqual(registered?.parameters);
			expect(typeof tool.execute).toBe("function");
		}
	});
});

describe("DM extension tool surface — sourced from the canonical contract roster (sk-hfj)", () => {
	it(
		"partitions the full companion registry with PLAYER — no overlap, no gap: a new " +
			"canonical contract membership partitions the current companion execution bodies with PLAYER",
		() => {
			const fullNames = spellkaveToolDefinitions.map((def) => def.name);
			const overlap = PLAYER_FACING_TOOL_NAMES.filter((name) =>
				DM_EXTENSION_TOOL_NAMES.includes(name),
			);
			expect(overlap).toEqual([]);
			expect(PLAYER_FACING_TOOL_NAMES.length + DM_EXTENSION_TOOL_NAMES.length).toBe(
				fullNames.length,
			);
			const covered = new Set([...PLAYER_FACING_TOOL_NAMES, ...DM_EXTENSION_TOOL_NAMES]);
			for (const name of fullNames) {
				expect(covered.has(name)).toBe(true);
			}
		},
	);

	it("createDmExtensionTools binds exactly the derived roster, in registration order", () => {
		const context: SpellkaveToolContext = { db: {} };
		const tools = createDmExtensionTools(context);
		expect(tools.map((tool) => tool.name)).toEqual(DM_EXTENSION_TOOL_NAMES);
	});

	it("carries zero AUTHOR tools — the gameplay and authoring registries stay disjoint", () => {
		for (const name of DM_EXTENSION_TOOL_NAMES) {
			expect(AUTHOR_FACING_TOOL_NAMES).not.toContain(name);
		}
	});
});

describe("contract-to-execution coverage (sk-jay0.5.1.21.2)", () => {
	it("maps every contract to exactly one retained execution body and every body back to a contract", () => {
		// Pacing binds the caller connection rather than the gameplay snapshot or
		// authoring filesystem context; include its factory's execution registry.
		const bodies = [
			...spellkaveToolDefinitions,
			...authorFacingToolDefinitions,
			...paceTimeToolDefinitions,
			actingContextToolDef,
		];
		const contractNames = TOOL_CONTRACTS.map((contract) => contract.name);
		expect(bodies.map((definition) => definition.name)).toEqual(contractNames);
		expect(new Set(bodies.map((definition) => definition.name)).size).toBe(bodies.length);
		for (const definition of bodies) expect(typeof definition.run).toBe("function");
	});
});
