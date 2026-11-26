// Project one behaviour run (allure-vitest results) into two documents:
//
//   docs/guide.md      short and intent-first, for people and coding agents:
//                      run header, the tested I/O contract, the commands, task
//                      recipes, how to check the result yourself, known limits
//   docs/scenarios.md  the evidence: every scenario with its real transcripts
//
// Every sentence comes from a .feature file, the package's own command source
// or its docs configuration; every example comes from a real run. Declared
// constraints are labelled separately from execution evidence. A scenario
// that did not pass is labelled, never shown as working. Setup runs
// (the "Given" preparation) are hidden, and tool output that is left out is
// counted, not silently dropped. A code link whose file or symbol does not
// exist fails the generator. Both documents carry the hash of the .feature
// files they come from, so a drift check can tell when they are stale.

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";

import type { DocsConfig, GuideScenario } from "./config.ts";
import { anchor } from "./readme.ts";
import { featureFiles, featuresHash, locate, resultsDir as resultsOf } from "./sources.ts";

interface Label {
	name: string;
	value: string;
}
interface Attachment {
	name: string;
	type: string;
	source: string;
}
interface Step {
	name: string;
	steps?: Step[];
	attachments?: Attachment[];
}
interface Result {
	status: string;
	fullName: string;
	labels: Label[];
	steps?: Step[];
	start?: number;
	tags?: string[];
	statusDetails?: { message?: string };
}
type Body = Attachment & { body: string };

const STATUS: Record<string, string> = {
	passed: "verified",
	failed: "FAILING",
	broken: "BROKEN",
	skipped: "not working yet (planned)",
	unrun: "not run in this run",
};
const statusOf = (r: Result) => STATUS[r.status] ?? r.status;

// Map.groupBy, without needing the ES2024 lib.
function groupBy<T, K>(items: Iterable<T>, key: (item: T) => K): Map<K, T[]> {
	const groups = new Map<K, T[]>();
	for (const item of items) {
		const k = key(item);
		const group = groups.get(k);
		if (group) group.push(item);
		else groups.set(k, [item]);
	}
	return groups;
}

// Tool output that says nothing about the behaviour under test. It is counted
// and the count is shown, so a reader knows something was left out.
const NOISE = [
	/^WARNING: This command is UNSTABLE/,
	/^\s*(Compiling|Finished|Generating|Generate finished|Optimising|Build finished|Uploading|Publishing|Updated database|Skipping confirmation|This will DESTROY)/,
	/^(Skipping private tables|Writing file |Creating directory |Checking for breaking changes|Generating (Rust|TypeScript) module bindings|Formatting |Database Migration Plan)/,
	/^[━─]+$/,
];
const MAX_WIDTH = 400;
// Terminal colour codes (ESC [ … m), built from the char code to keep the regex printable.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Preserve balanced command spans within transcript boundaries. This is lexical:
 * an unquoted argument apostrophe followed by stdout with another apostrophe
 * is indistinguishable from a multiline command in the unchanged recorder format.
 */
