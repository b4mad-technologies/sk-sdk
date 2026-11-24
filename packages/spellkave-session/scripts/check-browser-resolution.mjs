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

const forbiddenInputPatterns = [
	/(^|\/)node:/, // Node builtins
	/(^|\/)src\/node\//, // this package's own Node-only lifecycle subpath (sockets, spawn, fs)
	/(^|\/)spellkave-tool-node(\/|$)/, // node-only workspace sibling
	/(^|\/)tsx(\/|$)/, // node-only workspace dependency (process spawn only)
];
const forbidden = Object.keys(result.metafile.inputs).filter((path) =>
	forbiddenInputPatterns.some((pattern) => pattern.test(path)),
);
if (forbidden.length > 0) throw new Error(`browser bundle reaches forbidden inputs: ${forbidden.join(", ")}`);
console.log("session browser resolution: ok");
