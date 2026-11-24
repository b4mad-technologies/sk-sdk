
import type { EntityRef } from "@spellkave/sdk";
import type { ActorStateEntry, SnapshotDb } from "@spellkave/sdk/readers";
import {
	buildEntityNameMap,
	readActorSnapshot,
	readLocationSnapshot,
	readOutcomeTemplateDescription,
	resolveEntityId,
	type SceneTarget,
} from "@spellkave/sdk/readers";
// #1921 browser-wasm regression fix (#1968): import the dual-target
// `./observation-tokens` subpath, NOT `@spellkave/world-author`'s default
// entry. The default entry's static import graph (reference.ts/compose.ts/
// row-kinds.ts/patch.ts/manifest.ts/validate.ts/inspect.ts) unconditionally
// loads wasm-bindgen's `--target nodejs` builds, whose loaders execute
// `fs.readFileSync(__dirname + ...)` at module top level — fatal the instant
// this module (transitively reached from `tools.ts`) is imported into a
// browser bundle (`apps/world-play`), independent of whether the function is
// ever called. `./observation-tokens` resolves to a Node-safe sync-wrapped
// implementation by default and to a lazy, browser-safe wasm-web
// implementation under the "browser" export condition — see
// `packages/spellkave-world-author/src/observation-tokens*.ts` for the full
// explanation. This is why `describeOutcomeTemplate` below is now async.
import { observationPlaceholderTokens } from "@spellkave/world-author/observation-tokens";
import { isUnobservedActStatus, UNCONFIRMED_OUTCOME_MESSAGE } from "./act-uncertainty";

export interface ObservationEnvelope {
	observation: string | null;
	observation_gap?: string;
}

/** Existing fallback for confirmed refusals. An unobserved result needs an
 * observation gap: its effects cannot be inferred from missing completion. */
export const OBSERVATION_NOTHING_HAPPENS = "Nothing happens.";

/**
 * Compose the `{ observation, observation_gap? }` envelope for one dispatched
 * act-tool outcome. `accepted` gates the fallback branch; `resolved` is the
 * caller-supplied perceptual content (already sourced through an authorized
 * read) when one exists; `gapReason` explains the `null` case precisely
 * enough for a follow-up issue to act on.
 */
export function buildObservation(
	accepted: boolean,
	resolved: string | null,
	gapReason: string,
): ObservationEnvelope {
	if (!accepted) return { observation: OBSERVATION_NOTHING_HAPPENS };
	if (resolved !== null) return { observation: resolved };
	return { observation: null, observation_gap: gapReason };
}

/** Status-aware presentation for a manipulation or communication result. */
export function buildActObservation(
	status: string,
	resolved: string | null,
	gapReason: string,
): ObservationEnvelope {
	if (isUnobservedActStatus(status))
		return { observation: null, observation_gap: UNCONFIRMED_OUTCOME_MESSAGE };
	return buildObservation(status === "success", resolved, gapReason);
}

/** Authorized stable reference for a creature that appeared in the acting
 * actor's scene as a result of this act (sk-84i.6). `entity_id` is the
 * runtime id later inspect/target tools accept; `name` is PLAYER-facing. */
export interface SpawnedCreatureRef {
	entity_id: string;
	name: string;
}

/** Scene-diff of co-located actors: bodies that were not present before the
 * act. Uses the same `readCurrentScene` projection `spellkave_scene` already
 * authorizes — no new read path. */
export function spawnedActorsAfter(
	before: SceneTarget[],
	after: SceneTarget[],
): SpawnedCreatureRef[] {
	const beforeIds = new Set(
		before.filter((target) => target.kind === "actor").map((target) => target.id),
	);
	return after
		.filter((target) => target.kind === "actor" && !beforeIds.has(target.id))
		.map((target) => ({
			entity_id: target.id,
			name:
				typeof target.detail.name === "string" && target.detail.name.length > 0
					? target.detail.name
					: target.label,
		}));
}

/** Player-facing summary for spawned creatures. Never interpolates ids. */
export function describeSpawnedCreatures(spawned: SpawnedCreatureRef[]): string | null {
	if (spawned.length === 0) return null;
	const names = spawned.map((entry) => entry.name || "creature");
	if (names.length === 1) return `A ${names[0]} appears.`;
	const last = names[names.length - 1];
	return `${names.slice(0, -1).join(", ")} and ${last} appear.`;
}

