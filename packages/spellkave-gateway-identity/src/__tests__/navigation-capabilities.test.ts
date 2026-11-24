// The account page offers each world's destinations (join, play, observe,
// oversee) from what the player may do there: catalog role, current seat and
// scoped visibility grants that expire at a world tick. These cases pin that
// projection, so a player is never offered oversight they do not hold. Pure
// functions over hand-built inputs; no node, no network.

// keep-file(K1): rule cases of one pure capability projection

import { describe, expect, it } from "vitest";

import {
	ACCOUNT_NAVIGATION_CAPABILITY,
	accountGlobalNavigationCapabilities,
	accountWorldNavigationCapabilities,
} from "../navigation-capabilities.ts";

describe("account navigation capabilities", () => {
	it("keeps independent world permissions simultaneous", () => {
		expect(
			accountWorldNavigationCapabilities({
				role: "owner",
				isCurrentSeat: true,
				selfCapabilities: [
					{
						extentRef: "region/one",
						extentKindRef: "place_graph",
						elevationClass: "Internal",
					},
				],
			}),
		).toEqual([
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OBSERVE,
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_PLAY,
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_MANAGE,
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OVERSEE,
		]);
	});

	it("offers an open world for joining without implying observation access", () => {
		expect(accountWorldNavigationCapabilities({ role: "open", isCurrentSeat: false })).toEqual([
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_JOIN,
		]);
	});

	it("does not expose authored oversight without the current seat", () => {
		expect(
			accountWorldNavigationCapabilities({
				role: "member",
				isCurrentSeat: false,
				selfCapabilities: [
					{
						extentRef: "region/one",
						extentKindRef: "place_graph",
						elevationClass: "Internal",
					},
				],
			}),
		).toEqual([
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OBSERVE,
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_JOIN,
		]);
	});

	it.each(["member", "owner"])("offers a seatless %s a hero claim destination", (role) => {
		const capabilities = accountWorldNavigationCapabilities({ role, isCurrentSeat: false });
		expect(capabilities).toContain(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_JOIN);
		expect(capabilities).toContain(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OBSERVE);
		expect(capabilities).not.toContain(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_PLAY);
	});

	it("does not infer joining from an unknown catalog role", () => {
		expect(
			accountWorldNavigationCapabilities({ role: "unknown", isCurrentSeat: false }),
		).not.toContain(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_JOIN);
	});

	it("does not turn an unscoped Internal ceiling into oversight", () => {
		expect(
			accountWorldNavigationCapabilities({
				role: "member",
				isCurrentSeat: true,
				selfCapabilities: [{ elevationClass: "Internal" }],
			}),
		).toEqual([
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OBSERVE,
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_PLAY,
		]);
	});

	it("does not turn a scoped Hidden ceiling into oversight", () => {
		expect(
			accountWorldNavigationCapabilities({
				role: "member",
				isCurrentSeat: true,
				selfCapabilities: [
					{
						extentRef: "region/one",
						extentKindRef: "place_graph",
						elevationClass: "Hidden",
					},
				],
			}),
		).toEqual([
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OBSERVE,
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_PLAY,
		]);
	});

	it("does not expose oversight when the scoped grant expires at the current tick", () => {
		expect(
			accountWorldNavigationCapabilities({
				role: "member",
				isCurrentSeat: true,
				currentTick: 40,
				selfCapabilities: [
					{
						extentRef: "region/one",
						extentKindRef: "place_graph",
						elevationClass: "Internal",
						expiresAtTick: 40,
					},
				],
			}),
		).toEqual([
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OBSERVE,
			ACCOUNT_NAVIGATION_CAPABILITY.WORLD_PLAY,
		]);
	});

	it("exposes oversight while the scoped grant expires in the future", () => {
		expect(
			accountWorldNavigationCapabilities({
				role: "member",
				isCurrentSeat: true,
				currentTick: 40,
				selfCapabilities: [
					{
						extentRef: "region/one",
						extentKindRef: "place_graph",
						elevationClass: "Internal",
						expiresAtTick: 41,
					},
				],
			}),
		).toContain(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OVERSEE);
	});

	it.each([undefined, 41, 40])("projects ID-derived depth with expiry %s", (expiresAtTick) => {
		const result = accountWorldNavigationCapabilities({
			role: "member",
			isCurrentSeat: true,
			currentTick: 40,
			selfCapabilities: [
				{
					capabilityId: "frontier.read_internal",
					elevationClass: "Hidden",
					extentRef: "forest",
					extentKindRef: "place_graph",
					expiresAtTick,
				},
			],
		});
		expect(result.includes(ACCOUNT_NAVIGATION_CAPABILITY.WORLD_OVERSEE)).toBe(expiresAtTick !== 40);
	});

	it("projects system operation separately from world capabilities", () => {
		expect(accountGlobalNavigationCapabilities(false)).toEqual([]);
		expect(accountGlobalNavigationCapabilities(true)).toEqual([
			ACCOUNT_NAVIGATION_CAPABILITY.SYSTEM_MANAGE,
		]);
	});
});
