/**
 * One normaliser from a SpacetimeDB `RawModuleDefV10` to the kernel schema
 * snapshot shape (sk-jay0.7.389.3). It reads both encodings of the same
 * module definition:
 *
 *   - decoded BSATN, as `packages/spellkave-bindings/scripts/schema-snapshot.ts`
 *     gets it from the wasm's `__describe_module__` through the `spacetimedb`
 *     codec: sums are `{ tag, value }`, fields camelCase, options bare;
 *   - the served SATS-JSON of `/v1/database/<db>/schema?version=10`, as the
 *     SDK fetches it at connect: sums are `{ Variant: payload }`, fields
 *     snake_case, options `{ some } | { none }`, bytes hex strings.
 *
 * The readers below accept either form, so the rendering rules exist once.
 * Pure: no imports, safe for browser bundles.
 */
import type { SchemaSnapshot } from "./classify.ts";
import { typeNames } from "./typetext.ts";

type Obj = Record<string, unknown>;

function isObj(x: unknown): x is Obj {
	return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** A field by its snake_case name, or the camelCase name the codec uses. */
function field(obj: unknown, snake: string): unknown {
	if (!isObj(obj)) return undefined;
	if (snake in obj) return obj[snake];
	return obj[snake.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())];
}

/** A sum value as [variant, payload]. */
function sum(x: unknown): [string, unknown] {
	if (isObj(x)) {
		const keys = Object.keys(x);
		if (keys.length === 2 && "tag" in x && "value" in x && typeof x.tag === "string") {
			return [x.tag, x.value];
		}
		if (keys.length === 1) return [keys[0] as string, x[keys[0] as string]];
	}
	throw new Error(`kernel schema: not a sum value: ${JSON.stringify(x)?.slice(0, 80)}`);
}

/** An option: `{ some } | { none }` (served) or the bare value (decoded). */
function opt(x: unknown): unknown {
	if (isObj(x)) {
		const keys = Object.keys(x);
		if (keys.length === 1 && keys[0] === "some") return x.some;
		if (keys.length === 1 && keys[0] === "none") return undefined;
	}
	return x === null ? undefined : x;
}

function str(x: unknown): string {
	const v = opt(x);
	if (typeof v !== "string") throw new Error(`kernel schema: expected a string, got ${JSON.stringify(v)}`);
	return v;
}

function num(x: unknown): number {
	const v = typeof x === "bigint" ? Number(x) : x;
	if (typeof v !== "number") throw new Error(`kernel schema: expected a number, got ${JSON.stringify(v)}`);
	return v;
}

function arr(x: unknown): unknown[] {
	return Array.isArray(x) ? x : [];
}

function hex(x: unknown): string {
	if (typeof x === "string") return `0x${x.toLowerCase()}`;
	const bytes = x instanceof Uint8Array ? [...x] : Object.values(x as Record<string, number>);
	return `0x${bytes.map((b) => Number(b).toString(16).padStart(2, "0")).join("")}`;
}

const SPECIAL_PRODUCTS: Record<string, string> = {
	__identity__: "Identity",
	__connection_id__: "ConnectionId",
	__timestamp_micros_since_unix_epoch__: "Timestamp",
	__time_duration_micros__: "TimeDuration",
	__uuid__: "Uuid",
};

