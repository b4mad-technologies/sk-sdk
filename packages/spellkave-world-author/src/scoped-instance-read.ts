// embedded-manifest: {"category": "production_schema_constructor", "rationale": "admitted instance snapshots produce a transient schema envelope for the existing Rust comparable path", "signatures": ["schema_shape"]}
/** Shared projection over one detached caller-authenticated transaction snapshot. */
import type {
	OwnerDescribeAnswer,
	OwnerGetAnswer,
	ScopedInstanceRead,
	ScopedReadSource,
} from "@spellkave/tool-contracts";
import {
	describeManifestSchema,
	inspectManifest,
	liveManifestRowIdentities,
	manifestRowIdentities,
} from "@spellkave/world-author/tooling";
import { INSTANCE_ROW_KINDS } from "./filter-manifest-core";
import { createInstanceProjector, type OwnerSnapshot } from "./owner-instance-read";

export interface ScopedInstanceSnapshot {
	snapshot: OwnerSnapshot;
	source: ScopedReadSource;
}
export interface ScopedSnapshotPort {
	read(): Promise<ScopedInstanceSnapshot>;
	close(): void;
}
export function createScopedInstanceRead(port: ScopedSnapshotPort): ScopedInstanceRead {
	return {
		async get(input) {
			if (!(INSTANCE_ROW_KINDS as readonly string[]).includes(input.kind)) {
				return {
					ok: false,
					code: "usage",
					message: `kind '${input.kind}' is not read from a world by this tool`,
				};
			}
			try {
				const captured = await port.read();
				return answerWithSource(
					createInstanceProjector({
						snapshot: () => captured.snapshot,
						worldTick: () => BigInt(captured.source.tick),
					}).get(input),
					captured.source,
				);
			} catch {
				return {
					ok: false,
					code: "reader_unavailable",
					message: "caller-scoped instance reader unavailable",
				};
			}
		},
		async describe(input) {
			if (input.kind !== "entities")
				return {
					ok: false,
					code: "usage",
					message: "describe is defined for entities; use sk get",
				};
			try {
				const captured = await port.read();
				const answer = answerWithSource(
					createInstanceProjector({
						snapshot: () => captured.snapshot,
						worldTick: () => BigInt(captured.source.tick),
					}).describe(input),
					captured.source,
				);
				if (
					answer.ok &&
					["entities", "entity_containment"].some(
						(kind) => captured.source.coverage[kind] !== "complete",
					)
				) {
					answer.chain_end = { reason: "outside_read_scope" };
				}
				return answer;
			} catch {
				return {
					ok: false,
					code: "reader_unavailable",
					message: "caller-scoped instance reader unavailable",
				};
			}
		},
	};
}
function answerWithSource<T extends OwnerGetAnswer | OwnerDescribeAnswer>(
	answer: T,
	source: ScopedReadSource,
): T {
	if (!answer.ok) {
		if (answer.code === "unknown_key")
			return {
				...answer,
				source,
				code: "not_found_in_scope",
				message: "not found in admitted read scope",
			};
		return { ...answer, source };
	}
	return { ...answer, source };
}

/** Convert display rows to schema fields; identities/hashes remain Rust-owned. */
export function scopedComparableManifest(captured: ScopedInstanceSnapshot, bundle: string): string {
	const schema = describeManifestSchema() as {
		properties: Record<string, { items?: { $ref?: string } }>;
		definitions: Record<string, { properties?: Record<string, unknown> }>;
	};
	const projector = createInstanceProjector({
		snapshot: () => captured.snapshot,
		worldTick: () => BigInt(captured.source.tick),
	});
	const manifest = ['"schema_version":"1.0.0"'];
	for (const kind of INSTANCE_ROW_KINDS) {
		if (captured.source.coverage[kind] !== "complete") continue;
		const ref = schema.properties[kind]?.items?.$ref?.split("/").at(-1);
		const fields = ref ? schema.definitions[ref]?.properties : undefined;
		if (!fields) throw new Error(`no comparable schema for ${kind}`);
		const answer = projector.get({ kind, bundle, limit: 10_000, fields: Object.keys(fields) });
		if (!answer.ok) throw new Error(`scoped comparison projection unavailable: ${kind}`);
		const rows = (answer.rows ?? []).map((row) => {
			const entries = Object.entries(row).filter(
				([field, value]) => field in fields && value !== undefined,
			);
			return `{${entries
				.map(([field, value]) => {
					const property = fields[field] as { type?: string | string[] };
					const integer = property.type === "integer" || property.type?.includes("integer");
					// Display rows preserve i64/u64 as decimal strings. Emit their JSON
					// number token directly, avoiding a lossy JavaScript Number roundtrip.
					// Rust still validates the typed field and owns comparable hashing.
					if (integer && (typeof value === "string" || typeof value === "bigint")) {
						if (typeof value === "string" && !/^-?\d+$/.test(value))
							throw new Error(`invalid integer field ${field}`);
						return `${JSON.stringify(field)}:${BigInt(value).toString()}`;
					}
					return `${JSON.stringify(field)}:${JSON.stringify(value)}`;
				})
				.join(",")}}`;
		});
		manifest.push(`${JSON.stringify(kind)}:[${rows.join(",")}]`);
	}
	return `{${manifest.join(",")}}`;
}

/** Use Rust's storage-key catalog, including composite JSON keys, for admission checks. */
export function scopedComparableIdentities(captured: ScopedInstanceSnapshot, bundle: string) {
	return liveManifestRowIdentities(scopedComparableManifest(captured, bundle)).rows;
}

/** Inline writes have no applyset baseline. Permit only proven new supported rows;
 * replacements/retractions must use the baseline-aware applyset workflow. */
export function scopedInlineDeltaPreflight(
	toml: string,
	captured?: ScopedInstanceSnapshot,
): string | undefined {
	const manifest = inspectManifest(toml).manifest as Record<string, unknown>;
	const ids = manifestRowIdentities(toml, true);
	const retractions = (manifest.retractions ?? []) as Array<{ row_kind: string }>;
	const ordinary = ids.rows.filter((row) => row.kind !== "role_bindings");
	if (retractions.some((row) => row.row_kind === "entity")) return "scope_prune_unsupported";
	if (
		ids.untrackable.length ||
		retractions.some((row) => !["role_binding", "role_bindings"].includes(row.row_kind))
	)
		return "unchecked_scoped_write: missing_baseline";
	if (!ordinary.length) return undefined; // separate D-6 binding-only lane
	if (!captured) return "unchecked_scoped_write: reader_unavailable";
	const observations = new Map<string, ReturnType<typeof scopedComparableIdentities>>();
	for (const row of ordinary) {
		const coverage = captured.source.coverage[row.kind] ?? "unsupported_kind";
		if (coverage !== "complete") return `unchecked_scoped_write: ${coverage}`;
		const bundle = row.bundle_id ?? "";
		if (!captured.source.authorized_bundles?.includes(bundle))
			return "unchecked_scoped_write: outside_read_scope";
		let observed = observations.get(bundle);
		if (!observed) {
			observed = scopedComparableIdentities(captured, bundle);
			observations.set(bundle, observed);
		}
		if (observed.some((item) => item.kind === row.kind && item.key === row.key))
			return "unchecked_scoped_write: missing_baseline";
	}
	return undefined;
}
