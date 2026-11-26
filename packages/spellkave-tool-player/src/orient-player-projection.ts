// PLAYER-tool projection of an orientation (sk-jay0.1.46.2, run 7 of
// sandbox/live-patch-loop): `spellkave_orient` used to embed the whole
// manipulation action registry in camelCase (32 KB of a 37 KB answer, 81
// rows the player "had to grep past every time") next to the snake_case
// rows every other tool speaks. The in-process `perceive()` view stays as it
// is — NPC brains rank on `nicheRequirements` flags and `templateIds` — and
// only the tool answer a model host reads is projected here:
//
//   - `view.manipulation_context` carries the SAME row shapes as
//     `spellkave_manipulation_context` (snake_case, so a prompt row copied
//     from either place is the same `semantic_context`).
//   - `actions` is bounded to {@link ORIENT_ACTIONS_LIMIT} rows chosen by a
//     fixed rank (answers to open prompts, then authored cues and defaults,
//     then input forms, then alphabetical), each row slimmed to the syntax a
//     player needs to compose an attempt. `actions_total`, `actions_more` and
//     `actions_by_niche` say what was left out; `spellkave_manipulation_context`
//     names every other action id and expands named rows (`action_ids`), and
//     its `detail: "full"` is the whole listing.
//   - `view.inventory` is dropped: the orientation already returns the same
//     page as its top-level `inventory`.
//
// Nothing here claims eligibility: the bounded rows are discovery facts in a
// different order, never an offer (ADR-0021).
import type { ManipulationActionDescriptor, ManipulationContext } from "@spellkave/sdk";

export const ORIENT_ACTIONS_LIMIT = 12;

/** One action row as the orientation shows it: composition syntax only. */
export type OrientPlayerAction = Pick<
	ManipulationActionDescriptor,
	| "action_id"
	| "display_name"
	| "communication_speech_act_id"
	| "description"
	| "input"
	| "defaults"
	| "cue"
	| "self_only"
> & {
	/** Authored action-to-niche links by id; the provider flags behind them
	 * are on the full `spellkave_manipulation_context` row. */
	niche_ids: string[];
};

export type OrientPlayerManipulationContext =
	| { status: "unavailable" }
	| {
			status: "ready";
			schema_version: number;
			revision: number;
			actions: OrientPlayerAction[];
			/** Rows in the full listing. */
			actions_total: number;
			/** Rows the bound left out; `spellkave_manipulation_context` names their ids. */
			actions_more: number;
			/** Every niche the full listing links an action to, with the number of
			 * actions behind it (an action with two niches counts in both). */
			actions_by_niche: { niche_id: string; count: number }[];
			full_listing: "spellkave_manipulation_context";
			targets: Extract<ManipulationContext, { status: "ready" }>["targets"];
			participants: Extract<ManipulationContext, { status: "ready" }>["participants"];
			prompts: NonNullable<Extract<ManipulationContext, { status: "ready" }>["prompts"]>;
	  };

/** Rows `spellkave_manipulation_context` shows in full by default. */
export const SUMMARY_ACTIONS_LIMIT = ORIENT_ACTIONS_LIMIT;
/** Upper bound on `action_ids` one summary read expands. */
export const SUMMARY_REQUESTED_ACTIONS_LIMIT = 25;

/**
 * The default `spellkave_manipulation_context` answer (sk-jay0.1.46.4,
 * sk-jay0.1.75). The full registry grows with every authored action the
 * actor's capabilities admit: a level-1 cleric on kavemouth lists 200 rows,
 * 100 KB of JSON, and a model host read that on every call. The summary keeps
 * what a player needs to compose the next attempt:
 *
 *   - `prompts`, `targets` and `participants` unchanged;
 *   - `actions`: the rows named in `action_ids`, then rows in the same fixed
 *     rank the orientation uses, bounded to {@link SUMMARY_ACTIONS_LIMIT}, each
 *     slimmed to composition syntax;
 *   - `more_action_ids`: the id of every action not shown as a row, so a
 *     player can name one in `action_ids` (or attempt it directly) without
 *     reading the registry.
 *
 * It is the same discovery data in a smaller cut, never an offer (ADR-0021).
 */
export type PlayerManipulationContextSummary =
	| { status: "unavailable" }
	| {
			status: "ready";
			detail: "summary";
			schema_version: number;
			revision: number;
			actions: OrientPlayerAction[];
			/** Rows in the full listing. */
			actions_total: number;
			/** Ids of the listed actions that are not in `actions`. */
			more_action_ids: string[];
			/** Requested `action_ids` the listing does not hold. */
			unknown_action_ids?: string[];
			/** How to read more than the summary. */
			more: string;
			targets: Extract<ManipulationContext, { status: "ready" }>["targets"];
			participants: Extract<ManipulationContext, { status: "ready" }>["participants"];
			prompts: NonNullable<Extract<ManipulationContext, { status: "ready" }>["prompts"]>;
	  };

const SUMMARY_MORE_HINT =
	'Pass action_ids to read the syntax rows of named actions, or detail="full" for the whole registry (large).';

function actionRank(
	action: ManipulationActionDescriptor,
	promptResponseIds: ReadonlySet<string>,
): [number, number, string] {
	if (promptResponseIds.has(action.action_id)) return [0, 0, action.action_id];
	if (action.cue !== undefined || action.defaults !== undefined) {
		return [1, action.cue?.rank ?? Number.MAX_SAFE_INTEGER, action.action_id];
	}
	if (action.input !== undefined && action.input.fields.length > 0) return [2, 0, action.action_id];
	return [3, 0, action.action_id];
}

