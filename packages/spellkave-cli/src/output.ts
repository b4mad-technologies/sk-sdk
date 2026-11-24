import { isDeepStrictEqual } from "node:util";
import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";
import type { OutputSink } from "@spellkave/cli-plugin";
import { encode as encodeToonDocument } from "@toon-format/toon";

export type OutputFormat = "auto" | "human" | "jsonl" | "json" | "toon";
export function isOutputFormat(value: unknown): value is OutputFormat {
	return (
		value === "auto" ||
		value === "human" ||
		value === "jsonl" ||
		value === "json" ||
		value === "toon"
	);
}
/** What a sink resolved `OutputFormat` to: the three presentations a record can take. */
export type ResolvedOutputFormat = "human" | "jsonl" | "toon";
export type StructuredRecord = Record<string, unknown>;

interface LineIo {
	out(line: string): void;
	err(line: string): void;
	/** Optional raw byte writer (no trailing newline). Falls back to out(latin1). */
	writeBytes?(data: Uint8Array): void;
	stdoutIsTTY?: boolean;
	stdoutColumns?: number;
}

/**
 * The command-facing output seam. Commands emit one structured record and do
 * not know whether a caller selected canonical JSONL or a human projection.
 */
export interface RecordIo extends OutputSink {
	record(value: StructuredRecord): void;
	err(line: string): void;
	/** Human-only guidance. Machine output remains silent beyond its JSONL records. */
	hint(line: string): void;
	/**
	 * Human-only raw line (no Markdown wrap). Used for terminal image escape
	 * sequences from pi-tui. Silent in JSONL mode.
	 */
	rawHuman(line: string): void;
	/**
	 * Human-only raw bytes (no Markdown, no forced trailing newline). For timg
	 * unicode/sixel output and Kitty sequences. Silent in JSONL mode.
	 */
	rawBytes(data: Uint8Array): void;
	/** Resolved presentation format for this sink. */
	readonly format: ResolvedOutputFormat;
	/** Return a sink for the same underlying IO with a different format. */
	withFormat?(format: OutputFormat): RecordIo;
}

const identity = (text: string): string => text;
const ansi =
	(open: string, close = "\u001b[0m") =>
	(text: string): string =>
		`${open}${text}${close}`;

function markdownTheme(color: boolean): MarkdownTheme {
	if (!color) {
		return {
			heading: identity,
			link: identity,
			linkUrl: identity,
			code: identity,
			codeBlock: identity,
			codeBlockBorder: identity,
			quote: identity,
			quoteBorder: identity,
			hr: identity,
			listBullet: identity,
			bold: identity,
			italic: identity,
			strikethrough: identity,
			underline: identity,
		};
	}

	const cyan = ansi("\u001b[36m");
	const boldCyan = ansi("\u001b[1;36m");
	const yellow = ansi("\u001b[33m");
	const dim = ansi("\u001b[2m");
	const bold = ansi("\u001b[1m");
	const italic = ansi("\u001b[3m", "\u001b[23m");
	const strike = ansi("\u001b[9m", "\u001b[29m");
	const underline = ansi("\u001b[4m", "\u001b[24m");

	return {
		heading: boldCyan,
		link: cyan,
		linkUrl: dim,
		code: yellow,
		codeBlock: yellow,
		codeBlockBorder: dim,
		quote: identity,
		quoteBorder: dim,
		hr: dim,
		listBullet: cyan,
		bold,
		italic,
		strikethrough: strike,
		underline,
	};
}

/**
 * `preferred` is a per-command default that applies only when the caller left
 * the format on `auto`, on a TTY and a pipe alike. An explicit `--format` (or a
 * configured `output.format`) always wins over it.
 */
export function resolveOutputFormat(
	format: OutputFormat,
	stdoutIsTTY: boolean,
	preferred?: OutputFormat,
): ResolvedOutputFormat {
	if (format === "json" || format === "jsonl") return "jsonl";
	if (format === "human") return "human";
	if (format === "toon") return "toon";
	if (preferred !== undefined && preferred !== "auto")
		return resolveOutputFormat(preferred, stdoutIsTTY);
	return stdoutIsTTY ? "human" : "jsonl";
}

