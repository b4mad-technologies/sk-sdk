// Shared markdown renderer for every "walk a `ToolDefinition[]` registry
// structurally" doc generator (#1968 "docs as testable promises"). Extracted
// from the original `scripts/generate-authoring-tool-reference.ts` (the
// AUTHOR page) so `scripts/generate-companion-tool-reference.ts` (the
// PLAYER/operator + explorer-meta surfaces) renders identically without a
// second hand-copied implementation to drift.
//
// Every function here is pure and schema-shape-driven: given a tool's own
// TypeBox `parameters` schema (walked as plain JSON-Schema-shaped data, no
// TypeBox import needed), it can never lie about a name/required/type/
// default/description — that IS the tool's own runtime schema.

/** Minimal structural shape every TypeBox schema satisfies at runtime (they
 * are plain JSON-Schema-shaped objects — no class, no $ref for inline
 * object/array nesting any registered tool's params use). */
export interface JsonSchemaLike {
	type?: string;
	properties?: Record<string, JsonSchemaLike>;
	required?: string[];
	items?: JsonSchemaLike;
	anyOf?: JsonSchemaLike[];
	const?: unknown;
	description?: string;
	default?: unknown;
}

/** The structural shape a `ToolDefinition` (any registry, any TContext/R)
 * satisfies — enough to render a reference page from. */
export interface RenderableToolDef {
	name: string;
	label: string;
	description: string;
	parameters: JsonSchemaLike;
	executionMode: string;
}

