import type { SpellkaveSession } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import {
	callerActingContexts,
	callerToolAuthority,
	createActingContextSelector,
} from "../acting-context";

function fixture() {
	const identity = (text: string) => ({ toHexString: () => text });
	const identities = [
		{ identity: identity("mine"), role: "primary", actorId: 1n },
		{ identity: identity("mine"), role: "presence", actorId: 2n },
		{ identity: identity("mine"), role: "presence", actorId: 3n },
		{ identity: identity("foreign"), role: "presence", actorId: 4n },
	];
	const bindings = [2, 3, 4].map((id) => ({
		subject: id === 4 ? "foreign" : "mine",
		presenceEntityId: BigInt(id * 10),
		bindingId: `b${id}`,
		realisedAtTick: 0n,
		expiresAtTick: 0n,
	}));
	const grants = [2, 3, 4].map((id) => ({
		entityId: BigInt(id * 10),
		capabilityId: "frontier.edit_weather",
		source: `role_binding:b${id}`,
		grantedAtTick: 0n,
		expiresAtTick: 0n,
	}));
	const rows = (values: unknown[]) => ({ iter: () => values });
	const session = {
		conn: {
			identity: identity("mine"),
			isActive: true,
			db: {
				worldTime: rows([{ tick: 5n }]),
				visibleActorIdentity: rows(identities),
				actor: rows(
					[1, 2, 3, 4].map((id) => ({ actorId: BigInt(id), currentBody: BigInt(id * 10) })),
				),
				visibleRoleBinding: rows(bindings),
				visibleCapability: rows(grants),
				roleDefinition: rows([{ roleId: "custom", capabilityIds: ["frontier.edit_weather"] }]),
				roleAggregation: rows([]),
			},
		},
	} as unknown as SpellkaveSession;
	return { session, bindings, grants, identities };
}

describe("caller-owned acting context", () => {
	it("lists only self-owned realized bindings and a distinct character", () => {
		const { session } = fixture();
		expect(callerActingContexts(session).map((row) => row.bindingId ?? row.kind)).toEqual([
			"b2",
			"b3",
			"character",
		]);
		expect(callerToolAuthority(session)).toMatchObject({
			publisher: false,
			character: true,
			capabilities: ["frontier.edit_weather"],
			bodyCapabilities: [["frontier.edit_weather"], ["frontier.edit_weather"], []],
		});
	});
	it("requires an explicit own binding for ambiguous authority and never switches a revoked selection", () => {
		const { session, bindings } = fixture();
		const selector = createActingContextSelector(session);
		expect(() => selector.resolve("frontier.edit_weather")).toThrow("ambiguous_acting_context");
		selector.select({ binding_id: "b2" });
		expect(selector.resolve("frontier.edit_weather").bodyId).toBe("20");
		expect(() => selector.select({ binding_id: "b4" })).toThrow("acting_context_unavailable");
		expect(selector.resolve().bodyId).toBe("20");
		bindings.splice(0, 1);
		expect(() => selector.resolve()).toThrow("acting_context_unavailable");
	});
	it("acts only as the bound character when the identity holds several (ADR-0161 D-5)", () => {
		const { session, identities } = fixture();
		identities.push({ identity: { toHexString: () => "mine" }, role: "primary", actorId: 4n });
		// Two characters (bodies 10 and 40) and no binding selection: ambiguous unbound.
		expect(() => createActingContextSelector(session).resolve()).toThrow(
			"ambiguous_acting_context",
		);
		const boundTo40 = createActingContextSelector(session, { boundBodyId: "40" });
		expect(boundTo40.resolve()).toMatchObject({ kind: "character", bodyId: "40" });
		expect(boundTo40.read().filter((choice) => choice.kind === "character")).toHaveLength(1);
		// The advertised tool authority does not union the other hero either.
		const grants40 = [...session.conn.db.visibleCapability.iter()] as { entityId: bigint }[];
		expect(grants40.some((grant) => grant.entityId === 40n)).toBe(true);
		const unbound = callerToolAuthority(session);
		const bound = callerToolAuthority(session, "10");
		expect(unbound.bodyCapabilities).toHaveLength(bound.bodyCapabilities.length + 1);
		expect(callerActingContexts(session, "10").map((c) => c.bodyId)).not.toContain("40");
		// Presences of the same identity stay selectable.
		boundTo40.select({ binding_id: "b2" });
		expect(boundTo40.resolve("frontier.edit_weather").bodyId).toBe("20");
	});
	it("admits presence-only sessions, expiring capabilities and bindings independently", () => {
		const { session, identities, bindings, grants } = fixture();
		identities.splice(0, 1);
		bindings[1]!.expiresAtTick = 5n;
		const selector = createActingContextSelector(session);
		expect(selector.resolve()).toMatchObject({ kind: "presence", bindingId: "b2" });
		grants[0]!.expiresAtTick = 5n;
		expect(() => selector.resolve("frontier.edit_weather")).toThrow("acting_context_unavailable");
		expect(callerToolAuthority(session).character).toBe(false);
	});
});
