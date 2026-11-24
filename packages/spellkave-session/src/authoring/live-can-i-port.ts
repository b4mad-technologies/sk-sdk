import { manipulationArgsFromJson } from "@spellkave/sdk";
import type { CanIPort, CanIProbeAnswer, CanITarget } from "@spellkave/tool-authoring";

type Tagged = { tag: string; value?: unknown };

function asTagged(value: unknown): Tagged {
	if (typeof value === "object" && value !== null && "tag" in value) {
		return value as Tagged;
	}
	throw new Error("probe returned a value this client does not understand");
}

function checkResult(
	tag: string,
): CanIProbeAnswer extends never
	? never
	: "passed" | "refused" | "errored" | "not_run" | "not_reached" {
	switch (tag) {
		case "Passed":
			return "passed";
		case "Refused":
			return "refused";
		case "Errored":
			return "errored";
		case "NotRun":
			return "not_run";
		default:
			return "not_reached";
	}
}

export function mapProcedureResult(raw: unknown): CanIProbeAnswer {
	const tagged = asTagged(raw);
	if (tagged.tag === "RefusedCaller") return { kind: "refused_caller" };
	if (tagged.tag === "Errored") {
		return {
			kind: "verdict",
			verdict: {
				admitted: false,
				checks: [],
				refusing_check: "",
				failure_kind: "",
				errored_check: String(tagged.value ?? ""),
				template_id: "",
				niche_id: "",
				draws: [],
				repeat_may_differ: false,
				disclosed: false,
			},
		};
	}
	const verdict = tagged.value as {
		admitted: boolean;
		checks: Array<{ label: string; result: Tagged }>;
		refusingCheck: string;
		failureKind: string;
		templateId: string;
		nicheId: string;
		draws: Array<{ value: bigint | number }>;
		repeatMayDiffer: boolean;
		disclosed: boolean;
	};
	return {
		kind: "verdict",
		verdict: {
			admitted: verdict.admitted,
			checks: verdict.checks.map((check) => ({
				label: check.label,
				result: checkResult(check.result.tag),
			})),
			refusing_check: verdict.refusingCheck,
			failure_kind: verdict.failureKind,
			errored_check: "",
			template_id: verdict.templateId,
			niche_id: verdict.nicheId,
			draws: verdict.draws.map((draw) => Number(draw.value)),
			repeat_may_differ: verdict.repeatMayDiffer,
			disclosed: verdict.disclosed,
		},
	};
}

function targetRef(target: CanITarget): { tag: string; value?: unknown } {
	if (target.kind === "world") return { tag: "World" };
	if (target.kind === "place_node") return { tag: "PlaceNode", value: target.id ?? "" };
	if (target.kind === "place_edge") return { tag: "PlaceEdge", value: BigInt(target.id ?? "0") };
	if (target.kind === "location") return { tag: "Location", value: target.id ?? "" };
	return { tag: "Entity", value: BigInt(target.id ?? "0") };
}

export function createLiveCanIPort(session: {
	conn: {
		procedures: {
			probeManipulate: (args: {
				actorId: bigint;
				targetRef: { tag: string; value?: unknown };
				actionId: string;
				args: Record<string, unknown>;
			}) => Promise<unknown>;
		};
	};
	db: () => {
		visible_manifest_authored_entity_coverage?: {
			iter: () => Iterable<{ status: string; projectionVersion: number }>;
		};
		visibleManifestAuthoredEntityCoverage?: {
			iter: () => Iterable<{ status: string; projectionVersion: number }>;
		};
		visible_manifest_authored_entity?: {
			iter: () => Iterable<{ manifestKey: string; entityId: bigint }>;
		};
		visibleManifestAuthoredEntity?: {
			iter: () => Iterable<{ manifestKey: string; entityId: bigint }>;
		};
	};
	resolveAuthoredEntity?: (key: string) => Promise<string | null>;
}): CanIPort {
	return {
		async resolveAuthoredEntity(key) {
			if (session.resolveAuthoredEntity !== undefined) return session.resolveAuthoredEntity(key);
			const db = session.db();
			const handle = db.visibleManifestAuthoredEntity ?? db.visible_manifest_authored_entity;
			const coverage = [
				...((
					db.visibleManifestAuthoredEntityCoverage ?? db.visible_manifest_authored_entity_coverage
				)?.iter() ?? []),
			];
			if (
				handle === undefined ||
				coverage.length !== 1 ||
				coverage[0]?.status !== "complete" ||
				coverage[0]?.projectionVersion !== 1
			)
				throw new Error("reader_unavailable: authored mapping coverage missing or incomplete");
			for (const row of handle.iter()) {
				if (row.manifestKey === key || row.manifestKey.endsWith(`:${key}`)) {
					return row.entityId.toString();
				}
			}
			return null;
		},
		async probe(input) {
			const raw = await session.conn.procedures.probeManipulate({
				actorId: BigInt(input.actorId),
				targetRef: targetRef(input.target),
				actionId: input.actionId,
				args: manipulationArgsFromJson(JSON.stringify(input.args)),
			});
			return mapProcedureResult(raw);
		},
	};
}
