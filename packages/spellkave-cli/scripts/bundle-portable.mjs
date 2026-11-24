import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const archive = resolve(process.argv[2]);
const proofPath = resolve(process.argv[3]);
const destination = resolve(process.argv[4]);
const receipt = JSON.parse(readFileSync(`${archive}.json`, "utf8"));
const proof = JSON.parse(readFileSync(proofPath, "utf8"));
const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
assert.equal(hash, receipt.artifact_sha256);
assert.equal(proof.artifact_sha256, hash);
assert.equal(proof.outcome, "passed");
assert.equal(proof.client_revision.corpus_revision, receipt.corpus_revision);
assert.equal(receipt.source_dirty, false, "Clean candidate bundle requires a committed source revision");
assert.match(receipt.base_revision, /^[a-f0-9]{40}$/);
const scratch = mkdtempSync(join(tmpdir(), "spellkave-candidate-bundle-"));
try {
	copyFileSync(archive, join(scratch, "cli.tar.gz"));
	copyFileSync(`${archive}.json`, join(scratch, "receipt.json"));
	// The producer checks all captured fields, assertions and cost for redaction.
	// It treats captured argv as data and never runs those commands.
	const projection = spawnSync(process.execPath, [fileURLToPath(new URL("project-capture.mjs", import.meta.url)), proofPath, `${archive}.json`, join(scratch, "evidence.md"), "candidate"], { encoding: "utf8" });
	assert.equal(projection.status, 0, projection.stderr);
	copyFileSync(proofPath, join(scratch, "proof.json"));
	writeFileSync(join(scratch, "SHA256SUMS"), ["cli.tar.gz", "receipt.json", "proof.json", "evidence.md"].map(name => `${createHash("sha256").update(readFileSync(join(scratch, name))).digest("hex")}  ${name}`).join("\n") + "\n");
	writeFileSync(join(scratch, "README.md"), `# Versioned installed CLI candidate\n\nSource revision: ${receipt.base_revision}\nCorpus revision: ${receipt.corpus_revision}\nArtifact SHA-256: ${hash}\nTested runtime: ${receipt.node_version}; platform: ${receipt.platform}/${receipt.architecture}.\n\nThis is a clean versioned local candidate, not a registry release or hosted/live\nacceptance. No checkout, pnpm, global tsx or credentials are required to consume it.\n\n1. On the recorded platform, provide the recorded Node runtime and tar.\n2. Verify the accompanying checksums: shasum -a 256 -c SHA256SUMS.\n3. Unpack: mkdir installed && tar -xzf cli.tar.gz -C installed.\n4. Run: installed/sk/bin/sk.js docs --query 'container loot'.\n5. Read the selected pattern and worked example:\n   installed/sk/bin/sk.js docs patterns/container-with-loot --full\n   installed/sk/bin/sk.js docs spatial-minimal-cell --full\n6. Read evidence.md and proof.json for this exact artifact, its prerequisite\n   assertions, refusals/recovery and pinned whole-journey text cost.\n\nHistorical corpus evidence retains its original artifact identity.\nRollback: retain this directory alongside another candidate; choose the matching\nexecutable and receipt. No world reset, credential migration or implicit install\noverwrite is involved. Documentation lookup failures use existing safe help;\narbitrary paths/URLs are not substituted as document sources.\n`);
	mkdirSync(dirname(destination), { recursive: true });
	const packed = spawnSync("tar", ["-czf", destination, "-C", scratch, "."], { encoding: "utf8" });
	assert.equal(packed.status, 0, packed.stderr);
	const bundleHash = createHash("sha256").update(readFileSync(destination)).digest("hex");
	writeFileSync(`${destination}.json`, JSON.stringify({ status: "clean-versioned-candidate", artifact_sha256: hash, bundle_sha256: bundleHash, source_revision: receipt.base_revision, corpus_revision: receipt.corpus_revision, platform: receipt.platform, architecture: receipt.architecture }, null, 2) + "\n");
	process.stdout.write(JSON.stringify({ destination, bundle_sha256: bundleHash }) + "\n");
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
