import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { build, transform } from "esbuild";

const forbiddenGlobals = {
	Buffer: "FORBIDDEN_BUFFER_GLOBAL",
	process: "FORBIDDEN_PROCESS_GLOBAL",
};

const result = await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	platform: "browser",
	format: "esm",
	write: false,
	metafile: true,
});
const forbidden = Object.keys(result.metafile.inputs).filter((path) =>
	/(^|\/)(node:|node-adapter|spellkave-session|companion-agent|tool-node)(\/|$)/.test(path),
);
if (forbidden.length > 0) throw new Error(`browser bundle reaches forbidden inputs: ${forbidden.join(", ")}`);

function productionSources(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionSources(path);
		return entry.name.endsWith(".ts") ? [path] : [];
	});
}

for (const path of productionSources("src")) {
	const transformed = await transform(readFileSync(path, "utf8"), {
		loader: "ts",
		define: forbiddenGlobals,
	});
	for (const global of Object.values(forbiddenGlobals)) {
		if (transformed.code.includes(global)) {
			throw new Error(`${path} reaches forbidden global: ${global}`);
		}
	}
}

console.log("tool-player browser resolution: ok");
