// Projection of a SpacetimeDB `world_event` TABLE header onto the world-actor
// OTLP path (sk-jay0.6.31.7). This is NOT `@spellkave/world-events` (the
// player-facing delivery vocabulary). Wasm reducers cannot post OTLP; a host
// subscriber forwards visible header scalars through `createOtlpHttpSink`.

/** Flatten a SpacetimeDB tagged EventKind to the server `event_kind_path` shape. */
export function eventKindPath(kind: unknown): string {
	if (typeof kind === "string") return kind;
	if (kind !== null && typeof kind === "object" && "tag" in kind) {
		const tagged = kind as { tag: unknown; value?: unknown };
		const outer = String(tagged.tag);
		const inner = tagged.value;
		if (inner !== null && typeof inner === "object" && "tag" in inner) {
			return `${outer}.${String((inner as { tag: unknown }).tag)}`;
		}
		if (outer === "Autonomy") return "Autonomy.Job";
		return outer;
	}
	return String(kind ?? "");
}

function asId(value: unknown): string {
	if (typeof value === "bigint") return value.toString();
	if (typeof value === "number" && Number.isFinite(value)) return String(value);
	if (typeof value === "string") return value;
	return String(value ?? "");
}

function asTick(value: unknown): number | undefined {
	if (typeof value === "bigint") return Number(value);
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
}

/** Scalar-only payload admitted across the OTLP disclosure boundary. */
export function worldTableEventData(
	row: Readonly<Record<string, unknown>>,
	worldSlug?: string,
): Record<string, unknown> {
	const data: Record<string, unknown> = {
		event_id: asId(row.id),
		event_kind: eventKindPath(row.kind),
	};
	const tick = asTick(row.tick);
	if (tick !== undefined) data.tick = tick;
	if (worldSlug !== undefined && worldSlug !== "") data.world_slug = worldSlug;
	return data;
}
