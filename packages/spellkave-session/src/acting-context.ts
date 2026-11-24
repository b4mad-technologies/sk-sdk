/** A caller-owned selection; every resolution reads the current connection. */
import type { ReaderManifest, SpellkaveSession } from "@spellkave/sdk";
import { ACTING_CONTEXT_PARAMS, type LiveToolAuthority } from "@spellkave/tool-contracts";
import { bindTool, defineTool } from "@spellkave/tool-runtime";

export const AUTHORITY_TOOL_READER_MANIFEST = {
	requiredTables: [
		"role_definition",
		"role_aggregation",
		"visible_role_binding",
		"grant_inventory",
		"capability_definition",
		"extent_kind_definition",
		"visible_actor_identity",
		"visible_capability",
		"actor",
		"world_time",
	],
} satisfies ReaderManifest;

export interface ActingContextChoice {
	kind: "character" | "presence";
	bodyId: string;
	bindingId?: string;
	capabilityIds: string[];
}
const active = (expires: bigint | undefined, tick: bigint) =>
	expires === undefined || expires === 0n || expires > tick;
/**
 * The caller's acting choices. `boundBodyId` (ADR-0161 D-5): the character
 * body a seat-routed session was attached for; the identity's other
 * characters are then not choices (presences stay), so neither acting nor
 * the advertised tool authority can reach another hero of the person.
 */
export function callerActingContexts(
	session: SpellkaveSession,
	boundBodyId?: string,
): ActingContextChoice[] {
	const bound = boundBodyId === "" ? undefined : boundBodyId;
	const conn = session.conn;
	const mine = conn.identity?.toHexString();
	if (!mine || !conn.isActive) return [];
	const db = conn.db;
	const tick = [...db.worldTime.iter()][0]?.tick;
	if (tick === undefined) return [];
	const identities = [...db.visibleActorIdentity.iter()].filter(
		(row) => row.identity.toHexString() === mine && row.role !== "co-pilot",
	);
	const actors = [...db.actor.iter()].filter(
		(row) =>
			identities.some((identity) => identity.actorId === row.actorId) && row.currentBody !== 0n,
	);
	const grants = [...db.visibleCapability.iter()].filter(
		(row) => row.grantedAtTick <= tick && active(row.expiresAtTick, tick),
	);
	const ownedBodies = new Set(actors.map((actor) => actor.currentBody));
	const bindings = [...db.visibleRoleBinding.iter()].filter(
		(row) =>
			row.subject === mine &&
			ownedBodies.has(row.presenceEntityId) &&
			row.realisedAtTick !== undefined &&
			active(row.expiresAtTick, tick),
	);
	const choices: ActingContextChoice[] = bindings.map((binding) => ({
		kind: "presence",
		bodyId: String(binding.presenceEntityId),
		bindingId: binding.bindingId,
		capabilityIds: grants
			.filter(
				(grant) =>
					grant.entityId === binding.presenceEntityId &&
					grant.source === `role_binding:${binding.bindingId}`,
			)
			.map((grant) => grant.capabilityId),
	}));
	for (const actor of actors.filter(
		(actor) =>
			identities.some(
				(identity) => identity.actorId === actor.actorId && identity.role === "primary",
			) && !bindings.some((binding) => binding.presenceEntityId === actor.currentBody),
	))
		choices.push({
			kind: "character",
			bodyId: String(actor.currentBody),
			capabilityIds: grants
				.filter((grant) => grant.entityId === actor.currentBody)
				.map((grant) => grant.capabilityId),
		});
	return choices.filter(
		(choice) => choice.kind !== "character" || bound === undefined || choice.bodyId === bound,
	);
}

