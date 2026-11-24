// An operator investigating a failed tool call can follow one request from the gateway
// through the session daemon to the reducer call, because every layer records the same
// correlation IDs. If it breaks, traces cannot be joined across layers. Runs a real
// daemon over a temp socket with injected session and reducer evidence, no live world.

// keep-file(K2): injected session and reducer evidence

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemorySink } from "@spellkave/agent-observability";
import type { SessionBinding } from "@spellkave/session";
import {
	createSessionCausalTelemetry,
	createSessionRunObserver,
	SessionDaemonClient,
	serveDaemon,
} from "@spellkave/session/node";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";

import {
	createSessionToolHandler,
	type PlayerSessionClient,
	type PlayerToolResult,
} from "../daemon-handler.ts";
import { createRemoteMcpRunObserver, withRemoteMcpRequestContext } from "../observability.ts";

const binding: SessionBinding = {
	url: "http://127.0.0.1:3000",
	db: "elven-mini",
	identity: "private-identity",
	actorId: "hero-1",
};

describe("hosted MCP to reducer correlation", () => {
	const directories: string[] = [];
	afterEach(() => {
		for (const directory of directories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it("joins gateway, session, and reducer evidence while provenance stays a separate verdict", async () => {
		const directory = mkdtempSync(join(tmpdir(), "spellkave-mcp-correlation-"));
		directories.push(directory);
		const socketPath = join(directory, "session.sock");
		const gatewaySink = createMemorySink();
		const sessionSink = createMemorySink();
		const reducerSpans: Array<{
			attributes?: Record<string, unknown>;
			events: Array<{ name: string; attributes?: Record<string, unknown> }>;
		}> = [];
		const causalTelemetry = createSessionCausalTelemetry({
			startSpan: (_name, attributes) => {
				const record = {
					attributes,
					events: [] as Array<{ name: string; attributes?: Record<string, unknown> }>,
				};
				reducerSpans.push(record);
				return {
					addEvent: (name, eventAttributes) =>
						record.events.push({ name, attributes: eventAttributes }),
					end: () => {},
				};
			},
			flush: async () => {},
		});
		const sessionObserver = createSessionRunObserver({
			mode: "jsonl",
			binding,
			env: {},
			sinks: [sessionSink],
			causalTelemetry,
		});
		const daemon = await serveDaemon({
			binding,
			socketPath,
			observability: sessionObserver,
			tools: [
				{
					name: "test_act",
					parameters: Type.Object({}),
					execute: async () => {
						const span = causalTelemetry.tracer.startSpan("spellkave.reducer_attempt", {
							"spellkave.action_id": "equip-creation-longsword",
							"spellkave.target_ref": "hero-1",
						});
						span.addEvent("provenance_observed", {
							"spellkave.provenance_id": "prov-17",
							"spellkave.provenance_status": "Failed",
							"spellkave.failure_class": "missing_equipment_slot",
						});
						span.end("error");
						return { content: [{ type: "text", text: "rejected" }], details: {} };
					},
				},
			],
		});
		const gatewayObserver = createRemoteMcpRunObserver({
			resolveActor: () => ({ actorId: "hero-1", worldSlug: "elven-mini" }),
			sinks: [gatewaySink],
		});
		const daemonClient = new SessionDaemonClient({ socketPath, spawned: false });
		const client: PlayerSessionClient = {
			invoke: (tool, args, causalContext) =>
				daemonClient.invoke<PlayerToolResult>(tool, args, causalContext),
		};
		const handler = createSessionToolHandler(client, gatewayObserver);

		await withRemoteMcpRequestContext("corr-e2e", async () => await handler("test_act", {}));

		expect(gatewaySink.events.find((event) => event.type === "tool_call")?.data).toMatchObject({
			correlation_id: "corr-e2e",
			world_slug: "elven-mini",
		});
		expect(sessionSink.events.find((event) => event.type === "tool_call")?.data).toMatchObject({
			correlation_id: "corr-e2e",
			world_slug: "elven-mini",
		});
		expect(reducerSpans[0]?.attributes).toMatchObject({
			"spellkave.correlation_id": "corr-e2e",
			"spellkave.world_slug": "elven-mini",
			"spellkave.action_id": "equip-creation-longsword",
		});
		expect(reducerSpans[0]?.events[0]?.attributes).toMatchObject({
			"spellkave.provenance_id": "prov-17",
			"spellkave.provenance_status": "Failed",
			"spellkave.failure_class": "missing_equipment_slot",
		});
		// Correlation joins the records; it does not replace the authoritative
		// provenance id/status with a gateway-derived success claim.
		expect(JSON.stringify(gatewaySink.events)).not.toContain("prov-17");

		await daemon.close("test_complete");
	});
});
