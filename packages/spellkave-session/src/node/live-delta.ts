// Shared live-delta transport (#1968 "new tests use the verb tools and
// mutate the LIVE server, not a seed each time" — the operator's test rule,
// made consequent). Every fast-lane/us9-act/doc-contract world used to be
// built OFFLINE (an in-memory verb-call harness rendering a scratch
// manifest.toml) then materialized via a SEPARATE `just seed <file>` step
// (`r_apply_world_manifest`, the whole-bundle CLI path). This module is the
// replacement half: connect the SAME persisted local dev credential
// `just seed`'s own genesis apply uses (`liveNodeToken()`), then submit the
// already-built, already-validated manifest as ONE live
// `r_apply_manifest_delta` call (ADR-0085, upsert semantics) — exercising the
// delta pipeline on every caller's run instead of only in dedicated
// delta-authoring proofs (US5-7, `sandbox/sk-sndbx-unified-authoring/
// user-stories/us-live-dungeon.ts`).
//
// The VERB-AUTHORING half (`spellkave_author_place`/`spellkave_write_rows`/
// `spellkave_define_resource`/...) is UNCHANGED and stays fully OFFLINE —
// each caller still drives an in-memory `memoryWorkspace()` through
// `createAuthorFacingTools`, exactly as before the port. Only the LAST step
// (what used to be "write the rendered TOML to `.local/**` and require a
// separate `just seed <file>`") is replaced by this module's
// `applyLiveDelta`, which rides the SAME `createLiveAuthorTarget`
// (`@spellkave/session/authoring`, #1968 "connection-level target" decision) the Pi
// extension's own `spellkave_apply_manifest_delta` tool uses live —
// `applyBatch` dispatches through `r_apply_manifest_delta`. After enqueue it
// waits via `@spellkave/sdk`'s `waitForManifestApplyVerdict` (sk-0m4.45) —
// the same waiter CLI / sk / Pi / test-lab use — until a new digest seals
// or a `manifest_apply_outcome` failure row appears. Digest + outcome are
// not in CONNECTION_BASELINE; this session additively subscribes them.
//
// SEAL-WAIT TRANSPORT (#1968 delta seal-poll-floor tuning, 2026-07-24):
// `waitForManifestSeal` used to poll via `spacetimeSql` — a spawned
// `spacetime sql` CLI subprocess — on a flat 300ms interval. Baseline
// measurement (this same issue) found the SERVER side of the drain already
// seals within roughly one poll cycle for a small delta (the CLI's own
// `await_manifest_drain`, which reads the LOCAL subscribed cache instead of
// shelling out, resolves a whole enqueue+drain+seal round trip in ~60-100ms
// against a core-only world) — the 300ms fixed interval was ADDING latency,
// not bounding real work. This session now additively subscribes
// `manifest_apply_digest` once at connect time (mirroring
// `client/src/cli/manifest.rs`'s own subscribed-cache read and
// `@spellkave/test-lab`'s `src/live.ts`'s `waitForManifestDrain`) so
// the wait loop reads the LOCAL cache — no subprocess, no network round trip
// per poll — at a tight adaptive-backoff interval instead. The TOCTOU note
// below (ANY new digest, not necessarily this call's own) is unchanged by
// this transport swap; it was never about polling mechanism.
//
// AUTHORITY NOTE: each mechanics fixture authors an explicit system-author
// binding of the setup identity over its root graph. Publisher/genesis applies
// realise that independent presence; later deltas use its apply capability.
// Character identity rows are separate, so character release or takeover does
// not transfer the setup principal's authority.
//
// CANONICAL HOME (#1968 recorded-debt cleanup): the former in-package
// script/test helper copies have been consolidated into this Node session
// transport. It owns the live SDK connection and seal wait; session/authoring
// owns `createLiveAuthorTarget`, while tool-node owns the local credential.
import {
	connect,
	digestSetFromHandle,
	formatManifestApplyFailure,
	outcomesFromHandle,
	type SpellkaveSession,
	snapshotDb,
	subscribeManifestApplyWait,
	verdictFromManifestApplySnapshots,
	waitForManifestApplyVerdict,
} from "@spellkave/sdk";
import { liveNodeToken } from "@spellkave/tool-node";
import { createLiveAuthorTarget } from "../authoring/index.ts";

const URL = process.env.SPELLKAVE_URL ?? "http://127.0.0.1:3000";
const DB = process.env.SPELLKAVE_DB ?? "spellkave-dev";
const NOOP_CALLBACKS = { onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} };
// Drain wait lives in `@spellkave/sdk` (`waitForManifestApplyVerdict`, sk-0m4.45).

/**
 * Connect the ONE identity every live-delta caller submits deltas as —
 * `liveNodeToken()`, the persisted local dev credential `just seed`'s own
 * genesis apply used (`src/__tests__/helpers/multiplayer-twin.ts`).
 * `connectedActorId` is provenance-buffer bookkeeping only
 * (`packages/spellkave-sdk/src/connection.ts`) — it need not resolve to a
 * live actor at connect time, since a caller submits manifest deltas, it
 * does not act as anyone. Additively subscribes `manifest_apply_digest`
 * (#1968) so `waitForManifestSeal` can read the local cache instead of
 * shelling out to `spacetime sql` on every poll.
 */
export async function connectSetupSession(connectedActorId: string): Promise<SpellkaveSession> {
	const session = await connect(
		{ url: URL, db: DB, token: liveNodeToken(), connectedActorId },
		NOOP_CALLBACKS,
	);
	await session.ready;
	await subscribeManifestApplyDigest(session);
	return session;
}

