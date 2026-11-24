/** ADR-0155: effective blueprint membership reaches real spawned bodies. */

import {
	asEntityRef,
	createActorClient,
	manipulationArgsFromJson,
	targetRefFromString,
} from "@spellkave/sdk";
import { stringify } from "smol-toml";
import { expect } from "vitest";
import { rows } from "./environment-ownership-fixture";
import {
	applyManifestDelta,
	bindActor,
	connectDedicatedClaimWorld,
	entityIdByManifestKey,
	operatorScopeManifest,
	syncConnection,
	type TestWorld,
	waitForEvent,
} from "./live";
import { header, probeAct } from "./privileged-acts-fixture";

export async function proveBlueprintPartyExtent(
	publisher: TestWorld,
	dm: TestWorld,
	bundle: string,
	vessel: string,
	actor: string,
): Promise<void> {
	const party = `${bundle}.identity.chosen`;
	const other = (
		await rows(publisher, `SELECT entity_id FROM entity WHERE entity_def_id = '${bundle}/vessel'`)
	).find((row) => String(row.entity_id) !== vessel);
	if (!other) throw new Error("Second spawned party vessel missing");
	const member = BigInt(String(other.entity_id));
	const outsider = entityIdByManifestKey(publisher.db(), `${bundle}:${bundle}/bare`);
	if (outsider === null) throw new Error("Untagged blueprint counterexample missing");
	for (const body of [member, outsider]) {
		await publisher.conn.reducers.actorSpatialLocationSet({
			actorId: body,
			// A co-located outsider is legitimately scene-visible beside a
			// reached member. Give this negative no such independent admission.
			placeNodeId: `${bundle}/village/${body === member ? "root" : "sealed"}`,
			bundleId: bundle,
		});
	}
	// Keep protected authority tags immutable on the runtime act surface.
	await expect(
		applyManifestDelta(
			publisher,
			probeAct(bundle, "forge-party", "frontier.afflict", [
				{ SetEntityTag: { entity: "TargetEntity", tag: { allowed_ids: [party] }, present: true } },
			]),
		),
	).rejects.toThrow("MF-VAL-383");
	await applyManifestDelta(publisher, probeAct(bundle, "party-contact", `${bundle}/sight`, []));
	const observer = await connectDedicatedClaimWorld({}, `${bundle}-party-observer`);
	try {
		await observer.subscribeReaders([{ requiredTables: ["visible_actor_spatial_location"] }]);
		await bindActor(observer, BigInt(actor));
		await syncConnection(observer);
		const seenBodies = () =>
			[...observer.conn.db.visibleActorSpatialLocation.iter()].map((row) => String(row.entityId));
		await waitForEvent(
			observer,
			() => seenBodies().includes(String(member)),
			"Blueprint Party membership must expose the remote spawned vessel",
		);
		expect(seenBodies()).not.toContain(String(outsider));
		const client = createActorClient(observer.conn, asEntityRef(`entity:${vessel}`), {
			successOnProvenance: true,
		});
		const accepted = await client.manipulate(
			`entity:${member}`,
			`${bundle}/party-contact`,
			"{}",
			() => false,
			() => null,
		);
		expect(accepted.status, "reason" in accepted ? accepted.reason : undefined).toBe("success");
		const rejected = await client.manipulate(
			`entity:${outsider}`,
			`${bundle}/party-contact`,
			"{}",
			() => false,
			() => null,
		);
		expect(rejected.status).toBe("rejected");
		// The ordinary manipulation probe acquires its normal steering claim.
		// Release it through that same bound actor before the independent DM
		// landing proof; party coverage must not bypass a foreign live claim.
		expect((await client.releaseClaim(`entity:${member}`)).status).toBe("success");
		// No materialized instance tag can keep this privilege after blueprint edits.
		expect(
			await rows(
				publisher,
				`SELECT entity_id FROM entity_tag WHERE entity_id = ${member} AND tag = '${party}'`,
			),
		).toEqual([]);
	} finally {
		observer.disconnect();
	}
	// The authoring read scope uses the same effective membership union. Its
	// existing forest binding does not cover either body in the village graph.
	await applyManifestDelta(
		publisher,
		header +
			stringify({
				role_bindings: [
					{
						bundle_id: bundle,
						binding_id: `${bundle}/party-author`,
						role_id: "dm",
						subject: dm.identity!,
						extent_kind_ref: "party",
						extent_ref: party,
						description: "Blueprint membership authoring read proof",
					},
				],
			}),
	);
	await dm.subscribeReaders([
		operatorScopeManifest("DM caller-scoped authoring membership proof", ["authoring_entity"]),
	]);
	await syncConnection(dm);
	const authoringBodies = () =>
		[...dm.conn.db.authoringEntity.iter()].map((row) => String(row.entityId));
	await waitForEvent(
		dm,
		() => authoringBodies().includes(String(member)),
		"Party authoring scope must admit the tagged blueprint's remote instance",
	);
	expect(authoringBodies()).not.toContain(String(outsider));
	await applyManifestDelta(
		publisher,
		probeAct(bundle, "party-name", "frontier.set_state", [
			{ SetEntityText: { entity: "TargetEntity", destination: "EntityName", max_chars: 64 } },
		]),
	);
	const presence = [...dm.conn.db.visibleRoleBinding.iter()].find(
		(row) => row.bindingId === `${bundle}/party-author`,
	)?.presenceEntityId;
	if (!presence) throw new Error("Party authority presence missing");
	const dispatch = async (body: bigint) => {
		const seen = new Set(
			[...dm.conn.db.visibleEvaluationProvenance.iter()].map((row) => row.provenanceId),
		);
		await dm.conn.reducers.rManipulate({
			actorId: presence,
			actionId: `${bundle}/party-name`,
			targetRef: targetRefFromString(`entity:${body}`),
			args: manipulationArgsFromJson(JSON.stringify({ dispatch_text: "Party landing proof" })),
		});
		const receipt = () =>
			[...dm.conn.db.visibleEvaluationProvenance.iter()].find(
				(row) => row.subjectId === String(presence) && !seen.has(row.provenanceId),
			);
		await waitForEvent(dm, () => receipt() !== undefined, "Party landing admission receipt");
		return receipt()!;
	};
	const admitted = await dispatch(member);
	expect(admitted.failureKind, admitted.failureDetail).toBe("");
	const denied = await dispatch(outsider);
	expect(denied.failureKind).not.toBe("");
	expect(await rows(publisher, `SELECT name FROM entity WHERE entity_id = ${outsider}`)).toEqual([
		{ name: "bare" },
	]);
}
