/** Preview and explicit staging share caller-only ports across delivery surfaces. */
import {
	RENDER_SCENE_PARAMS,
	RENDER_SCENE_TOOL,
	STAGE_SCENE_PARAMS,
	STAGE_SCENE_TOOL,
} from "@spellkave/tool-contracts/schemas";
import { parseSchemaManifestToml, renderSchemaManifest } from "@spellkave/world-author/tooling";
import type { AuthorToolContext } from "./authoring";
import {
	renderScene,
	type ScenePackage,
	type ScenePlan,
	type SceneValues,
	sceneDigest,
	sceneTextDigest,
} from "./scene-render";
import { defineTool } from "./tool-registry";

export interface SceneSourceSnapshot {
	protocol_version: 1;
	caller: string;
	endpoint: string;
	world_instance_id: string;
	source_digest: string;
	/** Fully admitted empty-source clone inputs from the server projection. */
	snapshot_json: string;
}
export interface ScenesPort {
	snapshot(blueprintId: string): Promise<SceneSourceSnapshot>;
	apply(toml: string): Promise<{ ok: boolean; detail?: string }>;
}
export interface ReviewedScenePlan extends ScenePlan {
	dependency_payloads: string[];
	source_review?: SceneSourceSnapshot;
}
const result = <T>(details: T) => ({
	content: [{ type: "text" as const, text: JSON.stringify(details) }],
	details,
});
export async function previewScene(
	context: AuthorToolContext,
	input: { package: ScenePackage; values: SceneValues; setup_name: string; dependencies: string[] },
): Promise<ReviewedScenePlan> {
	const rendered = await renderScene(input);
	const plan: ReviewedScenePlan = { ...rendered, dependency_payloads: [...input.dependencies] };
	if (context.scenes) {
		const source = await context.scenes.snapshot(input.package.blueprint_id);
		await checkSource(plan, source);
		plan.source_review = source;
	}
	return plan;
}
async function checkSource(plan: ScenePlan, source: SceneSourceSnapshot): Promise<void> {
	if (
		source.protocol_version !== 1 ||
		!source.world_instance_id ||
		(await sceneTextDigest(source.snapshot_json)) !== source.source_digest ||
		!source.caller ||
		!source.endpoint ||
		!/^[0-9a-f]{64}$/.test(source.source_digest)
	)
		throw new Error("scene source unavailable or incomplete");
	const snapshot = JSON.parse(source.snapshot_json) as {
		graph: { place_graph_id: string };
		nodes: Array<{ node_id: string }>;
	};
	if (snapshot.graph.place_graph_id !== plan.package.blueprint_id)
		throw new Error("scene source differs from package blueprint");
	const nodes = snapshot.nodes
		.map((row) =>
			row.node_id.replace(`${plan.package.blueprint_id}/`, `${plan.generated.graph_id}/`),
		)
		.sort();
	if (JSON.stringify(nodes) !== JSON.stringify(plan.generated.node_ids))
		throw new Error(
			"scene dependency geometry differs from installed source; render with current dependencies",
		);
}
export interface SceneReceipt {
	format: "spellkave-scene-receipt/v1";
	ok: boolean;
	caller: string;
	endpoint: string;
	world_instance_id: string;
	package_digest: string;
	values: ScenePlan["values"];
	generated: ScenePlan["generated"];
	phases: Array<{
		name: "graph" | "population";
		outcome: "committed" | "refused" | "unknown";
		detail?: string;
	}>;
	controllable: false;
	figures: Array<{
		entity_key: string;
		entity_id?: string;
		inspection: "observed" | "unavailable";
	}>;
	cleanup: { complete: false; coverage: "unknown"; guidance: string };
}
export async function stageScene(
	context: AuthorToolContext,
	input: { plan: ReviewedScenePlan; expected_world_instance_id: string },
): Promise<SceneReceipt> {
	if (!context.scenes) throw new Error("scene staging requires a supporting caller connection");
	if (Object.keys(input).some((key) => !["plan", "expected_world_instance_id"].includes(key)))
		throw new Error("scene staging accepts payloads, not filesystem paths");
	const plan = input.plan;
	if (!plan.source_review)
		throw new Error(
			"offline render is not live admission; render again on the selected caller connection",
		);
	// Rebuild the data package; even an attacker recomputing a client digest
	// cannot smuggle unrelated row kinds through a scene phase.
	const rebuilt = await renderScene({
		package: plan.package,
		values: plan.values,
		setup_name: plan.setup_name,
		dependencies: plan.dependency_payloads,
	});
	const { dependency_payloads: _deps, source_review: _source, ...unsigned } = plan;
	if ((await sceneDigest(rebuilt)) !== (await sceneDigest(unsigned)))
		throw new Error("scene plan changed after preview");
	const source = plan.source_review;
	if (source.world_instance_id !== input.expected_world_instance_id)
		throw new Error("scene destination changed; preview again");
	await checkSource(plan, source);
	const receipt: SceneReceipt = {
		format: "spellkave-scene-receipt/v1",
		ok: false,
		caller: source.caller,
		endpoint: source.endpoint,
		world_instance_id: source.world_instance_id,
		package_digest: plan.package_digest,
		values: plan.values,
		generated: plan.generated,
		phases: [],
		controllable: false,
		figures: [],
		cleanup: {
			complete: false,
			coverage: "unknown",
			guidance:
				"Inspect current graph, figures and references before retry or cleanup. This receipt confers no deletion authority. Graph Despawn ejects occupants by updating their entity location, preserves their bodies, and can leave their spatial position at a deleted node; inspect both location components afterward. Runtime spawns, carried loot and events may remain. A new setup name starts a new run; no reset, replay or one-shot uninstall is offered.",
		},
	};
	for (const phase of plan.phases) {
		let dispatched = false;
		try {
			const latest = await context.scenes.snapshot(plan.package.blueprint_id);
			if (
				latest.caller !== source.caller ||
				latest.endpoint !== source.endpoint ||
				latest.world_instance_id !== source.world_instance_id
			) {
				receipt.phases.push({
					name: phase.name,
					outcome: "refused",
					detail: "caller or destination changed; preview again",
				});
				return receipt;
			}
			if (phase.name === "graph" && latest.source_digest !== source.source_digest) {
				receipt.phases.push({
					name: phase.name,
					outcome: "refused",
					detail: "source changed; preview again",
				});
				return receipt;
			}
			const manifest = parseSchemaManifestToml(phase.toml);
			manifest.metadata = {
				expected_world_instance_id: source.world_instance_id,
				...(phase.name === "graph"
					? {
							scene_source_preconditions: JSON.stringify({
								blueprint_id: plan.package.blueprint_id,
								source_digest: source.source_digest,
								require_empty: true,
							}),
						}
					: {}),
			};
			dispatched = true;
			const applied = await context.scenes.apply(renderSchemaManifest(manifest));
			receipt.phases.push({
				name: phase.name,
				outcome: applied.ok ? "committed" : "refused",
				...(applied.detail ? { detail: applied.detail } : {}),
			});
			if (!applied.ok) return receipt;
		} catch (error) {
			const message = String(error);
			// Only an explicit server admission refusal is a known refusal. A
			// disconnected caller gets an unknown result and never an automatic retry.
			receipt.phases.push({
				name: phase.name,
				outcome:
					!dispatched ||
					/^(?:(?:Error|SenderError|ManifestApplyError): )?(?:\{"code":"MF-(?:APPLY|VAL|FMT)-\d+"|MF-(?:APPLY|VAL|FMT)-\d+[: ])/.test(
						message,
					)
						? "refused"
						: "unknown",
				detail: "Inspect current world before retry; phase did not return a confirmed success.",
			});
			return receipt;
		}
	}
	for (const key of plan.generated.entity_keys) {
		try {
			const observed = await context.readInstance?.describe({
				kind: "entities",
				key,
				bundle: plan.package.bundle_id,
			});
			receipt.figures.push(
				observed?.ok
					? { entity_key: key, entity_id: observed.numeric_id, inspection: "observed" }
					: { entity_key: key, inspection: "unavailable" },
			);
		} catch {
			receipt.figures.push({ entity_key: key, inspection: "unavailable" });
		}
	}
	receipt.ok = true;
	return receipt;
}
export const renderSceneToolDef = defineTool({
	contract: RENDER_SCENE_TOOL,
	schema: RENDER_SCENE_PARAMS,
	run: async (context: AuthorToolContext, params) =>
		result({
			ok: true,
			plan: await previewScene(context, params as unknown as Parameters<typeof previewScene>[1]),
		}),
});
export const stageSceneToolDef = defineTool({
	contract: STAGE_SCENE_TOOL,
	schema: STAGE_SCENE_PARAMS,
	run: async (context: AuthorToolContext, params) =>
		result(await stageScene(context, params as unknown as Parameters<typeof stageScene>[1])),
});
