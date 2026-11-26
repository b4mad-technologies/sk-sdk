import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startPackedSdkRegistry } from "./lib/packed-sdk-registry.mjs";
import { sdkNpmPackages } from "./lib/sdk-npm-packages.mjs";

const [artifactDirectory] = process.argv.slice(2);
if (!artifactDirectory) throw new Error("Usage: node scripts/check-packed-sdk-npm.mjs ARTIFACT_DIRECTORY");
const artifacts = resolve(artifactDirectory);
const tarballs = readdirSync(artifacts).filter((name) => name.endsWith(".tgz"));
const names = new Set(sdkNpmPackages.map((name) => `@spellkave/${name}`));
const run = promisify(execFile);
const npmInstall = (cwd, ...packages) =>
	run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", ...packages], { cwd });
const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));

const fixture = mkdtempSync(join(tmpdir(), "sk-sdk-npm-consumer-"));
let registry;
try {
	registry = await startPackedSdkRegistry(tarballs.map((name) => join(artifacts, name)));
	const { url, manifests } = registry;
	if (manifests.length !== names.size || tarballs.length !== names.size || manifests.some(({ name }) => !names.has(name))) {
		throw new Error("The tarballs do not match the SDK release package list");
	}

	const tooling = join(fixture, "types");
	mkdirSync(tooling);
	await npmInstall(tooling, "@types/node@24");

	for (const manifest of manifests) {
		const name = manifest.name;
		const shortName = name.slice("@spellkave/".length);
		const workspaceManifest = JSON.parse(readFileSync(
			new URL(`../packages/spellkave-${shortName}/package.json`, import.meta.url), "utf8",
		));
		// Asset exports such as "./docs/*" are files, not modules to import.
		const entries = Object.entries(workspaceManifest.exports)
			.filter(([, value]) => typeof value !== "string" || value.startsWith("./src/"))
			.map(([entry]) => name + entry.slice(1));
		const consumer = join(fixture, shortName);
		mkdirSync(consumer);
		writeFileSync(join(consumer, ".npmrc"), `registry=https://registry.npmjs.org/\n@spellkave:registry=${url}\n`);
		// npm resolves the package's own dependency closure from the tarball metadata.
		await npmInstall(consumer, `${name}@${manifest.version}`);

		if (name === "@spellkave/world-author") checkAuthoringDocs(consumer, tarballs, artifacts);

		const terminalEntry = "@spellkave/world-map/node/terminal";
		checkRuntime(consumer, entries.filter((entry) => entry !== terminalEntry), name);
		if (entries.includes(terminalEntry)) {
			// The terminal API explicitly requires the optional TUI peer.
			const peer = "@earendil-works/pi-tui";
			await npmInstall(consumer, `${peer}@${manifest.peerDependencies[peer]}`);
			checkRuntime(consumer, [terminalEntry], name);
		}
		for (const bin of Object.keys(manifest.bin ?? {})) {
			execFileSync(join(consumer, "node_modules", ".bin", bin), ["--help"], { cwd: consumer });
		}

		const validatorTypecheck = name === "@spellkave/world-author" ? `
import { validateManifestToml } from "@spellkave/world-author";
const validate: (manifest: string) => readonly unknown[] = validateManifestToml;
validate('schema_version = "1.0.0"');
// @ts-expect-error A manifest is TOML text.
validateManifestToml(123);
` : "";
		writeFileSync(join(consumer, "consumer.mts"), importStatements(entries) + validatorTypecheck);
		// SpacetimeDB's declarations use extensionless re-exports and server-only ambient types.
		execFileSync(process.execPath, [tsc, "--module", "ESNext", "--moduleResolution", "Bundler",
			"--target", "ES2022", "--strict", "--skipLibCheck",
			"--typeRoots", join(tooling, "node_modules", "@types"),
			"--noUncheckedSideEffectImports", "--noEmit", "consumer.mts"], { cwd: consumer, stdio: "inherit" });
		console.log(`${name}: standalone install, plain Node and TypeScript passed for ${entries.length} entry points`);
	}
} finally {
	registry?.server.close();
	rmSync(fixture, { recursive: true, force: true });
}

// The website renders the authoring docs, including the pattern catalogue,
// from the installed package.
function checkAuthoringDocs(consumer, tarballs, artifacts) {
	const tarball = tarballs.find((file) => file.startsWith("spellkave-world-author-"));
	const listed = execFileSync("tar", ["-tzf", join(artifacts, tarball)], { encoding: "utf8" }).split("\n");
	const patterns = listed.filter((path) => /^package\/docs\/patterns\/[^/]+\.md$/.test(path));
	if (patterns.length === 0) throw new Error(`${tarball} has no docs/patterns/*.md`);
	const page = patterns[0].slice("package/docs/".length);
	execFileSync(process.execPath, ["--input-type=module", "--eval", `
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const path = fileURLToPath(import.meta.resolve("@spellkave/world-author/docs/${page}"));
assert.ok(readFileSync(path, "utf8").length > 0);
`], { cwd: consumer, stdio: "inherit" });
	console.log(`@spellkave/world-author: ${patterns.length} docs/patterns pages packed and resolvable`);
}

function importStatements(entries) {
	return entries.map((specifier) => `import ${JSON.stringify(specifier)};\n`).join("");
}

function checkRuntime(consumer, entries, name) {
	const validatorSmoke = name === "@spellkave/world-author" ? `
import assert from "node:assert/strict";
import { validateManifestToml } from "@spellkave/world-author";
const manifest = '#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\\nschema_version = "1.0.0"\\n';
assert.deepEqual(validateManifestToml(manifest), []);
` : "";
	execFileSync(process.execPath, ["--no-experimental-strip-types", "--input-type=module",
		"--eval", importStatements(entries) + validatorSmoke], { cwd: consumer, stdio: "inherit" });
}
