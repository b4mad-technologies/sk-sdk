import { readFileSync, writeFileSync } from "node:fs";
import { tsImport } from "tsx/esm/api";

const { projectScenarioGuide, sanitizeScenarioText } = await tsImport("../../spellkave-world-author/src/scenario-guidance.ts", { parentURL: import.meta.url, tsconfig: false });
const proof = JSON.parse(readFileSync(process.argv[2], "utf8"));
const receipt = JSON.parse(readFileSync(process.argv[3], "utf8"));
const scope = process.argv[5] === "candidate"
	? "Verified documentation retrieval for the named candidate's exact artifact and corpus. This does not verify a later corpus, hosted delivery or live behavior."
	: "Historical partial capture for the named unpublished candidate. This does not verify a later corpus, hosted delivery, live behavior or a public release.";
if (proof.artifact_sha256 !== receipt.artifact_sha256) throw new Error("Capture/artifact receipt mismatch");
const capture = {
	scenario: "AUTH-56-01", test: "packages/spellkave-cli/scripts/prove-portable.mjs",
	state: proof.outcome === "passed" ? "proven" : "failed",
	implementing_revision: `artifact-sha256:${proof.artifact_sha256}`,
	fixture_revision: "docs-only; no world fixture", source_revision: receipt.corpus_revision,
	surface: proof.surface, surface_revision: proof.artifact_sha256,
	tested_at: proof.executed_at, assertions: proof.assertions,
	interactions: proof.interactions, evidence_doc: "evidence/auth-56-installed-cli",
};
const projection = projectScenarioGuide(capture, {
	source_revision: receipt.corpus_revision, surface: proof.surface, surface_revision: proof.artifact_sha256,
});
if (projection.status !== "verified") throw new Error(projection.reasons.join("; "));
const raw = JSON.stringify({ capture, cost: proof.cost, limitations: proof.limitations }, null, 2);
if (sanitizeScenarioText(raw, {}) !== raw) throw new Error("Capture needs explicit fixture alias redaction");
writeFileSync(process.argv[4], `# Installed CLI candidate evidence — AUTH-56-01\n\n## Scope\n\n${scope}\nThe guide projection below is scoped to that artifact alone.\n\n## Captured commands\n\n${projection.body}\n\n## Sanitized transcript, assertions and cost\n\n\`\`\`json\n${raw}\n\`\`\`\n`);
