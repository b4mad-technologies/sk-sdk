export const PRESENT_GROUPS = 'participant_tag_group_count("faction:")';
export const STANDING_GROUPS =
	'participant_tag_group_count("faction:", "core/condition/incapacitated")';

export const COMBAT_TERMINATION_PREDICATE = `${PRESENT_GROUPS} >= 2 && ${STANDING_GROUPS} <= 1`;
export const COMBAT_WINNER_PREDICATE = `${STANDING_GROUPS} == 1`;