function humanizeKey(key: string): string {
	const words = key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim();
	if (words.length === 0) return key;
	return words[0]?.toUpperCase() + words.slice(1);
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInlineScalar(value: unknown): boolean {
	return (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "number" ||
		(typeof value === "string" && !/[\r\n]/.test(value))
	);
}

function scalarText(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return value;
	return String(value);
}

function escapeTableCell(value: unknown): string {
	return scalarText(value).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function table(headers: string[], rows: unknown[][]): string {
	return [
		`| ${headers.map(escapeTableCell).join(" | ")} |`,
		`| ${headers.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row.map(escapeTableCell).join(" | ")} |`),
	].join("\n");
}

function heading(level: number, label: string): string {
	return `${"#".repeat(Math.min(6, Math.max(1, level)))} ${label.replace(/[\r\n]+/g, " ")}`;
}

/** Same lossless integer contract as SDK `log.ts` / world-author `widenBigInts`: bigint → decimal string (no `n` suffix). */
function bigintReplacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}

/** JSONL line for structured records. Does not throw on bigint. */
export function stringifyJsonl(value: unknown): string {
	return JSON.stringify(value, bigintReplacer) ?? "null";
}

/**
 * TOON document for one structured record (https://toonformat.dev). A pure,
 * generic record -> text function: it knows nothing about any command, so a
 * command that wants a tailored TOON shape builds that shape before it hands
 * the record to the sink. bigint becomes a decimal string exactly as in JSONL.
 */
export function stringifyToon(value: unknown): string {
	return encodeToonDocument(canonicalJsonValue(value));
}

function canonicalJsonValue(value: unknown): unknown {
	const json = stringifyJsonl(value);
	return json === undefined ? null : JSON.parse(json);
}

function fallbackJson(value: unknown): string {
	const seen = new WeakSet<object>();
	let rendered: string;
	try {
		rendered =
			JSON.stringify(
				value,
				(_key, current: unknown) => {
					if (typeof current === "bigint") return `${current}n`;
					if (typeof current === "function") return `[Function ${current.name || "anonymous"}]`;
					if (typeof current === "symbol") return String(current);
					if (typeof current === "object" && current !== null) {
						if (seen.has(current)) return "[Circular]";
						seen.add(current);
					}
					return current;
				},
				2,
			) ?? String(value);
	} catch {
		rendered = String(value);
	}
	return `~~~json\n${rendered}\n~~~`;
}

function recordLabel(record: StructuredRecord, index: number): string {
	for (const value of Object.values(record)) {
		if (typeof value === "string" && value.length > 0 && value.length <= 80) return value;
	}
	return `Item ${index + 1}`;
}

function sharedNamePrefix(records: StructuredRecord[]): string {
	const names = records.map((record) => record.name);
	if (!names.every((name): name is string => typeof name === "string" && name.length > 0)) {
		return "";
	}
	let prefix = names[0] ?? "";
	for (const name of names.slice(1)) {
		while (!name.startsWith(prefix)) prefix = prefix.slice(0, -1);
	}
	const boundary = Math.max(prefix.lastIndexOf("_"), prefix.lastIndexOf("/"));
	return boundary >= 3 ? prefix.slice(0, boundary + 1) : "";
}

