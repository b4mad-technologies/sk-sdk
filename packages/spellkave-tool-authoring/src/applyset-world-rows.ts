/** D-8 world-added rows on a retracted entity. Subtracts the expected set
 * (memory rows that name the entity, plus definition seeds) from the live
 * snapshot. The live port collects; this module classifies. */

import { APPLYSET_DEFINITION_TABLES } from "./applyset-definition-tables.ts";

export type SnapshotHandle = { iter(): Iterable<unknown> };
export type SnapshotLike = Record<string, SnapshotHandle | undefined>;

export type WorldRowRef = {
	table: string;
	key: string;
};

export type WorldRowsOnEntity = {
	entityId: string;
	entityDefId: string;
	rows: WorldRowRef[];
};

export type WorldAddedHeading = "taken" | "left_behind";

export type WorldAddedRow = WorldRowRef & { heading: WorldAddedHeading };

export type MemoryEntityView = {
	entityKey: string;
	placeNodeId: string;
	containedIn?: string;
	contains?: string[];
	states?: string[];
	capabilities?: string[];
	identities?: string[];
	spatial?: boolean;
	equipment?: Array<{ slot: string }>;
};

export type DefinitionSeeds = {
	states?: string[];
	capabilities?: string[];
	conditions?: string[];
	containments?: string[];
	equipment?: Array<{ slot: string }>;
};

