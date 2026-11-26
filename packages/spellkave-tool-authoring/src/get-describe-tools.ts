import type { OwnerDescribeAnswer, OwnerGetAnswer } from "@spellkave/tool-contracts";
import {
	DESCRIBE_PARAMS,
	DESCRIBE_TOOL,
	GET_PARAMS,
	GET_TOOL,
} from "@spellkave/tool-contracts/schemas";
import type { Static } from "typebox";

import type { AuthorToolContext, AuthorToolResult } from "./authoring";
import { defineTool } from "./tool-registry";

const NO_READ =
	"no admitted instance reader on this connection. Connect with publisher or scoped read authority.";

/** Same lossless integer contract as CLI `stringifyJsonl` / SDK `log.ts`: bigint → decimal string. */
function bigintReplacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}

function textOfAnswer(answer: OwnerGetAnswer | OwnerDescribeAnswer): string {
	return JSON.stringify(answer, bigintReplacer) ?? "null";
}

export const getToolDef = defineTool<AuthorToolContext, typeof GET_PARAMS, OwnerGetAnswer, never>({
	contract: GET_TOOL,
	schema: GET_PARAMS,
	exampleParams: {
		kind: "entities",
		key: "kavemouth/adventure/item/loft_chest_1",
	},
	run: async (context, params: Static<typeof GET_PARAMS>) => {
		const port = context.readInstance;
		if (port === undefined) {
			const details: OwnerGetAnswer = { ok: false, code: "not_publisher", message: NO_READ };
			return {
				content: [{ type: "text", text: textOfAnswer(details) }],
				details,
			} satisfies AuthorToolResult<OwnerGetAnswer>;
		}
		const details = await port.get({
			kind: params.kind,
			key: params.key,
			bundle: params.bundle,
			pattern: params.pattern,
			fields: params.fields,
			limit: params.limit,
		});
		return {
			content: [{ type: "text", text: textOfAnswer(details) }],
			details,
		} satisfies AuthorToolResult<OwnerGetAnswer>;
	},
});

export const describeToolDef = defineTool<
	AuthorToolContext,
	typeof DESCRIBE_PARAMS,
	OwnerDescribeAnswer,
	never
>({
	contract: DESCRIBE_TOOL,
	schema: DESCRIBE_PARAMS,
	exampleParams: {
		kind: "entities",
		key: "kavemouth/adventure/item/loft_chest_1",
	},
	run: async (context, params: Static<typeof DESCRIBE_PARAMS>) => {
		const port = context.readInstance;
		if (port === undefined) {
			const details: OwnerDescribeAnswer = {
				ok: false,
				code: "not_publisher",
				message: NO_READ,
			};
			return {
				content: [{ type: "text", text: textOfAnswer(details) }],
				details,
			} satisfies AuthorToolResult<OwnerDescribeAnswer>;
		}
		const details = await port.describe({
			kind: params.kind,
			key: params.key,
			bundle: params.bundle,
			limit: params.limit,
		});
		return {
			content: [{ type: "text", text: textOfAnswer(details) }],
			details,
		} satisfies AuthorToolResult<OwnerDescribeAnswer>;
	},
});