function commandLines(lines: readonly string[]): ReadonlyMap<number, boolean> {
	// Values mark trailing whitespace that is literal quoted or escaped argument data.
	const commands = new Map<number, boolean>();
	for (let start = 0; start < lines.length; start++) {
		if (!lines[start]?.trimStart().startsWith("$ ")) continue;
		commands.set(start, false);
		let quote: "'" | '"' | undefined;
		const span = new Map<number, boolean>();
		for (let end = start; end < lines.length; end++) {
			const line = lines[end] ?? "";
			// Attachment markers and Markdown fences are never a continuation.
			if (end > start && /^\s*(?:\[stderr\]|\[exit -?\d+\]|```)/.test(line)) break;
			let escaped = false;
			let literalWhitespace = false;
			for (const char of line) {
				literalWhitespace = /\s/.test(char) && (quote !== undefined || escaped);
				if (escaped) escaped = false;
				else if (quote === "'") {
					if (char === "'") quote = undefined;
				} else if (char === "\\") escaped = true;
				else if (quote === '"') {
					if (char === '"') quote = undefined;
				} else if (char === "'" || char === '"') quote = char;
			}
			span.set(end, quote !== undefined || literalWhitespace);
			if (!quote && !escaped) {
				for (const [index, literal] of span) commands.set(index, literal);
				start = end;
				break;
			}
		}
	}
	return commands;
}

function clean(text: string): string {
	const lines = text.split("\n");
	const commands = commandLines(lines);
	let elided = 0;
	const kept: string[] = [];
	for (const [index, raw] of lines.entries()) {
		// Command data can resemble build noise or contain ANSI, blank or long lines.
		if (commands.has(index)) {
			kept.push(raw);
			continue;
		}
		const line = raw.replace(ANSI, "");
		if (!line.trim()) continue;
		if (NOISE.some((re) => re.test(line))) elided += 1;
		else
			kept.push(
				line.length > MAX_WIDTH
					? `${line.slice(0, MAX_WIDTH)} … (${line.length - MAX_WIDTH} more characters)`
					: line,
			);
	}
	if (elided) {
		const exit = kept.at(-1)?.startsWith("[exit") ? kept.pop() : undefined;
		if (!kept.includes("[stderr]")) kept.push("[stderr]");
		kept.push(`… ${elided} lines of build and tool output not shown`);
		if (exit) kept.push(exit);
	}
	if (kept.at(-2) === "[stderr]" && kept.at(-1)?.startsWith("[exit")) kept.splice(-2, 1);
	return kept.join("\n");
}

/**
 * The refusal a person sees in one run's transcript (`$ cmd`, stdout,
 * `[stderr]`, stderr, `[exit N]`): the message of an error record on stdout;
 * else, for a non-zero exit that is not one of `answerExits`, the first
 * stderr line that is not a JSON diagnostic (a library's structured warning
 * is not the tool's refusal). Undefined when the run was not refused.
 */
export function refusalOf(body: string, answerExits: readonly number[] = []): string | undefined {
	const [out = "", err = ""] = body.split("\n[stderr]\n");
	const records = out
		.split("\n")
		.slice(1)
		.filter((l) => l.startsWith("{"))
		.map((l) => {
			try {
				return JSON.parse(l) as Record<string, unknown>;
			} catch {
				return {};
			}
		});
	const last = records.at(-1);
	if (last?.kind === "error") return String(last.message);
	const exit = Number(body.match(/\[exit (-?\d+)\]\s*$/)?.[1] ?? 0);
	if (exit === 0 || answerExits.includes(exit)) return undefined;
	const line = err
		.split("\n")
		.map((l) => l.trim())
		.find((l) => l && !l.startsWith("[exit") && !l.startsWith("{"));
	return line?.slice(0, 200);
}

/**
 * Replaces the checkout path with `<repo>` and the home directory with `~`.
 * Transcripts are already home-shortened when captured (cliRunner), so the
 * checkout can appear as `~/...` as well as absolute.
 */
export function publishablePaths(text: string, repo: string, home: string): string {
	return text
		.replaceAll(repo, "<repo>")
		.replaceAll(homeShortened(repo, home), "<repo>")
		.replaceAll(home, "~");
}

function homeShortened(path: string, home: string): string {
	return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function generateGuide(
	pkg: string,
	config: DocsConfig,
	resultsDir: string = resultsOf(pkg, config.scope),
	docsDir: string = join(pkg, "docs"),
): { guide: number; scenarios: number } {
	const GUIDE = config.docs?.guide ?? "guide.md";
	const EVIDENCE = config.docs?.evidence ?? "scenarios.md";
	const results: Result[] = readdirSync(resultsDir)
		.filter((f) => f.endsWith("-result.json"))
		.map((f) => JSON.parse(readFileSync(join(resultsDir, f), "utf8")) as Result);

	const label = (r: Result, name: string) => r.labels.find((l) => l.name === name)?.value;
	const labels = (r: Result, name: string) =>
		r.labels.filter((l) => l.name === name).map((l) => l.value);
	const story = (r: Result) => label(r, "story") ?? "";
	const evidence = (r: Result) => `${EVIDENCE}#${anchor(story(r))}`;

	// ---- the .feature text: narratives, tables, planned and unrun steps ------

	const featureFile = (r: Result) =>
		resolve(pkg, (r.fullName.split(":")[1] ?? "").split("#")[0] ?? "");
	const featureText = new Map<string, string[]>();
	const lines = (r: Result) => {
		const file = featureFile(r);
		if (!featureText.has(file)) featureText.set(file, readFileSync(file, "utf8").split("\n"));
		return featureText.get(file) ?? [];
	};

	function narrative(r: Result): string {
		const ls = lines(r);
		const start = ls.findIndex((l) => /^\s*Feature:/.test(l)) + 1;
		const end = ls.findIndex(
			(l, i) => i >= start && /^\s*(Background|Scenario|Rule|Example|@)/.test(l),
		);
		return ls
			.slice(start, end)
			.map((l) => l.trim())
			.join("\n")
			.trim();
	}

	const STEP = /^\s*(Given|When|Then|And|But)\b/;
	function scenarioBlock(r: Result): { description: string; steps: string[] } {
		const ls = lines(r);
		const at = ls.findIndex(
			(l) => /^\s*(Scenario|Example|Scenario Outline):/.test(l) && l.includes(story(r)),
		);
		const description: string[] = [];
		const steps: string[] = [];
		for (
			let i = at + 1;
			i < ls.length && !/^\s*(Scenario|Example|Rule|@|Examples:)/.test(ls[i] ?? "");
			i++
		) {
			const line = ls[i] ?? "";
			if (STEP.test(line)) steps.push(line.trim());
			else if (line.trim() && !line.trim().startsWith("|") && steps.length === 0)
				description.push(line.trim());
		}
		return { description: description.join(" "), steps };
	}

	function tableAfter(r: Result, sentence: string): string[] {
		const ls = lines(r);
		const at = ls.findIndex((l) => l.trim().replace(STEP, "").trim() === sentence);
		const rows: string[] = [];
		for (let i = at + 1; at >= 0 && i < ls.length && (ls[i] ?? "").trim().startsWith("|"); i++)
			rows.push((ls[i] ?? "").trim());
		return rows;
	}

	// Scenarios a run did not execute (e.g. @build ones in the fast loop) still
	// belong in the documents, labelled as not run, with their steps from the text.
	function unrunScenarios(): Result[] {
		const ran = new Set(results.map((r) => `${featureFile(r)}#${story(r)}`));
		const extra: Result[] = [];
		for (const file of featureFiles(pkg, config.scope)) {
			let feature = "";
			let persona = "";
			let rule: string | undefined;
			let tags: string[] = [];
			for (const line of readFileSync(file, "utf8").split("\n")) {
				const text = line.trim();
				if (text.startsWith("@")) tags.push(...text.split(/\s+/));
				else if (text.startsWith("Feature:")) {
					feature = text.slice("Feature:".length).trim();
					persona = (tags.find((t) => t.startsWith("@persona:")) ?? "").slice("@persona:".length);
					tags = [];
				} else if (text.startsWith("Rule:")) {
					rule = text.slice("Rule:".length).trim();
					tags = [];
				} else if (/^(Scenario|Example):/.test(text)) {
					const title = text.replace(/^(Scenario|Example):\s*/, "");
					if (!ran.has(`${file}#${title}`)) {
						const who = persona.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
						extra.push({
							status: tags.includes("@planned") ? "skipped" : "unrun",
							fullName: `x:${relative(pkg, file)}#${title}`,
							tags,
							steps: [],
							labels: [
								{ name: "epic", value: who },
								{ name: "feature", value: feature },
								{ name: "story", value: title },
								{ name: "layer", value: rule ? "rule" : "intent" },
								...(rule ? [{ name: "rule", value: rule }] : []),
								...tags
									.filter((t) => t.startsWith("@code:"))
									.map((t) => ({ name: "code", value: t.slice(6) })),
							],
						});
					}
					tags = [];
				} else if (/^Scenario Outline:/.test(text)) tags = [];
			}
		}
		return extra;
	}
	const ranCount = results.length;
	results.push(...unrunScenarios());

	// ---- code links ----------------------------------------------------------

	// A link to the file, not the line: line numbers move with every edit and
	// the documents are regenerated only by a live run.
	const broken: string[] = [];
	function codeLink(tag: string): string {
		const found = locate(pkg, tag);
		if ("error" in found) {
			broken.push(found.error);
			return `\`${tag}\``;
		}
		return `[\`${found.symbol}\`](${relative(docsDir, join(pkg, found.path))})`;
	}
	const codeLinks = (r: Result) => [...new Set(labels(r, "code"))].map(codeLink).join(", ");

	// ---- transcripts -----------------------------------------------------------

	const attachments = (step: Step): Body[] =>
		[step, ...(step.steps ?? [])]
			.flatMap((s) => s.attachments ?? [])
			.map((a) => ({ ...a, body: readFileSync(join(resultsDir, a.source), "utf8") }));
	const userRuns = (r: Result) =>
		(r.steps ?? []).flatMap((step) =>
			attachments(step).filter(
				(a) => a.name.startsWith(`${config.binary} `) && a.type === "text/plain",
			),
		);
	// The first user-facing run of a scenario, its last stdout record, and the
	// message of its error record if it was refused.
	const firstRun = (r: Result) => userRuns(r)[0];
	function lastStdoutRecord(run: Body | undefined): Record<string, unknown> | undefined {
		const stdout =
			run?.body
				.split("\n[stderr]")[0]
				?.split("\n")
				.slice(1)
				.filter((l) => l.startsWith("{")) ?? [];
		try {
			return stdout.length
				? (JSON.parse(stdout.at(-1) ?? "") as Record<string, unknown>)
				: undefined;
		} catch {
			return undefined;
		}
	}
	// The refusal a person sees: the error record's message, else (for a tool
	// that refuses on stderr) the first stderr line of a run that exited non-zero.
	const errorMessage = (r: Result) => {
		const run = firstRun(r);
		return run ? refusalOf(run.body, config.answerExits) : undefined;
	};
	// What the tool answered, as short as a guide line can carry it: a message
	// (an error record, the first finding, or a stderr refusal), else the last
	// JSON record with long lists summarised, else one plain stdout line.
	// Several plain lines (a table, TOON, a listing) are answerBlock's.
	const shownAnswer = (r: Result): string | undefined => {
		const run = firstRun(r);
		if (!run || r.status !== "passed") return undefined;
		const refusal = errorMessage(r);
		if (refusal) return `“${refusal}”`;
		const stdout = run.body.split("\n[stderr]")[0]?.split("\n").slice(1) ?? [];
		const json = stdout.filter((l) => l.startsWith("{"));
		const said = json
			.map((l) => {
				try {
					return JSON.parse(l) as Record<string, unknown>;
				} catch {
					return {};
				}
			})
			.find((record) => typeof record.message === "string");
		if (said) return `“${String(said.message).slice(0, 200)}”`;
		const record = lastStdoutRecord(run);
		if (record) {
			const text = JSON.stringify(record, (_key, value) =>
				Array.isArray(value) && value.length > 3 ? `[${value.length} entries]` : value,
			);
			return `\`${text.length > 240 ? `${text.slice(0, 240)} …` : text}\``;
		}
		const lines = stdout.filter((l) => l.trim() && !l.startsWith("[exit"));
		// One pretty-printed JSON document reads better compacted.
		try {
			const text = JSON.stringify(JSON.parse(lines.join("\n")));
			return `\`${text.length > 240 ? `${text.slice(0, 240)} …` : text}\``;
		} catch {
			// Not one JSON document: plain lines.
		}
		return lines.length === 1 ? `\`${(lines[0] ?? "").trim().slice(0, 160)}\`` : undefined;
	};
	// Multi-line plain output as the reader would see it in a terminal: the
	// command, then the first lines with their indentation, then how many more.
	const BLOCK_LINES = 12;
	const answerBlock = (r: Result): string[] | undefined => {
		const run = firstRun(r);
		if (!run || r.status !== "passed" || shownAnswer(r) !== undefined) return undefined;
		const [command = "", ...rest] = run.body.split("\n[stderr]")[0]?.split("\n") ?? [];
		const lines = rest.filter((l) => l.trim() && !l.startsWith("[exit"));
		if (lines.length < 2) return undefined;
		const cut = (l: string) => (l.length > 160 ? `${l.slice(0, 160)} …` : l.trimEnd());
		return [
			command,
			...lines.slice(0, BLOCK_LINES).map(cut),
			...(lines.length > BLOCK_LINES ? [`… (${lines.length - BLOCK_LINES} more lines)`] : []),
		];
	};
	const fenced = (indent: string, block: readonly string[]) => [
		`${indent}\`\`\`text`,
		...block.map((l) => `${indent}${l}`),
		`${indent}\`\`\``,
	];
	// A scenario's own description, the "why" under its title.
	const why = (r: Result) => scenarioBlock(r).description;
	const checks = (r: Result) =>
		(r.steps ?? []).flatMap((step) => attachments(step).filter((a) => a.name.startsWith("check:")));
	const verbOf = (name: string) => config.verbOf(name);

	// ---- order and grouping --------------------------------------------------

	const listed = (config.features ?? []).map((name) => join(pkg, "behaviour", name));
	const rank = (file: string) => {
		const at = listed.indexOf(file);
		return at < 0 ? listed.length : at;
	};
	const order = (r: Result): [string, number] => [
		featureFile(r),
		lines(r).findIndex((l) => l.includes(story(r))),
	];
	results.sort((a, b) => {
		const [fa, la] = order(a);
		const [fb, lb] = order(b);
		if (fa === fb) return la - lb;
		return rank(fa) - rank(fb) || fa.localeCompare(fb);
	});
	const byFeature = groupBy(results, (r) => label(r, "feature") ?? "");

	// ---- scenarios.md: the evidence ------------------------------------------

	const shownVerbs = new Set<string>();
	function renderScenario(r: Result, out: string[]): void {
		out.push(`### ${story(r)}`, "");
		const meta = [`Status: **${statusOf(r)}**`];
		if (labels(r, "code").length) meta.push(`Code: ${codeLinks(r)}`);
		out.push(meta.join(" · "), "");
		const block = scenarioBlock(r);
		if (block.description) out.push(`> ${block.description}`, "");
		if (r.status === "unrun" && r.tags?.includes("@build")) {
			out.push("> Build-bound: runs only in the full suite (`@build`).", "");
		}
		if (r.status === "skipped" || r.status === "unrun") {
			for (const line of block.steps) out.push(`- ${line}`);
			out.push("");
			return;
		}
		for (const step of r.steps ?? []) {
			out.push(`- ${step.name}`);
			const table = tableAfter(r, step.name.replace(/^(Given|When|Then)\s+/, ""));
			if (table.length) out.push("", ...table.map((row) => `  ${row}`), "");
			for (const a of attachments(step)) {
				if (a.name === "table" || a.name.startsWith("setup:") || a.type === "text/markdown")
					continue;
				const body = [
					"",
					"  ```console",
					...clean(a.body)
						.split("\n")
						.map((l) => `  ${l}`),
					"  ```",
					"",
				];
				// The first run of each command is shown in full; later runs fold away.
				const verb = a.name.startsWith("check:") ? a.name : verbOf(a.name);
				if (shownVerbs.has(verb)) {
					out.push("", `  <details><summary>${a.name}</summary>`, ...body, "  </details>", "");
				} else {
					shownVerbs.add(verb);
					out.push(...body);
				}
			}
		}
		if (!["passed", "skipped"].includes(r.status) && r.statusDetails?.message) {
			out.push("", `  Failure: ${r.statusDetails.message.split("\n")[0]}`);
		}
		out.push("");
	}

	const evidenceBody: string[] = [];
	const references: string[] = [];
	for (const [feature, items] of byFeature) {
		const first = items[0];
		if (!first) continue;
		evidenceBody.push(`## ${feature}`, "", narrative(first), "");
		const rules = groupBy(
			items.filter((r) => label(r, "layer") === "rule"),
			(r) => label(r, "rule") ?? "",
		);
		for (const r of items.filter((r) => label(r, "layer") === "intent"))
			renderScenario(r, evidenceBody);
		for (const [rule, ruleItems] of rules) {
			evidenceBody.push(`**Rule: ${rule}.**`, "");
			for (const r of ruleItems) renderScenario(r, evidenceBody);
		}
		for (const r of items) {
			for (const step of r.steps ?? []) {
				for (const a of attachments(step)) if (a.type === "text/markdown") references.push(a.body);
			}
		}
	}

	// ---- guide.md: intent first ----------------------------------------------

	// The commit the run tested (setup records it); older result sets fall back
	// to the commit at generation time.
	const runFile = join(resultsDir, "run.json");
	const run = existsSync(runFile)
		? (JSON.parse(readFileSync(runFile, "utf8")) as { commit: string; dirty: boolean })
		: {
				commit: execSync("git rev-parse --short HEAD", { cwd: pkg, encoding: "utf8" }).trim(),
				dirty: true,
			};
	const rev = `${run.commit}${run.dirty ? " + local changes" : ""}`;
	const ranAt = Math.min(...results.filter((r) => r.start).map((r) => r.start ?? 0));
	const fullRun = !results.some((r) => r.status === "unrun");
	const counts = [...groupBy(results, (r) => r.status)]
		.map(([s, rs]) => `${rs.length} ${STATUS[s] ?? s}`)
		.join(", ");

	const asScenario = (r: Result): GuideScenario => ({
		story: story(r),
		status: r.status,
		steps: (r.steps ?? []).map((s) => s.name),
	});

	// The contract: the rules of the feature that says how the tool answers.
	const contractFeature = [...byFeature.keys()].find((f) => /answers/i.test(f));
	const contract = contractFeature
		? [
				...groupBy(
					(byFeature.get(contractFeature) ?? []).filter((r) => label(r, "layer") === "rule"),
					(r) => label(r, "rule") ?? "",
				),
			].flatMap(([rule, rs]) => {
				const ok = rs.every((r) => r.status === "passed");
				// Each example with what it answered, so the shape is visible here.
				const examples = rs.flatMap((r) => {
					const answer = shownAnswer(r);
					const block = answerBlock(r);
					return [
						`  - [${story(r)}](${evidence(r)})${answer ? `: ${answer}` : ""}`,
						...(block ? fenced("    ", block) : []),
					];
				});
				return [`- **${rule}.**${ok ? "" : " **(not verified)**"}`, ...examples];
			})
		: [];

	// Commands: from the package's own command source, with the scenarios that ran each.
	const scenariosFor = (verb: string) =>
		results.filter(
			(r) =>
				userRuns(r).some((a) => verbOf(a.name) === verb) ||
				(r.status !== "passed" &&
					scenarioBlock(r).steps.some((s) => {
						const command = s.match(/"([^"]*)"/)?.[1];
						return (
							command !== undefined &&
							verbOf(
								`${config.binary} ${command.replace(new RegExp(`^${config.binary}\\s+`), "")}`,
							) === verb
						);
					})),
		);
	const columns = config.commandColumns ?? [];
	const commandRows = config.commands().map((command) => {
		const verb = verbOf(command.usage);
		const scs = scenariosFor(verb);
		const first = scs[0];
		const extra = columns.map((c) => ` ${c.value(verb, scs.map(asScenario))} |`).join("");
		return `| \`${command.usage.replaceAll("|", "\\|")}\` | ${command.what.replaceAll("|", "\\|")} |${extra} ${first ? `[${scs.length}](${evidence(first)})` : "0"} |`;
	});

	// Recipes: each intent scenario as the commands it ran.
	const commandOf =
		config.commandOf ?? ((sentence: string) => sentence.match(/I run "([^"]*)"/)?.[1]);
	const recipes: string[] = [];
	for (const [feature, items] of byFeature) {
		if (feature === contractFeature) continue;
		const intents = items.filter((r) => label(r, "layer") === "intent");
		if (!intents.length) continue;
		recipes.push(`**${feature}**`, "");
		for (const r of intents) {
			const fromRun = (r.steps ?? [])
				.filter((s) => s.name.startsWith("When "))
				.map((s) => commandOf(s.name));
			const fromText = scenarioBlock(r)
				.steps.filter((s) => /^(When|And) /.test(s))
				.map(commandOf);
			const ranCommands = userRuns(r).map((a) => a.name.replace(/\s+/g, " "));
			const cmds = (
				fromRun.some(Boolean) ? fromRun : fromText.some(Boolean) ? fromText : ranCommands
			)
				.filter((c): c is string => Boolean(c))
				.map((c) => `\`${c}\``);
			const mark = r.status === "passed" ? "" : ` _(${statusOf(r)})_`;
			const code = codeLinks(r);
			recipes.push(
				`- [${story(r)}](${evidence(r)})${mark}: ${cmds.join(" → ")}${code ? ` · ${code}` : ""}`,
			);
			if (why(r)) recipes.push(`  ${why(r)}`);
			const answer = shownAnswer(r);
			if (answer) recipes.push(`  → ${answer}`);
			const block = answerBlock(r);
			if (block) recipes.push(...fenced("  ", block));
		}
		recipes.push("");
	}

	// Rules: one line each, the examples that prove them.
	const rules: string[] = [];
	for (const [feature, items] of byFeature) {
		if (feature === contractFeature) continue;
		for (const [rule, rs] of groupBy(
			items.filter((r) => label(r, "layer") === "rule"),
			(r) => label(r, "rule") ?? "",
		)) {
			rules.push(`- **${rule}.**`);
			for (const r of rs) {
				const answer = shownAnswer(r);
				const mark = r.status === "passed" ? "" : ` _(${statusOf(r)})_`;
				rules.push(`  - [${story(r)}](${evidence(r)})${mark}${answer ? `: ${answer}` : ""}`);
				if (why(r)) rules.push(`    ${why(r)}`);
				const block = answerBlock(r);
				if (block) rules.push(...fenced("    ", block));
			}
		}
	}

	// Check it yourself: the checks the suite itself ran, as a person can repeat them.
	const checkFor = (what: string) =>
		results.flatMap(checks).find((a) => a.name === `check: ${what}`);
	const checkLines = (config.checks ?? [])
		.map((what) => checkFor(what))
		.filter((a): a is Body => a !== undefined)
		.flatMap((a) => [`# ${a.name.replace(/^check: /, "")}`, ...clean(a.body).split("\n"), ""]);

	// Declared constraints do not change scenario statuses or count as run evidence.
	const declaredLimits = config.knownLimits ?? [];
	// Execution limits: whatever did not pass in this run.
	const limits = results
		.filter((r) => r.status !== "passed")
		.map((r) => {
			const why = scenarioBlock(r).description;
			return `- ${statusOf(r)}: [${story(r)}](${evidence(r)})${why ? ` — ${why}` : ""}`;
		});

	if (broken.length) throw new Error(`broken code links:\n  ${broken.join("\n  ")}`);

	const json = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")) as { name: string };
	const header = [
		`<!-- Generated by @spellkave/behaviour (behaviour-docs guide) from one behaviour run, features ${featuresHash(pkg, config.scope)}; do not edit by hand. -->`,
		"",
		`Run: commit \`${rev}\`, ${new Date(ranAt).toISOString().slice(0, 16)}Z, ${fullRun ? "full suite" : "partial run (some scenarios not run)"} — ${counts}.`,
		declaredLimits.length
			? `Executed scenarios have transcripts in [${EVIDENCE}](${EVIDENCE}). Author-declared constraints in [Known limits](${GUIDE}#known-limits) are not execution evidence.`
			: `Every statement below is a scenario that ran against the real tool; [${EVIDENCE}](${EVIDENCE}) has the transcripts.`,
	];

	const guide = [
		`# ${config.title ?? config.binary}`,
		"",
		...header,
		"",
		`> ${config.tagline}`,
		"",
		...(contract.length ? ["## How it answers", "", ...contract, ""] : []),
		"## Commands",
		"",
		`| Command | What it does |${columns.map((c) => ` ${c.title} |`).join("")} Scenarios (count) |`,
		`|---|---|${columns.map(() => "---|").join("")}---|`,
		...commandRows,
		"",
		...columns.map((c) => c.legend),
		...(columns.length ? [""] : []),
		"## Recipes",
		"",
		...recipes,
		...(rules.length ? ["## Rules", "", ...rules, ""] : []),
		...(checkLines.length
			? [
					"## Check it yourself",
					"",
					config.checksIntro ?? "The checks the suite ran outside the tool, as it ran them:",
					"",
					"```console",
					...checkLines,
					"```",
					"",
				]
			: []),
		"## Known limits",
		"",
		...(declaredLimits.length
			? [
					"### Author-declared constraints",
					"",
					"These constraints are declared by the package author; this run does not prove them.",
					"",
					...declaredLimits.map((limit) => `- ${limit}`),
					"",
					"### Execution results",
					"",
				]
			: []),
		...(limits.length ? limits : ["- None in this run."]),
		"",
		`Regenerate: run the behaviour suite, then \`pnpm --filter ${json.name} ${config.guideScript ?? "guide"}\`. ${ranCount} scenarios ran.`,
		"",
	];

	const scenarios = [
		`# ${config.title ?? config.binary} — scenarios and evidence`,
		"",
		...header,
		"",
		`The short version is [${GUIDE}](${GUIDE}). Below, each command's first run is shown in full; later runs of the same command are folded.`,
		"",
		...evidenceBody,
		...(references.length
			? [
					"## Command reference",
					"",
					"Printed by the tool's own help during this run.",
					"",
					...references,
					"",
				]
			: []),
	];

	// Published docs must not carry this machine's paths: shorten what slipped
	// through, and refuse to write if the home directory remains.
	const repo = execSync("git rev-parse --show-toplevel", { cwd: pkg, encoding: "utf8" }).trim();
	const publishable = (text: string) => publishablePaths(text, repo, homedir());
	const tidy = (text: string) => {
		const lines = text.split("\n");
		const commands = commandLines(lines);
		return lines
			.map((line, index) => (commands.get(index) ? line : line.trimEnd()))
			.join("\n")
			.replace(/\n*$/, "\n");
	};
	const guideText = tidy(publishable(guide.join("\n")));
	const scenariosText = tidy(publishable(scenarios.join("\n")));
	for (const [name, text] of [
		[GUIDE, guideText],
		[EVIDENCE, scenariosText],
	] as const) {
		if (text.includes(homedir())) throw new Error(`${name} still contains ${homedir()}`);
		const shortRepo = homeShortened(repo, homedir());
		if (text.includes(shortRepo)) throw new Error(`${name} still contains ${shortRepo}`);
	}
	mkdirSync(docsDir, { recursive: true });
	writeFileSync(join(docsDir, GUIDE), guideText);
	writeFileSync(join(docsDir, EVIDENCE), scenariosText);
	return { guide: guide.length, scenarios: scenarios.length };
}
