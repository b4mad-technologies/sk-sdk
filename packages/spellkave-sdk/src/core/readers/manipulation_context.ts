// code-size-ceiling: 475 (private-applyset-baselines integration: retain DM condition/payload registrations and add secure read triplets; exact merged line count per ADR-0022 D-3. dm-acts-migration: join occurrence-bound audience trace presentation and declare its visible-trace subscription; prior 465 — role-scoped-world-read: admitted projection triplets, index derivation and paired runtime coverage; exact integrated line count. sk-jay0.1.46.3 shares DialoguePromptPresentation with the prompt row; prior 460 — sk-jay0.1.8.85.1 projects bounded author-published defaults; prior 433 — sk-jay0.2.33.15.9 adds the public advisory cue join; prior 405 — sk-jay0.1.23.36.11 unions target tags with the target's entity_definition_tag facts, same rule readSelfIdentity already applies to the self body; prior 382 — ADR-0142 D-6 adds the ManipulationPrompt.presentation join (readDialoguePromptPresentation); prior 371 — the ManipulationPrompt interface and its read leg; prior 340 — ADR-0139's factored reader joins independent action, target, participant, and template presentation facts.)
// Reader: ADR-0139's additive factored manipulation context.
//
// The personal context row is a lifecycle/readiness fact. Its descriptors are
// deliberately shared authored metadata from the existing public definition
// tables, rather than a copied perceiver × action cache. No output row claims
// that an action against any target is eligible: consumers construct one
// existing r_manipulate attempt and the reducer remains authoritative.

