// `sk config` lets a developer set defaults once (a target bundle, the dev
// backend, the output format) instead of passing flags on every call. These
// tests check where each value comes from (environment over project over
// global over built-in), that `show` names that source, and that `set` and
// `unset` change one key without losing the rest of the file. Each case
// writes real TOML into its own temp directory; no node.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	configRows,
	configValues,
	loadSkConfig,
	resolveSkConfigPaths,
	setConfigValue,
	unsetConfigValue,
} from "../config.ts";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "sk-config-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("sk configuration", () => {
	it("layers environment over project, global, and built-in values", () => {
		const root = tempRoot();
		const project = join(root, "repo");
		const home = join(root, "home");
		mkdirSync(join(project, ".git"), { recursive: true });
		mkdirSync(join(project, ".spellkave"), { recursive: true });
		mkdirSync(join(home, "config"), { recursive: true });
		writeFileSync(
			join(home, "config", "config.toml"),
			'[author]\nworkspace = "global-work"\ntarget = "global-target"\n\n[output]\nformat = "human"\n',
		);
		writeFileSync(
			join(project, ".spellkave", "config.toml"),
			'[author]\ntarget = "world-fixtures/core"\ndefault_bundle = "core"\n',
		);

		const config = loadSkConfig(
			{
				SPELLKAVE_HOME: home,
				SPELLKAVE_AUTHOR_WORKSPACE: "env-work",
			},
			join(project, "packages"),
		);

		expect(config.workspace).toMatchObject({ display: "env-work", source: "environment" });
		expect(config.target).toMatchObject({
			value: join(project, "world-fixtures/core"),
			display: "world-fixtures/core",
			source: "project",
		});
		expect(config.defaultBundle).toMatchObject({ value: "core", source: "project" });
		expect(config.format).toMatchObject({ value: "human", source: "global" });
	});

	it("reads tracked repository defaults as the lowest layer, dependencies only", () => {
		const root = tempRoot();
		const project = join(root, "repo");
		const home = join(root, "home");
		mkdirSync(join(project, ".git"), { recursive: true });
		mkdirSync(join(project, ".spellkave"), { recursive: true });
		mkdirSync(join(home, "config"), { recursive: true });
		const defaults = join(project, ".spellkave", "defaults.toml");
		writeFileSync(
			defaults,
			'[author.dependencies]\nsrd = "rules/srd/manifest.toml"\ndm = "rules/dm/manifest.toml"\n',
		);
		writeFileSync(
			join(project, ".spellkave", "config.toml"),
			'[author.dependencies]\ndm = "mine/dm.toml"\n',
		);
		const config = loadSkConfig({ SPELLKAVE_HOME: home }, join(project, "packages"));
		expect(config.dependencies.srd).toEqual({
			value: join(project, "rules/srd/manifest.toml"),
			display: "rules/srd/manifest.toml",
			source: "defaults",
		});
		// A personal project mapping overrides the tracked default.
		expect(config.dependencies.dm).toMatchObject({ display: "mine/dm.toml", source: "project" });
		expect(resolveSkConfigPaths(project, { SPELLKAVE_HOME: home }).defaults).toBe(defaults);

		writeFileSync(defaults, '[author]\ntarget = "a.toml"\n');
		expect(() => loadSkConfig({ SPELLKAVE_HOME: home }, project)).toThrow(
			/tracked defaults may only set author\.dependencies \(found author\.target\)/,
		);
		writeFileSync(defaults, '[author.dependencies]\nsrd = "/abs/srd.toml"\n');
		expect(() => loadSkConfig({ SPELLKAVE_HOME: home }, project)).toThrow(
			/must be relative to the repository root/,
		);
	});

	it("reports every effective value with its source", () => {
		const root = tempRoot();
		const config = loadSkConfig({ SPELLKAVE_HOME: join(root, "home") }, root);

		expect(configRows(config)).toEqual([
			{ key: "author.workspace", value: ".local/sk-author-scratch", source: "built-in" },
			{ key: "author.target", value: "none", source: "built-in" },
			{ key: "author.default-bundle", value: "none", source: "built-in" },
			{ key: "output.format", value: "auto", source: "built-in" },
			{ key: "dev.seed", value: "none", source: "built-in" },
			{ key: "dev.backend", value: "none", source: "built-in" },
			{ key: "dev.golden", value: "none", source: "built-in" },
		]);
		// Plugins see the value, not the display text: unset stays undefined.
		expect(configValues(config)["dev.seed"]).toEqual({ value: undefined, source: "built-in" });
	});

	it("resolves dev.seed from project config relative to the project root, env over it", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".git"));
		mkdirSync(join(root, ".spellkave"));
		writeFileSync(
			join(root, ".spellkave", "config.toml"),
			'[dev]\nseed = "packages/spellkave-srd-cc/fixtures"\n',
		);
		const home = join(root, "home");

		const fromProject = loadSkConfig({ SPELLKAVE_HOME: home }, root);
		expect(configRows(fromProject).find((row) => row.key === "dev.seed")).toEqual({
			key: "dev.seed",
			value: "packages/spellkave-srd-cc/fixtures",
			source: "project",
		});
		expect(configValues(fromProject)["dev.seed"]).toEqual({
			value: join(root, "packages/spellkave-srd-cc/fixtures"),
			source: "project",
		});

		const fromEnv = loadSkConfig({ SPELLKAVE_HOME: home, SPELLKAVE_DEV_SEED: "x/y" }, root);
		expect(configValues(fromEnv)["dev.seed"]).toEqual({ value: "x/y", source: "environment" });
	});

	it("resolves dev.backend from project config, env over it, and accepts only pool or local", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".git"));
		const home = join(root, "home");
		const paths = resolveSkConfigPaths(root, { SPELLKAVE_HOME: home });
		setConfigValue("project", "dev.backend", "local", paths);
		expect(configValues(loadSkConfig({ SPELLKAVE_HOME: home }, root))["dev.backend"]).toEqual({
			value: "local",
			source: "project",
		});
		expect(
			configValues(loadSkConfig({ SPELLKAVE_HOME: home, SPELLKAVE_DEV_BACKEND: "pool" }, root))[
				"dev.backend"
			],
		).toEqual({ value: "pool", source: "environment" });
		expect(() => setConfigValue("project", "dev.backend", "cloud", paths)).toThrow(/pool or local/);
		expect(() =>
			loadSkConfig({ SPELLKAVE_HOME: home, SPELLKAVE_DEV_BACKEND: "cloud" }, root),
		).toThrow(/pool or local/);
	});

	it("unsets one key, drops an emptied table, keeps the rest, and tolerates an absent key", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".git"));
		const paths = resolveSkConfigPaths(root, { SPELLKAVE_HOME: join(root, "home") });
		setConfigValue("project", "dev.seed", "fixtures", paths);
		setConfigValue("project", "output.format", "human", paths);

		expect(unsetConfigValue("project", "dev.seed", paths)).toEqual({
			path: paths.project,
			removed: true,
		});
		const written = readFileSync(paths.project, "utf8");
		expect(written).not.toContain("[dev]");
		expect(written).toContain('format = "human"');
		expect(loadSkConfig({ SPELLKAVE_HOME: join(root, "home") }, root).devSeed.source).toBe(
			"built-in",
		);

		expect(unsetConfigValue("project", "dev.seed", paths).removed).toBe(false);
		expect(unsetConfigValue("global", "dev.seed", paths).removed).toBe(false);
		expect(() => unsetConfigValue("project", "nope", paths)).toThrow(/unknown key/);
	});

	it("sets dev.seed under a [dev] table", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".git"));
		const paths = resolveSkConfigPaths(root, { SPELLKAVE_HOME: join(root, "home") });
		setConfigValue("project", "dev.seed", "packages/spellkave-srd-cc/fixtures", paths);
		const written = readFileSync(paths.project, "utf8");
		expect(written).toContain("[dev]");
		expect(written).toContain('seed = "packages/spellkave-srd-cc/fixtures"');
	});

	it("updates one scoped key without discarding the existing profile config", () => {
		const root = tempRoot();
		mkdirSync(join(root, ".git"));
		const env = { SPELLKAVE_HOME: join(root, "home") };
		const paths = resolveSkConfigPaths(root, env);
		mkdirSync(join(paths.global, ".."), { recursive: true });
		writeFileSync(paths.global, 'default_profile = "scout"\n');

		setConfigValue("global", "output.format", "human", paths);

		const written = readFileSync(paths.global, "utf8");
		expect(written).toContain('default_profile = "scout"');
		expect(written).toContain("[output]");
		expect(written).toContain('format = "human"');
	});
});
