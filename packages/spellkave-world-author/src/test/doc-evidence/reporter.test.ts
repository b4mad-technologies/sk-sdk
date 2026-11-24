// keep-file(K1): evidence rendering and byte-exact drift policy boundaries.
// A header edit keeps claim links stable; changed evidence still requires review.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

import { compareGeneratedReports } from "./check";
import type { DocEvidenceResult } from "./protocol";
import { renderClaimsLedger } from "./reporter";

const evidence: DocEvidenceResult = {
	doc: "manifest-format",
	tier: "offline",
	claim: "schema headers are required",
	testFile: "src/__tests__/doc-evidence-seed.test.ts",
	testLine: 40,
	state: "proven",
};

it("keeps the source file link byte-identical when a header shifts the test", () => {
	const ledger = renderClaimsLedger([evidence]);
	expect(renderClaimsLedger([{ ...evidence, testLine: 41 }])).toBe(ledger);
	expect(ledger).toContain(
		"[src/__tests__/doc-evidence-seed.test.ts](../src/__tests__/doc-evidence-seed.test.ts)",
	);
});

it("keeps byte-exact drift checks for changed evidence, paths and missing reports", () => {
	const root = mkdtempSync(join(tmpdir(), "doc-evidence-drift-"));
	try {
		const generated = join(root, "generated");
		const working = join(root, "working");
		for (const dir of [generated, working]) mkdirSync(join(dir, "ledger"), { recursive: true });
		writeFileSync(join(working, "ledger/claims.md"), renderClaimsLedger([evidence]));
		const write = (results: DocEvidenceResult[]) =>
			writeFileSync(join(generated, "ledger/claims.md"), renderClaimsLedger(results));
		write([{ ...evidence, testLine: 41 }]);
		expect(compareGeneratedReports(generated, working)).toEqual([]);
		for (const changed of [
			{ ...evidence, claim: "schema headers are optional" },
			{ ...evidence, testFile: "src/__tests__/different.test.ts" },
			{ ...evidence, state: "failed" as const },
		]) {
			write([changed]);
			expect(compareGeneratedReports(generated, working)).toEqual([
				"ledger/claims.md: committed report is stale",
			]);
		}
		write([]);
		expect(compareGeneratedReports(generated, working)).toEqual([
			"ledger/claims.md: committed report is stale",
		]);
		rmSync(join(generated, "ledger/claims.md"));
		expect(compareGeneratedReports(generated, working)).toEqual([
			"ledger/claims.md: committed generated report is no longer produced",
		]);
		write([evidence]);
		rmSync(join(working, "ledger/claims.md"));
		expect(compareGeneratedReports(generated, working)).toEqual([
			"ledger/claims.md: generated report is missing from the working tree",
		]);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
