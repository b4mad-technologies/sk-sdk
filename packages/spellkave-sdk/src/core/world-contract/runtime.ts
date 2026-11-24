/**
 * The connect-time verdict (sk-jay0.7.389.3): can THIS built client decode the
 * rows and call the reducers it uses on THAT served module? A different
 * question from the publish verdict in `classify.ts` (can the database
 * migrate?), so a different rule set:
 *
 *   - Rows are decoded positionally and sequentially: the TypeScript SDK reads
 *     a row list as `while (reader.remaining > 0) deserializeRow(reader)`
 *     (spacetimedb 2.10.1 `#parseRowList`). ANY difference in a consumed
 *     column list — an appended defaulted column included, either side —
 *     mis-decodes every row after the first. Breaking.
 *   - A named type a consumed column or argument reaches: any change breaks
 *     decoding, except a sum type the CLIENT extends (variants appended only
 *     on the client side: client newer than server, the roll window between
 *     image apply and world load) — the server never sends them.
 *   - Reducers the client calls: removed, turned internal, changed arguments
 *     (types, order, arity) or return types break the call. Breaking.
 *   - Access: a consumed table or view the server made private refuses the
 *     subscription. Breaking. View parameters and return shape: breaking.
 *   - Everything that does not touch BSATN or the call — indexes, unique and
 *     primary keys, auto-inc, schedules, table kind or event flag, view
 *     anonymity, default values, private -> public — is a diagnostic.
 *
 * Inputs are the client contract and the served items it names, both with
 * names folded (`normalise.ts` `foldNames`).
 */
import type { SchemaSnapshot, SchemaTable, SchemaView } from "./classify.ts";

export interface RuntimeChange {
	readonly verdict: "breaking" | "diagnostic";
	readonly item: string;
	/** Reads client -> server. */
	readonly detail: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const withoutDefault = (c: string) => c.replace(/ = 0x[0-9a-f]*$/, "");

function columns(item: string, client: readonly string[], server: readonly string[], out: RuntimeChange[]) {
	const c = client.map(withoutDefault);
	const s = server.map(withoutDefault);
	const n = Math.max(c.length, s.length);
	for (let i = 0; i < n; i++) {
		if (c[i] === s[i]) continue;
		const detail =
			c[i] === undefined
				? `column ${s[i]} exists only on the server (rows are decoded positionally)`
				: s[i] === undefined
					? `column ${c[i]} exists only on the client`
					: `column ${i + 1} changed: ${c[i]} -> ${s[i]}`;
		out.push({ verdict: "breaking", item, detail });
	}
	if (!same(client, server) && same(c, s)) out.push({ verdict: "diagnostic", item, detail: "column defaults differ" });
}

function table(name: string, client: SchemaTable, server: SchemaTable, out: RuntimeChange[]) {
	const item = `table ${name}`;
	if (client.access !== server.access) {
		out.push({
			verdict: server.access === "private" ? "breaking" : "diagnostic",
			item,
			detail: `access ${client.access} -> ${server.access}`,
		});
	}
	columns(item, client.columns, server.columns, out);
	const notes: [string, unknown, unknown][] = [
		["primary key", client.primaryKey, server.primaryKey],
		["unique constraints", client.unique, server.unique],
		["indexes", client.indexes, server.indexes],
		["auto-inc columns", client.autoInc, server.autoInc],
		["schedule", client.schedule ?? null, server.schedule ?? null],
		["table kind", [client.kind, client.event], [server.kind, server.event]],
	];
	for (const [what, c, s] of notes) {
		if (!same(c, s)) out.push({ verdict: "diagnostic", item, detail: `${what} differ: ${JSON.stringify(c)} -> ${JSON.stringify(s)}` });
	}
}

function view(name: string, client: SchemaView, server: SchemaView, out: RuntimeChange[]) {
	const item = `view ${name}`;
	if (client.public !== server.public) {
		out.push({ verdict: server.public ? "diagnostic" : "breaking", item, detail: `public ${client.public} -> ${server.public}` });
	}
	if (client.anonymous !== server.anonymous) {
		out.push({ verdict: "diagnostic", item, detail: `anonymous ${client.anonymous} -> ${server.anonymous}` });
	}
	if (!same(client.params, server.params)) {
		out.push({ verdict: "breaking", item, detail: `parameters (${client.params.join(", ")}) -> (${server.params.join(", ")})` });
	}
	if (client.returns !== server.returns) {
		out.push({ verdict: "breaking", item, detail: `return shape ${client.returns} -> ${server.returns}` });
	}
	columns(item, client.columns ?? [], server.columns ?? [], out);
}

function namedType(name: string, client: unknown, server: unknown, out: RuntimeChange[]) {
	if (same(client, server)) return;
	const item = `type ${name}`;
	const c = client as { sum?: string[] };
	const s = server as { sum?: string[] };
	if (c.sum && s.sum && s.sum.length < c.sum.length && same(c.sum.slice(0, s.sum.length), s.sum)) {
		out.push({ verdict: "diagnostic", item, detail: `variants only on the client: ${c.sum.slice(s.sum.length).join(", ")}` });
		return;
	}
	out.push({ verdict: "breaking", item, detail: `shape ${JSON.stringify(client)} -> ${JSON.stringify(server)}` });
}

/** Client contract vs served items, both folded. */
export function classifyRuntimeChange(client: SchemaSnapshot, server: SchemaSnapshot): RuntimeChange[] {
	const out: RuntimeChange[] = [];
	for (const [name, c] of Object.entries(client.tables)) {
		const s = server.tables[name];
		if (s) table(name, c, s, out);
		else out.push({ verdict: "breaking", item: `table ${name}`, detail: server.views[name] ? "is a view on the server" : "absent on the server" });
	}
	for (const [name, c] of Object.entries(client.views)) {
		const s = server.views[name];
		if (s) view(name, c, s, out);
		else out.push({ verdict: "breaking", item: `view ${name}`, detail: server.tables[name] ? "is a table on the server" : "absent on the server" });
	}
	for (const [name, c] of Object.entries(client.reducers)) {
		const item = `reducer ${name}`;
		const s = server.reducers[name];
		if (!s) {
			out.push({ verdict: "breaking", item, detail: "absent on the server" });
			continue;
		}
		if (c.visibility !== s.visibility) {
			out.push({ verdict: s.visibility === "client" ? "diagnostic" : "breaking", item, detail: `visibility ${c.visibility} -> ${s.visibility}` });
		}
		if (!same(c.params, s.params)) {
			out.push({ verdict: "breaking", item, detail: `arguments (${c.params.join(", ")}) -> (${s.params.join(", ")})` });
		}
		if (c.ok !== s.ok || c.err !== s.err) {
			out.push({ verdict: "breaking", item, detail: `return type ok ${c.ok}, err ${c.err} -> ok ${s.ok}, err ${s.err}` });
		}
	}
	// A type the client reaches but the server does not name any more shows up
	// as the column or argument that stopped mentioning it.
	for (const [name, c] of Object.entries(client.types)) {
		if (name in server.types) namedType(name, c, server.types[name], out);
	}
	return out;
}
