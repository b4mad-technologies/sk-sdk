/** Additive public-help provenance. This object carries no world authority. */
export interface DocsMetadata {
	document_id: string;
	corpus_revision: string;
	content_status: "implemented" | "planned" | "historical";
	/** Distribution surfaces; this does not certify every described live action. */
	supported_surfaces: string[];
	server_revision: string;
	compatibility: "unknown" | "compatible" | "mismatch";
	feature_prerequisites?: Array<{
		feature: string;
		status: "implemented" | "planned" | "historical";
		minimum_revision: string;
	}>;
	/** Original Markdown href to packaged document/section; never a file read. */
	links?: Array<{ href: string; document_id: string; section?: string }>;
	/** Counts refer to the delivered body, not other sections of the source. */
	links_total?: number;
	links_truncated?: boolean;
	links_hint?: string;
}

/** Supplied by an already-authorized host context read, never by docs arguments. */
export interface DocsVersionEvidence {
	server_revision: string;
	compatibility: DocsMetadata["compatibility"];
}

/** Offline lookup never infers a version verdict or performs a context read. */
export function withDocsVersionEvidence(
	metadata: DocsMetadata | undefined,
	evidence?: Readonly<DocsVersionEvidence>,
): DocsMetadata | undefined {
	if (!metadata) return undefined; // Compatible with older adapters omitting metadata.
	const revision = evidence?.server_revision.trim();
	const known = revision && revision !== "unknown" && revision !== "0.0.0";
	return {
		...metadata,
		server_revision: known ? revision : "unknown",
		compatibility: known ? (evidence?.compatibility ?? "unknown") : "unknown",
	};
}
