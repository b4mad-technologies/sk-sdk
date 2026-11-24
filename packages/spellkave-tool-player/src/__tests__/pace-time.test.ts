import { bindTool } from "@spellkave/tool-runtime";
import { describe, expect, it, vi } from "vitest";
import {
	createPaceTimeTools,
	hasPaceTimeAuthority,
	type PaceTimePort,
	paceTimeToolDefinition,
	paceTimeToolDefinitions,
} from "../pace-time";

function port(publisher = false) {
	const identity = (value: string) => ({ toHexString: () => value });
	const events: { id: bigint; tick: bigint; requestId: string }[] = [];
	const iter = <T>(rows: T[]) => ({ iter: () => rows });
	const capabilities = [{ entityId: 9n, capabilityId: "frontier.pace_time", grantedAtTick: 0n }];
	const paceTime = vi.fn(async (args: { requestId: string }) => {
		events.push({ id: 77n, tick: 4n, requestId: args.requestId });
		events.push({ id: 78n, tick: 4n, requestId: "other concurrent caller" });
	});
	const connection = {
		identity: identity(publisher ? "publisher" : "caller"),
		db: {
			config: iter([{ operatorIdentity: identity("publisher"), tickIntervalSecs: 300n }]),
			visibleActorIdentity: iter([{ actorId: 2n, identity: identity("caller") }]),
			actor: iter([{ actorId: 2n, currentBody: 9n }]),
			visibleRoleBinding: iter([{ presenceEntityId: 9n, realisedAtTick: 0n }]),
			visibleCapability: iter(capabilities),
			worldTime: iter([{ tick: 4n }]),
			visibleWorldEvent: iter(events),
			worldTickTimer: iter([]),
		},
		reducers: { paceTime },
	};
	return { port: { connection } as unknown as PaceTimePort, paceTime, capabilities };
}

describe("capability-owned time factory", () => {
	it("does not expose time with an absent world connection", () =>
		expect(createPaceTimeTools()).toEqual([]));
	it("refuses the publisher before any RPC even if manually bound", async () => {
		const p = port(true);
		expect(createPaceTimeTools(p.port)).toEqual([]);
		const tool = bindTool(paceTimeToolDefinition, { context: p.port, capabilities: {} });
		await expect(tool.execute("publisher", { op: "pause" })).rejects.toThrow(
			"publisher connection",
		);
		expect(p.paceTime).not.toHaveBeenCalled();
	});
	it("discovers by live capability without a role-name check", () => {
		const p = port();
		expect(createPaceTimeTools(p.port).map((t) => t.name)).toEqual(["spellkave_pace_time"]);
		expect(createPaceTimeTools(p.port).map((t) => t.name)).toEqual(
			paceTimeToolDefinitions.map((definition) => definition.name),
		);
		p.capabilities.splice(0);
		expect(hasPaceTimeAuthority(p.port)).toBe(false);
		expect(createPaceTimeTools(p.port)).toEqual([]);
	});
	it("a cached tool refuses after revocation", async () => {
		const p = port();
		const tool = createPaceTimeTools(p.port)[0];
		if (!tool) throw new Error("expected caller-owned pacing tool");
		p.capabilities.splice(0);
		await expect(tool.execute("revoked", { op: "resume" })).rejects.toThrow(
			"frontier.pace_time unavailable",
		);
		expect(p.paceTime).not.toHaveBeenCalled();
	});
	it("returns its correlated id rather than a concurrent caller's newer header", async () => {
		const p = port();
		const tool = createPaceTimeTools(p.port)[0];
		if (!tool) throw new Error("expected caller-owned pacing tool");
		const result = await tool.execute("pause", { op: "pause" });
		expect(result.details.event_id).toBe("77");
		expect(result.details.paused).toBe(true);
		expect(p.paceTime.mock.calls[0]?.[0].requestId).toMatch(/^[0-9a-f]{32}$/);
	});
});
