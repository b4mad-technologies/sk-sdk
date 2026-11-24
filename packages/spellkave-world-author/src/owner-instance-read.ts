/**
 * Publisher owner-cache projector for `spellkave_get` / `spellkave_describe`.
 * Wiring-only `snapshot` / `worldTick` — no `db` on the returned port.
 * D-11 types live in `@spellkave/tool-contracts`; this module is the factory.
 */
import {
	AUTHORED_ENTITIES_ONLY,
	type OwnerDescribeAnswer,
	type OwnerGetAnswer,
	type OwnerInstanceRead,
} from "@spellkave/tool-contracts";
import { ROW_KIND_NATURAL_KEY, ROW_KIND_STORAGE_KEY } from "@spellkave/world-author/tooling";
import { INSTANCE_ROW_KINDS, type InstanceRowKind } from "./filter-manifest-core";

export {
	AUTHORED_ENTITIES_ONLY,
	type OwnerDescribeAnswer,
	type OwnerDescribeInput,
	type OwnerGetAnswer,
	type OwnerGetInput,
	type OwnerInstanceRead,
} from "@spellkave/tool-contracts";

export type OwnerSnapshotHandle = { iter(): Iterable<Record<string, unknown>> };
export type OwnerSnapshot = {
	[table: string]: OwnerSnapshotHandle | undefined;
};

const DEFAULT_LIMIT = 50;
const LABELS = [AUTHORED_ENTITIES_ONLY] as const;

/** D-4: natural key if defined, else storage-key fields in schema order. */
export function instanceKeyFields(kind: string): readonly string[] {
	const natural = ROW_KIND_NATURAL_KEY[kind];
	if (natural) return [natural];
	return ROW_KIND_STORAGE_KEY[kind] ?? [];
}

function rowMatchesCallerKey(
	row: Record<string, unknown>,
	kind: string,
	callerKey: string,
): boolean {
	const fields = instanceKeyFields(kind);
	if (fields.length === 0) return false;
	const parts = callerKey.split("::");
	if (parts.length !== fields.length) return false;
	return fields.every((field, i) => String(row[field] ?? "") === parts[i]);
}

function rowMatchesPattern(row: Record<string, unknown>, kind: string, pattern: string): boolean {
	return instanceKeyFields(kind).some((field) => String(row[field] ?? "").includes(pattern));
}

export function createOwnerInstanceRead(args: {
	snapshot: () => OwnerSnapshot;
	worldTick: () => bigint;
	readsAsPublisher: boolean;
}): OwnerInstanceRead {
	if (!args.readsAsPublisher)
		return {
			get: () => ({ ok: false, code: "not_publisher", message: "reads_as_publisher is false" }),
			describe: () => ({
				ok: false,
				code: "not_publisher",
				message: "reads_as_publisher is false",
			}),
		};
	return createInstanceProjector({
		...args,
		snapshot: () => {
			const snapshot = args.snapshot();
			const mapping =
				snapshot.operator_manifest_authored_entity ?? snapshot.operatorManifestAuthoredEntity;
			if (!mapping) throw new Error("reader_unavailable: publisher authored mapping view missing");
			return { ...snapshot, visible_manifest_authored_entity: mapping };
		},
	});
}

