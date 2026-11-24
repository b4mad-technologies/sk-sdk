import {
	parseSeatClaim,
	readWorldSeat,
	worldIdentityFromAccessToken,
} from "@spellkave/gateway-identity";
import { connect, type SpellkaveSession, snapshotDb } from "@spellkave/sdk";

const IDLE_MS = 5 * 60_000;

type Entry = {
	session: Promise<SpellkaveSession>;
	timer?: ReturnType<typeof setTimeout>;
};

/** Runtime-owned routing connections. Never share a caller's subscribed rows
 * with another issuer/subject or consent seat. PLAYER daemons remain separate. */
export function createSeatProbes(options: { idleMs?: number; connectFn?: typeof connect } = {}) {
	const entries = new Map<string, Entry>();
	const connectFn = options.connectFn ?? connect;
	let closed = false;

	function evict(key: string, entry: Entry) {
		if (entries.get(key) !== entry) return;
		entries.delete(key);
		clearTimeout(entry.timer);
		void entry.session.then(
			(session) => session.disconnect(),
			() => undefined,
		);
	}

	async function probe(url: string, db: string, token: string, actorId?: string) {
		if (closed) throw new Error("seat probes are closed");
		// Tokens have already passed the resource server's signature/issuer/audience
		// checks. Refreshes with the same iss/sub/seat may reuse the connection.
		const identity = worldIdentityFromAccessToken(token);
		const claim = parseSeatClaim(token);
		if (claim === "invalid") throw new Error("invalid seat claim");
		const key = JSON.stringify([url, db, identity.iss, identity.sub, claim ?? null]);
		let entry = entries.get(key);
		if (entry === undefined) {
			const created: Entry = {
				session: Promise.resolve().then(async () => {
					const session = await connectFn(
						{
							url,
							db,
							token,
							connectedActorId: "probe",
							// Routing needs no world-state, authoring, or action cache. In
							// particular a DM must not hydrate the default PLAYER profile.
							readerManifests: [{ requiredTables: ["actor", "visible_actor_identity"] }],
						},
						{
							onError() {
								evict(key, created);
							},
							onDisconnect() {
								evict(key, created);
							},
							onUpdate() {},
						},
					);
					try {
						await session.ready;
						return session;
					} catch (error) {
						session.disconnect();
						throw error;
					}
				}),
			};
			entries.set(key, created);
			entry = created;
			void entry.session.catch(() => evict(key, created));
		}
		clearTimeout(entry.timer);
		entry.timer = setTimeout(() => evict(key, entry), options.idleMs ?? IDLE_MS);
		entry.timer.unref();
		const session = await entry.session;
		if (entries.get(key) !== entry) throw new Error("seat probe connection ended");
		// Read live rows on every request: releases/revocations and presence
		// routing changes must not be hidden by caching a seat result.
		return readWorldSeat(snapshotDb(session), actorId, { includeSelfCapabilities: false });
	}

	return {
		probe,
		async close() {
			closed = true;
			const pending = [...entries.values()].map((entry) => entry.session);
			for (const [key, entry] of entries) evict(key, entry);
			await Promise.allSettled(pending);
		},
	};
}
