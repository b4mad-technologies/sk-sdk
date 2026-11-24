import { configDefaults, defineConfig, mergeConfig } from "vitest/config";

import testConfig from "./vitest.config.ts";

export default mergeConfig(testConfig, defineConfig({
	test: {
		exclude: [...configDefaults.exclude, "src/__tests__/sdk/evaluation_provenance.test.ts"],
	},
}));
