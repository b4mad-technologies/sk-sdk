import type { EvaluationProvenanceRow, WorldEventRow } from "../../binding_rows";
import { asNumber, asString, tagString } from "./_helpers";
import type { CombatFeedback } from "./combat_session_types";

export function latestFeedback(
	heroId: string,
	provenanceRows: EvaluationProvenanceRow[],
	eventRows: WorldEventRow[],
): CombatFeedback {
	const failure = provenanceRows
		.filter((row) => asString(row.subjectId) === heroId && failureStatus(row.status))
		.sort((a, b) => Number(asNumber(a.createdAtTick) - asNumber(b.createdAtTick)))
		.at(-1);
	if (failure) {
		return {
			kind: "rejection",
			text: playerFacingFailure(asString(failure.failureKind), asString(failure.failureDetail)),
		};
	}
	const event = eventRows
		.filter((row) => asString(row.summary).length > 0)
		.sort((a, b) => Number(asNumber(a.tick) - asNumber(b.tick) || asNumber(a.id) - asNumber(b.id)))
		.at(-1);
	if (event) return { kind: "event", text: asString(event.summary) };
	return { kind: "none", text: "No combat outcome observed yet." };
}

function failureStatus(status: unknown): boolean {
	const normalized = tagString(status).toLowerCase();
	return normalized === "failed" || normalized === "failure" || normalized === "rolledback";
}

function playerFacingFailure(kind: string, detail: string): string {
	if (kind === "not_your_turn") return detail || "It is not your turn.";
	if (kind.length > 0 && detail.length > 0) return `${kind}: ${detail}`;
	return detail || kind || "Action rejected.";
}
