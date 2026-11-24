import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sdkNpmPackages } from "./lib/sdk-npm-packages.mjs";

const [artifactDirectory] = process.argv.slice(2);
if (!artifactDirectory) throw new Error("Usage: node scripts/check-packed-sdk-npm.mjs ARTIFACT_DIRECTORY");
const artifacts = resolve(artifactDirectory);
const tarballs = readdirSync(artifacts).filter((name) => name.endsWith(".tgz"));
if (tarballs.length !== sdkNpmPackages.length) {
	throw new Error(`Expected ${sdkNpmPackages.length} tarballs, found ${tarballs.length}`);
}

const manifests = sdkNpmPackages.map((name) => {
	const manifestPath = new URL(`../packages/spellkave-${name}/package.json`, import.meta.url);
	return JSON.parse(readFileSync(manifestPath, "utf8"));
});
const imports = manifests.flatMap((manifest) =>
	Object.keys(manifest.exports).map((entry) => `import ${JSON.stringify(manifest.name + entry.slice(1))};`),
);
// The terminal-only entry requires its optional TUI peer.
const optionalPeers = manifests.flatMap((manifest) =>
	Object.entries(manifest.peerDependenciesMeta ?? {})
		.filter(([, meta]) => meta.optional)
		.map(([name]) => `${name}@${manifest.peerDependencies[name]}`),
);

const consumer = mkdtempSync(join(tmpdir(), "sk-sdk-npm-consumer-"));
const options = { cwd: consumer, stdio: "inherit" };
try {
	execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund",
		"@types/node@24", ...optionalPeers, ...tarballs.map((name) => join(artifacts, name))], options);

	writeFileSync(join(consumer, "runtime.mjs"), `${imports.join("\n")}
import assert from "node:assert/strict";
import { validateManifestToml } from "@spellkave/world-author";
const manifest = '#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\\nschema_version = "1.0.0"\\n';
assert.deepEqual(validateManifestToml(manifest), []);
`);
	execFileSync(process.execPath, ["--no-experimental-strip-types", "runtime.mjs"], options);
	for (const bin of ["world-map", "world-osm"]) {
		execFileSync(join(consumer, "node_modules", ".bin", bin), ["--help"], { cwd: consumer });
	}

	writeFileSync(join(consumer, "consumer.mts"), `${imports.join("\n")}
import { validateManifestToml } from "@spellkave/world-author";
const validate: (manifest: string) => readonly unknown[] = validateManifestToml;
validate('schema_version = "1.0.0"');
// @ts-expect-error A manifest is TOML text.
validateManifestToml(123);
`);
	const tsc = fileURLToPath(import.meta.resolve("typescript/bin/tsc"));
	// SpacetimeDB's declarations use extensionless re-exports and reference
	// server-only ambient types. Keep the consumer itself under strict checking.
	execFileSync(process.execPath, [tsc, "--module", "ESNext", "--moduleResolution", "Bundler",
		"--target", "ES2022", "--strict", "--skipLibCheck",
		"--noUncheckedSideEffectImports", "--noEmit", "consumer.mts"], options);
	console.log(`Plain Node imports and TypeScript consumer passed for ${imports.length} entry points`);
} finally {
	rmSync(consumer, { recursive: true, force: true });
}
