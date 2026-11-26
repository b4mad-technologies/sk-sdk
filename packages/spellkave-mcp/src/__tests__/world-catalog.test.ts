// The world catalog says which worlds exist, who owns them and who may claim a seat
// there, and a malformed catalog is rejected instead of guessed at. If it breaks,
// players claim seats in worlds they should not or cannot in ones they should. Pure
// parser and claim rule, plus a temp file for the atomic save.

// keep-file(K1): catalog parser and claim rule

import { statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CatalogWorld,
	canClaimSeat,
	loadWorldCatalog,
	PLAYER_WORLD_CATALOG_VERSION,
	parseWorldCatalog,
	saveWorldCatalog,
	type WorldCatalog,
} from "@spellkave/gateway-identity";
import { describe, expect, it } from "vitest";

describe("parseWorldCatalog", () => {
	it("parses catalog with explicit owner, members, and join_policy", () => {
		const parsed = parseWorldCatalog({
			v: PLAYER_WORLD_CATALOG_VERSION,
			worlds: [
				{
					slug: "open-world",
					display_name: "Open World",
					adventure: "kavemouth",
					db: "spellkave-open",
					status: "running",
					visibility: "public",
					owner: "user_owner",
					members: ["user_alice", "user_bob"],
					join_policy: "open",
				},
			],
		});
		expect(parsed.worlds[0]).toEqual({
			slug: "open-world",
			display_name: "Open World",
			adventure: "kavemouth",
			db: "spellkave-open",
			status: "running",
			visibility: "public",
			owner: "user_owner",
			members: ["user_alice", "user_bob"],
			join_policy: "open",
			paused: false,
		});
	});

	it("preserves unknown top-level and per-world entry fields", () => {
		const raw = {
			v: PLAYER_WORLD_CATALOG_VERSION,
			custom_top_level: "top-level-meta",
			worlds: [
				{
					slug: "open-world",
					display_name: "Open World",
					adventure: "kavemouth",
					db: "spellkave-open",
					status: "running",
					visibility: "public",
					owner: "user_owner",
					members: ["user_alice"],
					join_policy: "open",
					custom_world_prop: 42,
					tags: ["dnd", "5e"],
				},
			],
		};
		const parsed = parseWorldCatalog(raw);
		expect(parsed.custom_top_level).toBe("top-level-meta");
		expect(parsed.worlds[0]?.custom_world_prop).toBe(42);
		expect(parsed.worlds[0]?.tags).toEqual(["dnd", "5e"]);
	});

	it("applies defaults: members=[] and join_policy='invite'", () => {
		const parsed = parseWorldCatalog({
			v: PLAYER_WORLD_CATALOG_VERSION,
			worlds: [
				{
					slug: "invite-world",
					display_name: "Invite World",
					adventure: "kavemouth",
					db: "spellkave-invite",
					status: "running",
					visibility: "public",
					owner: "user_owner",
				},
			],
		});
		expect(parsed.worlds[0]).toEqual({
			slug: "invite-world",
			display_name: "Invite World",
			adventure: "kavemouth",
			db: "spellkave-invite",
			status: "running",
			visibility: "public",
			owner: "user_owner",
			members: [],
			join_policy: "invite",
			paused: false,
		});
	});

	it("throws naming the slug when owner is missing or empty", () => {
		expect(() =>
			parseWorldCatalog({
				v: PLAYER_WORLD_CATALOG_VERSION,
				worlds: [
					{
						slug: "missing-owner-world",
						display_name: "Missing Owner",
						adventure: "kavemouth",
						db: "spellkave-missing",
						status: "running",
						visibility: "public",
					},
				],
			}),
		).toThrow(/world catalog entry 'missing-owner-world' is missing owner/);

		expect(() =>
			parseWorldCatalog({
				v: PLAYER_WORLD_CATALOG_VERSION,
				worlds: [
					{
						slug: "empty-owner-world",
						display_name: "Empty Owner",
						adventure: "kavemouth",
						db: "spellkave-empty",
						status: "running",
						visibility: "public",
						owner: "   ",
					},
				],
			}),
		).toThrow(/world catalog entry 'empty-owner-world' is missing owner/);
	});

	it("throws when members is not an array of non-empty strings", () => {
		expect(() =>
			parseWorldCatalog({
				v: PLAYER_WORLD_CATALOG_VERSION,
				worlds: [
					{
						slug: "bad-members",
						display_name: "Bad Members",
						adventure: "kavemouth",
						db: "spellkave-bad",
						status: "running",
						visibility: "public",
						owner: "user_owner",
						members: "not-an-array",
					},
				],
			}),
		).toThrow(/world catalog entry 'bad-members' members must be an array of strings/);

		expect(() =>
			parseWorldCatalog({
				v: PLAYER_WORLD_CATALOG_VERSION,
				worlds: [
					{
						slug: "bad-member-elem",
						display_name: "Bad Member Element",
						adventure: "kavemouth",
						db: "spellkave-bad-elem",
						status: "running",
						visibility: "public",
						owner: "user_owner",
						members: [123],
					},
				],
			}),
		).toThrow(/world catalog entry 'bad-member-elem' member at index 0 must be a non-empty string/);
	});

	it("throws when join_policy is invalid", () => {
		expect(() =>
			parseWorldCatalog({
				v: PLAYER_WORLD_CATALOG_VERSION,
				worlds: [
					{
						slug: "bad-policy",
						display_name: "Bad Policy",
						adventure: "kavemouth",
						db: "spellkave-bad-policy",
						status: "running",
						visibility: "public",
						owner: "user_owner",
						join_policy: "unknown",
					},
				],
			}),
		).toThrow(/world catalog entry 'bad-policy' has invalid join_policy 'unknown'/);
	});

	it("throws when catalog version is invalid", () => {
		expect(() =>
			parseWorldCatalog({
				v: "invalid-version",
				worlds: [],
			}),
		).toThrow(/world catalog is not player-world-catalog\/v1/);
	});
});

