// Applyset part building and row identities (ADR-0145), computed in Rust
// (`spellkave-authoring`) and reached through wasm: TypeScript never derives a
// row's identity or hash itself (ADR-0144 D-5).

import {
	applyset_root_info_json,
	build_applyset_parts_json,
	classify_and_build_delta_json,
	live_manifest_row_identities_json,
	manifest_row_identities_json,
} from "@spellkave/authoring-wasm";
import type {
	ApplysetDiffInput,
	ApplysetDiffOutput,
	ApplysetRootInfo,
} from "./applyset-diff-types";

export type * from "./applyset-diff-types";

export interface ApplysetPartSource {
	/** Path relative to the root's directory; the root's own file name for the root. */
	path: string;
	toml: string;
}

export interface ApplysetPartEntry {
	kind: string;
	key: string;
	bundle_id: string | null;
	hash: string;
	export_hash?: string;
}

export interface ApplysetParts {
	applyset: string;
	root_path: string;
	parts: Array<{ path: string; entries: ApplysetPartEntry[] }>;
	duplicates: Array<{ kind: string; key: string; parts: string[]; identical: boolean }>;
	untrackable: Array<{ part: string; kind: string; count: number }>;
	/** A frame-write template whose blocks sit in more than one part (manifest-natural-keys 1.4). */
	split_sets: Array<{ kind: string; key: string; parts: string[] }>;
}

export interface ManifestRowIdentities {
	rows: ApplysetPartEntry[];
	/** `[kind, count]` for kinds without a registered key. */
	untrackable: Array<[string, number]>;
}

/** Parts of one applyset: the root and its include fragments in declaration order. */
export function buildApplysetParts(
	root: ApplysetPartSource,
	fragments: readonly ApplysetPartSource[],
): ApplysetParts {
	return JSON.parse(
		build_applyset_parts_json(JSON.stringify({ root, fragments })),
	) as ApplysetParts;
}

/** Row identities and semantic hashes of one root manifest or include fragment. */
export function manifestRowIdentities(toml: string, isRoot: boolean): ManifestRowIdentities {
	return JSON.parse(manifest_row_identities_json(toml, isRoot)) as ManifestRowIdentities;
}

/** The root's applyset name, include paths (declaration order) and declared bundles. */
export function applysetRootInfo(rootToml: string): ApplysetRootInfo {
	return JSON.parse(applyset_root_info_json(rootToml)) as ApplysetRootInfo;
}

/**
 * Classify the root's rows against the applyset memory and build the delta
 * (`sk diff` / `sk apply`, ADR-0145). All of it runs in Rust
 * (`spellkave-authoring` `diff_apply`); this is the JSON boundary only.
 */
export function classifyAndBuildDelta(input: ApplysetDiffInput): ApplysetDiffOutput {
	return JSON.parse(classify_and_build_delta_json(JSON.stringify(input))) as ApplysetDiffOutput;
}

/** Exact typed live identities, using the same Rust catalog as file identities. */
export function liveManifestRowIdentities(manifestJson: string): ManifestRowIdentities {
	return JSON.parse(live_manifest_row_identities_json(manifestJson)) as ManifestRowIdentities;
}
