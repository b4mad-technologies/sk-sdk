/** Real scoped-view and act boundary proof; no test-only capability mutation. */

import { asEntityRef, createActorClient, resolveEntityId, type SnapshotDb } from "@spellkave/sdk";
import { stringify } from "smol-toml";
import { expect } from "vitest";
import { rows } from "./environment-ownership-fixture";
import {
	applyManifestDelta,
	bindActor,
	connectDedicatedClaimWorld,
	entityIdByManifestKey,
	syncConnection,
	type TestWorld,
} from "./live";
import { header, probeAct } from "./privileged-acts-fixture";

export async function proveConditionExtentLifecycle(
	publisher: TestWorld,
	dm: TestWorld,
	bundle: string,
	vessel: string,
	actor: string,
	accepted: (slug: string, target: string) => Promise<unknown>,
): Promise<void> {
	const condition = `${bundle}/bond-active`;
	const capability = `${bundle}/bond-reach`;
	const party = `${bundle}/party`;
	const member = entityIdByManifestKey(publisher.db(), `${bundle}:${bundle}/bare`);
	const outsider = entityIdByManifestKey(publisher.db(), `${bundle}:${bundle}/hero`);
	if (member === null || outsider === null) throw new Error("Extent lifecycle controls missing");
	for (const [body, node] of [
		[member, "root"],
		[outsider, "sealed"],
	] as const)
		await publisher.conn.reducers.actorSpatialLocationSet({
			actorId: body,
			placeNodeId: `${bundle}/village/${node}`,
			bundleId: bundle,
		});
	const definition = {
		bundle_id: bundle,
		condition_definition_id: condition,
		display_name: "Delayed bond",
		gate_predicate_source: "1 == 1",
		stacking_rule: "core/stacking/single",
		remove_time_policy: "core/remove_policy/independent_lifetime",
		observable: true,
	};
	const rule = {
		bundle_id: bundle,
		condition_definition_id: condition,
		capability_id: capability,
		extent_kind_ref: "party",
		extent_ref: party,
	};
	await applyManifestDelta(
		publisher,
		header +
			stringify({
				capability_definitions: [
					{
						bundle_id: bundle,
						capability_id: capability,
						actor_kind: "entity",
						display_name: "Bond reach",
						description: "Delayed condition extent",
					},
				],
				condition_definitions: [definition],
				condition_capability_extent_grants: [rule],
			}),
	);
	await applyManifestDelta(publisher, probeAct(bundle, "bond-contact", capability, []));
	for (const [slug, write] of [
		[
			"activate-bond",
			{
				ApplyStatus: {
					target_kind: "entity",
					target_ref: "TargetActor",
					condition_definition_id: condition,
				},
			},
		],
		[
			"remove-bond",
			{
				RemoveCondition: {
					target_kind: "entity",
					target_ref: "TargetActor",
					condition_definition_id: condition,
					source_match: "Any",
				},
			},
		],
	] as const)
		await applyManifestDelta(publisher, probeAct(bundle, slug, "frontier.afflict", [write]));
	const observer = await connectDedicatedClaimWorld({}, `${bundle}-bond-observer`);
	try {
		await observer.subscribeReaders([
			{
				requiredTables: [
					"visible_actor_spatial_location",
					"visible_manifest_authored_entity",
					"visible_manifest_authored_entity_coverage",
				],
			},
		]);
		await bindActor(observer, BigInt(actor));
		const client = createActorClient(observer.conn, asEntityRef(`entity:${vessel}`), {
			successOnProvenance: true,
		});
		const visible = () =>
			[...observer.conn.db.visibleActorSpatialLocation.iter()].map((row) => String(row.entityId));
		const contact = (body: bigint) =>
			client.manipulate(
				`entity:${body}`,
				`${bundle}/bond-contact`,
				"{}",
				() => false,
				() => null,
			);
		await syncConnection(observer);
		expect(visible()).not.toContain(String(member));
		const authoredMember = () => {
			expect([...observer.conn.db.visibleManifestAuthoredEntityCoverage.iter()]).toEqual([
				{ status: "complete", projectionVersion: 1 },
			]);
			return resolveEntityId(observer.db() as unknown as SnapshotDb, asEntityRef(`${bundle}/bare`));
		};
		expect(authoredMember()).toBeUndefined();
		expect((await contact(member)).status).toBe("rejected");
		const before = await rows(publisher, "SELECT tick FROM world_time");
		await accepted("activate-bond", `entity:${vessel}`);
		await syncConnection(observer);
		expect(visible()).toContain(String(member));
		expect(visible()).not.toContain(String(outsider));
		// Ordinary condition reach grants gameplay observation/addressability;
		// it does not supply binding-held authoring mapping authority (.142 D-2).
		// The observed numeric identity still addresses the remote body.
		expect(authoredMember()).toBeUndefined();
		expect(
			resolveEntityId(observer.db() as unknown as SnapshotDb, asEntityRef(`entity:${member}`)),
		).toBe(member);
		expect((await contact(member)).status).toBe("success");
		expect((await contact(outsider)).status).toBe("rejected");
		expect((await client.releaseClaim(`entity:${member}`)).status).toBe("success");
		expect(
			await rows(
				publisher,
				`SELECT entity_id FROM capability WHERE entity_id = ${vessel} AND capability_id = '${capability}'`,
			),
		).toEqual([]);
		expect(await rows(publisher, "SELECT tick FROM world_time")).toEqual(before);
		await accepted("remove-bond", `entity:${vessel}`);
		await syncConnection(observer);
		expect(visible()).not.toContain(String(member));
		expect(authoredMember()).toBeUndefined();
		expect((await contact(member)).status).toBe("rejected");
		await accepted("activate-bond", `entity:${vessel}`);
		// Direct definition edits reconcile after their final gate mutation.
		await publisher.conn.reducers.conditionDefinitionUpdate({
			conditionDefinitionId: condition,
			bundleId: bundle,
			displayName: "Closed bond",
			stackingRule: "core/stacking/single",
			gatePredicateSource: "1 == 0",
			modifierTemplateId: "",
			hooks: [],
			observable: true,
		});
		await syncConnection(observer);
		expect(visible()).not.toContain(String(member));
		expect((await contact(member)).status).toBe("rejected");
		// A raw clock gate changes both projection and addressability at the next tick.
		const current = Number((await rows(publisher, "SELECT tick FROM world_time"))[0]!.tick);
		await applyManifestDelta(
			publisher,
			header +
				stringify({
					condition_definitions: [
						{ ...definition, gate_predicate_source: `world.stat('core/tick') > ${current}` },
					],
				}),
		);
		await syncConnection(observer);
		expect(visible()).not.toContain(String(member));
		await publisher.conn.reducers.manualTicks({ ticks: 1 });
		await syncConnection(observer);
		expect(visible()).toContain(String(member));
		expect((await contact(member)).status).toBe("success");
		expect((await client.releaseClaim(`entity:${member}`)).status).toBe("success");
		// Parent deletion clears owned rules, without deleting the live source.
		await publisher.conn.reducers.conditionDefinitionDelete({ conditionDefinitionId: condition });
		await syncConnection(observer);
		expect(visible()).not.toContain(String(member));
		expect((await contact(member)).status).toBe("rejected");
		expect(
			await rows(
				publisher,
				`SELECT key FROM condition_capability_extent_grant WHERE condition_definition_id = '${condition}'`,
			),
		).toEqual([]);
		expect(
			await rows(
				publisher,
				`SELECT row_id FROM target_condition WHERE target_id = ${vessel} AND condition_definition_id = '${condition}'`,
			),
		).toHaveLength(1);
		// Restore the parent before removing the retained world source. Existing
		// hook collection rejects dangling condition definitions globally; this
		// lifecycle proof must not leave that residue in the shared test world.
		await applyManifestDelta(
			publisher,
			header + stringify({ condition_definitions: [definition] }),
		);
		await accepted("remove-bond", `entity:${vessel}`);
		await syncConnection(observer);
		expect(visible()).not.toContain(String(member));
		expect(
			await rows(
				publisher,
				`SELECT row_id FROM target_condition WHERE target_id = ${vessel} AND condition_definition_id = '${condition}'`,
			),
		).toEqual([]);
	} finally {
		observer.disconnect();
	}
}
