import { describe, expect, it } from "vitest";
import type { PaceTimePort } from "../pace-time";
import { hasPresenceActAuthority, presenceActBodies } from "../presence-acts";

function fixture() {
	const identity = (value: string) => ({ toHexString: () => value });
	const iter = <T>(rows: T[]) => ({ iter: () => rows });
	const bindings = [
		{
			bindingId: "own/dm",
			roleId: "custom",
			presenceEntityId: 9n,
			realisedAtTick: 0n,
			expiresAtTick: undefined as bigint | undefined,
		},
	];
	const grants = [
		{
			entityId: 9n,
			capabilityId: "frontier.despawn",
			source: "role_binding:own/dm",
			grantedAtTick: 0n,
			expiresAtTick: undefined as bigint | undefined,
		},
	];
	const role = { roleId: "custom", capabilityIds: ["frontier.despawn"] };
	const connection = {
		identity: identity("caller"),
		db: {
			config: iter([{ operatorIdentity: identity("publisher") }]),
			worldTime: iter([{ tick: 4n }]),
			actor: iter([{ actorId: 2n, currentBody: 9n }]),
			visibleActorIdentity: iter([{ actorId: 2n, identity: identity("caller") }]),
			visibleRoleBinding: iter(bindings),
			visibleCapability: iter(grants),
			roleDefinition: iter([role]),
			roleAggregation: iter([]),
			affordanceTemplate: iter([{ capabilityId: "frontier.despawn" }]),
		},
	};
	return { port: { connection } as unknown as PaceTimePort, connection, bindings, grants, role };
}

describe("presence act authority advisory", () => {
	it("discovers the exact owned body without depending on role name", () => {
		const f = fixture();
		expect(presenceActBodies(f.port)).toEqual(["entity:9"]);
		expect(hasPresenceActAuthority(f.port)).toBe(true);
	});
	it("normalizes a permanent zero-expiry binding like server realisation", () => {
		const f = fixture();
		f.bindings[0]!.expiresAtTick = 0n;
		expect(presenceActBodies(f.port)).toEqual(["entity:9"]);
	});
	it.each([
		"bare",
		"foreign",
		"expired",
		"retracted",
		"role changed",
		"publisher",
	])("refuses %s authority", (kind) => {
		const f = fixture();
		if (kind === "bare") f.grants[0]!.source = "manifest";
		if (kind === "foreign") f.connection.identity = { toHexString: () => "other" };
		if (kind === "expired") f.bindings[0]!.expiresAtTick = 4n;
		if (kind === "retracted") f.bindings.splice(0);
		if (kind === "role changed") f.role.capabilityIds = [];
		if (kind === "publisher") f.connection.identity = { toHexString: () => "publisher" };
		expect(presenceActBodies(f.port)).toEqual([]);
	});
});