function renderObjectArray(records: StructuredRecord[], level: number): string {
	const keys: string[] = [];
	for (const record of records) {
		for (const key of Object.keys(record)) {
			if (!keys.includes(key)) keys.push(key);
		}
	}

	// Large registries become unusable when every nested value expands below
	// the table (a tool list with per-tool flags previously exceeded 1,000
	// terminal lines). Keep the overview scannable and make any omitted,
	// record-specific fields explicit instead of silently dropping them.
	if (records.length > 8) {
		const commonKeys = keys.filter(
			(key) =>
				records.every((record) => key in record) &&
				records.every((record) => isInlineScalar(record[key])),
		);
		const omittedKeys = keys.filter((key) => !commonKeys.includes(key));
		const groupedByTopic =
			commonKeys.includes("topic") && records.every((record) => typeof record.topic === "string");
		const tableKeys = groupedByTopic ? commonKeys.filter((key) => key !== "topic") : commonKeys;
		const namePrefix = tableKeys.includes("name") ? sharedNamePrefix(records) : "";
		const renderRows = (rows: StructuredRecord[]): string =>
			table(
				tableKeys.map(humanizeKey),
				rows.map((record) =>
					tableKeys.map((key) =>
						key === "name" && namePrefix.length > 0
							? (record[key] as string).slice(namePrefix.length)
							: record[key],
					),
				),
			);
		const blocks: string[] = [];
		if (groupedByTopic) {
			const topics = [...new Set(records.map((record) => record.topic as string))];
			for (const topic of topics) {
				const rows = records.filter((record) => record.topic === topic);
				blocks.push(`${heading(level, topic)}\n\n${renderRows(rows)}`);
			}
		} else {
			blocks.push(renderRows(records));
		}
		if (namePrefix.length > 0) {
			blocks.push(`_Shared \`name\` prefix omitted from this overview: \`${namePrefix}\`._`);
		}
		if (omittedKeys.length > 0) {
			blocks.push(
				`_Optional fields omitted from this overview: ${omittedKeys
					.map((key) => `\`${key}\``)
					.join(", ")}. Use \`--format jsonl\` for the complete records._`,
			);
		}
		return blocks.join("\n\n");
	}

	const scalarKeys = keys.filter((key) =>
		records.every((record) => !(key in record) || isInlineScalar(record[key])),
	);
	const blocks: string[] = [];
	if (scalarKeys.length > 0) {
		blocks.push(
			table(
				scalarKeys.map(humanizeKey),
				records.map((record) => scalarKeys.map((key) => (key in record ? record[key] : ""))),
			),
		);
	}

	for (const [index, record] of records.entries()) {
		const nested = Object.entries(record).filter(([key]) => !scalarKeys.includes(key));
		if (nested.length === 0) continue;
		const nestedBlocks = nested.map(
			([key, value]) =>
				`${heading(level + 1, humanizeKey(key))}\n\n${renderValue(value, level + 2)}`,
		);
		blocks.push(`${heading(level, recordLabel(record, index))}\n\n${nestedBlocks.join("\n\n")}`);
	}

	return blocks.length > 0 ? blocks.join("\n\n") : "_Empty records._";
}

/** Long markdown fields that should render as prose, not a table cell. */
function isMarkdownBodyField(key: string, value: unknown): boolean {
	return (
		(key === "body" || key === "walkthrough") &&
		typeof value === "string" &&
		(value.includes("\n") || value.length > 160)
	);
}

/**
 * Doc-like objects (title + long body) lead with brief metadata then prose —
 * structural rule, not a per-tool renderer.
 */
function isDocLikeRecord(record: StructuredRecord): boolean {
	const body = record.body;
	return (
		typeof body === "string" &&
		isMarkdownBodyField("body", body) &&
		typeof record.title === "string"
	);
}

