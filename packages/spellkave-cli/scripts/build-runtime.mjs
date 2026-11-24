import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../../../", import.meta.url));
execFileSync(process.execPath, ["scripts/generate-authoring-corpus.ts", "--prepare"], {
	cwd: root,
	stdio: "inherit",
});
const output = resolve(root, "packages/spellkave-cli/runtime");
mkdirSync(output, { recursive: true });

const wasmPackages = new Map();
for (const name of ["authoring", "validate"]) {
	const entry = realpathSync(fileURLToPath(import.meta.resolve(`@spellkave/${name}-wasm/node`)));
	const wasm = fileURLToPath(import.meta.resolve(`@spellkave/${name}-wasm/node/wasm`));
	const filename = `spellkave_${name}_wasm_bg.wasm`;
	wasmPackages.set(entry, filename);
	cpSync(wasm, resolve(output, filename));
}

await build({
	stdin: {
		contents: 'import { runCli } from "./packages/spellkave-cli/src/cli.ts"; runCli(process.argv.slice(2), undefined, undefined, undefined, { plugins: { entries: [], load: async () => { throw new Error("The bundled CLI has no plugins"); } } }).then(code => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });',
		resolveDir: root,
		loader: "ts",
	},
	external: ["@resvg/resvg-js"],
	bundle: true,
	platform: "node",
	format: "cjs",
	target: "node24",
	outfile: resolve(output, "sk.cjs"),
	define: { "import.meta.url": "__sk_runtime_url" },
	banner: { js: 'const __sk_runtime_url = require("node:url").pathToFileURL(__filename).href;' },
	plugins: [{
		name: "wasm-sidecars",
		setup(builder) {
			builder.onLoad({ filter: /\/index\.cjs$/ }, ({ path }) => {
				const filename = wasmPackages.get(path);
				if (!filename) return;
				const source = readFileSync(path, "utf8");
				if (!source.includes("index_bg.wasm")) {
					throw new Error(`Unsupported Wasm package entry ${path}`);
				}
				return { contents: source.replaceAll("index_bg.wasm", filename), loader: "js" };
			});
		},
	}],
});
