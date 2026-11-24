/**
 * Shared pieces of the kernel doc-contract live tests (`doc-contract-*.local-node.test.ts`).
 *
 * Each test builds its own prefixed scene, then adds the mechanic DEFINITIONS it proves
 * (capability, niche, affordance, outcome, consequence, action, resources) as one extras delta
 * under the scene's own bundle, so ids are scene-private and a second run on the same database
 * passes. Actions are dispatched through the SDK `ActorClient` (the same wrapper the PLAYER
 * `spellkave_manipulate` tool calls), inside a pattern `act`.
 */

import {
	type ActorClient,
	type ActorManipulateResult,
	createActorClient,
	READER_SCOPED_TABLES,
	readObjectStateInt,
} from "@spellkave/sdk";
import type { SnapshotDb } from "@spellkave/sdk/replay";
import { stringify } from "smol-toml";
import { syncConnection, type TestWorld } from "../live";
import type { Verdict } from "../patterns";
import type { Scene, SceneHero } from "../scene";
import { applySceneExtras, entityKey } from "./support";

/** Rows of one extras delta, by manifest table. */
export class Rows {
	private readonly tables: Record<string, Record<string, unknown>[]> = {};

	constructor(readonly prefix: string) {}

	add(table: string, ...rows: Record<string, unknown>[]): this {
		const list = this.tables[table] ?? [];
		// These child tables carry no `bundle_id` column.
		const own = ![
			"consequence_frame_writes",
			"entity_containment",
			"place_edge_affordance",
		].includes(table);
		for (const row of rows) list.push(own ? { bundle_id: this.prefix, ...row } : row);
		this.tables[table] = list;
		return this;
	}

	toml(): string {
		return stringify(this.tables);
	}

	apply(scene: Scene, dependsOn: readonly string[] = ["core"]): Promise<void> {
		return applySceneExtras(scene, this.toml(), dependsOn);
	}
}

/** The scene-private id of a definition or entity named `name`. */
export const sid = (prefix: string, name: string): string => `${prefix}/${name}`;

export interface SelfActionSpec {
	/** Scene-local name of the action; also names its niche, capability and templates. */
	name: string;
	/** Place node the niche is attached at; omit to leave the niche unattached (the G4 control). */
	attachAt?: readonly string[];
	/** Grant a capability named `<name>_cap` (default true). */
	capability?: boolean;
	predicateSource?: string;
	predicateBool?: boolean;
	extraFrameWrites?: readonly Record<string, unknown>[];
	/** Resource the validator-required trailing ModifyResource bumps (MF-VAL-263). */
	budgetResource: string;
	/** Default true; false defines a plain (non self-eligible) action. */
	selfEligible?: boolean;
	/** Niche shared with another action of the scene (skips defining it again). */
	nicheName?: string;
	/** An existing niche id (for example `core/owned_item`): neither defined nor attached here. */
	nicheId?: string;
	/** Do not append the budget bump (an action whose consequence is not self-eligible). */
	noBudget?: boolean;
}

/** Every row of one action chain: capability -> niche -> affordance -> outcome -> consequence -> action. */
export function addSelfAction(rows: Rows, spec: SelfActionSpec): void {
	const p = rows.prefix;
	const id = sid(p, spec.name);
	const capability = spec.capability !== false;
	const capId = `${id}_cap`;
	const nicheId = spec.nicheId ?? sid(p, spec.nicheName ?? `${spec.name}_niche`);
	if (capability) {
		rows.add("capability_definitions", {
			capability_id: capId,
			actor_kind: "entity",
			display_name: spec.name,
			description: "doc-contract probe capability",
		});
	}
	if (spec.nicheName === undefined && spec.nicheId === undefined) {
		rows.add("niche_definitions", {
			niche_id: nicheId,
			display_name: spec.name,
			description: "doc-contract probe niche",
			// Place-provided: the niche exists only where a spatial_niche_attachment binds it.
			provider: "place",
		});
		for (const place of spec.attachAt ?? []) {
			rows.add("spatial_niche_attachments", {
				niche_id: nicheId,
				place_node_id: place,
				condition_bool: true,
				ecological_invariant: false,
				visibility: "Public",
			});
		}
	}
	rows.add("outcome_templates", {
		outcome_template_id: `${id}/outcome`,
		consequence_template_id: `${id}/consequence`,
		display_name: spec.name,
		manipulation_action_id: id,
		outcome_bool: true,
		sense_visibility: "local",
	});
	rows.add("affordance_templates", {
		template_id: `${id}/affordance`,
		niche_id: nicheId,
		capability_id: capability ? capId : "",
		display_name: spec.name,
		...(spec.predicateBool === true
			? { predicate_bool: true }
			: { predicate_source: spec.predicateSource ?? "" }),
		outcome_template_id: `${id}/outcome`,
		range_m: 0,
	});
	rows.add("consequence_templates", { template_id: `${id}/consequence` });
	const frameWrites = [
		...(spec.extraFrameWrites ?? []),
		...(spec.noBudget === true
			? []
			: [
					{
						ModifyResource: {
							actor: "TargetActor",
							resource: spec.budgetResource,
							delta_source: "1",
						},
					},
				]),
	];
	frameWrites.forEach((frame_write, ordinal) => {
		rows.add("consequence_frame_writes", {
			template_id: `${id}/consequence`,
			ordinal,
			frame_write,
		});
	});
	rows.add("action_definitions", {
		action_id: id,
		required_capability: capability ? capId : "",
		on_success: `${id}/consequence`,
		display_name: spec.name,
		cost_time_ms: 500,
		resolution_mode: "Deterministic",
		self_eligible: spec.selfEligible !== false,
	});
}

