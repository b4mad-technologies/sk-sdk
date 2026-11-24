export type ExplainKind = "role" | "binding" | "capability" | "extent-kind" | "place";
export type VocabularyRow = Record<string, unknown>;
export type VocabularyLookup = (kind: string) => VocabularyRow[];
export const EXPLAIN_ROW_KINDS = [
	"role_definitions",
	"role_aggregations",
	"role_bindings",
	"capability_definitions",
	"extent_kind_definitions",
	"affordance_templates",
	"action_definitions",
	"place_graphs",
	"place_nodes",
	"place_seals",
] as const;

export interface ExplainDisclosure {
	connectedIdentity?: string;
	readsAsPublisher?: boolean;
	/** Only set for the server-filtered grant/v1 binding view. */
	bindingSubjectsAdmitted?: boolean;
	identitiesForPresence?: (body: string) => string[];
}

export type ExplainAnswer =
	| { ok: false; kind: ExplainKind; id: string; source: "files" | "live"; nearest_ids: string[] }
	| {
			ok: true;
			kind: ExplainKind;
			id: string;
			source: "files" | "live";
			definition: VocabularyRow;
			capabilities?: VocabularyRow[];
			capability_ids?: string[];
			contributions?: VocabularyRow[];
			bound_to?: VocabularyRow[];
			state?: "planned" | "inert" | "realised";
			derived_elevation_class?: string;
			identities?: string[];
			roles?: VocabularyRow[];
			affordance_templates?: VocabularyRow[];
			action_definitions?: VocabularyRow[];
			seal_state?: "open" | "sealed" | "seal_unknown" | "server decides";
			sealing_graph?: string;
	  };

/** Structured projection only: descriptions and authority facts stay authored data. */
export function explainVocabularyWith(
	kind: ExplainKind,
	id: string,
	source: "files" | "live",
	lookup: VocabularyLookup,
	merge: (roleId: string, lookup: VocabularyLookup) => string[],
	disclosure: ExplainDisclosure = {},
): ExplainAnswer {
	const [rowKind, field] =
		kind === "role"
			? ["role_definitions", "role_id"]
			: kind === "binding"
				? ["role_bindings", "binding_id"]
				: kind === "capability"
					? ["capability_definitions", "capability_id"]
					: kind === "place"
						? ["place_graphs", "place_graph_id"]
						: ["extent_kind_definitions", "kind_id"];
	const rows = lookup(rowKind);
	const definition =
		rows.find((row) => row[field] === id) ??
		(kind === "place" ? lookup("place_nodes").find((row) => row.node_id === id) : undefined);
	if (definition === undefined) {
		const prefixLength = (candidate: string) => {
			let n = 0;
			while (n < id.length && n < candidate.length && candidate[n] === id[n]) n++;
			return n;
		};
		const nearest_ids = rows
			.map((row) => String(row[field]))
			.sort((a, b) => prefixLength(b) - prefixLength(a) || a.localeCompare(b))
			.slice(0, 5);
		return { ok: false, kind, id, source, nearest_ids };
	}
	if (kind === "place") {
		if (source === "live" && !disclosure.readsAsPublisher) {
			return { ok: true, kind, id, source, definition, seal_state: "server decides" };
		}
		const graphs = lookup("place_graphs");
		const seals = lookup("place_seals");
		let graph = String(definition.place_graph_id);
		let sealing_graph: string | undefined;
		const seen = new Set<string>();
		for (let depth = 0; depth < 64; depth++) {
			if (graph === "")
				return {
					ok: true,
					kind,
					id,
					source,
					definition,
					seal_state: sealing_graph ? "sealed" : "open",
					...(sealing_graph ? { sealing_graph } : {}),
				};
			const row = graphs.find((r) => r.place_graph_id === graph);
			if (row === undefined || seen.has(graph))
				return {
					ok: true,
					kind,
					id,
					source,
					definition,
					seal_state: "seal_unknown",
					sealing_graph: graph,
				};
			seen.add(graph);
			if (
				sealing_graph === undefined &&
				seals.some((r) => r.place_graph_id === graph && r.broken !== true)
			)
				sealing_graph = graph;
			graph = String(row.parent_graph_id ?? "");
		}
		return {
			ok: true,
			kind,
			id,
			source,
			definition,
			seal_state: "seal_unknown",
			sealing_graph: graph,
		};
	}
	const discloseIdentity = (identity: string) =>
		source === "files" ||
		disclosure.readsAsPublisher ||
		identity.replace(/^0x/, "") === disclosure.connectedIdentity?.replace(/^0x/, "")
			? identity
			: "another identity";
	const discloseBinding = (row: VocabularyRow): VocabularyRow => {
		const subject = String(row.subject ?? "");
		return /^(?:0x)?[0-9a-f]{64}$/i.test(subject)
			? {
					...row,
					subject: disclosure.bindingSubjectsAdmitted ? subject : discloseIdentity(subject),
				}
			: row;
	};
	if (kind === "binding") {
		const capability_ids = merge(String(definition.role_id), lookup);
		const presence = String(definition.presence_entity_id ?? "0");
		const realised = source === "live" && presence !== "0" && presence !== "";
		const subject = String(definition.subject ?? "");
		const identities = realised
			? (disclosure.identitiesForPresence?.(presence) ??
				(/^(?:0x)?[0-9a-f]{64}$/i.test(subject) ? [subject] : ["another identity"]))
			: [];
		return {
			ok: true,
			kind,
			id,
			source,
			definition: discloseBinding(definition),
			state: source === "files" ? "planned" : realised ? "realised" : "inert",
			capability_ids,
			derived_elevation_class: capability_ids.includes("frontier.read_internal")
				? "internal"
				: "hidden",
			identities: [
				...new Set(
					identities.map((identity) =>
						disclosure.bindingSubjectsAdmitted && identity === subject
							? identity
							: discloseIdentity(identity),
					),
				),
			].sort(),
		};
	}
	if (kind === "role") {
		const capability_ids = merge(id, lookup);
		return {
			ok: true,
			kind,
			id,
			source,
			definition,
			capability_ids,
			bound_to: lookup("role_bindings")
				.filter((row) => row.role_id === id)
				.sort((a, b) => String(a.binding_id).localeCompare(String(b.binding_id)))
				.map(discloseBinding),
			capabilities: capability_ids.flatMap((capId) =>
				lookup("capability_definitions").filter((row) => row.capability_id === capId),
			),
			contributions: [
				definition,
				...lookup("role_aggregations")
					.filter((row) => row.role_id === id)
					.sort((a, b) => String(a.bundle_id).localeCompare(String(b.bundle_id))),
			],
		};
	}
	if (kind === "capability")
		return {
			ok: true,
			kind,
			id,
			source,
			definition,
			roles: lookup("role_definitions")
				.filter((row) => merge(String(row.role_id), lookup).includes(id))
				.sort((a, b) => String(a.role_id).localeCompare(String(b.role_id))),
			affordance_templates: lookup("affordance_templates")
				.filter((row) => row.capability_id === id)
				.map((row) => ({ ...row, privileged: id.startsWith("frontier.") })),
			action_definitions: lookup("action_definitions").filter(
				(row) => row.required_capability === id,
			),
		};
	return { ok: true, kind, id, source, definition };
}
