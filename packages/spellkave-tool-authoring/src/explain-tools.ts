import { explainPersona, getToolContract } from "@spellkave/tool-contracts";
import { EXPLAIN_PARAMS, EXPLAIN_TOOL } from "@spellkave/tool-contracts/schemas";
import {
	bootstrapVocabularyRows,
	type ExplainAnswer,
	explainVocabulary,
	inspectManifest,
	ROW_KIND_NATURAL_KEY,
	ROW_KIND_STORAGE_KEY,
} from "@spellkave/world-author/tooling";
import { resolveAuthorTarget } from "./author-target";
import type { AuthorToolContext } from "./authoring";
import { defineTool } from "./tool-registry";

/** Public catalogs and the redacting binding view; no owner-table subscription. */
export const EXPLAIN_VOCABULARY_TABLES = [
	"role_definition",
	"role_aggregation",
	"visible_role_binding",
	"capability_definition",
	"extent_kind_definition",
	"affordance_template",
	"action_definition",
	"visible_place_graph_definition",
	"visible_place_node",
	"visible_place_seal",
	"visible_place_seal_break",
] as const;

export const explainToolDef = defineTool<
	AuthorToolContext,
	typeof EXPLAIN_PARAMS,
	ExplainAnswer | Record<string, unknown>,
	never
>({
	contract: EXPLAIN_TOOL,
	schema: EXPLAIN_PARAMS,
	exampleParams: { kind: "role", id: "dm" },
	run: async (context, params) => {
		if (params.kind === "verb" || params.kind === "persona") {
			const details =
				params.kind === "persona"
					? explainPersona(params.id)
					: (() => {
							const contract = getToolContract(
								params.id.startsWith("spellkave_") ? params.id : `spellkave_${params.id}`,
							);
							return {
								ok: true,
								kind: "verb",
								name: contract.name,
								description: contract.description,
								admission: contract.admission,
								server_decides: true,
							};
						})();
			return { content: [{ type: "text", text: JSON.stringify(details) }], details };
		}
		const source = params.target ?? "files";
		const target = resolveAuthorTarget(context.target);
		if (source === "live" && target?.kind !== "live") {
			throw new Error(
				"spellkave_explain: target live requires a connected public vocabulary target.",
			);
		}
		const local = target?.kind === "local" ? target : resolveAuthorTarget(context.localTarget);
		const toml = source === "files" ? context.workspace.readToml() : null;
		const workspace = toml === null ? {} : inspectManifest(toml).manifest;
		const lookup = (kind: string) => {
			if (source === "live") return target!.lookup(kind);
			const scratch = workspace[kind];
			const candidates = [
				...bootstrapVocabularyRows(kind),
				...(local?.kind === "local" ? local.lookup(kind) : []),
				...(Array.isArray(scratch) ? (scratch as Record<string, unknown>[]) : []),
			];
			const fields =
				ROW_KIND_STORAGE_KEY[kind] ??
				(ROW_KIND_NATURAL_KEY[kind] ? [ROW_KIND_NATURAL_KEY[kind]] : undefined);
			if (fields === undefined) throw new Error(`No authored identity for ${kind}`);
			const rows = new Map<string, Record<string, unknown>>();
			for (const row of candidates)
				rows.set(JSON.stringify(fields.map((field) => row[field])), row);
			return [...rows.values()];
		};
		const details = explainVocabulary(
			params.kind,
			params.id,
			source,
			lookup,
			context.explainDisclosure,
		);
		return { content: [{ type: "text", text: JSON.stringify(details) }], details };
	},
});
