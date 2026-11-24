// The drift checks a package's docs test runs offline: each returns what is
// wrong, empty when the documents match their sources.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { DocsConfig } from "./config.ts";
import { renderReadme } from "./readme.ts";
import { featureOutlines, featuresHash, locate, specScenarioIds } from "./sources.ts";

const doc = (pkg: string, path: string) =>
	existsSync(join(pkg, path)) ? readFileSync(join(pkg, path), "utf8") : "";

/** The README differs from what the generator writes. */
export function readmeDrift(pkg: string, config: DocsConfig): string[] {
	if (config.readme === false) return [];
	const json = JSON.parse(doc(pkg, "package.json")) as { name: string };
	return doc(pkg, "README.md") === renderReadme(pkg, config)
		? []
		: [`README.md is stale: run \`pnpm --filter ${json.name} readme\``];
}

/** The guide or the evidence was generated from other .feature files. */
export function guideDrift(pkg: string, config?: DocsConfig): string[] {
	const want = featuresHash(pkg, config?.scope);
	const files = [config?.docs?.guide ?? "guide.md", config?.docs?.evidence ?? "scenarios.md"];
	return files
		.map((name) => `docs/${name}`)
		.flatMap((path) => {
			const got = doc(pkg, path).match(/features ([0-9a-f]{12})/)?.[1];
			return got === want
				? []
				: [
						`${path} comes from other scenarios (features ${got ?? "none"}, now ${want}): run the behaviour suite, then the guide script`,
					];
		});
}

/** An @code tag names a file or symbol that does not exist. */
export function danglingCodeTags(pkg: string, config?: DocsConfig): string[] {
	return featureOutlines(pkg, [], config?.scope)
		.flatMap((f) => f.codeTags)
		.map((tag) => locate(pkg, tag))
		.flatMap((r) => ("error" in r ? [r.error] : []));
}

/**
 * The features and the spec they implement disagree: a spec scenario ID no
 * `@spec:` tag covers, or a tag naming an ID the spec does not have. One ID
 * may be covered by several scenarios and files. A `@planned` scenario
 * counts as covering: it is visible in the documents as not working yet.
 */
export function specDrift(pkg: string, repo: string, config: DocsConfig): string[] {
	const specs = config.specs ?? [];
	if (!specs.length) return [];
	const missing = specs.filter((spec) => !existsSync(join(repo, spec)));
	if (missing.length) return missing.map((spec) => `spec file not found: ${spec}`);
	const ids = new Set(specs.flatMap((spec) => specScenarioIds(join(repo, spec))));
	const tagged = new Set(featureOutlines(pkg, [], config.scope).flatMap((f) => f.specTags));
	return [
		...[...ids]
			.filter((id) => !tagged.has(id))
			.map((id) => `spec scenario ${id} has no @spec:${id} scenario`),
		...[...tagged]
			.filter((id) => !ids.has(id))
			.map((id) => `@spec:${id} names no scenario in ${specs.join(", ")}`),
	];
}

/**
 * specDrift for a package without a docs config: throws with every drift
 * line, so a plain unit test can call it.
 *
 *   it("covers the spec", () => expectNoSpecDrift(PKG, ["openspec/…/spec.md"]));
 */
export function expectNoSpecDrift(
	pkg: string,
	specs: readonly string[],
	options: { readonly scope?: string; readonly repo?: string } = {},
): void {
	const repo =
		options.repo ??
		execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: pkg, encoding: "utf8" }).trim();
	const config = {
		specs,
		...(options.scope ? { scope: options.scope } : {}),
	} as unknown as DocsConfig;
	const drift = specDrift(pkg, repo, config);
	if (drift.length) throw new Error(`features and spec disagree:\n  ${drift.join("\n  ")}`);
}
