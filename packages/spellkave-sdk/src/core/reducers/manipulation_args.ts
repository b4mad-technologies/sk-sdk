import type { FrameItemDestinationArg, FrameSpatialRefArg, ManipulationArgsArg } from "./transport";

/** Every `args_json` key this parser reads (both spellings). A key outside
 * this list never reaches the reducer; PLAYER tools use it to tell a caller
 * which of its keys the world will not read (sk-jay0.1.46: `{"name": ...}`
 * on a creation action was accepted and silently ignored). */
export const MANIPULATION_ARGS_WIRE_KEYS: readonly string[] = [
	"selectedItems",
	"selected_items",
	"quantity",
	"destination",
	"stationRef",
	"station_ref",
	"buildTarget",
	"build_target",
	"requiredAbsentStateIds",
	"required_absent_state_ids",
	"dispatchText",
	"dispatch_text",
	"expectedParticipants",
	"expected_participants",
	"participantContext",
	"participant_context",
	"semanticContext",
	"semantic_context",
	"definitionRef",
	"definition_ref",
	"participantEntityIds",
	"participant_entity_ids",
	"privateInputRef",
	"private_input_ref",
	"dispatchOptions",
	"dispatch_options",
	"dispatchOptionRefs",
	"dispatch_option_refs",
	"dispatchContext",
	"dispatch_context",
];

export function manipulationArgsFromJson(argsJson: string): ManipulationArgsArg {
	const raw = parseObject(argsJson);
	return {
		selectedItems: arrayField(raw, "selectedItems", "selected_items").map(selectedItemFromUnknown),
		quantity: optionalNumber(raw, "quantity"),
		destination: optionalDestination(raw),
		stationRef: optionalString(raw, "stationRef", "station_ref"),
		buildTarget: optionalSpatialRef(raw, "buildTarget", "build_target"),
		requiredAbsentStateIds: arrayField(
			raw,
			"requiredAbsentStateIds",
			"required_absent_state_ids",
		).map((item) => String(item)),
		dispatchText: optionalString(raw, "dispatchText", "dispatch_text"),
		expectedParticipants: optionalParticipants(raw),
		participantContext: optionalString(raw, "participantContext", "participant_context"),
		semanticContext: optionalSemanticContext(raw),
		definitionRef: optionalString(raw, "definitionRef", "definition_ref"),
		participantEntityIds: optionalArray(
			raw,
			"participantEntityIds",
			"participant_entity_ids",
			enrollmentIdFromUnknown,
		),
		privateInputRef: optionalString(raw, "privateInputRef", "private_input_ref"),
		dispatchOptions: optionalArray(raw, "dispatchOptions", "dispatch_options", String),
		dispatchOptionRefs: optionalArray(
			raw,
			"dispatchOptionRefs",
			"dispatch_option_refs",
			(value) => {
				if (value === null || value === undefined) return undefined;
				if (typeof value !== "string")
					throw new Error("dispatch_option_refs must contain definition refs or null");
				return value;
			},
		),
		dispatchContext: optionalString(raw, "dispatchContext", "dispatch_context"),
	} as ManipulationArgsArg;
}

export function emptyManipulationArgs(): ManipulationArgsArg {
	return manipulationArgsFromJson("{}");
}

function parseObject(json: string): Record<string, unknown> {
	const parsed = JSON.parse(json.length === 0 ? "{}" : json) as unknown;
	if (!isRecord(parsed)) throw new Error("manipulation args must be a JSON object");
	return parsed;
}

function selectedItemFromUnknown(value: unknown): ManipulationArgsArg["selectedItems"][number] {
	if (!isRecord(value)) throw new Error("selectedItems entries must be objects");
	return {
		binding: String(value.binding ?? ""),
		itemId: u64FromUnknown(value.itemId ?? value.item_id ?? 0),
		quantity: Number(value.quantity ?? 1),
		itemDefId: optionalString(value, "itemDefId", "item_def_id"),
	};
}

function optionalDestination(raw: Record<string, unknown>): FrameItemDestinationArg | undefined {
	const value = raw.destination;
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string")
		return { tag: "ObjectContainer", value } as FrameItemDestinationArg;
	if (!isRecord(value)) throw new Error("destination must be a string or object");
	const tag = String(value.tag ?? value.kind ?? "");
	const payload = value.value ?? value.id ?? "";
	switch (tag) {
		case "ActorInventory":
		case "actor_inventory":
			return { tag: "ActorInventory", value: String(payload) } as FrameItemDestinationArg;
		case "Ground":
		case "ground":
			return { tag: "Ground", value: spatialRefFromUnknown(payload) } as FrameItemDestinationArg;
		case "ObjectContainer":
		case "object_container":
			return { tag: "ObjectContainer", value: String(payload) } as FrameItemDestinationArg;
		case "MachinePort":
		case "machine_port":
			return { tag: "MachinePort", value: String(payload) } as FrameItemDestinationArg;
		default:
			throw new Error(`unsupported destination '${tag}'`);
	}
}

