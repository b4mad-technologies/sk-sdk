import { CAN_I_PARAMS, CAN_I_TOOL } from "@spellkave/tool-contracts/schemas";
import type { Static } from "typebox";

import type { AuthorToolContext, AuthorToolResult } from "./authoring";
import { defineTool } from "./tool-registry";

export interface CanICheck {
	label: string;
	result: "passed" | "refused" | "errored" | "not_run" | "not_reached";
}

export interface CanIVerdict {
	admitted: boolean;
	checks: CanICheck[];
	refusing_check: string;
	failure_kind: string;
	errored_check: string;
	template_id: string;
	niche_id: string;
	draws: number[];
	repeat_may_differ: boolean;
	disclosed: boolean;
}

export type CanIProbeAnswer =
	| { kind: "refused_caller" }
	| { kind: "verdict"; verdict: CanIVerdict };

export interface CanITarget {
	kind: "entity" | "place_node" | "place_edge" | "location" | "world";
	id?: string;
}

export interface CanIPort {
	resolveAuthoredEntity(key: string): Promise<string | null>;
	probe(input: {
		actorId: string;
		target: CanITarget;
		actionId: string;
		args: Record<string, unknown>;
	}): Promise<CanIProbeAnswer>;
}

export interface CanIResult {
	ok: boolean;
	answer?: "admitted" | "refused" | "errored";
	admitted?: boolean;
	checks?: CanICheck[];
	refusing_check?: string;
	failure_kind?: string;
	errored_check?: string;
	template_id?: string;
	niche_id?: string;
	draws?: number[];
	repeat_may_differ?: boolean;
	disclosed?: boolean;
	note?: string;
	expected?: string;
	actual?: string;
	cause?: string;
	key?: string;
}

const NO_WORLD =
	"no reachable world. Start one with `sk dev up` or select one with `sk config use-context`.";

export function disagreementNote(admitted: boolean, disclosed: boolean): string | undefined {
	if (admitted === disclosed) return undefined;
	return `admitted is ${admitted} and disclosed is ${disclosed}; neither is a fault.`;
}

export function renderCanIHuman(result: CanIResult): string {
	const lines: string[] = [];
	if (result.answer !== undefined) lines.push(result.answer);
	if (result.note !== undefined) lines.push(result.note);
	if (result.expected !== undefined) {
		lines.push(`expected ${result.expected}, actual ${result.actual}`);
	}
	if (result.cause !== undefined) lines.push(result.cause);
	if (result.errored_check !== undefined) lines.push(`${result.errored_check} errored`);
	for (const check of result.checks ?? []) lines.push(`${check.label} ${check.result}`);
	return lines.join("\n");
}

function answerOf(verdict: CanIVerdict): "admitted" | "refused" | "errored" {
	if (verdict.errored_check !== "") return "errored";
	return verdict.admitted ? "admitted" : "refused";
}

export function resultFromProbe(
	probe: CanIProbeAnswer,
	expect: "admitted" | "refused" | undefined,
): CanIResult {
	if (probe.kind === "refused_caller") {
		return {
			ok: false,
			cause: "caller lacks frontier.apply_manifest",
		};
	}
	const verdict = probe.verdict;
	const answer = answerOf(verdict);
	const notes = [disagreementNote(verdict.admitted, verdict.disclosed)];
	if (
		verdict.refusing_check === "declared_participants" &&
		verdict.failure_kind === "stale_participant_context"
	) {
		notes.push(
			"Supply either fresh expected_participants or a fresh participant_context in args, matching the intended body and equipment. can-i probes literal arguments; PLAYER tools can compose a disclosed context.",
		);
	}
	const note = notes.filter((value) => value !== undefined).join(" ") || undefined;
	const base: CanIResult = {
		ok: true,
		answer,
		admitted: verdict.admitted,
		checks: verdict.checks,
		disclosed: verdict.disclosed,
		...(verdict.refusing_check === "" ? {} : { refusing_check: verdict.refusing_check }),
		...(verdict.failure_kind === "" ? {} : { failure_kind: verdict.failure_kind }),
		...(verdict.errored_check === "" ? {} : { errored_check: verdict.errored_check }),
		...(verdict.template_id === "" ? {} : { template_id: verdict.template_id }),
		...(verdict.niche_id === "" ? {} : { niche_id: verdict.niche_id }),
		...(verdict.draws.length === 0 ? {} : { draws: verdict.draws }),
		...(verdict.repeat_may_differ ? { repeat_may_differ: true } : {}),
		...(note === undefined ? {} : { note }),
	};
	if (expect !== undefined && expect !== answer) {
		return { ...base, ok: false, expected: expect, actual: answer };
	}
	return base;
}

function isEntityId(value: string): boolean {
	return /^[0-9]+$/.test(value);
}

async function resolveBody(port: CanIPort, as: string): Promise<string> {
	if (isEntityId(as)) return as;
	const id = await port.resolveAuthoredEntity(as);
	if (id === null) {
		throw Object.assign(new Error(`authored entity '${as}' is not in this world`), {
			canI: { ok: false, key: as, cause: "unknown authored entity" },
		});
	}
	return id;
}

async function resolveTarget(port: CanIPort, target: unknown): Promise<CanITarget> {
	if (typeof target === "object" && target !== null && "kind" in target) {
		return target as CanITarget;
	}
	const text = String(target);
	if (text === "world") return { kind: "world" };
	if (isEntityId(text)) return { kind: "entity", id: text };
	const id = await port.resolveAuthoredEntity(text);
	if (id === null) {
		throw Object.assign(new Error(`authored entity '${text}' is not in this world`), {
			canI: { ok: false, key: text, cause: "unknown authored entity" },
		});
	}
	return { kind: "entity", id };
}

export const canIToolDef = defineTool<AuthorToolContext, typeof CAN_I_PARAMS, CanIResult, never>({
	contract: CAN_I_TOOL,
	schema: CAN_I_PARAMS,
	exampleParams: {
		action: "core/cast_mark",
		as: "core/hero",
		target: "core/mark",
	},
	run: async (context, params: Static<typeof CAN_I_PARAMS>) => {
		const port = context.canI;
		if (port === undefined) throw new Error(NO_WORLD);
		try {
			const actorId = await resolveBody(port, params.as);
			const target = await resolveTarget(port, params.target);
			const probe = await port.probe({
				actorId,
				target,
				actionId: params.action,
				args: params.args ?? {},
			});
			const details = resultFromProbe(probe, params.expect);
			const text = renderCanIHuman(details);
			return {
				content: [{ type: "text", text }],
				details,
			} satisfies AuthorToolResult<CanIResult>;
		} catch (err) {
			const tagged = err as { canI?: CanIResult };
			if (tagged.canI !== undefined) {
				return {
					content: [{ type: "text", text: renderCanIHuman(tagged.canI) }],
					details: tagged.canI,
				};
			}
			throw err;
		}
	},
});
