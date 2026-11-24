import { build } from "esbuild";

try {
	await build({
		entryPoints: ["src/index.ts"],
		bundle: true,
		platform: "browser",
		write: false,
		logLevel: "silent",
	});
	throw new Error("tool-node unexpectedly resolved in a browser graph");
} catch (error) {
	if (error instanceof Error && error.message.includes("unexpectedly resolved")) throw error;
	const buildFailure = error;
	const messages =
		buildFailure !== null && typeof buildFailure === "object" && "errors" in buildFailure
			? JSON.stringify(buildFailure.errors)
			: String(error);
	if (!/node:(?:fs|path|os|child_process|crypto)|Could not resolve ["']node:/.test(messages)) {
		throw new Error(`tool-node browser rejection was not caused by a Node-only import: ${messages}`);
	}
	console.log("tool-node browser resolution: rejected as Node-only");
}
