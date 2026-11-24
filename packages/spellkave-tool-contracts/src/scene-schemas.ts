import { Type } from "typebox";
export const RENDER_SCENE_TOOL = "spellkave_render_scene";
export const STAGE_SCENE_TOOL = "spellkave_stage_scene";
export const RENDER_SCENE_PARAMS = Type.Object(
	{
		package: Type.Record(Type.String(), Type.Unknown(), {
			description:
				"Resolved spellkave-scene/v1 data package; no executable templates or filesystem paths.",
		}),
		values: Type.Record(Type.String(), Type.Unknown(), {
			description: "Data values: anchor_id, optional bearing_deg and counts.",
		}),
		setup_name: Type.String({ pattern: "^[a-z0-9][a-z0-9._-]{0,63}$" }),
		dependencies: Type.Array(Type.String(), {
			maxItems: 32,
			description: "Resolved dependency TOML payloads for offline validation.",
		}),
	},
	{ additionalProperties: false },
);
export const STAGE_SCENE_PARAMS = Type.Object(
	{
		plan: Type.Record(Type.String(), Type.Unknown(), {
			description: "Unmodified plan from a connected render_scene preview.",
		}),
		expected_world_instance_id: Type.String({ minLength: 1 }),
	},
	{ additionalProperties: false },
);
