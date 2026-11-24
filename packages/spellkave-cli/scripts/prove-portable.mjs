// Proves that a packed `sk` works outside this checkout: it unpacks the
// archive into a temp directory, runs the real executable there with no
// repository paths, credentials or user config, checks documentation
// lookup, refusals and their recovery, and writes the interactions,
// assertions and token cost to the proof file. No world needed. Run:
// `pnpm pack:portable <archive.tar.gz>`, then
// `pnpm test:portable <archive.tar.gz> [<proof.json>]`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { journeyCost } from "./journey-cost.mjs";

const archive = resolve(process.argv[2]);
const output = resolve(process.argv[3] ?? `${archive}.proof.json`);
const scratch = mkdtempSync(join(tmpdir(), "spellkave-installed-consumer-"));
const install = join(scratch, "install");
const consumer = join(scratch, "consumer");
const home = join(scratch, "product-home");
const interactions = [];
const assertions = [];
const started = performance.now();
const canonicalScratch = realpathSync(scratch);
const sanitize = (value) => value.replaceAll(canonicalScratch, "<consumer-sandbox>").replaceAll(scratch, "<consumer-sandbox>");
let outcome = "failed";

function call(command, expectedExit = 0, retryOf) {
	// The proof reads the machine envelope: in auto mode named docs print as prose.
	const argv = ["--format", "jsonl", ...command];
	const result = spawnSync(join(install, "sk/bin/sk.js"), argv, {
		cwd: consumer, encoding: "utf8", timeout: 30_000,
		// No inherited repository paths, credentials, loader flags or user config.
		env: { PATH: dirname(process.execPath), SPELLKAVE_HOME: home },
	});
	interactions.push({ argv, stdin: "", expected_exit_code: expectedExit, ...(retryOf === undefined ? {} : { retry_of: retryOf }), exit_code: result.status, stdout: sanitize(result.stdout ?? ""), stderr: sanitize(result.stderr ?? "") });
	assert.equal(result.status, expectedExit, result.stderr);
	const records = result.stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

	const details = records.find(record => record.kind === "tool_result")?.details;
	if (details) {
		assert.ok(details.metadata.corpus_revision.startsWith("sha256:"));
		assert.equal(details.metadata.compatibility, "unknown");
		assert.equal(details.metadata.links, undefined);
		for (const row of details.index ?? details.hits ?? []) {
			assert.equal(row.metadata.document_id, row.rel);
			assert.equal(row.metadata.corpus_revision, details.metadata.corpus_revision);
			assert.equal(row.metadata.links, undefined);
			assert.ok(JSON.stringify(row.metadata).length < 2000);
		}
		if (details.doc) assert.equal(details.metadata.document_id, details.doc.rel);
	}
	return records;
}

