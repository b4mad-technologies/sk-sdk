import { describe, expect, it } from "vitest";
import { connectedAuthorAnswer } from "../authoring";

describe("connected author answer", () => {
	it("states a publisher session without a placed-instance note", () => {
		expect(
			connectedAuthorAnswer({
				readsAsPublisher: true,
				connectedIdentity: "aa11",
				readsPlacedInstances: true,
			}),
		).toEqual({
			reads_as_publisher: true,
			connected_identity: "aa11",
		});
	});

	it("keeps a non-publisher result and names the identity when the tool reads placed instances", () => {
		const answer = connectedAuthorAnswer({
			readsAsPublisher: false,
			connectedIdentity: "bb22",
			readsPlacedInstances: true,
		});
		expect(answer.reads_as_publisher).toBe(false);
		expect(answer.connected_identity).toBe("bb22");
		expect(answer.note).toContain("Scoped instance reads use the current role grants");
		expect(answer.note).toContain("report coverage");
		expect(answer.note).not.toContain("not in this cache");
		expect(answer.note).toContain("bb22");
		expect(answer.note).not.toContain("which is not the publisher");
		expect(answer.note).toContain("sk config view");
		expect(answer.note).not.toContain("SPELLKAVE_CONNECT_TOKEN");
		expect(answer.note).toContain("appropriate read grant");
		expect(answer.note).toContain("entity prune require publisher closure");
	});

	it("names a non-publisher identity without a note when the tool does not read placed instances", () => {
		expect(
			connectedAuthorAnswer({
				readsAsPublisher: false,
				connectedIdentity: "cc33",
				readsPlacedInstances: false,
			}),
		).toEqual({
			reads_as_publisher: false,
			connected_identity: "cc33",
		});
	});
});
