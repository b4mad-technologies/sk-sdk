// A test-only plugin: proves the `@spellkave/cli-plugin` contract from outside
// the core, the way a real plugin package would use it.

import {
	defineGroup,
	definePlugin,
	defineVerb,
	EXIT_IN_WORLD,
	EXIT_OK,
} from "@spellkave/cli-plugin";
import { Type } from "typebox";

const hello = defineVerb({
	name: "hello",
	description: "Greet someone, stamped with the host clock.",
	parameters: Type.Object({
		name: Type.String({ description: "Who to greet." }),
		shout: Type.Optional(Type.Boolean({ description: "Upper-case the greeting." })),
	}),
	positionals: ["name"],
	async run(params, ctx) {
		const text = `hello ${params.name}`;
		ctx.out.record({
			kind: "greeting",
			text: params.shout === true ? text.toUpperCase() : text,
			at: ctx.host.now(),
			format_source: ctx.config["output.format"]?.source,
		});
		return EXIT_OK;
	},
});

const readNote = defineVerb({
	name: "read",
	description: "Read a note through the host seam.",
	parameters: Type.Object({ path: Type.String() }),
	async run(params, ctx) {
		const contents = ctx.host.readFile(params.path);
		if (contents === null) {
			ctx.out.record({ kind: "note_missing", path: params.path });
			return EXIT_IN_WORLD;
		}
		ctx.out.record({ kind: "note", contents });
		return EXIT_OK;
	},
});

export default definePlugin({
	package: "@example/demo",
	root: defineGroup({
		name: "demo",
		description: "Demo plugin for the sk plugin contract tests.",
		children: [
			hello,
			defineGroup({ name: "notes", description: "Note commands.", children: [readNote] }),
		],
	}),
});
