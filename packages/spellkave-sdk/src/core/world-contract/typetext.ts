/**
 * The type text grammar of the kernel schema snapshot (rendered by
 * `normalise.ts`): primitives (`U64`, `String`), special products
 * (`Identity`, `Timestamp`, ...), `()`, `Array<T>`, `Option<T>`,
 * products `{a: T, b: U}`, sums `(A | B(T))` and named types. Parsed
 * structurally so a field or variant that happens to share a type's name is
 * never mistaken for a reference to it.
 */

export type TypeNode =
	| { readonly kind: "name"; readonly name: string }
	| { readonly kind: "unit" }
	| { readonly kind: "array"; readonly of: TypeNode }
	| { readonly kind: "option"; readonly of: TypeNode }
	| { readonly kind: "product"; readonly fields: readonly (readonly [string, TypeNode])[] }
	| { readonly kind: "sum"; readonly variants: readonly (readonly [string, TypeNode | null])[] };

/** Splits at top-level occurrences of `sep`, ignoring nested brackets. */
export function splitTop(text: string, sep: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "<" || c === "{" || c === "(") depth++;
		else if (c === ">" || c === "}" || c === ")") depth--;
		else if (depth === 0 && text.startsWith(sep, i)) {
			parts.push(text.slice(start, i));
			start = i + sep.length;
			i += sep.length - 1;
		}
	}
	parts.push(text.slice(start));
	return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** `name: Type` -> [name, Type]. */
export function nameAndType(text: string): [string, string] {
	const i = text.indexOf(": ");
	return [text.slice(0, i), text.slice(i + 2)];
}

export function parseType(text: string): TypeNode {
	const t = text.trim();
	if (t === "()") return { kind: "unit" };
	if (t.startsWith("Array<") && t.endsWith(">")) return { kind: "array", of: parseType(t.slice(6, -1)) };
	if (t.startsWith("Option<") && t.endsWith(">")) return { kind: "option", of: parseType(t.slice(7, -1)) };
	if (t.startsWith("{") && t.endsWith("}")) {
		return {
			kind: "product",
			fields: splitTop(t.slice(1, -1), ", ").map((f) => {
				const [name, type] = nameAndType(f);
				return [name, parseType(type)] as const;
			}),
		};
	}
	if (t.startsWith("(") && t.endsWith(")")) {
		return {
			kind: "sum",
			variants: splitTop(t.slice(1, -1), " | ").map((v) => {
				const open = v.indexOf("(");
				return open < 0 ? ([v, null] as const) : ([v.slice(0, open), parseType(v.slice(open + 1, -1))] as const);
			}),
		};
	}
	return { kind: "name", name: t };
}

/** Every named type a type text refers to (primitives and special products included). */
export function typeNames(text: string): string[] {
	const out: string[] = [];
	const walk = (n: TypeNode | null) => {
		if (n === null) return;
		switch (n.kind) {
			case "name":
				out.push(n.name);
				return;
			case "array":
			case "option":
				walk(n.of);
				return;
			case "product":
				for (const [, f] of n.fields) walk(f);
				return;
			case "sum":
				for (const [, v] of n.variants) walk(v);
				return;
			default:
				return;
		}
	};
	walk(parseType(text));
	return out;
}