/** Pure projector over a detached admitted snapshot; admission belongs to the source. */
export function createInstanceProjector(args: {
	snapshot: () => OwnerSnapshot;
	worldTick: () => bigint;
}): OwnerInstanceRead {
	return {
		get(input) {
			if (!INSTANCE_ROW_KINDS.includes(input.kind as InstanceRowKind)) {
				return {
					ok: false,
					code: "usage",
					message: `kind '${input.kind}' is not read from a world by this tool; use sk query --target live`,
				};
			}
			const snap = args.snapshot();
			const tick = String(args.worldTick());
			const mae = loadMae(snap);
			const resolved = resolveBundle(mae, input.kind, input.key, input.bundle);
			if (resolved.ok === false) return resolved;
			if (input.key !== undefined && input.key !== "") {
				const collision = collidingAuthoredSelector(mae, input.key, resolved.bundle);
				if (collision) return collision;
			}
			const cap = boundedLimit(input.limit);
			if (cap.ok === false) return cap;
			const projected = projectKind(snap, mae, input.kind as InstanceRowKind, resolved.bundle);
			if (input.key !== undefined && input.key !== "") {
				const row = projected.find((r) => rowMatchesCallerKey(r, input.kind, input.key ?? ""));
				if (!row) {
					return {
						ok: false,
						code: "unknown_key",
						message: `no authored ${input.kind} row for key ${input.key}`,
					};
				}
				return {
					ok: true,
					kind: input.kind,
					bundle: resolved.bundle,
					tick,
					labels: LABELS,
					row, // D-6: keyed get is the whole row; `fields` applies to listings only
				};
			}
			let rows = projected;
			if (input.pattern) {
				rows = rows.filter((r) => rowMatchesPattern(r, input.kind, input.pattern ?? ""));
			}
			const limit = cap.limit;
			const match_count = rows.length;
			const sliced = rows.slice(0, limit).map((row) => pickFields(row, input.kind, input.fields));
			return {
				ok: true,
				kind: input.kind,
				bundle: resolved.bundle,
				tick,
				labels: LABELS,
				rows: sliced,
				match_count,
				left_out: Math.max(0, match_count - sliced.length),
			};
		},
		describe(input) {
			if (input.kind !== "entities") {
				return {
					ok: false,
					code: "usage",
					message: "describe is defined for entities; use sk get",
				};
			}
			const snap = args.snapshot();
			const tick = String(args.worldTick());
			const mae = loadMae(snap);
			const byId = maeById(mae);
			const subject = resolveSubject(mae, byId, input.key, input.bundle);
			if (subject.ok === false) return subject;
			const cap = boundedLimit(input.limit);
			if (cap.ok === false) return cap;
			const entityRow = projectKind(snap, mae, "entities", subject.bundle).find(
				(r) => String(r.numeric_id) === subject.numeric_id,
			);
			if (!entityRow) {
				return {
					ok: false,
					code: "unknown_key",
					message: `no authored entities row for ${input.key}`,
				};
			}
			const place = ownPlace(snap, subject.numeric_id);
			const { chain, chain_end } = upwardContainment(snap, mae, byId, subject.numeric_id);
			const allBelonging = downwardBelonging(snap, mae, byId, subject.numeric_id);
			const belonging = allBelonging.slice(0, cap.limit);
			const slices: Partial<Record<InstanceRowKind, Record<string, unknown>[]>> = {};
			for (const kind of INSTANCE_ROW_KINDS) {
				const rows = projectKind(snap, mae, kind, undefined).filter((r) =>
					sliceNamesSubject(kind, r, subject.numeric_id),
				);
				if (rows.length > 0) slices[kind] = rows;
			}
			return {
				ok: true,
				kind: "entities",
				bundle: subject.bundle,
				tick,
				labels: LABELS,
				row: entityRow,
				slices,
				numeric_id: subject.numeric_id,
				place: place ?? chain.at(-1)?.place,
				container_chain: chain,
				chain_end,
				belonging,
				match_count: allBelonging.length,
				left_out: Math.max(0, allBelonging.length - belonging.length),
			};
		},
	};
}

type MaeRow = { manifestKey: string; bundleId: string; entityId: string; entityKey: string };

function loadMae(snap: OwnerSnapshot): MaeRow[] {
	return iter(snap, "visible_manifest_authored_entity").map((raw) => {
		const bundleId = String(raw.bundleId ?? raw.bundle_id ?? "");
		const manifestKey = String(raw.manifestKey ?? raw.manifest_key ?? "");
		const prefix = `${bundleId}:`;
		const entityKey = manifestKey.startsWith(prefix)
			? manifestKey.slice(prefix.length)
			: manifestKey;
		return {
			manifestKey,
			bundleId,
			entityId: idStr(raw.entityId ?? raw.entity_id),
			entityKey,
		};
	});
}

function maeById(mae: MaeRow[]): Map<string, MaeRow> {
	const m = new Map<string, MaeRow>();
	for (const row of mae) m.set(row.entityId, row);
	return m;
}

const ENTITY_KEY_FIELDS = new Set(["entity_key", "actor_entity_key", "container_entity_key"]);

