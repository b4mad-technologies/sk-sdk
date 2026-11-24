/** Transport-neutral AUTHOR target contract; host adapters own concrete I/O. */
export interface AuthorSnapshotDb {
	readonly [table: string]: unknown;
}
export type ManifestRow = Record<string, unknown>;
export interface AuthorTargetLookupFilter {
	bundle?: string;
}
export interface AuthorTargetApplyResult {
	ok: boolean;
	detail?: string;
	/** Set when a local target created a new root and named its applyset. */
	applyset?: string;
}
export interface AuthorTargetRemoveResult extends AuthorTargetApplyResult {
	removed?: { root: Record<string, number>; workspace: Record<string, number> };
}
export interface AuthorTarget {
	readonly kind: "live" | "local";
	resolveRef(rowKind: string, id: string): boolean;
	lookup(rowKind: string, filter?: AuthorTargetLookupFilter): ManifestRow[];
	applyBatch(toml: string): Promise<AuthorTargetApplyResult>;
	/** Local file edit, including staged rows that would otherwise resurrect the entity. */
	removeEntity?(
		entityKey: string,
		workspace: { readToml(): string | null; writeToml(toml: string): string },
	): Promise<AuthorTargetRemoveResult>;
}
export type AuthorTargetRef = AuthorTarget | (() => AuthorTarget | undefined);
export function resolveAuthorTarget(target: AuthorTargetRef | undefined): AuthorTarget | undefined {
	if (target === undefined) return undefined;
	try {
		return typeof target === "function" ? target() : target;
	} catch {
		return undefined;
	}
}