function renderObject(record: StructuredRecord, level: number): string {
	if (isDocLikeRecord(record)) {
		const blocks: string[] = [];
		const title = String(record.title);
		const rel =
			typeof record.rel === "string" ? record.rel : typeof record.id === "string" ? record.id : "";
		const summary = typeof record.summary === "string" ? record.summary : "";
		const kind = typeof record.kind === "string" ? record.kind : "";
		const section = typeof record.section === "string" ? record.section : "";
		const headBits = [
			rel ? `\`${rel}\`` : "",
			kind ? kind : "",
			section ? `§ ${section}` : "",
		].filter(Boolean);
		blocks.push(`${heading(level, title)}${headBits.length ? ` — ${headBits.join(" · ")}` : ""}`);
		if (summary) blocks.push(`_${summary}_`);
		if (
			Array.isArray(record.tools) &&
			record.tools.every(
				(row) =>
					isObject(row) &&
					typeof (row as { name?: unknown }).name === "string" &&
					typeof (row as { label?: unknown }).label === "string" &&
					typeof (row as { summary?: unknown }).summary === "string",
			)
		) {
			const tools = record.tools as Array<{ name: string; label: string; summary: string }>;
			blocks.push(
				table(
					["Tool", "Label", "Summary"],
					tools.map((tool) => [`\`${tool.name}\``, tool.label, tool.summary]),
				),
			);
		} else {
			blocks.push(String(record.body));
		}
		for (const [key, value] of Object.entries(record)) {
			if (
				key === "body" ||
				key === "title" ||
				key === "summary" ||
				key === "rel" ||
				key === "id" ||
				key === "kind" ||
				key === "section" ||
				key === "section_anchor" ||
				key === "tools" ||
				key === "headings" ||
				key === "hint" ||
				key === "outline" ||
				key === "oversized" ||
				key === "body_chars"
			) {
				continue;
			}
			if (
				key === "tags" &&
				Array.isArray(value) &&
				value.every((item) => typeof item === "string")
			) {
				blocks.push(`Tags: ${value.map((tag) => `\`${tag}\``).join(", ")}`);
				continue;
			}
			if (isMarkdownBodyField(key, value)) {
				blocks.push(`${heading(level + 1, humanizeKey(key))}\n\n${String(value)}`);
				continue;
			}
			if (isInlineScalar(value)) continue; // metadata already summarized
			blocks.push(`${heading(level + 1, humanizeKey(key))}\n\n${renderValue(value, level + 2)}`);
		}
		return blocks.join("\n\n");
	}

	const inline = Object.entries(record).filter(([, value]) => isInlineScalar(value));
	const nested = Object.entries(record).filter(([, value]) => !isInlineScalar(value));
	const blocks: string[] = [];

	if (inline.length > 0) {
		const numericMap = inline.length > 12 && inline.every(([, value]) => typeof value === "number");
		const visibleInline = numericMap ? inline.filter(([, value]) => value !== 0) : inline;
		const omittedZeroCount = inline.length - visibleInline.length;
		blocks.push(
			numericMap && visibleInline.length > 0
				? visibleInline
						.map(([key, value]) => `- **${humanizeKey(key)}** (\`${key}\`): ${scalarText(value)}`)
						.join("\n")
				: visibleInline.length > 0
					? table(
							["Field", "Value"],
							visibleInline.map(([key, value]) => [humanizeKey(key), value]),
						)
					: "_All fields are zero._",
		);
		if (omittedZeroCount > 0) {
			blocks.push(
				`_${omittedZeroCount} zero-valued fields omitted. Use \`--format jsonl\` for the complete record._`,
			);
		}
	}
	for (const [key, value] of nested) {
		if (key === "trace" && Array.isArray(value) && isTraceArray(value)) {
			blocks.push(`${heading(level, humanizeKey(key))}\n\n${renderTraceArray(value)}`);
			continue;
		}
		blocks.push(`${heading(level, humanizeKey(key))}\n\n${renderValue(value, level + 1)}`);
	}

	return blocks.length > 0 ? blocks.join("\n\n") : "_Empty object._";
}

interface TraceEntryRecord {
	node_id?: unknown;
	operator?: unknown;
	depth?: unknown;
	span?: unknown;
	scope?: unknown;
	value?: unknown;
	error?: unknown;
	table_entries?: unknown;
}

function isTraceArray(records: unknown[]): records is TraceEntryRecord[] {
	return (
		records.length > 0 &&
		records.every(
			(r) =>
				isObject(r) &&
				typeof r.node_id === "number" &&
				typeof r.depth === "number" &&
				("operator" in r || "value" in r || "error" in r) &&
				"scope" in r,
		)
	);
}

/** Project the externally-tagged Rust SubjectRef JSON into authored DSL notation. */
function renderSubjectRef(subject: unknown): string {
	if (typeof subject === "string") {
		const unitSubjects: Record<string, string> = {
			Actor: "actor",
			ActorWieldedItem: "actor.wielded_item",
			Target: "target",
			Location: "location",
			Session: "session",
			World: "world",
		};
		return unitSubjects[subject] ?? subject;
	}
	if (!isObject(subject)) return String(subject);

	const equipped = subject.ActorEquippedItem;
	if (isObject(equipped) && typeof equipped.slot_id === "string") {
		return `actor.equipped_item(${JSON.stringify(equipped.slot_id)})`;
	}
	const binding = subject.Binding;
	if (isObject(binding) && typeof binding.name === "string") return `binding:${binding.name}`;
	const event = subject.Event;
	if (event === "Kind") return "event.kind";
	if (isObject(event)) {
		const detail = event.Detail;
		if (isObject(detail) && typeof detail.field_id === "string") {
			return `event.detail:${detail.field_id}`;
		}
	}
	return fallbackJson(subject);
}

