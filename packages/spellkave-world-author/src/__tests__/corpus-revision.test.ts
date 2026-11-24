import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

// keep-file(K1): execute the generator against isolated source trees, including missing/stale build outputs.
function createFixture(): string {
	const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
	const fixture = mkdtempSync(join(tmpdir(), "spellkave-corpus-revision-"));
	for (const path of [
		"scripts/generate-authoring-corpus.ts",
		"packages/spellkave-cli/docs",
		"packages/spellkave-tool-player/docs",
		"packages/spellkave-world-author/docs",
		"packages/spellkave-world-author/src/corpus.ts",
		"packages/spellkave-tool-contracts/src/docs-metadata.ts",
	]) {
		mkdirSync(dirname(join(fixture, path)), { recursive: true });
		cpSync(join(root, path), join(fixture, path), { recursive: true, dereference: true });
	}
	mkdirSync(join(fixture, "node_modules", "@spellkave"), { recursive: true });
	symlinkSync(
		join(root, "node_modules", "@spellkave", "validate-wasm"),
		join(fixture, "node_modules", "@spellkave", "validate-wasm"),
		"dir",
	);
	writeFileSync(join(fixture, "package.json"), JSON.stringify({ type: "module" }));
	return fixture;
}

it("corpus revision changes when only curated metadata changes", () => {
	const fixture = createFixture();
	try {
		const generate = () => {
			const result = spawnSync(
				process.execPath,
				[
					"--import",
					pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
					"scripts/generate-authoring-corpus.ts",
				],
				{
					cwd: fixture,
					encoding: "utf8",
				},
			);
			expect(result.status, result.stderr).toBe(0);
			const generated = readFileSync(
				join(fixture, "packages/spellkave-world-author/src/corpus.generated.ts"),
				"utf8",
			);
			return /GENERATED_CORPUS_REVISION = "([^"]+)"/.exec(generated)?.[1];
		};
		const before = generate();
		const sourcePath = join(fixture, "packages/spellkave-world-author/src/corpus.ts");
		const source = readFileSync(sourcePath, "utf8");
		const changed = source.replace(
			"Authoring docs — corpus index",
			"Authoring docs — changed title only",
		);
		expect(changed).not.toBe(source);
		writeFileSync(sourcePath, changed);
		const after = generate();
		expect(before).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(after).not.toBe(before);
		expect(generate()).toBe(after);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

it("prepares an absent corpus and rejects missing or stale output without repairing it in check mode", () => {
	const fixture = createFixture();
	const output = join(fixture, "packages/spellkave-world-author/src/corpus.generated.ts");
	const invoke = (...flags: string[]) =>
		spawnSync(process.execPath, ["scripts/generate-authoring-corpus.ts", ...flags], {
			cwd: fixture,
			encoding: "utf8",
		});
	try {
		expect(invoke("--check").status).toBe(1);
		const prepared = spawnSync(
			process.execPath,
			["../../scripts/generate-authoring-corpus.ts", "--prepare"],
			{ cwd: join(fixture, "packages/spellkave-world-author"), encoding: "utf8" },
		);
		expect(prepared.status, prepared.stderr).toBe(0);
		expect(prepared.stdout).toBe("");
		const expected = readFileSync(output, "utf8");
		expect(invoke("--check").status).toBe(0);
		utimesSync(output, 1, 1);
		expect(invoke("--prepare").status).toBe(0);
		expect(statSync(output).mtimeMs).toBe(1000);
		writeFileSync(output, "stale corpus\n");
		expect(invoke("--check").status).toBe(1);
		expect(readFileSync(output, "utf8")).toBe("stale corpus\n");
		expect(invoke("--prepare").status).toBe(0);
		expect(readFileSync(output, "utf8")).toBe(expected);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});

it("preserves reviewed diagnostics until an explicit update and never updates in check mode", () => {
	const fixture = createFixture();
	const output = join(fixture, "packages/spellkave-world-author/src/corpus.generated.ts");
	const invoke = (...flags: string[]) =>
		spawnSync(process.execPath, ["scripts/generate-authoring-corpus.ts", ...flags], {
			cwd: fixture,
			encoding: "utf8",
		});
	try {
		expect(invoke("--prepare").status).toBe(0);
		const expected = readFileSync(output, "utf8");
		const golden = join(
			fixture,
			"packages/spellkave-world-author/docs/examples/authored-dark-cave.diagnostics.json",
		);
		const reviewed = readFileSync(golden, "utf8");
		writeFileSync(golden, "[]\n");
		expect(invoke("--prepare").status).toBe(1);
		expect(readFileSync(golden, "utf8")).toBe("[]\n");
		expect(readFileSync(output, "utf8")).toBe(expected);
		expect(invoke("--check", "--update-diagnostics").status).toBe(1);
		expect(readFileSync(golden, "utf8")).toBe("[]\n");
		expect(invoke("--update-diagnostics").status).toBe(0);
		expect(JSON.parse(readFileSync(golden, "utf8"))).toEqual(JSON.parse(reviewed));
		expect(readFileSync(output, "utf8")).toBe(expected);
		rmSync(golden);
		expect(invoke("--prepare").status).toBe(1);
		writeFileSync(golden, reviewed);
		expect(invoke("--check").status).toBe(0);
	} finally {
		rmSync(fixture, { recursive: true, force: true });
	}
});