/** An integer resource pool and the per-actor `object_state` row that seeds it (a definition's initial value is only its bound). */
export function addPool(
	rows: Rows,
	name: string,
	options: { min?: number; max: number; seedFor: readonly { entity: string; value: number }[] },
): string {
	const id = sid(rows.prefix, name);
	rows.add("resource_definitions", {
		resource_definition_id: id,
		display_name: name,
		value_kind: "int",
		min_value: options.min ?? 0,
		max_value: options.max,
		initial_value: 0,
		recovery_rule: "persistent",
	});
	for (const seed of options.seedFor) {
		rows.add("object_state", {
			entity_key: entityKey(rows.prefix, seed.entity),
			state_id: id,
			source_template_id: entityKey(rows.prefix, seed.entity),
			value_int: seed.value,
			value_bool: true,
			visibility: "Public",
			expires_at_tick: 0,
		});
	}
	return id;
}

/** Restate a scene body in an extras delta (a delta validates on its own, so rows that name it need it). */
export function restateBody(
	scene: Scene,
	name: string,
	at: string,
	def = "core/creature/wolf",
): Record<string, unknown> {
	return {
		entity_key: entityKey(scene.prefix, name),
		entity_def_id: def,
		name,
		kind: "npc",
		place_node_id: scene.reads.nodeId(at),
	};
}

export interface Actor {
	hero: SceneHero;
	client: ActorClient;
}

/** Subscribe a hero's own connection, sync it, and wrap it in an ActorClient. */
export async function actorOf(scene: Scene, name: string): Promise<Actor> {
	const hero = scene.heroOf(name);
	await hero.world.subscribeReaders([{ requiredTables: READER_SCOPED_TABLES }]);
	await syncConnection(hero.world);
	const client = createActorClient(hero.world.conn, String(hero.entityId), {
		successOnProvenance: true,
		observationTimeoutMs: 8_000,
	});
	return { hero, client };
}

/** `r_manipulate` through the SDK client: the server's verdict arrives as data (`rejected` is not a throw). */
export function manipulate(
	actor: Actor,
	targetRef: string,
	actionId: string,
): Promise<ActorManipulateResult<null>> {
	return actor.client.manipulate(
		targetRef,
		actionId,
		"{}",
		() => false,
		() => null,
	);
}

export const selfRef = (actor: Actor): string => `entity:${actor.hero.entityId}`;

/** The rejection detail the server recorded for a refused manipulation (empty for a success). */
export function failureDetail(result: ActorManipulateResult<null>): string {
	return (
		(result.provenance as { failure_detail?: string | null } | undefined)?.failure_detail ?? ""
	);
}

/** One integer object state as one connection's own cache holds it. */
export function stateOf(world: TestWorld, entityId: bigint, stateId: string): number | null {
	const value = readObjectStateInt(world.db() as unknown as SnapshotDb, {
		targetKind: "entity",
		targetId: String(entityId),
		stateId,
	});
	return value === null ? null : Number(value);
}

/** Grant capabilities to a scene body (the body must be restated in the same delta). */
export function grantCapabilities(
	rows: Rows,
	body: string,
	capabilityIds: readonly string[],
): void {
	for (const capability_id of capabilityIds) {
		rows.add("actor_capabilities", {
			actor_entity_key: entityKey(rows.prefix, body),
			capability_id,
			source: rows.prefix,
		});
	}
}

/**
 * Status and recorded failure detail of a manipulation verdict. A reducer refusal that reached the
 * test as an error (`ok: false`) reads as `rejected`, the same as the client's `rejected` result.
 */
export function outcomeOf(verdict: Verdict<ActorManipulateResult<null>>): {
	status: string;
	detail: string;
} {
	return verdict.ok
		? { status: verdict.value.status, detail: failureDetail(verdict.value) }
		: { status: "rejected", detail: verdict.error.message };
}

export function show(value: unknown): string {
	return JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}