export function callerToolAuthority(
	session: SpellkaveSession,
	boundBodyId?: string,
): LiveToolAuthority {
	const choices = callerActingContexts(session, boundBodyId);
	const db = session.conn.db;
	const aggregations = [...db.roleAggregation.iter()];
	return {
		character: choices.some((choice) => choice.kind === "character"),
		presence: choices.some((choice) => choice.kind === "presence"),
		publisher: false,
		capabilities: [...new Set(choices.flatMap((choice) => choice.capabilityIds))],
		bodyCapabilities: choices.map((choice) => choice.capabilityIds),
		roles: [...db.roleDefinition.iter()].map((role) => ({
			roleId: role.roleId,
			capabilityIds: [
				...new Set([
					...role.capabilityIds,
					...aggregations
						.filter((row) => row.roleId === role.roleId)
						.flatMap((row) => row.capabilityIds),
				]),
			],
		})),
	};
}

export class ActingContextError extends Error {
	constructor(
		readonly code: string,
		readonly choices: readonly ActingContextChoice[],
	) {
		super(
			`${code}: select one of your eligible binding ids: ${choices
				.map((choice) => choice.bindingId)
				.filter(Boolean)
				.join(", ")}`,
		);
		this.name = "ActingContextError";
	}
}
/**
 * `boundBodyId`: the character body this session was attached for (the MCP
 * gateway's routed seat, ADR-0161 D-5). An identity may hold several
 * characters in one world (#4168); a session bound to one of them never acts
 * as another, so the other characters are not choices here. Presences stay.
 */
export function createActingContextSelector(
	session: SpellkaveSession,
	options: { boundBodyId?: string } = {},
) {
	let selected: { kind: "character" } | { kind: "presence"; bindingId: string } | undefined;
	const read = () => callerActingContexts(session, options.boundBodyId);
	return {
		read,
		select(args: { binding_id?: string; character?: boolean }) {
			if (args.binding_id !== undefined && args.character !== undefined)
				throw new ActingContextError("invalid_acting_context", []);
			const candidate =
				args.binding_id !== undefined
					? { kind: "presence" as const, bindingId: args.binding_id }
					: args.character === true
						? { kind: "character" as const }
						: selected;
			if (
				candidate !== undefined &&
				!read().some(
					(choice) =>
						choice.kind === candidate.kind &&
						(candidate.kind !== "presence" || choice.bindingId === candidate.bindingId),
				)
			) {
				throw new ActingContextError("acting_context_unavailable", []);
			}
			selected = candidate;
			return { choices: read(), selected };
		},
		resolve(capability?: string | readonly string[]): ActingContextChoice {
			const required =
				capability === undefined
					? undefined
					: typeof capability === "string"
						? [capability]
						: capability;
			const matches = (choice: ActingContextChoice) =>
				required === undefined || required.some((id) => choice.capabilityIds.includes(id));
			const owned = read();
			if (selected !== undefined) {
				const chosen = owned.find(
					(choice) =>
						choice.kind === selected?.kind &&
						(selected.kind !== "presence" || choice.bindingId === selected.bindingId),
				);
				if (!chosen || !matches(chosen))
					throw new ActingContextError("acting_context_unavailable", []);
				return chosen;
			}
			const characters = owned.filter((choice) => choice.kind === "character");
			const eligible =
				capability === undefined ? (characters.length ? characters : owned) : owned.filter(matches);
			if (eligible.length !== 1)
				throw new ActingContextError(
					eligible.length ? "ambiguous_acting_context" : "acting_context_unavailable",
					eligible,
				);
			const first = eligible[0];
			if (first === undefined) throw new ActingContextError("acting_context_unavailable", []);
			return first;
		},
	};
}

/** Shared definition: the selector is host-owned and may follow a reconnect. */
export const actingContextToolDef = defineTool({
	contract: "spellkave_acting_context",
	schema: ACTING_CONTEXT_PARAMS,
	run: async (
		context: { selector: () => ReturnType<typeof createActingContextSelector> },
		args,
	) => {
		const details = context.selector().select(args);
		return { content: [{ type: "text" as const, text: JSON.stringify(details) }], details };
	},
});
export function createActingContextTool(
	selector: () => ReturnType<typeof createActingContextSelector>,
) {
	return bindTool(actingContextToolDef, { context: { selector }, capabilities: {} });
}
