/**
 * Live exploration port (persona-world-exploration, task 2.2).
 *
 * Reads places, public catalogs and the caller-scoped instance kinds through ONE
 * isolated caller-authenticated subscription group (the `.44` scoped snapshot
 * port with extra families), then projects the detached copy with the same
 * projector the file source uses. It never reads `session.conn.db` and never
 * falls back to an owner/publisher read: any reader failure is `unavailable`.
 */

import type { SpellkaveSession } from "@spellkave/sdk";
import {
	type ExplorationPort,
	type ExplorationSnapshot,
	explorationDigest,
	projectExplorationManifest,
} from "@spellkave/tool-authoring";
import { AUTHORED_ENTITIES_ONLY, type ExplorationSource } from "@spellkave/tool-contracts";
import { createInstanceProjector, type OwnerSnapshot } from "@spellkave/world-author";
import { LIVE_TABLE_ACCESSORS } from "./live-author-target";
import { createLiveScopedSnapshotPort } from "./live-scoped-instance-port";

/** Families the live port reads beyond the scoped eight kinds: projection kind -> live table. */
const CATALOG_KINDS = [
	// Bundle titles: the engine names only bundles of admitted rows (WE-06).
	"bundles",
	"place_graphs",
	"place_nodes",
	"place_edges",
	"entity_definitions",
	"capability_definitions",
	"action_definitions",
	"affordance_templates",
	"outcome_templates",
	"consequence_templates",
	"entity_definition_tag",
	"capability_definition_tag",
	"object_state_definitions",
	"resource_definitions",
	"resource_definition_tag",
] as const;
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
/**
 * Public catalogs only exploration reads, mapped field by field from the server
 * structs (no authoring-target accessor exists for them). Each maps the storage-key
 * fields the projector joins on.
 */
const EXPLORATION_ONLY_KINDS: Readonly<
	Record<
		string,
		{ table: string; toRow: (live: Record<string, unknown>) => Record<string, unknown> }
	>
> = {
	niche_definitions: {
		table: "niche_definition",
		toRow: (live) => ({
			niche_id: text(live.nicheId ?? live.niche_id),
			bundle_id: text(live.bundleId ?? live.bundle_id),
			display_name: text(live.displayName ?? live.display_name),
			description: text(live.description),
			predicate_source: text(live.predicateSource ?? live.predicate_source),
		}),
	},
	...Object.fromEntries(
		(
			[
				["action_definition_tag", "action_id"],
				["niche_definition_tag", "niche_id"],
				["outcome_template_tag", "outcome_template_id"],
				["object_state_definition_tag", "state_id"],
			] as const
		).map(([kind, parent]) => [
			kind,
			{
				table: kind,
				toRow: (live: Record<string, unknown>) => ({
					[parent]: text(
						live[parent.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] ?? live[parent],
					),
					tag: text(live.tag),
					bundle_id: text(live.bundleId ?? live.bundle_id),
					source: text(live.source),
				}),
			},
		]),
	),
	entity_definition_initial_state: {
		table: "entity_definition_initial_state",
		toRow: (live) => ({
			entity_def_id: text(live.entityDefId ?? live.entity_def_id),
			state_id: text(live.stateId ?? live.state_id),
			bundle_id: text(live.bundleId ?? live.bundle_id),
		}),
	},
	movement_defaults: {
		table: "movement_default",
		toRow: (live) => ({
			bundle_id: text(live.bundleId ?? live.bundle_id),
			place_graph_id: text(live.placeGraphId ?? live.place_graph_id),
			mode_id: text(live.modeId ?? live.mode_id),
			affordance_template_id: text(live.affordanceTemplateId ?? live.affordance_template_id),
			bindings_json: text(live.bindingsJson ?? live.bindings_json),
		}),
	},
	place_edge_affordance: {
		table: "place_edge_affordance",
		toRow: (live) => ({
			edge_key: text(live.edgeKey ?? live.edge_key),
			affordance_template_id: text(live.affordanceTemplateId ?? live.affordance_template_id),
			mode_id: text(live.modeId ?? live.mode_id),
			bindings_json: text(live.bindingsJson ?? live.bindings_json),
		}),
	},
};
const INITIAL_CAPABILITY = "entity_definition_initial_capability";
/** Instance kinds served by the scoped reader that the exploration projector consumes. */
const INSTANCE_KINDS = [
	"entities",
	"actors",
	"actor_spatial_locations",
	"actor_capabilities",
	"entity_containment",
	"entity_tag",
	"object_state",
] as const;
const EXAMINED = 10_000;

function extraTables(): Record<string, string> {
	const out: Record<string, string> = {
		config: "config",
		[INITIAL_CAPABILITY]: INITIAL_CAPABILITY,
	};
	for (const [kind, { table }] of Object.entries(EXPLORATION_ONLY_KINDS))
		out[`explore_${kind}`] = table;
	for (const kind of CATALOG_KINDS) {
		const accessor = LIVE_TABLE_ACCESSORS[kind];
		if (!accessor) throw new Error(`live exploration: no live mapping for ${kind}`);
		out[`explore_${kind}`] = accessor.table;
	}
	return out;
}
function rows(snapshot: OwnerSnapshot, name: string): Record<string, unknown>[] {
	return [...(snapshot[name]?.iter() ?? [])] as Record<string, unknown>[];
}
/**
 * The scoped reader's per-kind status (server `authoring_coverage`) onto
 * exploration coverage. For a caller with at least one authorized scope,
 * `masked` and `outside_read_scope` only say that rows or facts outside the
 * caller's visible scope were left out: exploration counts and pages that
 * visible scope, so those row-dependent codes are not forwarded
 * (Decision 4, WE-06). A caller with no scope at all gets `outside_read_scope`
 * for every kind from the server; that is no read, never an empty world (WE-07).
 * The fixed authored-instance projection is still incomplete for inventory:
 * runtime bodies lack authored keys and graph scopes omit containment-only rows.
 * Retain the existing authored_entities_only contract label as an open-string reason
 * (world-authoring-cli/spec.md, requirement `sk get`). This depends on the reader,
 * never on whether inaccessible rows exist. Bounds and unknown codes stay incomplete.
 */