/** Entity keys inside a caller `::` key, in schema field order — never the whole composite. */
function callerEntityKeys(kind: string, callerKey: string): string[] {
	const fields = instanceKeyFields(kind);
	const parts = callerKey.split("::");
	if (parts.length !== fields.length) {
		return fields.length === 1 ? [callerKey] : [];
	}
	return fields.flatMap((field, i) => (ENTITY_KEY_FIELDS.has(field) ? [parts[i] ?? ""] : []));
}

function resolveBundle(
	mae: MaeRow[],
	kind: string,
	key: string | undefined,
	bundle: string | undefined,
): { ok: true; bundle?: string } | Extract<OwnerGetAnswer, { ok: false }> {
	if (bundle) return { ok: true, bundle };
	if (!key) return { ok: true };
	const entityKeys = callerEntityKeys(kind, key);
	if (entityKeys.length === 0) return { ok: true };
	const hits = mae.filter((r) => entityKeys.includes(r.entityKey));
	const bundles = [...new Set(hits.map((r) => r.bundleId))];
	if (bundles.length > 1) {
		return {
			ok: false,
			code: "ambiguous_bundle",
			message: `entity_key is recorded in more than one bundle: ${bundles.join(", ")}`,
		};
	}
	return { ok: true, bundle: bundles[0] };
}

function collidingAuthoredSelector(
	mae: MaeRow[],
	key: string,
	bundle?: string,
): Extract<OwnerGetAnswer, { ok: false }> | undefined {
	const scoped = bundle ? mae.filter((r) => r.bundleId === bundle) : mae;
	const keyHits = scoped.filter((r) => r.entityKey === key);
	const idHits = scoped.filter((r) => r.entityId === key);
	if (keyHits.length === 0 || idHits.length === 0) return undefined;
	const keyIds = new Set(keyHits.map((r) => r.entityId));
	const idIds = new Set(idHits.map((r) => r.entityId));
	const same = keyIds.size === 1 && idIds.size === 1 && [...keyIds][0] === [...idIds][0];
	if (same) return undefined;
	const keyPart = keyHits
		.map((r) => `entity_key '${r.entityKey}' is numeric_id ${r.entityId} (bundle ${r.bundleId})`)
		.join("; ");
	const idPart = idHits
		.map((r) => `numeric_id ${r.entityId} is entity_key '${r.entityKey}' (bundle ${r.bundleId})`)
		.join("; ");
	return {
		ok: false,
		code: "usage",
		message: `key '${key}' names both an authored entity_key and a different numeric_id: ${keyPart}; ${idPart}. Use the unique entity_key, or a numeric_id that is not also an entity_key.`,
	};
}

function boundedLimit(
	limit: number | undefined,
): { ok: true; limit: number } | { ok: false; code: "usage"; message: string } {
	if (limit === undefined) return { ok: true, limit: DEFAULT_LIMIT };
	if (!Number.isInteger(limit) || limit < 0) {
		return { ok: false, code: "usage", message: "limit must be a non-negative integer" };
	}
	return { ok: true, limit };
}

function resolveSubject(
	mae: MaeRow[],
	byId: Map<string, MaeRow>,
	key: string,
	bundle?: string,
):
	| { ok: true; bundle?: string; numeric_id: string; entityKey: string }
	| Extract<OwnerDescribeAnswer, { ok: false }> {
	const wanted = bundle !== undefined && bundle !== "" ? bundle : undefined;
	const collision = collidingAuthoredSelector(mae, key, wanted);
	if (collision) return collision;
	const asId = byId.get(key);
	const asIdInScope = asId !== undefined && (wanted === undefined || asId.bundleId === wanted);
	if (asIdInScope && asId) {
		return {
			ok: true,
			bundle: asId.bundleId,
			numeric_id: asId.entityId,
			entityKey: asId.entityKey,
		};
	}
	let hits = mae.filter((r) => r.entityKey === key);
	if (wanted !== undefined) hits = hits.filter((r) => r.bundleId === wanted);
	if (hits.length === 0) {
		return {
			ok: false,
			code: "unknown_key",
			message:
				wanted !== undefined
					? `no authored entity ${key} in bundle ${wanted}`
					: `no authored entity ${key}`,
		};
	}
	if (hits.length > 1) {
		return {
			ok: false,
			code: "ambiguous_bundle",
			message: `entity_key '${key}' is recorded in more than one bundle: ${[...new Set(hits.map((r) => r.bundleId))].join(", ")}`,
		};
	}
	const hit = hits[0];
	if (!hit) {
		return { ok: false, code: "unknown_key", message: `no authored entity ${key}` };
	}
	return { ok: true, bundle: hit.bundleId, numeric_id: hit.entityId, entityKey: hit.entityKey };
}

