// What the generated documents are made of, read offline from one package:
// its .feature files and their @code links, the header comments of its source
// files, and the annotation above each unit test. The README generator, the
// guide generator and the drift checks all read through here, so they agree
// on what counts as a scenario, a code link or a reason to keep a test.

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

const read = (file: string) => readFileSync(file, "utf8");

/** behaviour/, or one suite's subfolder of it when the package hosts several. */
export const featuresDir = (pkg: string, scope?: string) =>
	scope ? join(pkg, "behaviour", scope) : join(pkg, "behaviour");

/** Where a suite's run results go: next to its features. */
export const resultsDir = (pkg: string, scope?: string) =>
	join(featuresDir(pkg, scope), ".results");

/**
 * The subfolders of behaviour/ that are suites of their own (they carry a
 * docs.config.ts): an unscoped suite neither runs nor documents them, so its
 * documents do not depend on whether those separate suites ran.
 */
export function nestedScopes(pkg: string): string[] {
	const dir = featuresDir(pkg);
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "docs.config.ts")))
		.map((entry) => entry.name)
		.sort();
}

/**
 * Every `.feature` under behaviour/ (or the scope), subfolders included, sorted
 * by path. Unscoped, the nested scopes are left out.
 */
export function featureFiles(pkg: string, scope?: string): string[] {
	const found: string[] = [];
	const skip = new Set(scope ? [] : nestedScopes(pkg).map((name) => join(featuresDir(pkg), name)));
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory() && !entry.name.startsWith(".") && !skip.has(path)) walk(path);
			else if (entry.name.endsWith(".feature")) found.push(path);
		}
	};
	if (existsSync(featuresDir(pkg, scope))) walk(featuresDir(pkg, scope));
	return found.sort();
}

/**
 * The behaviour spec the documents were generated from. A document carrying
 * another hash was generated from other scenarios and is stale.
 */
export function featuresHash(pkg: string, scope?: string): string {
	const hash = createHash("sha256");
	for (const file of featureFiles(pkg, scope))
		hash.update(`${relative(pkg, file)}\n${read(file)}\n`);
	return hash.digest("hex").slice(0, 12);
}

export interface FeatureOutline {
	readonly file: string;
	readonly title: string;
	readonly rules: readonly string[];
	readonly scenarios: readonly string[];
	readonly codeTags: readonly string[];
	/** IDs from `@spec:<ID>` tags: the spec scenarios this file covers. */
	readonly specTags: readonly string[];
}

export function featureOutlines(
	pkg: string,
	order: readonly string[] = [],
	scope?: string,
): FeatureOutline[] {
	const rank = (file: string) => {
		const at = order.indexOf(relative(featuresDir(pkg, scope), file));
		return at < 0 ? order.length : at;
	};
	const files = [...featureFiles(pkg, scope)].sort(
		(a, b) => rank(a) - rank(b) || a.localeCompare(b),
	);
	return files.map((file) => {
		const text = read(file);
		const all = (re: RegExp) => [...text.matchAll(re)].map((m) => (m[1] ?? "").trim());
		return {
			file: relative(pkg, file),
			title: all(/^\s*Feature:(.*)$/gm)[0] ?? "",
			rules: all(/^\s*Rule:(.*)$/gm),
			scenarios: all(/^\s*(?:Scenario|Example|Scenario Outline):(.*)$/gm),
			codeTags: all(/@code:(\S+)/g),
			specTags: all(/@spec:(\S+)/g),
		};
	});
}

/** The line of `symbol` in `path` (package-relative), or why there is none. */
export function locate(
	pkg: string,
	tag: string,
): { path: string; symbol: string; line: number } | { error: string } {
	const [path = "", symbol = ""] = tag.split(":");
	const file = join(pkg, path);
	if (!existsSync(file)) return { error: `${tag}: no file ${path}` };
	// A file with no symbol to name (a script's top-level code) links the
	// file itself, labelled by its name.
	if (symbol === "") return { path, symbol: basename(path), line: 1 };
	const line = read(file)
		.split("\n")
		.findIndex((l) =>
			new RegExp(
				`(function|const|class|let|interface|type)\\s+${symbol}\\b|^\\s*(async\\s+)?${symbol}\\s*\\(`,
			).test(l),
		);
	return line < 0
		? { error: `${tag}: no symbol ${symbol} in ${path}` }
		: { path, symbol, line: line + 1 };
}

