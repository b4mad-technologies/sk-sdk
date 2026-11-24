/** AUTH-48-01: existing portable tools reach the authored production transition. */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { connect, createActorClient, type SpellkaveSession, snapshotDb } from "@spellkave/sdk";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	applyManifestDelta,
	applyManifestSource,
	connectDedicatedClaimWorld,
	connectTestWorld,
	ensureWorldAuthority,
	entityIdByManifestKey,
	readFixtureSource,
	type TestWorld,
	waitForEvent,
} from "@spellkave/test-lab";
import { rows } from "@spellkave/test-lab/environment-ownership-fixture";
import { startSealBreakEvidence } from "@spellkave/test-lab/seal-break-evidence";
import { header, sealBreakFixture, sealBreakProbe } from "@spellkave/test-lab/seal-break-fixture";
import { expect, it } from "vitest";
import { createCommunicateTool, createManipulateTool } from "../tools";

it.skipIf(process.env.SPELLKAVE_LOCAL_NODE !== "1")(
	"AUTH-48-01: utterance and reason carriage use existing tool contracts",
	async () => {
		const b = `tool48_${randomUUID().replaceAll("-", "")}`;
		const worlds: TestWorld[] = [],
			operations: unknown[] = [];
		let session: SpellkaveSession | undefined;
		const started = Date.now();
		const accounting = startSealBreakEvidence();
		let outcome = "failed";
		try {
			const token = resolveSpacetimeConfigPathToken();
			if (!token) throw new Error("owned publisher credential required");
			const publisher = await connectTestWorld({ token });
			worlds.push(publisher);
			accounting.instrumentWorld(publisher);
			await ensureWorldAuthority(publisher);
			const warden = await connectDedicatedClaimWorld({}, `tool-warden-${b}`);
			worlds.push(warden);
			accounting.instrumentWorld(warden);
			await applyManifestSource(
				publisher,
				readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
				{ tolerateAlreadyApplied: true },
			);
			await applyManifestSource(
				publisher,
				sealBreakFixture(b, warden.identity!, publisher.identity!),
			);
			await warden.subscribeReaders([{ requiredTables: ["visible_role_binding"] }]);
			const binding = () =>
				[...warden.conn.db.visibleRoleBinding.iter()].find((row) => row.bindingId === `${b}/dm`);
			await waitForEvent(warden, () => !!binding()?.presenceEntityId, "portable-tool warden");
			const body = binding()!.presenceEntityId,
				actorId = `entity:${body}`;
			session = await connect(
				{
					url: process.env.SPELLKAVE_URL!,
					db: process.env.SPELLKAVE_DB!,
					token: warden.token,
					connectedActorId: actorId,
				},
				{ onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} },
			);
			await session.ready;
			accounting.instrumentConnection(session.conn);
			const client = createActorClient(session, actorId, { successOnProvenance: true });
			const context = { db: () => snapshotDb(session!), act: { actorId, actorClient: client } };
			const audit = async () =>
				rows(
					publisher,
					`SELECT place_graph_id, break_reason, event_id FROM place_seal_break WHERE broken_by = ${body}`,
				);
			const utterance = "Existing utterance transport é.";
			const utteranceRequest = {
				target_id: `place_node:${b}/closed/root`,
				speech_act_id: "core/act/break-seal",
				utterance,
			};
			const communicated = await createCommunicateTool(context).execute(
				"seal-utterance",
				utteranceRequest,
			);
			operations.push({
				surface: "spellkave_communicate",
				request: utteranceRequest,
				result: communicated,
			});
			expect(communicated.details).toMatchObject({ receipt: { outcome: "accepted" } });
			expect(await audit()).toMatchObject([
				{ place_graph_id: `${b}/closed`, break_reason: utterance },
			]);
			const manipulate = createManipulateTool(context);
			// Malformed JSON refusal and zero dispatch are proved offline in
			// args-json-audit.test.ts; this journey observes real seal transitions.
			const reason = "  Exact manipulate reason é.  ";
			const request = {
				target_id: `place_node:${b}/failed/root`,
				action_id: "core/act/break-seal",
				args_json: JSON.stringify({ dispatch_text: reason }),
			};
			const result = await manipulate.execute("seal-arguments", request);
			operations.push({ surface: "spellkave_manipulate", request, result });
			expect(result.details).toMatchObject({ receipt: { outcome: "accepted" } });
			expect(await audit()).toHaveLength(2);
			expect((await audit()).find((row) => row.place_graph_id === `${b}/failed`)).toMatchObject({
				break_reason: reason,
			});
			const hero = entityIdByManifestKey(publisher.db(), `${b}:${b}/hero`);
			if (hero === null) throw new Error("utterance reactor missing");
			await applyManifestDelta(
				publisher,
				`${header}[[entities]]\nbundle_id="${b}"\nentity_key="${b}/hero"\nentity_def_id="core/creature/wolf"\nname="hero"\nkind="npc"\nplace_node_id="${b}/late/root"\n[[actor_spatial_locations]]\nbundle_id="${b}"\nentity_key="${b}/hero"\nplace_node_id="${b}/late/root"\n`,
			);
			await applyManifestDelta(
				publisher,
				sealBreakProbe(b, "windowed", ["BreakPlaceSeal"], "frontier.break_seal", true),
			);
			await applyManifestDelta(
				publisher,
				`${header}[[action_definitions]]\nbundle_id="${b}"\naction_id="${b}/react"\ndisplay_name="Decline intervention"\nrequired_capability="core/inspect"\nresolution_mode="Deterministic"\non_success="${b}/react/success"\nreaction_eligibility="actor.has_capability('core/inspect')"\nreaction_trigger="$event.kind == 'r_manipulate' && $event.detail.phase == 'resolution' && $event.detail.stochastic == 'true'"\nreaction_window_ms=3000\n[[consequence_templates]]\nbundle_id="${b}"\ntemplate_id="${b}/react/success"\n`,
			);
			const deferredUtterance = "Retained tool utterance after reaction é.";
			const deferredRequest = {
				target_id: `place_node:${b}/late/root`,
				speech_act_id: `${b}/windowed`,
				utterance: deferredUtterance,
			};
			// A caller requiring effect observation cannot treat the pre-commit
			// Predicate as completion. Leave the real reaction window open while
			// observing an uncertain result, on both legacy and strict SDK receipts.
			let deferredDispatch: Promise<void> | undefined;
			let deferredCalls = 0;
			const deferredConnection = session.conn;
			const uncertainClient = createActorClient(session, actorId, {
				successOnProvenance: false,
				observationTimeoutMs: 1000,
				rManipulate: (args) => {
					deferredCalls += 1;
					deferredDispatch = deferredConnection.reducers.rManipulate(args);
					return deferredDispatch;
				},
			});
			const uncertainContext = { ...context, act: { actorId, actorClient: uncertainClient } };
			const deferred = await createCommunicateTool(uncertainContext).execute(
				"seal-deferred-utterance",
				deferredRequest,
			);
			// Wait for the actual dispatch before the independent pending-state audit,
			// even if the observation window closed before its acknowledgement.
			expect(deferredCalls).toBe(1);
			await deferredDispatch;
			operations.push({
				surface: "spellkave_communicate",
				request: deferredRequest,
				result: deferred,
			});
			// The reducer admitted a reaction window, not a completed seal break.
			// Return uncertainty promptly so the caller can answer the pending reaction.
			expect(deferred.details).toMatchObject({
				receipt: { outcome: "unobserved", communicate: { status: "unobservable" } },
			});
			expect(deferred.details).not.toHaveProperty("receipt.communicate.provenance_id");
			const continuations = await rows(
				publisher,
				"SELECT work_ref, lane FROM control_continuation",
			);
			const pending = (await rows(publisher, "SELECT pending_id, lane FROM pending_resolution"))
				.map(
					(row): Record<string, unknown> => ({
						...row,
						publicLane: row.lane,
						lane: continuations.find(
							(continuation) => continuation.work_ref === `pending:${row.pending_id}`,
						)?.lane,
					}),
				)
				.filter((row) => JSON.stringify(row.lane)?.includes(`${b}/dm`));
			for (const row of pending) expect(row.publicLane).toEqual([1, []]);
			expect(pending).toHaveLength(1);
			expect(await audit()).toHaveLength(2);
			expect(deferred.details).toMatchObject({
				receipt: {
					outcome: "unobserved",
					communicate: { player_message: "The outcome could not be confirmed." },
				},
				observation: null,
				observation_gap: "The outcome could not be confirmed.",
			});
			expect(deferred.details).not.toHaveProperty("receipt.communicate.provenance_id");
			expect(JSON.stringify(deferred)).not.toMatch(/Nothing happens\.|That did not work\./);
			await publisher.conn.reducers.rReact({
				reactorId: hero,
				pendingId: BigInt(String(pending[0]!.pending_id)),
				responseIntent: "DECLINE",
				selectedDrawIndex: undefined,
			});
			expect((await audit()).find((row) => row.place_graph_id === `${b}/late`)).toMatchObject({
				break_reason: deferredUtterance,
			});
			operations.push({ independentAudit: await audit() });
			outcome = "passed";
		} finally {
			accounting.stop();
			session?.disconnect();
			for (const world of worlds.reverse()) world.disconnect();
			const output = resolve(import.meta.dirname, "../../../../.local/seal-break-evidence");
			mkdirSync(output, { recursive: true });
			writeFileSync(
				resolve(output, "portable-tools-v1.json"),
				JSON.stringify(
					{
						schema: "seal-break-evidence/v1",
						wholeJourney: accounting.snapshot(),
						outcome,
						elapsedMs: Date.now() - started,
						operations,
					},
					(_, v) => (typeof v === "bigint" ? String(v) : v),
					2,
				)
					.replaceAll(b, "seal_lab")
					.replace(/\b[0-9a-f]{64}\b/g, "<opaque-id>") + "\n",
			);
		}
	},
);
