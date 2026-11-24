// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "One generated kit bundle (latch setters, numbered answers, directed message, edge gate) is applied once per run; per-test scene prefixes parameterize the prompt definitions, tags and latch rows that exercise the prompt-occurrence gates."}
// ci-allow(embedded-manifest-schema): private-scene manifest assembler - TOML built from runtime fragments, not a standalone manifest
/**
 * Prompt kit for the scene live tests: a small, generic "talker" vocabulary
 * (open-count and prompt-id latches, numbered answers, a directed message)
 * that mirrors the shape of a quest giver's dialog slots without any adventure
 * or SRD content. The kit bundle is applied ONCE by `seed.ts`; every test then
 * builds a private scene on top of it (`buildPromptScene`) and authors its own
 * `prompt_definition` rows, so no test edits shared definitions.
 *
 * Why a kit: the ADR-0142 prompt-occurrence gates need an NPC that opens a
 * prompt (state change), a hero that answers it by speech act, and a directed
 * trace. The original live files borrowed Aldwin and the srd/dm bundles for
 * that; the kernel behaviour does not depend on them.
 */

import { createActorClient, READER_SCOPED_TABLES, readManipulationContext } from "@spellkave/sdk";
import { readRecentTraces } from "@spellkave/sdk/readers";
import { stringify } from "smol-toml";
import { operatorScopeManifest, waitForEvent } from "../live";
import type { Scene, SceneHero } from "../scene";
import { scene } from "../scene";
import { applySceneExtras, entityKey, liveWorldRef } from "./support";

export const KIT = "sdk_prompt_kit";
export const OPEN = `${KIT}/open`;
export const PROMPT = `${KIT}/prompt`;
export const CAP_SET_OPEN = `${KIT}/cap/set-open`;
export const CAP_SET_PROMPT = `${KIT}/cap/set-prompt`;
export const CAP_CHOOSE = `${KIT}/cap/choose`;
export const CAP_TELL = `${KIT}/cap/tell`;
export const CAP_DOOR_KEY = `${KIT}/cap/door-key`;
export const CAP_WATCH = `${KIT}/cap/watch`;
export const DOOR_AFFORDANCE = `${KIT}/affordance/door`;
export const DOOR_NICHE = `${KIT}/niche/door`;
export const TALKER_TAG = "core.prompt_talker";
export const PARTY_TAG = "core.prompt_party";
export const TRACE_KIND = `${KIT}/speech`;
export const choiceId = (n: number): string => `${KIT}/choice/${n}`;
export const setOpenId = (n: number): string => `${KIT}/open/set/${n}`;
export const setPromptId = (n: number): string => `${KIT}/prompt/set/${n}`;
export const TELL_ID = `${KIT}/tell`;

/** Open counts and prompt ids the kit can set. */
export const OPEN_VALUES = [0, 1, 2] as const;
export const PROMPT_VALUES = [0, 5, 6, 9] as const;
export const CHOICES = [1, 2] as const;

/** Prompt ids a scene's definitions use (`dm/dialog/prompt` analogue). */
export const PROMPT_A_VALUE = 5;
export const PROMPT_B_VALUE = 6;
export const PROMPT_BROADCAST_VALUE = 9;

type Table = Record<string, unknown>;

