import { Type } from "typebox";
export const GRANT_ROLE_TOOL = "spellkave_grant_role";
export const REVOKE_ROLE_TOOL = "spellkave_revoke_role";
export const LIST_GRANTS_TOOL = "spellkave_list_grants";
export const EXPORT_GRANTS_TOOL = "spellkave_export_grants";
export const GRANT_ROLE_PARAMS = Type.Object({
	role: Type.String(),
	subject: Type.String(),
	extent_kind: Type.String({ default: "place_graph" }),
	extent: Type.String(),
	expires_at_tick: Type.Optional(Type.String({ pattern: "^[0-9]+$" })),
	description: Type.Optional(Type.String()),
	bundle: Type.Optional(Type.String()),
});
export const REVOKE_ROLE_PARAMS = Type.Object({ binding_id: Type.String() });
export const LIST_GRANTS_PARAMS = Type.Object({
	subject: Type.Optional(Type.String()),
	role: Type.Optional(Type.String()),
	extent: Type.Optional(Type.String()),
});
export const EXPORT_GRANTS_PARAMS = Type.Object({ out: Type.Optional(Type.String()) });

export const PREPARE_HAND_OVER_TOOL = "spellkave_prepare_hand_over";
export const HAND_OVER_ROLE_TOOL = "spellkave_hand_over_role";
export const PREPARE_HAND_OVER_PARAMS = Type.Object({
	binding_id: Type.String(),
	subject: Type.String(),
});
export const HAND_OVER_ROLE_PARAMS = Type.Object({
	binding_id: Type.String(),
	subject: Type.String(),
	expected_digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
	expected_merged_role_digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
	expected_incarnation: Type.String({ minLength: 1, maxLength: 256 }),
	expected_revision: Type.String({ pattern: "^[0-9]+$" }),
	request_id: Type.String({ format: "uuid" }),
	reason: Type.String({ minLength: 1, maxLength: 1024 }),
});
