/**
 * Browser-safe, host-projected world-delta model (ADR-0083 D-3/D-5 and
 * ADR-0093 D-3).
 *
 * Hosts project only actor-authorized SDK reader results into this module;
 * the runtime never reads raw tables. Fingerprints describe stable semantic
 * identity rather than subscription handles or row revisions, so a
 * content-identical rematerialization remains quiet. Every sample advances
 * the cursor, including a plain read or failed action: only a change that the
 * carrying receipt attributes to the caller is returned as `world_deltas`.
 * Unattributable changes belong to the typed WorldEvent channel instead and
 * must not leak into a later tool receipt.
 */
export type DeltaDomain = "scene" | "affordance" | "inventory" | "trace";

export interface WorldDeltaItem {
	fingerprint: string;
	name: string;
}

export interface WorldSelfStateProjection {
	state_id: string;
	value: string;
}

/** Projection supplied by an SDK-owning host; no reader implementation leaks here. */
export interface WorldDeltaProjection {
	scene: readonly WorldDeltaItem[];
	affordance: readonly WorldDeltaItem[];
	inventory: readonly WorldDeltaItem[];
	trace: readonly WorldDeltaItem[];
	self: readonly WorldSelfStateProjection[];
}

/** A live session/projection boundary that browser and Node hosts can implement. */
export interface WorldSessionPort<TSession> {
	currentSession(): TSession | undefined;
}

/** A structural projection operation over a host-owned session. */
export interface WorldProjectionPort<TSession, TProjection> {
	project(session: TSession): TProjection;
}

/** Lazily samples one actor-authorized projection from a host subscription cache. */
export interface WorldDeltaSource {
	sample(): WorldDeltaProjection;
}

export interface DomainDeltaNote {
	added: string[];
	removed: string[];
	more: number;
}

export interface SelfStateDelta {
	state_id: string;
	prev: string | null;
	value: string;
}

export interface WorldDeltas {
	scene?: DomainDeltaNote;
	affordance?: DomainDeltaNote;
	inventory?: DomainDeltaNote;
	trace?: DomainDeltaNote;
	self?: SelfStateDelta[];
	self_truncated?: boolean;
}

export interface DiffAndAdvanceOptions {
	/** Return this sample's delta only when the carrying receipt caused it. */
	receiptAttributable?: boolean;
	/**
	 * A successful own move implies leaving the previous scene; suppress only
	 * that scene-removal noise while retaining additions and other domains.
	 */
	suppressSceneRemoved?: boolean;
}

export interface DeltaTracker {
	diffAndAdvance(options?: DiffAndAdvanceOptions): WorldDeltas | null;
}

export interface WorldDeltaContentPort<TContent> {
	contentFor(deltas: WorldDeltas): TContent;
}

export interface WorldDeltaResultCoordinator<TContent> extends WorldDeltaContentPort<TContent> {
	tracker: DeltaTracker;
}

const DOMAINS: readonly DeltaDomain[] = ["scene", "affordance", "inventory", "trace"];
const MAX_NAMED_PER_DIRECTION = 5;
const SELF_STATE_CAP = 12;

function fingerprintMap(items: readonly WorldDeltaItem[]): Map<string, string> {
	return new Map(items.map((item) => [item.fingerprint, item.name]));
}

function revision(domain: DeltaDomain, items: Map<string, string>): string {
	return `${domain}:${JSON.stringify([...items].sort(([left], [right]) => left.localeCompare(right)))}`;
}

function diffDomain(
	previous: Map<string, string>,
	next: Map<string, string>,
	dropRemoved: boolean,
): DomainDeltaNote | null {
	const addedAll = [...next]
		.filter(([fingerprint]) => !previous.has(fingerprint))
		.map(([, name]) => name);
	const removedAll = dropRemoved
		? []
		: [...previous].filter(([fingerprint]) => !next.has(fingerprint)).map(([, name]) => name);
	if (addedAll.length === 0 && removedAll.length === 0) return null;
	const added = addedAll.slice(0, MAX_NAMED_PER_DIRECTION);
	const removed = removedAll.slice(0, MAX_NAMED_PER_DIRECTION);
	return {
		added,
		removed,
		more: addedAll.length - added.length + removedAll.length - removed.length,
	};
}