/** The kit bundle as TOML. Pure; unit-testable. */
export function promptKitSource(): string {
	const doc: Record<string, Table[]> = {};
	const push = (table: string, row: Table): void => {
		const list = doc[table] ?? [];
		list.push(row);
		doc[table] = list;
	};
	const B = { bundle_id: KIT };

	push("bundles", {
		...B,
		display_name: "Scene-live prompt kit",
		author: "spellkave-test",
		version: "1.0.0",
		depends_on: ["core"],
	});

	for (const [id, label] of [
		[OPEN, "Open answers"],
		[PROMPT, "Open prompt id"],
	] as const) {
		push("resource_definitions", {
			...B,
			description: `${label} latch of a scene talker. The talker sets it on itself.`,
			display_name: label,
			initial_value: 0,
			max_value: 16,
			min_value: 0,
			recovery_rule: "persistent",
			resource_definition_id: id,
			value_kind: "int",
		});
	}

	push("trace_kind_definitions", {
		...B,
		description: "A spoken utterance or answer inscribed at a place, optionally with an addressee.",
		kind_id: TRACE_KIND,
		location_kinds: "place_node",
		perceptible_for_ticks: 0,
		schema_json: '{"text":"string","addressee":"integer?","action_id":"string?"}',
	});

	for (const [cap, label] of [
		[CAP_SET_OPEN, "Set open answers"],
		[CAP_SET_PROMPT, "Set open prompt"],
		[CAP_CHOOSE, "Choose an answer"],
		[CAP_TELL, "Tell"],
		[CAP_DOOR_KEY, "Door key"],
		[CAP_WATCH, "Watch a place graph (read-only extent)"],
	] as const) {
		push("capability_definitions", {
			...B,
			actor_kind: "entity",
			capability_id: cap,
			default_visibility: "Public",
			description: label,
			display_name: label,
		});
	}

	push("niche_definitions", {
		...B,
		description: "A body that offers numbered answers. Entity-provided via the talker tag.",
		display_name: "Prompt talker",
		niche_id: `${KIT}/niche/talker`,
		predicate_source: `target.has_niche('${TALKER_TAG}')`,
		provider: "entity",
	});
	push("niche_definitions", {
		...B,
		description: "A body that can be addressed by a directed message.",
		display_name: "Prompt party member",
		niche_id: `${KIT}/niche/party`,
		predicate_source: `target.has_niche('${PARTY_TAG}')`,
		provider: "entity",
	});
	for (const cap of [CAP_SET_OPEN, CAP_SET_PROMPT]) {
		push("niche_definitions", {
			...B,
			description: "Self-only: the actor's own capability carries the verb.",
			display_name: `Actor-carried ${cap}`,
			niche_id: `capability:${cap}`,
			predicate_source: "",
			provider: "actor",
		});
	}

	const action = (id: string, display: string, cap: string, extra: Table = {}): void => {
		push("action_definitions", {
			...B,
			action_id: id,
			cost_time_ms: 0,
			description: display,
			display_name: display,
			non_steering: true,
			on_failure: "",
			on_success: `${id}/success`,
			required_capability: cap,
			resolution_mode: "Deterministic",
			resolution_predicate_source: "",
			resumable: false,
			self_eligible: false,
			self_only: false,
			session_def_id: "",
			...extra,
		});
		push("consequence_templates", { ...B, description: display, template_id: `${id}/success` });
	};
	const affordance = (
		id: string,
		display: string,
		cap: string,
		niche: string,
		extra: Table,
	): void => {
		push("affordance_templates", {
			...B,
			accepts_global_storm: false,
			capability_id: cap,
			display_name: display,
			locality_class: "",
			movement_cost_expression_source: "",
			niche_id: niche,
			outcome_template_id: `${id}/outcome`,
			predicate_bool: false,
			predicate_source: "",
			range_m: 0.0,
			reads_occupancy: false,
			stratification_ok: true,
			template_id: `${id}/affordance`,
			...extra,
		});
	};
	const outcome = (id: string, display: string, speech: boolean): void => {
		push("outcome_templates", {
			...B,
			...(speech ? { communication_speech_act_id: id } : {}),
			consequence_template_id: "",
			display_name: display,
			manipulation_action_id: id,
			outcome_bool: true,
			outcome_template_id: `${id}/outcome`,
			sense_visibility: "local",
		});
	};

	// Self-only latch setters: delta = target - current, so the talker's row must
	// exist first (the scene authors it at 0).
	for (const n of OPEN_VALUES) {
		const id = setOpenId(n);
		action(id, `Set answers open (${n})`, CAP_SET_OPEN, {
			non_steering: false,
			self_eligible: true,
			self_only: true,
		});
		affordance(id, `Set answers open (${n})`, CAP_SET_OPEN, `capability:${CAP_SET_OPEN}`, {
			predicate_bool: true,
		});
		outcome(id, `Set answers open (${n})`, false);
		push("consequence_frame_writes", {
			ordinal: 0,
			template_id: `${id}/success`,
			frame_write: {
				ModifyResource: {
					actor: "Actor",
					resource: OPEN,
					delta_source: `${n} - actor.stat('${OPEN}')`,
				},
			},
		});
	}
	for (const n of PROMPT_VALUES) {
		const id = setPromptId(n);
		action(id, `Set prompt (${n})`, CAP_SET_PROMPT, {
			non_steering: false,
			self_eligible: true,
			self_only: true,
		});
		affordance(id, `Set prompt (${n})`, CAP_SET_PROMPT, `capability:${CAP_SET_PROMPT}`, {
			predicate_bool: true,
		});
		outcome(id, `Set prompt (${n})`, false);
		push("consequence_frame_writes", {
			ordinal: 0,
			template_id: `${id}/success`,
			frame_write: {
				ModifyResource: {
					actor: "Actor",
					resource: PROMPT,
					delta_source: `${n} - actor.stat('${PROMPT}')`,
				},
			},
		});
	}

	// Numbered answers: speech acts at a talker whose open count covers the slot.
	for (const n of CHOICES) {
		const id = choiceId(n);
		action(id, `Answer ${n}`, CAP_CHOOSE);
		affordance(id, `Answer ${n}`, CAP_CHOOSE, `${KIT}/niche/talker`, {
			predicate_source: `target.stat('${OPEN}') >= ${n}`,
		});
		outcome(id, `Answer ${n}`, true);
		push("consequence_frame_writes", {
			ordinal: 0,
			template_id: `${id}/success`,
			frame_write: {
				Inscribe: {
					carry_addressee: true,
					carry_dispatch_text: true,
					kind: TRACE_KIND,
					location_kind: "binding",
					location_ref: "ActorSpatialRef",
					payload_json: JSON.stringify({ text: "", action_id: id }),
				},
			},
		});
	}

	// Directed message: inscribes a trace at the addressee's place naming them.
	action(TELL_ID, "Tell", CAP_TELL);
	affordance(TELL_ID, "Tell", CAP_TELL, `${KIT}/niche/party`, {
		predicate_bool: true,
		range_m: 50.0,
	});
	outcome(TELL_ID, "Tell", true);
	push("consequence_frame_writes", {
		ordinal: 0,
		template_id: `${TELL_ID}/success`,
		frame_write: {
			Inscribe: {
				carry_addressee: true,
				carry_dispatch_text: true,
				kind: TRACE_KIND,
				location_kind: "binding",
				location_ref: "TargetSpatialRef",
				payload_json: "{}",
			},
		},
	});

	// An edge gate: crossing needs the door-key capability. The empty outcome keeps it out
	// of ordinary movement selection (it only gates the edge it is attached to), and the
	// niche is synthetic: r_move injects it for the template under evaluation.
	push("affordance_templates", {
		...B,
		accepts_global_storm: false,
		capability_id: CAP_DOOR_KEY,
		display_name: "Cross the door",
		locality_class: "",
		movement_cost_expression_source: "",
		niche_id: DOOR_NICHE,
		outcome_template_id: "",
		predicate_bool: false,
		predicate_source: `actor.has_capability('${CAP_DOOR_KEY}') && target.has_niche('${DOOR_NICHE}')`,
		range_m: 0.0,
		reads_occupancy: false,
		stratification_ok: true,
		template_id: DOOR_AFFORDANCE,
	});

	return `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n${stringify(doc)}`;
}

