// embedded-manifest: {"category": "exact_text_oracle", "rationale": "include-root rendering assertions pin the exact row-free migration manifest boundary"}
// Offline regression for the companion authoring facet (co-evolution-live-agents §4).
//
// The load-bearing property: the Author's reference doc set comes from the
// packaged @spellkave/world-author corpus, not from filesystem globbing.

import { describe, expect, it } from "vitest";
import {
	AUTHORING_FACET_STEPS,
	createDocsTool,
	DOCS_TOOL,
	discoverDocs,
	docIndex,
	fetchDoc,
	loadAuthoringDocs,
	queryDocs,
	renderManifestIncludeRoot,
	resolveDocsResult,
} from "../authoring";

describe("AUTH-56-01 portable docs provenance", () => {
	it("AUTH-56-02 retains planned hand-over while documenting implemented scene setup", () => {
		const doc = fetchDoc("hosted-authoring-guidance", { full: true });
		if (!doc || "error" in doc) throw new Error("expected explicit planning reference");
		expect(doc.metadata?.content_status).toBe("planned");
		expect(doc.metadata?.feature_prerequisites).toEqual([
			{
				feature: "parameterized-scene-setups",
				status: "implemented",
				minimum_revision: "dd6f2d57e394ebe303f6c7426640c809c27226ec",
			},
			{ feature: "role-binding-hand-over", status: "planned", minimum_revision: "unknown" },
		]);
		expect(discoverDocs()).not.toContain(doc.rel);
		expect(docIndex().some((entry) => entry.rel === doc.rel)).toBe(false);
		expect(queryDocs("hosted-authoring-guidance").some((entry) => entry.rel === doc.rel)).toBe(
			false,
		);
	});
	it("bounds and deduplicates links on a large index and omits links from outlines", () => {
		const full = fetchDoc("index", { full: true });
		const outline = fetchDoc("index", { outline: true });
		if (!full || !outline || "error" in full || "error" in outline)
			throw new Error("expected index");
		expect(full.metadata?.links?.length).toBeLessThanOrEqual(16);
		expect(
			new TextEncoder().encode(JSON.stringify(full.metadata?.links)).length,
		).toBeLessThanOrEqual(2000);
		expect(full.metadata?.links_total).toBeGreaterThan(full.metadata?.links?.length ?? 0);
		expect(full.metadata?.links_truncated).toBe(true);
		expect(full.metadata?.links_hint).toContain("section");
		expect(new Set(full.metadata?.links?.map((link) => link.href)).size).toBe(
			full.metadata?.links?.length,
		);
		expect(outline.metadata?.links).toBeUndefined();
		const section = fetchDoc("patterns/container-with-loot", { section: "Problem" });
		if (!section || "error" in section) throw new Error("expected section");
		expect(section.metadata?.links).toBeUndefined();
	});
	it("retains the same identity on full, section and outline responses", () => {
		for (const options of [{ full: true }, { section: "Problem" }, { outline: true }]) {
			const result = fetchDoc("patterns/container-with-loot", options);
			expect(result).toBeDefined();
			if (!result || "error" in result) throw new Error("expected packaged pattern");
			expect(result.metadata?.document_id).toBe(result.rel);
			expect(result.metadata?.corpus_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
			expect(result.metadata?.compatibility).toBe("unknown");
		}
	});
	it("keeps unknown document and unknown section errors distinct", async () => {
		const tool = createDocsTool();
		const missing = await tool.execute("missing", { doc: "https://example.com/private" });
		expect(missing.details).toMatchObject({ ok: false, unknown_id: "https://example.com/private" });
		const section = await tool.execute("section", {
			doc: "patterns/container-with-loot",
			section: "missing",
		});
		expect(section.details).toMatchObject({ ok: false, unknown_section: "missing" });
	});
});

describe("discoverDocs — packaged corpus ids for the Author", () => {
	const docs = discoverDocs();

	it("finds reference and guide corpus ids", () => {
		expect(docs).toContain("dsl-grammar");
		expect(docs).toContain("manifest-format");
		expect(docs).toContain("onramp");
	});

	it("reaches example corpus ids", () => {
		expect(docs).toContain("communicate-with-actor");
	});

	it("returns sorted deterministic ids", () => {
		expect(docs.every((d) => /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(d))).toBe(true);
		expect([...docs].sort()).toEqual(docs);
	});
});

describe("loadAuthoringDocs — concatenated reference context", () => {
	it("includes the discovered set's content, framed per file", () => {
		const ref = loadAuthoringDocs();
		expect(ref).toContain("===== manifest-format =====");
		expect(ref).toContain("===== dsl-grammar =====");
		expect(ref.length).toBeGreaterThan(100);
	});
});

describe("facet vocabulary", () => {
	it("names the four-step flow in order", () => {
		expect(AUTHORING_FACET_STEPS).toEqual(["discover-docs", "write-manifest", "validate", "apply"]);
	});
});

describe("renderManifestIncludeRoot", () => {
	it("renders a typed row-free migration root with ordered includes", () => {
		const rendered = renderManifestIncludeRoot([
			"../base/equipment/armor-slots.toml",
			"../base/equipment/tools.toml",
		]);

		expect(rendered).toContain('schema_version = "1.0.0"');
		expect(rendered).not.toContain("[[bundles]]");
		expect(rendered.match(/\[\[include\]\]/gu)).toHaveLength(2);
		expect(rendered.indexOf("armor-slots.toml")).toBeLessThan(rendered.indexOf("tools.toml"));
	});
});

describe("docIndex — bounded catalogue derived from discoverDocs", () => {
	it("lists exactly the discovered docs and nothing else (cannot drift)", () => {
		const index = docIndex();
		expect(index.map((e) => e.rel).sort()).toEqual([...discoverDocs()].sort());
	});

	it("groups the index from general guidance to specific examples", () => {
		const topics = [...new Set(docIndex().map((entry) => entry.topic))];
		expect(topics).toEqual([
			"Start here",
			"Guides",
			"Reference",
			"Troubleshooting",
			"Worked examples",
		]);
		expect(docIndex()[0]?.rel).toBe("onramp");
	});

	it("carries a non-empty title per entry (heading or basename)", () => {
		for (const entry of docIndex()) {
			expect(entry.title.length).toBeGreaterThan(0);
		}
	});

	it("carries kind + non-empty summary on every index entry", () => {
		for (const entry of docIndex()) {
			expect(entry.kind.length).toBeGreaterThan(0);
			expect(entry.summary.length).toBeGreaterThan(0);
		}
		expect(docIndex().some((e) => e.kind === "repair")).toBe(true);
	});

	it("is bounded — paths only, never the concatenated bodies", () => {
		const index = docIndex();
		const rendered = index.map((e) => `${e.rel} ${e.title}`).join("\n");
		expect(rendered).not.toContain("===== ");
		expect(rendered.length).toBeLessThan(loadAuthoringDocs().length);
	});
});

describe("queryDocs — deterministic DOCS-ONLY retrieval (pull, not dump)", () => {
	it("a known query surfaces the expected packaged doc among hits", () => {
		const hits = queryDocs("manifest format schema version", { limit: 5 });
		const mf = hits.find((hit) => hit.rel === "manifest-format");
		expect(mf).toBeDefined();
		expect((mf?.excerpt.length ?? 0) > 0).toBe(true);
		expect(mf?.body).toBe(mf?.excerpt);
	});

	// Progressive exposure: hits are summary + short excerpt, never full body.
	it("returns a short excerpt, not the full packaged prose", () => {
		const mf = queryDocs("manifest format schema version", { limit: 5 }).find(
			(hit) => hit.rel === "manifest-format",
		);
		expect(mf?.summary.length ?? 0).toBeGreaterThan(0);
		expect(mf?.excerpt.length ?? 0).toBeGreaterThan(40);
		expect(mf?.excerpt.length ?? 0).toBeLessThanOrEqual(700);
		expect(mf?.body_chars ?? 0).toBeGreaterThan(mf?.excerpt.length ?? 0);
	});

	// The synthetic `onramp` id (no filename-stem match — it's keyed from
	// README.md) gets the same full-prose treatment as every other doc. Now
	// that every doc carries its full body (not a one-line summary), a query
	// naming other guides' shared vocabulary (bundle/seed/validate/manifest)
	// no longer discriminates reliably — query the id itself instead. A bare
	// "onramp" query ties with the #1968 generated `index` doc (its own body
	// necessarily mentions "the onramp" while pointing at this doc), so query
	// the onramp's own title ("Modding onramp") to disambiguate.
	it("resolves the synthetic onramp id in query hits", () => {
		const top = queryDocs("modding onramp")[0];
		expect(top?.rel).toBe("onramp");
		expect(top?.excerpt.length ?? 0).toBeGreaterThan(40);
		expect(top?.summary.length ?? 0).toBeGreaterThan(0);
	});

	it("every result originates from the discovered set (firewall)", () => {
		const discovered = new Set(discoverDocs());
		for (const q of ["manifest", "dsl grammar interaction", "actor communicate speech"]) {
			for (const hit of queryDocs(q, { limit: 10 })) {
				expect(discovered.has(hit.rel)).toBe(true);
			}
		}
	});

	it("never escapes the corpus, even with a filter aimed elsewhere", () => {
		// A filter pointing at source can only narrow the corpus set -> no hits.
		const hits = queryDocs("manifest", { docPaths: ["server/src"] });
		expect(hits).toEqual([]);
	});

	it("is deterministic and bounded by limit", () => {
		expect(queryDocs("manifest format", { limit: 2 })).toEqual(
			queryDocs("manifest format", { limit: 2 }),
		);
		expect(queryDocs("modding", { limit: 1 }).length).toBeLessThanOrEqual(1);
	});

	it("returns nothing for terms absent from the corpus", () => {
		expect(queryDocs("zzzznonexistenttoken")).toEqual([]);
	});

	it("narrows the corpus before applying limit, not after (#1983)", () => {
		// A doc that scores non-zero but does NOT crack the global top-3 must
		// still be reachable by naming it. Filtering after a limit-bounded
		// query returned [] here — the filter silently did nothing except
		// delete results, which is the opposite of "narrow the search".
		const unfiltered = queryDocs("spell", { limit: 3 }).map((hit) => hit.rel);
		const named = queryDocs("spell", { docPaths: ["dsl-grammar"], limit: 3 });

		expect(unfiltered).not.toContain("dsl-grammar");
		expect(named.map((hit) => hit.rel)).toEqual(["dsl-grammar"]);
	});

	it("applies limit to the narrowed set", () => {
		const both = queryDocs("spell", { docPaths: ["dsl-grammar", "onramp"], limit: 2 });
		expect(both).toHaveLength(2);
		expect(queryDocs("spell", { docPaths: ["dsl-grammar", "onramp"], limit: 1 })).toHaveLength(1);
	});
});

describe("spellkave_docs — one dual-shape tool exposed from the one companion package (#1968, precedent #1931)", () => {
	it("with a query, returns only discovered-set hits (shape: 'hits')", async () => {
		const tool = createDocsTool();
		expect(tool.name).toBe(DOCS_TOOL);
		const result = await tool.execute("id", { query: "manifest format" });
		expect(result.details.shape).toBe("hits");
		const discovered = new Set(discoverDocs());
		if (result.details.shape === "hits") {
			for (const hit of result.details.hits) {
				expect(discovered.has(hit.rel)).toBe(true);
			}
		}
	});

	it("without a query, returns the bounded index (shape: 'index')", async () => {
		const tool = createDocsTool();
		expect(tool.name).toBe(DOCS_TOOL);
		const result = await tool.execute("id", {});
		expect(result.details.shape).toBe("index");
		if (result.details.shape === "index") {
			expect(result.details.index.map((e) => e.rel).sort()).toEqual([...discoverDocs()].sort());
		}
	});

	it("a query returns excerpt hits, not full prose bodies", async () => {
		const tool = createDocsTool();
		const result = await tool.execute("id", { query: "manifest format schema version" });
		expect(result.details.shape).toBe("hits");
		if (result.details.shape === "hits") {
			const hit =
				result.details.hits.find((h) => h.rel === "manifest-format") ?? result.details.hits[0];
			expect(hit?.excerpt.length ?? 0).toBeGreaterThan(40);
			expect(hit?.excerpt.length ?? 0).toBeLessThanOrEqual(700);
			expect(hit?.body_chars ?? 0).toBeGreaterThan(hit?.excerpt.length ?? 0);
		}
	});

	// --- The `doc` shape (#1983): what retired `spellkave-author examples show`. ---

	it("with a doc id, returns that one doc whole including its worked manifest", async () => {
		const tool = createDocsTool();
		const result = await tool.execute("id", { doc: "dm-oversight" });

		expect(result.details.shape).toBe("doc");
		if (result.details.shape !== "doc" || result.details.doc === null) throw new Error("no doc");
		const doc = result.details.doc;
		expect(doc.rel).toBe("dm-oversight");
		// The payload a caller can ACT on — the whole point of the shape.
		expect(doc.toml).toContain("schema_version");
		// A merged id keeps its example walkthrough beside the concept prose.
		expect(doc.walkthrough?.length ?? 0).toBeGreaterThan(0);
	});

	it("browse and search advertise a copyable example without carrying it", async () => {
		const tool = createDocsTool();
		const index = await tool.execute("id", {});
		const hits = await tool.execute("id", { query: "dm hidden region" });

		if (index.details.shape !== "index") throw new Error("not the index shape");
		expect(index.details.index.some((entry) => entry.has_example)).toBe(true);
		expect(index.details.index.every((entry) => !("toml" in entry))).toBe(true);

		if (hits.details.shape !== "hits") throw new Error("not the hits shape");
		// The marker rides along; the TOML does not — every result would
		// otherwise pay for a payload the caller may not want.
		expect(hits.details.hits.every((hit) => !("toml" in hit))).toBe(true);
		expect(hits.details.hits.some((hit) => hit.has_example)).toBe(true);
	});

	it("reports an unknown doc id as a failure, but answers with the index anyway", async () => {
		const tool = createDocsTool();
		const result = await tool.execute("id", { doc: "no-such-doc" });

		if (result.details.shape !== "doc") throw new Error("not the doc shape");
		expect(result.details.doc).toBeNull();
		// Both halves matter: helpful (here are the ids) AND honest (this missed),
		// so a shell caller gating on the exit code still sees a failure.
		if (result.details.doc !== null) throw new Error("expected a miss");
		expect(result.details.ok).toBe(false);
		if (!("unknown_id" in result.details)) throw new Error("expected unknown_id miss");
		expect(result.details.unknown_id).toBe("no-such-doc");
		expect(result.details.index.length).toBeGreaterThan(0);
	});

	it("prefers doc over query when a caller sets both", async () => {
		const tool = createDocsTool();
		const result = await tool.execute("id", { doc: "manifest-format", query: "anything" });
		expect(result.details.shape).toBe("doc");
	});
});

describe("fetchDoc section selector", () => {
	it("returns one section body when the heading matches", () => {
		const doc = fetchDoc("onramp", { section: "AUTHOR path" });
		expect(doc && !("error" in doc)).toBe(true);
		if (doc && !("error" in doc)) {
			expect(doc.body).toMatch(/AUTHOR path/i);
			const full = fetchDoc("onramp");
			const fullLen = full && !("error" in full) ? full.body.length : 0;
			expect(doc.body.length).toBeLessThan(fullLen);
			expect(doc.section).toBeTruthy();
		}
	});

	it("fails clearly on an unknown section without returning the full body", () => {
		const doc = fetchDoc("onramp", { section: "this-heading-does-not-exist-zz" });
		expect(doc && "error" in doc && doc.error === "unknown_section").toBe(true);
	});
});

describe("progressive doc exposure — outline / full / excerpt", () => {
	it("defaults tool-reference to a verb index (not nested heading spam)", () => {
		const doc = fetchDoc("tool-reference");
		expect(doc && !("error" in doc)).toBe(true);
		if (doc && !("error" in doc)) {
			expect(doc.outline).toBe(true);
			expect(doc.tools?.length ?? 0).toBeGreaterThan(15);
			expect(doc.tools?.some((tool) => tool.name === "spellkave_define_session")).toBe(true);
			expect(doc.body).toMatch(/\| Tool \| Label \| Summary \|/);
			expect(doc.body).not.toMatch(/^- Example$/m);
			expect(doc.body_chars ?? 0).toBeGreaterThan(50_000);
		}
	});

	it("opens one tool page via section / second positional name", () => {
		const doc = fetchDoc("tool-reference", { section: "spellkave_define_session" });
		expect(doc && !("error" in doc)).toBe(true);
		if (doc && !("error" in doc)) {
			expect(doc.section).toMatch(/spellkave_define_session/);
			expect(doc.body).toMatch(/spellkave_define_session/);
			expect(doc.body).toMatch(/Field/);
			expect(doc.body.length).toBeLessThan(20_000);
		}
	});

	it("returns full oversized body only with full: true", () => {
		const doc = fetchDoc("tool-reference", { full: true });
		expect(doc && !("error" in doc)).toBe(true);
		if (doc && !("error" in doc)) {
			expect(doc.outline).toBeUndefined();
			expect(doc.body.length).toBeGreaterThan(50_000);
			expect(doc.oversized).toBe(true);
		}
	});

	it("query hits never embed the tool-reference full body", () => {
		const hits = queryDocs("tool reference", { limit: 5 });
		for (const hit of hits) {
			expect(hit.excerpt.length).toBeLessThanOrEqual(700);
			expect(hit.body).toBe(hit.excerpt);
		}
	});
});

describe("host-supplied docs version evidence and old clients", () => {
	it("keeps ordinary content identical while reporting a known mismatch", () => {
		const offline = fetchDoc("patterns/container-with-loot", { full: true });
		const mismatch = fetchDoc("patterns/container-with-loot", {
			full: true,
			versionEvidence: { server_revision: "server-old", compatibility: "mismatch" },
		});
		expect(offline && "metadata" in offline ? offline.metadata?.compatibility : undefined).toBe(
			"unknown",
		);
		if (!mismatch || "error" in mismatch || !offline || "error" in offline)
			throw new Error("Missing docs");
		expect(mismatch.metadata).toMatchObject({
			compatibility: "mismatch",
			server_revision: "server-old",
		});
		const { metadata: _offlineMetadata, ...oldClientContent } = offline;
		const { metadata: _mismatchMetadata, ...newClientContent } = mismatch;
		expect(newClientContent).toEqual(oldClientContent);
	});
	it("retains unknown versions and ordinary safe lookup failures", () => {
		const doc = fetchDoc("patterns/container-with-loot", {
			section: "Problem",
			versionEvidence: { server_revision: "unknown", compatibility: "compatible" },
		});
		expect(doc && "metadata" in doc ? doc.metadata?.compatibility : undefined).toBe("unknown");
		expect(fetchDoc("/private/world.toml")).toBeUndefined();
		expect(fetchDoc("patterns/container-with-loot", { section: "not-a-section" })).toMatchObject({
			error: "unknown_section",
		});
	});
});

describe("PG-4 additive discovery and refusal provenance", () => {
	it("bounds metadata on actual tool index, hits, full and both refusal envelopes", async () => {
		const tool = createDocsTool();
		const results = await Promise.all(
			[
				{},
				{ query: "container loot" },
				{ doc: "patterns/container-with-loot", full: true },
				{ doc: "no-such-doc" },
				{ doc: "hosted-authoring-guidance", section: "no-such-section" },
			].map((args) => tool.execute("pg4", args)),
		);
		const revision = results[0]!.details.metadata?.corpus_revision;
		expect(revision).toMatch(/^sha256:/);
		for (const result of results) {
			expect(result.details.metadata).toMatchObject({
				corpus_revision: revision,
				compatibility: "unknown",
				server_revision: "unknown",
			});
			expect(result.details.metadata?.supported_surfaces.length).toBeGreaterThan(0);
			expect(result.details.metadata?.links).toBeUndefined();
			expect(JSON.stringify(result.details.metadata).length).toBeLessThan(2000);
		}
		for (const result of [results[0]!, results[1]!, results[3]!]) {
			const details = result.details;
			const rows = "index" in details ? details.index : "hits" in details ? details.hits : [];
			expect(rows.length).toBeGreaterThan(0);
			for (const row of rows) {
				expect(row.metadata).toMatchObject({
					document_id: row.rel,
					corpus_revision: revision,
					content_status: "implemented",
					compatibility: "unknown",
				});
				expect(row.metadata?.links).toBeUndefined();
				expect(JSON.stringify(row.metadata).length).toBeLessThan(2000);
				if ("excerpt" in row) expect(row.body.length).toBeLessThanOrEqual(700);
				else expect(row).not.toHaveProperty("body");
			}
		}
		expect(results[3]!.details).toMatchObject({
			ok: false,
			doc: null,
			unknown_id: "no-such-doc",
			metadata: { document_id: "index" },
		});
		expect(results[4]!.details).toMatchObject({
			ok: false,
			doc: null,
			unknown_section: "no-such-section",
			metadata: {
				document_id: "hosted-authoring-guidance",
				content_status: "planned",
				feature_prerequisites: expect.any(Array),
			},
		});
	});
	it("applies trusted host evidence consistently without changing legacy content", () => {
		for (const args of [
			{},
			{ query: "container loot" },
			{ doc: "unknown" },
			{ doc: "patterns/container-with-loot", section: "unknown" },
		]) {
			const offline = resolveDocsResult(args);
			const known = resolveDocsResult(args, {
				server_revision: "server-old",
				compatibility: "mismatch",
			});
			const stripMetadata = (value: unknown): unknown =>
				Array.isArray(value)
					? value.map(stripMetadata)
					: value && typeof value === "object"
						? Object.fromEntries(
								Object.entries(value)
									.filter(([key]) => key !== "metadata")
									.map(([key, item]) => [key, stripMetadata(item)]),
							)
						: value;
			expect(stripMetadata(known)).toEqual(stripMetadata(offline));
			expect(known.metadata).toMatchObject({
				server_revision: "server-old",
				compatibility: "mismatch",
			});
			for (const row of "index" in known ? known.index : "hits" in known ? known.hits : [])
				expect(row.metadata).toMatchObject({
					server_revision: "server-old",
					compatibility: "mismatch",
				});
		}
	});
});