/**
 * A node id's GRAPH-qualifying prefix is everything except its own trailing
 * local segment — NOT the leading segment, which live-verified building
 * this against the real elven-mini story is a constant bundle/proof
 * namespace shared by every node regardless of which place graph it's in
 * (`srd_playing_the_game_proof/inn/loft` and
 * `srd_playing_the_game_proof/hamlet/square` share that SAME leading
 * segment despite being in different graphs — comparing leading segments,
 * as `truncateSceneNodePathPrefix`/delta-tracker.ts and
 * `spellkave_scene`'s exit `to` field do for their own DIFFERENT purpose
 * — shortening an already-known-same-or-different destination for display
 * — would never detect a crossing here). Dropping the trailing segment
 * instead correctly generalizes to a combat grid's own 2-segment id shape
 * too (`session_grid_1/c_0_0` -> `session_grid_1`, itself a distinct
 * "graph" from every place-graph node).
 */
// Exported (T5 extension, PR #2115 review thread, operator-approved
// 2026-08-06): `spellkave_scene`'s own graph_description suppression
// (tools.ts's `withSceneGraphSuppression`) needs the SAME graph-boundary
// rule this module's `describeArrival` already established, applied as a
// per-context read cursor instead of a within-call from/to comparison.
export function graphPrefix(nodeId: string): string {
	const separatorIndex = nodeId.lastIndexOf("/");
	return separatorIndex === -1 ? nodeId : nodeId.slice(0, separatorIndex);
}

function crossesGraphBoundary(fromNodeId: string, toNodeId: string): boolean {
	return graphPrefix(fromNodeId) !== graphPrefix(toNodeId);
}

/** Gap reason for `describeArrival`'s within-graph, undescribed-node case —
 * the observation content this same string used to BE before T5 (Gruppe A
 * follow-up, operator review 2026-08-04): repeating the graph blurb on every
 * within-graph hop was pure noise (T5 finding — the elven-mini story showed
 * the identical "three creaking floors of timber..." line on ~17 consecutive
 * moves). Reused here, unchanged in wording, as the honest #1921 gap
 * explanation instead of a fabricated non-answer. */
export const ARRIVAL_NO_DESCRIPTION_GAP =
	"This place has no description of its own, and you did not leave the region you were already in.";

/**
 * #1921: authored, place-scoped arrival prose — the strongest-grounded
 * observation source available without a server change. `node_description`/
 * `graph_description` are graph-static authored content (not per-caller
 * gated — see `LocationSnapshot`'s own doc comment), so the actor being
 * physically AT `toNodeId` is sufficient authorization to read them.
 *
 * T5 (Gruppe A follow-up, operator review 2026-08-04): a bare
 * `node_description` fallback to `graph_description` repeated the SAME
 * graph-level blurb on every single within-graph move (the elven-mini
 * story's own evidence: ~17 consecutive moves inside one graph, all
 * carrying the identical unhelpful line) — pure noise, since the actor
 * already knows which graph it's in. `graph_description` is now a fallback
 * ONLY when the move crossed a graph boundary (`fromNodeId`'s own
 * graph-qualifying prefix — `graphPrefix` above — differs from `toNodeId`'s
 * — the actor genuinely just arrived somewhere new-graph-wide, where naming
 * the graph is real information).
 * Within the same graph with no authored `node_description`, this returns
 * `null` — the honest #1921 two-register gap, not a fabricated line — for
 * the caller to route through `buildObservation`'s existing
 * `observation_gap` mechanism (`ARRIVAL_NO_DESCRIPTION_GAP` above).
 * `fromNodeId` omitted (no prior location to compare against, e.g. a
 * session-teleport with no tracked origin) is treated as a graph crossing —
 * showing the graph blurb once is the safer default over silently gapping.
 */
/** Prose for a move that was ADMITTED but has not landed yet — the actor is
 * walking (feat/travel-eta, 2026-08-18).
 *
 * This exists because the alternative was a lie. A move longer than the
 * actor's reach is promoted into a session that walks them one step per world
 * tick; the client used to poll for arrival, time out, and emit
 * `OBSERVATION_NOTHING_HAPPENS` — telling a player their step had failed when
 * the world had in fact accepted it and was carrying them. The server prices
 * the whole walk at admission, so the honest answer ("you set off; about N
 * ticks") is available at the moment the move is made.
 *
 * Deliberately hedged ("about"): the tick count is what the world expects
 * NOW, and an interruption en route can change it. Promising an exact arrival
 * would trade one false certainty for another. */
export function describeDeparture(toNodeId: string, arrivesInTicks: number): string {
	const where = localNodeLabel(toNodeId);
	if (arrivesInTicks <= 0) return `You set off toward ${where}, arriving any moment now.`;
	const ticks = arrivesInTicks === 1 ? "about a tick" : `about ${arrivesInTicks} ticks`;
	return `You set off toward ${where} — a journey of ${ticks}.`;
}

