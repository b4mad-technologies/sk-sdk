// A world author splits a bundle's manifest over several files with
// `[[include]]` and pulls in other bundles with `depends_on`; `sk` reads
// them from disk and merges them. The merge must keep each file's metadata
// where it was written, and only the root manifest may declare an applyset:
// one in an include is reported as that file's error, one in a dependency is
// dropped. Temp directories; no node. Applyset: ADR-0145.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
	readBundleBodies,
	readMergedManifest,
	stripRootOnlyHeader,
	validateBundle,
} from "../bundle";

function root(bundleId: string, includePath?: string): string {
	const manifest = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[[bundles]]
bundle_id = "${bundleId}"
display_name = "${bundleId}"
author = "spellkave-test"
version = "0.0.0"
depends_on = []
description = "test bundle"
`;
	return includePath === undefined
		? manifest
		: `${manifest}\n[[include]]\npath = "${includePath}"\n`;
}

describe("bundle include loading", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	// keep(K1): inline/dotted metadata and native u64 row text are projection grammar cases.
	it.each([
		'metadata = { docs = { title = "Dependency" } }',
		'metadata.docs.examples = [\n  ["nested array"],\n]\nmetadata.docs.title = "Dependency"',
		'[metadata]\ntitle = "Dependency"',
	])("strips root-only metadata syntax without rewriting row values: %s", (metadata) => {
		const rows = `[[place_nodes]]
key = "cell"
cell_res10 = 18446744073709551615 # exact native u64
description = """A quoted metadata table:
[metadata.docs]
#:schema row prose
"""""

[[metadata_attachments]]
body = "metadata attachments are rows"
`;
		expect(
			stripRootOnlyHeader(
				`#:schema ignored\nschema_version = "1.0.0"\napplyset = "dependency"\n${metadata}\n${rows}`,
			),
		).toBe(rows.trim());
	});

	it("keeps legacy metadata-free partial bundle subtables verbatim", async () => {
		dir = mkdtempSync(join(tmpdir(), "spellkave-cli-bundle-"));
		mkdirSync(join(dir, "base"));
		writeFileSync(join(dir, "manifest.toml"), root("root", "base/prefixes.toml"));
		const prefix = '[[bundles.tag_prefixes]]\ntag = "root"\n';
		writeFileSync(join(dir, "base/prefixes.toml"), prefix);

		const bodies = await readBundleBodies(join(dir, "manifest.toml"));
		expect(bodies.bodies).toEqual([prefix]);
		expect(bodies.fragmentMetadata).toEqual([{ path: "base/prefixes.toml", metadata: {} }]);
	});

	// keep(K1): dependency projection must obey TOML table/string boundaries without rewriting rows.
	it.each([
		"metadata",
		'"meta\\u0064ata"',
		"'metadata'",
	])("validates nested dependency metadata (%s) without merging file-local provenance", async (metadataKey) => {
		dir = mkdtempSync(join(tmpdir(), "spellkave-cli-metadata-"));
		const dependency = join(dir, "dependency");
		mkdirSync(join(dir, "base"));
		mkdirSync(join(dependency, "base"), { recursive: true });
		writeFileSync(
			join(dir, "manifest.toml"),
			root("root", "base/root-reader.toml").replace(
				"\n\n[[bundles]]",
				'\n\n[metadata.docs]\ntitle = "Root"\n\n[[bundles]]',
			),
		);
		writeFileSync(join(dir, "base/root-reader.toml"), '[metadata.docs]\ntitle = "Root reader"\n');
		const dependencyRows = root("dependency", "base/dependency-reader.toml").replace(
			'description = "test bundle"',
			`description = """A row can quote TOML:
[metadata.docs]
schema_version = "row prose"
"""`,
		);
		writeFileSync(
			join(dependency, "manifest.toml"),
			dependencyRows.replace(
				"\n\n[[bundles]]",
				`\n\n [ ${metadataKey} . docs ] # dependency documentation
title = "Dependency"
body = '''Documentation can quote TOML:
[[bundles]]
'''
examples = [
  ["nested array"],
]
[[${metadataKey}.docs.sections]]
title = "Section"
[${metadataKey}.docs.sections.content]
text = "Details"
\n[[bundles]]`,
			),
		);
		writeFileSync(
			join(dependency, "base/dependency-reader.toml"),
			'[metadata.docs]\ntitle = "Dependency reader"\n',
		);

		const rootBodies = await readBundleBodies(join(dir, "manifest.toml"));
		expect(rootBodies.fragmentMetadata).toEqual([
			{ path: "base/root-reader.toml", metadata: { docs: { title: "Root reader" } } },
		]);
		const validation = await validateBundle(
			join(dir, "manifest.toml"),
			[join(dependency, "manifest.toml")],
			true,
		);
		expect(validation.diagnostics).toEqual([]);
		expect(validation.valid).toBe(true);
		const dependencyBodies = await readBundleBodies(join(dependency, "manifest.toml"));
		expect(dependencyBodies.rootToml).toContain('title = "Dependency"');
		expect(dependencyBodies.rootRowsToml).toBe(
			dependencyRows.slice(dependencyRows.indexOf("[[bundles]]")).trim(),
		);
		expect(dependencyBodies.fragmentMetadata).toEqual([
			{ path: "base/dependency-reader.toml", metadata: { docs: { title: "Dependency reader" } } },
		]);
		const merged = await readMergedManifest(
			join(dir, "manifest.toml"),
			[join(dependency, "manifest.toml")],
			true,
		);
		expect(merged.manifest.metadata).toEqual({ docs: { title: "Root" } });
		expect(merged.manifest.bundles).toHaveLength(2);
	});
});

describe("applyset in bundles (ADR-0145)", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("collects an include fragment that declares an applyset as a fragment error, not a throw", async () => {
		dir = mkdtempSync(join(tmpdir(), "spellkave-cli-applyset-"));
		mkdirSync(join(dir, "base"));
		writeFileSync(join(dir, "manifest.toml"), root("root", "base/rogue.toml"));
		writeFileSync(join(dir, "base/rogue.toml"), 'applyset = "rogue"\n');
		const bodies = await readBundleBodies(join(dir, "manifest.toml"));
		expect(bodies.bodies).toEqual([]);
		expect(bodies.fragmentErrors).toHaveLength(1);
		expect(bodies.fragmentErrors[0]?.path).toBe("base/rogue.toml");
		expect(bodies.fragmentErrors[0]?.message).toMatch(/applyset/);
	});

	it("drops a dependency root's applyset when merging it after the root", async () => {
		dir = mkdtempSync(join(tmpdir(), "spellkave-cli-applyset-dep-"));
		const dependency = join(dir, "dependency");
		mkdirSync(dependency);
		const withApplyset = (bundle: string, set: string) =>
			root(bundle).replace(
				'schema_version = "1.0.0"\n',
				`schema_version = "1.0.0"\napplyset = "${set}"\n`,
			);
		writeFileSync(join(dir, "manifest.toml"), withApplyset("root", "root-set"));
		writeFileSync(join(dependency, "manifest.toml"), withApplyset("dependency", "dep-set"));

		const merged = await readMergedManifest(
			join(dir, "manifest.toml"),
			[join(dependency, "manifest.toml")],
			true,
		);
		expect(merged.manifest.applyset).toBe("root-set");
	});
});
