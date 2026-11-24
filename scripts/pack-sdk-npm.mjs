import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareEsmDirectory } from "./lib/npm-esm.mjs";
import { sdkNpmPackages } from "./lib/sdk-npm-packages.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const [version, destination] = process.argv.slice(2);
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (!version || (!stableVersion.test(version) && !["0.0.0-ci", "0.0.0-bootstrap"].includes(version)) || !destination) {
	throw new Error("Usage: node scripts/pack-sdk-npm.mjs VERSION OUTPUT_DIRECTORY");
}
if (!existsSync(join(root, "packages/spellkave-world-author/src/corpus.generated.ts"))) {
	throw new Error("Run pnpm build to prepare the authoring corpus before packing");
}

const published = new Set(sdkNpmPackages.map((name) => `@spellkave/${name}`));
const output = resolve(destination);
mkdirSync(output, { recursive: true });

const stagingRoot = mkdtempSync(join(tmpdir(), "sk-sdk-npm-"));
const tarballs = [];
try {
	for (const name of sdkNpmPackages) {
		const directory = `packages/spellkave-${name}`;
		const source = join(root, directory);
		const staged = join(stagingRoot, name);
		const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));

		manifest.version = version;
		delete manifest.private;
		delete manifest.devDependencies;
		delete manifest.scripts;
		manifest.repository = {
			type: "git",
			url: "git+https://github.com/b4mad-technologies/sk-sdk.git",
			directory,
		};
		manifest.publishConfig = { access: "public", registry: "https://registry.npmjs.org/" };

		for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
			for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
				if (!range.startsWith("workspace:")) continue;
				if (!published.has(dependency)) {
					throw new Error(`${manifest.name} needs unpublished workspace package ${dependency}`);
				}
				manifest[field][dependency] = version;
			}
		}

		mkdirSync(staged);
		manifest.main = emittedPath(manifest.main);
		manifest.types = emittedPath(manifest.types, ".d.ts");
		manifest.exports = Object.fromEntries(Object.entries(manifest.exports).map(([entry, value]) => {
			const conditions = typeof value === "string" ? { types: value, default: value } : value;
			return [entry, Object.fromEntries(Object.entries(conditions).map(([condition, path]) => [
				condition, emittedPath(path, condition === "types" ? ".d.ts" : ".js"),
			]))];
		}));
		manifest.files = ["dist"];
		const dist = join(staged, "dist");
		const buildOutput = join(source, "dist");
		if (!existsSync(buildOutput)) throw new Error(`Run pnpm build before packing ${manifest.name}`);
		cpSync(buildOutput, dist, {
			recursive: true,
			filter: (path) => {
				const entry = basename(path);
				return path !== join(buildOutput, "live") && entry !== "__tests__" && entry !== "test"
					&& !/\.(test|spec)\./.test(entry) && !entry.endsWith(".map");
			},
		});
		prepareEsmDirectory(dist);
		for (const conditions of Object.values(manifest.exports)) {
			for (const path of Object.values(conditions)) {
				if (!existsSync(join(staged, path))) throw new Error(`Missing ${manifest.name} build output ${path}`);
			}
		}
		if (existsSync(join(source, "bin"))) {
			const bin = join(staged, "bin");
			cpSync(join(source, "bin"), bin, { recursive: true });
			for (const name of readdirSync(bin)) {
				const path = join(bin, name);
				const launcher = readFileSync(path, "utf8")
					.replace(/^#!\/usr\/bin\/env tsx$/m, "#!/usr/bin/env node")
					.replace(/\.\.\/src\/([^"]+)\.ts"/g, "../dist/$1.js\"");
				writeFileSync(path, launcher);
			}
			manifest.files.push("bin");
		}
		for (const file of ["LICENSE", "NOTICE"]) {
			cpSync(join(root, file), join(staged, file));
		}
		if (existsSync(join(source, "README.md"))) {
			cpSync(join(source, "README.md"), join(staged, "README.md"));
		}

		writeFileSync(join(staged, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
		const result = execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", output], {
			cwd: staged,
			encoding: "utf8",
		});
		const [packed] = JSON.parse(result);
		tarballs.push(packed.filename);
	}
} finally {
	rmSync(stagingRoot, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify(tarballs)}\n`);

function emittedPath(path, extension = ".js") {
	if (!path.startsWith("./src/") || !path.endsWith(".ts")) {
		throw new Error(`Expected a TypeScript source export, found ${path}`);
	}
	return path.replace("./src/", "./dist/").slice(0, -3) + extension;
}
