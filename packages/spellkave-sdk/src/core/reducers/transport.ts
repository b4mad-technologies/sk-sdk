import type { DbConnection } from "@spellkave/bindings";

export type ReducerActorId = bigint;
export type RManipulateParams = Parameters<DbConnection["reducers"]["rManipulate"]>[0];
export type TargetRefArg = RManipulateParams["targetRef"];
export type ManipulationArgsArg = RManipulateParams["args"];
export type FrameItemDestinationArg = NonNullable<ManipulationArgsArg["destination"]>;
export type FrameSpatialRefArg = NonNullable<ManipulationArgsArg["buildTarget"]>;

export function actorEntityId(value: string | bigint): ReducerActorId {
	if (typeof value === "bigint") return value;
	return BigInt(stripEntityPrefix(value));
}

export function targetRefFromString(value: string): TargetRefArg {
	const trimmed = value.trim();
	if (trimmed === "world") return { tag: "World" } as TargetRefArg;
	const [kind, rawId] = splitRef(trimmed, "entity");
	switch (kind) {
		case "entity":
			return { tag: "Entity", value: BigInt(rawId) } as TargetRefArg;
		case "item":
			return { tag: "Item", value: BigInt(rawId) } as TargetRefArg;
		case "place_node":
			return { tag: "PlaceNode", value: rawId } as TargetRefArg;
		case "place_node_set": {
			const [originPlaceNodeId, rangeRaw, ...templateParts] = rawId.split(":");
			if (!originPlaceNodeId || !rangeRaw || templateParts.length === 0) {
				throw new Error(`unsupported target ref '${value}'`);
			}
			return {
				tag: "PlaceNodeSet",
				value: {
					originPlaceNodeId,
					rangeMillimeters: Number(rangeRaw),
					affordanceTemplateId: templateParts.join(":"),
				},
			} as TargetRefArg;
		}
		case "place_edge":
			return { tag: "PlaceEdge", value: BigInt(rawId) } as TargetRefArg;
		case "location":
			return { tag: "Location", value: rawId } as TargetRefArg;
		default:
			throw new Error(`unsupported target ref '${value}'`);
	}
}

/**
 * Inverse of `targetRefFromString`: serialize a typed `TargetRef` (e.g. the
 * `affordance.target_ref` column — the source of truth for target kind,
 * ADR-0033 D1) into the canonical string the reducer transport accepts.
 * Round-trip: `targetRefFromString(targetRefToString(ref))` is identity.
 */
export function targetRefToString(ref: TargetRefArg): string {
	switch (ref.tag) {
		case "Entity":
			return `entity:${ref.value}`;
		case "Item":
			return `item:${ref.value}`;
		case "PlaceNode":
			return `place_node:${ref.value}`;
		case "PlaceNodeSet":
			return `place_node_set:${ref.value.originPlaceNodeId}:${ref.value.rangeMillimeters}:${ref.value.affordanceTemplateId}`;
		case "PlaceEdge":
			return `place_edge:${ref.value}`;
		case "Location":
			return `location:${ref.value}`;
		case "World":
			return "world";
		default:
			throw new Error(`unsupported target ref tag '${(ref as { tag: string }).tag}'`);
	}
}

function stripEntityPrefix(value: string): string {
	return value.startsWith("entity:") ? value.slice("entity:".length) : value;
}

function splitRef(value: string, defaultKind: string): [string, string] {
	const index = value.indexOf(":");
	if (index < 0) return [defaultKind, value];
	return [value.slice(0, index), value.slice(index + 1)];
}
