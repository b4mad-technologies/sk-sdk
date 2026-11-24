/** AUTH-41 consumer journey: canonical MCP bodies plus installed caller CLI. */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import { captureDriverToken, readDriverControl } from "@spellkave/sdk/readers";
import {
	actAsCli,
	actAsFixture,
	actAsFixtureCleanup,
	applyManifestSource,
	connectTestWorld,
	ensureWorldAuthority,
	entityIdByManifestKey,
	readFixtureSource,
	recordActAsTransport,
	queryTestWorldRows as rows,
	type TestWorld,
	waitForEvent,
} from "@spellkave/test-lab";
import { afterAll, describe, expect, it } from "vitest";
import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

const json = (value: unknown) =>
	JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v));
const cleanup = actAsFixtureCleanup("consumer");
// ci-allow-start(raw-sql): independent publisher SQL over disposable synthetic rows; complete before/after assertions are not runtime subscriptions.
async function* journey() {
	const b = cleanup.track(`consumer41_${randomUUID().replaceAll("-", "")}`);
	const worlds: TestWorld[] = [];
	const calls: unknown[] = [];
	const rpcCalls: Record<string, unknown>[] = [];
	const sqlCalls: unknown[] = [];
	const observedRows: typeof rows = async (world, query) => {
		const result = await rows(world, query);
		sqlCalls.push({ query, result });
		return result;
	};
	const assertions: unknown[] = [];
	const aliases: [string, string][] = [];
	const started = Date.now();
	let outcome = "failed";
	try {
		const token = resolveSpacetimeConfigPathToken();
		if (!token) throw new Error("owned publisher credential required");
		const publisher = await connectTestWorld({ token });
		worlds.push(publisher);
		recordActAsTransport(publisher, "publisher", rpcCalls);
		await ensureWorldAuthority(publisher);
		await applyManifestSource(
			publisher,
			readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
			{ tolerateAlreadyApplied: true },
		);
		const [person, dm, peer, host, driver] = await Promise.all(
			Array.from({ length: 5 }, () => connectTestWorld({ token: null })),
		);
		worlds.push(person!, dm!, peer!, host!, driver!);
		for (const [name, world] of [
			["person", person!],
			["dm", dm!],
			["peer", peer!],
			["host", host!],
			["driver", driver!],
		] as const) {
			aliases.push([world.identity!, `<${name}>`]);
			recordActAsTransport(world, name, rpcCalls);
		}
		for (const principal of [dm!, peer!, host!])
			await principal.subscribeReaders([{ requiredTables: ["visible_role_binding"] }]);
		const fixture = actAsFixture(b, {
			person: person!.identity!,
			dm: dm!.identity!,
			peer: peer!.identity!,
			host: host!.identity!,
		});
		await applyManifestSource(publisher, fixture);
		const body = (name: string) => entityIdByManifestKey(publisher.db(), `${b}:${b}/${name}`)!;
		const npcBody = body("npc"),
			personBody = body("person");
		const actor = (entity: bigint) =>
			[...publisher.conn.db.actor.iter()].find((r) => r.currentBody === entity)!.actorId;
		const npcActor = actor(npcBody);
		await waitForEvent(
			host!,
			() => [...host!.conn.db.visibleRoleBinding.iter()].some((r) => r.bindingId === `${b}/host`),
			"host drive presence",
		);
		const hostBody = [...host!.conn.db.visibleRoleBinding.iter()].find(
			(r) => r.bindingId === `${b}/host`,
		)!.presenceEntityId;
		await host!.conn.reducers.rAssignDriver({
			presenceActorId: actor(hostBody),
			actorId: npcActor,
			identityHex: driver!.identity!,
		});
		const assignedControl = await observedRows(
			publisher,
			`SELECT generation FROM actor_driver_control WHERE actor_id = ${npcActor}`,
		);
		expect(assignedControl).toHaveLength(1);
		await waitForEvent(
			dm!,
			() =>
				readDriverControl(dm!.db(), npcBody)[0]?.generation ===
				BigInt(String(assignedControl[0]!.generation)),
			"DM control generation",
		);
		const original = captureDriverToken(dm!.db(), npcBody)!;
		const dmBody = [...dm!.conn.db.visibleRoleBinding.iter()].find(
			(r) => r.bindingId === `${b}/dm`,
		)!.presenceEntityId;
		const makeTools = (world: TestWorld, entity: bigint) =>
			createSpellkaveTools({
				db: world.db,
				act: { actorId: String(entity) },
				controlReducers: world.conn.reducers,
			} as SpellkaveToolContext);
		const tool = async (
			world: TestWorld,
			entity: bigint,
			name: string,
			args: Record<string, unknown>,
		) => {
			const at = Date.now();
			const selected = makeTools(world, entity).find((t) => t.name === name)!;
			const result = await selected.execute("AUTH-41", args);
			calls.push({
				surface: "canonical MCP execution",
				name,
				args,
				result,
				elapsedMs: Date.now() - at,
			});
			return result;
		};
		const inspect = () =>
			rows(publisher, `SELECT * FROM actor_driver_control WHERE actor_id = ${npcActor}`);
		yield "setup";
		await tool(person!, personBody, "spellkave_offer_control", { identity: dm!.identity! });
		await dm!.conn.reducers.rPrepareSteeredActor({ bodyEntityId: personBody });
		expect(
			await observedRows(
				publisher,
				`SELECT role FROM actor_identity WHERE actor_id = ${actor(personBody)}`,
			),
		).toHaveLength(2);
		await tool(person!, personBody, "spellkave_withdraw_control", { identity: dm!.identity! });
		await expect(
			dm!.conn.reducers.rPrepareSteeredActor({ bodyEntityId: personBody }),
		).rejects.toThrow("steering_requires_person_consent");
		const take = {
			presence_actor_id: String(actor(dmBody)),
			actor_id: String(npcActor),
			expected_generation: String(original.generation),
			world_instance_id: original.worldInstanceId,
			request_id: `${b}/take`,
			reason: "manual scene",
		};
		await tool(dm!, dmBody, "spellkave_take_npc_control", take);
		const held = await inspect();
		await expect(
			driver!.conn.reducers.rActorWakeUp({ actorId: npcBody, driverToken: original }),
		).rejects.toThrow("driver_control_stale_generation");
		expect(await inspect()).toEqual(held);
		assertions.push({
			scenario: "AUTH-41-01",
			assertion: "acknowledged MCP hold rejects original service work",
			held,
		});
		yield "MCP hold and consent";
		const cli = await actAsCli(dm!, token, [
			"actor",
			"control",
			"list",
			"--actor-id",
			String(npcActor),
		]);
		expect(cli.result.code, cli.result.stderr).toBe(0);
		expect(cli.result.stdout).toContain('"held":true');
		calls.push(cli);
		const returned = await actAsCli(dm!, token, [
			"actor",
			"control",
			"return",
			String(npcActor),
			String(original.generation + 1n),
			original.worldInstanceId,
			`${b}/return`,
			"scene complete",
		]);
		expect(returned.result.code, returned.result.stderr).toBe(0);
		calls.push(returned);
		expect((await inspect())[0]?.holder).toEqual([1, []]);
		await expect(
			driver!.conn.reducers.rActorWakeUp({ actorId: npcBody, driverToken: original }),
		).rejects.toThrow("driver_control_stale_generation");
		await waitForEvent(
			driver!,
			() => readDriverControl(driver!.db(), npcBody)[0]?.generation === original.generation + 2n,
			"new perception after CLI return",
		);
		await driver!.conn.reducers.rActorWakeUp({
			actorId: npcBody,
			driverToken: captureDriverToken(driver!.db(), npcBody),
		});
		assertions.push({
			scenario: "AUTH-41-02",
			assertion:
				"installed holder CLI return preserves stale rejection and fresh perception succeeds",
			control: await inspect(),
		});
		const freshTake = {
			...take,
			expected_generation: String(original.generation + 2n),
			request_id: `${b}/take2`,
		};
		await tool(dm!, dmBody, "spellkave_take_npc_control", freshTake);
		const beforeOtherReturn = await inspect();
		await expect(
			tool(peer!, dmBody, "spellkave_return_npc_control", {
				actor_id: String(npcActor),
				expected_generation: String(original.generation + 3n),
				world_instance_id: original.worldInstanceId,
				request_id: `${b}/foreign`,
				reason: "not the holder",
			}),
		).rejects.toThrow("NPC return requires recorded holder");
		expect(await inspect()).toEqual(beforeOtherReturn);
		await tool(dm!, dmBody, "spellkave_return_npc_control", {
			actor_id: String(npcActor),
			expected_generation: String(original.generation + 3n),
			world_instance_id: original.worldInstanceId,
			request_id: `${b}/return2`,
			reason: "explicit MCP surrender",
		});
		expect((await inspect())[0]?.generation).toBe(Number(original.generation + 4n));
		outcome = "passed";
	} finally {
		for (const world of worlds) world.disconnect();
		const output = resolve(
			process.env.SPELLKAVE_ACT_AS_EVIDENCE_DIR ??
				resolve(import.meta.dirname, "../../../../.local/act-as-evidence"),
		);
		mkdirSync(output, { recursive: true });
		const module = process.env.SPELLKAVE_SERVER_WASM_BIN;
		let evidence = json({
			schema: "act-as-consent-consumer/v1",
			outcome,
			moduleSha256: module
				? createHash("sha256").update(readFileSync(module)).digest("hex")
				: "unrecorded",
			fixtureSha256: createHash("sha256")
				.update(readFileSync(import.meta.filename))
				.digest("hex"),
			testedAt: new Date().toISOString(),
			calls,
			actualReducerCalls: rpcCalls,
			developerSqlCalls: sqlCalls,
			assertions,
			cost: {
				elapsedMs: Date.now() - started,
				consumerCalls: calls.length,
				actualReducerCalls: rpcCalls.length,
				developerSqlCalls: sqlCalls.length,
				fullJourneyBytes: Buffer.byteLength(json({ rpcCalls, sqlCalls })),
				bytes: Buffer.byteLength(json(calls)),
				inferenceTokens: 0,
				retries: 0,
				images: 0,
				accountingScope:
					"Exact MCP and installed CLI consumer interactions; local publisher setup and independent SQL are developer overhead.",
			},
		}).replaceAll(b, "control_lab");
		for (const [identity, alias] of aliases) evidence = evidence.replaceAll(identity, alias);
		writeFileSync(resolve(output, "consumer-v1.json"), `${evidence}\n`);
	}
	return outcome;
}
describe.skipIf(process.env.SPELLKAVE_LOCAL_NODE !== "1")("AUTH-41 real consumer surfaces", () => {
	const execution = journey();
	it.each(["setup", "MCP hold and consent", "CLI return"])("%s", async (phase) => {
		const result = await execution.next();
		if (phase === "CLI return") {
			expect(result.done).toBe(true);
			expect(result.value).toBe("passed");
		} else expect(result.value).toBe(phase);
	});
	it("MCP session close keeps every original Service-participant observation", async () => {
		const token = resolveSpacetimeConfigPathToken();
		if (!token) throw new Error("owned publisher credential required");
		const publisher = await connectTestWorld({ token });
		const actualReducerCalls: Record<string, unknown>[] = [];
		const developerSqlCalls: unknown[] = [];
		const consumerCalls: unknown[] = [];
		const assertions: unknown[] = [];
		const started = Date.now();
		let outcome = "failed";
		let fixture = "";
		recordActAsTransport(publisher, "publisher", actualReducerCalls);
		const inspect: typeof rows = async (world, query) => {
			const result = await rows(world, query);
			developerSqlCalls.push({ query, result });
			return result;
		};
		try {
			await ensureWorldAuthority(publisher);
			const b = cleanup.track(`mcp_close41_${randomUUID().replaceAll("-", "")}`);
			fixture =
				actAsFixture(b, {
					person: publisher.identity!,
					dm: publisher.identity!,
					peer: publisher.identity!,
					host: publisher.identity!,
				}).replace('provenance="person"', 'provenance="service"') +
				`
[[actor_identities]]
bundle_id="${b}"
entity_key="${b}/npc"
identity="${publisher.identity}"
role="primary"
provenance="service"
`;
			await applyManifestSource(publisher, fixture);
			const bodies = ["person", "npc"].map(
				(name) => entityIdByManifestKey(publisher.db(), `${b}:${b}/${name}`)!,
			);
			const original = bodies.map((body) => captureDriverToken(publisher.db(), body)!);
			await publisher.conn.reducers.rSessionOpen({
				sessionDefId: `${b}/session`,
				participants: bodies,
				gridExtentJson: "",
				driverTokens: original,
			});
			const sessionRows = await inspect(
				publisher,
				`SELECT * FROM session WHERE session_def_id = '${b}/session'`,
			);
			expect(sessionRows).toHaveLength(1);
			const sessionId = Number(sessionRows[0]!.session_id);
			const input = original.map((observation) => ({
				world_instance_id: observation.worldInstanceId,
				generation: String(observation.generation),
				actor_id: String(observation.actorId),
				body_entity_id: String(observation.bodyEntityId),
			}));
			const tool = createSpellkaveTools({
				db: publisher.db,
				act: {
					actorId: String(bodies[0]),
					callRSessionClose: publisher.conn.reducers.rSessionClose,
				},
			}).find((entry) => entry.name === "spellkave_session_close")!;
			const refused = await tool.execute("missing-observation", {
				session_id: sessionId,
				outcome: "completed",
				control_tokens: input.slice(0, 1),
			});
			consumerCalls.push({
				name: "spellkave_session_close",
				params: { session_id: sessionId, outcome: "completed", control_tokens: input.slice(0, 1) },
				result: refused,
			});
			expect((refused.details as { session: { status: string } }).session.status).toBe("rejected");
			expect(
				await inspect(publisher, `SELECT * FROM session WHERE session_id = ${sessionId}`),
			).toEqual(sessionRows);
			expect(
				await inspect(
					publisher,
					`SELECT * FROM event_session_close WHERE session_id = ${sessionId}`,
				),
			).toEqual([]);
			const completed = await tool.execute("original-observations", {
				session_id: sessionId,
				outcome: "completed",
				control_tokens: input,
			});
			consumerCalls.push({
				name: "spellkave_session_close",
				params: { session_id: sessionId, outcome: "completed", control_tokens: input },
				result: completed,
			});
			expect((completed.details as { session: { status: string } }).session.status).toBe("success");
			expect(
				await inspect(publisher, `SELECT lifecycle FROM session WHERE session_id = ${sessionId}`),
			).toEqual([{ lifecycle: "completed" }]);
			expect(
				await inspect(
					publisher,
					`SELECT * FROM event_session_close WHERE session_id = ${sessionId}`,
				),
			).toHaveLength(1);
			assertions.push({
				assertion:
					"missing second Service observation refuses with identical session and zero close events; both original observations commit exactly one completed close",
				before: sessionRows,
				after: await inspect(publisher, `SELECT * FROM session WHERE session_id = ${sessionId}`),
			});
			outcome = "passed";
		} finally {
			publisher.disconnect();
			const output = resolve(
				process.env.SPELLKAVE_ACT_AS_EVIDENCE_DIR ??
					resolve(import.meta.dirname, "../../../../.local/act-as-evidence"),
			);
			mkdirSync(output, { recursive: true });
			const module = process.env.SPELLKAVE_SERVER_WASM_BIN;
			writeFileSync(
				resolve(output, "multi-service-mcp-close-v1.json"),
				json({
					schema: "act-as-consent-multi-service-mcp-close/v1",
					outcome,
					testedAt: new Date().toISOString(),
					moduleSha256: module
						? createHash("sha256").update(readFileSync(module)).digest("hex")
						: "unrecorded",
					fixtureSha256: createHash("sha256").update(fixture).digest("hex"),
					consumerCalls,
					actualReducerCalls,
					developerSqlCalls,
					assertions,
					cost: {
						elapsedMs: Date.now() - started,
						consumerCalls: consumerCalls.length,
						actualReducerCalls: actualReducerCalls.length,
						developerSqlCalls: developerSqlCalls.length,
						fullJourneyBytes: Buffer.byteLength(
							json({ consumerCalls, actualReducerCalls, developerSqlCalls }),
						),
						inferenceTokens: 0,
						retries: 0,
						images: 0,
					},
				}) + "\n",
			);
		}
	});

	afterAll(async () => {
		await execution.return("aborted");
		await cleanup.run();
	});
});
// ci-allow-end(raw-sql)
