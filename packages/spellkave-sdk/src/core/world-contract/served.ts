/**
 * Encodes a kernel schema snapshot back into the served SATS-JSON shape of
 * `/v1/database/<db>/schema?version=10` — the inverse of
 * {@link normaliseModuleDef} for every field the snapshot keeps. For tests and
 * fixtures: a connect test can serve exactly the module a client was built
 * for, or a deliberately altered one, without a node.
 */
import type { SchemaSnapshot } from "./classify.ts";
import { nameAndType, splitTop } from "./typetext.ts";

type Json = unknown;
const unit: Json = [];
const some = (v: Json) => ({ some: v });
const SPECIAL: Record<string, [string, string]> = {
	Identity: ["__identity__", "U256"],
	ConnectionId: ["__connection_id__", "U128"],
	Timestamp: ["__timestamp_micros_since_unix_epoch__", "I64"],
	TimeDuration: ["__time_duration_micros__", "I64"],
	Uuid: ["__uuid__", "U128"],
};
const PRIMITIVES = new Set([
	"Bool", "I8", "U8", "I16", "U16", "I32", "U32", "I64", "U64", "I128", "U128", "I256", "U256", "F32", "F64", "String",
]);

const element = (name: string, ty: Json) => ({ name: some(name), algebraic_type: ty });
const product = (elements: Json[]) => ({ Product: { elements } });

export function servedSchemaFromSnapshot(snapshot: SchemaSnapshot): Json {
	const typespace: Json[] = [];
	const typeIndex = new Map<string, number>();
	for (const name of Object.keys(snapshot.types)) {
		typeIndex.set(name, typespace.length);
		typespace.push(null);
	}
	const parse = (text: string): Json => {
		const t = text.trim();
		if (PRIMITIVES.has(t)) return { [t]: unit };
		if (t === "()") return product([]);
		const special = SPECIAL[t];
		if (special) return product([element(special[0], { [special[1]]: unit })]);
		if (t.startsWith("Array<")) return { Array: parse(t.slice(6, -1)) };
		if (t.startsWith("Option<")) {
			return { Sum: { variants: [element("some", parse(t.slice(7, -1))), element("none", product([]))] } };
		}
		if (t.startsWith("{")) {
			return product(splitTop(t.slice(1, -1), ", ").map((f) => element(...withType(nameAndType(f)))));
		}
		if (t.startsWith("(")) {
			return {
				Sum: {
					variants: splitTop(t.slice(1, -1), " | ").map((v) => {
						const open = v.indexOf("(");
						return open < 0 ? element(v, product([])) : element(v.slice(0, open), parse(v.slice(open + 1, -1)));
					}),
				},
			};
		}
		const ref = typeIndex.get(t);
		if (ref === undefined) throw new Error(`servedSchemaFromSnapshot: unknown type "${t}"`);
		return { Ref: ref };
	};
	const withType = ([name, type]: [string, string]): [string, Json] => [name, parse(type)];
	const columns = (cols: readonly string[]) =>
		cols.map((c) => {
			const [name, rest] = nameAndType(c);
			const eq = rest.lastIndexOf(" = 0x");
			return { name, type: eq >= 0 ? rest.slice(0, eq) : rest, def: eq >= 0 ? rest.slice(eq + 5) : undefined };
		});
	const row = (cols: readonly string[]) => {
		typespace.push(product(columns(cols).map((c) => element(c.name, parse(c.type)))));
		return typespace.length - 1;
	};
	for (const [name, def] of Object.entries(snapshot.types)) {
		const d = def as { product?: string[]; sum?: string[]; alias?: string };
		typespace[typeIndex.get(name) as number] = d.product
			? product(d.product.map((f) => element(...withType(nameAndType(f)))))
			: d.sum
				? { Sum: { variants: d.sum.map((v) => element(...withType(nameAndType(v)))) } }
				: parse(d.alias ?? "()");
	}

	const schedules: Json[] = [];
	const tables = Object.entries(snapshot.tables).map(([name, t]) => {
		const cols = columns(t.columns);
		const id = (c: string) => cols.findIndex((x) => x.name === c);
		if (t.schedule) {
			const open = t.schedule.indexOf("(");
			schedules.push({
				source_name: some(`${name}_sched`),
				table_name: name,
				schedule_at_col: id(t.schedule.slice(open + 1, -1)),
				function_name: t.schedule.slice(0, open),
			});
		}
		return {
			source_name: name,
			product_type_ref: row(t.columns),
			primary_key: t.primaryKey.map(id),
			indexes: Object.entries(t.indexes).map(([ix, text]) => {
				const [accessor, rest] = nameAndType(text);
				const open = rest.indexOf("(");
				const algorithm = rest.slice(0, open);
				const ids = splitTop(rest.slice(open + 1, -1), ", ").map(id);
				const tag = { btree: "BTree", hash: "Hash", direct: "Direct" }[algorithm] ?? algorithm;
				return {
					source_name: some(ix),
					accessor_name: accessor ? some(accessor) : { none: unit },
					algorithm: { [tag]: tag === "Direct" ? ids[0] : ids },
				};
			}),
			constraints: t.unique.map((u) => ({ source_name: some(`${name}_unique`), data: { Unique: { columns: splitTop(u, ", ").map(id) } } })),
			sequences: t.autoInc.map((c) => ({ source_name: some(`${name}_${c}_seq`), column: id(c) })),
			table_type: { [t.kind === "system" ? "System" : "User"]: unit },
			table_access: { [t.access === "public" ? "Public" : "Private"]: unit },
			default_values: cols.flatMap((c, i) => (c.def === undefined ? [] : [{ col_id: i, value: c.def }])),
			is_event: t.event,
		};
	});
	const params = (ps: readonly string[]) => ({ elements: ps.map((p) => element(...withType(nameAndType(p)))) });
	const views = Object.entries(snapshot.views).map(([name, v], index) => {
		let ret: Json;
		if (v.columns) {
			const inner = { Ref: row(v.columns) };
			ret =
				v.returns === "Array"
					? { Array: inner }
					: v.returns === "Option"
						? { Sum: { variants: [element("some", inner), element("none", product([]))] } }
						: inner;
		} else ret = parse(v.returns);
		return { source_name: name, index, is_public: v.public, is_anonymous: v.anonymous, params: params(v.params), return_type: ret };
	});
	const visibility = (v: string) => ({ [v === "client" ? "ClientCallable" : "Internal"]: unit });
	return {
		sections: [
			{ CaseConversionPolicy: { None: [] } },
			{ Typespace: { types: typespace } },
			{
				Types: Object.keys(snapshot.types).map((name) => {
					const parts = name.split(".");
					return { source_name: { scope: parts.slice(0, -1), source_name: parts.at(-1) }, ty: typeIndex.get(name), custom_ordering: true };
				}),
			},
			{ Tables: tables },
			{
				Reducers: Object.entries(snapshot.reducers).map(([name, r]) => ({
					source_name: name,
					params: params(r.params),
					visibility: visibility(r.visibility),
					ok_return_type: parse(r.ok),
					err_return_type: parse(r.err),
				})),
			},
			{
				Procedures: Object.entries(snapshot.procedures).map(([name, p]) => ({
					source_name: name,
					params: params(p.params),
					return_type: parse(p.returns),
					visibility: visibility(p.visibility),
				})),
			},
			{ Views: views },
			{ Schedules: schedules },
			{
				LifeCycleReducers: Object.entries(snapshot.lifecycle).map(([hook, fn]) => ({
					lifecycle_spec: { [hook]: unit },
					function_name: fn,
				})),
			},
			{ ExplicitNames: { entries: [] } },
		],
	};
}