function sliceNamesSubject(
	kind: InstanceRowKind,
	row: Record<string, unknown>,
	numericId: string,
): boolean {
	switch (kind) {
		case "entities":
		case "actors":
		case "actor_spatial_locations":
			return String(row.numeric_id) === numericId;
		case "actor_capabilities":
		case "actor_equipment_slots":
			return String(row.numeric_id) === numericId;
		case "entity_containment":
			return String(row.numeric_id) === numericId || String(row.container_numeric_id) === numericId;
		case "entity_tag":
		case "object_state":
			return String(row.numeric_id) === numericId;
	}
}

function projectKind(
	snap: OwnerSnapshot,
	mae: MaeRow[],
	kind: InstanceRowKind,
	bundle?: string,
): Array<Record<string, unknown> & { entity_key?: string; numeric_id?: string }> {
	const byId = maeById(mae);
	const scoped = bundle ? mae.filter((r) => r.bundleId === bundle) : mae;
	switch (kind) {
		case "entities":
			return iter(snap, "entity")
				.map((raw) => {
					const id = idStr(raw.entityId ?? raw.entity_id);
					const authored = byId.get(id);
					if (!authored) return undefined;
					if (bundle && authored.bundleId !== bundle) return undefined;
					const ownerId = idStr(raw.ownedByEntityId ?? raw.owned_by_entity_id);
					return {
						entity_key: authored.entityKey,
						bundle_id: authored.bundleId,
						numeric_id: id,
						name: raw.name,
						kind: raw.kind,
						entity_def_id: raw.entityDefId ?? raw.entity_def_id,
						quantity: raw.quantity ?? 1,
						description: descriptionFor(snap, id),
						owned_by_entity_key: byId.get(ownerId)?.entityKey ?? "",
						place_node_id: ownPlace(snap, id) ?? "",
					};
				})
				.filter((r): r is NonNullable<typeof r> => r !== undefined);
		case "actors":
			return iter(snap, "actor")
				.map((raw) => {
					const body = idStr(raw.currentBody ?? raw.current_body);
					const authored = byId.get(body);
					if (!authored) return undefined;
					if (bundle && authored.bundleId !== bundle) return undefined;
					return {
						entity_key: authored.entityKey,
						bundle_id: authored.bundleId,
						numeric_id: body,
						actor_id: idStr(raw.actorId ?? raw.actor_id),
						name: raw.name,
						current_body: body,
						description: raw.description,
					};
				})
				.filter((r): r is NonNullable<typeof r> => r !== undefined);
		case "actor_spatial_locations":
			return iter(snap, "actor_spatial_location")
				.map((raw) => {
					const id = idStr(raw.entityId ?? raw.entity_id);
					const authored = byId.get(id);
					if (!authored) return undefined;
					if (bundle && authored.bundleId !== bundle) return undefined;
					return {
						entity_key: authored.entityKey,
						bundle_id: authored.bundleId,
						numeric_id: id,
						place_node_id: String(raw.placeNodeId ?? raw.place_node_id ?? ""),
						selection_path: String(raw.selectionPath ?? raw.selection_path ?? ""),
					};
				})
				.filter((r): r is NonNullable<typeof r> => r !== undefined);
		case "actor_capabilities":
			return iter(snap, "capability")
				.map((raw) => {
					const id = idStr(raw.entityId ?? raw.entity_id);
					const authored = byId.get(id);
					if (!authored) return undefined;
					if (bundle && authored.bundleId !== bundle) return undefined;
					const cap = String(raw.capabilityId ?? raw.capability_id ?? "");
					const source = String(raw.source ?? "");
					const source_args_hash = String(raw.sourceArgsHash ?? raw.source_args_hash ?? "");
					return {
						entity_key: authored.entityKey,
						actor_entity_key: authored.entityKey,
						bundle_id: String(raw.bundleId ?? raw.bundle_id ?? authored.bundleId),
						numeric_id: id,
						capability_id: cap,
						source,
						source_args_hash,
						visibility: visTag(raw.visibility),
						extent_ref: String(raw.extentRef ?? raw.extent_ref ?? ""),
						extent_kind_ref: String(raw.extentKindRef ?? raw.extent_kind_ref ?? ""),
						elevation_class: visTag(raw.elevationClass ?? raw.elevation_class),
					};
				})
				.filter((r): r is NonNullable<typeof r> => r !== undefined);
		case "actor_equipment_slots":
			return iter(snap, "entity_equipment_slot")
				.map((raw) => {
					const id = idStr(raw.entityId ?? raw.entity_id);
					const authored = byId.get(id);
					if (!authored) return undefined;
					if (bundle && authored.bundleId !== bundle) return undefined;
					const itemId = idStr(raw.equippedEntityId ?? raw.equipped_entity_id);
					const slot = String(raw.slotId ?? raw.slot_id ?? "");
					return {
						entity_key: authored.entityKey,
						actor_entity_key: authored.entityKey,
						item_key: byId.get(itemId)?.entityKey,
						slot_id: slot,
						numeric_id: id,
					};
				})
				.filter((r): r is NonNullable<typeof r> => r !== undefined);
		case "entity_containment":
			return iter(snap, "entity_containment")
				.map((raw) => {
					const id = idStr(raw.entityId ?? raw.entity_id);
					const authored = byId.get(id);
					if (!authored) return undefined;
					if (bundle && authored.bundleId !== bundle) return undefined;
					const container = idStr(raw.containerId ?? raw.container_id);
					return {
						entity_key: authored.entityKey,
						container_entity_key: byId.get(container)?.entityKey ?? "",
						container_numeric_id: container,
						slot_id: String(raw.slotId ?? raw.slot_id ?? ""),
						direction: String(raw.direction ?? ""),
						numeric_id: id,
					};
				})
				.filter((r): r is NonNullable<typeof r> => r !== undefined);
		case "entity_tag":
			return iter(snap, "entity_tag")
				.map((raw) => {
					const id = idStr(raw.entityId ?? raw.entity_id);
					const authored = byId.get(id);
					if (!authored) return undefined;
					if (bundle && authored.bundleId !== bundle) return undefined;
					const tag = String(raw.tag ?? "");
					return {
						entity_key: authored.entityKey,
						tag,
						bundle_id: String(raw.bundleId ?? raw.bundle_id ?? ""),
						source: String(raw.source ?? ""),
						numeric_id: id,
					};
				})
				.filter((r): r is NonNullable<typeof r> => r !== undefined);
		case "object_state":
			return iter(snap, "object_state")
				.filter((raw) => String(raw.targetKind ?? raw.target_kind ?? "") === "entity")
				.map((raw) => {
					const targetId = String(raw.targetId ?? raw.target_id ?? "").replace(/^entity:/, "");
					const authored = byId.get(targetId);
					if (!authored) return undefined;
					if (bundle && authored.bundleId !== bundle) return undefined;
					const stateId = String(raw.stateId ?? raw.state_id ?? "");
					return {
						entity_key: authored.entityKey,
						state_id: stateId,
						numeric_id: targetId,
						bundle_id: String(raw.bundleId ?? raw.bundle_id ?? authored.bundleId),
						source_template_id: String(raw.sourceTemplateId ?? raw.source_template_id ?? ""),
						expires_at_tick: jsonInt(raw.expiresAtTick ?? raw.expires_at_tick ?? 0),
						visibility: visTag(raw.visibility),
						...objectStateCarriers(raw.value),
					};
				})
				.filter((r): r is NonNullable<typeof r> => r !== undefined);
		default:
			return scoped.map((r) => ({ entity_key: r.entityKey }));
	}
}

