import { build } from "esbuild";

const result = await build({
	entryPoints: ["src/index.ts"],
	bundle: true,
	format: "esm",
	metafile: true,
	platform: "browser",
	write: false,
	logLevel: "silent",
});

const bundle = result.outputFiles[0]?.text ?? "";
const forbiddenModuleReferences = [
	/['"]node:/,
	/['"]@spellkave\/sdk['"/]/,
	/['"]@spellkave\/world-author['"/]/,
	/['"]spacetimedb['"/]/,
	/['"]@earendil-works\/pi/,
	/['"]@modelcontextprotocol\//,
];
for (const reference of forbiddenModuleReferences) {
	if (reference.test(bundle)) throw new Error(`browser bundle reaches forbidden dependency ${reference}`);
}
for (const input of Object.keys(result.metafile.inputs)) {
	if (
		input.includes("node_modules") &&
		!input.includes("/typebox/") &&
		!input.includes("/spellkave-tool-contracts/") &&
		!input.includes("/spellkave-world-events/")
	) {
		throw new Error(`browser bundle reaches unexpected transitive dependency '${input}'`);
	}
}
console.log("tool-runtime browser resolution: ok");
