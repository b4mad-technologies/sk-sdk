// D6 binding-drift types + runtime schema surface fetch.

import {
	classifyRuntimeChange,
	foldCollisions,
	foldNames,
	normaliseItems,
	type RuntimeChange,
	type SchemaSnapshot,
	type UncheckedItem,
} from "./world-contract/index.ts";

export interface SchemaSurface {
	tables: string[];
	reducers: string[];
}

export class SchemaInventoryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SchemaInventoryError";
	}
}

export class BindingDriftError extends Error {
	readonly expected: SchemaSurface;
	readonly actual: SchemaSurface;
	readonly mismatchKind: "table" | "reducer" | "row-shape";
	readonly scope: "consumed";

	constructor(
		expected: SchemaSurface,
		actual: SchemaSurface,
		mismatchKind: "table" | "reducer" | "row-shape",
	) {
		super(
			`BindingDriftError(${mismatchKind}): strict schema surface mismatch — expected ${expected[mismatchKind === "table" ? "tables" : "reducers"].join(",")} got ${actual[mismatchKind === "table" ? "tables" : "reducers"].join(",")}`,
		);
		this.name = "BindingDriftError";
		this.expected = expected;
		this.actual = actual;
		this.mismatchKind = mismatchKind;
		this.scope = "consumed";
	}
}

const REQUIRED_SECTIONS = ["Typespace", "Tables", "Reducers", "CaseConversionPolicy"] as const;
const ALLOWED_SECTIONS = [
	...REQUIRED_SECTIONS,
	"Views",
	"Types",
	"Schedules",
	"LifeCycleReducers",
	"ExplicitNames",
	// Array section. A module that defines a procedure publishes it.
	// Absent on every module that defines none; required sections stay the four above.
	"Procedures",
] as const;
type SectionKind = (typeof ALLOWED_SECTIONS)[number];

function isSectionKind(kind: string): kind is SectionKind {
	return (ALLOWED_SECTIONS as readonly string[]).includes(kind);
}

const OBJECT_SECTIONS = new Set<SectionKind>(["Typespace", "ExplicitNames"]);

function requireNonEmptyName(value: unknown, label: string, url: string): string {
	if (typeof value !== "string" || value.trim() === "") {
		throw new SchemaInventoryError(`Schema inventory malformed ${label} source_name: ${url}`);
	}
	return value;
}

function namedEntries(entries: unknown[], label: string, url: string): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			throw new SchemaInventoryError(`Schema inventory malformed ${label} entry: ${url}`);
		}
		const name = requireNonEmptyName((entry as { source_name?: unknown }).source_name, label, url);
		if (seen.has(name)) {
			throw new SchemaInventoryError(`Schema inventory duplicate ${label} name '${name}': ${url}`);
		}
		seen.add(name);
		names.push(name);
	}
	return names;
}

function publicViewNames(entries: unknown[], url: string): string[] {
	const names: string[] = [];
	const seen = new Set<string>();
	for (const entry of entries) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			throw new SchemaInventoryError(`Schema inventory malformed Views entry: ${url}`);
		}
		const view = entry as { source_name?: unknown; is_public?: unknown };
		const name = requireNonEmptyName(view.source_name, "Views", url);
		if (typeof view.is_public !== "boolean") {
			throw new SchemaInventoryError(`Schema inventory malformed Views is_public: ${url}`);
		}
		if (seen.has(name)) {
			throw new SchemaInventoryError(`Schema inventory duplicate Views name '${name}': ${url}`);
		}
		seen.add(name);
		if (view.is_public) names.push(name);
	}
	return names;
}

/**
 * Parse a RawModuleDefV10 JSON body into the name surface. Rejects missing,
 * duplicate, or malformed section/entry structure instead of skipping it.
 */
export function parseServerSurface(schema: unknown, url: string): SchemaSurface {
	if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
		throw new SchemaInventoryError(`Schema inventory is not an object: ${url}`);
	}
	const sections = (schema as { sections?: unknown }).sections;
	if (!Array.isArray(sections)) {
		throw new SchemaInventoryError(`Schema inventory missing sections: ${url}`);
	}

	const seen = new Set<SectionKind>();
	let tables: unknown[] | undefined;
	let views: unknown[] | undefined;
	let reducers: unknown[] | undefined;

	for (const section of sections) {
		if (typeof section !== "object" || section === null || Array.isArray(section)) {
			throw new SchemaInventoryError(`Schema inventory malformed section: ${url}`);
		}
		const keys = Object.keys(section);
		if (keys.length !== 1) {
			throw new SchemaInventoryError(`Schema inventory malformed section: ${url}`);
		}
		const kind = keys[0];
		if (kind === undefined || !isSectionKind(kind)) {
			throw new SchemaInventoryError(`Schema inventory unknown section '${kind}': ${url}`);
		}
		if (seen.has(kind)) {
			throw new SchemaInventoryError(`Schema inventory duplicate ${kind} section: ${url}`);
		}
		seen.add(kind);
		const value = (section as Record<string, unknown>)[kind];
		if (kind === "CaseConversionPolicy") {
			if (
				typeof value !== "object" ||
				value === null ||
				Object.keys(value).length !== 1 ||
				!("None" in value) ||
				!Array.isArray(value.None) ||
				value.None.length !== 0
			) {
				throw new SchemaInventoryError(`Schema inventory unsupported ${kind}: ${url}`);
			}
			continue;
		}
		if (OBJECT_SECTIONS.has(kind)) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				throw new SchemaInventoryError(`Schema inventory ${kind} is not an object: ${url}`);
			}
			continue;
		}
		if (!Array.isArray(value)) {
			throw new SchemaInventoryError(`Schema inventory ${kind} is not an array: ${url}`);
		}
		if (kind === "Tables") tables = value;
		else if (kind === "Views") views = value;
		else if (kind === "Reducers") reducers = value;
	}

	for (const kind of REQUIRED_SECTIONS) {
		if (!seen.has(kind)) {
			throw new SchemaInventoryError(`Schema inventory missing ${kind}: ${url}`);
		}
	}

	const tableNames = namedEntries(tables ?? [], "Tables", url);
	const viewNames = publicViewNames(views ?? [], url);
	const reducerNames = namedEntries(reducers ?? [], "Reducers", url);
	const tableSet = new Set(tableNames);
	for (const name of viewNames) {
		if (tableSet.has(name)) {
			throw new SchemaInventoryError(`Schema inventory duplicate name '${name}': ${url}`);
		}
	}

	return {
		tables: [...tableNames, ...viewNames].sort(),
		reducers: [...reducerNames].sort(),
	};
}

