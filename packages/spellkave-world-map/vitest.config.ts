import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: [
			"src/__tests__/**/*.test.ts",
			"src/svg/__tests__/**/*.test.ts",
			"src/node/__tests__/**/*.test.ts",
			"src/tiles/__tests__/**/*.test.ts",
		],
		environment: "node",
	},
});
