/**
 * Scene builder and reads for the economy-projection claims (neutral `economy_projection` fixture:
 * a metered strike on the primary channel, a never-resetting channel, grant / suppress / unsuppress
 * actions, an extent observer). Shared by `economy-projection.local-node.test.ts` and
 * `final/economy-projection-clock.local-node.test.ts`.
 *
 * The fixture hard-codes five fixed bodies; a scene brings its own arena of four: the `subject`
 * (hero, holds every action capability), a `target` (NPC actor), a `viewer` (hero holding the
 * `oversee` capability over the scene's place graph) and a grantless `peer` (hero). The projection
 * rows are per body and channel, so the arena has 4 visible bodies and 3 catalog channels
 * (core primary + movement, and the fixture's `never`).
 */
import { type Scene, scene } from "../scene";
import {
	type ActingBody,
	applyRows,
	authoredIds,
	heroBody,
	nicheRow,
	type Row,
	rowsOf,
} from "./claims";
import { entityKey, liveWorldRef } from "./support";

export const EP = "economy_projection";
export const PRIMARY_CHANNEL = "core/action_class/primary";
export const NEVER_CHANNEL = `${EP}/channel/never`;
export const STRIKE_ACTION = `${EP}/strike`;
export const NEVER_ACTION = `${EP}/never-strike`;
export const GRANT_ACTION = `${EP}/grant-primary`;
export const SUPPRESS_ACTION = `${EP}/suppress-primary`;
export const UNSUPPRESS_ACTION = `${EP}/unsuppress-primary`;
export const SESSION_DEF = `${EP}/session`;
/** Core authors primary + movement; the fixture adds never. */
export const CATALOG_CHANNEL_COUNT = 3;
export const DEPS = ["core", EP] as const;

const CAPABILITIES = ["strike", "grant", "suppress", "unsuppress", "never"].map(
	(name) => `${EP}/capability/${name}`,
);
const OVERSEE = `${EP}/capability/oversee`;

export interface EconomyScene {
	s: Scene;
	subject: ActingBody;
	targetId: bigint;
	viewer: ActingBody;
	peer: ActingBody;
}

export async function economyScene(scenes: Scene[]): Promise<EconomyScene> {
	const s = await scene(liveWorldRef(), undefined, { bundleDeps: DEPS });
	scenes.push(s);
	s.place("arena")
		.hero("subject", { at: "arena", capabilities: CAPABILITIES })
		.npc("target", { at: "arena", actor: true })
		.hero("viewer", { at: "arena" })
		.hero("peer", { at: "arena" });
	await s.apply();
	const p = s.prefix;
	await applyRows(
		s,
		{
			spatial_niche_attachments: CAPABILITIES.map((capability) =>
				nicheRow(s, "arena", `capability:${capability}`),
			),
			// The extent grant: the viewer oversees every body of this scene's place graph.
			actor_capabilities: [
				{
					bundle_id: p,
					actor_entity_key: entityKey(p, "viewer"),
					capability_id: OVERSEE,
					source: "manifest",
					elevation_class: "",
					extent_kind_ref: "place_graph",
					extent_ref: `${p}/g`,
					source_args_hash: "",
				},
			],
		},
		DEPS,
	);
	const [target] = await authoredIds(s, ["target"]);
	return {
		s,
		subject: await heroBody(s.heroOf("subject")),
		targetId: target as bigint,
		viewer: await heroBody(s.heroOf("viewer")),
		peer: await heroBody(s.heroOf("peer")),
	};
}

// --- reads over a synced cache -------------------------------------------------

/** Budget rows of one body on one channel, as the SDK reader projects them. */
export function channelOf<T extends { actor_id: string; channel_id: string }>(
	budget: { channels: readonly T[] },
	actorId: bigint,
	channelId: string,
): T | undefined {
	return budget.channels.find(
		(row) => row.actor_id === String(actorId) && row.channel_id === channelId,
	);
}

/** Distinct actor ids this connection's projection covers, sorted. */
export function visibleActorIds(body: ActingBody): string[] {
	return [
		...new Set(
			rowsOf(body.world.db(), "visibleEconomyChannelBudget").map((r) => String(r.actorId)),
		),
	].sort();
}

export const projectedRowCount = (body: ActingBody): number =>
	rowsOf(body.world.db(), "visibleEconomyChannelBudget").length;

/** `event_channel_spend` rows (the public spend receipts) in this connection's cache. */
export function spendEvents(body: ActingBody): Row[] {
	return rowsOf(body.world.db(), "eventChannelSpend");
}