function compareKey(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Strip GitHub issue/PR references (`#1968`, `PR #1969`, ...) from text
 * emitted into an AGENT-FACING generated doc page (#1968 follow-up,
 * PR #1969 review: "no PR/issue numbers in agent-facing generated docs —
 * provenance stays in code comments"). Source `description` strings keep
 * their refs — this only reshapes what the GENERATOR renders into the .md
 * page, never the source of truth an editor reads or the live tool schema a
 * host registers.
 *
 * Best-effort tidy-up, not a prose rewrite: removing a ref can leave a small
 * seam (e.g. "(#1968 decision)" -> "(decision)") — acceptable, since the goal
 * is "no bare issue numbers", not a hand-polished sentence.
 */
export function stripIssueRefs(text: string): string {
	return text
		.replace(/\bPR\s*#\d+\b/gi, "")
		.replace(/#\d+\b/g, "")
		.replace(/\(\s*[:,.]?\s*/g, "(")
		.replace(/\s+([:,.)])/g, "$1")
		.replace(/,\s*\)/g, ")")
		.replace(/\(\)/g, "")
		.replace(/  +/g, " ")
		.replace(/ +\n/g, "\n")
		.trim();
}

/** A short, single-line type label — enum literals render as `"a" | "b"`, arrays as `array<...>`. */
export function typeLabel(schema: JsonSchemaLike): string {
	if (schema.const !== undefined) return JSON.stringify(schema.const);
	if (schema.anyOf !== undefined) {
		const allLiterals = schema.anyOf.every((s) => s.const !== undefined);
		if (allLiterals) return schema.anyOf.map((s) => JSON.stringify(s.const)).join(" \\| ");
		return schema.anyOf.map(typeLabel).join(" \\| ");
	}
	if (schema.type === "array") {
		return `array<${schema.items ? typeLabel(schema.items) : "any"}>`;
	}
	if (schema.type === "object") return "object";
	return schema.type ?? "value";
}

function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

/**
 * Render a schema's own `properties` as a table, then recurse into every
 * object-shaped (or array-of-object-shaped) field as its own subsection —
 * `pathPrefix` accumulates the dotted field path (e.g. `effect.write.resource`)
 * so a deeply nested tool still reads as ONE flat walk instead of duplicated
 * ambiguous field names. Depth-capped generously (12) as a safety net only —
 * these schemas are finite TypeBox object literals with no self-reference, so
 * the cap is never expected to bind.
 */
export function renderObjectSchema(
	schema: JsonSchemaLike,
	headingLevel: number,
	pathPrefix: string,
	depth: number,
	lines: string[],
): void {
	if (depth > 12 || schema.properties === undefined) return;
	const required = new Set(schema.required ?? []);
	const entries = Object.entries(schema.properties).sort(([a], [b]) => compareKey(a, b));

	lines.push("| Field | Required | Type | Default | Description |");
	lines.push("|---|---:|---|---|---|");
	for (const [name, field] of entries) {
		const isRequired = required.has(name);
		const def = field.default !== undefined ? `\`${JSON.stringify(field.default)}\`` : "";
		lines.push(
			`| \`${name}\` | ${isRequired ? "yes" : "no"} | ${escapeCell(typeLabel(field))} | ${def} | ${escapeCell(stripIssueRefs(field.description ?? ""))} |`,
		);
	}
	lines.push("");

	for (const [name, field] of entries) {
		const childPath = pathPrefix.length > 0 ? `${pathPrefix}.${name}` : name;
		if (field.type === "object" && field.properties !== undefined) {
			lines.push(`${"#".repeat(Math.min(headingLevel + 1, 6))} \`${childPath}\``);
			lines.push("");
			renderObjectSchema(field, headingLevel + 1, childPath, depth + 1, lines);
		} else if (field.type === "array" && field.items?.type === "object" && field.items.properties !== undefined) {
			lines.push(`${"#".repeat(Math.min(headingLevel + 1, 6))} \`${childPath}[]\``);
			lines.push("");
			renderObjectSchema(field.items, headingLevel + 1, `${childPath}[]`, depth + 1, lines);
		}
	}
}

/**
 * A tool's worked example, resolved by the CALLER (the generator script —
 * this module stays pure/sync, executing a tool's `run` is neither) before
 * rendering: either the REAL result of calling `def.run(context,
 * exampleParams)` against an offline context, or an honest "no offline
 * example" marker for a tool whose `run` requires a live connection. Never a
 * hand-typed/fabricated result — see `ToolDefinition.exampleParams`
 * (`tool-registry.ts`).
 */
export type ToolExampleRender =
	| { kind: "executed"; params: unknown; result: unknown }
	| { kind: "requires_connection" };

function renderExample(example: ToolExampleRender | undefined, headingLevel: number): string[] {
	if (example === undefined) return [];
	const heading = "#".repeat(Math.min(headingLevel, 6));
	const lines: string[] = [`${heading} Example`, ""];
	if (example.kind === "requires_connection") {
		lines.push(
			"_Requires an active connection — no offline example; this tool cannot be demonstrated without a live/local target wired._",
		);
		lines.push("");
		return lines;
	}
	lines.push("Call:");
	lines.push("");
	lines.push("```json");
	lines.push(JSON.stringify(example.params, null, 2));
	lines.push("```");
	lines.push("");
	lines.push("Result:");
	lines.push("");
	lines.push("```json");
	lines.push(JSON.stringify(example.result, null, 2));
	lines.push("```");
	lines.push("");
	return lines;
}

/** One `## \`tool_name\`` section: label + execution mode, description, param walk, optional example. */
export function toolSection(def: RenderableToolDef, example?: ToolExampleRender): string {
	const lines: string[] = [];
	lines.push(`## \`${def.name}\``);
	lines.push("");
	lines.push(`**${def.label}** — execution mode \`${def.executionMode}\`.`);
	lines.push("");
	lines.push(stripIssueRefs(def.description));
	lines.push("");
	renderObjectSchema(def.parameters, 3, "", 0, lines);
	lines.push(...renderExample(example, 3));
	return lines.join("\n");
}

/**
 * A TOC entry linking to a `toolSection`'s own heading. GitHub's
 * heading-slug algorithm lowercases and strips backticks/punctuation but
 * keeps underscores/hyphens verbatim — `## \`spellkave_docs\`` slugs to
 * `#spellkave_docs`, not `#spellkavedocs`.
 */
export function tocEntry(def: RenderableToolDef): string {
	return `- [\`${def.name}\`](#${def.name}) — ${def.label}`;
}

/** Collapse the blank-line runs `toolSection`/join produce down to the doc's own convention. */
export function tidy(markdown: string): string {
	return markdown.replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "\n");
}
