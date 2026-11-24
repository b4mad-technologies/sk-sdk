import { build } from "esbuild";

await build({
	entryPoints: [new URL("../src/index.ts", import.meta.url).pathname],
	bundle: true,
	platform: "browser",
	format: "esm",
	write: false,
	external: ["@earendil-works/pi-agent-core"],
});