function sorted<T>(entries: [string, T][]): Record<string, T> {
	return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

interface Member {
	readonly name: string | undefined;
	readonly type: unknown;
}

function members(product: unknown, list: "elements" | "variants"): Member[] {
	return arr(field(product, list)).map((m) => ({
		name: opt(field(m, "name")) as string | undefined,
		type: field(m, "algebraic_type"),
	}));
}

const isUnit = (ty: unknown) => {
	const [tag, value] = sum(ty);
	return tag === "Product" && members(value, "elements").length === 0;
};

type Snap = SchemaSnapshot;
type Kind = "table" | "view" | "reducer" | "procedure";

/**
 * A lazy reader over one RawModuleDefV10: each item renders on request, with
 * only the named types it reaches. The Typespace, Types and Schedules sections
 * are read up front; an item is not touched until it is asked for, so an item
 * a client never consumes cannot fail that client's check.
 */
export function moduleReader(def: unknown) {
	const sections = new Map<string, unknown>();
	let unnamedSections = 0;
	for (const s of arr(field(def, "sections"))) {
		// A section we cannot even name is skipped; every consumer below asks
		// only for the sections it needs.
		try {
			const [tag, value] = sum(s);
			sections.set(tag, value);
		} catch {
			unnamedSections++;
		}
	}
	const section = (tag: string) => sections.get(tag);
	const once = <T>(compute: () => T) => {
		let done = false;
		let value: T;
		return () => {
			if (!done) {
				value = compute();
				done = true;
			}
			return value as T;
		};
	};
	const typespace = once(() => arr(field(section("Typespace"), "types")));
	const typeNames = once(() => {
		const names = new Map<number, string>();
		for (const t of arr(section("Types"))) {
			const n = field(t, "source_name");
			names.set(num(field(t, "ty")), [...arr(field(n, "scope")).map(str), str(field(n, "source_name"))].join("."));
		}
		return names;
	});
	const ref = (i: number) => {
		const types = typespace();
		if (i < 0 || i >= types.length) throw new Error(`kernel schema: type ref ${i} is outside the typespace`);
		return types[i];
	};
	const schedules = once(() => {
		const out = new Map<string, [string, number]>();
		for (const s of arr(section("Schedules"))) {
			out.set(str(field(s, "table_name")), [str(field(s, "function_name")), num(field(s, "schedule_at_col"))]);
		}
		return out;
	});
	// The node serves a scheduled reducer as internal even when the wasm
	// declares it client-callable (observed on 2.10.0 and 2.10.1).
	const scheduled = once(() => new Set([...schedules().values()].map(([fn]) => fn)));
	const TAGS = { table: "Tables", view: "Views", reducer: "Reducers", procedure: "Procedures" } as const;
	const byKind = new Map<Kind, Map<string, unknown>>();
	/** Entries of one item section by name; read on first use, unnamed entries skipped. */
	const entries = (kind: Kind) => {
		let map = byKind.get(kind);
		if (!map) {
			map = new Map();
			for (const e of arr(section(TAGS[kind]))) {
				try {
					map.set(str(field(e, "source_name")), e);
				} catch {}
			}
			byKind.set(kind, map);
		}
		return map;
	};
	/**
	 * The module-level definitions every item depends on (typespace, type
	 * names, schedules). Throws when any of them cannot be read: the caller
	 * then cannot judge any item.
	 */
	const prepare = () => {
		typespace();
		typeNames();
		schedules();
	};

	/** Renders a type, adding every named type it reaches to `reached`. */
	const renderer = (reached: Set<number>) => {
		const render = (ty: unknown, seen: Set<number> = new Set()): string => {
			const [tag, value] = sum(ty);
			switch (tag) {
				case "Ref": {
					const i = num(value);
					const name = typeNames().get(i);
					if (name === undefined) {
						// An unnamed type is rendered inline; a cycle without a name cannot be.
						if (seen.has(i)) throw new Error(`kernel schema: unnamed recursive type ${i}`);
						return render(ref(i), new Set([...seen, i]));
					}
					if (!reached.has(i)) {
						reached.add(i);
						render(ref(i));
					}
					return name;
				}
				case "Array":
					return `Array<${render(value, seen)}>`;
				case "Product": {
					const elements = members(value, "elements");
					const only = elements.length === 1 ? elements[0] : undefined;
					const special = only?.name ? SPECIAL_PRODUCTS[only.name] : undefined;
					if (special) return special;
					if (elements.length === 0) return "()";
					return `{${elements.map((e, i) => `${e.name ?? i}: ${render(e.type, seen)}`).join(", ")}}`;
				}
				case "Sum": {
					const variants = members(value, "variants");
					if (variants.length === 2 && variants[0]?.name === "some" && variants[1]?.name === "none" && isUnit(variants[1].type)) {
						return `Option<${render(variants[0].type, seen)}>`;
					}
					return `(${variants.map((v, i) => (isUnit(v.type) ? `${v.name ?? i}` : `${v.name ?? i}(${render(v.type, seen)})`)).join(" | ")})`;
				}
				default:
					return tag;
			}
		};
		return render;
	};

	const renderItem = (kind: Kind, name: string, reached: Set<number>) => {
		const entry = entries(kind).get(name);
		if (entry === undefined) return undefined;
		const render = renderer(reached);
		const fields = (product: unknown) =>
			members(product, "elements").map((e, i) => `${e.name ?? i}: ${render(e.type)}`);
		const rowColumns = (i: number) => {
			const [tag, value] = sum(ref(i));
			if (tag !== "Product") throw new Error(`kernel schema: row type ${i} is not a product`);
			return members(value, "elements");
		};
		const visibility = (v: unknown) => (sum(v)[0] === "ClientCallable" ? "client" : "internal");
		if (kind === "table") {
			const t = entry;
			const elements = rowColumns(num(field(t, "product_type_ref")));
			const colName = (i: number) => elements[i]?.name ?? String(i);
			const cols = (ids: unknown[]) => ids.map((c) => colName(num(c)));
			const defaults = new Map<number, string>();
			for (const d of arr(field(t, "default_values"))) defaults.set(num(field(d, "col_id")), hex(field(d, "value")));
			const indexes = arr(field(t, "indexes")).map((ix): [string, string] => {
				const [algorithm, value] = sum(field(ix, "algorithm"));
				const columns = Array.isArray(value) ? value : [value];
				const accessor = (opt(field(ix, "accessor_name")) as string | undefined) ?? "";
				return [str(field(ix, "source_name")), `${accessor}: ${algorithm.toLowerCase()}(${cols(columns).join(", ")})`];
			});
			const unique = arr(field(t, "constraints"))
				.map((c) => sum(field(c, "data")))
				.filter(([tag]) => tag === "Unique")
				.map(([, v]) => cols(arr(field(v, "columns"))).join(", "))
				.sort();
			const schedule = schedules().get(name);
			const table: Snap["tables"][string] = {
				access: sum(field(t, "table_access"))[0].toLowerCase(),
				kind: sum(field(t, "table_type"))[0].toLowerCase(),
				event: field(t, "is_event") === true,
				columns: elements.map((e, i) => {
					const d = defaults.get(i);
					return `${e.name ?? i}: ${render(e.type)}${d === undefined ? "" : ` = ${d}`}`;
				}),
				primaryKey: cols(arr(field(t, "primary_key"))),
				unique,
				indexes: sorted(indexes),
				autoInc: arr(field(t, "sequences"))
					.map((s) => colName(num(field(s, "column"))))
					.sort(),
				...(schedule ? { schedule: `${schedule[0]}(${colName(schedule[1])})` } : {}),
			};
			return table;
		}
		if (kind === "view") {
			const v = entry;
			const ret = field(v, "return_type");
			let shape = "Value";
			let inner: unknown = ret;
			const [tag, value] = sum(ret);
			if (tag === "Array") {
				shape = "Array";
				inner = value;
			} else if (tag === "Sum") {
				const variants = members(value, "variants");
				if (variants[0]?.name === "some") {
					shape = "Option";
					inner = variants[0].type;
				}
			}
			const [innerTag, innerValue] = sum(inner);
			const rowRef = innerTag === "Ref" ? num(innerValue) : undefined;
			const columns =
				rowRef !== undefined && sum(ref(rowRef))[0] === "Product"
					? rowColumns(rowRef).map((e, i) => `${e.name ?? i}: ${render(e.type)}`)
					: undefined;
			const view: Snap["views"][string] = {
				public: field(v, "is_public") === true,
				anonymous: field(v, "is_anonymous") === true,
				params: fields(field(v, "params")),
				returns: columns ? shape : render(ret),
				...(columns ? { columns } : {}),
			};
			return view;
		}
		if (kind === "reducer") {
			const r = entry;
			const reducer: Snap["reducers"][string] = {
				visibility: scheduled().has(name) ? "internal" : visibility(field(r, "visibility")),
				params: fields(field(r, "params")),
				ok: render(field(r, "ok_return_type")),
				err: render(field(r, "err_return_type")),
			};
			return reducer;
		}
		const p = entry;
		const procedure: Snap["procedures"][string] = {
			visibility: visibility(field(p, "visibility")),
			params: fields(field(p, "params")),
			returns: render(field(p, "return_type")),
		};
		return procedure;
	};

	/** The named types in `reached`, rendered (rendering may reach more). */
	const renderTypes = (reached: Set<number>) => {
		const render = renderer(reached);
		const out: [string, unknown][] = [];
		const done = new Set<number>();
		for (let changed = true; changed; ) {
			changed = false;
			for (const i of [...reached].sort((a, b) => a - b)) {
				if (done.has(i)) continue;
				done.add(i);
				changed = true;
				const [tag, value] = sum(ref(i));
				const name = typeNames().get(i) as string;
				if (tag === "Product") {
					out.push([name, { product: members(value, "elements").map((e, k) => `${e.name ?? k}: ${render(e.type)}`) }]);
				} else if (tag === "Sum") {
					out.push([name, { sum: members(value, "variants").map((v, k) => `${v.name ?? k}: ${render(v.type)}`) }]);
				} else out.push([name, { alias: render(ref(i)) }]);
			}
		}
		return sorted(out);
	};

	const lifecycle = () =>
		sorted(
			arr(section("LifeCycleReducers")).map((l): [string, string] => [
				sum(field(l, "lifecycle_spec"))[0],
				str(field(l, "function_name")),
			]),
		);
	// The node fills ExplicitNames with identity mappings the wasm leaves out;
	// only a real rename (source != canonical) is part of the contract.
	const explicitNames = () =>
		arr(field(section("ExplicitNames"), "entries"))
			.map((e) => {
				const [kind, value] = sum(e);
				const source = str(field(value, "source_name"));
				const canonical = str(field(value, "canonical_name"));
				return source === canonical ? undefined : `${kind} ${source} -> ${canonical}`;
			})
			.filter((e): e is string => e !== undefined)
			.sort();

	return { entries, prepare, renderItem, renderTypes, lifecycle, explicitNames, unnamedSections: () => unnamedSections };
}

/**
 * Normalises a whole RawModuleDefV10 (the value inside the `V10` variant for
 * the decoded form; the served JSON body as is) into the snapshot shape.
 * Throws on anything it cannot read: the snapshot generator wants all of it.
 */
export function normaliseModuleDef(def: unknown): SchemaSnapshot {
	const reader = moduleReader(def);
	reader.prepare();
	if (reader.unnamedSections() > 0) throw new Error("kernel schema: a module definition section is not a sum value");
	const reached = new Set<number>();
	const all = <K extends Kind>(kind: K) =>
		sorted([...reader.entries(kind).keys()].map((name) => [name, reader.renderItem(kind, name, reached)] as [string, never]));
	const explicitNames = reader.explicitNames();
	return {
		tables: all("table"),
		views: all("view"),
		reducers: all("reducer"),
		procedures: all("procedure"),
		lifecycle: reader.lifecycle(),
		types: reader.renderTypes(reached),
		...(explicitNames.length > 0 ? { explicitNames } : {}),
	};
}

/** The `unchecked` item name when the module-level definitions cannot be read. */
export const MODULE_DEFINITION = "module definition";

export interface UncheckedItem {
	readonly item: string;
	readonly error: string;
}

/**
 * Normalises only the named tables, views and reducers and the types they
 * reach. An item that is absent is left out; an item that cannot be read is
 * reported in `unchecked` instead of failing the rest.
 */
export function normaliseItems(
	def: unknown,
	names: { readonly tables: readonly string[]; readonly reducers: readonly string[] },
): {
	readonly snapshot: SchemaSnapshot;
	readonly unchecked: readonly UncheckedItem[];
	/** The module-level definitions could not be read: no item was judged. */
	readonly moduleUnreadable: boolean;
} {
	const unchecked: UncheckedItem[] = [];
	const reader = moduleReader(def);
	try {
		reader.prepare();
	} catch (err) {
		// Without the typespace, type names or schedules no item can be judged.
		const empty: SchemaSnapshot = { tables: {}, views: {}, reducers: {}, procedures: {}, lifecycle: {}, types: {} };
		return { snapshot: empty, unchecked: [{ item: MODULE_DEFINITION, error: (err as Error).message }], moduleUnreadable: true };
	}
	const reached = new Set<number>();
	const pick = <K extends Kind>(kind: K, list: readonly string[]) => {
		const out: [string, never][] = [];
		for (const name of list) {
			if (!reader.entries(kind).has(name)) continue;
			// Render against a scratch set so a failed item adds no half-reached types.
			const local = new Set(reached);
			try {
				out.push([name, reader.renderItem(kind, name, local) as never]);
				for (const i of local) reached.add(i);
			} catch (err) {
				unchecked.push({ item: `${kind} ${name}`, error: (err as Error).message });
			}
		}
		return sorted(out);
	};
	const tables = pick("table", names.tables);
	const views = pick("view", names.tables);
	const reducers = pick("reducer", names.reducers);
	let types: Record<string, unknown> = {};
	try {
		types = reader.renderTypes(reached);
	} catch (err) {
		unchecked.push({ item: "named types", error: (err as Error).message });
	}
	return { snapshot: { tables, views, reducers, procedures: {}, lifecycle: {}, types }, unchecked, moduleUnreadable: false };
}

const fold = (s: string) => s.toLowerCase().replace(/_/g, "");
const MAP_SECTIONS = ["tables", "views", "reducers", "procedures", "lifecycle", "types"] as const;

/**
 * Names whose folded form collides with another name of the same snapshot
 * (`foo_bar` and `foobar`): those stay spelled as they are, or folding
 * would merge two items into one.
 */
function collisions(snapshot: SchemaSnapshot): Set<string> {
	// Names only collide within one namespace: one map of items, or the
	// members of one row, parameter list, product or sum.
	const groups: string[][] = MAP_SECTIONS.map((section) => Object.keys(snapshot[section] ?? {}));
	const member = (m: string) => m.slice(0, m.indexOf(": "));
	for (const t of Object.values(snapshot.tables)) groups.push(t.columns.map(member), Object.keys(t.indexes));
	for (const v of Object.values(snapshot.views)) groups.push((v.columns ?? []).map(member), v.params.map(member));
	for (const r of Object.values(snapshot.reducers)) groups.push(r.params.map(member));
	for (const d of Object.values(snapshot.types) as { product?: string[]; sum?: string[] }[]) {
		groups.push([...(d.product ?? []), ...(d.sum ?? [])].map(member));
	}
	const out = new Set<string>();
	for (const names of groups) {
		const byFold = new Map<string, Set<string>>();
		for (const n of names) {
			const set = byFold.get(fold(n)) ?? new Set<string>();
			set.add(n);
			byFold.set(fold(n), set);
		}
		for (const set of byFold.values()) if (set.size > 1) for (const n of set) out.add(n);
	}
	return out;
}

/**
 * The served definition is the node's canonical form: it re-cases
 * identifiers (`cell_res10` -> `cell_res_10`, enum variants lower case)
 * where the wasm's own definition keeps the source spelling. BSATN does not
 * carry names, so a connecting client compares shapes with every name folded
 * (lower case, no underscores) on both sides: column order, types, arity and
 * real renames still differ, spelling-only canonicalisation does not. Names
 * that would collide once folded (`keep`, default: computed from both
 * snapshots by the caller) keep their spelling.
 */
export function foldNames(snapshot: SchemaSnapshot, keep: ReadonlySet<string> = collisions(snapshot)): SchemaSnapshot {
	const f = (s: string) => (keep.has(s) ? s : fold(s));
	const text = (s: string) => s.replace(/[A-Za-z_][A-Za-z0-9_.]*/g, (w) => (/^0x/.test(w) ? w : f(w)));
	const walk = (value: unknown, keysAreNames: boolean): unknown => {
		if (typeof value === "string") return text(value);
		if (Array.isArray(value)) return value.map((v) => walk(v, false));
		if (isObj(value)) {
			return Object.fromEntries(
				Object.entries(value).map(([k, v]) => [
					keysAreNames ? f(k) : k,
					walk(v, !keysAreNames && (MAP_SECTIONS as readonly string[]).includes(k)) ,
				]),
			);
		}
		return value;
	};
	// Index maps are keyed by index name: fold those keys too.
	const folded = walk(snapshot, false) as SchemaSnapshot;
	for (const t of Object.values(folded.tables)) {
		(t as { indexes: Record<string, string> }).indexes = Object.fromEntries(
			Object.entries(t.indexes).map(([k, v]) => [f(k), v]),
		);
	}
	return folded;
}

/** The fold-collision set of two snapshots together. */
export function foldCollisions(a: SchemaSnapshot, b: SchemaSnapshot): Set<string> {
	return new Set([...collisions(a), ...collisions(b)]);
}

/**
 * The part of a snapshot a client uses: the named tables or views, the named
 * reducers, and every named type they reach. The SDK ships this, not the
 * whole snapshot.
 */
export function restrictSnapshot(
	snapshot: SchemaSnapshot,
	items: { readonly tables: readonly string[]; readonly reducers: readonly string[] },
): SchemaSnapshot {
	const pick = <T>(from: Readonly<Record<string, T>>, names: readonly string[]) =>
		sorted(names.filter((n) => n in from).map((n): [string, T] => [n, from[n] as T]));
	const tables = pick(snapshot.tables, items.tables);
	const views = pick(snapshot.views, items.tables);
	const reducers = pick(snapshot.reducers, items.reducers);
	const queue = [
		...Object.values(tables).flatMap((t) => t.columns),
		...Object.values(views).flatMap((v) => [...(v.columns ?? []), ...v.params, v.returns]),
		...Object.values(reducers).flatMap((r) => [...r.params, r.ok, r.err]),
	]
		// Members read `name: Type` (a column may end in ` = 0x..`); return types are bare.
		.map((text) => (text.includes(": ") ? text.slice(text.indexOf(": ") + 2).replace(/ = 0x[0-9a-f]*$/, "") : text))
		.flatMap((text) => typeNames(text).filter((n) => n in snapshot.types));
	const reached = new Set<string>();
	while (queue.length > 0) {
		const name = queue.pop() as string;
		if (reached.has(name)) continue;
		reached.add(name);
		const def = snapshot.types[name] as { product?: string[]; sum?: string[]; alias?: string };
		const texts = [...(def.product ?? []), ...(def.sum ?? [])].map((m) => m.slice(m.indexOf(": ") + 2));
		if (def.alias !== undefined) texts.push(def.alias);
		queue.push(...texts.flatMap((t) => typeNames(t).filter((n) => n in snapshot.types)));
	}
	return {
		tables,
		views,
		reducers,
		procedures: {},
		lifecycle: {},
		types: pick(snapshot.types, [...reached]),
	};
}
