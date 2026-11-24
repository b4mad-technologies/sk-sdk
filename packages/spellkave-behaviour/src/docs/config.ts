// What a package tells the generators about itself, in
// `behaviour/docs.config.ts`. Everything else is read from the package: its
// features, test results, header comments, unit-test markers and scripts.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface GuideCommand {
	/** How a person calls it, e.g. `sk dev start [--prune]`. */
	readonly usage: string;
	readonly what: string;
}

/** A column the guide's command table adds for one package. */
export interface CommandColumn {
	readonly title: string;
	/** One line explaining the column's values, under the table. */
	readonly legend: string;
	readonly value: (verb: string, scenarios: GuideScenario[]) => string;
}

/** What a column or hook sees of one scenario in the run. */
export interface GuideScenario {
	readonly story: string;
	readonly status: string;
	/** Gherkin step sentences as run, with keyword (`Given my node is stopped`). */
	readonly steps: readonly string[];
}

export interface DocsConfig {
	/**
	 * One suite in a package that hosts several: a subfolder of behaviour/
	 * holding its features (and its .results). Absent: all of behaviour/.
	 */
	readonly scope?: string;
	/**
	 * `false` when the package's README is written by hand (a large CLI with one
	 * suite among many verbs): the generator and the drift check leave it alone.
	 */
	readonly readme?: false;
	/** File names under docs/ for the guide and the evidence; default guide.md, scenarios.md. */
	readonly docs?: { readonly guide?: string; readonly evidence?: string };
	/** The package script that regenerates this guide, for the guide's last line; default `guide`. */
	readonly guideScript?: string;
	/**
	 * Exit codes that are an answer, not a refusal (`sk diff -k` exits 3 when it
	 * finds differences): the guide quotes the answer record, not stderr.
	 */
	readonly answerExits?: readonly number[];
	/** The tool as a person types it, and the prefix of its run attachments: `sk`, `skgate`. */
	readonly binary: string;
	/** The command family the documents are about, when it is not the whole binary: `sk dev`. */
	readonly title?: string;
	/** One line on what the package is for (README quote, guide lead). */
	readonly tagline: string;
	/** The commands, in order, from the package's own source of truth (schema, usage text). */
	readonly commands: () => readonly (GuideCommand & { readonly replaces?: string })[];
	/** Which command a run belongs to, from the command as typed (`sk dev save x` → `dev save`). */
	readonly verbOf: (command: string) => string;
	/** Files whose header comment is the design, in reading order (package-relative). */
	readonly design: readonly string[];
	/** Files whose header comment explains the behaviour suite. */
	readonly suite: readonly string[];
	/** Repository paths whose local changes mark a run as dirty. */
	readonly watched: readonly string[];
	/** Extra columns in the guide's command table. */
	readonly commandColumns?: readonly CommandColumn[];
	/**
	 * The command a `When` sentence ran, as a person would type it; undefined
	 * for a sentence that runs nothing. Default: `I run "<command>"`.
	 */
	readonly commandOf?: (sentence: string) => string | undefined;
	/** The README's "Replaces" column header, when commands carry `replaces`. */
	readonly replacesTitle?: string;
	/** The line under the README's command table. */
	readonly commandsNote?: string;
	/** Checks named `check: <what>` that the guide shows under "Check it yourself". */
	readonly checks?: readonly string[];
	/** Author-declared constraints shown separately from run evidence; absent means none declared. */
	readonly knownLimits?: readonly string[];
	/**
	 * OpenSpec spec files (repo-relative) whose scenario IDs the features must
	 * cover with `@spec:<ID>` tags; checked by `specDrift`.
	 */
	readonly specs?: readonly string[];
	/** Feature files in reading order (paths under behaviour/); the rest follow by path. */
	readonly features?: readonly string[];
	/** The paragraph introducing those checks. */
	readonly checksIntro?: string;
	/** README sections after the commands, generated from the package's own data (e.g. a registry). */
	readonly readmeSections?: () => readonly {
		readonly title: string;
		readonly lines: readonly string[];
	}[];
}

export function defineDocs(config: DocsConfig): DocsConfig {
	return config;
}

/** behaviour/docs.config.ts, or behaviour/<scope>/docs.config.ts for one suite of several. */
export async function loadDocsConfig(pkg: string, scope?: string): Promise<DocsConfig> {
	const file = scope
		? join(pkg, "behaviour", scope, "docs.config.ts")
		: join(pkg, "behaviour/docs.config.ts");
	const module = (await import(pathToFileURL(file).href)) as {
		default: DocsConfig;
	};
	return module.default;
}
