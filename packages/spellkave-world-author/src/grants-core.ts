import type { compose_grant_json, grant_delta_json } from "@spellkave/authoring-wasm";

export interface GrantRow {
	binding_id: string;
	bundle_id: string;
	subject: string;
	role_id: string;
	extent_kind_ref: string;
	extent_ref: string;
	expires_at_tick: string | null;
	description: string;
	handover_note?: string | null;
}
export interface GrantInput {
	role: string;
	subject: string;
	extent_kind: string;
	extent: string;
	bundle?: string;
	expires_at_tick?: string;
	description?: string;
}
export function composeGrantWith(
	compose: typeof compose_grant_json,
	input: GrantInput,
	identity: string,
	existing: GrantRow[],
): GrantRow {
	return JSON.parse(compose(JSON.stringify({ input, identity, existing }))) as GrantRow;
}
export function grantDeltaWith(
	render: typeof grant_delta_json,
	rows: GrantRow[],
	revoke: string[] = [],
	instance?: string,
): string {
	return render(JSON.stringify({ rows, revoke, instance: instance ?? null }));
}
