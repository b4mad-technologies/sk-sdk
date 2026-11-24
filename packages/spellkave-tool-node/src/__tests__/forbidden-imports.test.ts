import { build } from "esbuild";
import { describe, expect, it } from "vitest";

describe("Node package boundary", () => {
	it("is rejected by the browser resolver specifically for a Node-only import", async () => {
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
			const messages =
				error !== null && typeof error === "object" && "errors" in error
					? JSON.stringify(error.errors)
					: String(error);
			expect(messages).toMatch(
				/node:(?:fs|path|os|child_process|crypto)|Could not resolve ["']node:/,
			);
		}
	});
});
