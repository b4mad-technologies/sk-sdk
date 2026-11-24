import { parse, stringify } from "smol-toml";
import { authoredSessionFixture } from "./authored-session-fixture";
import { header, probeAct } from "./privileged-acts-fixture";
import {
	CAP_CHOOSE,
	CAP_SET_OPEN,
	CAP_SET_PROMPT,
	choiceId,
	KIT,
	OPEN,
	PROMPT,
	promptKitSource,
	TALKER_TAG,
} from "./scene-live/prompt-kit";

export { promptKitSource };
export function fixture(bundle: string, identity: string): string {
	const doc = parse(authoredSessionFixture(bundle, identity, identity));
	delete doc.schema_version;
	const list = (key: string) => {
		doc[key] ??= [];
		return doc[key] as Record<string, unknown>[];
	};
	list("bundles")[0]!.depends_on = ["core", KIT];
	Object.assign(list("combat_grid_blueprints")[0]!, { width: 10, height: 10 });
	list("session_definitions").push({
		...list("session_definitions").find((r) => r.session_def_id === `${bundle}/session`),
		session_def_id: `${bundle}/terminating-session`,
		termination_pred: "world.tick > session.stat('opened_at')",
	});
	list("condition_definitions").push({
		bundle_id: bundle,
		condition_definition_id: `${bundle}/marker`,
		display_name: "Retention marker",
		stacking_rule: "core/stacking/single",
		remove_time_policy: "core/remove_policy/reference_counted",
		gate_predicate_source: "",
		modifier_template_id: "",
		observable: true,
		hooks: [],
		implies: [],
	});
	// Keep the authored graph's ejection anchor outside its own deleted nodes.
	list("place_graphs").find((r) => r.place_graph_id === `${bundle}/village`)!.anchor_node_id =
		`${bundle}/forest/root`;
	list("place_graphs").find((r) => r.place_graph_id === `${bundle}/village`)!.parent_graph_id =
		`${bundle}/forest`;
	for (const graph of ["forest", "village"]) {
		const edge_key = `${bundle}/${graph}/retained-edge`;
		list("place_edges").push({
			bundle_id: bundle,
			edge_key,
			place_graph_id: `${bundle}/${graph}`,
			from_node_id: `${bundle}/${graph}/root`,
			to_node_id: `${bundle}/${graph}/clearing`,
		});
		for (const affordance_template_id of [
			"core/affordance/traverse_open_portal",
			`${bundle}/multi/affordance`,
		])
			list("place_edge_affordance").push({ edge_key, affordance_template_id });
	}
	list("role_bindings").push({
		bundle_id: bundle,
		binding_id: `${bundle}/village-dm`,
		role_id: "dm",
		subject: identity,
		extent_kind_ref: "place_graph",
		extent_ref: `${bundle}/forest`,
		description: "Owned teardown and external-anchor proof",
	});
	const tag = `core.${bundle}_talker`;
	list("entity_tag").push(
		...[TALKER_TAG, tag, "srd.player_character"].map((tag) => ({
			bundle_id: bundle,
			entity_key: `${bundle}/foe`,
			tag,
			source: "manifest",
		})),
	);
	for (const capability of [CAP_SET_OPEN, CAP_SET_PROMPT])
		list("actor_capabilities").push({
			bundle_id: bundle,
			actor_entity_key: `${bundle}/foe`,
			capability_id: capability,
			source: "manifest",
		});
	list("actor_capabilities").push({
		bundle_id: bundle,
		actor_entity_key: `${bundle}/hero`,
		capability_id: CAP_CHOOSE,
		source: "manifest",
	});
	list("object_state").push(
		...[OPEN, PROMPT].map((state_id) => ({
			bundle_id: bundle,
			entity_key: `${bundle}/foe`,
			state_id,
			value_int: 0,
			visibility: "Public",
			source_template_id: "manifest",
			expires_at_tick: 0,
		})),
	);
	list("prompt_definitions").push({
		bundle_id: bundle,
		prompt_def_id: `${bundle}/prompt`,
		source_selector: tag,
		open_predicate_source: `actor.stat('${OPEN}') >= 1 && actor.stat('${PROMPT}') == 9`,
		response_action_ids: [choiceId(1)],
		audience_kind_ref: "core/audience/broadcast",
		trace_window_ticks: 20,
		contract_version: 1,
	});
	list("action_definitions").push({
		bundle_id: bundle,
		action_id: `${bundle}/react`,
		display_name: "Retention intervention",
		required_capability: "core/inspect",
		on_success: `${bundle}/react/success`,
		resolution_mode: "Deterministic",
		reaction_eligibility: "actor.has_capability('core/inspect')",
		reaction_trigger:
			"$event.kind == 'r_manipulate' && $event.detail.phase == 'resolution' && $event.detail.stochastic == 'true'",
		reaction_window_ms: 60000,
	});
	list("consequence_templates").push({ bundle_id: bundle, template_id: `${bundle}/react/success` });
	for (const source of [
		probeAct(bundle, "windowed", "core/inspect", [], undefined, true),
		probeAct(bundle, "child-one", "core/inspect", []),
		probeAct(bundle, "child-two", "core/inspect", []),
		probeAct(bundle, "multi", "core/inspect", []),
		probeAct(bundle, "despawn", "frontier.despawn", [], {
			primitive: "Despawn",
			parameters: { target_ref: { kind: "place_graph", id: `${bundle}/village` } },
		}),
	]) {
		const probe = parse(source);
		delete probe.schema_version;
		for (const [key, value] of Object.entries(probe)) {
			if (!Array.isArray(value)) throw new Error(`unexpected probe root ${key}`);
			list(key).push(...(value as Record<string, unknown>[]));
		}
	}
	list("affordance_templates").find(
		(r) => r.template_id === `${bundle}/multi/affordance`,
	)!.composes = [`${bundle}/child-one/affordance`, `${bundle}/child-two/affordance`];
	return header + stringify(doc);
}

export function expiringClaim(bundle: string, target: string): string {
	return probeAct(bundle, "claim", "frontier.afflict", [
		{
			ApplyStatus: {
				target_kind: "entity",
				target_ref: target,
				condition_definition_id: `${bundle}/marker`,
			},
		},
	]);
}

export function stagedGate(bundle: string): string {
	return (
		header +
		stringify({
			place_edges: [
				{
					bundle_id: bundle,
					edge_key: `${bundle}/staged-edge`,
					place_graph_id: `${bundle}/forest`,
					from_node_id: `${bundle}/forest/root`,
					to_node_id: `${bundle}/forest/clearing`,
				},
			],
			place_edge_affordance: [
				{
					edge_key: `${bundle}/staged-edge`,
					affordance_template_id: "core/affordance/traverse_open_portal",
				},
			],
		})
	);
}
