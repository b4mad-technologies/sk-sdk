/** Local manifest edits only; world retraction remains the applyset's job. */
import type { ManifestRow } from "@spellkave/tool-authoring";
import { ROW_KIND_NATURAL_KEY, ROW_KIND_STORAGE_KEY } from "@spellkave/world-author";

export function entityReferenceFields(row: ManifestRow, entityKey: string): string[] {
	return Object.entries(row).flatMap(([field, value]) =>
		value === entityKey &&
		(field === "entity_key" ||
			field.endsWith("_entity_key") ||
			field === "item_key" ||
			(field === "target_ref" && row.target_kind === "entity"))
			? [field]
			: [],
	);
}

/** Identity fields determine ownership; other entity references require repair. */
export function planEntityRemoval(
	manifest: Record<string, unknown>,
	entityKey: string,
): {
	manifest: Record<string, unknown>;
	removed: Record<string, number>;
	detail?: string;
} {
	const next = { ...manifest };
	const removed: Record<string, number> = {};
	for (const [kind, rows] of Object.entries(manifest)) {
		if (!Array.isArray(rows)) continue;
		const identity = ROW_KIND_STORAGE_KEY[kind] ?? [ROW_KIND_NATURAL_KEY[kind]];
		const kept: ManifestRow[] = [];
		for (const row of rows as ManifestRow[]) {
			const refs = entityReferenceFields(row, entityKey);
			if (refs.length === 0) {
				kept.push(row);
				continue;
			}
			const owns = refs.some(
				(field) =>
					identity.includes(field) && (field === "entity_key" || field === "actor_entity_key"),
			);
			// Equipment refers to a placed item through the legacy item_key field;
			// metadata attaches to a typed target_ref rather than an entity_key.
			const dependent =
				refs.includes("item_key") || (row.target_kind === "entity" && refs.includes("target_ref"));
			if (!owns && !dependent)
				return {
					manifest,
					removed: {},
					detail: `cannot remove '${entityKey}': surviving ${kind} row refers to it through '${refs.join(", ")}'; remove its contents or revise that reference first.`,
				};
			removed[kind] = (removed[kind] ?? 0) + 1;
		}
		next[kind] = kept;
	}
	return { manifest: next, removed };
}
