// embedded-manifest: {"category":"production_schema_constructor","rationale":"Compile-time interfaces describe the strict opt-in DM carrier data validated by shared Rust; they contain no authored world instances or grants.","signatures":["schema_shape"]}
/** Carrier data types. Shared Rust schemas perform authoritative admission. */
export interface DmDutySource {
	schema_version: number;
	bundle_id: string;
	body_key: string;
	quest_prerequisites: DmDutyQuestPrerequisite[];
	quest_board: DmDutyQuestBoard;
	layer_topology: DmDutyLayerTopology;
	routes: DmDutyRoutes;
	vessels: DmDutyVessels;
	persona: DmDutyPersona;
	creation: DmDutyCreation<DmDutyJobKit>;
	advancement: DmDutyAdvancement;
	dialog: DmDutyDialog;
	companions: DmDutyCompanions;
	watches: DmDutyWatches;
	srd: DmSrdTables;
}
export interface DmDutyDocument {
	schema_version: number;
	bundle_id: string;
	body_key: string;
	quest_prerequisites: DmDutyQuestPrerequisite[];
	quest_board: DmDutyQuestBoard;
	layer_topology: DmDutyLayerTopology;
	catalog_namespace: string;
	catalog_content_hash: string;
	catalog_publication_id: string;
	presentation_content_hash: string;
	routes: DmDutyRoutes;
	vessels: DmDutyVessels;
	persona: DmDutyPersona;
	creation: DmDutyCreation<DmDutyRuntimeKit>;
	advancement: DmDutyAdvancement;
	dialog: DmDutyDialog;
	companions: DmDutyCompanions;
	watches: DmDutyWatches;
	srd: DmSrdTables;
	content_hash: string;
	publication_id: string;
}
export interface DmDutyQuestBoard {
	quest_refs: string[];
}
export interface DmDutyLayerTopology {
	ordered_ids: string[];
	companion_offer_id: string;
	quest_board_id: string;
	companion_yields_to: string[];
}
export interface DmDutyQuestPrerequisite {
	quest_ref: string;
	requires_rewarded_quests: string[];
}
export interface DmDutyRoutes {
	region_binding_id: string;
	creation_binding_id: string;
	advancement_binding_id: string;
	graph_author_binding_id: string;
	bundle_author_binding_id: string;
}
export interface DmDutyVessels {
	candidate_key: string;
	candidate_blueprint_id: string;
	creation_station_node_id: string;
	rest_node_id: string;
	hero_resolution: string;
	party_companion_keys: string[];
}
export interface DmDutyPersona {
	slug: string;
	tag: string;
	niche_id: string;
	applied_level_state_id: string;
}
export interface DmDutyCreation<K> {
	open_seat_action_id: string;
	open_action_id: string;
	finish_action_id: string;
	induct_action_id: string;
	identify: DmDutyIdentify;
	text: DmDutyTextActions;
	pending: DmDutyPending;
	kit_granted_state_id: string;
	kit_granted_value: number;
	wizard: DmDutyWizard;
	guide: DmDutyGuide;
	sheet_sets: DmDutySheetSet[];
	classes: DmDutyClass[];
	species: DmDutyOrigin[];
	backgrounds: DmDutyOrigin[];
	training: DmDutyTraining;
	kits: K[];
	starter_kit: DmDutyStarterKit;
	input_field_keys: { name: string; appearance: string; backstory: string };
	presentation_vocabulary: DmDutyCreationPresentationVocabulary;
	observation_vocabulary: DmDutyObservationVocabulary;
	limits: DmDutyLimits;
}
export interface DmDutyIdentify {
	class_action_id: string;
	species_action_id: string;
	background_action_id: string;
}
export interface DmDutyTextActions {
	name_action_id: string;
	appearance_action_id: string;
	backstory_action_id: string;
}
export interface DmDutyPending {
	scores: DmDutyPendingField;
	name: DmDutyPendingField;
	appearance: DmDutyPendingField;
	backstory: DmDutyPendingField;
}
export interface DmDutyPendingField {
	condition_id: string;
	open_action_id: string;
	close_action_id: string;
}
export interface DmDutyAbilityState {
	ability: string;
	aliases: string[];
	state_id: string;
}
/** The order of the creation questions (`ledger/designs/guided-dialogue-tree.md`). */
export interface DmDutyGuide {
	steps: DmDutyGuideStep[];
}
export interface DmDutyGuideStep {
	id: string;
	title: string;
	source?: string;
	options?: { id: string; label: string; description?: string; ref?: string }[];
	pick?: { min: number; max: number };
	input?: string;
	show_when?: { answered: string } | { unanswered: string };
	depends_on?: string[];
	reopen?: boolean;
	paged?: boolean;
	announce_remaining?: boolean;
	listed?: boolean;
}
export interface DmDutyWizard {
	confirm_token: string;
	discard_action_id: string;
	back_action_id: string;
	forward_action_id: string;
	enter_name_action_id: string;
	describe_appearance_action_id: string;
	describe_backstory_action_id: string;
	set_scores_action_id: string;
	adopt_scores_action_id: string;
	adopt_name_action_id: string;
	adopt_appearance_action_id: string;
	adopt_backstory_action_id: string;
	phase_state_id: string;
	phase_actions: DmDutyValueAction[];
}
export interface DmDutyValueAction {
	value: number;
	action_id: string;
}
export interface DmDutySheetSet {
	state_id: string;
	set_action_id: string;
	clear_action_id: string;
}
export interface DmDutyClass {
	slug: string;
	identity_tag: string;
	entity_definition_id: string;
	pick_token: string;
	advance_action_id: string;
	sheet_action_id: string;
	advancement_tags: DmDutyAdvancementTag[];
	catalog: DmDutyClassCatalog;
}
export interface DmDutyAdvancementTag {
	level: number;
	tag: string;
	missing_capability_definitions: string[];
}
export interface DmDutyClassCatalog {
	classSlug: string;
	skills: DmDutySkills;
	choiceGroups: DmDutyChoiceGroup[];
	cantripsKnown: number;
	cantripOptions: DmDutySpellOption[];
	preparedCount: number;
	preparedOptions: DmDutySpellOption[];
	kit: DmDutyKitMenu;
	equipmentChoices: DmDutyEquipmentMenu[];
}
export interface DmDutySkills {
	chooseN: number;
	skillNames: string[];
	skillCapabilityIds: string[];
	sourceText: string;
}
export interface DmDutyChoiceGroup {
	choiceGroup: string;
	chooseN: number;
	memberCapabilityIds: string[];
	/** The definition each member grants, parallel to `memberCapabilityIds` (optional before sk-jay0.1.76.19.20). */
	memberGrantRefs?: string[];
	recommended: string | null;
	rechoose: string;
}
export interface DmDutySpellOption {
	slug: string;
	capabilityId: string;
	definitionRef: string | null;
	displayName: string;
}
export interface DmDutyKitMenu {
	options: DmDutyKitOption[];
	sourceText: string;
}
export interface DmDutyKitOption {
	letter: string;
	description: string;
}
export interface DmDutyEquipmentMenu {
	letter: string;
	sourceText: string;
	usesToolProficiency: boolean;
	options: DmDutyEquipmentOption[];
}
export interface DmDutyEquipmentOption {
	entityDefId: string;
	displayName: string;
	proficiencyCapabilityId: string | null;
}
export interface DmDutyOrigin {
	slug: string;
	identity_tag: string;
	pick_token: string;
	definition_ref: string;
}
export interface DmDutyTraining {
	skill: DmDutyTrainingKind;
	choice_member: DmDutyTrainingKind;
	cantrip: DmDutyTrainingKind;
	prepared_spell: DmDutyTrainingKind;
	proficiency: DmDutyTrainingKind;
	origin_feat: DmDutyTrainingKind;
}
export interface DmDutyTrainingKind {
	action_id: string | null;
	members: DmDutyTrainingMember[];
}
export interface DmDutyTrainingMember {
	capability_id: string;
	feature_tag: string;
	availability: string;
}
export interface DmDutyKitChoice {
	source_text: string;
	entity_definition_id: string;
}
export interface DmDutyRuntimeKit {
	class_slug: string;
	letter: string;
	choices: DmDutyKitChoice[];
	action_id: string;
}
export interface DmDutyJobKit {
	class_slug: string;
	letter: string;
	choices: DmDutyKitChoice[];
	action_id: string;
	items: DmDutyKitItem[];
}
export interface DmDutyKitItem {
	entity_definition_id: string;
	count: number;
	parent_index: number | null;
	slot_id: string | null;
}
export interface DmDutyStarterKit {
	bundle_id: string;
	weapon_definition_id: string;
	weapon_slot_id: string;
	field_kit_definition_id: string;
	torch_definition_id: string;
	rations_definition_id: string;
}
export interface DmDutyObservationVocabulary {
	class_tag_prefix: string;
	menu_tokens: DmDutyMenuTokens;
	speech_trace_kind_id: string;
	drafting_condition_id: string;
	level_state_id: string;
	hp_state_id: string;
	xp_state_id: string;
	appearance_state_id: string;
	backstory_state_id: string;
	ability_states: DmDutyAbilityState[];
	speed_state_id: string;
}
/** Observed candidate speech syntax, never executable authority. */
export interface DmDutyMenuTokens {
	namespace_prefix: string;
	array_adopt_token: string;
	class_prefix: string;
	species_prefix: string;
	background_prefix: string;
	skill_prefix: string;
	choice_prefix: string;
	cantrip_prefix: string;
	prepared_prefix: string;
	kit_prefix: string;
	parsed_scores_prefix: string;
	parsed_name_prefix: string;
	parsed_appearance_prefix: string;
	parsed_backstory_prefix: string;
	codecs: {
		slug: "ascii-lowercase-hyphen/v1";
		reference: "js-dot-plus/v1";
		choice: "base64url-utf8-lossy/v1";
		kit: "ascii-uppercase-one/v1";
		adopted_text: "lowercase-hex-utf8-fatal/v1";
	};
	score_digits: number;
	score_ability_order: string[];
}
export interface DmDutyLimits {
	point_buy_min: number;
	point_buy_max: number;
	point_buy_budget: number;
	max_name_chars: number;
	max_appearance_chars: number;
	max_backstory_chars: number;
}
export interface DmDutyAdvancement {
	max_level: number;
	enroll_action_id: string;
	offer_action_id: string;
	apply_action_id: string;
	draft_open_action_id: string;
	draft_close_action_id: string;
	accepted_state_id: string;
	pending_hp_state_id: string;
	accept_action_id: string;
	decline_action_id: string;
	steady_action_id: string;
	daring_action_id: string;
	confirm_action_id: string;
	discard_action_id: string;
	ask_action_id: string;
	phase_condition_id: string;
	telepathy_action_id: string;
	teleport_action_id: string;
	return_action_id: string;
	limbo_node_id: string;
	return_node_id: string;
	draft_opener_policy: string;
}
export interface DmDutyDialog {
	say_action_id: string;
	speech_action_id: string;
	open_state_id: string;
	prompt_state_id: string;
	ask_menu_actions: DmDutyValueAction[];
	open_actions: DmDutyValueAction[];
	prompt_actions: DmDutyValueAction[];
	choice_actions: DmDutyValueAction[];
	runtime_prompt_selector: number;
	slot_count: number;
}
export interface DmDutyCompanions {
	offer: DmDutyCompanionOffer;
	rogue: DmDutyRogue;
	level_sync_keys: string[];
}
export interface DmDutyCompanionOffer {
	accept_slot: number;
	decline_slot: number;
	open_count: number;
	minimum_level: number;
	agreement_state_id: string;
	accept_action_id: string;
	decline_action_id: string;
	reopen_action_id: string;
	reopen_terms: string[];
}
export interface DmDutyRogue {
	entity_key: string;
	blueprint_id: string;
	spawn_node_id: string;
	agreement_state_id: string;
	spawned_state_id: string;
	join_action_id: string;
	initial_level: number;
	resume_level: number;
	hp_at_resume_level: number;
}
export interface DmDutyWatches {
	initiative: DmDutyInitiative;
	kill_xp: DmDutyKillXp;
	quest_xp: DmDutyQuestXp;
	bond: DmDutyBond;
	threshold: DmDutyThreshold;
	quest_loot_enabled: boolean;
	labels: DmDutyWatchLabels;
}
export interface DmDutyInitiative {
	mode: string;
	binding_id: string;
	call_action_id: string;
	session_definition_id: string;
	trigger_capability_ids: string[];
	party_tag_id: string;
	hostile_tag_id: string;
	hostile_actor_keys: string[];
}
export interface DmDutyKillXp {
	dead_condition_id: string;
	dead_condition_suffix: string;
	xp_value_state_id: string;
	xp_state_id: string;
	spend_action_id: string;
	award_action_id: string;
}
export interface DmDutyQuestXp {
	quest_refs: string[];
	recipient_policy: string;
}
export interface DmDutyBond {
	companion_key: string;
	stone_definition_id: string;
	carried_state_id: string;
	recorded_state_id: string;
	companion_bonded_state_id: string;
	bond_condition_id: string;
	record_action_id: string;
	mark_action_id: string;
}
export interface DmDutyThreshold {
	hero_policy: string;
}
export interface DmDutyWatchLabels {
	log_prefix: string;
	initiative_handle: string;
	kill_xp_handle: string;
	quest_xp_handle: string;
	bond_handle: string;
	threshold_handle: string;
}
export interface DmSrdTables {
	classes: DmSrdClass[];
	species: DmSrdSpecies[];
	backgrounds: DmSrdBackground[];
	skills: DmSrdSkill[];
	xp_thresholds: Record<string, number>;
	point_costs: Record<string, number>;
	caster_profiles: DmSrdCasterProfile[];
	caster_payloads: Record<string, DmSrdCasterPayload>;
	spell_slot_grants: DmSrdSlotGrant[];
}
export interface DmSrdClass {
	slug: string;
	displayName: string;
	primaryAbilityText: string;
	skillProficienciesText: string;
	startingEquipmentText: string;
	hitDieSize: number;
	level1HpBase: number;
	fixedHpPerLevelBase: number;
	unarmoredDefenseExtraAbility: string | null;
	standardArray: Record<string, number>;
	sourcePk: string;
}
export interface DmSrdSpecies {
	slug: string;
	displayName: string;
	speedCells: number;
}
export interface DmSrdBackground {
	slug: string;
	displayName: string;
	skillCapabilityIds: string[];
	featEntityId: string;
}
export interface DmSrdSkill {
	slug: string;
	displayName: string;
}
export interface DmSrdCasterProfile {
	classSlug: string;
	classDisplayName: string;
	ability: string;
	abilityAnchor: string;
	featureSlug: string;
	featureAnchor: string;
	ritualCasting: boolean;
	classSourcePk: string;
}
export interface DmSrdCasterPayload {
	class: string;
	ability: string;
	feature: string;
	ritual_casting: boolean;
	prepared_spells_by_level: Record<string, number>;
	cantrips_known_by_level?: Record<string, number> | null;
}
export interface DmSrdSlotGrant {
	classSlug: string;
	level: number;
	slotLevel: number;
	count: number;
}
export interface DmPresentationContent {
	schema_version: number;
	voice: DmPresentationVoice;
	creation: DmPresentationCreation;
	level_up: DmPresentationLevelUp;
	companion_offer: DmPresentationCompanionOffer;
	quest_board: { lines: Record<string, DmPresentationQuestLines> };
	telepathic_invitation: string;
}
export interface DmPresentationQuestLines {
	greeting: string;
	accept: string;
	decline: string;
	complete?: string;
}
export interface DmPresentationVoice {
	display_name: string;
	persona_name: string;
	persona_slug: string;
	possessive: string;
	referral_name: string;
	return_place_name: string;
}
export interface DmPresentationLevelUp {
	class_flavour: DmPresentationTemplate;
	offer_with_class_flavour: DmPresentationTemplate;
	explanation: string;
	direction: string;
	offer: string;
	acknowledgement: string;
	closing: string;
}
export interface DmPresentationLabel {
	rule: string;
	summary: string;
}
export interface DmPresentationSpeech {
	rule: string;
	summary: string;
	line: string;
}
export interface DmPresentationCompanionOffer {
	offer: DmPresentationSpeech;
	accepted: DmPresentationSpeech;
	declined: DmPresentationSpeech;
	agreement_accept: DmPresentationLabel;
	agreement_decline: DmPresentationLabel;
	agreement_reopen: DmPresentationLabel;
	open_answers: DmPresentationLabel;
	close_answers: DmPresentationLabel;
	react_abstain: DmPresentationLabel;
	agreement_unavailable: DmPresentationLabel;
	apply_pending: DmPresentationLabel;
	idle: DmPresentationLabel;
}
export interface DmPresentationCreation {
	welcome: string;
	class_acknowledgement: DmPresentationTemplate;
	species_acknowledgement: DmPresentationTemplate;
	background_acknowledgement: DmPresentationTemplate;
	confirm_rejection: DmPresentationTemplate;
	class_array_proposal: DmPresentationTemplate;
	ability_drafting_paths_offer: string;
	slot_menu_offer: DmPresentationTemplate;
	name_contract_offer: string;
	scores_adopt_acknowledgement: DmPresentationTemplate;
	closing: string;
	name_readback: DmPresentationTemplate;
	name_unparseable: string;
	appearance_readback: DmPresentationTemplate;
	appearance_unparseable: string;
	backstory_readback: DmPresentationTemplate;
	backstory_unparseable: string;
	parse_readback: DmPresentationTemplate;
	parse_unparseable: string;
	parse_unaffordable: DmPresentationTemplate;
	progress_ready: string;
	progress_missing: DmPresentationTemplate;
}
export interface DmLocatorReferenceLocators {
	schema_version: number;
	ruleset_bundle_id: string;
	creation_sheet_action_prefix: string;
	spell_definition_prefix: string;
	spell_capability_prefix: string;
	cantrip_capability_suffix: string;
	prepared_spell_capability_suffix: string;
	feature_tag_prefix: string;
	metadata_attachments_table: string;
	capability_definitions_table: string;
	entity_definitions_table: string;
	entity_definition_tag_table: string;
	advancement_grant_namespace: string;
	advancement_choice_namespace: string;
	advancement_grant_target_kind: string;
	spellcasting_profile_namespace: string;
	spell_slot_grant_namespace: string;
	equipment_proficiency_namespace: string;
	equipment_proficiency_target_kind: string;
	spell_list_tags: DmLocatorSpellListTag[];
	spell_level_tag_prefix: string;
	spell_level_tags: DmLocatorSpellLevelTag[];
	equipment_category_tags: DmLocatorEquipmentCategoryTags;
	equipment_category_phrases: DmLocatorEquipmentCategoryPhrases;
}
export interface DmLocatorSpellListTag {
	class_slug: string;
	tag: string;
}
export interface DmLocatorSpellLevelTag {
	level: number;
	tag: string;
}
export interface DmLocatorEquipmentCategoryTags {
	instrument: string;
	artisan: string;
}
export interface DmLocatorEquipmentCategoryPhrases {
	instrument: string;
	artisan: string;
}
export interface DmBinding {
	binding_id: string;
	role_id: string;
	extent_kind_ref: string;
	extent_ref: string;
	description: string;
}
export interface DmSightGrant {
	capability_id: string;
	extent_kind_ref: string;
	extent_ref: string;
	elevation_class: string;
}
export interface DmPrincipalPlan {
	schema_version: number;
	bundleId: string;
	bodyKey: string;
	bindings: DmBinding[];
	retiredBindings: DmBinding[];
	sightGrants: DmSightGrant[];
	fictionCapabilities: string[];
	seatCapability: string;
	roleCapabilities: Record<string, string[]>;
}
export interface DmReads {
	reader_role_id: string;
	reader_binding_id: string;
	catalog_read_capability_id: string;
	duty_read_capability_id: string;
	presentation_read_capability_id: string;
}
export type DmPresentationTemplate = (
	| { kind: "text"; text: string }
	| { kind: "value"; name: string }
)[];

