import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../../replay";
import { rSessionOpenWrapper } from "./r_session_open";
import { findSessionId } from "./session_lookup";

describe("findSessionId", () => {
	it("ignores terminal sessions and returns the newest matching open session", () => {
		const db = snapshotDbFromFixture({
			session: [
				{ sessionId: 1n, sessionDefId: "combat", lifecycle: "completed" },
				{ sessionId: 2n, sessionDefId: "combat", lifecycle: "active" },
				{ sessionId: 3n, sessionDefId: "combat", lifecycle: "failed" },
				{ sessionId: 4n, sessionDefId: "combat", lifecycle: "active" },
				{ sessionId: 5n, sessionDefId: "social", lifecycle: "active" },
			],
			session_participant: [
				{ sessionId: 1n, actorId: "101" },
				{ sessionId: 1n, actorId: "102" },
				{ sessionId: 2n, actorId: "101" },
				{ sessionId: 2n, actorId: "102" },
				{ sessionId: 3n, actorId: "101" },
				{ sessionId: 3n, actorId: "102" },
				{ sessionId: 4n, actorId: "101" },
				{ sessionId: 4n, actorId: "102" },
				{ sessionId: 5n, actorId: "101" },
				{ sessionId: 5n, actorId: "102" },
			],
		});

		expect(findSessionId(db, "combat", [101n, 102n])).toBe(4n);
	});

	it("does not match an open session with a different participant set", () => {
		const db = snapshotDbFromFixture({
			session: [{ sessionId: 7n, sessionDefId: "combat", lifecycle: "active" }],
			session_participant: [
				{ sessionId: 7n, actorId: "101" },
				{ sessionId: 7n, actorId: "103" },
			],
		});

		expect(findSessionId(db, "combat", [101n, 102n])).toBeUndefined();
	});
});

// Moved from the live local_node.test.ts (now in @spellkave/test-lab): the
// typed wrapper module exists and exports the dispatch function. Offline,
// because an import check needs no node.
describe("rSessionOpenWrapper", () => {
	it("is exported by the typed wrapper module, not a raw bindings call", () => {
		expect(typeof rSessionOpenWrapper).toBe("function");
	});
});