/**
 * Owns semantic fingerprint comparison and cursor advancement, not SDK
 * reads. The first call primes exactly once and is always quiet; recreating a
 * tracker mid-session would discard the prior baseline and is therefore a
 * host lifecycle error (ADR-0083 D-5).
 */
export function createWorldDeltaTracker(source: WorldDeltaSource): DeltaTracker {
	const previous = new Map<DeltaDomain, Map<string, string>>();
	const revisions = new Map<DeltaDomain, string>();
	let previousSelf = new Map<string, string>();
	let primed = false;

	return {
		diffAndAdvance(options = {}): WorldDeltas | null {
			const projection = source.sample();
			if (!primed) {
				for (const domain of DOMAINS) {
					const snapshot = fingerprintMap(projection[domain]);
					previous.set(domain, snapshot);
					revisions.set(domain, revision(domain, snapshot));
				}
				previousSelf = new Map(projection.self.map((item) => [item.state_id, item.value]));
				primed = true;
				return null;
			}

			const out: WorldDeltas = {};
			let changed = false;
			for (const domain of DOMAINS) {
				const next = fingerprintMap(projection[domain]);
				const nextRevision = revision(domain, next);
				const lastRevision = revisions.get(domain);
				const last = previous.get(domain) ?? new Map<string, string>();
				previous.set(domain, next);
				revisions.set(domain, nextRevision);
				if (nextRevision === lastRevision) continue;
				const note = diffDomain(
					last,
					next,
					domain === "scene" && options.suppressSceneRemoved === true,
				);
				if (note !== null) {
					out[domain] = note;
					changed = true;
				}
			}

			const nextSelf = new Map(projection.self.map((item) => [item.state_id, item.value]));
			const self = [...nextSelf].flatMap(([state_id, value]) => {
				const prev = previousSelf.get(state_id);
				return prev === value ? [] : [{ state_id, prev: prev ?? null, value }];
			});
			previousSelf = nextSelf;
			if (self.length > 0) {
				changed = true;
				out.self = self.slice(0, SELF_STATE_CAP);
				if (self.length > SELF_STATE_CAP) out.self_truncated = true;
			}
			return options.receiptAttributable === true && changed ? out : null;
		},
	};
}

/** Appends a delta block without reserializing the primary result content. */
export function appendWorldDeltas<
	TContent,
	TResult extends { content: readonly TContent[]; details: unknown },
>(result: TResult, deltas: WorldDeltas, port: WorldDeltaContentPort<TContent>): TResult {
	const details =
		typeof result.details === "object" && result.details !== null
			? { ...result.details, world_deltas: deltas }
			: { result: result.details, world_deltas: deltas };
	return { ...result, content: [...result.content, port.contentFor(deltas)], details } as TResult;
}

/** Applies a shared tracker only at an explicit host-selected result boundary. */
export function coordinateWorldDeltas<
	TContent,
	TResult extends { content: readonly TContent[]; details: unknown },
>(
	result: TResult,
	options: DiffAndAdvanceOptions,
	coordinator: WorldDeltaResultCoordinator<TContent>,
): TResult {
	const deltas = coordinator.tracker.diffAndAdvance(options);
	return deltas === null ? result : appendWorldDeltas(result, deltas, coordinator);
}

export function truncateSceneNodePathPrefix(currentNodeId: string, toNodeId: string): string {
	const separatorIndex = toNodeId.indexOf("/");
	if (separatorIndex === -1) return toNodeId;
	const toPrefix = toNodeId.slice(0, separatorIndex);
	const currentSeparatorIndex = currentNodeId.indexOf("/");
	const currentPrefix =
		currentSeparatorIndex === -1 ? currentNodeId : currentNodeId.slice(0, currentSeparatorIndex);
	return toPrefix === currentPrefix ? toNodeId.slice(separatorIndex + 1) : toNodeId;
}
