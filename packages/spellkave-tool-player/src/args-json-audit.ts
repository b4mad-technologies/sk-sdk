// sk-jay0.1.46 (run 3): a caller's `args_json` key the wire parser does not
// read is dropped before the reducer sees it, and the receipt said
// "accepted". The measured player sent `{"name": "Brannoc"}` on
// `dm/creation/input/name` twice and learned only from Aldwin's next line
// that the name was empty. This audit runs on the caller's raw blob before
// dispatch and names the ignored keys on the receipt, beside a hint that
// spoken or typed text travels as `spellkave_communicate`'s `utterance`.
// Malformed JSON is reported as such (the manipulate composer already
// rejects it as `malformed_args`; `spellkave_communicate` had swallowed it).
import { MANIPULATION_ARGS_WIRE_KEYS } from "@spellkave/sdk";

export type ArgsJsonAudit =
	| { status: "malformed"; reason: string }
	| { status: "ok"; ignored_keys: string[] };

const WIRE_KEYS = new Set(MANIPULATION_ARGS_WIRE_KEYS);

export function auditArgsJson(argsJson: string | undefined): ArgsJsonAudit {
	if (argsJson === undefined || argsJson.trim() === "") return { status: "ok", ignored_keys: [] };
	let parsed: unknown;
	try {
		parsed = JSON.parse(argsJson);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { status: "malformed", reason: `args_json is not valid JSON: ${message}` };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { status: "malformed", reason: "args_json must be a JSON object" };
	}
	return {
		status: "ok",
		ignored_keys: Object.keys(parsed).filter((key) => !WIRE_KEYS.has(key)),
	};
}

/** One sentence for a receipt whose args_json carried keys the world does not read. */
export function ignoredArgsHint(ignoredKeys: readonly string[]): string {
	return (
		`args_json keys ${JSON.stringify(ignoredKeys)} are not read by the world and were dropped before dispatch. ` +
		"Text an NPC should hear (a name, an answer) goes through spellkave_communicate's utterance, not an args_json field; " +
		`the keys the world reads are ${JSON.stringify(MANIPULATION_ARGS_WIRE_KEYS.filter((key) => key === key.toLowerCase()))}.`
	);
}
