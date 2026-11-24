import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	authoringDocMetadata,
	authoringDocSourcePath,
	composePublicDocCorpora,
	getAuthoringExample,
	listAuthoringDocSections,
	listAuthoringDocs,
	listAuthoringExamples,
	queryAuthoringDocs,
	queryAuthoringExamples,
	validateManifestToml,
} from "../index";

// Package root from this file: __tests__ → src → spellkave-world-author.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXAMPLES_DIR = join(PACKAGE_ROOT, "docs/examples");
const MODDING_DIR = join(PACKAGE_ROOT, "docs");

describe("authoring corpus", () => {
	it("rejects colliding IDs instead of replacing an existing public document", () => {
		const doc = listAuthoringDocs()[0];
		if (!doc) throw new Error("expected corpus document");
		expect(() => composePublicDocCorpora([[doc], [{ ...doc, title: "different owner" }]])).toThrow(
			`duplicate public document id "${doc.id}"`,
		);
	});
	it("AUTH-56-01 publishes every individual Patternbook page with source parity", () => {
		const patternsDir = join(MODDING_DIR, "patterns");
		const pages = readdirSync(patternsDir).filter(
			(name) => name.endsWith(".md") && name !== "index.md",
		);
		const docs = listAuthoringDocs();
		for (const page of pages) {
			const doc = docs.find((entry) => entry.id === `patterns/${page.slice(0, -3)}`);
			expect(doc?.body, page).toBe(readFileSync(join(patternsDir, page), "utf8"));
			expect(doc?.summary.length).toBeLessThanOrEqual(180);
		}
		expect(docs.filter((doc) => doc.id.startsWith("patterns/"))).toHaveLength(pages.length);
		expect(
			queryAuthoringDocs("container loot", 5).some(
				(hit) => hit.item.id === "patterns/container-with-loot",
			),
		).toBe(true);
	});
	it("resolves Patternbook index and mechanism links through packaged IDs", () => {
		const patternIndex = listAuthoringDocs().find((doc) => doc.id === "patterns");
		if (!patternIndex) throw new Error("expected Patternbook index");
		const containerSection = listAuthoringDocSections(patternIndex.body).find((section) =>
			section.body.includes("./container-with-loot.md"),
		);
		if (!containerSection) throw new Error("expected container section");
		expect(authoringDocMetadata("patterns", containerSection.body)?.links).toContainEqual({
			href: "./container-with-loot.md",
			document_id: "patterns/container-with-loot",
		});
		expect(authoringDocMetadata("patterns/condition-grant-and-suppression")?.links).toContainEqual({
			href: "../action-economy.md",
			document_id: "action-economy",
		});
		for (const doc of listAuthoringDocs().filter((entry) => entry.id.startsWith("patterns"))) {
			for (const section of listAuthoringDocSections(doc.body)) {
				const links = authoringDocMetadata(doc.id, section.body)?.links ?? [];
				for (const match of section.body.matchAll(/\]\(([^\s)]+)\)/g)) {
					const href = match[1] ?? "";
					if (/^\.\//.test(href) || /^\.\.\/[^/]+\.md(?:#|$)/.test(href)) {
						expect(
							links.some((link) => link.href === href),
							`${doc.id}: unresolved ${href}`,
						).toBe(true);
					}
				}
				for (const link of links) {
					expect(listAuthoringDocs().some((target) => target.id === link.document_id)).toBe(true);
				}
			}
		}
	});
	it("never infers server compatibility or hosted delivery from source generation", () => {
		const metadata = authoringDocMetadata("patterns/container-with-loot");
		expect(metadata?.corpus_revision).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(metadata?.server_revision).toBe("unknown");
		expect(metadata?.compatibility).toBe("unknown");
		expect(metadata?.supported_surfaces).not.toContain("hosted-mcp");
		expect(authoringDocMetadata("../../private")).toBeUndefined();
		expect(authoringDocMetadata("https://example.com")).toBeUndefined();
	});
	it("packages docs and required examples behind stable ids", () => {
		expect(listAuthoringDocs().map((doc) => doc.id)).toContain("manifest-format");
		expect(
			listAuthoringExamples()
				.map((example) => example.id)
				.sort(),
		).toEqual([
			"aoe-damage-spell",
			"authored-dark-cave",
			"communicate-with-actor",
			"damage-type-routing",
			"definition-seed-statblock",
			"dm-oversight",
			"spatial-minimal-cell",
			"spell-identity-minimal",
			"weighted-int-roll-table",
		]);
	});

	// #1983: `id` is the key every consumer resolves against (`DocIndexEntry.rel`,
	// `doc_paths`, `getAuthoringDoc`), so two docs sharing one is not a cosmetic
	// duplicate — it makes the id ambiguous. `damage-type-routing` and
	// `dm-oversight` each had a concept-prose doc AND a worked example under the
	// same stem, and the corpus concatenated its two halves without checking.
	it("keys every doc under a unique id", () => {
		const ids = listAuthoringDocs().map((doc) => doc.id);
		expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
		expect(new Set(ids).size).toBe(ids.length);
	});

	// The property that retires a separate `examples show` command: finding the
	// right doc and getting something copyable is ONE lookup, not two.
	it("carries the worked manifest on every example-backed doc", () => {
		const docs = listAuthoringDocs();
		for (const example of listAuthoringExamples()) {
			const doc = docs.find((d) => d.id === example.id);
			expect(doc, `${example.id}: example has no doc`).toBeDefined();
			expect(doc?.toml, `${example.id}: doc carries no toml`).toBe(example.toml);
			expect(doc?.expectedDiagnostics).toEqual(example.expectedDiagnostics);
		}
		// ...and a doc with no example stays clean rather than carrying an empty field.
		expect(docs.find((d) => d.id === "manifest-format")?.toml).toBeUndefined();
	});

	// A merged id keeps BOTH halves reachable: the concept prose as `body`
	// (byte-equal to its source, see the single-source guard below) and the
	// example's own walkthrough beside it.
	it("keeps both halves of a merged id reachable", () => {
		const merged = listAuthoringDocs().find((doc) => doc.id === "dm-oversight");
		expect(merged?.kind).toBe("guide");
		expect(merged?.body).toContain("How to author a game-master");
		expect(merged?.walkthrough).toContain("Example - define a DM");
		expect(merged?.toml).toBeDefined();
		// An example-only doc has no separate concept prose, so no walkthrough
		// field — its body already IS the walkthrough.
		expect(
			listAuthoringDocs().find((doc) => doc.id === "weighted-int-roll-table")?.walkthrough,
		).toBeUndefined();
	});

	it("returns bounded query results", () => {
		expect(queryAuthoringDocs("actor communication", 1)).toHaveLength(1);
		expect(queryAuthoringDocs("actor communication", 1)[0]?.item.id).toBe("communicate-with-actor");
		expect(queryAuthoringExamples("weighted roll table", 2)[0]?.item.id).toBe(
			"weighted-int-roll-table",
		);
	});

	it("validates every packaged TOML example through wasm", () => {
		for (const example of listAuthoringExamples()) {
			expect(validateManifestToml(example.toml), example.id).toEqual(
				example.expectedDiagnostics.map((code) =>
					expect.objectContaining({
						code,
					}),
				),
			);
		}
	});

	it("fetches one example by id", () => {
		expect(getAuthoringExample("spatial-minimal-cell")?.toml).toContain("[[place_nodes]]");
	});

	// ADR-0047 G-1 (native behaviour anchor): the aoe-damage-spell claim is
	// action-economy-gated, so it can't be fired in an offline test. Instead bind
	// the doc bytes to the substrate mechanism that IS unit-tested
	// (server/.../for_each_actor_in_radius.rs): the example must keep wrapping a
	// negative-delta ModifyResource in a ForEachActorInRadius frame write. If the
	// example loses the damage mechanism, or the substrate renames the op, this
	// goes red — the doc can't silently stop subtracting HP.
	it("aoe-damage-spell keeps its ForEachActorInRadius + ModifyResource damage mechanism", () => {
		const toml = getAuthoringExample("aoe-damage-spell")?.toml ?? "";
		expect(toml).toContain("ForEachActorInRadius");
		expect(toml).toContain("ModifyResource");
		// The blast must drain HP, not heal: a negative-leading `delta_source`
		// (DSL-valued outcome, ADR-0045/#266) — e.g. `delta_source = "-d6"`.
		expect(toml).toMatch(/delta_source\s*=\s*["']\s*-/);
	});
});