function ownPlace(snap: OwnerSnapshot, numericId: string): string | undefined {
	for (const raw of iter(snap, "entity_location")) {
		if (idStr(raw.entityId ?? raw.entity_id) === numericId) {
			const p = String(raw.placeNodeId ?? raw.place_node_id ?? "");
			if (p) return p;
		}
	}
	for (const raw of iter(snap, "actor_spatial_location")) {
		if (idStr(raw.entityId ?? raw.entity_id) === numericId) {
			const p = String(raw.placeNodeId ?? raw.place_node_id ?? "");
			if (p) return p;
		}
	}
	return undefined;
}

function upwardContainment(
	snap: OwnerSnapshot,
	_mae: MaeRow[],
	byId: Map<string, MaeRow>,
	start: string,
): {
	chain: Array<{ numeric_id: string; entity_key?: string; place?: string }>;
	chain_end: { reason: "place" | "none" | "cycle"; numeric_id?: string };
} {
	const byContained = new Map<string, string>();
	for (const raw of iter(snap, "entity_containment")) {
		byContained.set(
			idStr(raw.entityId ?? raw.entity_id),
			idStr(raw.containerId ?? raw.container_id),
		);
	}
	const own = ownPlace(snap, start);
	if (own) {
		return { chain: [], chain_end: { reason: "place", numeric_id: start } };
	}
	const chain: Array<{ numeric_id: string; entity_key?: string; place?: string }> = [];
	const visited = new Set<string>([start]);
	let cur = start;
	while (true) {
		const next = byContained.get(cur);
		if (!next) {
			return { chain, chain_end: { reason: "none", numeric_id: cur } };
		}
		if (visited.has(next)) {
			return { chain, chain_end: { reason: "cycle", numeric_id: next } };
		}
		visited.add(next);
		const authored = byId.get(next);
		const place = ownPlace(snap, next);
		chain.push({
			numeric_id: next,
			entity_key: authored?.entityKey,
			place,
		});
		if (place) {
			return { chain, chain_end: { reason: "place", numeric_id: next } };
		}
		cur = next;
	}
}