export function explorationCoverageFromScoped(
	family: string,
	status: string | undefined,
	hasScope: boolean,
): ExplorationSource["coverage"][number] {
	if (!hasScope) return { family, state: "incomplete", reason: "reader_unavailable" };
	if (status === "complete" || status === "masked" || status === "outside_read_scope")
		return { family, state: "incomplete", reason: AUTHORED_ENTITIES_ONLY };
	if (status === "incomplete") return { family, state: "incomplete", reason: "examined_row_bound" };
	return { family, state: "incomplete", reason: "reader_unavailable" };
}

/**
 * Movement defaults and edge affordances are public tables that can name a place the
 * caller may not see: keep only rows on a visible graph or edge (a bundle-wide default
 * names no graph), so a hidden graph or edge key never reaches an answer (WE-06). A row whose
 * graph field is missing is dropped too: the filter fails closed.
 */
export function keepVisiblePlaceLinks(manifest: Record<string, unknown>): void {
	const list = (kind: string) => (manifest[kind] ?? []) as Record<string, unknown>[];
	const graphs = new Set(list("place_graphs").map((row) => row.place_graph_id));
	const edges = new Set(list("place_edges").map((row) => row.edge_key));
	manifest.movement_defaults = list("movement_defaults").filter(
		(row) => row.place_graph_id === "" || graphs.has(row.place_graph_id),
	);
	manifest.place_edge_affordance = list("place_edge_affordance").filter((row) =>
		edges.has(row.edge_key),
	);
}

export function createLiveExplorationPort(deps: {
	session: SpellkaveSession | (() => SpellkaveSession);
	world: { url: string; db: string } | (() => { url: string; db: string });
}): ExplorationPort & { close(): void } {
	const scoped = createLiveScopedSnapshotPort({ ...deps, extraTables: extraTables() });
	return {
		async snapshot(source): Promise<ExplorationSnapshot> {
			if (source !== "live") throw new Error("live exploration port serves only the live source");
			const captured = await scoped.read();
			const { snapshot } = captured;
			// No authorized scope is no read at all (WE-07), whatever the codes say.
			const hasScope = captured.source.authorized_scopes.length > 0;
			if (!hasScope) throw new Error("reader_unavailable: no authorized scope");
			const manifest: Record<string, unknown> = {};
			for (const kind of CATALOG_KINDS) {
				const accessor = LIVE_TABLE_ACCESSORS[kind];
				if (!accessor) continue;
				manifest[kind] = rows(snapshot, `explore_${kind}`).map(accessor.toManifestRow);
			}
			for (const [kind, { toRow }] of Object.entries(EXPLORATION_ONLY_KINDS))
				manifest[kind] = rows(snapshot, `explore_${kind}`).map(toRow);
			keepVisiblePlaceLinks(manifest);
			manifest[INITIAL_CAPABILITY] = rows(snapshot, INITIAL_CAPABILITY).map((live) => ({
				key: live.key,
				entity_def_id: live.entityDefId ?? live.entity_def_id,
				capability_id: live.capabilityId ?? live.capability_id,
				bundle_id: live.bundleId ?? live.bundle_id,
			}));
			const coverage: ExplorationSource["coverage"] = [];
			const projector = createInstanceProjector({
				snapshot: () => snapshot,
				worldTick: () => BigInt(captured.source.tick),
			});
			for (const kind of INSTANCE_KINDS) {
				const answer = projector.get({ kind, limit: EXAMINED });
				const state = explorationCoverageFromScoped(
					kind,
					captured.source.coverage?.[kind],
					hasScope,
				);
				if (!answer.ok) {
					coverage.push({ family: kind, state: "incomplete", reason: "reader_unavailable" });
					continue;
				}
				manifest[kind] = answer.rows ?? (answer.row ? [answer.row] : []);
				coverage.push(
					(answer.left_out ?? 0) > 0
						? { family: kind, state: "incomplete", reason: "examined_row_bound" }
						: state,
				);
			}
			// Place families are complete relative to the caller's spatial admission:
			// the visible_place_* views ARE that admitted projection (design inventory).
			// Public catalogs are complete up to the projector's examined-row bound.
			for (const kind of [
				...CATALOG_KINDS,
				...Object.keys(EXPLORATION_ONLY_KINDS),
				INITIAL_CAPABILITY,
			])
				coverage.push({ family: kind, state: "complete" });
			const config = rows(snapshot, "config")[0];
			const worldInstance = config?.worldInstanceId ?? config?.world_instance_id;
			if (typeof worldInstance !== "string" || worldInstance === "")
				throw new Error("reader_unavailable: world_instance_id missing");
			const endpoint = typeof deps.world === "function" ? deps.world() : deps.world;
			return projectExplorationManifest(
				manifest,
				{
					source: "live",
					// Opaque: never a URL with credentials; stable per endpoint and caller.
					source_id: await explorationDigest({
						world: `${endpoint.url}/${endpoint.db}`,
						identity: captured.source.identity,
					}),
					world: endpoint.db,
					world_instance: worldInstance,
					connection_epoch: String(captured.source.connection_epoch),
				},
				{ coverage },
			);
		},
		close() {
			scoped.close();
		},
	};
}
