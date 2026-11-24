import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readSessionById } from "../core/readers/session";
import { readParticipantSessionStatus } from "../core/readers/session_status";

function dbWithSessions() {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "core:core/hero", bundleId: "core", entityId: 10n },
		],
		session: [
			{
				sessionId: 9n,
				sessionDefId: "core/combat",
				lifecycle: "active",
				currentActor: "20",
				stateJson: "{}",
			},
			{
				sessionId: 3n,
				sessionDefId: "core/social",
				lifecycle: "active",
				currentActor: "10",
				stateJson: "{}",
			},
		],
		session_participant: [
			{ sessionId: 9n, actorId: "10", ordinal: 2, joinedAt: 5n },
			{ sessionId: 9n, actorId: "20", ordinal: 1, joinedAt: 4n },
			{ sessionId: 9n, actorId: "15", ordinal: 1, joinedAt: 4n },
		],
	});
}

describe("readParticipantSessionStatus", () => {
	it("returns deterministic compact lifecycle, roster, and turn status", () => {
		expect(readParticipantSessionStatus(dbWithSessions(), asEntityRef("10"))).toEqual({
			in_session: true,
			session_id: "9",
			session_definition_id: "core/combat",
			lifecycle: "active",
			current_actor: "20",
			my_turn: false,
			participant_count: 3,
			roster: [
				{ actor_id: "15", ordinal: 1, name: null },
				{ actor_id: "20", ordinal: 1, name: null },
				{ actor_id: "10", ordinal: 2, name: null },
			],
		});
	});

	it("resolves an authored actor alias before participant matching", () => {
		expect(readParticipantSessionStatus(dbWithSessions(), asEntityRef("core/hero"))).toEqual(
			readParticipantSessionStatus(dbWithSessions(), asEntityRef("10")),
		);
	});

	it("preserves entity-prefixed and numeric reference parity", () => {
		expect(readParticipantSessionStatus(dbWithSessions(), asEntityRef("entity:10"))).toEqual(
			readParticipantSessionStatus(dbWithSessions(), asEntityRef("10")),
		);
	});

	it("returns null when the actor participates in no active session", () => {
		expect(readParticipantSessionStatus(dbWithSessions(), asEntityRef("99"))).toBeNull();
	});

	it("fails closed for an unresolved authored alias", () => {
		expect(readParticipantSessionStatus(dbWithSessions(), asEntityRef("core/missing"))).toBeNull();
	});
});

// sk-awlo.16: a session paused on a reaction window (or waiting on a specific
// participant) is still a live session. Collapsing it to "no session" tells a
// player mid-fight there is no fight. The status reader must return the row and
// report its true lifecycle, and must still exclude terminal / pre-active rows.
function dbWithLifecycle(lifecycle: string) {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		session: [
			{
				sessionId: 4n,
				sessionDefId: "core/combat",
				lifecycle,
				currentActor: "10",
				stateJson: "{}",
			},
		],
		session_participant: [{ sessionId: 4n, actorId: "10", ordinal: 1, joinedAt: 1n }],
	});
}

describe("readParticipantSessionStatus lifecycle set", () => {
	it.each([
		"active",
		"awaiting-turn",
		"awaiting-reactions",
	])("reports the live lifecycle %s instead of collapsing to no session", (lifecycle) => {
		const status = readParticipantSessionStatus(dbWithLifecycle(lifecycle), asEntityRef("10"));
		expect(status).not.toBeNull();
		expect(status?.lifecycle).toBe(lifecycle);
		expect(status?.my_turn).toBe(true);
	});

	it.each([
		"completed",
		"abandoned",
		"failed",
		"initiated",
		"waiting-on-external",
	])("treats the non-live lifecycle %s as no session", (lifecycle) => {
		expect(readParticipantSessionStatus(dbWithLifecycle(lifecycle), asEntityRef("10"))).toBeNull();
	});
});

describe("readSessionById lastAdvancedAt projection", () => {
	it("projects a present lastAdvancedAt", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			session: [
				{
					sessionId: 7n,
					sessionDefId: "core/combat",
					lifecycle: "active",
					currentActor: "10",
					stateJson: "{}",
					lastAdvancedAt: 11n,
				},
			],
		});
		expect(readSessionById(db, 7n)?.lastAdvancedAt).toBe(11n);
	});

	it("projects a missing lastAdvancedAt as null, not 0n", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			session: [
				{
					sessionId: 7n,
					sessionDefId: "core/combat",
					lifecycle: "active",
					currentActor: "10",
					stateJson: "{}",
				},
			],
		});
		expect(readSessionById(db, 7n)?.lastAdvancedAt).toBeNull();
	});
});
