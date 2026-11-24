/**
 * Closed player-facing classification of one PLAYER act-tool envelope.
 *
 * A reader, not a sniffer: discriminators are modelled fields
 * (`receipt.outcome`, `observation === null` + `observation_gap`,
 * `conversation.response.text`). The default arm is `undescribable`.
 * Quiet cannot be the default. See
 * `ledger/designs/play-act-result-vocabulary.md`.
 */

export type ActPlayerResult =
	| {
			kind: "rejected";
			admission: "rejected" | "unobserved" | "not_offered" | "in_flight";
			player_message: string | null;
			reason: string | null;
	  }
	| {
			kind: "happened";
			observation: string | null;
			spoken_by_player: string | null;
			reply: { speaker_name: string | null; text: string } | null;
			awaiting_response: boolean;
			resolution_message: string | null;
	  }
	| { kind: "quiet"; gap: string }
	| { kind: "undescribable"; keys: string[] };

const PREDISPATCH = new Set([
	"unknown_handle",
	"ambiguous_handle",
	"invalid_sensing_descriptor",
	"unsupported_verb_class",
	"move_in_flight",
]);

const VERB_KEYS = ["manipulate", "communicate", "sense"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownKeys(value: unknown): string[] {
	return isRecord(value) ? Object.keys(value).sort() : [];
}

function unwrapDetails(input: unknown): unknown {
	if (isRecord(input) && "details" in input) return input.details;
	return input;
}

function nonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() !== "" ? value : null;
}

function nestedVerb(receipt: Record<string, unknown>): Record<string, unknown> | null {
	for (const key of VERB_KEYS) {
		const inner = receipt[key];
		if (isRecord(inner)) return inner;
	}
	return null;
}

function readReply(
	conversation: Record<string, unknown> | null,
): { speaker_name: string | null; text: string } | null {
	if (conversation === null || !isRecord(conversation.response)) return null;
	const text = nonEmptyString(conversation.response.text);
	if (text === null) return null;
	const name = nonEmptyString(conversation.response.speaker_name);
	return { speaker_name: name, text };
}

function happenedFields(details: Record<string, unknown>, receipt: Record<string, unknown>) {
	const conversation = isRecord(details.conversation) ? details.conversation : null;
	const spoken = conversation === null ? null : nonEmptyString(conversation.spoken_by_player);
	const verb = nestedVerb(receipt);
	return {
		observation: nonEmptyString(details.observation),
		spoken_by_player: spoken,
		reply: readReply(conversation),
		awaiting_response: conversation?.awaiting_response === true,
		resolution_message: verb === null ? null : nonEmptyString(verb.player_message),
	};
}

export function classifyActResult(input: unknown): ActPlayerResult {
	const details = unwrapDetails(input);
	if (!isRecord(details)) return { kind: "undescribable", keys: [] };

	const receipt = details.receipt;
	if (isRecord(receipt) && receipt.status === "dispatched") {
		const outcome = receipt.outcome;
		if (outcome === "rejected" || outcome === "unobserved") {
			const verb = nestedVerb(receipt);
			return {
				kind: "rejected",
				admission: outcome,
				player_message: verb === null ? null : nonEmptyString(verb.player_message),
				reason: verb === null ? nonEmptyString(details.reason) : nonEmptyString(verb.reason),
			};
		}
		if (outcome === "travelling") {
			return { kind: "happened", ...happenedFields(details, receipt) };
		}
		if (outcome === "accepted") {
			const fields = happenedFields(details, receipt);
			if (
				fields.reply !== null ||
				fields.observation !== null ||
				fields.resolution_message !== null
			) {
				return { kind: "happened", ...fields };
			}
			const gap = nonEmptyString(details.observation_gap);
			if (details.observation === null && gap !== null) {
				return { kind: "quiet", gap };
			}
			return { kind: "undescribable", keys: ownKeys(details) };
		}
		return { kind: "undescribable", keys: ownKeys(details) };
	}

	if (typeof details.status === "string" && PREDISPATCH.has(details.status)) {
		return {
			kind: "rejected",
			admission: details.status === "move_in_flight" ? "in_flight" : "not_offered",
			player_message: null,
			reason: nonEmptyString(details.reason),
		};
	}

	return { kind: "undescribable", keys: ownKeys(details) };
}

export function renderActResultLine(result: ActPlayerResult): string {
	switch (result.kind) {
		case "rejected":
			if (result.player_message !== null) return result.player_message;
			if (
				(result.admission === "not_offered" || result.admission === "in_flight") &&
				result.reason !== null
			) {
				return result.reason;
			}
			return "The world refused.";
		case "happened":
			if (result.reply !== null) {
				const who = result.reply.speaker_name ?? "Someone";
				return `${who} says: "${result.reply.text}"`;
			}
			// The observation says what the actor DID (the authored outcome
			// prose); the resolution message says how a stochastic act CAME OUT.
			// A client that printed only the first could not tell a success
			// from a failure (seen live, sk-jay0.1.8.63.40). Both are the
			// world's own words, printed as opaque prose, in that order.
			if (result.observation !== null) {
				return result.resolution_message === null ||
					result.observation.includes(result.resolution_message)
					? result.observation
					: `${result.observation} ${result.resolution_message}`;
			}
			if (result.resolution_message !== null) return result.resolution_message;
			if (result.awaiting_response) return "You spoke. No reply yet.";
			if (result.spoken_by_player !== null) return result.spoken_by_player;
			return "The world answered, but this client cannot render it.";
		case "quiet":
			return "Nothing you notice changes.";
		case "undescribable":
			return "The world answered, but this client cannot render it.";
	}
}