/**
 * `manifest_apply_digest` is not in `@spellkave/sdk`'s `CONNECTION_BASELINE`
 * (deliberately — see this file's header); add it to THIS session's own
 * subscription set rather than widening the shared baseline for every
 * caller. One extra round trip paid once at connect time, not per delta.
 */
async function subscribeManifestApplyDigest(session: SpellkaveSession): Promise<void> {
	await subscribeManifestApplyWait(session.conn.subscriptionBuilder());
}

/**
 * Read `manifest_apply_digest` off the local subscribed cache (no network
 * round trip) — finding ledger entry #5
 * (`packages/spellkave-srd-cc/ledger/findings.md`): the accessor is
 * snake_case on the generated `DbConnection.db` (verified against
 * `@spellkave/bindings`'s schema — table accessors are keyed verbatim by
 * their snake_case schema name, never camelCase), NOT the camelCase-falling-
 * back-to-snake pattern this function used to mirror from
 * `packages/spellkave-sdk/src/connection.ts`. Throws (never silently treats
 * the digest set as empty) if the accessor is entirely missing — a missing
 * `manifest_apply_digest` handle on an already-subscribed session means the
 * table name is wrong, not that no digest has sealed yet, and the caller's
 * seal-wait poll would otherwise spin to its timeout looking like a stalled
 * drain instead of a wiring bug.
 */
function localManifestDigestSet(session: SpellkaveSession): Set<string> {
	const db = snapshotDb(session);
	const handle = db.manifest_apply_digest;
	if (handle === undefined) {
		throw new Error(
			'localManifestDigestSet: no accessor "manifest_apply_digest" on the connected db — ' +
				"the live SDK exposes snake_case table names only (never camelCase); check the table name " +
				"against the schema and that this session subscribed it.",
		);
	}
	return digestSetFromHandle(handle);
}

function localManifestOutcomes(session: SpellkaveSession) {
	return outcomesFromHandle(snapshotDb(session).manifest_apply_outcome);
}

/** Opt-in per-phase timing (#1968 seal-poll-floor measurement), gated the
 * same way `@spellkave/test-lab`'s `src/live.ts`'s own
 * `SPELLKAVE_SRD_RUNNER_TIMINGS` is — silent by default, `console.error` (not
 * `.log`, so it never lands in a caller's stdout-parsed output) when enabled. */
function liveDeltaTiming(label: string, started: number): number {
	const now = Date.now();
	if (process.env.SPELLKAVE_LIVE_DELTA_TIMINGS === "1") {
		console.error(`[live-delta-timing] ${label}: ${now - started}ms`);
	}
	return now;
}

async function waitForManifestSeal(
	session: SpellkaveSession,
	before: Set<string>,
	label: string,
): Promise<void> {
	const beforeOutcomes = new Set(localManifestOutcomes(session).map((row) => row.applyId));
	const verdict = await waitForManifestApplyVerdict(
		() =>
			verdictFromManifestApplySnapshots({
				beforeDigests: before,
				currentDigests: localManifestDigestSet(session),
				beforeOutcomeIds: beforeOutcomes,
				currentOutcomes: localManifestOutcomes(session),
			}),
		{ label },
	);
	if (verdict.status === "failed") {
		throw new Error(
			`live-delta: [${label}] ${formatManifestApplyFailure(verdict.code, verdict.message)}`,
		);
	}
}

/**
 * Submit `toml` (already offline-validated by the caller) as ONE live
 * `r_apply_manifest_delta` call over `session`, then wait for the drain to
 * seal before returning. Rides `createLiveAuthorTarget` from session/authoring
 * purely for its `applyBatch` semantics — no read-side ref-checks are needed
 * here, the authoring phase that built `toml` already ran fully offline
 * against its own scratch workspace.
 *
 * Throws on a genuine apply failure. Exact-digest resubmits can opt into
 * treating `MF-APPLY-012` as an idempotent success; the default remains
 * fail-loud so existing callers keep their current contract.
 */
export interface ApplyLiveDeltaOptions {
	tolerateAlreadyApplied?: boolean;
}

/** Pure error classifier kept beside the transport so tolerance is testable
 * without a live node. SpacetimeDB's SenderError string carries the stable
 * server code; the prose fallback covers wrapped errors that retain only the
 * server message. */
export function isManifestAlreadyApplied(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("MF-APPLY-012") || message.includes("manifest already applied");
}

export async function applyLiveDelta(
	session: SpellkaveSession,
	toml: string,
	label: string,
	options: ApplyLiveDeltaOptions = {},
): Promise<void> {
	const target = createLiveAuthorTarget({
		db: () => snapshotDb(session),
		applyDelta: async (deltaToml) => {
			let t = Date.now();
			const before = localManifestDigestSet(session);
			try {
				await session.conn.reducers.rApplyManifestDelta({ toml: deltaToml });
			} catch (error) {
				if (options.tolerateAlreadyApplied && isManifestAlreadyApplied(error)) {
					return { ok: true };
				}
				throw error;
			}
			t = liveDeltaTiming(`[${label}] enqueue`, t);
			await waitForManifestSeal(session, before, label);
			liveDeltaTiming(`[${label}] seal-wait`, t);
			return { ok: true };
		},
	});
	const result = await target.applyBatch(toml);
	if (!result.ok) {
		throw new Error(`live-delta: [${label}] apply failed — ${result.detail ?? "unknown error"}`);
	}
	console.log(`[live-delta] [${label}] applied live (${toml.split("\n").length} lines).`);
}
