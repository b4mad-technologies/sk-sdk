// What @spellkave/behaviour tells its own document generator: it has no
// behaviour suite of its own (sk-dev and gates are its suites), so its README
// is commands, design and unit tests only.

import { defineDocs } from "../src/docs/config.ts";

export default defineDocs({
	binary: "behaviour-docs",
	tagline:
		"Black-box behaviour suites that document a package: the run becomes a guide and evidence, the package's own sources become its README.",
	commands: () => [
		{
			usage: "behaviour-docs readme [<package dir>] [--scope <suite>]",
			what: "Write the package's README.md, offline, from its docs config, features, header comments, unit-test markers and scripts.",
		},
		{
			usage: "behaviour-docs report [<package dir>] [--scope <suite>] [--open]",
			what: "Render the last behaviour run as an Allure 3 HTML report in behaviour/<scope>/.report (local, not committed); --open serves it.",
		},
		{
			usage: "behaviour-docs guide [<package dir>] [--scope <suite>]",
			what: "Write docs/guide.md and docs/scenarios.md from the last behaviour run in behaviour/.results.",
		},
	],
	verbOf: (command) => command.match(/^behaviour-docs (readme|guide)\b/)?.[1] ?? command,
	design: [
		"src/cli.ts",
		"src/endpoint.ts",
		"src/narrate.ts",
		"src/contract-steps.ts",
		"src/vitest.ts",
		"src/setup.ts",
		"src/global-setup.ts",
		"src/world.ts",
		"src/world-pooled.ts",
		"src/docs/config.ts",
		"src/docs/sources.ts",
		"src/docs/readme.ts",
		"src/docs/guide.ts",
		"src/docs/checks.ts",
		"src/docs/report.ts",
		"src/docs/main.ts",
	],
	suite: [],
	watched: ["packages/spellkave-behaviour"],
});
