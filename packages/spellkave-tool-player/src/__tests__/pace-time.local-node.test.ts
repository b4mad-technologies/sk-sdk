/** Ordered AUTH-40 journey; each behavioral case retains Vitest's default ceiling. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	applyManifestDelta,
	connectTestWorld,
	ensureWorldAuthority,
	operatorScopeManifest,
	readFixtureSource,
	syncConnection,
	type TestWorld,
	waitForEvent,
} from "@spellkave/test-lab";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPaceTimeTools } from "../pace-time";

const json = (value: unknown) =>
	JSON.stringify(value, (_, v) => (typeof v === "bigint" ? String(v) : v));
const required = (key: string) => {
	const value = process.env[key];
	if (!value) throw new Error(`${key} missing`);
	return value;
};
const repo = resolve(import.meta.dirname, "../../../..");
const sql = (query: string) =>
	execFileSync(
		"spacetime",
		[
			"--config-path",
			required("SPACETIME_CONFIG_PATH"),
			"sql",
			"--server",
			"local",
			process.env.SPELLKAVE_DB ?? "spellkave-dev",
			query,
		],
		{ encoding: "utf8" },
	);
const manifest = operatorScopeManifest("pacing acceptance", [
	"config",
	"world_time",
	"world_tick_timer",
	"actor",
	"visible_role_binding",
	"visible_actor_identity",
	"visible_capability",
	"visible_world_event",
	"visible_event_pace_time",
	"visible_clock_pacer",
]);
describe.skipIf(
	process.env.SPELLKAVE_LOCAL_NODE !== "1" || process.env.SPELLKAVE_PACE_LOCAL_ACCEPTANCE !== "1",
)("owned local clock journey", () => {
	let publisher: TestWorld,
		first: TestWorld,
		second: TestWorld,
		tool: ReturnType<typeof createPaceTimeTools>[number];
	let bindingId: string, presence: bigint, started: number;
	const profiles = mkdtempSync(resolve(tmpdir(), "pace-profile-"));
	const worlds: TestWorld[] = [],
		traces: Record<string, unknown>[] = [];
	const observe = async () => {
		await syncConnection(publisher);
		if (!publisher.token) throw new Error("publisher SQL credential missing");
		const queries = {
			time: "SELECT id, tick, last_tick_at FROM world_time",
			timer: "SELECT scheduled_id, scheduled_at, armed_at FROM world_tick_timer",
			config:
				"SELECT version, world_name, operator_identity, event_retention_limit, tick_interval_secs, fiction_ms_per_tick, interrupted_action_credit_decay_ticks, condition_hook_retention_ticks, world_instance_id, min_tick_interval_secs, max_tick_interval_secs FROM config",
			pacer: "SELECT id, op, event_id, pacer_body, tick, timestamp FROM clock_pacer",
			events: "SELECT id, tick, timestamp, kind, summary, notable, request_id FROM world_event",
			detail:
				"SELECT event_id, op, pacer_body_entity_id, paused, tick_interval_secs, stepped_ticks, changed FROM event_pace_time",
		};
		// Independent publisher SQL still checks every selected column and row.
		// Reuse HTTP connections instead of launching six native processes per snapshot.
		const snapshots = await Promise.all(
			Object.entries(queries).map(async ([name, query]) => {
				const response = await fetch(
					`${required("SPELLKAVE_URL")}/v1/database/${process.env.SPELLKAVE_DB ?? "spellkave-dev"}/sql`,
					{
						method: "POST",
						headers: { "Content-Type": "text/plain", Authorization: `Bearer ${publisher.token}` },
						body: query,
					},
				);
				if (!response.ok) throw new Error(`SQL ${response.status}: ${await response.text()}`);
				const statements = JSON.parse(
					await response.text(),
					(_key, value: unknown, context?: { source: string }) => {
						if (typeof value !== "number") return value;
						// Keep exact integer lexemes, including u64/u256 values beyond JS precision.
						if (!context) throw new Error("lossless SQL JSON parsing unavailable");
						return context.source;
					},
				) as { schema: unknown; rows: unknown[][] }[];
				// Query timing/stats are transport metadata; retain the complete typed state.
				return [name, statements.map(({ schema, rows }) => ({ schema, rows }))] as const;
			}),
		);
		return Object.fromEntries(snapshots);
	};
	const call = async (op: "pause" | "resume" | "step" | "interval", extra = {}) => {
		const request = { op, ...extra };
		try {
			const result = await tool.execute(`proof-${traces.length}`, request);
			traces.push({ kind: "caller-tool", request, result, outcome: "accepted" });
			await syncConnection(publisher);
			return result;
		} catch (error) {
			traces.push({ kind: "caller-tool", request, error: String(error), outcome: "refused" });
			throw error;
		}
	};
	const clockStatus = (caller = false) => {
		const argv = [
			"--url",
			required("SPELLKAVE_URL"),
			"--db",
			process.env.SPELLKAVE_DB ?? "spellkave-dev",
			"clock",
			"status",
		];
		if (caller) {
			if (!first.token) throw new Error("caller credential unavailable");
			mkdirSync(resolve(profiles, "config/profiles"), { recursive: true });
			const profile = resolve(profiles, "config/profiles/caller.toml");
			writeFileSync(
				profile,
				`[connection]\nurl = "${required("SPELLKAVE_URL")}"\ndb = "${process.env.SPELLKAVE_DB ?? "spellkave-dev"}"\n[identity]\nrole = "watcher"\nin_world_self = "synthetic-timekeeper"\ncredential = { kind = "env_var", name = "CLOCK_CALLER_TOKEN" }\n[defaults]\nmode = "passive"\n`,
			);
			argv.unshift("--profile", "caller");
		}
		let stdout: string;
		try {
			stdout = execFileSync(
				process.env.SPELLKAVE_CLI_BIN ?? resolve(repo, "client/target/debug/spellkave"),
				argv,
				{
					encoding: "utf8",
					cwd: tmpdir(),
					env: {
						...process.env,
						...(caller ? { SPELLKAVE_HOME: profiles, SPELLKAVE_CLI_AS_OWNER: "0" } : {}),
						CLOCK_CALLER_TOKEN: first.token ?? "",
					},
				},
			);
		} catch (error) {
			const output = (error as { stdout?: string }).stdout ?? "no CLI output";
			throw new Error(`clock status refused: ${output}`);
		}
		traces.push({
			kind: caller ? "caller-CLI" : "publisher-CLI",
			argv: ["spellkave", ...argv],
			exitCode: 0,
			stdout,
		});
		return stdout
			.split("\n")
			.filter(Boolean)
			.map((l) => JSON.parse(l))
			.find((l) => l.kind === "clock_status");
	};
	beforeAll(async () => {
		started = Date.now();
		const token = resolveSpacetimeConfigPathToken();
		if (!token) throw new Error("publisher token missing");
		publisher = await connectTestWorld({ token, readerManifests: [manifest] });
		worlds.push(publisher);
		await ensureWorldAuthority(publisher);
		await publisher.conn.reducers.pauseTick({});
		await publisher.conn.reducers.setTickIntervalBounds({ minimum: 1n, maximum: 86400n });
		await publisher.conn.reducers.setTickIntervalSecs({ seconds: 5n });
		await publisher.conn.reducers.setEventRetentionLimit({ limit: 100 });
		const callers: TestWorld[] = [];
		for (let index = 0; index < 2; index++) {
			const world = await connectTestWorld({ token: null, readerManifests: [manifest] });
			worlds.push(world);
			callers.push(world);
			const namespace = `pace_${Date.now()}_${index}`;
			let source = readFixtureSource(
				"packages/spellkave-mechanics/fixtures/test_lab_live_on_demand_gatekeeper/manifest.toml",
			)
				.replaceAll("test_lab_live_on_demand_gatekeeper", namespace)
				.replaceAll("$sender", world.identity ?? "");
			source = source.replace(
				/\[\[(?:actor_capabilities|role_bindings)\]\][\s\S]*?(?=\[\[|$)/g,
				"",
			);
			for (const role of ["timekeeper", "dm"])
				source += `\n[[role_bindings]]\nbinding_id = "${namespace}/${role}"\nbundle_id = "${namespace}"\nsubject = "${world.identity}"\nrole_id = "${role}"\nextent_kind_ref = "place_graph"\nextent_ref = "${namespace}"\ndescription = "Synthetic clock proof"\n`;
			await applyManifestDelta(publisher, source);
			await syncConnection(world);
			if (index === 0) bindingId = `${namespace}/timekeeper`;
			traces.push({ kind: "setup", namespace });
		}
		const a = callers[0],
			b = callers[1];
		if (!a || !b) throw new Error("missing callers");
		first = a;
		second = b;
		const t = createPaceTimeTools({ connection: first.conn })[0];
		if (!t) throw new Error("timekeeper absent");
		tool = t;
		const binding = [...first.conn.db.visibleRoleBinding.iter()].find(
			(b) => b.subject === first.identity && b.roleId === "timekeeper",
		);
		if (!binding) throw new Error("presence absent");
		presence = binding.presenceEntityId;
	});
	it("AUTH-40-01 names the presence, records exact steps and survives a hundred ticks", async () => {
		const paused = await call("pause");
		expect(paused.details.paused).toBe(true);
		const detail = [...publisher.conn.db.visibleEventPaceTime.iter()].find(
			(e) => e.eventId === BigInt(paused.details.event_id),
		);
		expect(detail?.pacerBodyEntityId).toBe(presence);
		expect(
			sql(
				`SELECT event_id, op, pacer_body_entity_id, paused, tick_interval_secs, stepped_ticks, changed FROM event_pace_time WHERE event_id = ${paused.details.event_id}`,
			),
		).toContain(String(presence));
		const status = clockStatus();
		expect(status.paused).toBe(true);
		expect(status.last_pacer.pacer_body).toBe(Number(presence));
		const ownStatus = clockStatus(true);
		expect(ownStatus.paused).toBe(true);
		expect(ownStatus.last_pacer).toBeNull();
		const tick = [...publisher.conn.db.worldTime.iter()][0]?.tick ?? 0n;
		const prior = new Set([...publisher.conn.db.visibleWorldEvent.iter()].map((e) => e.id));
		const stepped = await call("step", { ticks: 3 });
		expect(stepped.details.tick).toBe(String(tick + 3n));
		const additions = [...publisher.conn.db.visibleWorldEvent.iter()].filter(
			(e) => !prior.has(e.id),
		);
		expect(
			additions.filter((e) => e.kind.tag === "Manual" && e.kind.value.tag === "ClockAdvance"),
		).toHaveLength(3);
		expect(
			additions.filter((e) => e.kind.tag === "Manual" && e.kind.value.tag === "PaceTime"),
		).toHaveLength(1);
		expect(
			[...publisher.conn.db.visibleEventPaceTime.iter()].find(
				(e) => e.eventId === BigInt(stepped.details.event_id),
			)?.steppedTicks,
		).toBe(3);
		await call("step", { ticks: 100 });
		// Observe retention on the publisher's subscription before asserting it.
		await waitForEvent(
			[publisher],
			() =>
				![...publisher.conn.db.visibleEventPaceTime.iter()].some(
					(e) => e.eventId === BigInt(paused.details.event_id),
				),
			"publisher observes the pause event pruned after a hundred ticks",
		);
		expect(
			[...publisher.conn.db.visibleEventPaceTime.iter()].some(
				(e) => e.eventId === BigInt(paused.details.event_id),
			),
		).toBe(false);
		expect(clockStatus().last_pacer.pacer_body).toBe(Number(presence));
		// Even a DM read_internal presence does not grant global clock audit reads.
		expect(
			[...first.conn.db.visibleCapability.iter()].some(
				(c) => c.capabilityId === "frontier.read_internal",
			),
		).toBe(true);
		expect([...first.conn.db.visibleEventPaceTime.iter()]).toEqual([]);
		expect([...first.conn.db.visibleClockPacer.iter()]).toEqual([]);
		traces.push({
			scenario: "AUTH-40-01",
			outcome: "passed",
			postcondition: sql("SELECT id, op, event_id, pacer_body, tick, timestamp FROM clock_pacer"),
		});
	});
	it("re-arms a running interval and retains attribution after scheduled pruning", async () => {
		await publisher.conn.reducers.setEventRetentionLimit({ limit: 1 });
		await call("resume");
		await call("interval", { seconds: 1 });
		expect([...publisher.conn.db.worldTickTimer.iter()][0]?.scheduledAt.tag).toBe("Interval");
		const before = sql("SELECT id, op, event_id, pacer_body, tick, timestamp FROM clock_pacer"),
			tick = [...publisher.conn.db.worldTime.iter()][0]?.tick ?? 0n;
		await waitForEvent(
			[publisher],
			() => ([...publisher.conn.db.worldTime.iter()][0]?.tick ?? 0n) >= tick + 3n,
			"new cadence drives three scheduled ticks",
		);
		expect(sql("SELECT id, op, event_id, pacer_body, tick, timestamp FROM clock_pacer")).toBe(
			before,
		);
		expect(sql("SELECT COUNT(*) AS count FROM event_pace_time")).toMatch(/\b0\b/);
		await call("pause");
		traces.push({ scenario: "interval-rearm-retention", outcome: "passed", scheduledTicks: 3 });
	});
	it("AUTH-40-02 refuses malformed, duplicate, out-of-bounds and revoked pacing without writes", async () => {
		await call("pause");
		await publisher.conn.reducers.setEventRetentionLimit({ limit: 100 });
		await call("interval", { seconds: 5 });
		await publisher.conn.reducers.setTickIntervalBounds({ minimum: 5n, maximum: 86400n });
		const nonce = "0123456789abcdef0123456789abcdef";
		await first.conn.reducers.paceTime({
			op: "pause",
			ticks: undefined,
			seconds: undefined,
			requestId: nonce,
		});
		const before = await observe();
		await expect(
			first.conn.reducers.paceTime({
				op: "resume",
				ticks: undefined,
				seconds: undefined,
				requestId: nonce,
			}),
		).rejects.toThrow(/duplicate request_id/);
		expect(await observe()).toEqual(before);
		await expect(
			first.conn.reducers.paceTime({
				op: "resume",
				ticks: undefined,
				seconds: undefined,
				requestId: "bad",
			}),
		).rejects.toThrow(/128 bits/);
		expect(await observe()).toEqual(before);
		await expect(call("interval", { seconds: 1 })).rejects.toThrow(/bounds/);
		expect(await observe()).toEqual(before);
		await expect(
			first.conn.reducers.setTickIntervalBounds({ minimum: 1n, maximum: 86400n }),
		).rejects.toThrow(/AUTH-DIRECT-001/);
		expect(await observe()).toEqual(before);
		const t2 = createPaceTimeTools({ connection: second.conn })[0];
		if (!t2) throw new Error("second holder absent");
		const resumed = await t2.execute("second", { op: "resume" });
		traces.push({
			kind: "second-caller-tool",
			request: { op: "resume" },
			result: resumed,
			outcome: "accepted",
		});
		await syncConnection(publisher);
		expect(resumed.details.paused).toBe(false);
		const p2 = [...second.conn.db.visibleRoleBinding.iter()].find(
			(b) => b.subject === second.identity && b.roleId === "timekeeper",
		)?.presenceEntityId;
		expect([...publisher.conn.db.visibleClockPacer.iter()][0]?.pacerBody).toBe(p2);
		const noOp = await t2.execute("second-no-op", { op: "resume" });
		traces.push({
			kind: "second-caller-tool",
			request: { op: "resume" },
			result: noOp,
			outcome: "accepted no-op",
		});
		await syncConnection(publisher);
		expect(
			[...publisher.conn.db.visibleEventPaceTime.iter()].find(
				(e) => e.eventId === BigInt(noOp.details.event_id),
			)?.changed,
		).toBe(false);
		await call("pause");
		await applyManifestDelta(
			publisher,
			`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[retractions]]
row_kind = "role_bindings"
authored_key = "${bindingId}"
`,
		);
		await syncConnection(first);
		expect(createPaceTimeTools({ connection: first.conn })).toEqual([]);
		const revoked = await observe();
		await expect(first.conn.reducers.resumeTick({})).rejects.toThrow(/AUTH-DIRECT-001/);
		await expect(tool.execute("revoked", { op: "resume" })).rejects.toThrow(/frontier.pace_time/);
		traces.push({
			kind: "caller-tool",
			request: { op: "resume" },
			outcome: "refused after revocation",
			error: "pace_time: frontier.pace_time unavailable",
		});
		expect(await observe()).toEqual(revoked);
		expect(createPaceTimeTools({ connection: publisher.conn })).toEqual([]);
		traces.push({ scenario: "AUTH-40-02", outcome: "passed", postconditions: revoked });
	});
	afterAll(() => {
		const evidence = resolve(process.env.SPELLKAVE_PACE_EVIDENCE_DIR ?? ".local/pace-evidence");
		mkdirSync(evidence, { recursive: true });
		const sanitized = JSON.parse(
			json(traces)
				.replace(/[0-9a-f]{64}/gi, "<synthetic-identity>")
				.replaceAll(repo, "<checkout>")
				.replaceAll(profiles, "<synthetic-profile>"),
		);
		writeFileSync(
			resolve(evidence, "journey.json"),
			`${json({
				schema: "time-control-proof/v1",
				testedAt: new Date().toISOString(),
				sourceSha256: createHash("sha256")
					.update(readFileSync(import.meta.filename))
					.digest("hex"),
				hosted: "transitional: authority-tools-over-mcp .45",
				elapsedMs: Date.now() - started,
				interactions: sanitized,
				interactionCount: traces.length,
				bytes: Buffer.byteLength(json(traces)),
				model: "codex:gpt-6.1-sol",
				tokenAccounting: "not applicable: scripted SDK/CLI route",
				byteAccounting:
					"serialized recorded operations and assertions; excludes websocket replication and bootstrap transport",
				retries: 0,
				images: 0,
			})}\n`,
		);
		for (const world of worlds) world.disconnect();
		rmSync(profiles, { recursive: true, force: true });
	});
});
