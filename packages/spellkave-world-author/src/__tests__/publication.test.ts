import { describe, expect, it } from "vitest";
import {
	type AuthoringDoc,
	getAuthoringDoc,
	getAuthoringExample,
	isSupportedAuthoringDoc,
	listAuthoringDocSections,
	mergeAuthoringDocExample,
} from "../corpus";
import { renderAuthoringDocsIndex } from "../docs-index";

describe("publication invariants from portable guidance review", () => {
	it.each([
		"planned",
		"historical",
	] as const)("PG-1 preserves %s facts when merging a concept with its example", (status) => {
		const concept = getAuthoringDoc("dm-oversight");
		const example = getAuthoringExample("dm-oversight");
		if (!concept || !example) throw new Error("expected example-backed concept");
		const publication = {
			content_status: status,
			supported_surfaces: ["cli"],
			feature_prerequisites: [{ feature: "review-probe", status, minimum_revision: "unknown" }],
		};
		const merged = mergeAuthoringDocExample(
			{ ...concept, publication },
			{
				id: concept.id,
				title: "example",
				kind: "example",
				summary: "example summary",
				tags: ["example"],
				body: "example walkthrough",
				toml: example.toml,
			},
		);
		expect(merged.publication).toEqual(publication);
		expect(merged.body).toBe(concept.body);
		expect(merged.toml).toBe(example.toml);
		expect(merged.walkthrough).toBe("example walkthrough");
		expect(isSupportedAuthoringDoc(merged)).toBe(false);
	});
	it.each([
		"planned",
		"historical",
	] as const)("PG-2 places every %s category only in explicit references", (status) => {
		const docs: AuthoringDoc[] = [
			["onramp", "guide"],
			["guide-probe", "guide"],
			["reference-probe", "reference"],
			["repair-probe", "repair"],
			["tool-reference", "reference"],
			["example-probe", "example"],
		].map(([id, kind]) => ({
			id: id ?? "",
			kind: kind as AuthoringDoc["kind"],
			title: id ?? "",
			summary: "probe",
			tags: [],
			body: "probe",
			publication: { content_status: status, supported_surfaces: ["cli"] },
		}));
		const supported: AuthoringDoc = {
			id: "current-reference",
			kind: "reference",
			title: "current",
			summary: "current",
			tags: [],
			body: "current",
		};
		const index = renderAuthoringDocsIndex([...docs, supported], []);
		const sections = listAuthoringDocSections(index);
		const planning = sections.find((section) => section.heading.startsWith("Planning references"));
		expect(planning).toBeDefined();
		for (const doc of docs) {
			const marker = `[\`${doc.id}\`]`;
			expect(planning?.body).toContain(marker);
			expect(index.split(marker).length - 1).toBe(1);
		}
		expect(sections.find((section) => section.heading === "Reference")?.body).toContain(
			"current-reference",
		);
		expect(index).toContain("0 of them worked");
	});
});
