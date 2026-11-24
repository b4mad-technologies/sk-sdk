// Pure snapshot replay helpers.
//
// This entry intentionally has no live SpacetimeDB connection import and no
// reducer surface. Reviewer/demo apps can replay captured rows without pulling
// in connection construction or mutation-capable handles.

interface TableHandle {
	iter(): Iterable<Record<string, unknown>>;
	/** Optional host delivery context and inserted row; snapshot-only hosts may omit both. */
	onInsert?: (cb: (context?: unknown, row?: unknown) => void) => void;
	removeOnInsert?: (cb: (context?: unknown, row?: unknown) => void) => void;
	onDelete?: (cb: () => void) => void;
	removeOnDelete?: (cb: () => void) => void;
	onUpdate?: (cb: () => void) => void;
	removeOnUpdate?: (cb: () => void) => void;
}

export interface SnapshotDb {
	[accessor: string]: TableHandle | undefined;
}

export type SnapshotFixtureTables = Record<string, Iterable<Record<string, unknown>>>;

export interface SnapshotCaptureFrame {
	kind: "spellkave.snapshot_frame";
	version: 1;
	/** Logical world tick represented by this checkpoint. */
	tick: number;
	/** Binding-layer table rows, keyed by generated table accessor name. */
	tables: Record<string, Record<string, unknown>[]>;
}

export interface WorldEventRow {
	id: string;
	tick: number;
	kind: string;
	summary?: string;
}

// ── Portable UI recordings ───────────────────────────────────────────────

/**
 * A deliberately small, host-neutral envelope for a bounded client-side
 * recording. Surface adapters own the payload schema: this module only owns
 * retention, cursor semantics, JSON safety and the outer version marker.
 */
export const RECORDING_ENVELOPE_KIND = "spellkave.recording" as const;
export const RECORDING_ENVELOPE_VERSION = 2 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface RecordingFrame<T extends JsonValue> {
	/** Stable reference for authored scenario transitions. */
	id: string;
	/** Monotonic insertion sequence. It disambiguates equal wall-clock times. */
	sequence: number;
	/** Client wall-clock time for retention and display, never world truth. */
	capturedAt: number;
	payload: T;
}

/** Deliberately allowlisted capture context. Never place account or credential data here. */
export interface RecordingProvenance {
	source: "live" | "legacy" | "fixture";
	build?: string;
	title?: string;
}

export type RecordingCursor = { kind: "live" } | { kind: "paused"; sequence: number };

export interface RecordingEnvelope<T extends JsonValue> {
	kind: typeof RECORDING_ENVELOPE_KIND;
	version: typeof RECORDING_ENVELOPE_VERSION;
	/** Stable recording identity; scenario layers refer to frame ids beneath it. */
	id: string;
	surface: string;
	capturedAt: number;
	provenance?: RecordingProvenance;
	frames: RecordingFrame<T>[];
}

export interface BoundedRecordingOptions {
	/** Maximum retained frames. Must be a positive integer. */
	limit: number;
	/** Optional wall-clock retention window. Omit for count-only retention. */
	maxAgeMs?: number;
	/** Test seam; defaults to Date.now. */
	now?: () => number;
	/** Stable identity to retain across exports. Omit to derive one at first export. */
	id?: string;
}

export interface RecordingExportOptions {
	/** Pins the recording identity when the buffer was constructed without one. */
	id?: string;
	/** Optional, safe capture context for checked-in recordings. */
	provenance?: RecordingProvenance;
}

/**
 * A small FIFO timeline. Pausing changes only which retained frame is read;
 * new live frames still enter the buffer, just like the Maps watch radar.
 * Every public payload is JSON-cloned at the boundary so callers cannot
 * mutate the history by retaining a reference.
 */
export class BoundedRecording<T extends JsonValue> {
	private readonly limit: number;
	private readonly maxAgeMs: number | undefined;
	private readonly now: () => number;
	private stored: RecordingFrame<T>[] = [];
	private nextSequence = 1;
	private mode: RecordingCursor = { kind: "live" };
	private id: string | undefined;

	constructor(options: BoundedRecordingOptions) {
		if (!Number.isInteger(options.limit) || options.limit < 1) {
			throw new Error("recording limit must be a positive integer");
		}
		if (
			options.maxAgeMs !== undefined &&
			(!Number.isFinite(options.maxAgeMs) || options.maxAgeMs < 0)
		) {
			throw new Error("recording maxAgeMs must be a non-negative finite number");
		}
		this.limit = options.limit;
		this.maxAgeMs = options.maxAgeMs;
		this.now = options.now ?? (() => Date.now());
		if (options.id !== undefined && !isStableId(options.id)) {
			throw new Error("recording id must be a bounded stable identifier");
		}
		this.id = options.id;
	}