function renderTraceArray(entries: TraceEntryRecord[]): string {
	const headers = ["#", "Depth", "Operator", "Scope", "Value", "Table entries / Span", "Status"];
	const rows = entries.map((entry) => {
		const nodeId = typeof entry.node_id === "number" ? entry.node_id : 0;
		const depth = typeof entry.depth === "number" ? entry.depth : 0;
		const operator = typeof entry.operator === "string" ? entry.operator : "-";
		const hasError = typeof entry.error === "string" && entry.error.length > 0;
		const nodeCell = hasError ? `**! #${nodeId}**` : `#${nodeId}`;

		let scopeCell = "-";
		if (Array.isArray(entry.scope) && entry.scope.length > 0) {
			scopeCell = entry.scope
				.map((s: unknown) =>
					isObject(s) && "subject" in s && typeof s.slot === "string"
						? `${renderSubjectRef(s.subject)}.${s.slot}`
						: String(s),
				)
				.join(" > ");
		}

		let valueCell = "-";
		if (isObject(entry.value) && "value" in entry.value && "type" in entry.value) {
			valueCell = `${scalarText(entry.value.value)} (${scalarText(entry.value.type)})`;
		} else if (entry.value !== null && entry.value !== undefined) {
			valueCell = scalarText(entry.value);
		}

		const detailsParts: string[] = [];
		if (Array.isArray(entry.table_entries) && entry.table_entries.length > 0) {
			const tables = entry.table_entries
				.map((t: unknown) =>
					isObject(t) && typeof t.entry_id === "string"
						? `${t.entry_id}${t.kept ? " [kept]" : ""}`
						: String(t),
				)
				.join(", ");
			detailsParts.push(`table: ${tables}`);
		}
		if (
			isObject(entry.span) &&
			typeof entry.span.start === "number" &&
			typeof entry.span.end === "number"
		) {
			detailsParts.push(`span: ${entry.span.start}..${entry.span.end}`);
		}
		const detailsCell = detailsParts.length > 0 ? detailsParts.join(" · ") : "-";
		const statusCell = hasError ? `**FAILED: ${entry.error}**` : "ok";

		return [nodeCell, depth, operator, scopeCell, valueCell, detailsCell, statusCell];
	});

	return table(headers, rows);
}

function renderValue(value: unknown, level: number): string {
	if (isInlineScalar(value)) return scalarText(value);
	if (typeof value === "string") return value;
	if (
		isObject(value) &&
		typeof value.type === "string" &&
		"value" in value &&
		Object.keys(value).length === 2
	) {
		return `${scalarText(value.value)} (${value.type})`;
	}
	if (Array.isArray(value)) {
		if (value.length === 0) return "_None._";
		if (isTraceArray(value)) return renderTraceArray(value);
		if (value.every(isInlineScalar)) {
			return value.map((item) => `- ${escapeTableCell(item)}`).join("\n");
		}
		if (value.every(isObject)) return renderObjectArray(value, level);
		return value
			.map(
				(item, index) =>
					`${heading(level, `Item ${index + 1}`)}\n\n${renderValue(item, level + 1)}`,
			)
			.join("\n\n");
	}
	if (isObject(value)) return renderObject(value, level);
	return fallbackJson(value);
}

/**
 * Convert arbitrary JSON-compatible data into Markdown using structural rules
 * only. Tool names and record kinds remain ordinary data; neither selects a
 * bespoke renderer.
 */
export function projectJsonToMarkdown(value: unknown): string {
	try {
		return renderValue(canonicalJsonValue(value), 2);
	} catch {
		return fallbackJson(value);
	}
}

/**
 * Remove the registry's model-facing text only when it is demonstrably the
 * JSON serialization of details. Prose and independently useful text remain.
 */
export function prepareHumanRecord(record: StructuredRecord): StructuredRecord {
	const prepared =
		typeof record.kind === "string" && Object.keys(record).length > 1
			? Object.fromEntries(Object.entries(record).filter(([key]) => key !== "kind"))
			: record;
	return withoutDuplicateText(prepared);
}

/**
 * Drop `text` when it is the JSON serialization of `details` — the registry
 * emits both on every tool result (`content[0].text` for a model host,
 * `details` for structured consumers), so a JSONL reader would otherwise pay
 * for every payload twice (an `spellkave_orient` record measured 89 KB with
 * the duplicate and 31 KB without; sandbox/live-patch-loop/README.md, run 7).
 * Prose and independently useful text remain untouched.
 */
export function withoutDuplicateText(record: StructuredRecord): StructuredRecord {
	if (typeof record.text !== "string" || !("details" in record)) return record;
	try {
		const detailsJson = JSON.stringify(record.details);
		if (
			detailsJson === undefined ||
			!isDeepStrictEqual(JSON.parse(record.text), JSON.parse(detailsJson))
		) {
			return record;
		}
		const copy = { ...record };
		delete copy.text;
		return copy;
	} catch {
		return record;
	}
}

