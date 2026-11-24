// embedded-manifest: {"category": "exact_text_oracle", "rationale": "metadata editing proofs require exact root and attachment inputs to verify preservation"}
import { inspectManifest } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";

import {
	type AuthorToolContext,
	type AuthorWorkspace,
	createAuthorFacingBoundTools,
} from "../authoring";

function workspace(initial: string | null = null): AuthorWorkspace & { current(): string | null } {
	let toml = initial;
	return {
		readToml: () => toml,
		writeToml: (next) => {
			toml = next;
			return "/scratch/set-metadata";
		},
		current: () => toml,
	};
}

function metadataTool(context: AuthorToolContext) {
	const tool = createAuthorFacingBoundTools(context).find(
		(candidate) => candidate.name === "spellkave_set_metadata",
	);
	if (tool === undefined) throw new Error("missing spellkave_set_metadata");
	return tool;
}

function manifestOf(space: ReturnType<typeof workspace>): Record<string, unknown> {
	const toml = space.current();
	if (toml === null) throw new Error("expected a persisted manifest");
	return inspectManifest(toml).manifest as Record<string, unknown>;
}

describe("spellkave_set_metadata", () => {
	it("preserves unrelated root keys and opaque tag/value metadata through target validation", async () => {
		const space = workspace(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n[metadata]\nprofile = "srd"\n',
		);
		const context: AuthorToolContext = {
			workspace: space,
			target: {
				kind: "local",
				resolveRef: () => false,
				lookup: () => [],
				applyBatch: async () => ({ ok: true }),
			},
		};
		const result = await metadataTool(context).execute("root", {
			target: "manifest",
			key: "editor",
			value: { tag: "note", value: {} },
		});
		expect((result.details as { ok: boolean }).ok).toBe(true);
		expect(manifestOf(space).metadata).toEqual({
			profile: "srd",
			editor: { tag: "note", value: {} },
		});
	});

	it("rejects a reserved root key with a structured value without persisting it", async () => {
		const space = workspace(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n[metadata]\nprofile = "srd"\n',
		);
		const result = await metadataTool({ workspace: space }).execute("invalid", {
			target: "manifest",
			key: "profile",
			value: { unexpected: true },
		});
		expect((result.details as { ok: boolean }).ok).toBe(false);
		expect(manifestOf(space).metadata).toEqual({ profile: "srd" });
	});

	it("sets an attachment batch once, replaces its live identity, and preserves other rows", async () => {
		const space = workspace(`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "srd"
display_name = "SRD"
author = "test"
version = "1"
depends_on = []
[[entity_definitions]]
entity_def_id = "srd/rations"
display_name = "Rations"
bundle_id = "srd"
`);
		const tool = metadataTool({ workspace: space });
		const first = await tool.execute("first", {
			bundle: "srd",
			updates: [
				{
					target: { kind: "entity_definition", ref: "srd/rations" },
					key: "srd.text",
					audience: "public",
					value: { text: "first" },
				},
				{
					target: { kind: "entity_definition", ref: "srd/rations" },
					key: "srd.note",
					audience: "frontier.apply_manifest",
					value: { note: "keep" },
				},
			],
		});
		expect((first.details as { ok: boolean }).ok).toBe(true);
		const second = await tool.execute("second", {
			bundle: "srd",
			updates: [
				{
					target: { kind: "entity_definition", ref: "srd/rations" },
					key: "srd.text",
					source: "updated",
					value: { text: "second" },
				},
			],
		});
		expect((second.details as { ok: boolean }).ok).toBe(true);
		const manifest = manifestOf(space);
		expect(manifest.metadata_attachments).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					namespace: "srd.text",
					source: "updated",
					payload_json: '{"text":"second"}',
				}),
				expect.objectContaining({ namespace: "srd.note", payload_json: '{"note":"keep"}' }),
			]),
		);
		expect(manifest.metadata_attachments).toHaveLength(2);
	});

	it("does not persist any batch rows when a later attachment has an unsupported kind", async () => {
		const space = workspace(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n',
		);
		const before = space.current();
		const result = await metadataTool({ workspace: space }).execute("atomic", {
			bundle: "test",
			updates: [
				{ target: "manifest", key: "editor", value: { summary: "must not persist" } },
				{ target: "namespace", key: "test.note", value: { audience: "frontier.apply_manifest" } },
				{
					target: { kind: "entity_definition", ref: "test/one" },
					key: "test.note",
					value: { text: "first" },
				},
				{
					target: { kind: "not_a_target", ref: "test/two" },
					key: "test.note",
					value: { text: "bad" },
				},
			],
		});
		expect((result.details as { ok: boolean }).ok).toBe(false);
		expect(space.current()).toBe(before);
	});

	it("rejects a namespace registration already owned by the active target", async () => {
		const space = workspace(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n',
		);
		const target = {
			kind: "local" as const,
			resolveRef: () => false,
			lookup: (kind: string) =>
				kind === "metadata_namespaces"
					? [{ namespace: "srd.text", audience: "public", bundle_id: "srd" }]
					: [],
			applyBatch: async () => ({ ok: true }),
		};
		const before = space.current();
		await expect(
			metadataTool({ workspace: space, target }).execute("foreign", {
				bundle: "adventure",
				target: "namespace",
				key: "srd.text",
				value: { audience: "public" },
			}),
		).rejects.toThrow("already owned");
		expect(space.current()).toBe(before);
	});

	it("accepts an inherited namespace from the target without re-registering it", async () => {
		const space = workspace(`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "srd"
display_name = "SRD"
author = "test"
version = "1"
depends_on = []
[[metadata_namespaces]]
namespace = "srd.text"
audience = "public"
bundle_id = "srd"
`);
		const target = {
			kind: "local" as const,
			resolveRef: () => false,
			lookup: (kind: string) =>
				kind === "metadata_namespaces"
					? [{ namespace: "srd.text", audience: "public", bundle_id: "srd" }]
					: [],
			applyBatch: async () => ({ ok: true }),
		};
		const result = await metadataTool({ workspace: space, target }).execute("inherited", {
			bundle: "adventure",
			target: { kind: "entity_definition", ref: "srd/rations" },
			key: "srd.text",
			value: { text: "copy" },
		});
		expect((result.details as { ok: boolean }).ok).toBe(true);
		expect(manifestOf(space).metadata_namespaces).toEqual([
			expect.objectContaining({ namespace: "srd.text", bundle_id: "srd" }),
		]);
	});

	it("rejects an ambiguous existing attachment identity without persisting a replacement", async () => {
		const space = workspace(`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "test"
display_name = "Test"
author = "test"
version = "1"
depends_on = []
[[metadata_namespaces]]
namespace = "test.note"
audience = "frontier.apply_manifest"
bundle_id = "test"
[[metadata_attachments]]
target_kind = "entity_definition"
target_ref = "test/rations"
namespace = "test.note"
bundle_id = "test"
payload_json = '{}'
[[metadata_attachments]]
target_kind = "entity_definition"
target_ref = "test/rations"
namespace = "test.note"
bundle_id = "test"
payload_json = '{"old":true}'
`);
		const before = space.current();
		await expect(
			metadataTool({ workspace: space }).execute("ambiguous", {
				bundle: "test",
				target: { kind: "entity_definition", ref: "test/rations" },
				key: "test.note",
				value: { text: "new" },
			}),
		).rejects.toThrow("ambiguous metadata attachment");
		expect(space.current()).toBe(before);
	});

	it("keeps root scalar values and an own __proto__ key as metadata data", async () => {
		const space = workspace(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n',
		);
		const tool = metadataTool({ workspace: space });
		for (const [key, value] of [["profile", "srd"] as const, ["__proto__", "authored"] as const]) {
			const result = await tool.execute("root-data", { target: "manifest", key, value });
			expect((result.details as { ok: boolean }).ok).toBe(true);
		}
		const metadata = manifestOf(space).metadata as Record<string, unknown>;
		expect(metadata.profile).toBe("srd");
		expect(Object.hasOwn(metadata, "__proto__")).toBe(true);
		expect(metadata.__proto__).toBe("authored");
	});

	it("makes a default-bundle atomic batch equivalent to singleton updates", async () => {
		const initial = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "srd"
display_name = "SRD"
author = "test"
version = "1"
depends_on = []
[[entity_definitions]]
entity_def_id = "srd/rations"
display_name = "Rations"
bundle_id = "srd"
`;
		const batch = workspace(initial);
		const singleton = workspace(initial);
		const context = (space: ReturnType<typeof workspace>): AuthorToolContext => ({
			workspace: space,
			defaultBundle: "srd",
		});
		const update = {
			target: { kind: "entity_definition", ref: "srd/rations" },
			key: "srd.text",
			value: { text: "Rations" },
			audience: "public",
		};
		const batched = await metadataTool(context(batch)).execute("batch", {
			updates: [
				{ target: "manifest", key: "catalogue", value: ["rations"] },
				{ target: "namespace", key: "srd.text", value: { audience: "public" } },
				{ ...update, audience: undefined },
			],
		});
		expect((batched.details as { ok: boolean }).ok).toBe(true);
		for (const singletonUpdate of [
			{ target: "manifest", key: "catalogue", value: ["rations"] },
			{ target: "namespace", key: "srd.text", value: { audience: "public" } },
			{ ...update, audience: undefined },
		]) {
			const result = await metadataTool(context(singleton)).execute("singleton", singletonUpdate);
			expect((result.details as { ok: boolean }).ok).toBe(true);
		}
		expect(manifestOf(batch)).toEqual(manifestOf(singleton));
	});

	it("rejects duplicate batch keys and mixed singleton/batch envelopes without persisting", async () => {
		const space = workspace(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n',
		);
		const before = space.current();
		await expect(
			metadataTool({ workspace: space }).execute("duplicate", {
				updates: [
					{ target: "manifest", key: "editor", value: "one" },
					{ target: "manifest", key: "editor", value: "two" },
				],
			}),
		).rejects.toThrow("more than once");
		await expect(
			metadataTool({ workspace: space }).execute("mixed", {
				target: "manifest",
				key: "editor",
				value: "one",
				updates: [{ target: "manifest", key: "other", value: "two" }],
			} as never),
		).rejects.toThrow();
		await expect(
			metadataTool({ workspace: space }).execute("namespace-duplicate", {
				bundle: "test",
				updates: [
					{ target: "namespace", key: "test.note", value: { audience: "frontier.apply_manifest" } },
					{ target: "namespace", key: "test.note", value: { audience: "frontier.apply_manifest" } },
				],
			}),
		).rejects.toThrow("more than once");
		await expect(
			metadataTool({ workspace: space }).execute("attachment-duplicate", {
				bundle: "test",
				updates: [
					{
						target: { kind: "entity_definition", ref: "test/rations" },
						key: "test.note",
						audience: "frontier.apply_manifest",
						value: { text: "one" },
					},
					{
						target: { kind: "entity_definition", ref: "test/rations" },
						key: "test.note",
						value: { text: "two" },
					},
				],
			}),
		).rejects.toThrow("same live identity");
		expect(space.current()).toBe(before);
	});

	it("preserves an existing namespace description when attachment audience only ensures it", async () => {
		const space = workspace(`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "srd"
display_name = "SRD"
author = "test"
version = "1"
depends_on = []
[[metadata_namespaces]]
namespace = "srd.text"
audience = "public"
description = "Canonical text."
bundle_id = "srd"
[[entity_definitions]]
entity_def_id = "srd/rations"
display_name = "Rations"
bundle_id = "srd"
`);
		const result = await metadataTool({ workspace: space }).execute("ensure", {
			bundle: "srd",
			target: { kind: "entity_definition", ref: "srd/rations" },
			key: "srd.text",
			audience: "public",
			value: { text: "Rations" },
		});
		expect((result.details as { ok: boolean }).ok).toBe(true);
		expect(manifestOf(space).metadata_namespaces).toEqual([
			expect.objectContaining({ description: "Canonical text." }),
		]);
		const beforeConflict = space.current();
		await expect(
			metadataTool({ workspace: space }).execute("conflict", {
				bundle: "srd",
				target: { kind: "entity_definition", ref: "srd/rations" },
				key: "srd.text",
				audience: "frontier.apply_manifest",
				value: { text: "Rations" },
			}),
		).rejects.toThrow("different audience");
		expect(space.current()).toBe(beforeConflict);
	});

	it("rejects strict-envelope typos before they can be silently ignored", async () => {
		const space = workspace(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n',
		);
		await expect(
			metadataTool({ workspace: space }).execute("typo", {
				target: "namespace",
				key: "test.note",
				value: { audence: "author" },
			} as never),
		).rejects.toThrow();
		await expect(
			metadataTool({ workspace: space }).execute("manifest-source", {
				target: "manifest",
				key: "editor",
				value: "note",
				source: "manifest",
			} as never),
		).rejects.toThrow();
		expect(space.current()).toBe(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n',
		);
	});

	// sk-jay0.7.90: the parameter root is one flat object so OpenAI-backed hosts
	// accept the tool, so these per-target shapes are call-time guards now. The
	// updates[] rows keep their schema union, so a host that validates arguments
	// rejects those earlier — the guard is the backstop for hosts (Pi) that do not.
	it("names the expected shape when a singleton or batch update has the wrong value", async () => {
		const space = workspace(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n',
		);
		await expect(
			metadataTool({ workspace: space }).execute("namespace-missing-audience", {
				target: "namespace",
				key: "test.note",
				value: { description: "no audience" },
			} as never),
		).rejects.toThrow(
			/target 'namespace' takes a string key and a value of \{audience, description\?, on_demand\?\}/,
		);
		await expect(
			metadataTool({ workspace: space }).execute("attachment-scalar-value", {
				bundle: "core",
				target: { kind: "entities", ref: "hero" },
				key: "test.note",
				value: "not an object",
			} as never),
		).rejects.toThrow(/an attachment target \{kind, ref\} takes a string key, an object value/);
		await expect(
			metadataTool({ workspace: space }).execute("batch-bad-target", {
				updates: [{ target: "world", key: "editor", value: 1 }],
			} as never),
		).rejects.toThrow(
			/Invalid arguments|updates\[0\] — target must be 'manifest', 'namespace', or \{kind, ref\}/,
		);
		await expect(
			metadataTool({ workspace: space }).execute("empty-batch", { updates: [] } as never),
		).rejects.toThrow(/Invalid arguments|updates\[\] must be a non-empty array of updates/);
		expect(space.current()).toBe(
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n',
		);
	});
});