// --- Single-source drift guards (ADR-0047). ---

describe("authoring corpus single-source guards", () => {
	// D-2 / edge B: the served example TOML is byte-equal to its docs/examples
	// source. Editing the doc and not regenerating goes red here.
	it("every packaged example TOML is byte-equal to its docs/examples source", () => {
		for (const example of listAuthoringExamples()) {
			const source = readFileSync(join(EXAMPLES_DIR, `${example.id}.toml`), "utf8");
			expect(
				example.toml,
				`${example.id}: corpus drifted from docs/examples/${example.id}.toml — run \`npx tsx scripts/generate-authoring-corpus.ts\``,
			).toBe(source);
		}
	});

	// D-2: every discovered example .toml is actually served (no orphaned source).
	it("every docs/examples/*.toml is served by the corpus", () => {
		const tomlIds = readdirSync(EXAMPLES_DIR)
			.filter((f) => f.endsWith(".toml"))
			.map((f) => f.slice(0, -".toml".length))
			.sort();
		const servedIds = listAuthoringExamples()
			.map((e) => e.id)
			.sort();
		expect(servedIds).toEqual(tomlIds);
	});

	// D-2: every example has a matching .md walkthrough and .meta.json sidecar.
	it("every example .toml has a matching .md and .meta.json", () => {
		const files = new Set(readdirSync(EXAMPLES_DIR));
		for (const example of listAuthoringExamples()) {
			expect(files.has(`${example.id}.md`), `${example.id}: missing walkthrough .md`).toBe(true);
			expect(
				files.has(`${example.id}.meta.json`),
				`${example.id}: missing sidecar .meta.json`,
			).toBe(true);
		}
	});

	// R1 (#1968): the corpus carries FULL prose, not a one-line summary — a
	// query returns real doc bodies without a repo-checkout read. Proven here
	// by byte-equality against the packaged `.md` source (the strongest form:
	// any one-line hand-summary regression, or any repo-checkout runtime read
	// standing in for it, would fail this immediately).
	it("every guide/reference doc body is byte-equal to its packaged .md source (full prose, not a summary)", () => {
		for (const doc of listAuthoringDocs()) {
			if (doc.kind === "example") continue; // covered by the TOML/walkthrough guards above
			const sourcePath = authoringDocSourcePath(doc.id);
			const source = readFileSync(
				doc.source_path
					? join(PACKAGE_ROOT, "../..", doc.source_path)
					: join(MODDING_DIR, sourcePath),
				"utf8",
			);
			expect(doc.body, `${doc.id}: corpus body drifted from docs/${sourcePath}`).toBe(source);
		}
	});

	// D-3 / edge C: every authored prose doc under docs/ has a DOCS pointer,
	// so it is reachable via `docs query`. Generated docs (self-marked) and the
	// README index are the only exemptions — derived from the artifact, not a hand list.
	it("every authored docs/*.md has a corpus pointer", () => {
		const docIds = new Set(listAuthoringDocs().map((d) => d.id));
		const orphans: string[] = [];
		for (const file of readdirSync(MODDING_DIR)) {
			if (!file.endsWith(".md") || file === "README.md") continue;
			const content = readFileSync(join(MODDING_DIR, file), "utf8");
			if (content.includes("<!-- GENERATED")) continue; // self-marked generated reference doc
			const stem = file.slice(0, -".md".length);
			if (!docIds.has(stem)) orphans.push(file);
		}
		const repairsDir = join(MODDING_DIR, "repairs");
		if (existsSync(repairsDir)) {
			for (const file of readdirSync(repairsDir)) {
				if (!file.endsWith(".md")) continue;
				const stem = file.slice(0, -".md".length);
				if (!docIds.has(stem)) orphans.push(`repairs/${file}`);
			}
		}
		expect(
			orphans,
			`prose docs with no corpus pointer (add a DOCS entry so \`docs query\` can find them): ${orphans.join(", ")}`,
		).toEqual([]);
	});

	it("onramp stays within the start-here length budget", () => {
		const onramp = listAuthoringDocs().find((d) => d.id === "onramp");
		expect(onramp).toBeDefined();
		const lines = onramp!.body.split("\n").length;
		const words = onramp!.body.split(/\s+/).filter(Boolean).length;
		expect(lines, `onramp lines ${lines}`).toBeLessThanOrEqual(200);
		expect(words, `onramp words ${words}`).toBeLessThanOrEqual(2000);
	});

	it("repair kind is populated for extracted onramp failure modes", () => {
		const repairs = listAuthoringDocs().filter((d) => d.kind === "repair");
		expect(repairs.length).toBeGreaterThanOrEqual(20);
		expect(repairs.some((d) => d.id === "has-item-dead-in-manipulate")).toBe(true);
	});

	it("packaged prose bodies do not teach repo paths as corpus doc addresses", () => {
		const bad: string[] = [];
		const re = /\]\(\s*(\.\.\/)+(openspec|crates|server|apps|specifications|packages)\//;
		for (const doc of listAuthoringDocs()) {
			if (doc.kind === "example") continue;
			// Historical captures quote the old artifact's responses, including
			// Markdown link strings inside JSON. Those immutable quoted bytes are
			// evidence, not current guide instructions; check their surrounding prose.
			const prose =
				doc.id.startsWith("evidence/") && doc.publication?.content_status === "historical"
					? doc.body.replace(/```[^\n]*\n[\s\S]*?\n```/g, "")
					: doc.body;
			if (re.test(prose) || (doc.walkthrough !== undefined && re.test(doc.walkthrough))) {
				bad.push(doc.id);
			}
		}
		expect(bad, `repo-path doc links in: ${bad.join(", ")}`).toEqual([]);
	});
});
