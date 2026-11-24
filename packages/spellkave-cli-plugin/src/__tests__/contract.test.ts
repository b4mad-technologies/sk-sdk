import { Type } from "typebox";
import { describe, expect, it } from "vitest";

import {
	defineGroup,
	definePlugin,
	defineVerb,
	EXIT_OK,
	PluginContractError,
	validatePlugin,
	verbPaths,
} from "../index.ts";

const hello = defineVerb({
	name: "hello",
	description: "Greets someone.",
	parameters: Type.Object({ name: Type.String() }),
	async run(params, ctx) {
		// `params.name` is typed as string through Static<P>.
		ctx.out.record({ kind: "greeting", text: `hello ${params.name}` });
		return EXIT_OK;
	},
});

const plugin = definePlugin({
	package: "@example/demo",
	root: defineGroup({
		name: "demo",
		description: "Demo group.",
		children: [hello, defineGroup({ name: "inner", description: "Nested.", children: [hello] })],
	}),
});

describe("validatePlugin", () => {
	it("accepts a module namespace with a default export", () => {
		expect(validatePlugin("@example/demo", { default: plugin })).toBe(plugin);
	});

	it("names the package when the default export is missing", () => {
		expect(() => validatePlugin("@example/demo", { other: 1 })).toThrow(
			/sk plugin @example\/demo: default export is not a plugin object/,
		);
	});

	it("rejects a package mismatch", () => {
		expect(() => validatePlugin("@example/other", plugin)).toThrow(PluginContractError);
	});

	it("rejects a verb without a run function", () => {
		const broken = {
			package: "@example/demo",
			root: {
				kind: "group",
				name: "demo",
				description: "d",
				children: [{ kind: "verb", name: "x", description: "d", parameters: {} }],
			},
		};
		expect(() => validatePlugin("@example/demo", broken)).toThrow(/x: run must be a function/);
	});

	it("rejects duplicate child names", () => {
		const broken = {
			...plugin,
			root: { ...plugin.root, children: [hello, hello] },
		};
		expect(() => validatePlugin("@example/demo", broken)).toThrow(/duplicate child hello/);
	});

	it("accepts a default that names a child verb and rejects one that does not", () => {
		const withDefault = { ...plugin, root: { ...plugin.root, default: "hello" } };
		expect(validatePlugin("@example/demo", withDefault).root.default).toBe("hello");
		const toGroup = { ...plugin, root: { ...plugin.root, default: "inner" } };
		expect(() => validatePlugin("@example/demo", toGroup)).toThrow(
			/default "inner" must name a child verb/,
		);
		const missing = { ...plugin, root: { ...plugin.root, default: "nope" } };
		expect(() => validatePlugin("@example/demo", missing)).toThrow(/must name a child verb/);
	});

	it("rejects a root that is a verb", () => {
		expect(() =>
			validatePlugin("@example/demo", { package: "@example/demo", root: hello }),
		).toThrow(/root must be a group/);
	});

	it("rejects names that are not lowercase kebab-case", () => {
		const broken = { ...plugin, root: { ...plugin.root, name: "Demo" } };
		expect(() => validatePlugin("@example/demo", broken)).toThrow(/name must match/);
	});
});

describe("verbPaths", () => {
	it("lists every verb with its full path", () => {
		expect(verbPaths(plugin.root)).toEqual([
			["demo", "hello"],
			["demo", "inner", "hello"],
		]);
	});
});
