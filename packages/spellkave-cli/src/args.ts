// Schema-derived argument parsing (#1983).
//
// The whole point of this CLI is that NO tool is named here. Every flag,
// every help line, and every validation message is derived at runtime from a
// tool's own typebox `parameters` schema — the same object the Pi extension
// hands the model. Adding a tool to `authorFacingToolDefinitions` therefore
// makes it callable here with zero edits in this package.
//
// Typebox schemas are plain JSON-Schema-shaped objects at runtime
// (`{ type: "object", properties, required }`), so this module reads them
// structurally rather than through a typebox API — which also keeps it honest
// about the parts it CANNOT flatten into flags (nested objects, tuples,
// unions), where it falls back to `--json`.

import type { TSchema } from "typebox";

/** How a single parameter can be supplied on the command line. */
export type FlagKind =
	| "string"
	| "string-or-json"
	| "number"
	| "integer"
	| "boolean"
	| "string-list"
	| "number-list"
	| "json";

export interface FlagSpec {
	/** Parameter name as the schema declares it (e.g. `bundle`). */
	name: string;
	/** The flag a caller types (e.g. `--bundle`). */
	flag: string;
	kind: FlagKind;
	required: boolean;
	description?: string;
	/** The allowed values when the schema is a union of string literals (e.g. `auto|manual`). */
	choices?: string[];
}

interface JsonSchemaish {
	type?: string;
	properties?: Record<string, JsonSchemaish>;
	required?: string[];
	items?: JsonSchemaish;
	description?: string;
	anyOf?: unknown[];
	enum?: unknown[];
}

/**
 * Classify one property schema into the way it can be typed on a command
 * line. Anything with structure a shell cannot express in one token
 * (objects, tuples, arrays of objects, unions) becomes `json`: still
 * callable, but only via `--<name> '<json>'` or the whole-payload `--json`.
 */
function classify(schema: JsonSchemaish): FlagKind {
	if (Array.isArray(schema.anyOf)) {
		if (
			schema.anyOf.some((member) => (member as JsonSchemaish)?.type === "string") &&
			schema.anyOf.some((member) => (member as JsonSchemaish)?.type === "object")
		)
			return "string-or-json";
		// A union of string literals (an enum-ish) is still one shell token.
		const allStringy = schema.anyOf.every(
			(member) =>
				typeof member === "object" &&
				member !== null &&
				((member as JsonSchemaish).type === "string" || "const" in (member as object)),
		);
		return allStringy ? "string" : "json";
	}
	switch (schema.type) {
		case "string":
			return "string";
		case "number":
			return "number";
		case "integer":
			return "integer";
		case "boolean":
			return "boolean";
		case "array":
			if (schema.items?.type === "string") return "string-list";
			if (schema.items?.type === "integer" || schema.items?.type === "number") {
				return "number-list";
			}
			return "json";
		default:
			return "json";
	}
}

/**
 * Derive the per-tool flag surface from its parameters schema. Order follows
 * the schema's own property order, so generated help reads in the order the
 * tool author declared — the same order the model sees.
 */
export function deriveFlags(parameters: TSchema): FlagSpec[] {
	// A TypeBox schema is a plain JSON Schema object; only the keys of JsonSchemaish are read.
	const schema = parameters as JsonSchemaish;
	const properties = schema.properties ?? {};
	const required = new Set(schema.required ?? []);
	return Object.entries(properties).map(([name, sub]) => {
		const choices = literalChoices(sub);
		return {
			name,
			flag: `--${name.replace(/_/g, "-")}`,
			kind: classify(sub),
			required: required.has(name),
			...(sub.description === undefined ? {} : { description: sub.description }),
			...(choices === undefined ? {} : { choices }),
		};
	});
}

/** `["auto", "manual"]` for a union of string literals; `undefined` otherwise. */
function literalChoices(schema: JsonSchemaish): string[] | undefined {
	if (!Array.isArray(schema.anyOf) || schema.anyOf.length === 0) return undefined;
	const values = schema.anyOf.map((member) =>
		typeof member === "object" && member !== null
			? (member as { const?: unknown }).const
			: undefined,
	);
	return values.every((value) => typeof value === "string") ? (values as string[]) : undefined;
}

/** Raised for anything the CALLER got wrong — mapped to the usage exit code. */
export class UsageError extends Error {}

function coerce(spec: FlagSpec, raw: string): unknown {
	switch (spec.kind) {
		case "string":
			return raw;
		case "string-or-json":
			if (raw.trimStart().startsWith("{") || raw.trimStart().startsWith('"')) {
				try {
					return JSON.parse(raw);
				} catch (err) {
					throw new UsageError(`${spec.flag}: expected JSON — ${(err as Error).message}`);
				}
			}
			return raw;
		case "number":
		case "integer": {
			const value = Number(raw);
			if (Number.isNaN(value)) {
				throw new UsageError(`${spec.flag}: expected a number, got ${JSON.stringify(raw)}.`);
			}
			return value;
		}
		case "boolean":
			if (raw === "true") return true;
			if (raw === "false") return false;
			throw new UsageError(`${spec.flag}: expected true or false, got ${JSON.stringify(raw)}.`);
		case "number-list": {
			const trimmed = raw.trim();
			if (trimmed.startsWith("[")) {
				try {
					const parsed = JSON.parse(trimmed);
					if (Array.isArray(parsed) && parsed.every((n) => typeof n === "number")) {
						return parsed;
					}
				} catch {
					// Fall through to parse comma-separated or single number
				}
			}
			const parts = trimmed.includes(",") ? trimmed.split(",") : [trimmed];
			return parts
				.map((p) => p.trim())
				.filter((p) => p.length > 0)
				.map((p) => {
					const n = Number(p);
					if (Number.isNaN(n)) {
						throw new UsageError(`${spec.flag}: expected a number, got ${JSON.stringify(p)}.`);
					}
					return n;
				});
		}
		default:
			try {
				return JSON.parse(raw);
			} catch (err) {
				throw new UsageError(`${spec.flag}: expected JSON — ${(err as Error).message}`);
			}
	}
}

