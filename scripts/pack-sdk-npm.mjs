import { execFileSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
		manifest.files = ["src"];
		cpSync(join(source, "src"), join(staged, "src"), {
			recursive: true,
			filter: (path) => {
				const entry = basename(path);
				return entry !== "__tests__" && entry !== "test" && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry);
			},
		});
		if (existsSync(join(source, "bin"))) {
			cpSync(join(source, "bin"), join(staged, "bin"), { recursive: true });
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
