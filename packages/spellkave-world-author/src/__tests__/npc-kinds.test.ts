import { describe, expect, it } from "vitest";
import {
	compileNpcKindDocuments,
	type NpcKindArtifact,
	type NpcKindSource,
	parseNpcKindArtifact,
	SERVICE_ONLY_AUDIENCE_TAG,
} from "../npc-kinds";

/** Every capability that is the audience of a namespace in these rows. */
function unmarkedAudiences(manifest: Record<string, unknown>): string[] {
	const rows = (table: string) => (manifest[table] ?? []) as Record<string, string>[];
	const marked = new Set(
		rows("capability_definition_tag")
			.filter((row) => row.tag === SERVICE_ONLY_AUDIENCE_TAG && row.source === "manifest")
			.map((row) => row.capability_id),
	);
	return rows("metadata_namespaces")
		.map((row) => row.audience!)
		.filter((audience) => !marked.has(audience));
}

function source(): NpcKindSource {
	return {
		bundle_id: "example",
		namespace_prefix: "example/npc-kinds",
		catalog: { quests: [], flag_state_ids: {} },
		groups: [
			{
				key: "innkeeper",
				npc_kind: "menu-talker",
				actors: [{ actor_key: "example/npc/innkeeper" }],
				config: { greeting: "Welcome." },
			},
			{
				key: "wolves",
				npc_kind: "role-combatant",
				actors: [{ actor_key: "example/npc/wolf_1" }, { actor_key: "example/npc/wolf_2" }],
				config: { params: { fleeHpFraction: 0.25 } },
			},
			{
				key: "scout",
				npc_kind: "companion",
				actors: [{ actor_key: "example/npc/scout", blueprint_id: "example/scout" }],
				config: { join: "I will come." },
			},
		],
	};
}

const REFUSAL = "NPC kind artifact digest or derived rows mismatch";

describe("sealed ordinary-kind artifact", () => {
	it("carries its fixed-point source and is re-derived from it", async () => {
		const artifact = await compileNpcKindDocuments(source());
		// The carried source is the form the digest is taken over: no fractions.
		expect(JSON.stringify(artifact.source)).not.toMatch(/0\.25/);
		// Compiling the carried source again changes nothing.
		expect(await compileNpcKindDocuments(artifact.source)).toEqual(artifact);
		const parsed = await parseNpcKindArtifact(JSON.stringify(artifact));
		expect(parsed).toEqual(artifact);
		expect(parsed.mounts.map((mount) => mount.npc_kind).sort()).toEqual([
			"companion",
			"menu-talker",
			"role-combatant",
			"role-combatant",
		]);
	});

	it("marks every read capability as a service-only audience", async () => {
		const artifact = await compileNpcKindDocuments(source());
		// The catalog and one private namespace per group.
		expect(artifact.manifest.metadata_namespaces).toHaveLength(4);
		expect(artifact.manifest.capability_definition_tag).toHaveLength(4);
		expect(unmarkedAudiences(artifact.manifest)).toEqual([]);
	});

	it("refuses every envelope that is not exactly what its source derives", async () => {
		const artifact = await compileNpcKindDocuments(source());
		const changed = (change: (value: NpcKindArtifact & Record<string, unknown>) => void) => {
			const value = structuredClone(artifact) as NpcKindArtifact & Record<string, unknown>;
			change(value);
			return JSON.stringify(value);
		};
		const rows = (value: NpcKindArtifact, table: string) =>
			(value.manifest as Record<string, Record<string, unknown>[]>)[table] ?? [];
		const cases: [string, string][] = [
			[
				"an unknown envelope field",
				changed((value) => {
					value.note = "extra";
				}),
			],
			["no source", changed((value) => void delete (value as Record<string, unknown>).source)],
			["a source that is not the fixed point", JSON.stringify({ ...artifact, source: source() })],
			[
				"a changed document payload",
				changed((value) => {
					const row = rows(value, "metadata_attachments")[0];
					if (!row) throw new Error("fixture has no attachment");
					row.payload_json = "{}";
				}),
			],
			[
				"an extra capability grant",
				changed((value) => {
					rows(value, "actor_capabilities").push({
						...(rows(value, "actor_capabilities")[0] ?? {}),
						entity_key: "example/hero",
					});
				}),
			],
			[
				"a widened namespace audience",
				changed((value) => {
					const row = rows(value, "metadata_namespaces")[0];
					if (!row) throw new Error("fixture has no namespace");
					for (const key of Object.keys(row))
						if (/capab|audience|read/i.test(key)) row[key] = "example/anyone";
				}),
			],
			["a dropped mount", changed((value) => void value.mounts.pop())],
			[
				"a mount of another kind",
				changed((value) => {
					const mount = value.mounts[0];
					if (mount) mount.npc_kind = "companion";
				}),
			],
			[
				"a wrong digest",
				changed((value) => {
					value.source_content_hash = "sha256:00";
				}),
			],
			[
				"a changed source that no longer matches the rows",
				changed((value) => {
					(value.source as { bundle_id: string }).bundle_id = "other";
				}),
			],
			["not an object", "[]"],
			["not JSON", "{"],
		];
		for (const [name, json] of cases)
			await expect(parseNpcKindArtifact(json), name).rejects.toThrow(REFUSAL);
	});

	it("refuses a source the compiler would not compile", async () => {
		const artifact = await compileNpcKindDocuments(source());
		const bad = structuredClone(artifact);
		(bad.source.groups[0] as { npc_kind: string }).npc_kind = "quest-giver";
		await expect(parseNpcKindArtifact(JSON.stringify(bad))).rejects.toThrow(REFUSAL);
	});
});
