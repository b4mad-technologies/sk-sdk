// Wire shapes of `spellkave_authoring::diff_apply` (`sk diff` / `sk apply`,
// ADR-0145). Shared by the node (`applyset.ts`) and browser tooling entries.

import type { ApplysetPartEntry, ApplysetPartSource } from "./applyset";

export interface ApplysetRootInfo {
	applyset: string | null;
	/** Include paths in the root's declaration order (relative to its directory). */
	includes: string[];
	/** Bundles the root declares (the ones exported for drift). */
	bundles: string[];
}

export type ApplysetBaseState = "known" | "unknown";

/** The server's applyset memory, as read through the live connection. */
export interface ApplysetMemory {
	export_hashes?: Array<{ kind: string; key: string; export_hash: string }>;
	root_path: string;
	generation: number;
	base_state: ApplysetBaseState;
	parts: Array<{ path: string; entries: ApplysetPartEntry[] }>;
}

export interface ApplysetExtentScope {
	publisher: boolean;
	bundle_extents: string[];
	memory: Array<{ applyset?: string; bundle_ids: string[] | null; entries: ApplysetPartEntry[] }>;
}

/** Public role facts and the connected sender's own live grants; no hidden subjects. */
export interface ApplysetAuthoritySnapshot {
	extent_shapes?: Record<string, string>;
	publisher: boolean;
	scoped: boolean;
	complete: boolean;
	tick: number;
	grants: Array<{
		capability_id: string;
		extent_kind_ref: string;
		extent_ref: string;
		expires_at_tick: number | null;
	}>;
	role_definitions: Array<{
		role_id: string;
		bundle_id: string;
		display_name: string;
		description: string;
		capability_ids: string[];
	}>;
	role_aggregations: Array<{
		role_id: string;
		bundle_id: string;
		description: string;
		capability_ids: string[];
	}>;
	capability_definitions: Array<{
		capability_id: string;
		bundle_id: string;
		actor_kind: string;
		display_name: string;
		description: string;
		default_visibility: string;
	}>;
	bindings: Array<{
		binding_id: string;
		bundle_id: string;
		role_id: string;
		extent_kind_ref: string;
		extent_ref: string;
		realised: boolean;
	}>;
}

export interface ApplysetAuthorityVerdict {
	kind: string;
	key: string;
	code: string | null;
	reason: string;
	binding_id: string | null;
	role_id: string | null;
	extent_kind_ref: string | null;
	extent_ref: string | null;
}

export interface ApplysetDiffInput {
	applying_identity?: string;
	force?: boolean;
	places_read?: boolean;
	not_exported?: Array<{ bundle_id: string; reason: string }>;
	/** The root: its file name and text. */
	root: ApplysetPartSource;
	/** The root path the server records (relative to the worktree root). */
	root_path: string;
	/** Include file texts keyed by the path the root declares. */
	files: Record<string, string>;
	memory: ApplysetMemory | null;
	prune: boolean;
	/** Dependency bundles, for validation only. */
	dependencies?: Array<{ root: ApplysetPartSource; fragments: ApplysetPartSource[] }>;
	/** Live exports, for drift information only and prune place reconstruction. */
	live?: Array<{ bundle_id: string; manifest_json: string }>;
	/** Owner-subscription places for prune `entities` / `actor_spatial_locations`. */
	live_places?: Array<{ kind: string; key: string; place_node_id: string }>;
	extent_scope?: ApplysetExtentScope;
	authority?: ApplysetAuthoritySnapshot;
}

export type ApplysetRowClass = "create" | "adopt" | "configure" | "move" | "prune" | "unchanged";
export type ApplysetLiveState = "same" | "drift" | "not_comparable";

export interface ApplysetClassifiedRow {
	world_changed?: { state: "yes" | "no" } | { state: "unknown"; reason: string };
	kind: string;
	key: string;
	bundle_id: string | null;
	class: ApplysetRowClass;
	part: string;
	from_part?: string;
	hash: string;
	live?: ApplysetLiveState;
}

export interface ApplysetDiagnostic {
	code: string;
	severity: string;
	message: string;
	path: string;
	hint?: string | null;
	details?: unknown;
}

export interface ApplysetWarning {
	code: string;
	message: string;
	details?: unknown;
}

export interface ApplysetDiffOutput {
	seal_drift_not_checked?: string[];
	conflicts: Array<{ kind: string; key: string; part: string; class: ApplysetRowClass }>;
	not_checked: Array<{ kind: string; key: string; reason: string }>;
	applyset: string;
	root_path: string;
	generation: number;
	base_state: ApplysetBaseState | null;
	rows: ApplysetClassifiedRow[];
	parts: Array<{ path: string; entries: ApplysetPartEntry[] }>;
	delta_toml: string;
	send: boolean;
	diagnostics: ApplysetDiagnostic[];
	warnings: ApplysetWarning[];
	values: Array<{ kind: string; key: string; part: string; live: string; file: string }>;
	live_only: Array<{ kind: string; key: string; bundle_id: string | null }>;
	extent_verdicts: Array<{ kind: string; key: string; code: string; owners: string[] }>;
	placement_server_decides: Array<{ kind: string; key: string; bundle_id: string | null }>;
	authority_verdicts?: ApplysetAuthorityVerdict[];
}