/**
 * Parse a tool's argv tail into a params object.
 *
 * Two shapes compose (per-flag wins over the whole-payload base, so
 * `--json '{"kind":"a"}' --kind b` yields `kind: "b"`):
 *
 *   sk <tool> --json '{"kind":"entity_definitions"}'
 *   sk <tool> --kind entity_definitions --refs false
 *   sk <tool> <value>  # only for positionals declared by registry metadata
 *
 * `--flag=value` and `--flag value` are equivalent; a boolean flag with no
 * value means `true`, and `--no-<flag>` means `false`. A `string-list` flag
 * repeats (`--tag a --tag b`) or accepts a JSON string array. Positional arguments are opt-in per tool and
 * map to the declared parameter names in order; undeclared positionals remain
 * usage errors.
 */
export function parseToolArgs(
	flags: FlagSpec[],
	argv: string[],
	positionalNames: readonly string[] = [],
): Record<string, unknown> {
	const byFlag = new Map(flags.map((spec) => [spec.flag, spec]));
	const positionals = positionalNames.map((name) => {
		const spec = flags.find((candidate) => candidate.name === name);
		if (spec === undefined) {
			throw new UsageError(
				`invalid CLI metadata: positional parameter ${JSON.stringify(name)} is absent.`,
			);
		}
		return spec;
	});
	const params: Record<string, unknown> = {};
	let positionalIndex = 0;

	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i] as string;
		if (!token.startsWith("--")) {
			const spec = positionals[positionalIndex++];
			if (spec === undefined) {
				throw new UsageError(`unexpected positional argument ${JSON.stringify(token)}.`);
			}
			params[spec.name] = coerce(spec, token);
			continue;
		}
		const eq = token.indexOf("=");
		const name = eq === -1 ? token : token.slice(0, eq);
		const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

		// The whole-payload escape hatch: parameters with real structure
		// (nested objects, tuples) are only expressible this way.
		if (name === "--json") {
			const raw = inlineValue ?? argv[++i];
			if (raw === undefined) throw new UsageError("--json: missing JSON payload.");
			let parsed: unknown;
			try {
				parsed = JSON.parse(raw);
			} catch (err) {
				throw new UsageError(`--json: ${(err as Error).message}`);
			}
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				throw new UsageError("--json: payload must be a JSON object.");
			}
			Object.assign(params, parsed);
			continue;
		}

		// A parameter literally named `no-<x>` (e.g. sk dev restore --no-hero next
		// to the string --hero) wins over reading the flag as a negation of <x>.
		const exact = byFlag.get(name);
		const negated = exact === undefined && name.startsWith("--no-");
		const spec = exact ?? byFlag.get(negated ? `--${name.slice(5)}` : name);
		if (spec === undefined) {
			throw new UsageError(`unknown flag ${name} — run \`sk help <tool>\` for this tool's flags.`);
		}
		if (negated) {
			if (spec.kind !== "boolean") {
				throw new UsageError(`--no-${spec.name} is only valid for boolean parameters.`);
			}
			params[spec.name] = false;
			continue;
		}
		if (spec.kind === "boolean" && inlineValue === undefined) {
			// Bare `--flag` is true; a following token is only consumed when it
			// is an explicit literal, so `--refs --kind x` stays unambiguous.
			const next = argv[i + 1];
			if (next === "true" || next === "false") {
				params[spec.name] = next === "true";
				i += 1;
			} else {
				params[spec.name] = true;
			}
			continue;
		}
		const raw = inlineValue ?? argv[++i];
		if (raw === undefined) throw new UsageError(`${spec.flag}: missing value.`);
		if (spec.kind === "string-list") {
			const list = Array.isArray(params[spec.name]) ? (params[spec.name] as unknown[]) : [];
			if (raw.trimStart().startsWith("[")) {
				let values: unknown;
				try {
					values = JSON.parse(raw);
				} catch {
					throw new UsageError(`${spec.flag}: expected a JSON string array or a plain value.`);
				}
				if (!Array.isArray(values) || values.some((value) => typeof value !== "string")) {
					throw new UsageError(`${spec.flag}: expected a JSON string array or a plain value.`);
				}
				list.push(...values);
			} else {
				list.push(raw);
			}
			params[spec.name] = list;
			continue;
		}
		if (spec.kind === "number-list") {
			const list = Array.isArray(params[spec.name]) ? (params[spec.name] as number[]) : [];
			const coerced = coerce(spec, raw) as number[];
			list.push(...coerced);
			params[spec.name] = list;
			continue;
		}
		params[spec.name] = coerce(spec, raw);
	}

	return params;
}
