/**
 * Live proofs for the owner subscription (ADR-0150).
 *
 * An error on an already-applied owner subscription disconnects the whole
 * connection and cannot be attributed to the query
 * (`crates/bindings-typescript/src/sdk/db_connection_impl.ts:1019-1031`,
 * `:1390`, tag `v2.10.0`). A refusal at subscribe time does not.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { connect, ownerSubscriptionTestProbe } from "../connection";

const local = process.env.SPELLKAVE_LOCAL_NODE === "1" ? describe : describe.skip;

function ownerToken(): string {
	const configPath = process.env.SPACETIME_CONFIG_PATH;
	if (!configPath) throw new Error("SPACETIME_CONFIG_PATH is unset");
	const match = readFileSync(configPath, "utf8").match(/spacetimedb_token\s*=\s*"([^"]+)"/);
	if (!match?.[1]) throw new Error("owner token missing from cli.toml");
	return match[1];
}

function target() {
	return {
		url: process.env.SPELLKAVE_URL ?? "http://127.0.0.1:3000",
		db: process.env.SPELLKAVE_DB ?? "spellkave-dev",
	};
}

const quiet = { onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} };

local("owner subscription live", () => {
	it("connects as the publisher and as an anonymous identity", async () => {
		const { url, db } = target();
		const publisher = await connect(
			{ url, db, token: ownerToken(), connectedActorId: "probe", ownerTables: false },
			quiet,
		);
		try {
			await publisher.ready;
		} finally {
			publisher.disconnect();
		}
		const anonymous = await connect(
			{ url, db, token: null, connectedActorId: "probe", ownerTables: false },
			quiet,
		);
		try {
			await anonymous.ready;
		} finally {
			anonymous.disconnect();
		}
	});

	it("keeps the reader connection open when the owner subscribe is refused", async () => {
		const { url, db } = target();
		ownerSubscriptionTestProbe.appendBogusTable = true;
		let session: Awaited<ReturnType<typeof connect>> | undefined;
		try {
			session = await connect(
				{ url, db, token: ownerToken(), connectedActorId: "probe", ownerTables: true },
				quiet,
			);
			await session.ready;
			await expect(session.ownerRowsReady).rejects.toThrow();
			expect(session.readsAsPublisher).toBe(false);
			expect(session.ownerSubscriptionError).toBeInstanceOf(Error);
			await (
				session.conn.reducers as unknown as {
					setTickIntervalSecs: (args: { seconds: bigint }) => Promise<unknown>;
				}
			).setTickIntervalSecs({ seconds: 6n });
		} finally {
			ownerSubscriptionTestProbe.appendBogusTable = false;
			session?.disconnect();
		}
	});
});
