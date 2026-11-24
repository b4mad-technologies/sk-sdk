/** Complete read + owner Bundle write still does not supply spatial placement authority. */
import type { SpellkaveSession } from "@spellkave/sdk";
import { createLiveScenesPort } from "@spellkave/session/authoring";
import { applyManifestDelta, type TestWorld } from "@spellkave/test-lab";
import {
	type AuthorToolContext,
	previewScene,
	type ReviewedScenePlan,
	stageScene,
} from "@spellkave/tool-authoring";
import { renderSchemaManifest } from "@spellkave/world-author/tooling";
import { expect } from "vitest";
export async function proveSceneExtent(input: {
	owner: TestWorld;
	regional: TestWorld;
	plan: ReviewedScenePlan;
	sql(query: string): Promise<unknown[][]>;
	record(value: unknown): void;
}) {
	const { owner, regional, plan, sql } = input;
	const catalog = plan.package.dependencies[0]!,
		destination = plan.package.bundle_id;
	await applyManifestDelta(
		owner,
		renderSchemaManifest({
			schema_version: "1.0.0",
			role_bindings: [
				{
					bundle_id: catalog,
					binding_id: `${catalog}/regional-reader`,
					role_id: "system-author",
					subject: regional.identity,
					extent_kind_ref: "bundle",
					extent_ref: catalog,
					description: "Read source without source graph placement",
				},
				{
					bundle_id: destination,
					binding_id: `${destination}/regional-writer`,
					role_id: "system-author",
					subject: regional.identity,
					extent_kind_ref: "bundle",
					extent_ref: destination,
					description: "Destination owner rows without placement extent",
				},
			],
		}),
	);
	const scenes = createLiveScenesPort({
		session: () =>
			({ conn: regional.conn, authenticatedIdentity: regional.conn.identity }) as SpellkaveSession,
		endpoint: () => `${process.env.SPELLKAVE_URL}/${process.env.SPELLKAVE_DB ?? "spellkave-dev"}`,
		apply: async (toml) => {
			await applyManifestDelta(regional, toml);
			return { ok: true };
		},
	});
	const reviewed = await previewScene({ scenes } as AuthorToolContext, {
		package: plan.package,
		values: plan.values,
		setup_name: "out-of-extent",
		dependencies: plan.dependency_payloads,
	});
	const receipt = await stageScene({ scenes } as AuthorToolContext, {
		plan: reviewed,
		expected_world_instance_id: reviewed.source_review!.world_instance_id,
	});
	expect(receipt.ok).toBe(false);
	expect(receipt.phases.at(-1)?.outcome).toBe("refused");
	expect(
		await sql(
			`SELECT manifest_key FROM operator_manifest_authored_entity WHERE manifest_key = '${destination}:${reviewed.generated.entity_keys[0]}'`,
		),
	).toEqual([]);
	input.record({
		category: "consumer",
		operation: "stage_scene without admitted placement extent",
		scope: "source Bundle read, destination Bundle write, no PlaceGraph binding",
		response: receipt,
		publisherFallback: false,
	});
}