function optionalSpatialRef(
	raw: Record<string, unknown>,
	camelKey: string,
	snakeKey: string,
): FrameSpatialRefArg | undefined {
	const value = raw[camelKey] ?? raw[snakeKey];
	if (value === undefined || value === null) return undefined;
	return spatialRefFromUnknown(value);
}

function spatialRefFromUnknown(value: unknown): FrameSpatialRefArg {
	if (!isRecord(value)) throw new Error("spatial ref must be an object");
	return { kind: String(value.kind ?? ""), id: String(value.id ?? "") } as FrameSpatialRefArg;
}

function optionalString(
	raw: Record<string, unknown>,
	camelKey: string,
	snakeKey: string,
): string | undefined {
	const value = raw[camelKey] ?? raw[snakeKey];
	return value === undefined || value === null ? undefined : String(value);
}

function optionalParticipants(
	raw: Record<string, unknown>,
): ManipulationArgsArg["expectedParticipants"] {
	const value = raw.expectedParticipants ?? raw.expected_participants;
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new Error("expected_participants must be an array");
	return value.map((item) => {
		if (!isRecord(item)) throw new Error("expected_participants entries must be objects");
		return {
			roleId: String(item.roleId ?? item.role_id ?? ""),
			entityId: u64FromUnknown(item.entityId ?? item.entity_id ?? 0),
		};
	});
}

/** ADR-0142 D-3 wire shape: `{"semantic_context": {"source_ref": "entity:<id>",
 * "occurrence_id": <u64 or its decimal string form>}}`. Without this, a
 * caller's `semantic_context` was silently dropped before ever reaching the
 * `rManipulate` reducer call (`r_manipulate.ts`), which reads its args only
 * from this function's return value — the server's prompt-gate (D-3) would
 * see no `semantic_context` at all and reject every prompt-bound response as
 * `prompt_context_required`. */
function optionalSemanticContext(
	raw: Record<string, unknown>,
): ManipulationArgsArg["semanticContext"] {
	const value = raw.semanticContext ?? raw.semantic_context;
	if (value === undefined || value === null) return undefined;
	if (!isRecord(value)) throw new Error("semantic_context must be an object");
	const sourceRef = value.sourceRef ?? value.source_ref;
	const occurrenceId = value.occurrenceId ?? value.occurrence_id;
	if (sourceRef === undefined || sourceRef === null) {
		throw new Error("semantic_context requires source_ref");
	}
	if (occurrenceId === undefined || occurrenceId === null) {
		throw new Error("semantic_context requires occurrence_id");
	}
	return {
		sourceRef: String(sourceRef),
		occurrenceId: u64FromUnknown(occurrenceId),
	};
}

function optionalNumber(raw: Record<string, unknown>, key: string): number | undefined {
	const value = raw[key];
	return value === undefined || value === null ? undefined : Number(value);
}

function arrayField(raw: Record<string, unknown>, camelKey: string, snakeKey: string): unknown[] {
	const value = raw[camelKey] ?? raw[snakeKey] ?? [];
	if (!Array.isArray(value)) throw new Error(`${camelKey} must be an array`);
	return value;
}

function u64FromUnknown(value: unknown): bigint {
	return typeof value === "bigint" ? value : BigInt(String(value));
}

function enrollmentIdFromUnknown(value: unknown): bigint {
	if (typeof value === "number" && !Number.isSafeInteger(value))
		throw new Error("participant_entity_ids requires safe integers or decimal strings");
	if (
		!(
			typeof value === "number" ||
			typeof value === "bigint" ||
			(typeof value === "string" && /^[0-9]+$/.test(value))
		)
	)
		throw new Error("participant_entity_ids requires integer ids");
	const id = u64FromUnknown(value);
	if (id <= 0n || id > 18446744073709551615n)
		throw new Error("participant_entity_ids requires nonzero u64 ids");
	return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalArray<T>(
	raw: Record<string, unknown>,
	camel: string,
	snake: string,
	convert: (value: unknown) => T,
): T[] | undefined {
	const value = raw[camel] ?? raw[snake];
	if (value === undefined || value === null) return undefined;
	if (!Array.isArray(value)) throw new Error(`${snake} must be an array`);
	return value.map(convert);
}