function slimAction(action: ManipulationActionDescriptor): OrientPlayerAction {
	return {
		action_id: action.action_id,
		display_name: action.display_name,
		...(action.communication_speech_act_id === undefined
			? {}
			: { communication_speech_act_id: action.communication_speech_act_id }),
		...(action.description === undefined ? {} : { description: action.description }),
		...(action.input === undefined ? {} : { input: action.input }),
		...(action.defaults === undefined ? {} : { defaults: action.defaults }),
		...(action.cue === undefined ? {} : { cue: action.cue }),
		niche_ids: action.niche_requirements.map((requirement) => requirement.niche_id),
		self_only: action.self_only,
	};
}

function rankedActions(
	context: Extract<ManipulationContext, { status: "ready" }>,
): ManipulationActionDescriptor[] {
	const promptResponseIds = new Set(
		(context.prompts ?? []).flatMap((prompt) => prompt.response_action_ids),
	);
	return context.actions
		.map((action) => ({ action, rank: actionRank(action, promptResponseIds) }))
		.sort((left, right) => {
			for (let index = 0; index < 2; index += 1) {
				const delta = (left.rank[index] as number) - (right.rank[index] as number);
				if (delta !== 0) return delta;
			}
			return left.rank[2].localeCompare(right.rank[2]);
		})
		.map((entry) => entry.action);
}

export function manipulationContextSummaryForPlayer(
	context: ManipulationContext,
	options: { actionIds?: readonly string[]; limit?: number } = {},
): PlayerManipulationContextSummary {
	if (context.status !== "ready") return { status: "unavailable" };
	const requestedIds = [...new Set(options.actionIds ?? [])].slice(
		0,
		SUMMARY_REQUESTED_ACTIONS_LIMIT,
	);
	const byId = new Map(context.actions.map((action) => [action.action_id, action]));
	const requested = requestedIds.flatMap((id) => {
		const action = byId.get(id);
		return action === undefined ? [] : [action];
	});
	const unknown = requestedIds.filter((id) => !byId.has(id));
	const shownIds = new Set(requested.map((action) => action.action_id));
	const bound = Math.max(0, options.limit ?? SUMMARY_ACTIONS_LIMIT);
	const ranked = rankedActions(context)
		.filter((action) => !shownIds.has(action.action_id))
		.slice(0, Math.max(0, bound - requested.length));
	for (const action of ranked) shownIds.add(action.action_id);
	return {
		status: "ready",
		detail: "summary",
		schema_version: context.schema_version,
		revision: context.revision,
		actions: [...requested, ...ranked].map(slimAction),
		actions_total: context.actions.length,
		more_action_ids: context.actions
			.map((action) => action.action_id)
			.filter((id) => !shownIds.has(id)),
		...(unknown.length === 0 ? {} : { unknown_action_ids: unknown }),
		more: SUMMARY_MORE_HINT,
		targets: context.targets,
		participants: context.participants,
		prompts: context.prompts ?? [],
	};
}

export function orientManipulationContextForPlayer(
	context: ManipulationContext,
	limit: number = ORIENT_ACTIONS_LIMIT,
): OrientPlayerManipulationContext {
	if (context.status !== "ready") return { status: "unavailable" };
	const prompts = context.prompts ?? [];
	const ranked = rankedActions(context);
	const bound = Math.max(0, limit);
	const counts = new Map<string, number>();
	for (const action of context.actions) {
		for (const requirement of action.niche_requirements) {
			counts.set(requirement.niche_id, (counts.get(requirement.niche_id) ?? 0) + 1);
		}
	}
	return {
		status: "ready",
		schema_version: context.schema_version,
		revision: context.revision,
		actions: ranked.slice(0, bound).map(slimAction),
		actions_total: context.actions.length,
		actions_more: Math.max(0, context.actions.length - bound),
		actions_by_niche: [...counts.entries()]
			.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
			.map(([niche_id, count]) => ({ niche_id, count })),
		full_listing: "spellkave_manipulation_context",
		targets: context.targets,
		participants: context.participants,
		prompts,
	};
}

/**
 * The orientation as `spellkave_orient` answers it. `view` keeps every
 * in-process field except the camelCase `manipulationContext` (replaced by
 * `manipulation_context`) and the duplicated `inventory` page.
 */
export function orientationForPlayer<
	View extends { kind: string; manipulationContext?: unknown; inventory?: unknown },
>(
	orientation: { actorId: string; view: View; inventory: unknown; traces: unknown },
	context: ManipulationContext,
): {
	actorId: string;
	view:
		| Omit<View, "manipulationContext" | "inventory">
		| (Omit<View, "manipulationContext" | "inventory"> & {
				manipulation_context: OrientPlayerManipulationContext;
		  });
	inventory: unknown;
	traces: unknown;
} {
	const { manipulationContext: _camel, inventory: _page, ...rest } = orientation.view;
	const view =
		orientation.view.kind === "turn"
			? { ...rest, manipulation_context: orientManipulationContextForPlayer(context) }
			: rest;
	return {
		actorId: orientation.actorId,
		view,
		inventory: orientation.inventory,
		traces: orientation.traces,
	};
}
