// Ported from packages/spellkave-srd-cc/src/test/srd-coverage/reporter.ts
// (authoring-doc-evidence D1/D4) — same walk-results/parse-name/emit-Markdown
// shape, collapsed to this capability's single {doc, claim, tier} axis and one
// output file (`ledger/claims.md`, the generated successor of
// `docs/doc-truth-claims-register.md`).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { Reporter } from "vitest/reporters";

import {
	type DocEvidenceIdentity,
	type DocEvidenceResult,
	type DocEvidenceState,
	type DocEvidenceTier,
	parseDocEvidenceName,
	parseDocNotApplicableName,
} from "./protocol";

type TestRunEndArgs = Parameters<NonNullable<Reporter["onTestRunEnd"]>>;

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUTPUT_ROOT = process.env.DOC_EVIDENCE_OUTPUT_ROOT ?? PACKAGE_DIR;
// Link targets are always computed against the REAL committed ledger dir,
// never OUTPUT_ROOT — a temp-dir regen (used by check.ts's drift gate) must
// produce byte-identical link text to the committed file, only the write
// destination differs.
const LOGICAL_LEDGER_DIR = join(PACKAGE_DIR, "ledger");
const LEDGER_OUTPUT_DIR = join(OUTPUT_ROOT, "ledger");
const CLAIMS_OUTPUT_FILE = join(LEDGER_OUTPUT_DIR, "claims.md");
const GENERATED_NOTICE = [
	"> [!NOTE]",
	"> GENERATED from Vitest results by `src/test/doc-evidence/reporter.ts` — DO NOT EDIT BY HAND.",
] as const;
const TIER_ORDER: Record<DocEvidenceTier, number> = {
	offline: 0,
	"live-preseeded": 1,
	"live-self-seeding": 2,
};
const STATUS_LABEL = {
	proven: "✅ proven",
	reproduced: "❌ reproduced",
	unencoded: "⚠️ unencoded",
	notRun: "⏸ not run",
	failed: "💥 failed",
	notApplicable: "➖ n/a",
} as const;
const STATUS_LEGEND = `**Status:** ${STATUS_LABEL.proven} = assertion passed; ${STATUS_LABEL.reproduced} = desired assertion failed as expected (logical RED); ${STATUS_LABEL.unencoded} = assertion not written yet; ${STATUS_LABEL.notRun} = declaration was skipped, normally because its live tier did not run; ${STATUS_LABEL.notApplicable} = explicit, justified exception; ${STATUS_LABEL.failed} = test-lane failure.`;

function statusLabel(state: DocEvidenceState): string {
	if (state === "not-run") return STATUS_LABEL.notRun;
	if (state === "not-applicable") return STATUS_LABEL.notApplicable;
	return STATUS_LABEL[state];
}

function escapeCell(value: string): string {
	return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function normalizedTestFile(moduleId: string): string {
	const absolutePath = moduleId.startsWith("file:") ? fileURLToPath(moduleId) : moduleId;
	return relative(PACKAGE_DIR, absolutePath).replaceAll("\\", "/");
}

// File links remain stable when comments move assertions; evidence identities locate the test.
function testLink(testFile: string): string {
	const target = relative(LOGICAL_LEDGER_DIR, join(PACKAGE_DIR, testFile)).replaceAll("\\", "/");
	return `[${testFile}](${target})`;
}

function sorted(results: readonly DocEvidenceResult[]): DocEvidenceResult[] {
	return [...results].sort(
		(a, b) =>
			a.doc.localeCompare(b.doc) ||
			TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
			a.claim.localeCompare(b.claim),
	);
}

export function renderClaimsLedger(results: readonly DocEvidenceResult[]): string {
	const ordered = sorted(results);
	const byDoc = new Map<string, DocEvidenceResult[]>();
	for (const result of ordered) {
		const current = byDoc.get(result.doc) ?? [];
		current.push(result);
		byDoc.set(result.doc, current);
	}
	const applicable = results.filter((result) => result.state !== "not-applicable");
	const lines = [
		"# Doc-evidence claims ledger",
		"",
		...GENERATED_NOTICE,
		"",
		"Each row is an authored `docEvidence` / `docGap` / `docNotApplicable` declaration beside the assertion that proves it; status and anchor are generated from the Vitest result — never a hand-maintained registry. Deleting a declaration removes its row on the next regeneration.",
		"",
		STATUS_LEGEND,
		"",
		`**Declared claims:** ${results.length} (${applicable.length} applicable — ${applicable.filter((r) => r.state === "proven").length} proven, ${applicable.filter((r) => r.state === "reproduced").length} reproduced, ${applicable.filter((r) => r.state === "unencoded").length} unencoded, ${applicable.filter((r) => r.state === "not-run").length} not run, ${applicable.filter((r) => r.state === "failed").length} failed; ${results.length - applicable.length} not applicable).`,
		"",
	];
	for (const [doc, docResults] of byDoc) {
		lines.push(
			`## ${escapeCell(doc)}`,
			"",
			"| Status | Tier | Claim | Test |",
			"|---|---|---|---|",
			...docResults.map(
				(result) =>
					`| ${statusLabel(result.state)} | ${result.tier} | ${escapeCell(result.claim)} | ${testLink(result.testFile)} |`,
			),
			"",
		);
	}
	return lines.join("\n");
}

export function docEvidenceStateForTest(test: {
	options: { mode: "run" | "only" | "skip" | "todo"; fails?: boolean };
	result(): { state: "pending" | "passed" | "failed" | "skipped" };
}): DocEvidenceState {
	if (test.options.mode === "todo") return "unencoded";
	if (test.options.mode === "skip") return "not-run";
	const state = test.result().state;
	if (state === "pending" || state === "skipped") return "not-run";
	if (state === "failed") return "failed";
	return test.options.fails === true ? "reproduced" : "proven";
}

export default class DocEvidenceReporter implements Reporter {
	onTestRunEnd(testModules: TestRunEndArgs[0], unhandledErrors: TestRunEndArgs[1]): void {
		if (unhandledErrors.length > 0) return;
		const results: DocEvidenceResult[] = [];
		for (const module of testModules) {
			for (const test of module.children.allTests()) {
				const evidence = parseDocEvidenceName(test.name);
				const notApplicable = parseDocNotApplicableName(test.name);
				const declaration: DocEvidenceIdentity | undefined = evidence ?? notApplicable;
				if (declaration === undefined) continue;
				results.push({
					...declaration,
					testFile: normalizedTestFile(module.moduleId),
					testLine: test.location?.line,
					state: notApplicable === undefined ? docEvidenceStateForTest(test) : "not-applicable",
				});
			}
		}
		// No live declarations this run ⇒ emit nothing — deleting the last
		// declaration retires the file on the next regeneration/drift check.
		if (results.length === 0) return;
		mkdirSync(LEDGER_OUTPUT_DIR, { recursive: true });
		writeFileSync(CLAIMS_OUTPUT_FILE, renderClaimsLedger(results), "utf8");
	}
}