	record(payload: T): RecordingFrame<T> {
		const sequence = this.nextSequence++;
		const capturedAt = this.now();
		const frame: RecordingFrame<T> = {
			id: `frame_${stableHash(canonicalJson({ sequence, capturedAt, payload }))}`,
			sequence,
			capturedAt,
			payload: cloneJson(payload),
		};
		if (this.stored.some((stored) => stored.id === frame.id)) {
			throw new Error("recording generated a duplicate frame id");
		}
		this.stored.push(frame);
		this.prune(frame.capturedAt);
		return cloneJson(frame);
	}

	pause(): void {
		const latest = this.stored.at(-1);
		if (latest !== undefined) this.mode = { kind: "paused", sequence: latest.sequence };
	}

	play(): void {
		this.mode = { kind: "live" };
	}

	scrub(sequence: number): void {
		if (!Number.isInteger(sequence) || this.stored.length === 0) return;
		const first = this.stored[0]?.sequence ?? 0;
		const last = this.stored.at(-1)?.sequence ?? 0;
		this.mode = { kind: "paused", sequence: Math.max(first, Math.min(last, sequence)) };
	}

	cursor(): RecordingCursor {
		return { ...this.mode };
	}

	frames(): RecordingFrame<T>[] {
		return cloneJson(this.stored);
	}

	frameAtCursor(): RecordingFrame<T> | null {
		if (this.stored.length === 0) return null;
		if (this.mode.kind === "live") return cloneJson(this.stored.at(-1) as RecordingFrame<T>);
		let found: RecordingFrame<T> | undefined;
		for (const frame of this.stored) {
			if (frame.sequence <= this.mode.sequence) found = frame;
			if (frame.sequence === this.mode.sequence) break;
		}
		return found === undefined ? null : cloneJson(found);
	}

	export(surface: string, options: RecordingExportOptions = {}): RecordingEnvelope<T> {
		if (!isSurface(surface))
			throw new Error("recording surface must be a bounded non-empty string");
		if (options.id !== undefined && !isStableId(options.id)) {
			throw new Error("recording id must be a bounded stable identifier");
		}
		if (this.id !== undefined && options.id !== undefined && this.id !== options.id) {
			throw new Error("recording id cannot change after it is established");
		}
		this.id ??= options.id ?? generatedRecordingId();
		if (!isProvenance(options.provenance))
			throw new Error("recording provenance is not allowlisted");
		const frames = this.frames();
		return {
			kind: RECORDING_ENVELOPE_KIND,
			version: RECORDING_ENVELOPE_VERSION,
			id: this.id,
			surface,
			capturedAt: this.now(),
			...(options.provenance === undefined ? {} : { provenance: cloneJson(options.provenance) }),
			frames,
		};
	}

	private prune(now: number): void {
		while (this.stored.length > this.limit) this.stored.shift();
		if (this.maxAgeMs !== undefined) {
			const oldestAllowed = now - this.maxAgeMs;
			while ((this.stored[0]?.capturedAt ?? oldestAllowed) < oldestAllowed) this.stored.shift();
		}
		if (
			this.mode.kind === "paused" &&
			this.stored.length > 0 &&
			this.mode.sequence < (this.stored[0]?.sequence ?? 0)
		) {
			this.mode = { kind: "paused", sequence: this.stored[0]?.sequence ?? this.mode.sequence };
		}
	}
}

/** Parse the shared envelope, then delegate the surface-specific payload check. */
export function parseRecordingEnvelope<T extends JsonValue>(
	value: unknown,
	options: { surface: string; parsePayload: (value: JsonValue) => T | null },
): RecordingEnvelope<T> | null {
	if (!isJsonRecord(value)) return null;
	if (value.kind !== RECORDING_ENVELOPE_KIND || !isJsonValue(value.version)) return null;
	if (value.version === 1) return migrateV1(value, options);
	if (
		value.version !== RECORDING_ENVELOPE_VERSION ||
		!hasOnlyKeys(value, ["kind", "version", "id", "surface", "capturedAt", "provenance", "frames"])
	)
		return null;
	const { id, capturedAt } = value;
	if (
		!isStableId(id) ||
		value.surface !== options.surface ||
		!isSurface(value.surface) ||
		!isFiniteNumber(capturedAt) ||
		!isProvenance(value.provenance) ||
		!Array.isArray(value.frames)
	)
		return null;
	return parseFrames(value.frames, options, { id, capturedAt, provenance: value.provenance });
}