/** SnapshotDb accessors are camelCase; subscribe names are snake_case. */
export function snapshotAccessorName(table: string): string {
	return table.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Tables `collectWorldRows` must touch: owner subscription + definition
 * seeds + the entity row + the authored-key map + public `actor` (body →
 * identity). Pass `OWNER_SUBSCRIPTION_TABLES` from `@spellkave/sdk` at
 * the live port. */
export function worldRowSnapshotAccessors(ownerSubscription: readonly string[]): string[] {
	return [
		...new Set([
			...ownerSubscription.map(snapshotAccessorName),
			...APPLYSET_DEFINITION_TABLES.map(snapshotAccessorName),
			"entity",
			"operatorManifestAuthoredEntity",
			"actor",
		]),
	];
}

function field(row: Record<string, unknown>, ...names: string[]): unknown {
	for (const name of names) {
		if (row[name] !== undefined) return row[name];
	}
	return undefined;
}

function idOf(value: unknown): string {
	return String(value ?? "");
}

/** `entity_refs.rs::manifest_key` is `bundle:key`; keep both halves. */
function parseManifestKey(mk: string): { bundle: string; key: string } {
	const colon = mk.indexOf(":");
	if (colon < 0) return { bundle: "", key: mk };
	return { bundle: mk.slice(0, colon), key: mk.slice(colon + 1) };
}

function authoredMapFromDb(db: SnapshotLike): Map<string, { bundle: string; key: string }> {
	const authoredById = new Map<string, { bundle: string; key: string }>();
	for (const row of rowsOf(db, "operatorManifestAuthoredEntity")) {
		const id = idOf(field(row, "entityId", "entity_id"));
		authoredById.set(id, parseManifestKey(idOf(field(row, "manifestKey", "manifest_key"))));
	}
	return authoredById;
}

function rowsOf(db: SnapshotLike, name: string): Record<string, unknown>[] {
	const handle = db[name];
	return handle === undefined ? [] : ([...handle.iter()] as Record<string, unknown>[]);
}

function sameId(left: unknown, right: string): boolean {
	return idOf(left) === right;
}

/** Numeric id for a retracted entity from the cached authored-key map. */
export function resolveAuthoredEntityId(
	db: SnapshotLike,
	bundleId: string,
	entityKey: string,
): string | null {
	const manifestKey = `${bundleId}:${entityKey}`;
	for (const row of rowsOf(db, "operatorManifestAuthoredEntity")) {
		if (idOf(field(row, "manifestKey", "manifest_key")) === manifestKey) {
			return idOf(field(row, "entityId", "entity_id"));
		}
	}
	return null;
}

/** Collect owner-table rows plus the entity row and the five seed catalogs
 * for `entityId`. Touches only {@link worldRowSnapshotAccessors}. */
export function collectWorldRows(db: SnapshotLike, entityId: string): WorldRowsOnEntity {
	const rows: WorldRowRef[] = [];
	const entities = rowsOf(db, "entity");
	const defOf = (id: string): string => {
		const found = entities.find((row) => sameId(field(row, "entityId", "entity_id"), id)) ?? {};
		return idOf(field(found, "entityDefId", "entity_def_id"));
	};
	const entity =
		entities.find((row) => sameId(field(row, "entityId", "entity_id"), entityId)) ?? {};
	const entityDefId = idOf(field(entity, "entityDefId", "entity_def_id"));
	if (Object.keys(entity).length > 0) {
		rows.push({ table: "entity", key: entityId });
	}

	for (const row of rowsOf(db, "operatorManifestAuthoredEntity")) {
		if (sameId(field(row, "entityId", "entity_id"), entityId)) {
			rows.push({
				table: "visible_manifest_authored_entity",
				key: idOf(field(row, "manifestKey", "manifest_key")),
			});
		}
	}

	for (const row of rowsOf(db, "entityLocation")) {
		if (sameId(field(row, "entityId", "entity_id"), entityId)) {
			rows.push({
				table: "entity_location",
				key: idOf(field(row, "placeNodeId", "place_node_id")),
			});
		}
	}

	const authoredById = authoredMapFromDb(db);
	const authoredKey = (id: string): string => authoredById.get(id)?.key ?? id;

	for (const row of rowsOf(db, "entityContainment")) {
		const content = idOf(field(row, "entityId", "entity_id"));
		const container = idOf(field(row, "containerId", "container_id"));
		if (content === entityId) {
			rows.push({ table: "entity_containment", key: `content:${authoredKey(container)}` });
		} else if (container === entityId) {
			const childDef = defOf(content);
			if (authoredById.has(content)) {
				rows.push({
					table: "entity_containment",
					key: `container:${authoredKey(content)}`,
				});
			} else if (childDef !== "") {
				rows.push({ table: "entity_containment", key: `container:${childDef}` });
			} else {
				rows.push({ table: "entity_containment", key: `container:${content}` });
			}
		}
	}

	for (const row of rowsOf(db, "objectState")) {
		if (sameId(field(row, "targetId", "target_id"), entityId)) {
			rows.push({
				table: "object_state",
				key: idOf(field(row, "stateId", "state_id")),
			});
		}
	}

	for (const row of rowsOf(db, "capability")) {
		if (sameId(field(row, "entityId", "entity_id"), entityId)) {
			rows.push({
				table: "capability",
				key: idOf(field(row, "capabilityId", "capability_id")),
			});
		}
	}

	const actorIds = new Set<string>();
	for (const row of rowsOf(db, "actor")) {
		if (sameId(field(row, "currentBody", "current_body"), entityId)) {
			actorIds.add(idOf(field(row, "actorId", "actor_id")));
		}
	}
	for (const row of rowsOf(db, "actorIdentity")) {
		const actorId = idOf(field(row, "actorId", "actor_id"));
		if (actorIds.has(actorId)) {
			rows.push({ table: "actor_identity", key: identityHex(field(row, "identity")) });
		}
	}

	for (const row of rowsOf(db, "actorSpatialLocation")) {
		if (sameId(field(row, "entityId", "entity_id"), entityId)) {
			rows.push({
				table: "actor_spatial_location",
				key: idOf(field(row, "placeNodeId", "place_node_id")),
			});
		}
	}

	for (const row of rowsOf(db, "entityEquipmentSlot")) {
		const wearer = idOf(field(row, "entityId", "entity_id"));
		const item = idOf(field(row, "equippedEntityId", "equipped_entity_id"));
		const slot = idOf(field(row, "slotId", "slot_id"));
		if (wearer === entityId) {
			rows.push({ table: "entity_equipment_slot", key: `wearer:${slot}` });
		} else if (item === entityId) {
			rows.push({
				table: "entity_equipment_slot",
				key: `item:${slot}@${authoredKey(wearer)}`,
			});
		}
	}

	for (const row of rowsOf(db, "targetCondition")) {
		if (
			sameId(field(row, "targetId", "target_id"), entityId) ||
			sameId(field(row, "targetBodyEntityId", "target_body_entity_id"), entityId)
		) {
			rows.push({
				table: "target_condition",
				key: idOf(field(row, "conditionDefinitionId", "condition_definition_id")),
			});
		}
	}

	const seedMatchers: Array<[string, string, string]> = [
		["entityDefinitionInitialState", "stateId", "state_id"],
		["entityDefinitionInitialCapability", "capabilityId", "capability_id"],
		["entityDefinitionInitialCondition", "conditionDefinitionId", "condition_definition_id"],
		["entityDefinitionInitialEquipment", "slotId", "slot_id"],
	];
	for (const [table, camel, snake] of seedMatchers) {
		for (const row of rowsOf(db, table)) {
			if (idOf(field(row, "entityDefId", "entity_def_id")) === entityDefId && entityDefId !== "") {
				rows.push({ table, key: idOf(field(row, camel, snake)) });
			}
		}
	}
	for (const row of rowsOf(db, "entityDefinitionInitialContainment")) {
		if (idOf(field(row, "entityDefId", "entity_def_id")) === entityDefId && entityDefId !== "") {
			const contained = idOf(field(row, "containedEntityDefId", "contained_entity_def_id"));
			const raw = field(row, "quantity");
			const quantity = Math.max(1, typeof raw === "number" ? raw : Number(raw ?? 1) || 1);
			for (let i = 0; i < quantity; i++) {
				rows.push({ table: "entityDefinitionInitialContainment", key: contained });
			}
		}
	}
	// spawn_and_seed_child writes containment for initial_equipment too
	// (D-8: the expected set copies the server's definition-seeding rules).
	for (const row of rowsOf(db, "entityDefinitionInitialEquipment")) {
		if (idOf(field(row, "entityDefId", "entity_def_id")) === entityDefId && entityDefId !== "") {
			const equipped = idOf(field(row, "equippedEntityDefId", "equipped_entity_def_id"));
			if (equipped !== "") {
				rows.push({ table: "entityDefinitionInitialContainment", key: equipped });
			}
		}
	}

	return { entityId, entityDefId, rows };
}

function identityHex(value: unknown): string {
	if (typeof value === "string") return value;
	if (value !== null && typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (typeof record.__identity__ === "string") return record.__identity__;
		if (typeof record.toHexString === "function") {
			return String((record.toHexString as () => string)());
		}
	}
	return idOf(value);
}

function expectedKeys(memory: MemoryEntityView, seeds: DefinitionSeeds): Set<string> {
	const keys = new Set<string>();
	if (memory.placeNodeId !== "" && memory.containedIn === undefined) {
		keys.add(`entity_location:${memory.placeNodeId}`);
	}
	if (memory.containedIn !== undefined) {
		keys.add(`entity_containment:content:${memory.containedIn}`);
	}
	for (const state of [...(memory.states ?? []), ...(seeds.states ?? [])]) {
		keys.add(`object_state:${state}`);
	}
	for (const capability of [...(memory.capabilities ?? []), ...(seeds.capabilities ?? [])]) {
		keys.add(`capability:${capability}`);
	}
	for (const condition of seeds.conditions ?? []) {
		keys.add(`target_condition:${condition}`);
	}
	for (const identity of memory.identities ?? []) {
		keys.add(`actor_identity:${identity}`);
	}
	if (memory.spatial === true && memory.placeNodeId !== "") {
		keys.add(`actor_spatial_location:${memory.placeNodeId}`);
	}
	for (const slot of memory.equipment ?? []) {
		keys.add(`entity_equipment_slot:wearer:${slot.slot}`);
	}
	for (const slot of seeds.equipment ?? []) {
		keys.add(`entity_equipment_slot:wearer:${slot.slot}`);
	}
	keys.add(`entity:${memory.entityKey}`);
	return keys;
}

function headingFor(row: WorldRowRef): WorldAddedHeading {
	if (row.table === "target_condition") return "left_behind";
	if (row.table === "entity_containment" && row.key.startsWith("container:")) {
		return "left_behind";
	}
	return "taken";
}

function expectedIdentity(identity: string, publisherIdentity?: string): string {
	return identity === "$sender" && publisherIdentity !== undefined && publisherIdentity !== ""
		? publisherIdentity
		: identity;
}

/** World rows that remain after subtracting memory + definition seeds. */
export function classifyWorldAdded(args: {
	collected: WorldRowsOnEntity;
	memory: MemoryEntityView;
	seeds?: DefinitionSeeds;
	/** Applying publisher hex; a memory `$sender` identity stands for this. */
	publisherIdentity?: string;
	/** Applyset `actor_equipment_slots` identities (wearer, slot) for item-side expected. */
	equipmentSlots?: Array<{ wearer: string; slot: string }>;
}): WorldAddedRow[] {
	const expected = expectedKeys(args.memory, args.seeds ?? {});
	for (const identity of args.memory.identities ?? []) {
		expected.add(`actor_identity:${expectedIdentity(identity, args.publisherIdentity)}`);
	}
	for (const slot of args.equipmentSlots ?? []) {
		expected.add(`entity_equipment_slot:item:${slot.slot}@${slot.wearer}`);
	}
	const containerExpected = new Map<string, number>();
	const addContainer = (id: string) => {
		const token = `entity_containment:container:${id}`;
		containerExpected.set(token, (containerExpected.get(token) ?? 0) + 1);
	};
	for (const child of args.memory.contains ?? []) addContainer(child);
	for (const contained of args.seeds?.containments ?? []) addContainer(contained);
	const added: WorldAddedRow[] = [];
	for (const row of args.collected.rows) {
		if (row.table.startsWith("entityDefinitionInitial")) continue;
		if (row.table === "entity" || row.table === "visible_manifest_authored_entity") continue;
		// Place/position: the builder's reconstructed-hash live field owns these.
		if (row.table === "entity_location" || row.table === "actor_spatial_location") continue;
		const token = `${row.table}:${row.key}`;
		if (row.table === "entity_containment" && row.key.startsWith("container:")) {
			const remaining = containerExpected.get(token) ?? 0;
			if (remaining > 0) {
				containerExpected.set(token, remaining - 1);
				continue;
			}
			added.push({ ...row, heading: headingFor(row) });
			continue;
		}
		if (expected.has(token)) continue;
		added.push({ ...row, heading: headingFor(row) });
	}
	return added;
}

export function snapshotFromTables(
	tables: Record<string, Record<string, unknown>[]>,
): SnapshotLike {
	const db: SnapshotLike = {};
	for (const [name, rows] of Object.entries(tables)) {
		db[name] = { iter: () => rows };
	}
	return db;
}

export type MemoryEntry = { kind: string; key: string; bundle_id?: string | null };

function keyParts(key: string): string[] {
	if (!key.startsWith("[")) return [key];
	try {
		const parsed: unknown = JSON.parse(key);
		return Array.isArray(parsed) ? parsed.map((part) => String(part)) : [key];
	} catch {
		return [key];
	}
}

function push<T>(list: T[] | undefined, value: T): T[] {
	const next = list ?? [];
	next.push(value);
	return next;
}

/** Applyset-memory entries that name `entityKey`, for D-8's expected set. */
export function memoryViewFromEntries(
	entries: readonly MemoryEntry[],
	entityKey: string,
	bundleId = "",
): MemoryEntityView {
	const view: MemoryEntityView = { entityKey, placeNodeId: "" };
	for (const entry of entries) {
		if (
			bundleId !== "" &&
			entry.bundle_id !== undefined &&
			entry.bundle_id !== null &&
			entry.bundle_id !== "" &&
			entry.bundle_id !== bundleId
		) {
			continue;
		}
		const parts = keyParts(entry.key);
		switch (entry.kind) {
			case "entity_containment": {
				const container = parts[0];
				const item = parts[1];
				if (item === entityKey) view.containedIn = container;
				if (container === entityKey) view.contains = push(view.contains, item ?? "");
				break;
			}
			case "object_state": {
				if (parts[0] === entityKey && parts[1] !== undefined) {
					view.states = push(view.states, parts[1]);
				}
				break;
			}
			case "actor_capabilities": {
				if (parts[0] === entityKey && parts[1] !== undefined) {
					view.capabilities = push(view.capabilities, parts[1]);
				}
				break;
			}
			case "actor_identities": {
				if (parts[0] === entityKey && parts[1] !== undefined) {
					view.identities = push(view.identities, parts[1]);
				}
				break;
			}
			case "actor_spatial_locations": {
				if (parts[0] === entityKey) view.spatial = true;
				break;
			}
			case "actor_equipment_slots": {
				if (parts[0] === entityKey && parts[1] !== undefined) {
					view.equipment = push(view.equipment, { slot: parts[1] });
				}
				break;
			}
			default:
				break;
		}
	}
	return view;
}

/** Wearer+slot from applyset memory `actor_equipment_slots` keys. */
export function equipmentSlotsFromEntries(
	entries: readonly MemoryEntry[],
	bundleId = "",
): Array<{ wearer: string; slot: string }> {
	const slots: Array<{ wearer: string; slot: string }> = [];
	for (const entry of entries) {
		if (entry.kind !== "actor_equipment_slots") continue;
		if (
			bundleId !== "" &&
			entry.bundle_id !== undefined &&
			entry.bundle_id !== null &&
			entry.bundle_id !== "" &&
			entry.bundle_id !== bundleId
		) {
			continue;
		}
		const parts = keyParts(entry.key);
		if (parts[0] !== undefined && parts[1] !== undefined) {
			slots.push({ wearer: parts[0], slot: parts[1] });
		}
	}
	return slots;
}

export function seedsFromCollected(collected: WorldRowsOnEntity): DefinitionSeeds {
	const seeds: DefinitionSeeds = {};
	for (const row of collected.rows) {
		switch (row.table) {
			case "entityDefinitionInitialState":
				seeds.states = push(seeds.states, row.key);
				break;
			case "entityDefinitionInitialCapability":
				seeds.capabilities = push(seeds.capabilities, row.key);
				break;
			case "entityDefinitionInitialCondition":
				seeds.conditions = push(seeds.conditions, row.key);
				break;
			case "entityDefinitionInitialContainment":
				seeds.containments = push(seeds.containments, row.key);
				break;
			case "entityDefinitionInitialEquipment":
				seeds.equipment = push(seeds.equipment, { slot: row.key });
				break;
			default:
				break;
		}
	}
	return seeds;
}

export type WorldAddedOnEntity = {
	key: string;
	taken: WorldRowRef[];
	left_behind: WorldRowRef[];
};

export type LivePlace = {
	kind: "entities" | "actor_spatial_locations";
	key: string;
	place_node_id: string;
};

/** Owner-subscription places for the builder's prune reconstruction. */
export function collectLivePlaces(db: SnapshotLike): LivePlace[] {
	const authoredById = authoredMapFromDb(db);
	const authoredKey = (id: string): string => authoredById.get(id)?.key ?? id;
	const located = new Set<string>();
	const places: LivePlace[] = [];
	for (const row of rowsOf(db, "entityLocation")) {
		const id = idOf(field(row, "entityId", "entity_id"));
		located.add(id);
		places.push({
			kind: "entities",
			key: authoredKey(id),
			place_node_id: idOf(field(row, "placeNodeId", "place_node_id")),
		});
	}
	for (const row of rowsOf(db, "entityContainment")) {
		const content = idOf(field(row, "entityId", "entity_id"));
		if (!located.has(content)) {
			located.add(content);
			places.push({ kind: "entities", key: authoredKey(content), place_node_id: "" });
		}
	}
	for (const [id, authored] of authoredById) {
		if (!located.has(id)) {
			located.add(id);
			places.push({ kind: "entities", key: authored.key, place_node_id: "" });
		}
	}
	for (const row of rowsOf(db, "actorSpatialLocation")) {
		const id = idOf(field(row, "entityId", "entity_id"));
		places.push({
			kind: "actor_spatial_locations",
			key: authoredKey(id),
			place_node_id: idOf(field(row, "placeNodeId", "place_node_id")),
		});
	}
	return places;
}
