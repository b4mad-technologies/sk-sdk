/** Advisory local exposure; reducer admission remains authoritative. */
import { asEntityRef, type EntityRef } from "@spellkave/sdk";
import type { PaceTimePort } from "./pace-time";

export const presenceActRequiredTables = [
	"config",
	"world_time",
	"actor",
	"visible_actor_identity",
	"visible_role_binding",
	"visible_capability",
	"role_definition",
	"role_aggregation",
	"affordance_template",
] as const;

/** Bodies owned by this caller with a live binding grant for an authored act. */
export function presenceActBodies(port: PaceTimePort): EntityRef[] {
	const conn = port.connection;
	const identity = conn.identity?.toHexString();
	const publisher = [...conn.db.config.iter()][0]?.operatorIdentity.toHexString();
	if (!identity || !publisher || identity === publisher) return [];
	const owned = new Set(
		[...conn.db.visibleActorIdentity.iter()]
			.filter((row) => row.identity.toHexString() === identity)
			.map((row) => row.actorId),
	);
	const bodies = new Set(
		[...conn.db.actor.iter()].filter((row) => owned.has(row.actorId)).map((row) => row.currentBody),
	);
	const tick = [...conn.db.worldTime.iter()][0]?.tick;
	if (tick === undefined) return [];
	const templates = new Set(
		[...conn.db.affordanceTemplate.iter()]
			.map((row) => row.capabilityId)
			.filter((id) => id.startsWith("frontier.")),
	);
	const roles = [...conn.db.roleDefinition.iter()];
	const aggregations = [...conn.db.roleAggregation.iter()];
	const capabilities = [...conn.db.visibleCapability.iter()];
	return [...conn.db.visibleRoleBinding.iter()]
		.filter((binding) => {
			if (
				!bodies.has(binding.presenceEntityId) ||
				binding.realisedAtTick === undefined ||
				(binding.expiresAtTick !== undefined &&
					binding.expiresAtTick !== 0n &&
					tick >= binding.expiresAtTick)
			)
				return false;
			const role = roles.find((row) => row.roleId === binding.roleId);
			if (!role) return false;
			const ids = new Set([
				...role.capabilityIds,
				...aggregations
					.filter((row) => row.roleId === binding.roleId)
					.flatMap((row) => row.capabilityIds),
			]);
			return capabilities.some(
				(grant) =>
					grant.entityId === binding.presenceEntityId &&
					grant.source === `role_binding:${binding.bindingId}` &&
					ids.has(grant.capabilityId) &&
					templates.has(grant.capabilityId) &&
					grant.grantedAtTick <= tick &&
					(grant.expiresAtTick === undefined || tick < grant.expiresAtTick),
			);
		})
		.map((binding) => asEntityRef(`entity:${binding.presenceEntityId}`));
}

export function hasPresenceActAuthority(port: PaceTimePort): boolean {
	return presenceActBodies(port).length > 0;
}
