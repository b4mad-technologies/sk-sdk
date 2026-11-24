import { compose_grant_json, grant_delta_json } from "@spellkave/authoring-wasm";
import { composeGrantWith, grantDeltaWith } from "./grants-core";

export type { GrantInput, GrantRow } from "./grants-core";
export const composeGrant = (
	...args: Parameters<typeof composeGrantWith> extends [unknown, ...infer T] ? T : never
) => composeGrantWith(compose_grant_json, ...args);
export const grantDelta = (
	...args: Parameters<typeof grantDeltaWith> extends [unknown, ...infer T] ? T : never
) => grantDeltaWith(grant_delta_json, ...args);
