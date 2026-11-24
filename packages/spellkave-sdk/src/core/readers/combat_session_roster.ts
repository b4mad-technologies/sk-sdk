import type { EntityRow, ObjectStateRow, PlaceNodeRow } from "../../binding_rows";
import { asNumber, asString, tagString } from "./_helpers";
import type { CombatRosterEntry } from "./combat_session_types";
import type { SessionParticipant } from "./session";

/** Build the disambiguated combat roster for a session's participants. */
export function buildRoster(
	participants: SessionParticipant[],
	currentActor: string,
	heroId: string,
	entityRows: EntityRow[],
	stateRows: ObjectStateRow[],
	positions: Map<string, string>,
	nodes: PlaceNodeRow[],
): CombatRosterEntry[] {
	return disambiguateDuplicateNames(
		participants.map((participant) =>
			rosterEntry(participant, currentActor, heroId, entityRows, stateRows, positions, nodes),
		),
	);
}

export function nextRosterEntry(
	roster: CombatRosterEntry[],
	currentActor: string,
): CombatRosterEntry | null {
	const live = roster.filter((entry) => !entry.defeated);
	const currentIndex = live.findIndex((entry) => entry.actorId === currentActor);
	if (live.length === 0 || currentIndex < 0) return null;
	return live[(currentIndex + 1) % live.length] ?? null;
}

function disambiguateDuplicateNames(roster: CombatRosterEntry[]): CombatRosterEntry[] {
	const totals = new Map<string, number>();
	for (const entry of roster) {
		if (entry.isHero) continue;
		totals.set(entry.name, (totals.get(entry.name) ?? 0) + 1);
	}
	const seen = new Map<string, number>();
	return roster.map((entry) => {
		if (entry.isHero || (totals.get(entry.name) ?? 0) < 2) return entry;
		const index = (seen.get(entry.name) ?? 0) + 1;
		seen.set(entry.name, index);
		return { ...entry, name: `${entry.name} ${index}` };
	});
}

function rosterEntry(
	participant: SessionParticipant,
	currentActor: string,
	heroId: string,
	entityRows: EntityRow[],
	stateRows: ObjectStateRow[],
	positions: Map<string, string>,
	nodes: PlaceNodeRow[],
): CombatRosterEntry {
	const name = entityRows.find((row) => String(row.entityId) === participant.actorId)?.name;
	const hp = hpFor(participant.actorId, stateRows);
	const nodeId = positions.get(participant.actorId);
	const node =
		nodeId === undefined ? undefined : nodes.find((candidate) => candidate.nodeId === nodeId);
	return {
		actorId: participant.actorId,
		name: asString(name) || `entity:${participant.actorId}`,
		hp,
		defeated: hp !== undefined && hp <= 0,
		isCurrent: participant.actorId === currentActor,
		isHero: participant.actorId === heroId,
		nodeId,
		cell: node?.posPresent ? { x: asNumber(node.posX), y: asNumber(node.posY) } : undefined,
	};
}

function hpFor(actorId: string, rows: ObjectStateRow[]): number | undefined {
	const row = rows.find(
		(candidate) =>
			targetKindMatches(candidate.targetKind, "entity") &&
			String(candidate.targetId) === actorId &&
			asString(candidate.stateId).endsWith("/hp"),
	);
	const value = row ? dslIntValue(row.value) : null;
	return value === null ? undefined : Number(value);
}

function targetKindMatches(actual: unknown, expected: string): boolean {
	return tagString(actual).replace(/_/g, "").toLowerCase() === expected;
}

function dslIntValue(value: unknown): bigint | null {
	if (typeof value === "bigint") return value;
	if (typeof value === "number") return BigInt(value);
	if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (tagString(record.tag) === "Int") return dslIntValue(record.value);
	if ("Int" in record) return dslIntValue(record.Int);
	return null;
}