/**
 * A consumed table, view or reducer whose served shape this client cannot
 * decode or call (sk-jay0.7.389.3): a changed, appended, removed or
 * reordered column, changed reducer arguments or return type, a changed named
 * type, a table made private. Thrown by connect() before the WebSocket opens,
 * so the client never decodes rows with the wrong layout. Extends
 * {@link BindingDriftError}, so existing handlers of the name check also catch
 * it. Only in "strict" mode (the default); "warn" connects and reports.
 */
export class BindingShapeError extends BindingDriftError {
	readonly changes: readonly RuntimeChange[];
	/** The world contract epoch this client was built for (build side only). */
	readonly clientEpoch: number;

	constructor(
		expected: SchemaSurface,
		actual: SchemaSurface,
		changes: readonly RuntimeChange[],
		clientEpoch: number,
	) {
		super(expected, actual, "row-shape");
		this.name = "BindingShapeError";
		this.changes = changes;
		this.clientEpoch = clientEpoch;
		this.message = [
			"BindingShapeError: this client cannot decode or call the world module it reached " +
				`(built for contract epoch ${clientEpoch}; the module publishes no epoch, so connect compares shapes). ` +
				"Use a client built from the deployed module, or roll the module back; " +
				'hosted apps run shapeCheck "warn" (SPELLKAVE_SHAPE_CHECK=warn) to log instead of refusing. Each line reads client -> server:',
			...changes.map((c) => `  ${c.item}: ${c.detail}`),
		].join("\n");
	}
}

export interface ShapeComparison {
	readonly breaking: readonly RuntimeChange[];
	readonly diagnostics: readonly RuntimeChange[];
	/** Consumed items the served definition did not let us read: not judged. */
	readonly unchecked: readonly UncheckedItem[];
}

const foldText = (s: string) => s.toLowerCase().replace(/_/g, "");

/**
 * Compares the served module definition with the contract this client was
 * built with, for the items the contract lists only, with the connect-time
 * (decode and call) rules of `@spellkave/bindings/contract`. Names are folded
 * on both sides (the node re-cases identifiers; BSATN carries no names). An
 * item the served definition does not let us read is `unchecked`, never a
 * refusal: the check adds no fail-closed surface beyond the consumed shapes.
 */
export function compareServedShape(served: unknown, contract: SchemaSnapshot): ShapeComparison {
	const {
		snapshot: server,
		unchecked,
		moduleUnreadable,
	} = normaliseItems(served, {
		tables: [...Object.keys(contract.tables), ...Object.keys(contract.views)],
		reducers: Object.keys(contract.reducers),
	});
	// A module-level definition we cannot read leaves every item unjudged:
	// report it, refuse nothing (the name check above already ran).
	if (moduleUnreadable) return { breaking: [], diagnostics: [], unchecked };
	const keep = foldCollisions(contract, server);
	const folded = classifyRuntimeChange(foldNames(contract, keep), foldNames(server, keep));
	// Judge on folded names; report in the module's own spelling where the
	// unfolded comparison names the same change.
	const spelled = classifyRuntimeChange(contract, server);
	const changes = folded.map(
		(f) =>
			spelled.find(
				(s) => foldText(s.item) === foldText(f.item) && foldText(s.detail) === foldText(f.detail),
			) ?? f,
	);
	const uncheckedNames = new Set(unchecked.map((u) => u.item));
	return {
		breaking: changes.filter((c) => c.verdict === "breaking" && !uncheckedNames.has(c.item)),
		diagnostics: changes.filter((c) => c.verdict === "diagnostic"),
		unchecked,
	};
}

/** The served module definition and its name surface, from one request. */
export async function fetchServerSchema(
	serverUrl: string,
	dbName: string,
): Promise<{ readonly url: string; readonly schema: unknown; readonly surface: SchemaSurface }> {
	const url = `${serverUrl}/v1/database/${dbName}/schema?version=10`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Schema fetch failed: ${res.status} ${res.statusText}`);
	const schema: unknown = await res.json();
	return { url, schema, surface: parseServerSurface(schema, url) };
}

/**
 * Fetch the live schema from the SpacetimeDB HTTP endpoint and return the
 * name surface the runtime gate can compare. connect() also compares row and
 * argument shapes ({@link compareServedShape}); this name-only helper stays for
 * callers that need just the inventory.
 */
export async function fetchServerSurface(
	serverUrl: string,
	dbName: string,
): Promise<SchemaSurface> {
	return (await fetchServerSchema(serverUrl, dbName)).surface;
}