function migrateV1<T extends JsonValue>(
	value: { [key: string]: JsonValue },
	options: { surface: string; parsePayload: (value: JsonValue) => T | null },
): RecordingEnvelope<T> | null {
	if (!hasOnlyKeys(value, ["kind", "version", "surface", "capturedAt", "frames"])) return null;
	const { capturedAt } = value;
	if (
		value.surface !== options.surface ||
		!isSurface(value.surface) ||
		!isFiniteNumber(capturedAt) ||
		!Array.isArray(value.frames)
	)
		return null;
	const id = `legacy_${stableHash(canonicalJson(value))}`;
	return parseFrames(value.frames, options, {
		id,
		capturedAt,
		provenance: { source: "legacy" },
		migrateLegacyFrames: true,
	});
}

function parseFrames<T extends JsonValue>(
	rawFrames: JsonValue[],
	options: { surface: string; parsePayload: (value: JsonValue) => T | null },
	envelope: {
		id: string;
		capturedAt: number;
		provenance: RecordingProvenance | undefined;
		migrateLegacyFrames?: boolean;
	},
): RecordingEnvelope<T> | null {
	if (rawFrames.length > MAX_RECORDING_FRAMES) return null;
	let previous = 0;
	const ids = new Set<string>();
	const frames: RecordingFrame<T>[] = [];
	for (const raw of rawFrames) {
		if (!isJsonRecord(raw)) return null;
		const allowedKeys = envelope.migrateLegacyFrames
			? ["sequence", "capturedAt", "payload"]
			: ["id", "sequence", "capturedAt", "payload"];
		if (!hasOnlyKeys(raw, allowedKeys)) return null;
		const frameId = envelope.migrateLegacyFrames
			? `legacy_frame_${stableHash(`${envelope.id}:${canonicalJson(raw)}`)}`
			: raw.id;
		const sequence = raw.sequence;
		const capturedAt = raw.capturedAt;
		if (
			!isStableId(frameId) ||
			ids.has(frameId) ||
			typeof sequence !== "number" ||
			!Number.isInteger(sequence) ||
			sequence <= previous ||
			typeof capturedAt !== "number" ||
			!Number.isFinite(capturedAt)
		)
			return null;
		if (!("payload" in raw) || !isJsonValue(raw.payload)) return null;
		const payload = options.parsePayload(raw.payload);
		if (payload === null) return null;
		frames.push({ id: frameId, sequence, capturedAt, payload: cloneJson(payload) });
		ids.add(frameId);
		previous = sequence;
	}
	return {
		kind: RECORDING_ENVELOPE_KIND,
		version: RECORDING_ENVELOPE_VERSION,
		id: envelope.id,
		surface: options.surface,
		capturedAt: envelope.capturedAt,
		...(envelope.provenance === undefined ? {} : { provenance: cloneJson(envelope.provenance) }),
		frames,
	};
}

function isJsonRecord(value: unknown): value is { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === "string" || typeof value === "boolean") return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	if (!isJsonRecord(value)) return false;
	return Object.values(value).every(isJsonValue);
}

const STABLE_ID = /^[a-z][a-z0-9_-]{0,127}$/;
const MAX_METADATA_TEXT_LENGTH = 200;
const MAX_RECORDING_FRAMES = 10_000;
let generatedRecordingCount = 0;

function isStableId(value: unknown): value is string {
	return typeof value === "string" && STABLE_ID.test(value);
}