// --- scene -----------------------------------------------------------------

export interface PromptScene {
	s: Scene;
	giver: SceneHero;
	hero: SceneHero;
	bystander: SceneHero;
	/** Tag the scene's prompt definitions select their source by. */
	selector: string;
	promptA: string;
	promptB: string;
	promptBroadcast: string;
}

export type PromptSceneBase = Omit<PromptScene, "bystander">;

export interface PromptSceneOptions {
	/** Author prompt B with these response ids / contract version (default `[choice 2]`, 1). */
	promptBResponses?: readonly string[];
	promptBContractVersion?: number;
	/** Place of the bystander. Default `far` (another place of the scene). */
	bystanderAt?: "hall" | "far";
}

function promptDefinitionRows(p: string, selector: string, options: PromptSceneOptions): Table[] {
	const row = (
		suffix: string,
		value: number,
		responses: readonly string[],
		audience: string,
		version: number,
	): Table => ({
		bundle_id: p,
		prompt_def_id: `${p}/prompt/${suffix}`,
		source_selector: selector,
		open_predicate_source: `actor.stat('${OPEN}') >= 1 && actor.stat('${PROMPT}') == ${value}`,
		response_action_ids: [...responses],
		audience_kind_ref: audience,
		trace_window_ticks: 20,
		contract_version: version,
		accepts_global_storm: false,
	});
	return [
		row("a", PROMPT_A_VALUE, [choiceId(1)], "core/audience/directed_trace", 1),
		row(
			"b",
			PROMPT_B_VALUE,
			options.promptBResponses ?? [choiceId(2)],
			"core/audience/directed_trace",
			options.promptBContractVersion ?? 1,
		),
		row("broadcast", PROMPT_BROADCAST_VALUE, [choiceId(1)], "core/audience/broadcast", 1),
	];
}