/** A node id's own trailing segment, underscores relaxed to spaces, for prose
 * that names a destination without leaking the full authored path. Falls back
 * to the whole id when there is no separator to trim. */
function localNodeLabel(nodeId: string): string {
	const local = nodeId.includes("/") ? (nodeId.split("/").pop() ?? nodeId) : nodeId;
	return local.replaceAll("_", " ").trim() || nodeId;
}

export function describeArrival(
	db: SnapshotDb,
	toNodeId: string,
	fromNodeId?: string,
): string | null {
	const location = readLocationSnapshot(db, toNodeId);
	if (location?.node_description) return location.node_description;
	const crossedGraph = fromNodeId === undefined || crossesGraphBoundary(fromNodeId, toNodeId);
	if (crossedGraph && location?.graph_description) return location.graph_description;
	return null;
}

/**
 * #1921: the only "perceivable state delta" honestly reachable without a
 * server change — the ACTING actor's own owned resource pools, read once
 * before and once after the dispatched call. Deliberately scoped to the
 * actor's own state: a third party's resource delta is a separate epistemic
 * question (perception/range, ADR-0040) this issue does not decide. Returns
 * `null` when nothing the actor owns changed value, so the caller falls back
 * to the `observation_gap` path instead of fabricating a sentence.
 */
export function describeSelfResourceDelta(
	before: ActorStateEntry[],
	after: ActorStateEntry[],
): string | null {
	const beforeById = new Map(before.map((entry) => [entry.state_id, entry]));
	const lines: string[] = [];
	for (const entry of after) {
		const prior = beforeById.get(entry.state_id);
		if (prior === undefined) {
			lines.push(`${entry.display_name} is now ${entry.value}.`);
		} else if (prior.value !== entry.value) {
			lines.push(`${entry.display_name}: ${prior.value} → ${entry.value}.`);
		}
	}
	return lines.length > 0 ? lines.join(" ") : null;
}

/**
 * #1968 B-9: authored, per-outcome-template narrative — closes the #1921 gap
 * this module previously carried for manipulate/sensing successes ("No
 * authored per-action outcome narrative exists... needs a follow-up
 * authored-observation field"). `outcome_template.description` is the
 * authored source: `r_manipulate` and `r_sense` both select exactly ONE
 * `outcome_template` per dispatch and record its id at
 * `evaluation_provenance.selected_template_ids[1]` — there is no
 * success/failure row-level fork to disambiguate at this granularity (read
 * from the selection code directly during design, not assumed — see the
 * #1968 B-9 Phase-1/Phase-2 notes). `communicate` deliberately stays out of
 * scope: #1923's own conversation register already owns that verb class's
 * observation semantics, and an authored template line can never say what a
 * player actually typed.
 *
 * Placeholder interpolation: the CLOSED, frozen token vocabulary
 * (`{target_name}` / `{actor_name}` / `{place_name}`) is single-sourced from
 * `spellkave_validate::OBSERVATION_PLACEHOLDER_TOKENS` (Rust) via
 * `@spellkave/world-author/observation-tokens`'s `observationPlaceholderTokens()`
 * — this function CONSUMES that list rather than hand-mirroring it
 * (canon-warden Phase-2 condition 3), so the two sides can never drift. This
 * function is `async` solely because that dual-target import is (#1921
 * browser-wasm regression fix, #1968) — the resolved value and its Rust
 * source are unchanged. Each token
 * resolves against data already reachable through an existing authorized
 * read, the same discipline every other function in this module follows:
 * the acting actor's own name (`readActorSnapshot`), the target's name
 * (`buildEntityNameMap`, keyed by the already-resolved target entity id —
 * works for actor AND non-actor targets alike), and the acting actor's
 * current place node's display name (`readLocationSnapshot`). No mechanical
 * id is ever substituted. An unresolvable token is left literally in the
 * text rather than silently dropped — a visible authoring bug, never a
 * fabricated word. This is deliberately NOT a discovery-gated reveal
 * channel: the epistemic gate already happened at the caller's provenance
 * correlation (resolving WHICH template fired) before this function is ever
 * reached — the prose itself is world-public static content, exactly like
 * `describeArrival`'s `node_description` above (ADR-0081 G-2 owns the actual
 * discovery/reveal mechanism, never this text).
 */
