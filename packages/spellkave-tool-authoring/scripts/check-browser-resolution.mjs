import { build } from "esbuild";

const result = await build({
	entryPoints: ["src/index.ts", "src/browser.ts"],
	outdir: "browser-gate",
	bundle: true,
	format: "esm",
	platform: "browser",
	metafile: true,
	write: false,
	logLevel: "silent",
});
const forbidden = Object.keys(result.metafile.inputs).filter((path) =>
	/(^|\/)(node:|@spellkave\/(session|companion-agent)|@mariozechner\/pi|@earendil-works\/pi)/.test(path),
);
if (forbidden.length > 0) {
	throw new Error(`browser bundle reached forbidden host modules:\n${forbidden.join("\n")}`);
}
console.log("tool-authoring browser resolution: ok");
