// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "fake-workspace manifests directly prove documented authoring row shapes and upsert semantics"}
// Doc-contract test suite, "live authoring" slice (#1968 "docs as testable
// promises" — verb-UX round 6, backlog item 4). A SEPARATE file from
// `doc-contract.test.ts` (not this agent's to edit — `scripts/check-doc-
// promises.ts` scans EVERY `doc-contract*.test.ts` under a package's
// `src/__tests__/`, so a new file joins the SAME gate without touching
// another agent's).
//
// OFFLINE ONLY, same posture as `doc-contract.test.ts`'s own header (workspace/
// validator layer, no fs, no live node, no model): the promise this file
// proves is an AUTHORING-mechanics claim (row shapes, defaults, upsert
// semantics) — the operator rule that new tests needing genuine WORLD state
// build it live via the verb tools + r_apply_manifest_delta does not apply
// here, because no genuine world state is needed to prove it.
//
// Each `it` below carries a `DOC-PROMISE: <doc-id>#<heading-slug>` comment —
// see `doc-contract.test.ts`'s own header for the full anchor-convention
// explanation; the `doc-promises` gate is the other half of this
// honesty contract.
import { describe, expect, it } from "vitest";

import type { AuthorToolContext, AuthorWorkspace } from "../authoring";
import { createAuthorFacingBoundTools } from "../authoring";
import type { VerbResult } from "../authoring-verbs";

function fakeWorkspace(initial: string | null = null): AuthorWorkspace & {
	current(): string | null;
} {
	let current = initial;
	return {
		readToml: () => current,
		writeToml: (toml: string) => {
			current = toml;
			return "/scratch/doc-contract-live-test";
		},
		current: () => current,
	};
}

function contextWith(overrides: Partial<AuthorToolContext> = {}): AuthorToolContext {
	return { workspace: fakeWorkspace(), ...overrides };
}

function toolByName(context: AuthorToolContext, name: string) {
	const tool = createAuthorFacingBoundTools(context).find((t) => t.name === name);
	if (tool === undefined) throw new Error(`missing AUTHOR tool ${name}`);
	return tool;
}

async function inspectManifestOf(workspace: ReturnType<typeof fakeWorkspace>) {
	const { inspectManifest } = await import("@spellkave/world-author");
	const toml = workspace.current();
	if (toml === null) throw new Error("expected a persisted manifest");
	return inspectManifest(toml).manifest as Record<string, unknown>;
}

function tableRows(manifest: Record<string, unknown>, table: string): Record<string, unknown>[] {
	return Array.isArray(manifest[table]) ? (manifest[table] as Record<string, unknown>[]) : [];
}

// ---------------------------------------------------------------------------
// getting-started-with-verbs.md — Live authoring: role grants and character binding
// ---------------------------------------------------------------------------

describe("getting-started-with-verbs.md — live authoring: role grants and character binding", () => {
	async function placeOneActor(context: AuthorToolContext) {
		await toolByName(context, "spellkave_author_place").execute("place", {
			bundle: "us_dungeon",
			nodes: [{ id: "us_dungeon/vault" }],
			edges: [],
		});
		await toolByName(context, "spellkave_place_actor").execute("place-actor", {
			bundle: "us_dungeon",
			kind: "npc",
			at: "us_dungeon/vault",
			key_prefix: "npc",
		});
	}

	// DOC-PROMISE: getting-started-with-verbs#live-authoring-role-grants-and-character-binding
	it("the doc's character-binding example authors BOTH an actor_identities $sender bind AND the ordinary actor_capabilities grant, in ONE call", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		await placeOneActor(context);
		// Seed the ordinary gameplay capability used by the doc's example.
		await toolByName(context, "spellkave_write_rows").execute("seed-cap", {
			bundle: "core",
			kind: "capability_definitions",
			rows: [
				{
					capability_id: "core/walk",
					bundle_id: "core",
					actor_kind: "entity",
					display_name: "Walk",
					description: "Ordinary movement capability for the character-binding example.",
				},
			],
		});

		const result = await toolByName(context, "spellkave_bind_actor").execute("bind", {
			bundle: "us_dungeon",
			entity_key: "us_dungeon/npc_1",
			capabilities: [{ capability_id: "core/walk", source: "core" }],
		});
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);

		const manifest = await inspectManifestOf(workspace);
		expect(tableRows(manifest, "actor_identities")).toEqual([
			{
				entity_key: "us_dungeon/npc_1",
				identity: "$sender",
				role: "primary",
				bundle_id: "us_dungeon",
			},
		]);
		expect(tableRows(manifest, "actor_capabilities")).toMatchObject([
			{
				actor_entity_key: "us_dungeon/npc_1",
				capability_id: "core/walk",
				source: "core",
			},
		]);
	});

	// DOC-PROMISE: getting-started-with-verbs#live-authoring-role-grants-and-character-binding
	it("privileged capabilities direct the author to spellkave_grant_role without changing the workspace", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		await placeOneActor(context);
		const before = workspace.current();

		await expect(
			toolByName(context, "spellkave_bind_actor").execute("bind", {
				bundle: "us_dungeon",
				entity_key: "us_dungeon/npc_1",
				capabilities: [{ capability_id: "frontier.apply_manifest", source: "core" }],
			}),
		).rejects.toThrow(/spellkave_grant_role with an explicit role and extent/);
		expect(workspace.current()).toBe(before);
	});

	// DOC-PROMISE: getting-started-with-verbs#live-authoring-role-grants-and-character-binding
	it("`identity` defaults to '$sender' and `capabilities` defaults to [] — an identity-only bind authors NO actor_capabilities row at all", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		await placeOneActor(context);

		const result = await toolByName(context, "spellkave_bind_actor").execute("bind", {
			bundle: "us_dungeon",
			entity_key: "us_dungeon/npc_1",
		});
		expect((result.details as VerbResult).ok, JSON.stringify(result.details)).toBe(true);

		const manifest = await inspectManifestOf(workspace);
		expect(tableRows(manifest, "actor_identities")).toEqual([
			{
				entity_key: "us_dungeon/npc_1",
				identity: "$sender",
				role: "primary",
				bundle_id: "us_dungeon",
			},
		]);
		expect(tableRows(manifest, "actor_capabilities")).toHaveLength(0);
	});

	// DOC-PROMISE: getting-started-with-verbs#live-authoring-role-grants-and-character-binding
	it("entity_key must already carry an actor_spatial_locations row — spellkave_bind_actor never spawns one itself", async () => {
		const context = contextWith();
		await expect(
			toolByName(context, "spellkave_bind_actor").execute("bind", {
				bundle: "us_dungeon",
				entity_key: "us_dungeon/ghost",
			}),
		).rejects.toThrow(/`entity_key`/);
	});
});