/**
 * The leading comment of a file as Markdown — `//` lines, or one `/** … *\/`
 * block — with relative links rebased from the file's directory to `toDir`.
 * An ALL-CAPS lead-in ("WHY X.") turns bold.
 */
export function headerComment(pkg: string, path: string, toDir: string = pkg): string {
	const file = join(pkg, path);
	const lines: string[] = [];
	let block = false;
	for (const line of read(file).split("\n")) {
		if (lines.length === 0 && !block && line.startsWith("/**")) {
			block = true;
			const rest = line.replace(/^\/\*\*\s?/, "");
			if (rest.trim()) lines.push(rest);
			continue;
		}
		if (block) {
			if (line.trim().startsWith("*/")) break;
			lines.push(line.replace(/^\s*\* ?/, ""));
			continue;
		}
		if (line.startsWith("#!")) continue;
		if (!line.startsWith("//")) break;
		lines.push(line.replace(/^\/\/ ?/, ""));
	}
	return lines
		.join("\n")
		.replace(/\]\((?!https?:|#)([^)]+)\)/g, (_m, target: string) => {
			const rebased = relative(toDir, resolve(dirname(file), target));
			return `](${rebased})`;
		})
		.replace(/\{@link ([^}]+)\}/g, "`$1`")
		.replace(/^([A-Z][A-Z -]{2,}[A-Z](?: \([^)]*\))?)\.(?= |$)/gm, "**$1.**")
		.trim();
}

/**
 * Scenario IDs of an OpenSpec spec: each `#### Scenario: <ID> <title>`
 * heading, e.g. `#### Scenario: WE-06 Hidden matches remain undisclosed`.
 */
export function specScenarioIds(specFile: string): string[] {
	return [...read(specFile).matchAll(/^#### Scenario: ([A-Z]+-\d+) /gm)].map((m) => m[1] ?? "");
}

export interface UnitTest {
	readonly file: string;
	readonly name: string;
	/** `K1`…`K5` for a kept test, `open` for one a scenario should replace. */
	readonly verdict: string;
	readonly reason: string;
	/** Whether the reason is the test's own line or its file's `keep-file` line. */
	readonly scope: "test" | "file";
}

const TEST = /^\s*(?:it|test)(?:\.each\([^)]*\))?\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/;
const ANNOTATION = /^\s*\/\/ (?:keep\((K[1-5])\)|(open)): (.*)$/;
// One reason for every test in a file that has no line of its own, e.g. the
// rule cases of one validator: `// keep-file(K1): <reason>`.
const FILE_ANNOTATION = /^\/\/ keep-file\((K[1-5])\): (.*)$/m;
const DESCRIBE = /^\s*describe(?:\.each\([^)]*\))?\(\s*(["'`])((?:(?!\1)[^\\]|\\.)*)\1/;

/** Every `*.test.ts` under `src/`, package-relative and sorted. */
export function testFiles(pkg: string): string[] {
	const found: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules") continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name.endsWith(".test.ts")) found.push(relative(pkg, path));
		}
	};
	walk(join(pkg, "src"));
	return found.sort();
}

/**
 * Every unit test with the annotation on the line above it. A test without
 * one is reported as missing: each kept test says why the outside cannot check
 * the same thing.
 */
export function unitTests(pkg: string): { tests: UnitTest[]; missing: string[] } {
	const tests: UnitTest[] = [];
	const missing: string[] = [];
	for (const file of testFiles(pkg)) {
		const text = read(join(pkg, file));
		const lines = text.split("\n");
		const fileNote = text.match(FILE_ANNOTATION);
		let suite = "";
		lines.forEach((line, i) => {
			suite = line.match(DESCRIBE)?.[2] ?? suite;
			const title = line.match(TEST)?.[2];
			if (title === undefined) return;
			// An `it.each` title is a format string; its describe names it.
			const name = /%|\$/.test(title) ? `${suite} (each case)` : title;
			const note = lines[i - 1]?.match(ANNOTATION);
			if (note)
				tests.push({
					file,
					name,
					verdict: note[1] ?? note[2] ?? "",
					reason: note[3] ?? "",
					scope: "test",
				});
			else if (fileNote)
				tests.push({
					file,
					name,
					verdict: fileNote[1] ?? "",
					reason: fileNote[2] ?? "",
					scope: "file",
				});
			else missing.push(`${file}:${i + 1} "${name}"`);
		});
	}
	return { tests, missing };
}
