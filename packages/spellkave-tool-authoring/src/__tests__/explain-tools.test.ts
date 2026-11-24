// embedded-manifest: {"category": "exact_text_oracle", "rationale": "authored contribution text proves bootstrap and workspace composition retain exact descriptions"}
import { describe, expect, it } from "vitest";
import type { AuthorTarget } from "../author-target";
import { type AuthorToolContext, createAuthorFacingBoundTools } from "../authoring";

function tool(context: Partial<AuthorToolContext> = {}) {
	return createAuthorFacingBoundTools({
		workspace: {
			readToml: () => null,
			writeToml: () => {
				throw new Error("read only");
			},
		},
		...context,
	}).find((entry) => entry.name === "spellkave_explain")!;
}

describe("authored vocabulary explanation", () => {
	it("explains a verb from registry capability alternatives without consulting workspace or personas", async () => {
		const answer = await tool({
			workspace: {
				readToml() {
					throw new Error("file read");
				},
				writeToml() {
					throw new Error("write");
				},
			},
		}).execute("t", { kind: "verb", id: "grant_role" });
		expect(answer.details).toMatchObject({
			ok: true,
			kind: "verb",
			server_decides: true,
			admission: {
				anyOf: [
					{ kind: "publisher" },
					{ kind: "prefix", prefix: "frontier.bind." },
					{ kind: "role-capabilities" },
				],
				ports: ["grants"],
			},
		});
		expect(JSON.stringify(answer.details)).not.toContain("Dungeon Master");
	});
	it("persona explanation is versioned documentation and never calls author ports", async () => {
		const answer = await tool({
			workspace: {
				readToml() {
					throw new Error("file read");
				},
				writeToml() {
					throw new Error("write");
				},
			},
		}).execute("t", { kind: "persona", id: "Dungeon Master" });
		expect(answer.details).toMatchObject({
			ok: true,
			documentation_only: true,
			grants_authority: false,
			persona: { roles: ["dm"] },
		});
	});
	it("merges files with bootstrap and retains each contribution and authored descriptions", async () => {
		const answer = await tool({
			workspace: {
				readToml: () => `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "house-rules"
display_name = "House rules"
author = "test"
version = "1.0.0"
[[capability_definitions]]
capability_id = "house-rules/weather"
actor_kind = ""
bundle_id = "house-rules"
display_name = "Weather"
description = "Change the authored weather."
[[role_aggregations]]
role_id = "dm"
bundle_id = "house-rules"
description = "Our weather contribution."
capability_ids = ["house-rules/weather", "frontier.read_hidden"]
`,
				writeToml: () => {
					throw new Error("read only");
				},
			},
		}).execute("t", { kind: "role", id: "dm" });
		expect(answer.details).toMatchObject({
			ok: true,
			source: "files",
			// Authored acts and the bounded session opener join bootstrap read capabilities.
			capability_ids: [
				"frontier.afflict",
				"frontier.despawn",
				"frontier.impersonate",
				"frontier.inscribe",
				"frontier.open_session",
				"frontier.read_hidden",
				"frontier.read_internal",
				"frontier.set_state",
				"frontier.spawn_entity_definition",
				"frontier.transfer",
				"house-rules/weather",
			],
			contributions: [
				{ bundle_id: "core" },
				{ bundle_id: "house-rules", description: "Our weather contribution." },
			],
		});
		expect(JSON.parse(answer.content[0].text!)).toEqual(answer.details);
	});
	it("does not synthesize bootstrap facts in an empty live vocabulary", async () => {
		const target: AuthorTarget = {
			kind: "live",
			lookup: () => [],
			resolveRef: () => false,
			applyBatch: async () => {
				throw new Error("read only");
			},
		};
		const answer = await tool({ target }).execute("t", { kind: "role", id: "dm", target: "live" });
		expect(answer.details).toEqual({
			ok: false,
			kind: "role",
			id: "dm",
			source: "live",
			nearest_ids: [],
		});
	});
	it("offers the nearest authored prefix for an unknown role", async () => {
		const answer = await tool().execute("t", { kind: "role", id: "dmm" });
		expect(answer.details).toMatchObject({
			ok: false,
			nearest_ids: ["dm", "adventure-author", "npc-host", "system-author", "timekeeper"],
		});
	});
	it("refuses a live request without a live target", async () => {
		await expect(tool().execute("t", { kind: "role", id: "dm", target: "live" })).rejects.toThrow(
			"public vocabulary",
		);
	});
	it("capability answers name roles and authored requirement rows, with no privilege ladder", async () => {
		const result = await tool().execute("t", { kind: "capability", id: "frontier.pace_time" });
		expect(result.details).toMatchObject({
			ok: true,
			roles: [{ role_id: "timekeeper" }],
			affordance_templates: [],
			action_definitions: [],
		});
	});
	it("extent-kind files and live agree when the actual public rows agree", async () => {
		const files = await tool().execute("t", { kind: "extent-kind", id: "place_graph" });
		const definition = (files.details as { definition: Record<string, unknown> }).definition;
		const target: AuthorTarget = {
			kind: "live",
			lookup: (kind) => (kind === "extent_kind_definitions" ? [definition] : []),
			resolveRef: () => false,
			applyBatch: async () => {
				throw new Error("read only");
			},
		};
		const live = await tool({ target }).execute("t", {
			kind: "extent-kind",
			id: "place_graph",
			target: "live",
		});
		expect(live.details).toEqual({ ...(files.details as object), source: "live" });
		expect(definition.resolution_shape).toBe("PlaceGraph");
	});
	it("inspects the exact binding ID among distinct realised and inert extents", async () => {
		const own = "a".repeat(64),
			other = "b".repeat(64);
		const rows: Record<string, Record<string, unknown>[]> = {
			role_definitions: [
				{
					role_id: "dm",
					bundle_id: "core",
					display_name: "DM",
					description: "",
					capability_ids: ["frontier.read_internal"],
				},
			],
			role_bindings: [
				{
					binding_id: "house/first",
					role_id: "dm",
					subject: other,
					extent_ref: "west",
					presence_entity_id: "10",
					realised_at_tick: 1,
				},
				{
					binding_id: "house/chosen",
					role_id: "dm",
					subject: own,
					extent_ref: "east",
					presence_entity_id: "20",
					realised_at_tick: 2,
				},
				{
					binding_id: "house/inert",
					role_id: "dm",
					subject: other,
					extent_ref: "north",
					presence_entity_id: "0",
					realised_at_tick: null,
				},
			],
		};
		const target: AuthorTarget = {
			kind: "live",
			lookup: (kind) => rows[kind] ?? [],
			resolveRef: () => false,
			applyBatch: async () => {
				throw new Error("read only");
			},
		};
		const context = { target, explainDisclosure: { connectedIdentity: own } };
		const chosen = await tool(context).execute("t", {
			kind: "binding",
			id: "house/chosen",
			target: "live",
		});
		expect(chosen.details).toMatchObject({
			id: "house/chosen",
			state: "realised",
			derived_elevation_class: "internal",
			definition: { extent_ref: "east", presence_entity_id: "20", subject: own },
			identities: [own],
		});
		const hidden = await tool(context).execute("t", {
			kind: "binding",
			id: "house/first",
			target: "live",
		});
		expect(hidden.details).toMatchObject({
			state: "realised",
			definition: { subject: "another identity" },
			identities: ["another identity"],
		});
		expect(JSON.stringify(hidden)).not.toContain(other);
		expect(
			(await tool(context).execute("t", { kind: "binding", id: "house/inert", target: "live" }))
				.details,
		).toMatchObject({ state: "inert", identities: [] });
		const role = await tool(context).execute("t", { kind: "role", id: "dm", target: "live" });
		expect(role.details).toMatchObject({
			bound_to: [
				{ binding_id: "house/chosen", subject: own },
				{ binding_id: "house/first", subject: "another identity" },
				{ binding_id: "house/inert", subject: "another identity" },
			],
		});
		const manageable = await tool({
			target,
			explainDisclosure: { connectedIdentity: own, bindingSubjectsAdmitted: true },
		}).execute("t", { kind: "binding", id: "house/first", target: "live" });
		expect(manageable.details).toMatchObject({
			definition: { subject: other },
			identities: [other],
		});

		const publisher = await tool({
			target,
			explainDisclosure: {
				readsAsPublisher: true,
				identitiesForPresence: (body) => (body === "10" ? [other] : []),
			},
		}).execute("t", { kind: "binding", id: "house/first", target: "live" });
		expect(publisher.details).toMatchObject({
			definition: { subject: other },
			identities: [other],
		});
	});
	it("reports the existing Hidden floor for a role without read capabilities", async () => {
		const target: AuthorTarget = {
			kind: "live",
			lookup: (kind) =>
				kind === "role_definitions"
					? [
							{
								role_id: "house/watcher",
								bundle_id: "house",
								display_name: "Watcher",
								description: "Ordinary watch role",
								capability_ids: ["house/watch"],
							},
						]
					: kind === "role_bindings"
						? [{ binding_id: "house/watch", role_id: "house/watcher", subject: "$sender" }]
						: [],
			resolveRef: () => false,
			applyBatch: async () => {
				throw new Error("read only");
			},
		};
		const result = await tool({ target }).execute("t", {
			kind: "binding",
			id: "house/watch",
			target: "live",
		});
		expect(result.details).toMatchObject({
			capability_ids: ["house/watch"],
			derived_elevation_class: "hidden",
		});
	});
	it("describes an authored binding as planned without inventing a realised body", async () => {
		const target: AuthorTarget = {
			kind: "local",
			lookup: (kind) =>
				kind === "role_bindings"
					? [
							{
								binding_id: "house/planned",
								bundle_id: "house",
								subject: "$sender",
								role_id: "dm",
								extent_kind_ref: "place_graph",
								extent_ref: "house/region",
								description: "Planned DM",
							},
						]
					: [],
			resolveRef: () => false,
			applyBatch: async () => {
				throw new Error("read only");
			},
		};
		const result = await tool({ target }).execute("t", { kind: "binding", id: "house/planned" });
		expect(result.details).toMatchObject({
			source: "files",
			state: "planned",
			identities: [],
			derived_elevation_class: "internal",
			definition: { subject: "$sender", extent_ref: "house/region" },
		});
		expect((result.details as { definition: object }).definition).not.toHaveProperty(
			"presence_entity_id",
		);
	});
});