function downwardBelonging(
	snap: OwnerSnapshot,
	_mae: MaeRow[],
	byId: Map<string, MaeRow>,
	root: string,
): Array<{
	entity_key: string;
	numeric_id: string;
	name?: string;
	definition?: string;
	belongs_to_key?: string;
	belongs_to_numeric_id: string;
	relation: "containment" | "ownership" | "equipment";
}> {
	const names = new Map<string, { name?: string; definition?: string }>();
	for (const raw of iter(snap, "entity")) {
		const id = idStr(raw.entityId ?? raw.entity_id);
		names.set(id, {
			name: raw.name as string | undefined,
			definition: String(raw.entityDefId ?? raw.entity_def_id ?? ""),
		});
	}
	const out: ReturnType<typeof downwardBelonging> = [];
	const traverse = new Set<string>([root]);
	const emitted = new Set<string>();
	const queue = [root];
	const containment = iter(snap, "entity_containment");
	const equipment = iter(snap, "entity_equipment_slot");
	const entities = iter(snap, "entity");
	const emit = (
		id: string,
		cur: string,
		curKey: string | undefined,
		relation: "containment" | "ownership" | "equipment",
		slot?: string,
	) => {
		if (id === root) return;
		const edge = `${id}\0${relation}\0${cur}\0${slot ?? ""}`;
		if (emitted.has(edge)) return;
		emitted.add(edge);
		const authored = byId.get(id);
		if (!authored) return;
		out.push({
			entity_key: authored.entityKey,
			numeric_id: id,
			...names.get(id),
			...(curKey ? { belongs_to_key: curKey } : {}),
			belongs_to_numeric_id: cur,
			relation,
		});
	};
	const walkChild = (id: string) => {
		if (id === "" || id === root) return;
		if (traverse.has(id)) return;
		traverse.add(id);
		queue.push(id);
	};
	while (queue.length > 0) {
		const cur = queue.shift() ?? "";
		const curKey = byId.get(cur)?.entityKey;
		for (const raw of containment) {
			if (idStr(raw.containerId ?? raw.container_id) !== cur) continue;
			const id = idStr(raw.entityId ?? raw.entity_id);
			emit(id, cur, curKey, "containment");
			walkChild(id);
		}
		for (const raw of equipment) {
			if (idStr(raw.entityId ?? raw.entity_id) !== cur) continue;
			const id = idStr(raw.equippedEntityId ?? raw.equipped_entity_id);
			const slot = String(raw.slotId ?? raw.slot_id ?? "");
			emit(id, cur, curKey, "equipment", slot);
			walkChild(id);
		}
		for (const raw of entities) {
			const owner = idStr(raw.ownedByEntityId ?? raw.owned_by_entity_id);
			if (owner !== cur) continue;
			const id = idStr(raw.entityId ?? raw.entity_id);
			emit(id, cur, curKey, "ownership");
			walkChild(id);
		}
	}
	return out;
}