import type {
	ActionDefinitionRow as DbActionDefinitionRow,
	ActionDefinitionTagRow as DbActionDefinitionTagRow,
	AffordanceTemplateRow as DbAffordanceTemplateRow,
	EntityDefinitionTagRow as DbEntityDefinitionTagRow,
	EntityTagRow as DbEntityTagRow,
	ManipulationAvailableActionRow as DbManipulationAvailableActionRow,
	ManipulationContextRow as DbManipulationContextRow,
	ManipulationObservedTargetRow as DbManipulationObservedTargetRow,
	ManipulationParticipantBindingRow as DbManipulationParticipantBindingRow,
	ManipulationParticipantContextRow as DbManipulationParticipantContextRow,
	ManipulationPromptRow as DbManipulationPromptRow,
	NicheDefinitionRow as DbNicheDefinitionRow,
	NicheProviderDefinitionRow as DbNicheProviderDefinitionRow,
	OutcomeTemplateRow as DbOutcomeTemplateRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { targetRefToString } from "../reducers/transport";
import { asNumber, asString, buildEntitySummaryMap, resolveEntityId, rows } from "./_helpers";
import { actionDescriptionFields } from "./action_description";
import { type AffordanceCue, readAffordanceCues } from "./affordance_cue";
import { type AffordanceDefaults, readAffordanceDefaults } from "./affordance_defaults";
import { readAffordanceGroupMembership } from "./affordance_group_membership";
import { type AffordanceInputSchema, readAffordanceInputSchemas } from "./affordance_input";
import { readAffordanceDefinitionRefs } from "./affordance_reference";
import { readAudienceTracePresentation } from "./audience_trace_presentation";
import {
	type DialoguePromptPresentation,
	readDialoguePromptPresentation,
} from "./dialogue_prompt_presentation";
import { responseSlotFields } from "./trace_response";

export const requiredTables: RequiredTables<
	[
		"visible_manipulation_context",
		"visible_manipulation_available_action",
		"visible_manipulation_observed_target",
		"visible_manipulation_participant_context",
		"visible_manipulation_participant_binding",
		"visible_manipulation_prompt",
		"visible_trace",
		"action_definition",
		"action_definition_tag",
		"affordance_template",
		"outcome_template",
		"niche_definition",
		"niche_provider_definition",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"entity",
		"visible_entity_tag",
		"visible_entity_tag_coverage",
		"entity_definition_tag",
	]
> = [
	"visible_manipulation_context",
	"visible_manipulation_available_action",
	"visible_manipulation_observed_target",
	"visible_manipulation_participant_context",
	"visible_manipulation_participant_binding",
	"visible_manipulation_prompt",
	"visible_trace",
	"action_definition",
	"action_definition_tag",
	"affordance_template",
	"outcome_template",
	"niche_definition",
	"niche_provider_definition",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"entity",
	"visible_entity_tag",
	"visible_entity_tag_coverage",
	"entity_definition_tag",
];
registerReaderManifest({ requiredTables });

export interface ManipulationActionDescriptor {
	action_id: string;
	display_name: string;
	/** Public authored response syntax; never target eligibility. */
	response_slot?: number;
	/** When present, this action is dispatched through direct communication,
	 * not r_manipulate. The value comes from public authored outcome metadata,
	 * not an eager action×target offer. */
	communication_speech_act_id?: string;
	/** Shared author-owned classification facts, not a per-target offer. */
	tags: string[];
	/** Authored action-to-niche links with the open provider's public flags.
	 * This is not an action-target result; consumers use it only to rank a
	 * direct attempt from separately disclosed target and place facts. */
	niche_requirements: ManipulationNicheRequirement[];
	/** Public authored source templates behind this syntax fact. */
	template_ids: string[];
	/** World-public authored template prose, falling back to the action description. */
	description?: string;
	/** Public `ui.affordance_group` attachments on those templates. */
	groups: string[];
	/** Public `ui.affordance_input` on the first authored source template. */
	input?: AffordanceInputSchema;
	/** Exact `ui.affordance_reference` definition, when a source template authors one. */
	definition_ref?: string;
	/** Public `ui.affordance_cue` on the first authored source template. It is
	 * advisory presentation only: never eligibility or response context. */
	cue?: AffordanceCue;
	/** Resolved author-published draft values. They remain advisory: the client
	 * dispatches concrete arguments and the reducer revalidates them normally. */
	defaults?: ManipulationActionDefaults;
	self_only: boolean;
	self_eligible: boolean;
}

export interface ManipulationActionDefaults {
	target?: { target_ref: string; kind: "actor" | "reference" };
	input_values?: Record<string, string | number>;
	provenance: AffordanceDefaults["provenance"];
}

export interface ManipulationNicheRequirement {
	niche_id: string;
	requires_spatial_attachment: boolean;
	admits_targets_without_membership: boolean;
}

/** One disclosed, action-independent target reference. Its presence does not
 * claim that any action is currently legal against it. */
export interface ManipulationObservedTarget {
	target_fact_id: string;
	target_ref: string;
	/** Public tags only when this disclosed target is an entity: instance
	 * `entity_tag` UNION the target's `entity_definition_tag` (species/CR/
	 * alignment/…), the same union `readSelfIdentity` already applies to the
	 * self body — `entity_definition_tag` is public, so this discloses
	 * nothing the DB does not already serve. */
	tags: string[];
	/** Independently meaningful target niche memberships; not action matches. */
	niche_ids: string[];
}

/** A complete, disclosed participant expectation for one action. The token is
 * advisory discovery data; the server freshly resolves and validates it. */
export interface ManipulationParticipantContext {
	context_id: string;
	action_id: string;
	binding_count: number;
	bindings: Array<{ role_id: string; entity_id: string }>;
}

/** One disclosed dialogue-prompt fact (ADR-0142 D-6): an OPEN occurrence this
 * caller may answer — directed to them by name, or broadcast by a source they
 * currently observe. Not an eligibility claim: `r_manipulate`'s prompt gate
 * (ADR-0142 D-3) re-derives and re-checks the occurrence fresh at dispatch
 * time. `consumed` is scoped to this caller only. */
export interface ManipulationPrompt {
	occurrence_id: string;
	prompt_def_id: string;
	contract_version: number;
	/** The prompt's speaker, wire-shaped `"entity:<id>"` — the same form
	 * `IntentSemanticContext.source_ref` and the server's
	 * `ManipulationSemanticContextArg.source_ref` carry. */
	source_ref: string;
	response_action_ids: string[];
	opened_at_tick: number;
	consumed: boolean;
	/** Authored `dialogue.prompt` presentation for this `prompt_def_id`
	 * (`metadata_attachment`, public audience) — never eligibility data, see
	 * `readDialoguePromptPresentation`. Absent when the world authors none. */
	presentation?: DialoguePromptPresentation;
}

export type ManipulationContext =
	| { status: "unavailable" }
	| {
			status: "ready";
			schema_version: number;
			revision: number;
			actions: ManipulationActionDescriptor[];
			targets: ManipulationObservedTarget[];
			participants: ManipulationParticipantContext[];
			/** ADR-0142 D-6. Additive migration field, like `manipulationContext?:`
			 * on `PlayerOrientationView`: always populated by this reader, but
			 * optional on the type so a fixture built before this field existed
			 * (elsewhere in the monorepo) stays valid — SDK CLAUDE.md §7 favors
			 * "old shape -> new shape in one PR" for OWNED shapes; a required
			 * field here would instead force every unrelated consumer package to
			 * update in lockstep with this one. */
			prompts?: ManipulationPrompt[];
	  };

/**
 * Reads one caller-scoped context generation. Missing is unavailable, never an
 * empty palette; a ready context with no action descriptors is distinct and
 * valid. Returned actions are open authored ids and syntax/presentation facts,
 * not an action-target offer list.
 */
export function readManipulationContext(
	db: SnapshotDb,
	perceiverEntityId: EntityRef,
): ManipulationContext {
	const perceiverId = resolveEntityId(db, perceiverEntityId);
	if (perceiverId === undefined) return { status: "unavailable" };
	const context = rows<DbManipulationContextRow>(db, "visible_manipulation_context").find(
		(row) => row.perceiverEntityId === perceiverId,
	);
	if (context === undefined || !context.ready) return { status: "unavailable" };
	const availableActionFacts = new Map<string, { niches: Set<string>; templateIds: Set<string> }>();
	for (const row of rows<DbManipulationAvailableActionRow>(
		db,
		"visible_manipulation_available_action",
	).filter((row) => row.perceiverEntityId === perceiverId)) {
		const actionId = asString(row.actionId);
		availableActionFacts.set(actionId, {
			niches: new Set(row.nicheIds.map(asString)),
			templateIds: new Set((row.templateIds ?? []).map(asString)),
		});
	}

	const actionDescriptors = new Map<string, { communication_speech_act_id?: string }>();
	for (const row of rows<DbOutcomeTemplateRow>(db, "outcome_template")) {
		const actionId = asString(row.manipulationActionId).trim();
		if (!actionId) continue;
		const speechActId = asString(row.communicationSpeechActId).trim();
		// An action can carry both legacy fields. Communication is the more
		// specific transport contract and must survive the factored projection.
		actionDescriptors.set(
			actionId,
			speechActId ? { communication_speech_act_id: speechActId } : {},
		);
	}
	const tagsByAction = new Map<string, string[]>();
	const templatesById = new Map(
		rows<DbAffordanceTemplateRow>(db, "affordance_template").map((row) => [
			asString(row.templateId),
			row,
		]),
	);
	const groupsByTemplate = readAffordanceGroupMembership(db);
	const inputByTemplate = readAffordanceInputSchemas(db);
	const definitionByTemplate = readAffordanceDefinitionRefs(db);
	const cueByTemplate = readAffordanceCues(db);
	const defaultsByTemplate = readAffordanceDefaults(db, inputByTemplate);
	const visibleTargetRefs = new Set(
		rows<DbManipulationObservedTargetRow>(db, "visible_manipulation_observed_target")
			.filter((row) => row.perceiverEntityId === perceiverId)
			.map((row) => targetRefToString(row.targetRef)),
	);
	const resolveDefaults = (
		defaults: AffordanceDefaults,
	): ManipulationActionDefaults | undefined => {
		const target = defaults.target;
		const resolvedTarget =
			target?.kind === "actor"
				? { target_ref: `entity:${perceiverId}`, kind: "actor" as const }
				: target?.kind === "reference" && visibleTargetRefs.has(target.target_ref)
					? { target_ref: target.target_ref, kind: "reference" as const }
					: undefined;
		// An undisclosed exact reference is omitted, not reconstructed. A safe
		// field default on the same attachment may still be useful on its own.
		if (
			target?.kind === "reference" &&
			resolvedTarget === undefined &&
			defaults.input_values === undefined
		)
			return undefined;
		return {
			...(resolvedTarget === undefined ? {} : { target: resolvedTarget }),
			...(defaults.input_values === undefined ? {} : { input_values: defaults.input_values }),
			provenance: defaults.provenance,
		};
	};
	for (const row of rows<DbActionDefinitionTagRow>(db, "action_definition_tag")) {
		const actionId = asString(row.actionId);
		const tags = tagsByAction.get(actionId) ?? [];
		tags.push(asString(row.tag));
		tagsByAction.set(actionId, tags);
	}
	const tagsByEntity = new Map<string, string[]>();
	for (const row of rows<DbEntityTagRow>(db, "visible_entity_tag")) {
		const entityId = String(row.entityId);
		const tags = tagsByEntity.get(entityId) ?? [];
		tags.push(asString(row.tag));
		tagsByEntity.set(entityId, tags);
	}
	// Definition tags (species/CR/size/alignment/…) union onto each target's
	// instance tags, resolved via its `entity_def_id` — same rule
	// `readSelfIdentity` already applies to the self body.
	const tagsByDefId = new Map<string, string[]>();
	for (const row of rows<DbEntityDefinitionTagRow>(db, "entity_definition_tag")) {
		const entityDefId = asString(row.entityDefId);
		const tags = tagsByDefId.get(entityDefId) ?? [];
		tags.push(asString(row.tag));
		tagsByDefId.set(entityDefId, tags);
	}
	const entitySummaries = buildEntitySummaryMap(db);
	const providerIdByNiche = new Map<string, string>();
	for (const row of rows<DbNicheDefinitionRow>(db, "niche_definition")) {
		providerIdByNiche.set(asString(row.nicheId), asString(row.provider));
	}
	const providerFlagsById = new Map<
		string,
		Pick<
			ManipulationNicheRequirement,
			"requires_spatial_attachment" | "admits_targets_without_membership"
		>
	>();
	for (const row of rows<DbNicheProviderDefinitionRow>(db, "niche_provider_definition")) {
		providerFlagsById.set(asString(row.providerId), {
			requires_spatial_attachment: Boolean(row.requiresSpatialAttachment),
			admits_targets_without_membership: Boolean(row.admitsTargetsWithoutMembership),
		});
	}
	const nicheRequirement = (nicheId: string): ManipulationNicheRequirement => {
		const flags = providerFlagsById.get(providerIdByNiche.get(nicheId) ?? "");
		return {
			niche_id: nicheId,
			// Same fail-closed default as server NicheProviderFlags::default().
			requires_spatial_attachment: flags?.requires_spatial_attachment ?? true,
			admits_targets_without_membership: flags?.admits_targets_without_membership ?? false,
		};
	};
	const actions = rows<DbActionDefinitionRow>(db, "action_definition")
		// The actor-scoped fact is produced from r_manipulate's effective
		// capability fold. It limits syntax discovery without claiming that the
		// action is eligible against any target.
		.filter(
			(row) =>
				actionDescriptors.has(asString(row.actionId)) &&
				availableActionFacts.has(asString(row.actionId)),
		)
		.map((row) => {
			const actionId = asString(row.actionId);
			const actionFacts = availableActionFacts.get(actionId);
			const templateIds = [...(actionFacts?.templateIds ?? [])].sort((left, right) =>
				left.localeCompare(right),
			);
			const groups = [
				...new Set(
					templateIds.flatMap((templateId) => [...(groupsByTemplate.get(templateId) ?? [])]),
				),
			].sort((left, right) => left.localeCompare(right));
			const input = templateIds
				.map((templateId) => inputByTemplate.get(templateId))
				.find((schema) => schema !== undefined);
			const definition_ref = templateIds
				.map((templateId) => definitionByTemplate.get(templateId))
				.find((reference) => reference !== undefined);
			const cue = templateIds
				.map((templateId) => cueByTemplate.get(templateId))
				.find((value) => value !== undefined);
			const authoredDefaults = templateIds
				.map((templateId) => defaultsByTemplate.get(templateId))
				.find((value) => value !== undefined);
			const defaults =
				authoredDefaults === undefined ? undefined : resolveDefaults(authoredDefaults);
			return {
				action_id: actionId,
				...responseSlotFields(tagsByAction.get(actionId) ?? []),
				display_name: asString(row.displayName),
				...actionDescriptors.get(actionId),
				tags: [...new Set(tagsByAction.get(actionId) ?? [])].sort((left, right) =>
					left.localeCompare(right),
				),
				niche_requirements: [...(actionFacts?.niches ?? [])]
					.sort((left, right) => left.localeCompare(right))
					.map(nicheRequirement),
				template_ids: templateIds,
				...actionDescriptionFields(row.description, templateIds, templatesById),
				groups,
				...(input === undefined ? {} : { input }),
				...(definition_ref === undefined ? {} : { definition_ref }),
				...(cue === undefined ? {} : { cue }),
				...(defaults === undefined ? {} : { defaults }),
				self_only: Boolean(row.selfOnly),
				self_eligible: Boolean(row.selfEligible),
			};
		})
		.sort((left, right) => left.action_id.localeCompare(right.action_id));
	const targets = rows<DbManipulationObservedTargetRow>(db, "visible_manipulation_observed_target")
		.filter((row) => row.perceiverEntityId === perceiverId)
		.map((row) => {
			const targetRef = targetRefToString(row.targetRef);
			const entityId = targetRef.startsWith("entity:") ? targetRef.slice("entity:".length) : "";
			const entityDefId = entitySummaries.get(entityId)?.entity_def_id;
			const tags = new Set(tagsByEntity.get(entityId) ?? []);
			if (entityDefId !== undefined) {
				for (const tag of tagsByDefId.get(entityDefId) ?? []) tags.add(tag);
			}
			return {
				target_fact_id: asString(row.targetFactId),
				target_ref: targetRef,
				tags: [...tags].sort((left, right) => left.localeCompare(right)),
				niche_ids: [...new Set(row.nicheIds.map(asString))].sort((left, right) =>
					left.localeCompare(right),
				),
			};
		})
		.sort((left, right) => left.target_fact_id.localeCompare(right.target_fact_id));
	const bindingsByContext = new Map<number, Array<{ role_id: string; entity_id: string }>>();
	for (const row of rows<DbManipulationParticipantBindingRow>(
		db,
		"visible_manipulation_participant_binding",
	)) {
		const contextId = asNumber(row.contextId);
		const bindings = bindingsByContext.get(contextId) ?? [];
		bindings.push({ role_id: asString(row.roleId), entity_id: String(row.entityId) });
		bindingsByContext.set(contextId, bindings);
	}
	const participants = rows<DbManipulationParticipantContextRow>(
		db,
		"visible_manipulation_participant_context",
	)
		.filter((row) => row.perceiverEntityId === perceiverId)
		.map((row) => {
			const contextId = asNumber(row.contextId);
			return {
				context_id: `mpc:${contextId}`,
				action_id: asString(row.actionId),
				binding_count: asNumber(row.bindingCount),
				bindings: (bindingsByContext.get(contextId) ?? []).sort(
					(left, right) =>
						left.role_id.localeCompare(right.role_id) ||
						left.entity_id.localeCompare(right.entity_id),
				),
			};
		})
		.sort((left, right) => left.context_id.localeCompare(right.context_id));

	const presentationByPromptDefId = readDialoguePromptPresentation(db);
	const prompts = rows<DbManipulationPromptRow>(db, "visible_manipulation_prompt")
		.filter((row) => row.perceiverEntityId === perceiverId)
		.map((row) => {
			const promptDefId = asString(row.promptDefId);
			const presentation = readAudienceTracePresentation(
				db,
				String(row.audienceTraceId),
				row.responseActionIds.map(asString),
				presentationByPromptDefId.get(promptDefId),
			);
			return {
				occurrence_id: String(row.occurrenceId),
				prompt_def_id: promptDefId,
				contract_version: asNumber(row.contractVersion),
				source_ref: asString(row.sourceRef),
				response_action_ids: row.responseActionIds.map(asString),
				opened_at_tick: asNumber(row.openedAtTick),
				consumed: Boolean(row.consumed),
				...(presentation === undefined ? {} : { presentation }),
			};
		})
		.sort((left, right) => left.occurrence_id.localeCompare(right.occurrence_id));

	return {
		status: "ready",
		schema_version: asNumber(context.schemaVersion),
		revision: asNumber(context.revision),
		actions,
		targets,
		participants,
		prompts,
	};
}