/**
 * Re-apply the scene's prompt definitions (and nothing else prompt-specific) so
 * a test can edit a definition under an open occurrence.
 */
export async function applyPromptDefinitions(
	ps: PromptSceneBase,
	options: PromptSceneOptions,
): Promise<void> {
	await applySceneExtras(
		ps.s,
		stringify({ prompt_definitions: promptDefinitionRows(ps.s.prefix, ps.selector, options) }),
		["core", KIT],
	);
}

/**
 * One scene: a hall and a far place; a talker (`giver`), an answering `hero` and,
 * by default, a `bystander`, all connected identities. Tests without audience
 * assertions can omit the bystander explicitly. The giver holds the latch
 * setters and the directed message, the others hold the answer capability.
 */
export function buildPromptScene(
	options: PromptSceneOptions & { withBystander: false },
): Promise<PromptSceneBase>;
export function buildPromptScene(
	options?: PromptSceneOptions & { withBystander?: true },
): Promise<PromptScene>;
export async function buildPromptScene(
	options: PromptSceneOptions & { withBystander?: boolean } = {},
): Promise<PromptSceneBase & { bystander?: SceneHero }> {
	const s = await scene(liveWorldRef(), undefined, { bundleDeps: ["core", KIT] });
	const p = s.prefix;
	s.place("hall")
		.place("far")
		.hero("giver", {
			at: "hall",
			capabilities: [CAP_SET_OPEN, CAP_SET_PROMPT, CAP_TELL],
		})
		.hero("hero", { at: "hall", capabilities: [CAP_CHOOSE, CAP_TELL] });
	const names = ["giver", "hero"];
	if (options.withBystander !== false) {
		s.hero("bystander", { at: options.bystanderAt ?? "far", capabilities: [CAP_CHOOSE] });
		names.push("bystander");
	}
	await s.apply();
	const selector = `core.${p}_talker`;
	const entities = names.map((name) => ({
		bundle_id: p,
		entity_key: entityKey(p, name),
		entity_def_id: "core/creature/wolf",
		name,
		kind: "npc",
		place_node_id: s.reads.nodeId(name === "bystander" ? (options.bystanderAt ?? "far") : "hall"),
	}));
	const tags = [
		...names.map((name) => ({
			bundle_id: p,
			entity_key: entityKey(p, name),
			tag: PARTY_TAG,
			source: "manifest",
		})),
		{ bundle_id: p, entity_key: entityKey(p, "giver"), tag: TALKER_TAG, source: "manifest" },
		{ bundle_id: p, entity_key: entityKey(p, "giver"), tag: selector, source: "manifest" },
	];
	const states = [OPEN, PROMPT].map((state_id) => ({
		bundle_id: p,
		entity_key: entityKey(p, "giver"),
		expires_at_tick: 0,
		source_template_id: "manifest",
		state_id,
		value_bool: true,
		value_int: 0,
		visibility: "Public",
	}));
	await applySceneExtras(
		s,
		stringify({
			entities,
			entity_tag: tags,
			object_state: states,
			prompt_definitions: promptDefinitionRows(p, selector, options),
		}),
		["core", KIT],
	);
	return {
		s,
		giver: s.heroOf("giver"),
		hero: s.heroOf("hero"),
		...(options.withBystander !== false ? { bystander: s.heroOf("bystander") } : {}),
		selector,
		promptA: `${p}/prompt/a`,
		promptB: `${p}/prompt/b`,
		promptBroadcast: `${p}/prompt/broadcast`,
	};
}

export type Semantic = { source_ref: string; occurrence_id: string };

export interface AttemptResult {
	status: string;
	failureKind: string | undefined;
}

/** Player-facing client of a hero: reads, manipulates, observes the server verdict. */
export function clientOf(hero: SceneHero) {
	return createActorClient(hero.world.conn, String(hero.entityId), { successOnProvenance: true });
}

