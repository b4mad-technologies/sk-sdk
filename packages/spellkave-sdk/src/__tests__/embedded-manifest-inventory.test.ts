// keep-file(K1): inventory drift and local classification policy rules.
// Policy for manifest text intentionally generated inside SDK and test-lab
// TypeScript (`@spellkave/test-lab` was split out of the SDK; both roots are
// scanned). Static reusable harness worlds belong to @spellkave/mechanics; only
// parameterized renderers whose output is the direct test subject stay inline.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
// Repository-only policy tooling stays outside the SDK build root and shipped API.
// This inventory loads that tooling at runtime without adding a production dependency.
const { checkEmbeddedManifestClassifications } = await import(
	resolve(REPO_ROOT, "scripts/lib/embedded-manifest-classifications.ts")
);
const TEST_LAB_ROOT = resolve(REPO_ROOT, "packages/spellkave-test-lab");
const TOML_SCHEMA_VERSION = /schema_version\s*=\s*["']1\.0\.0["']/;
const INLINE_RULES = [
	{
		category: "sdk_inline",
		allowedCategories: ["dynamic_authoring_proof", "exact_renderer_oracle"],
		minimumRationaleLength: 40,
		matches: (source: string) => TOML_SCHEMA_VERSION.test(source),
	},
];
const GATEKEEPER_FIXTURE = resolve(
	REPO_ROOT,
	"SPELLKAVE_TEST_AUTHORITY_MANIFEST",
);
const RETIRED_SDK_FIXTURE = resolve(
	PACKAGE_ROOT,
	"fixtures/test-lab-live-on-demand-gatekeeper/manifest.toml",
);
const LIVE_SOURCE = resolve(TEST_LAB_ROOT, "src/live.ts");
const MECHANICS_GENERATOR = resolve(
	REPO_ROOT,
	"packages/spellkave-mechanics/src/generate-mechanics-fixtures.ts",
);
const SDK_PACKAGE_JSON = resolve(PACKAGE_ROOT, "package.json");
const TEST_LAB_PACKAGE_JSON = resolve(TEST_LAB_ROOT, "package.json");

// Package-relative paths below `root`, never entering its node_modules: listing
// it first and filtering after visited every dependency file.
function packageFiles(root: string, dir = ""): string[] {
	return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
		const path = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return path === "node_modules" ? [] : packageFiles(root, path);
		return [path];
	});
}

describe("SDK embedded manifest inventory", () => {
	it("allows only classified parameterized renderers to contain manifest TOML", () => {
		const files = [PACKAGE_ROOT, TEST_LAB_ROOT].flatMap((root) =>
			packageFiles(root)
				.filter((path) => path.endsWith(".ts"))
				.map((path) => ({
					path: relative(REPO_ROOT, resolve(root, path)),
					source: readFileSync(resolve(root, path), "utf8"),
				})),
		);
		expect(checkEmbeddedManifestClassifications(files, INLINE_RULES)).toEqual([]);
	});

	it("requires a valid local category and rationale for a newly discovered oracle", () => {
		const body = ["schema_version", "= '1.0.0'"].join(" ");
		const marker = (
			category: string,
			rationale = "Per-run isolated scene rendering is the exact assertion subject.",
		) => "// embedded-manifest: " + JSON.stringify({ category, rationale });
		const check = (source: string) =>
			checkEmbeddedManifestClassifications([{ path: "new-oracle.ts", source }], INLINE_RULES);
		for (const category of ["dynamic_authoring_proof", "exact_renderer_oracle"]) {
			expect(check(marker(category) + "\n" + body)).toEqual([]);
			expect(check(marker(category)).join("\n")).toContain("stale sdk_inline");
		}
		expect(check(body).join("\n")).toContain("missing sdk_inline");
		expect(check(marker("unknown") + "\n" + body).join("\n")).toContain(
			"invalid classification category",
		);
		expect(
			check(marker("dynamic_authoring_proof", "a".repeat(40)) + "\n" + body).join("\n"),
		).toContain("rationale must exceed 40");
	});

	it("keeps ensureApplyManifestAuthority caller-configured, idempotent, and acyclic", () => {
		const liveSource = readFileSync(LIVE_SOURCE, "utf8");
		expect(liveSource).toContain(
			"SPELLKAVE_TEST_AUTHORITY_MANIFEST",
		);
		expect(liveSource).toContain(
			"applyManifestDelta(publisher, source, { tolerateAlreadyApplied: true })",
		);

		for (const packageJson of [SDK_PACKAGE_JSON, TEST_LAB_PACKAGE_JSON]) {
			const pkg = JSON.parse(readFileSync(packageJson, "utf8")) as {
				dependencies?: Record<string, string>;
			};
			expect(pkg.dependencies?.["@spellkave/mechanics"]).toBeUndefined();
		}
	});
});