describe("saveWorldCatalog", () => {
	it("atomically writes catalog to disk with mode 0600 and preserves unknown fields", () => {
		const tmpPath = join(
			tmpdir(),
			`test-catalog-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
		);
		try {
			const catalog: WorldCatalog = {
				v: PLAYER_WORLD_CATALOG_VERSION,
				custom_meta: { operator: "admin", region: "eu" },
				worlds: [
					{
						slug: "test-world",
						display_name: "Test World",
						adventure: "kavemouth",
						db: "spellkave-test",
						status: "running",
						visibility: "public",
						owner: "user_owner",
						members: ["user_alice"],
						join_policy: "open",
						paused: false,
						extra_setting: true,
					},
				],
			};

			saveWorldCatalog(tmpPath, catalog);

			const stat = statSync(tmpPath);
			expect(stat.mode & 0o777).toBe(0o600);

			const loaded = loadWorldCatalog(tmpPath);
			expect(loaded).toEqual(catalog);
			expect(loaded.custom_meta).toEqual({ operator: "admin", region: "eu" });
			expect(loaded.worlds[0]?.extra_setting).toBe(true);
		} finally {
			try {
				unlinkSync(tmpPath);
			} catch {
				// ignore
			}
		}
	});
});

describe("canClaimSeat", () => {
	const baseWorld: CatalogWorld = {
		slug: "test-world",
		display_name: "Test World",
		adventure: "kavemouth",
		db: "spellkave-test",
		status: "running",
		visibility: "public",
		owner: "user_owner",
		members: ["user_member_1", "user_member_2"],
		join_policy: "invite",
	};

	it("allows owner in invite world", () => {
		expect(canClaimSeat(baseWorld, "user_owner")).toBe(true);
	});

	it("allows member in invite world", () => {
		expect(canClaimSeat(baseWorld, "user_member_1")).toBe(true);
		expect(canClaimSeat(baseWorld, "user_member_2")).toBe(true);
	});

	it("denies stranger in invite world", () => {
		expect(canClaimSeat(baseWorld, "user_stranger")).toBe(false);
		expect(canClaimSeat(baseWorld, "")).toBe(false);
	});

	it("allows anyone (strangers, owner, members) in open world", () => {
		const openWorld: CatalogWorld = {
			...baseWorld,
			join_policy: "open",
		};
		expect(canClaimSeat(openWorld, "user_stranger")).toBe(true);
		expect(canClaimSeat(openWorld, "user_owner")).toBe(true);
		expect(canClaimSeat(openWorld, "user_member_1")).toBe(true);
	});
});