/** Subscribe a hero to everything the prompt reads and the consumption table need. */
export async function subscribePromptReads(hero: SceneHero): Promise<void> {
	await hero.world.subscribeReaders([
		{ requiredTables: READER_SCOPED_TABLES },
		operatorScopeManifest(`prompt-kit:${hero.name}`, [
			"visible_prompt_consumption",
			"visible_trace",
		]),
	]);
}

export function promptsOf(hero: SceneHero) {
	const ctx = readManipulationContext(hero.world.db() as never, String(hero.entityId) as never);
	return ctx.status === "ready" ? (ctx.prompts ?? []) : [];
}

/** Wait until a prompt of `defId` (other than `exclude`) is in the hero's own projection. */
export async function waitForPrompt(hero: SceneHero, defId: string, exclude?: string) {
	let found: ReturnType<typeof promptsOf>[number] | undefined;
	await waitForEvent(
		hero.world,
		() => {
			found = promptsOf(hero).find(
				(row) =>
					row.prompt_def_id === defId && (exclude === undefined || row.occurrence_id !== exclude),
			);
			return found !== undefined;
		},
		`prompt '${defId}' appears in ${hero.name}'s own projection`,
	);
	if (found === undefined) throw new Error("unreachable");
	return found;
}

/** The server verdict of an action attempt, as the PLAYER client observes it. */
export async function attempt(
	hero: SceneHero,
	targetEntityId: bigint,
	actionId: string,
	semantic?: Semantic,
	extraArgs: Record<string, unknown> = {},
): Promise<AttemptResult> {
	const args = {
		...extraArgs,
		...(semantic === undefined ? {} : { semantic_context: semantic }),
	};
	const result = await clientOf(hero).manipulate(
		`entity:${targetEntityId}`,
		actionId,
		JSON.stringify(args),
		() => false,
		() => null,
	);
	return {
		status: result.status,
		failureKind: result.provenance?.failure_kind || undefined,
	};
}

/** Run one self-only latch setter on the giver. Throws unless the server accepted it. */
export async function giverSet(ps: PromptSceneBase, actionId: string): Promise<void> {
	const result = await attempt(ps.giver, ps.giver.entityId, actionId);
	if (result.status !== "success") {
		throw new Error(`giver '${actionId}' was not accepted: ${JSON.stringify(result)}`);
	}
}

/** Direct a message from `from` at `target`. */
export async function tell(from: SceneHero, target: SceneHero): Promise<void> {
	const result = await attempt(from, target.entityId, TELL_ID, undefined, {
		dispatch_text: "(a word arrives)",
	});
	if (result.status !== "success") {
		throw new Error(`${from.name} tell was not accepted: ${JSON.stringify(result)}`);
	}
}

/** Direct a message from the giver at `target`. */
export async function giverTell(ps: PromptSceneBase, target: SceneHero): Promise<void> {
	await tell(ps.giver, target);
}

const traceIds = (hero: SceneHero): Set<string> =>
	new Set(readRecentTraces(hero.world.db() as never, 200).map((t) => t.trace_id));

/**
 * Causal barrier without a debug reducer: `from` tells `to`, and this resolves once
 * `to` perceives that message. Updates reach one connection in commit order, so
 * everything committed before the message has already reached `to` when it returns.
 * Use it before asserting that something did NOT reach `to`.
 */
export async function barrier(from: SceneHero, to: SceneHero): Promise<void> {
	const before = traceIds(to);
	await tell(from, to);
	await waitForEvent(
		to.world,
		() =>
			readRecentTraces(to.world.db() as never, 200).some(
				(t) =>
					!before.has(t.trace_id) &&
					t.inscribed_by === String(from.entityId) &&
					(t.payload as { addressee?: number } | null)?.addressee === Number(to.entityId),
			),
		`${to.name} perceives the barrier message from ${from.name}`,
	);
}

export async function openPrompt(
	ps: PromptSceneBase,
	value: number,
	opts: { open?: number; tell?: SceneHero } = {},
): Promise<void> {
	if (opts.tell !== undefined) await giverTell(ps, opts.tell);
	await giverSet(ps, setOpenId(opts.open ?? 2));
	await giverSet(ps, setPromptId(value));
}

export async function closePrompt(ps: PromptSceneBase): Promise<void> {
	await giverSet(ps, setPromptId(0));
}