export async function describeOutcomeTemplate(
	db: SnapshotDb,
	outcomeTemplateId: string,
	params: { actorId: EntityRef; targetRef?: EntityRef },
): Promise<string | null> {
	const raw = readOutcomeTemplateDescription(db, outcomeTemplateId);
	if (raw === null) return null;

	const actorSnapshot = readActorSnapshot(db, params.actorId);
	const actorName = actorSnapshot?.entity_name;
	const placeName = actorSnapshot?.current_node_id
		? (readLocationSnapshot(db, actorSnapshot.current_node_id)?.node_display_name ?? undefined)
		: undefined;
	const targetEntityId =
		params.targetRef !== undefined ? resolveEntityId(db, params.targetRef) : undefined;
	const targetName =
		targetEntityId !== undefined ? buildEntityNameMap(db).get(String(targetEntityId)) : undefined;

	const resolved: Record<string, string | undefined> = {
		"{target_name}": targetName,
		"{actor_name}": actorName,
		"{place_name}": placeName,
	};

	let text = raw;
	for (const token of await observationPlaceholderTokens()) {
		const value = resolved[token];
		if (value !== undefined && value !== "") {
			text = text.split(token).join(value);
		}
	}
	return text;
}

/**
 * PLAYER conversation register for direct communication. After an accepted
 * dispatch, `spoken_by_player` carries the caller-supplied utterance. A reply
 * is reported only when the host observes matching `speech_heard` evidence.
 *
 * `communicateToolDef` selects delivery through `worldEvents.replyDelivery`.
 * Bundled delivery listens for cache updates within a bounded reply window;
 * event delivery returns without claiming a reply. `awaitConversationReply`
 * consumes a matched event from the shared builder so a later push drain
 * cannot deliver it twice. Unclaimed replies remain available to later drains.
 * The deadline and event delivery contracts are covered by reply-window tests
 * and the Session communication-reply suite.
 */
export interface ConversationEnvelope {
	spoken_by_player: string | null;
	response: ConversationReply | null;
	awaiting_response: boolean;
	continuity: string | null;
}

/**
 * One synchronously-observed NPC reply within the communicate reply window
 * (sk-0m4.73). Fields mirror the underlying `SpeechHeardEvent`
 * (`push-events.ts`) that matched: `speaker`/`speaker_name` are that event's
 * `inscribed_by`/`inscribed_by_name` verbatim (same "honest absence, never
 * fabricated" discipline — `speaker_name` is `null` when the speaker is
 * attributed but not currently perceivable), `trace_id` is carried so a
 * caller can cross-reference a later `spellkave_trace_detail` lookup.
 *
 * `addressee`/`addressee_name` (sk-jay0.1.11) are the SAME fields the
 * matched `speech_heard` event carries, normalized from `undefined` to
 * `null` here rather than left optional: unlike the push-event stream
 * (where an absent key on untargeted speech keeps decades of existing
 * literal fixtures compiling, `world-events.ts`), this envelope is built
 * fresh on every call, so there is no legacy shape to protect — `null` reads
 * as "this reply named no addressee" without a caller needing an `in`
 * check. `addressee_name` follows `speaker_name`'s rule: `null` when the
 * addressee is a known id the caller cannot currently perceive.
 */
export interface ConversationReply {
	speaker: string | null;
	speaker_name: string | null;
	addressee: number | null;
	addressee_name: string | null;
	text: string;
	trace_id: string;
}

/**
 * Compose the `conversation` envelope for one dispatched `communicate`
 * outcome. `accepted` mirrors the same gate `buildObservation` uses — a
 * rejected/unobserved dispatch perceives nothing, so every field is honestly
 * empty rather than echoing an utterance that never left the speaker's
 * mouth. `utterance` is the caller-supplied spoken text (already trimmed of
 * blank input by the caller), or `null` when the actor communicated without
 * words. `reply` (sk-0m4.73) is the caller's already-resolved reply-window
 * outcome: `undefined` when no host builder was injected (today's shape,
 * unchanged), `null` when event delivery is selected or no reply matched inside
 * the window (`awaiting_response` stays `true` — the miss still surfaces
 * later via `pushes`), or a filled {@link ConversationReply} on a synchronous
 * hit (`awaiting_response` flips `false` — nothing further to await).
 *
 * Operator decision (2026-08-09): the per-call `continuity` prose note this
 * function used to attach was removed — it repeated identical text on every
 * `communicate` dispatch for no per-call information gain. The one durable
 * fact (the reply-window contract above) now lives once in the tool/param
 * descriptions (`tool-schemas.ts`'s `COMMUNICATE_PARAMS.utterance`,
 * `tools.ts`'s `communicateToolDef` description) instead of on every
 * envelope.
 */
export function buildConversationResult(
	accepted: boolean,
	utterance: string | null,
	reply?: ConversationReply | null,
): ConversationEnvelope {
	if (!accepted) {
		return { spoken_by_player: null, response: null, awaiting_response: false, continuity: null };
	}
	return {
		spoken_by_player: utterance,
		response: reply ?? null,
		awaiting_response: reply === undefined || reply === null,
		continuity: null,
	};
}