try {
	mkdirSync(install); mkdirSync(consumer); mkdirSync(home);
	const unpack = spawnSync("tar", ["-xzf", archive, "-C", install], { encoding: "utf8" });
	assert.equal(unpack.status, 0, unpack.stderr);
	assert.equal(existsSync(join(install, "sk/docs")), false);
	assert.equal(existsSync(join(consumer, ".git")), false);
	const release = JSON.parse(readFileSync(join(install, "sk/release.json"), "utf8"));
	const sha256 = createHash("sha256").update(readFileSync(archive)).digest("hex");
	const receipt = JSON.parse(readFileSync(`${archive}.json`, "utf8"));
	assert.equal(receipt.artifact_sha256, sha256);
	const doc = (records) => records.find((record) => record.kind === "tool_result")?.details.doc;
	const search = call(["docs", "--query", "container loot"]);
	const hits = search.find((record) => record.kind === "tool_result")?.details.hits;
	assert.ok(hits.some((hit) => hit.rel === "patterns/container-with-loot"));
	assert.ok(hits.length <= 3);
	assert.ok(hits.every((hit) => hit.excerpt.length <= 700));
	assertions.push("task search returns a bounded hit for the selected pattern");
	const pattern = doc(call(["docs", "patterns/container-with-loot", "--full"]));
	assert.equal(pattern.rel, "patterns/container-with-loot");
	assert.ok(pattern.body.includes("## Solution"));
	const guide = doc(call(["docs", "find-an-authoring-pattern"]));
	assert.equal(guide.rel, "find-an-authoring-pattern");
	const workflow = doc(call(["docs", "cli/workflows", "--section", "Loop"]));
	assert.equal(workflow.section, "Loop");
	const example = doc(call(["docs", "spatial-minimal-cell", "--full"]));
	assert.ok(example.toml.includes("[[place_graphs]]"));
	assert.deepEqual(example.expectedDiagnostics, []);
	for (const entry of [pattern, guide, workflow, example]) {
		assert.equal(entry.metadata.corpus_revision, release.corpus_revision);
		assert.equal(entry.metadata.compatibility, "unknown");
	}
	assertions.push("pattern, focused guide, CLI-owned workflow and complete example share the installed corpus revision");
	const historicalEvidence = doc(call(["docs", "evidence/auth-56-installed-cli", "--full"]));
	assert.equal(historicalEvidence.metadata.content_status, "historical");
	assert.equal(historicalEvidence.metadata.corpus_revision, release.corpus_revision);
	assert.ok(historicalEvidence.body.includes('"encoding": "o200k_base"'));
	assert.ok(historicalEvidence.body.includes("Historical partial capture"));
	assertions.push("full sanitized historical evidence is packaged and explicitly scoped to its own candidate, not the current release");
	const hostedWorkflow = doc(call(["docs", "hosted-authoring-workflow", "--full"]));
	assert.equal(hostedWorkflow.metadata.content_status, "implemented");
	assert.equal(hostedWorkflow.metadata.corpus_revision, release.corpus_revision);
	assert.ok(hostedWorkflow.body.includes("spellkave_acting_context"));
	const callerEvidence = doc(call(["docs", "evidence/auth-56-hosted-mcp", "--full"]));
	assert.equal(callerEvidence.metadata.content_status, "historical");
	assert.equal(callerEvidence.metadata.corpus_revision, release.corpus_revision);
	assert.ok(callerEvidence.body.includes("AUTH-56-01"));
	assert.ok(callerEvidence.body.includes("AUTH-56-02"));
	assert.ok(callerEvidence.body.includes("evidence/auth-56-hosted-mcp-transcript"));
	assert.ok(callerEvidence.body.includes('"schema_tokens"'));
	assertions.push("current installed corpus retrieves supported caller-owned hosted workflow and scoped sanitized real-caller evidence by stable ID");
	const skill = call(["skill", "path"]).find((record) => record.kind === "skill_path");
	assert.ok(realpathSync(skill.path).startsWith(`${realpathSync(join(install, "sk"))}/`));
	const skillBody = readFileSync(skill.path, "utf8");
	assert.ok(skillBody.includes("sk docs cli/workflows"));
	assert.ok(skillBody.split("\n").length < 50);
	assertions.push("sk skill path resolves the thin installed discovery projection");
	const planned = doc(call(["docs", "hosted-authoring-guidance", "--full"]));
	assert.equal(planned.metadata.content_status, "planned");
	// AUTH-56-02: the guidance stays planned while any prerequisite is still planned;
	// prerequisites that shipped since then may say so.
	assert.ok(planned.metadata.feature_prerequisites.some((feature) => feature.status === "planned"));
	const index = call(["docs"]).find((record) => record.kind === "tool_result")?.details.index;
	assert.equal(index.some((entry) => entry.rel === "hosted-authoring-guidance"), false);
	assertions.push("AUTH-56-02 planned hosted guidance stays planned and outside supported discovery");
	const missing = call(["docs", "https://example.invalid/private"], 2).find((record) => record.kind === "tool_result");
	assert.equal(missing.details.unknown_id, "https://example.invalid/private");
	assert.equal(missing.details.metadata.document_id, "index");
	const section = call(["docs", "patterns/container-with-loot", "--section", "missing"], 2).find((record) => record.kind === "tool_result");
	assert.equal(section.details.unknown_section, "missing");
	assert.equal(section.details.metadata.document_id, "patterns/container-with-loot");
	assert.equal(section.details.metadata.content_status, "implemented");
	assert.equal(doc(call(["docs", "patterns/container-with-loot", "--section", "Problem"], 0, interactions.length - 1)).section, "Problem");
	assertions.push("PG-4 index/hits/full and both refusal envelopes carry bounded provenance/status/surface/unknown compatibility without full per-hit bodies or links");
	assertions.push("unknown URL-like ID and unknown section refuse distinctly; valid-section retry succeeds");
	assert.deepEqual(readdirSync(consumer), []);
	assert.deepEqual(readdirSync(home), []);
	assertions.push("documentation consumer leaves isolated working directory and product home unchanged");
	outcome = "passed";
} finally {
		const evidence = {
		scenarios: ["AUTH-56-01", "AUTH-56-02"], outcome,
		test_identifier: "packages/spellkave-cli/scripts/prove-portable.mjs",
		persona: "external author", caller_scope: "public packaged docs only; no world connection",
		fixture_revision: "docs-only; no world fixture", client_revision: JSON.parse(readFileSync(`${archive}.json`, "utf8")),
		surface: "installed-cli-local-candidate", node_version: process.version,
		artifact_sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
		executed_at: new Date().toISOString(), assertions, interactions,
		cost: journeyCost(interactions, performance.now() - started),
		limitations: ["local unpublished platform-specific artifact; no registry/public release proof", "no hosted delivery or live world admission proof", "public evidence-link publication remains pending"],
	};
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
	rmSync(scratch, { recursive: true, force: true });
}
