import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../../..", import.meta.url));
const destination = resolve(process.argv[2] ?? join(repo, ".local/releases", `sk-${process.platform}-${process.arch}.tar.gz`));
const scratch = mkdtempSync(join(tmpdir(), "spellkave-cli-release-"));
const stage = join(scratch, "sk");
// Like the API production bundle gate, preserve pnpm's workspace state:
// legacy production deploy rewrites it and otherwise breaks later dev commands.
const workspaceState = join(repo, "node_modules/.pnpm-workspace-state-v1.json");
const previousWorkspaceState = existsSync(workspaceState) ? readFileSync(workspaceState) : undefined;

function run(command, args, options = {}) {
	const result = spawnSync(command, args, { cwd: repo, encoding: "utf8", ...options });
	if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr ?? result.error}`);
	return result.stdout;
}

/** Every deployed symlink must resolve inside the artifact, never a checkout/store. */
function assertPortable(directory) {
	for (const name of readdirSync(directory)) {
		const path = join(directory, name);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink()) {
			const target = relative(realpathSync(stage), realpathSync(path));
			if (target === ".." || target.startsWith(`..${sep}`)) throw new Error(`external deployment link: ${relative(stage, path)}`);
		} else if (stat.isDirectory()) assertPortable(path);
	}
}

try {
	run(process.execPath, ["scripts/generate-authoring-corpus.ts", "--prepare"]);
	mkdirSync(dirname(destination), { recursive: true });
	try {
		run("pnpm", ["--filter", "@spellkave/cli", "deploy", "--prod", "--legacy", stage]);
	} finally {
		if (previousWorkspaceState) writeFileSync(workspaceState, previousWorkspaceState);
		else rmSync(workspaceState, { force: true });
	}
	// pnpm 11 legacy deploy leaves its virtual-store root-package shortcut
	// pointing at an omitted store copy. The installed root itself owns that ID.
	const rootSelf = join(stage, "node_modules/.pnpm/node_modules/@spellkave/cli");
	if (lstatSync(rootSelf).isSymbolicLink()) {
		rmSync(rootSelf);
		symlinkSync(relative(dirname(rootSelf), stage), rootSelf, "dir");
	}
	assertPortable(stage);
	const baseRevision = run("git", ["rev-parse", "HEAD"]).trim();
	const dirty = run("git", ["status", "--porcelain"]).trim().length > 0;
	const corpusSource = readFileSync(join(repo, "packages/spellkave-world-author/src/corpus.generated.ts"), "utf8");
	const corpusRevision = /GENERATED_CORPUS_REVISION = "([^"]+)"/.exec(corpusSource)?.[1] ?? "unknown";
	const provenance = {
		artifact: "portable-cli-candidate", platform: process.platform, architecture: process.arch,
		node_version: process.version, base_revision: baseRevision, source_dirty: dirty,
		corpus_revision: corpusRevision, built_at: new Date().toISOString(),
		status: "local-candidate-unpublished",
	};
	writeFileSync(join(stage, "release.json"), `${JSON.stringify(provenance, null, 2)}\n`);
	run("tar", ["-czf", destination, "-C", scratch, "sk"]);
	const sha256 = createHash("sha256").update(readFileSync(destination)).digest("hex");
	const receipt = { ...provenance, artifact_sha256: sha256, artifact_bytes: lstatSync(destination).size };
	writeFileSync(`${destination}.json`, `${JSON.stringify(receipt, null, 2)}\n`);
	process.stdout.write(`${JSON.stringify({ ...receipt, path: destination })}\n`);
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
