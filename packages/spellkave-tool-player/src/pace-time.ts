/** Time controls use the caller's own connection; publisher ports are refused. */
import type { SpellkaveSession } from "@spellkave/sdk";
import { PACE_TIME_PARAMS, SPELLKAVE_PACE_TIME_TOOL } from "@spellkave/tool-contracts/schemas";
import { bindTool, defineTool } from "@spellkave/tool-runtime";
import type { Static } from "typebox";

export interface PaceTimePort {
	connection: SpellkaveSession["conn"];
}

/** Registry exposure is capability-based, independent of preset role names. */
export function hasPaceTimeAuthority(port: PaceTimePort): boolean {
	const conn = port.connection;
	const identity = conn.identity;
	const config = [...conn.db.config.iter()][0];
	if (!identity || !config || identity.toHexString() === config.operatorIdentity.toHexString())
		return false;
	const owned = new Set(
		[...conn.db.visibleActorIdentity.iter()]
			.filter((i) => i.identity.toHexString() === identity.toHexString())
			.map((i) => i.actorId),
	);
	const bodies = new Set(
		[...conn.db.actor.iter()].filter((a) => owned.has(a.actorId)).map((a) => a.currentBody),
	);
	const tick = [...conn.db.worldTime.iter()][0]?.tick ?? 0n;
	const presences = new Set(
		[...conn.db.visibleRoleBinding.iter()]
			.filter(
				(b) =>
					bodies.has(b.presenceEntityId) &&
					b.realisedAtTick !== undefined &&
					(b.expiresAtTick === undefined || tick < b.expiresAtTick),
			)
			.map((b) => b.presenceEntityId),
	);
	return [...conn.db.visibleCapability.iter()].some(
		(c) =>
			presences.has(c.entityId) &&
			c.capabilityId === "frontier.pace_time" &&
			c.grantedAtTick <= tick &&
			(c.expiresAtTick === undefined || tick < c.expiresAtTick),
	);
}

function requestId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const paceTimeToolDefinition = defineTool({
	contract: SPELLKAVE_PACE_TIME_TOOL,
	schema: PACE_TIME_PARAMS,
	run: async (port: PaceTimePort, args: Static<typeof PACE_TIME_PARAMS>) => {
		const conn = port.connection;
		const config = [...conn.db.config.iter()][0];
		if (!conn.identity || !config) throw new Error("pace_time: identity or config unavailable");
		if (conn.identity.toHexString() === config.operatorIdentity.toHexString()) {
			throw new Error("pace_time: publisher connection cannot pace through the time tool");
		}
		if (!hasPaceTimeAuthority(port)) throw new Error("pace_time: frontier.pace_time unavailable");
		const nonce = requestId();
		await conn.reducers.paceTime({
			op: args.op,
			ticks: args.ticks,
			seconds: args.seconds === undefined ? undefined : BigInt(args.seconds),
			requestId: nonce,
		});
		const event = [...conn.db.visibleWorldEvent.iter()].find((e) => e.requestId === nonce);
		if (!event)
			throw new Error("pace_time: correlated event not observed after reducer acknowledgement");
		const details = {
			event_id: event.id.toString(),
			tick: event.tick.toString(),
			paused: [...conn.db.worldTickTimer.iter()].length === 0,
			tick_interval_secs: [...conn.db.config.iter()][0]?.tickIntervalSecs.toString(),
		};
		return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
	},
});

/** Caller-connection execution registry, separate from snapshot-context gameplay tools. */
export const paceTimeToolDefinitions = [paceTimeToolDefinition] as const;

/** A publisher-only host or a connection without a current grant exposes none. */
export function createPaceTimeTools(port?: PaceTimePort) {
	if (!port || !hasPaceTimeAuthority(port)) return [];
	return paceTimeToolDefinitions.map((definition) =>
		bindTool(definition, { context: port, capabilities: {} }),
	);
}