function isSurface(value: unknown): value is string {
	return (
		typeof value === "string" && value.trim() !== "" && value.length <= MAX_METADATA_TEXT_LENGTH
	);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function hasOnlyKeys(value: { [key: string]: JsonValue }, allowed: readonly string[]): boolean {
	return Object.keys(value).every((key) => allowed.includes(key));
}

function isProvenance(value: unknown): value is RecordingProvenance | undefined {
	if (value === undefined) return true;
	if (!isJsonRecord(value) || !hasOnlyKeys(value, ["source", "build", "title"])) return false;
	if (value.source !== "live" && value.source !== "legacy" && value.source !== "fixture")
		return false;
	return [value.build, value.title].every(
		(part) =>
			part === undefined ||
			(typeof part === "string" && part.trim() !== "" && part.length <= MAX_METADATA_TEXT_LENGTH),
	);
}

function generatedRecordingId(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (uuid !== undefined) return `recording_${uuid}`;
	generatedRecordingCount += 1;
	return `recording_${stableHash(`${Date.now()}:${generatedRecordingCount}:${Math.random()}`)}`;
}

/** Canonical object order keeps v1 migration ids stable across JSON reformatting. */
function canonicalJson(value: JsonValue): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	return `{${Object.keys(value)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key] as JsonValue)}`)
		.join(",")}}`;
}

/** Small deterministic identifier hash; this is an identity aid, not a security primitive. */
function stableHash(value: string): string {
	let first = 0x811c9dc5;
	let second = 0x01000193;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		first = Math.imul(first ^ code, 0x01000193);
		second = Math.imul(second ^ code, 0x811c9dc5);
	}
	return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function cloneJson<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/** Build a host-neutral reader snapshot from plain fixture rows. */
export function snapshotDbFromFixture(tables: SnapshotFixtureTables): SnapshotDb {
	const db: SnapshotDb = {};
	for (const [tableName, rows] of Object.entries(tables)) {
		db[tableName] = {
			iter: () => rows,
		};
	}
	return db;
}

export function captureSnapshotFrame(
	db: SnapshotDb,
	args: { tick: number; tables: readonly string[] },
): SnapshotCaptureFrame {
	const tables: SnapshotCaptureFrame["tables"] = {};
	for (const tableName of args.tables) {
		tables[tableName] = Array.from(db[tableName]?.iter() ?? []).map(
			(row) => toFixtureValue(row) as Record<string, unknown>,
		);
	}
	return {
		kind: "spellkave.snapshot_frame",
		version: 1,
		tick: args.tick,
		tables,
	};
}

export function snapshotDbFromCaptureFrame(frame: SnapshotCaptureFrame): SnapshotDb {
	return snapshotDbFromFixture(frame.tables);
}

export function readRecentEvents(db: SnapshotDb, n: number): WorldEventRow[] {
	if (n <= 0) return [];
	// `world_event` is private (#915 PR-8); a live connection populates the
	// per-caller `visible_world_event` view instead. Try the new accessor
	// first, falling back to the raw name so pre-#915-PR-8 frozen captures
	// (e.g. apps/world-review/src/fixtures/review-capture.json) keyed under
	// the old accessor still replay correctly.
	const all = rows(db, "visible_world_event", "world_event").map(toEventRow);
	all.sort((a, b) => (b.tick !== a.tick ? b.tick - a.tick : b.id.localeCompare(a.id)));
	return all.slice(0, n);
}

function rows(db: SnapshotDb, ...accessors: string[]): Record<string, unknown>[] {
	for (const accessor of accessors) {
		const handle = db[accessor];
		if (handle !== undefined) return Array.from(handle.iter());
	}
	return [];
}

function toEventRow(row: Record<string, unknown>): WorldEventRow {
	const summary = optString(row.summary);
	const out: WorldEventRow = {
		id: asString(row.id),
		tick: asNumber(row.tick),
		kind: kindToString(row.kind),
	};
	if (summary !== undefined) out.summary = summary;
	return out;
}

function asString(value: unknown): string {
	return value === undefined || value === null ? "" : String(value);
}

function asNumber(value: unknown, fallback = 0): number {
	if (typeof value === "number") return value;
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "string") {
		const n = Number(value);
		return Number.isFinite(n) ? n : fallback;
	}
	return fallback;
}

function optString(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (value && typeof value === "object") {
		const some = (value as { some?: unknown }).some;
		if (some !== undefined && some !== null) return String(some);
	}
	const s = String(value);
	return s.length > 0 ? s : undefined;
}

function kindToString(value: unknown): string {
	if (typeof value === "string") return value;
	if (value && typeof value === "object") {
		const tag = (value as { tag?: unknown }).tag;
		if (typeof tag === "string") return tag;
	}
	return asString(value);
}

function toFixtureValue(value: unknown): unknown {
	if (typeof value === "bigint") {
		const asNumber = Number(value);
		return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
	}
	if (Array.isArray(value)) return value.map((item) => toFixtureValue(item));
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, toFixtureValue(item)]),
	);
}
