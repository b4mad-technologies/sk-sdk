import { expect, it } from "vitest";
import { type DocsMetadata, withDocsVersionEvidence } from "../docs-metadata";

const metadata: DocsMetadata = {
	document_id: "guide",
	corpus_revision: "corpus-a",
	content_status: "planned",
	supported_surfaces: ["cli"],
	server_revision: "unknown",
	compatibility: "unknown",
};
it("retains explicit known host verdicts without promoting publication status", () => {
	for (const compatibility of ["compatible", "mismatch", "unknown"] as const) {
		expect(
			withDocsVersionEvidence(metadata, { server_revision: "server-a", compatibility }),
		).toEqual({ ...metadata, server_revision: "server-a", compatibility });
	}
	expect(metadata.compatibility).toBe("unknown");
});
it("unknown/missing versions cannot assert compatibility; absent metadata stays absent", () => {
	for (const server_revision of ["", "unknown", "0.0.0"]) {
		expect(
			withDocsVersionEvidence(metadata, { server_revision, compatibility: "compatible" }),
		).toEqual(metadata);
	}
	expect(
		withDocsVersionEvidence(undefined, { server_revision: "server-a", compatibility: "mismatch" }),
	).toBeUndefined();
});