export interface DmDutyCreationMenuLabels {
	class: string;
	background: string;
	species: string;
	skill: string;
	cantrip: string;
	prepared_spell: string;
	starting_kit: string;
	name: string;
	ability_scores: string;
	confirmation: string;
}
export interface DmDutyCreationPresentationTemplates {
	count_kind: string;
	kit_option: string;
	equipment_page: string;
	equipment_more: string;
	adopt_name: string;
	adopt_array: string;
	confirm: string;
	remaining_one: string;
	remaining_many: string;
	answer_option: string;
}
export interface DmDutyCreationMissingPhrases {
	class: string;
	background: string;
	species: string;
	name: string;
	skills: string;
	kit: string;
}
export interface DmDutyCreationListVocabulary {
	empty: string;
	pair_separator: string;
	separator: string;
	last_separator: string;
}
export interface DmDutyCreationTextFieldAliases {
	name: string[];
	appearance: string[];
	backstory: string[];
}
export interface DmDutyCreationPresentationVocabulary {
	menu_labels: DmDutyCreationMenuLabels;
	templates: DmDutyCreationPresentationTemplates;
	missing_phrases: DmDutyCreationMissingPhrases;
	list: DmDutyCreationListVocabulary;
	spoken_confirm_aliases: string[];
	spoken_discard_aliases: string[];
	text_field_aliases: DmDutyCreationTextFieldAliases;
}