export function renderHumanRecord(
	record: StructuredRecord,
	options: { width: number; color?: boolean },
): string[] {
	const prepared = prepareHumanRecord(record);
	const markdown =
		record.kind === "error" && typeof prepared.message === "string"
			? `**Error:** ${prepared.message}`
			: typeof record.kind === "string"
				? `${heading(2, humanizeKey(record.kind))}\n\n${projectJsonToMarkdown(prepared)}`
				: projectJsonToMarkdown(prepared);
	const color = options.color === true;
	const renderer = new Markdown(markdown, 0, 0, markdownTheme(color));
	const lines = renderer.render(Math.max(40, options.width));
	// pi-tui >= 1.x closes wrapped table cells with an SGR reset even for a
	// plain theme; colourless output must stay free of escape sequences.
	return color ? lines : lines.map((line) => line.replace(SGR_SEQUENCE, ""));
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matches terminal SGR escapes by design.
const SGR_SEQUENCE = /\u001b\[[0-9;]*m/g;

function wrapHintLine(line: string, width: number): string[] {
	if (line.length <= width) return [line];
	const indent = line.match(/^\s*/)?.[0] ?? "";
	const separator = line.indexOf(" — ");
	if (separator > indent.length && separator <= width) {
		return [
			line.slice(0, separator),
			...wrapHintLine(`${indent}    ${line.slice(separator + 3)}`, width),
		];
	}
	const words = line.trim().split(/\s+/);
	const continuationIndent = indent.length > 0 ? indent : "";
	const lines: string[] = [];
	let current = indent;
	for (const word of words) {
		const candidate =
			current.trim().length === 0 ? `${continuationIndent}${word}` : `${current} ${word}`;
		if (candidate.length <= width || current.trim().length === 0) {
			current = candidate;
		} else {
			lines.push(current);
			current = `${continuationIndent}${word}`;
		}
	}
	if (current.length > 0) lines.push(current);
	return lines;
}

/**
 * Build one invocation-local output sink. Multiple human or TOON records are
 * separated by a blank line; JSONL remains exactly one JSON object per line.
 */
export function createRecordIo(
	io: LineIo,
	requested: OutputFormat,
	preferred?: OutputFormat,
): RecordIo {
	const format = resolveOutputFormat(requested, io.stdoutIsTTY === true, preferred);
	let wroteHumanRecord = false;
	let wroteToonRecord = false;
	return {
		format,
		withFormat: (newFormat: OutputFormat) => createRecordIo(io, newFormat, preferred),
		err: (line) => io.err(line),
		hint: (line) => {
			if (format !== "human") return;
			if (wroteHumanRecord) io.out("");
			const width = Math.max(40, io.stdoutColumns ?? 100);
			for (const sourceLine of line.split(/\r?\n/)) {
				for (const renderedLine of wrapHintLine(sourceLine, width)) io.out(renderedLine);
			}
			wroteHumanRecord = true;
		},
		rawHuman: (line) => {
			if (format !== "human") return;
			if (wroteHumanRecord) io.out("");
			io.out(line);
			wroteHumanRecord = true;
		},
		rawBytes: (data) => {
			if (format !== "human") return;
			if (io.writeBytes !== undefined) {
				io.writeBytes(data);
			} else {
				// Preserve bytes through a latin1 round-trip when only line IO exists.
				io.out(Buffer.from(data).toString("binary"));
			}
			wroteHumanRecord = true;
		},
		record: (value) => {
			if (format === "jsonl") {
				io.out(stringifyJsonl(withoutDuplicateText(value)));
				return;
			}
			if (format === "toon") {
				// One TOON document per record, a blank line between documents.
				if (wroteToonRecord) io.out("");
				for (const line of stringifyToon(withoutDuplicateText(value)).split("\n")) io.out(line);
				wroteToonRecord = true;
				return;
			}
			if (wroteHumanRecord) io.out("");
			const lines = renderHumanRecord(value, {
				width: io.stdoutColumns ?? 100,
				color: io.stdoutIsTTY === true && process.env.NO_COLOR === undefined,
			});
			for (const line of lines) io.out(line);
			wroteHumanRecord = true;
		},
	};
}