function iter(snap: OwnerSnapshot, table: string): Record<string, unknown>[] {
	const handle = snap[table];
	if (!handle) return [];
	return [...handle.iter()];
}

function idStr(v: unknown): string {
	if (v === undefined || v === null) return "";
	return String(v);
}

function descriptionFor(snap: OwnerSnapshot, entityId: string): string {
	for (const raw of iter(snap, "entity_description")) {
		if (idStr(raw.entityId ?? raw.entity_id) === entityId) {
			return String(raw.description ?? "");
		}
	}
	return "";
}

function visTag(v: unknown): string {
	if (v === undefined || v === null) return "";
	if (typeof v === "string") return v;
	if (typeof v === "object" && v !== null && "tag" in v)
		return String((v as { tag: unknown }).tag ?? "");
	return String(v);
}

function jsonInt(v: unknown): string {
	if (typeof v === "bigint") return v.toString();
	if (typeof v === "number" && Number.isFinite(v)) {
		return Number.isInteger(v) ? String(v) : String(Math.trunc(v));
	}
	if (typeof v === "string" && /^-?\d+$/.test(v)) return v;
	if (v && typeof v === "object" && "toString" in v) return String(v);
	return "0";
}

function objectStateCarriers(value: unknown): {
	value_bool?: boolean;
	value_int?: string;
	value_text?: string;
} {
	if (value === undefined || value === null) return {};
	if (typeof value === "object" && value !== null && "tag" in value) {
		const tagged = value as { tag?: string; value?: unknown };
		const tag = tagged.tag ?? "";
		if (tag === "Bool" || tag === "bool") return { value_bool: Boolean(tagged.value) };
		if (tag === "Int" || tag === "int") return { value_int: jsonInt(tagged.value) };
		if (tag === "Text" || tag === "text" || tag === "RowRef" || tag === "Outcome") {
			return { value_text: String(tagged.value ?? "") };
		}
	}
	return {};
}

/** D-6 listing columns when the caller omits `fields`. Key fields are always kept. */
export function listingPreferredFields(kind: string): readonly string[] {
	const extra: Record<string, readonly string[]> = {
		entities: ["numeric_id", "bundle_id", "name", "kind", "entity_def_id", "place_node_id"],
		actors: ["numeric_id", "bundle_id", "name", "actor_id", "current_body"],
		actor_spatial_locations: ["numeric_id", "bundle_id", "place_node_id"],
		actor_capabilities: ["numeric_id", "bundle_id", "capability_id"],
		actor_equipment_slots: ["numeric_id", "item_key"],
		entity_containment: ["numeric_id", "container_numeric_id"],
		entity_tag: ["numeric_id", "bundle_id"],
		object_state: ["numeric_id", "bundle_id", "value_int", "value_bool"],
	};
	return [
		...new Set([...instanceKeyFields(kind), ...(extra[kind] ?? ["numeric_id", "bundle_id"])]),
	];
}

function pickFields(
	row: Record<string, unknown>,
	kind: string,
	fields?: string[],
): Record<string, unknown> {
	const keep = new Set([
		...((fields && fields.length > 0 ? fields : listingPreferredFields(kind)) ?? []),
		...instanceKeyFields(kind),
	]);
	const out: Record<string, unknown> = {};
	for (const f of keep) {
		if (f in row) out[f] = row[f];
	}
	return out;
}
