// World authors get honest completeness and stable continuations from admitted rows.
// Uses in-memory file projections; live admission and hidden-row privacy need a live node.
import type { ExplorationRef, ExploreRequest } from "@spellkave/tool-contracts";
import { describe, expect, it } from "vitest";
import {
	EXPLORATION_ARGUMENT_REASONS,
	EXPLORATION_BYTE_LIMIT,
	type ExplorationPort,
	type ExplorationSnapshot,
	ExplorationSourceError,
	explorationSourceId,
	explore,
} from "../exploration";
import {
	EXPLORATION_EXAMINED_ROW_LIMIT,
	projectExplorationManifest,
} from "../exploration-manifest";

const identity = {
	source: "local" as const,
	source_id: "fixture-A",
	world: null,
	world_instance: null,
	connection_epoch: "files-v1",
};
const manifest = {
	place_graphs: [{ place_graph_id: "g", display_name: "Town", bundle_id: "test" }],
	place_nodes: [
		{
			node_id: "a",
			place_graph_id: "g",
			display_name: "Straße",
			description: "quiet Ｌｏｆｔ",
			bundle_id: "test",
		},
		{
			node_id: "b",
			place_graph_id: "g",
			display_name: "Straße",
			description: "tomb",
			bundle_id: "test",
		},
	],
	place_edges: [
		{ edge_key: "one", from_node_id: "a", to_node_id: "b" },
		{ edge_key: "two", from_node_id: "a", to_node_id: "b" },
		{ edge_key: "two", from_node_id: "a", to_node_id: "b" },
	],
	entity_definitions: [
		{
			entity_def_id: "chest",
			bundle_id: "test",
			display_name: "Chest",
			description: "Reusable wooden container",
		},
	],
	entity_definition_tag: [
		{ entity_def_id: "chest", tag: "wooden", bundle_id: "test", source: "manifest" },
	],
	capability_definitions: [{ capability_id: "open", display_name: "Open", bundle_id: "test" }],
	entity_definition_initial_capability: [{ entity_def_id: "chest", capability_id: "open" }],
	entities: [
		{
			entity_key: "placed",
			entity_def_id: "chest",
			place_node_id: "a",
			name: "Chest",
			bundle_id: "test",
		},
	],
};
// Exceeds the summary page size so truncation still proves its more flag.
const smallRowLimit = 32;
async function setup(
	input: Record<string, unknown> = manifest,
	options: Parameters<typeof projectExplorationManifest>[2] = {},
) {
	let snapshot = await projectExplorationManifest(input, identity, options);
	return {
		port: { snapshot: async () => snapshot } satisfies ExplorationPort,
		set: (next: ExplorationSnapshot) => {
			snapshot = next;
		},
		snapshot,
	};
}
/** `explore` with the `source_id` a caller would copy from the response, when it holds a ref. */
async function ex(
	port: ExplorationPort | undefined,
	req: ExploreRequest,
): ReturnType<typeof explore> {
	if (port && (req.ref || req.within) && req.source_id === undefined) {
		const snap = await port.snapshot(req.source ?? "live");
		return explore(port, { ...req, source_id: await explorationSourceId(snap.source) });
	}
	return explore(port, req);
}
const request = (partial: Omit<ExploreRequest, "source">): ExploreRequest => ({
	source: "local",
	...partial,
});
async function findRef(
	port: ExplorationPort,
	id: string,
	collection: ExploreRequest["collection"] = "places",
): Promise<ExplorationRef> {
	const result = await ex(port, request({ operation: "search", collection, text: id }));
	const ref = result.items.find((row) => row.ref.id === id)?.ref;
	if (!ref) throw new Error(`missing ${id}`);
	return ref;
}
describe("WE01–08 admitted exploration engine (not live privacy proof)", () => {
	// keep(K1): enumerate static family-coverage states; counts must not become lower-bound totals.
	it.each([
		"incomplete",
		"unsupported",
		"disconnected",
	] as const)("summary omits exact totals and kind counts for a %s instance family", async (state) => {
		const { port, snapshot, set } = await setup();
		set({
			...snapshot,
			source: {
				...snapshot.source,
				coverage: snapshot.source.coverage.map((entry) =>
					entry.family === "entities" ? { ...entry, state, reason: "reader_bound" } : entry,
				),
			},
		});
		const answer = await ex(port, request({ operation: "summary" }));
		expect(answer.completeness).toBe("incomplete");
		const instances = answer.summary?.find((entry) => entry.collection === "instances");
		expect(instances).toMatchObject({
			collection: "instances",
			unit: "objects",
			completeness: "incomplete",
		});
		expect(instances?.total).toBeUndefined();
		expect(instances?.by_kind).toBeUndefined();
		expect(instances?.row_metadata).toBeUndefined();
		expect(instances?.examined).toBeGreaterThanOrEqual(0);
		expect(answer.summary?.find((entry) => entry.collection === "places")?.total).toBe(3);
		expect(answer.page.total).toBeUndefined();
	});
	it("WE-06 a live summary titles bundles of admitted rows and never names a row-less bundle", async () => {
		const snapshot = await projectExplorationManifest(
			{
				bundles: [
					{ bundle_id: "town", display_name: "Town" },
					{ bundle_id: "vault", display_name: "Secret Vault" },
				],
				place_nodes: [{ node_id: "hall", bundle_id: "town", display_name: "Hall" }],
			},
			{ ...identity, source: "live", world: "w", world_instance: "i" },
		);
		const port = { snapshot: async () => snapshot } satisfies ExplorationPort;
		const answer = await explore(port, { operation: "summary", source: "live" });
		expect(answer.reason, JSON.stringify(answer)).toBeUndefined();
		expect(answer.bundles?.items).toEqual([
			{ bundle: "town", title: "Town", places: 1, definitions: 0, objects: 0 },
		]);
		expect(JSON.stringify(answer)).not.toContain("vault");
		expect(JSON.stringify(answer)).not.toContain("Secret");
	});
	it("default summary lists bundles with authored titles and unrefined definition families", async () => {
		const tag = (entity_def_id: string, value: string) => ({
			entity_def_id,
			tag: value,
			bundle_id: "rules",
			source: "manifest",
		});
		const { port } = await setup({
			bundles: [
				{ bundle_id: "rules", display_name: "Rules" },
				{ bundle_id: "empty", display_name: "Empty" },
				{ bundle_id: "untitled" },
			],
			place_nodes: [{ node_id: "hall", bundle_id: "adventure", display_name: "Hall" }],
			entity_definitions: [
				{ entity_def_id: "spell/a", bundle_id: "rules", display_name: "A" },
				{ entity_def_id: "spell/b", bundle_id: "rules", display_name: "B" },
			],
			entities: [{ entity_key: "chest", bundle_id: "adventure", name: "Chest" }],
			entity_definition_tag: [
				tag("spell/a", "x.spell"),
				tag("spell/b", "x.spell"),
				tag("spell/a", "x.spell.level.1"),
				tag("spell/b", "x.spell.level.1"),
				tag("spell/b", "x.ritual"),
			],
		});
		const answer = await ex(port, request({ operation: "summary" }));
		expect(answer.bundles).toEqual({
			completeness: "complete",
			more: false,
			items: [
				// No authored bundle row for "adventure": its rows count, it gets no title.
				{ bundle: "adventure", places: 1, definitions: 0, objects: 1 },
				{ bundle: "empty", title: "Empty", places: 0, definitions: 0, objects: 0 },
				// Five tag rows plus two definitions.
				{ bundle: "rules", title: "Rules", places: 0, definitions: 7, objects: 0 },
				{ bundle: "untitled", places: 0, definitions: 0, objects: 0 },
			],
		});
		const definitions = answer.summary?.find((entry) => entry.collection === "definitions");
		// x.spell.level.1 refines x.spell, so it is no family; --facets still lists it.
		expect(definitions?.families).toEqual({
			items: [
				{ tag: "x.spell", count: 2 },
				{ tag: "x.ritual", count: 1 },
			],
			more: false,
		});
		expect(definitions?.tag_facets).toBeUndefined();
		const facets = await ex(port, request({ operation: "summary", facets: true }));
		const wide = facets.summary?.find((entry) => entry.collection === "definitions");
		expect(wide?.families).toBeUndefined();
		expect(wide?.tag_facets?.items.map((facet) => facet.tag)).toContain("x.spell.level.1");
	});
	it("summary bundle counts add up to the totals and a cut bundle list is incomplete", async () => {
		const { port } = await setup({
			bundles: [{ bundle_id: "town", display_name: "Town" }],
			place_nodes: [
				{ node_id: "hall", bundle_id: "town", display_name: "Hall" },
				{ node_id: "loose", display_name: "Loose" },
			],
		});
		const answer = await ex(port, request({ operation: "summary" }));
		const places = answer.summary?.find((entry) => entry.collection === "places")?.total;
		const listed = (answer.bundles?.items ?? []).reduce((sum, entry) => sum + entry.places, 0);
		expect(answer.bundles?.unbundled).toEqual({ places: 1, definitions: 0, objects: 0 });
		expect(listed + (answer.bundles?.unbundled?.places ?? 0)).toBe(places);
		expect(answer.bundles?.completeness).toBe("complete");
		// The file bundle list is a coverage family, never a row kind.
		expect((await ex(port, request({ operation: "search", kind: "bundles" }))).reason).toBe(
			"unsupported_family",
		);
		const many = await setup(
			{
				bundles: Array.from({ length: smallRowLimit + 1 }, (_, i) => ({
					bundle_id: `b${i}`,
				})),
			},
			{ examinedRowLimit: smallRowLimit },
		);
		const cut = await ex(many.port, request({ operation: "summary" }));
		expect(cut.bundles?.completeness).toBe("incomplete");
		expect(cut.bundles?.more).toBe(true);
	});
	it("inbound references reach actor capabilities, movement defaults and edge affordances", async () => {
		const b = { bundle_id: "town" };
		const { port } = await setup({
			place_graphs: [{ ...b, place_graph_id: "town/g", display_name: "G" }],
			place_nodes: [
				{ ...b, node_id: "town/a", place_graph_id: "town/g", display_name: "A" },
				{ ...b, node_id: "town/b", place_graph_id: "town/g", display_name: "B" },
			],
			place_edges: [
				{ ...b, edge_key: "town/a->town/b", from_node_id: "town/a", to_node_id: "town/b" },
			],
			capability_definitions: [
				{ bundle_id: "rules", capability_id: "rules/swim", display_name: "Swim" },
			],
			affordance_templates: [
				{ bundle_id: "rules", template_id: "rules/swim/affordance", display_name: "Swim" },
			],
			actors: [{ ...b, entity_key: "town/npc", name: "Npc" }],
			actor_capabilities: [
				{
					...b,
					actor_entity_key: "town/npc",
					capability_id: "rules/swim",
					source: "manifest",
					source_args_hash: "",
				},
			],
			movement_defaults: [
				{ ...b, place_graph_id: "", mode_id: "", affordance_template_id: "rules/swim/affordance" },
			],
			place_edge_affordance: [
				{
					edge_key: "town/a->town/b",
					affordance_template_id: "rules/swim/affordance",
					mode_id: "",
				},
			],
		});
		const first = await ex(port, request({ operation: "search" }));
		const sourceId = first.source.source_id;
		const withId = (kind: string, id: string) =>
			ex(
				port,
				request({
					operation: "references",
					direction: "inbound",
					ref: { collection: "definitions", kind, id, bundle: "rules" },
					source_id: sourceId,
				}),
			);
		const capability = await withId("capability_definitions", "rules/swim");
		expect(capability.items.map((item) => [item.ref.kind, item.ref.id])).toEqual([
			["actors", "town/npc"],
		]);
		expect(capability.links).toContain("actor_capabilities");
		const affordance = await withId("affordance_templates", "rules/swim/affordance");
		expect(affordance.items.map((item) => item.ref.kind).sort()).toEqual([
			"movement_defaults",
			"place_nodes",
		]);
		expect(affordance.completeness).toBe("complete");
		expect(affordance.links).toEqual(
			expect.arrayContaining(["movement_defaults", "place_edge_affordance"]),
		);
	});
	it("edge affordances skip a duplicate edge key and turn incomplete when edges are cut", async () => {
		const node = (id: string) => ({ bundle_id: "town", node_id: id, display_name: id });
		const affordance = {
			bundle_id: "rules",
			template_id: "rules/swim/affordance",
			display_name: "Swim",
		};
		const use = {
			edge_key: "town/a->town/b",
			affordance_template_id: affordance.template_id,
			mode_id: "",
		};
		const edge = (from: string) => ({
			bundle_id: "town",
			edge_key: "town/a->town/b",
			from_node_id: from,
			to_node_id: "town/b",
		});
		const impact = async (input: Record<string, unknown>) => {
			const { port } = await setup(input, { examinedRowLimit: smallRowLimit });
			const sourceId = (await ex(port, request({ operation: "search" }))).source.source_id;
			return ex(
				port,
				request({
					operation: "references",
					direction: "inbound",
					ref: {
						collection: "definitions",
						kind: "affordance_templates",
						id: affordance.template_id,
						bundle: "rules",
					},
					source_id: sourceId,
				}),
			);
		};
		const base = {
			place_nodes: [node("town/a"), node("town/b"), node("town/c")],
			affordance_templates: [affordance],
			place_edge_affordance: [use],
		};
		const duplicate = await impact({ ...base, place_edges: [edge("town/a"), edge("town/c")] });
		expect(duplicate.items).toEqual([]);
		const cut = await impact({
			...base,
			place_edges: [
				...Array.from({ length: smallRowLimit }, (_, i) => ({
					bundle_id: "town",
					edge_key: `town/x${i}`,
					from_node_id: "town/b",
					to_node_id: "town/c",
				})),
				edge("town/a"),
			],
		});
		expect(cut.completeness).toBe("incomplete");
		expect(cut.source.coverage).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					state: "incomplete",
					families: expect.arrayContaining(["place_edge_affordance"]),
				}),
			]),
		);
	}, 30_000);
	it("state links reach resource definitions and link an id both definition kinds share to both", async () => {
		const r = { bundle_id: "rules" };
		const { port } = await setup({
			resource_definitions: [
				{ ...r, resource_definition_id: "rules/hp", display_name: "Hit Points" },
				{ ...r, resource_definition_id: "rules/both", display_name: "Both" },
			],
			object_state_definitions: [{ ...r, state_id: "rules/both", display_name: "Both" }],
			resource_definition_tag: [
				{ ...r, resource_definition_id: "rules/hp", tag: "rules.vital", source: "manifest" },
			],
			entity_definitions: [
				{ bundle_id: "town", entity_def_id: "town/guard", display_name: "Guard" },
			],
			entities: [
				{
					bundle_id: "town",
					entity_key: "town/guard_1",
					entity_def_id: "town/guard",
					name: "Guard",
				},
			],
			entity_definition_initial_state: [
				{ bundle_id: "town", entity_def_id: "town/guard", state_id: "rules/hp" },
				{ bundle_id: "town", entity_def_id: "town/guard", state_id: "rules/both" },
			],
			object_state: [
				{ bundle_id: "town", entity_key: "town/guard_1", state_id: "rules/hp" },
				{ bundle_id: "town", entity_key: "town/guard_1", state_id: "rules/both" },
			],
		});
		const sourceId = (await ex(port, request({ operation: "search" }))).source.source_id;
		const users = async (kind: string, id: string) =>
			(
				await ex(
					port,
					request({
						operation: "references",
						direction: "inbound",
						ref: { kind, id, bundle: "rules" },
						source_id: sourceId,
					}),
				)
			).items.map((item) => `${item.ref.kind} ${item.ref.id}`);
		expect((await users("resource_definitions", "rules/hp")).sort()).toEqual([
			"entities town/guard_1",
			"entity_definitions town/guard",
		]);
		// An id both catalogs define is one state slot (MF-VAL-253 union): both rows list
		// the users, and the answer stays complete.
		for (const kind of ["resource_definitions", "object_state_definitions"]) {
			const out = await ex(
				port,
				request({
					operation: "references",
					direction: "inbound",
					ref: { kind, id: "rules/both", bundle: "rules" },
					source_id: sourceId,
				}),
			);
			expect(out.items.map((item) => `${item.ref.kind} ${item.ref.id}`).sort()).toEqual([
				"entities town/guard_1",
				"entity_definitions town/guard",
			]);
			expect(out.completeness).toBe("complete");
		}
		// A resource definition tag filters resource definitions like any definition tag.
		const tagged = await ex(
			port,
			request({ operation: "search", kind: "resource_definitions", tags: ["rules.vital"] }),
		);
		expect(tagged.items.map((item) => item.ref.id)).toEqual(["rules/hp"]);
	});
	it("summary facets list definition tags per collection, never on places", async () => {
		const tag = (entity_def_id: string, value: string) => ({
			entity_def_id,
			tag: value,
			bundle_id: "test",
			source: "manifest",
		});
		const { port } = await setup({
			entity_definitions: [
				{ entity_def_id: "spell/a", bundle_id: "test", display_name: "A" },
				{ entity_def_id: "spell/b", bundle_id: "test", display_name: "B" },
			],
			entity_definition_tag: [
				tag("spell/a", "srd.spell"),
				tag("spell/b", "srd.spell"),
				tag("spell/b", "srd.spell"),
				tag("spell/b", "srd.ritual"),
				// Not admitted: its definition is absent from the snapshot, so its tag is no facet.
				tag("spell/hidden", "hidden.family"),
			],
		});
		const answer = await ex(port, request({ operation: "summary", facets: true, limit: 1 }));
		const facets = (collection: string) =>
			answer.summary?.find((entry) => entry.collection === collection)?.tag_facets;
		// A repeated membership counts its definition once; the limit cuts the rarer tag.
		expect(facets("definitions")).toEqual({ items: [{ tag: "srd.spell", count: 2 }], more: true });
		expect(facets("instances")).toEqual({ items: [], more: false });
		expect(facets("places")).toBeUndefined();
		const wide = await ex(port, request({ operation: "summary", facets: true, limit: 100 }));
		expect(
			wide.summary
				?.find((entry) => entry.collection === "definitions")
				?.tag_facets?.items.map((facet) => facet.tag),
		).toEqual(["srd.spell", "srd.ritual"]);
	});
	it.each([
		false,
		true,
	])("resolves actor inventory with paired entity body=%s without duplicate relations", async (pairedBody) => {
		const containment = {
			container_entity_key: "buyer",
			entity_key: "item",
			slot_id: "",
			direction: "",
		};
		const { port, snapshot } = await setup({
			actors: [
				{ entity_key: "buyer", bundle_id: "test", name: "Buyer", description: "A customer" },
			],
			entities: [
				{ entity_key: "item", bundle_id: "test", name: "Item" },
				...(pairedBody ? [{ entity_key: "buyer", bundle_id: "test", name: "Buyer body" }] : []),
			],
			place_nodes: [{ node_id: "market", place_graph_id: "town", display_name: "Market" }],
			actor_spatial_locations: [
				{ entity_key: "buyer", place_node_id: "market", bundle_id: "test" },
			],
			entity_containment: [containment, containment],
			entity_tag: [{ entity_key: "buyer", tag: "customer", bundle_id: "test", source: "manifest" }],
		});
		const buyer = snapshot.rows.find((row) => row.kind === "actors");
		expect(buyer?.fields).toEqual({
			entity_key: "buyer",
			name: "Buyer",
			description: "A customer",
			bundle_id: "test",
		});
		expect(buyer?.tags).toEqual(["customer"]);
		const actor = await ex(
			port,
			request({ operation: "search", collection: "instances", kind: "actors", text: "buyer" }),
		);
		const ref = actor.items[0]?.ref;
		if (!ref) throw new Error("missing actor");
		expect(snapshot.relations.filter((x) => x.kind === "entity_containment")).toHaveLength(1);
		const neighbors = await ex(
			port,
			request({ operation: "neighbors", ref, direction: "outbound" }),
		);
		expect(
			neighbors.items.map((x) => [
				x.ref.kind,
				x.ref.id,
				x.relationship?.kind,
				x.relationship?.direction,
			]),
		).toEqual([
			["entities", "item", "entity_containment", "outbound"],
			["place_nodes", "market", "actor_spatial_locations", "inbound"],
		]);
		const itemRef = neighbors.items.find((x) => x.relationship?.kind === "entity_containment")?.ref;
		if (!itemRef) throw new Error("missing inventory item");
		const inbound = await ex(
			port,
			request({ operation: "neighbors", ref: itemRef, direction: "inbound" }),
		);
		expect(inbound.items.map((x) => [x.ref.kind, x.ref.id])).toEqual([
			[pairedBody ? "entities" : "actors", "buyer"],
		]);
		const inventory = await ex(
			port,
			request({ operation: "search", collection: "instances", kind: "entities", within: ref }),
		);
		expect(inventory.items.map((x) => x.ref.id)).toEqual(["item"]);
		const market = await findRef(port, "market");
		const local = await ex(
			port,
			request({ operation: "search", collection: "instances", kind: "actors", within: market }),
		);
		expect(local.items.map((x) => x.ref.id)).toEqual(["buyer"]);
	});
	it("resolves an actor as the contained endpoint and retains exact reverse navigation", async () => {
		const { port } = await setup({
			entities: [{ entity_key: "wagon", bundle_id: "test", name: "Wagon" }],
			actors: [{ entity_key: "passenger", bundle_id: "test", name: "Passenger" }],
			entity_containment: [
				{ container_entity_key: "wagon", entity_key: "passenger", slot_id: "", direction: "" },
			],
		});
		const wagon = await findRef(port, "wagon", "instances");
		const passenger = await findRef(port, "passenger", "instances");
		const neighbors = await ex(port, request({ operation: "neighbors", ref: wagon }));
		expect(neighbors.items.map((x) => [x.ref.kind, x.ref.id])).toEqual([["actors", "passenger"]]);
		const reverse = await ex(port, request({ operation: "neighbors", ref: passenger }));
		expect(reverse.items.map((x) => [x.ref.kind, x.ref.id, x.relationship?.direction])).toEqual([
			["entities", "wagon", "inbound"],
		]);
		const inside = await ex(
			port,
			request({ operation: "search", collection: "instances", kind: "actors", within: wagon }),
		);
		expect(inside.items.map((x) => x.ref.id)).toEqual(["passenger"]);
	});
	it("omits excluded/unknown inventory endpoints and refuses duplicate or cross-bundle entity keys", async () => {
		const containment = [
			{ container_entity_key: "buyer", entity_key: "item", slot_id: "", direction: "" },
			{ container_entity_key: "buyer", entity_key: "unknown", slot_id: "", direction: "" },
			{ container_entity_key: "unknown", entity_key: "item", slot_id: "", direction: "" },
		];
		const base = {
			actors: [{ entity_key: "buyer", bundle_id: "test", name: "Buyer" }],
			entities: [{ entity_key: "item", bundle_id: "test", name: "Item" }],
			entity_containment: containment,
		};
		for (const input of [
			{ ...base, entities: [] }, // excluded item, representing an already filtered provider projection
			{ ...base, actors: [] }, // excluded container
			{ ...base, actors: [...base.actors, ...base.actors] },
			{ ...base, entities: [...base.entities, ...base.entities] },
			{
				...base,
				entities: [
					...base.entities,
					{ entity_key: "buyer", bundle_id: "other", name: "Collision" },
				],
			},
		]) {
			const { snapshot } = await setup(input);
			expect(snapshot.relations).toEqual([]);
		}
		const { port } = await setup(base);
		const actor = await ex(
			port,
			request({ operation: "search", collection: "instances", kind: "actors" }),
		);
		const ref = actor.items[0]?.ref;
		if (!ref) throw new Error("missing actor");
		const missing = await ex(
			port,
			request({ operation: "detail", ref: { ...ref, id: "unknown" } }),
		);
		const denied = await ex(
			port,
			request({ operation: "detail", ref: { ...ref, id: "excluded" } }),
		);
		expect(missing).toEqual(denied);
	});
	it("continues an actor's actual schema name from its truncated label without invented scalar fields", async () => {
		const name = "😀Buyer".repeat(2500);
		const { port, snapshot } = await setup({
			actors: [
				{
					entity_key: "buyer",
					bundle_id: "test",
					name,
					description: "Customer",
					display_name: "opaque fake label",
					role: "opaque role",
				},
			],
		});
		expect(snapshot.fields.actors).toEqual(["entity_key", "name", "description", "bundle_id"]);
		const ref = await findRef(port, "buyer", "instances");
		const detail = await ex(port, request({ operation: "detail", ref }));
		expect(detail.items[0]?.label).toBe([...name].slice(0, 512).join(""));
		const cuts = detail.items[0]?.truncated?.map((x) => x.field);
		expect(cuts).toContain("name");
		expect(cuts).not.toContain("display_name");
		const q = request({ operation: "field", ref, field: "name" });
		let page = await ex(port, q),
			restored = "",
			pages = 0;
		while (true) {
			expect(new TextEncoder().encode(JSON.stringify(page)).length).toBeLessThanOrEqual(
				EXPLORATION_BYTE_LIMIT,
			);
			expect(page.ok).toBe(true);
			restored += page.items[0]?.fields?.name;
			pages++;
			if (!page.page.next_cursor) break;
			page = await ex(port, { ...q, cursor: page.page.next_cursor });
		}
		expect(restored).toBe(name);
		expect(pages).toBeGreaterThan(1);
		expect(
			(await ex(port, request({ operation: "field", ref, field: "display_name" }))).reason,
		).toBe("unsupported_field");
	});
	it("WE01/02/04 searches Unicode descriptive fields, literal tags and distinct definition/instance provenance without mutation", async () => {
		const { port } = await setup();
		const rooms = await ex(port, request({ operation: "search", text: "STRASSE" }));
		expect(rooms.items.map((x) => x.ref.id)).toEqual(["a", "b"]);
		const loft = await ex(port, request({ operation: "search", text: "loft" }));
		expect(loft.items.map((x) => x.ref.id)).toEqual(["a"]);
		const definitions = await ex(
			port,
			request({
				operation: "search",
				collection: "definitions",
				text: "container",
				tags: ["wooden"],
			}),
		);
		expect(definitions.items.map((x) => x.ref.id)).toEqual(["chest"]);
		const instances = await ex(
			port,
			request({ operation: "search", collection: "instances", text: "chest" }),
		);
		expect(instances.items.map((x) => x.ref.id)).toEqual(["placed"]);
		expect(rooms.items.every((row) => row.context?.[0]?.id === "g")).toBe(true);
	});
	it("WE03 retains each stored parallel relation, collapses duplicate projection, retries and continues exactly", async () => {
		const { port } = await setup();
		const ref = await findRef(port, "a");
		const q = request({ operation: "neighbors", ref, view: "rows", limit: 1 });
		let page = await ex(port, q);
		const keys: string[] = [];
		let lastCursor: string | undefined;
		while (true) {
			expect(await ex(port, { ...q, ...(keys.length ? { cursor: lastCursor } : {}) })).toEqual(
				page,
			);
			keys.push(
				...page.items.map((x) =>
					[
						x.ref.kind,
						x.ref.id,
						x.relationship?.kind,
						x.relationship?.key,
						x.relationship?.direction,
					].join("|"),
				),
			);
			if (!page.page.next_cursor) break;
			lastCursor = page.page.next_cursor;
			page = await ex(port, { ...q, cursor: lastCursor });
		}
		expect(keys).toHaveLength(4);
		expect(new Set(keys).size).toBe(4);
		expect(keys.filter((x) => x.includes("place_edges"))).toHaveLength(2);
		expect(page.page.complete).toBe(true);
		const objects = await ex(port, request({ operation: "neighbors", ref }));
		expect(objects.items).toHaveLength(3);
		expect(objects.items.find((item) => item.relationships)?.relationships).toHaveLength(2);
	});
	it("WE05 follows typed references exactly one hop, and omits missing endpoints", async () => {
		const { port } = await setup();
		const ref = await findRef(port, "chest", "definitions");
		const refs = await ex(port, request({ operation: "references", ref }));
		expect(refs.items).toHaveLength(2);
		const capability = refs.items.find((x) => x.ref.id === "open");
		expect(capability?.relationship?.kind).toBe("entity_definition_initial_capability");
		const reverse = await ex(
			port,
			request({ operation: "references", ref: capability?.ref, direction: "inbound" }),
		);
		expect(reverse.items.map((x) => x.ref.id)).toEqual(["chest"]);
	});
	it("WE06 is invariant to opaque metadata/foreign rows excluded by the provider, and never falls back to raw db", async () => {
		const one = await setup({ ...manifest, metadata: { private_hint: "secret-A" } }),
			two = await setup({ ...manifest, metadata: { private_hint: "secret-B" } });
		const q = request({ operation: "search", text: "secret" });
		expect(await ex(one.port, q)).toEqual(await ex(two.port, q));
		expect((await ex(undefined, { operation: "search" })).status).toBe("unavailable");
	});
	it("WE07 distinguishes complete emptiness from missing, unsupported and incomplete coverage", async () => {
		const { port, set, snapshot } = await setup({});
		const empty = await ex(port, request({ operation: "search" }));
		expect(empty.items).toEqual([]);
		expect(empty.completeness).toBe("complete");
		expect(empty.page.total).toEqual({ count: 0 });
		expect((await ex(port, request({ operation: "search", kind: "private_hints" }))).reason).toBe(
			"unsupported_family",
		);
		set({
			...snapshot,
			source: {
				...snapshot.source,
				coverage: snapshot.source.coverage.map((x) =>
					x.family === "place_nodes"
						? { ...x, state: "incomplete", reason: "examined_row_bound" }
						: x,
				),
			},
		});
		const incomplete = await ex(port, request({ operation: "search" }));
		expect(incomplete.items).toEqual([]);
		expect(incomplete.completeness).toBe("incomplete");
		expect(incomplete.page.total).toBeUndefined();
		expect(incomplete.recovery?.length).toBeGreaterThan(0);
	});
	it("WE08 preserves unchanged continuation, refuses changed epochs/worlds/roots before lookup and re-admits detail", async () => {
		const { port, set, snapshot } = await setup();
		const q = request({ operation: "search", text: "strasse", limit: 1 });
		const first = await ex(port, q);
		expect(first.page.next_cursor).toBeDefined();
		expect((await ex(port, { ...q, cursor: first.page.next_cursor })).items[0]?.ref.id).toBe("b");
		const ref = first.items[0]?.ref;
		if (!ref) throw new Error("missing selected reference");
		const token = first.source.source_id;
		for (const change of [
			{ source_id: "other-root" },
			{ world_instance: "other-world" },
			{ connection_epoch: "reconnect" },
		]) {
			// The caller holds the token of the response that returned `ref`; the source moves on.
			set({ ...snapshot, source: { ...snapshot.source, ...change } });
			const moved = await explore(port, request({ operation: "detail", ref, source_id: token }));
			expect([moved.status, moved.reason, moved.error_class]).toEqual([
				"unavailable",
				"reference_source_changed",
				"in_world",
			]);
			expect(moved.recovery?.[0]?.params).toEqual({
				explore: { operation: "search", source: "local" },
			});
			expect(moved.source.source_id).not.toBe(token);
		}
		set(snapshot);
		set({
			...snapshot,
			rows: snapshot.rows.filter((x) => x.id !== "a"),
			source: { ...snapshot.source, source_epoch: "revoked" },
		});
		expect((await ex(port, { ...q, cursor: first.page.next_cursor })).status).toBe("stale_cursor");
		expect((await ex(port, request({ operation: "detail", ref }))).status).toBe(
			"not_found_in_scope",
		);
	});
	it("bounds multibyte previews/field chunks with progressing text continuations and rejects oversized identities", async () => {
		const text = "😀".repeat(12000);
		const { port } = await setup({
			place_nodes: [{ node_id: "long", display_name: "Long", description: text }],
		});
		const ref = await findRef(port, "long");
		const detail = await ex(port, request({ operation: "detail", ref }));
		expect(detail.items[0]?.truncated).toContainEqual({
			field: "description",
			shown_code_points: 512,
			total_code_points: 12000,
		});
		const q = request({ operation: "field", ref, field: "description" });
		let out = await ex(port, q),
			assembled = "";
		let pages = 0;
		while (true) {
			expect(new TextEncoder().encode(JSON.stringify(out)).length).toBeLessThanOrEqual(
				EXPLORATION_BYTE_LIMIT,
			);
			const chunk = out.items[0]?.fields?.description;
			expect(typeof chunk).toBe("string");
			expect(String(chunk).length).toBeGreaterThan(0);
			assembled += chunk;
			pages++;
			if (!out.page.next_cursor) break;
			out = await ex(port, { ...q, cursor: out.page.next_cursor });
		}
		expect(assembled).toBe(text);
		expect(pages).toBeGreaterThan(1);
		const huge = await setup({ place_nodes: [{ node_id: "x".repeat(20000) }] });
		expect((await ex(huge.port, request({ operation: "search" }))).reason).toBe(
			"projection_key_too_large",
		);
	});
	it("uses UTF8 identity order without normalizing keys", async () => {
		const { port } = await setup({
			place_nodes: [{ node_id: "é" }, { node_id: "é" }, { node_id: "z" }, { node_id: "😀" }],
		});
		const out = await ex(port, request({ operation: "search" }));
		expect(out.items.map((x) => x.ref.id)).toEqual(["é", "z", "é", "😀"]);
	});
	// keep(K3): pins the production default across budget-tuned test runs with real limit-plus-one rows.
	it("reports the actual family bound (limit + 1 rows) and rejects changed query/invalid field continuations", async () => {
		expect(EXPLORATION_EXAMINED_ROW_LIMIT).toBe(50_000);
		const { port, snapshot } = await setup({
			place_nodes: Array.from({ length: EXPLORATION_EXAMINED_ROW_LIMIT + 1 }, (_, i) => ({
				node_id: `node/${i}`,
				display_name: "Node",
			})),
		});
		expect(snapshot.rows).toHaveLength(50_000);
		expect(snapshot.rows.some((row) => row.id === "node/50000")).toBe(false);
		const q = request({ operation: "search", kind: "place_nodes", limit: 1 });
		const first = await ex(port, q);
		// Only the families that are not complete are listed.
		expect(first.source.coverage).toEqual([
			{ state: "incomplete", reason: "examined_row_bound", families: ["place_nodes"] },
		]);
		expect(first.completeness).toBe("incomplete");
		expect(first.page.total).toBeUndefined();
		expect(first.items).toHaveLength(1);
		expect((await ex(port, { ...q, text: "changed", cursor: first.page.next_cursor })).status).toBe(
			"stale_cursor",
		);
		const ref = first.items[0]?.ref;
		if (!ref) throw new Error("missing reference");
		const missing = { ...ref, id: "absent" };
		expect(
			(await ex(port, request({ operation: "field", ref, field: "payload_json" }))).reason,
		).toBe("unsupported_field");
		expect(
			(await ex(port, request({ operation: "field", ref: missing, field: "payload_json" }))).reason,
		).toBe("unsupported_field");
	});
	it.each([
		"actors",
		"entities",
	])("marks an empty %s tag search incomplete when the wanted membership exceeds the examined bound", async (kind) => {
		const prefix = Array.from({ length: smallRowLimit }, (_, i) => ({
			entity_key: "other",
			tag: `other/${i}`,
			bundle_id: "test",
			source: "manifest",
		}));
		const input = {
			actors: kind === "actors" ? [{ entity_key: "buyer", bundle_id: "test", name: "Buyer" }] : [],
			entities: [
				{ entity_key: "other", bundle_id: "test", name: "Other" },
				...(kind === "entities" ? [{ entity_key: "buyer", bundle_id: "test", name: "Buyer" }] : []),
			],
			entity_tag: [
				...prefix,
				{ entity_key: "buyer", tag: "wanted", bundle_id: "test", source: "manifest" },
			],
		};
		const q = request({ operation: "search", collection: "instances", kind, tags: ["wanted"] });
		const { port } = await setup(input, { examinedRowLimit: smallRowLimit });
		const truncated = await ex(port, q);
		expect(truncated.ok).toBe(true);
		expect(truncated.items).toEqual([]);
		expect(truncated.completeness).toBe("incomplete");
		const groups = truncated.source.coverage;
		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({ state: "incomplete", reason: "examined_row_bound" });
		// Only the family the request reads is reported; the tag family is not a searched kind.
		expect(groups[0]?.families).toEqual([kind]);
		const complete = await setup(
			{ ...input, entity_tag: prefix },
			{ examinedRowLimit: smallRowLimit },
		);
		const absent = await ex(complete.port, q);
		expect(absent.ok).toBe(true);
		expect(absent.items).toEqual([]);
		expect(absent.completeness).toBe("complete");
		expect(absent.page.total).toEqual({ count: 0 });
	});
	// keep(K1): rejects invalid budgets and prevents callers from raising the production cap.
	it.each([
		0,
		-1,
		1.5,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		50_001,
	])("rejects an examined-row budget of %s", async (examinedRowLimit) => {
		await expect(projectExplorationManifest({}, identity, { examinedRowLimit })).rejects.toThrow(
			RangeError,
		);
	});
	it("resolves admitted graph ancestry/contents once and terminates cycles", async () => {
		const { port } = await setup({
			...manifest,
			place_graphs: [
				{ place_graph_id: "g", parent_graph_id: "child" },
				{ place_graph_id: "child", parent_graph_id: "g" },
			],
			place_nodes: [
				...manifest.place_nodes,
				{ node_id: "nested", place_graph_id: "child", display_name: "Nested" },
				{ node_id: "outside", place_graph_id: "other", display_name: "Outside" },
			],
		});
		const within = await findRef(port, "g");
		const inside = await ex(port, request({ operation: "search", kind: "place_nodes", within }));
		expect(inside.items.map((x) => x.ref.id).sort()).toEqual(["a", "b", "nested"]);
	});
});

// Pure part only: response ergonomics derived from an admitted snapshot. The
// hidden-row world pairs (privacy invariance) belong to the live-node tier.
describe("WE-11 Agent narrows, expands and counts within its visible scope", () => {
	const long = "ä".repeat(1300);
	const world = {
		...manifest,
		place_nodes: [
			...manifest.place_nodes,
			{ node_id: "c", place_graph_id: "g", display_name: "Hall", description: long, pos_x: 3 },
		],
	};
	it("returns only ref, label and one context ref by default", async () => {
		const { port } = await setup(world);
		const out = await ex(port, request({ operation: "search", kind: "place_nodes" }));
		for (const item of out.items) {
			expect(Object.keys(item).sort()).toEqual(["context", "label", "ref"]);
			expect(item.context?.length).toBeLessThanOrEqual(1);
		}
	});
	it("carries exactly the selected fields, omitting declared fields a kind lacks", async () => {
		const { port } = await setup(world);
		const out = await ex(
			port,
			request({ operation: "search", text: "hall", fields: ["pos_x", "description"] }),
		);
		const hall = out.items.find((x) => x.ref.id === "c");
		expect(hall?.label).toBeUndefined();
		expect(hall?.fields).toEqual({ pos_x: 3 });
		expect(Array.from(hall?.description ?? "")).toHaveLength(512);
		const graphs = await ex(
			port,
			request({ operation: "search", kind: "place_graphs", fields: ["pos_x", "label"] }),
		);
		expect(graphs.ok).toBe(true);
		expect(graphs.items[0]?.fields).toBeUndefined();
		expect(graphs.items[0]?.label).toBe("Town");
	});
	it("rejects undeclared field names identically whatever rows exist", async () => {
		const q = request({ operation: "search", fields: ["entity_def_id"] });
		const full = await ex((await setup(world)).port, q);
		const empty = await ex((await setup({})).port, q);
		expect(full.status).toBe("unavailable");
		expect(full.reason).toBe("unsupported_field");
		expect({ ...full, source: null }).toEqual({ ...empty, source: null });
		expect(
			(await ex((await setup(world)).port, request({ operation: "neighbors", fields: [] }))).reason,
		).toBe("invalid_input");
	});
	it("states shown and total size and its hint retrieves the remainder in bounded chunks", async () => {
		const { port } = await setup(world);
		const ref = await findRef(port, "c");
		const detail = await ex(port, request({ operation: "detail", ref }));
		expect(detail.items[0]?.truncated).toContainEqual({
			field: "description",
			shown_code_points: 512,
			total_code_points: 1300,
		});
		const hint = detail.next.find((x) => x.operation === "field" && x.field === "description");
		expect(hint).toEqual({
			operation: "field",
			source: "local",
			source_id: detail.source.source_id,
			ref,
			field: "description",
			offset: 512,
		});
		if (!hint) throw new Error("missing full-field hint");
		const rest = await ex(port, hint);
		expect(
			Array.from(detail.items[0]?.description ?? "")
				.concat(Array.from(String(rest.items[0]?.fields?.description)))
				.join(""),
		).toBe(long);
		expect(rest.page.total).toBeUndefined();
	});
	it("counts the total as the number of items paging returns, and the next hint runs as-is", async () => {
		const { port } = await setup(world);
		let page = await ex(port, request({ operation: "search", kind: "place_nodes", limit: 1 }));
		const total = page.page.total?.count;
		const seen: string[] = [];
		while (true) {
			expect(page.page.total?.count).toBe(total);
			expect(page.page.complete).toBe(page.page.next_cursor === undefined);
			seen.push(...page.items.map((x) => x.ref.id));
			const next = page.next[0];
			if (!page.page.next_cursor) break;
			expect(next?.cursor).toBe(page.page.next_cursor);
			if (!next) throw new Error("missing next-page hint");
			page = await ex(port, next);
		}
		expect(seen).toHaveLength(total ?? -1);
		expect([...seen].sort()).toEqual(["a", "b", "c"]);
	});
	it("offers at most four follow-ups, built only from response refs", async () => {
		const { port } = await setup(world);
		const ref = await findRef(port, "c");
		const detail = await ex(port, request({ operation: "detail", ref }));
		expect(detail.next.length).toBeLessThanOrEqual(4);
		expect(detail.next.map((x) => x.operation)).toEqual(["field", "neighbors"]);
		expect(detail.recovery).toBeUndefined();
		const one = await ex(port, request({ operation: "search", text: "hall" }));
		expect(one.next.map((x) => x.operation)).toEqual(["detail", "neighbors"]);
		expect(one.next.every((x) => x.ref?.id === "c")).toBe(true);
	});
	it("reports no total and a recovery route instead of an empty answer when incomplete", async () => {
		const { port, set, snapshot } = await setup(world);
		set({
			...snapshot,
			rows: [],
			source: {
				...snapshot.source,
				coverage: snapshot.source.coverage.map((x) =>
					x.family === "place_nodes"
						? { ...x, state: "incomplete", reason: "examined_row_bound" }
						: x,
				),
			},
		});
		const out = await ex(port, request({ operation: "search", kind: "place_nodes" }));
		expect(out.items).toEqual([]);
		expect(out.completeness).toBe("incomplete");
		expect(out.page.total).toBeUndefined();
		expect(out.recovery).toEqual([
			{
				tool: "spellkave_query",
				params: { explore: { operation: "search", source: "local", kind: "place_nodes" } },
			},
		]);
	});
	it("treats a within search as reading every family it may cross", async () => {
		const { port, set, snapshot } = await setup(world);
		const within = await findRef(port, "g");
		set({
			...snapshot,
			source: {
				...snapshot.source,
				coverage: snapshot.source.coverage.map((x) =>
					x.family === "entities" ? { ...x, state: "incomplete", reason: "examined_row_bound" } : x,
				),
			},
		});
		const out = await ex(port, request({ operation: "search", kind: "place_nodes", within }));
		expect(out.completeness).toBe("incomplete");
		expect(out.page.total).toBeUndefined();
	});
	it("keeps the next-page hint and the byte cap when the cap ends a page early", async () => {
		const label = "😀".repeat(512);
		const { port } = await setup({
			place_nodes: Array.from({ length: 40 }, (_, i) => ({
				node_id: `n${String(i).padStart(2, "0")}`,
				display_name: label,
			})),
		});
		const q = request({ operation: "search", limit: 100 });
		let page = await ex(port, q);
		const seen: string[] = [];
		let pages = 0;
		while (true) {
			expect(new TextEncoder().encode(JSON.stringify(page)).length).toBeLessThanOrEqual(
				EXPLORATION_BYTE_LIMIT,
			);
			expect(page.page.total).toEqual({ count: 40 });
			seen.push(...page.items.map((x) => x.ref.id));
			pages++;
			if (!page.page.next_cursor) break;
			expect(page.items.length).toBeLessThan(40);
			expect(page.next[0]?.cursor).toBe(page.page.next_cursor);
			const next = page.next[0];
			if (!next) throw new Error("missing next-page hint");
			page = await ex(port, next);
		}
		expect(pages).toBeGreaterThan(1);
		expect(seen).toHaveLength(40);
		expect(new Set(seen).size).toBe(40);
	});
});

describe("WE-12 An agent self-corrects a wrong field name in one step", () => {
	it("refuses an undeclared field with the declared names, identically with and without rows", async () => {
		const q = request({ operation: "search", fields: ["bogus"] });
		const full = await ex((await setup(manifest)).port, q);
		const empty = await ex((await setup({})).port, q);
		expect([full.ok, full.error_class, full.reason]).toEqual([false, "usage", "unsupported_field"]);
		expect(full.valid).toContain("description");
		expect(full.valid).toContain("label");
		expect(full.valid).toEqual(empty.valid);
		expect(EXPLORATION_ARGUMENT_REASONS.has(full.reason ?? "")).toBe(true);
	});
	it("classifies unknown and unauthorized targets the same, and only static reasons fail loud", async () => {
		const { port } = await setup();
		const ref = await findRef(port, "a");
		const missing = await ex(port, request({ operation: "detail", ref: { ...ref, id: "zz" } }));
		expect([missing.ok, missing.error_class]).toEqual([false, "in_world"]);
		expect(EXPLORATION_ARGUMENT_REASONS.has(missing.reason ?? "")).toBe(false);
		const ok = await ex(port, request({ operation: "detail", ref }));
		expect([ok.ok, ok.error_class]).toEqual([true, undefined]);
	});
	it("rejects a cursor of the wrong shape before looking up the target", async () => {
		const { port } = await setup();
		const page = await ex(port, request({ operation: "search", text: "strasse", limit: 1 }));
		const ref = page.items[0]?.ref;
		if (!ref) throw new Error("missing ref");
		const wrong = await ex(port, {
			...request({ operation: "field", ref: { ...ref, id: "zz" }, field: "description" }),
			cursor: page.page.next_cursor,
		});
		expect(wrong.status).toBe("stale_cursor");
		expect(wrong.error_class).toBe("in_world");
	});
});

describe("Compact response: identity once, only what an agent needs", () => {
	const town = {
		place_graphs: [{ place_graph_id: "town", display_name: "Town", bundle_id: "test" }],
		place_nodes: [
			{
				node_id: "town/a",
				place_graph_id: "town",
				display_name: "Straße",
				bundle_id: "test",
			},
		],
	};
	const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
	it("keeps scoped place discovery compact and refs to kind, id and bundle", async () => {
		const { port } = await setup(town);
		const out = await ex(
			port,
			request({ operation: "search", collection: "places", text: "Straße" }),
		);
		expect(out.items).toHaveLength(1);
		expect(Object.keys(out.items[0]?.ref ?? {}).sort()).toEqual(["bundle", "id", "kind"]);
		expect(out.items[0]).not.toHaveProperty("item_key");
		expect(out.source.coverage).toBe("complete");
		expect(out.status).toBeUndefined();
		expect(out.recovery).toBeUndefined();
		// Every follow-up carries the one token, and runs as-is.
		for (const next of out.next ?? []) {
			expect(next.source_id).toBe(out.source.source_id);
			expect((await explore(port, next)).ok).toBe(true);
		}
		expect(bytes(out)).toBeLessThan(800);
	});
	it("lists only the families that are not complete, grouped with their reason", async () => {
		const { port, set, snapshot } = await setup(town);
		set({
			...snapshot,
			source: {
				...snapshot.source,
				coverage: snapshot.source.coverage.map((x) =>
					x.family === "niche_definitions" || x.family === "object_state_definitions"
						? { ...x, state: "unsupported", reason: "no_live_projection" }
						: x,
				),
			},
		});
		const out = await ex(port, request({ operation: "search", collection: "definitions" }));
		expect(out.source.coverage).toEqual([
			{
				state: "unsupported",
				reason: "no_live_projection",
				families: ["niche_definitions", "object_state_definitions"],
			},
		]);
	});
	it("refuses a ref without the source it came from, and a source that has moved", async () => {
		const { port } = await setup(town);
		const ref = await findRef(port, "town/a");
		const bare = await explore(port, request({ operation: "detail", ref }));
		expect([bare.ok, bare.reason, bare.error_class]).toEqual([false, "missing_source_id", "usage"]);
		expect(EXPLORATION_ARGUMENT_REASONS.has(bare.reason ?? "")).toBe(true);
		const other = await explore(
			port,
			request({ operation: "detail", ref, source_id: "0123456789abcdef" }),
		);
		expect([other.reason, other.error_class]).toEqual(["reference_source_changed", "in_world"]);
	});
	it("names a recovery route when the reader is unavailable", async () => {
		const q = request({ operation: "search", text: "x" });
		const down = await explore(
			{
				snapshot: async () => {
					throw new Error("reader_unavailable");
				},
			},
			q,
		);
		expect([down.ok, down.reason, down.error_class]).toEqual([
			false,
			"reader_unavailable",
			"infra",
		]);
		expect(down.recovery).toEqual([{ tool: "spellkave_query", params: { explore: q } }]);
		expect(down.source.coverage).toEqual([
			{ state: "disconnected", reason: "reader_unavailable", families: ["exploration"] },
		]);
		expect((await explore(undefined, q)).recovery).toHaveLength(1);
	});
	it("says why a file source cannot be read, and never retries it", async () => {
		const q = request({ operation: "search", source: "local", text: "x" });
		const bad = await explore(
			{
				snapshot: async () => {
					throw new ExplorationSourceError(
						"manifest root missing '/a/srd/manifest.toml'.\n  at deep",
						"Pass --fixtures-root <dir>.",
					);
				},
			},
			q,
		);
		expect([bad.ok, bad.status, bad.reason, bad.error_class]).toEqual([
			false,
			"unavailable",
			"source_unreadable",
			"usage",
		]);
		expect(bad.cause).toBe("manifest root missing '/a/srd/manifest.toml'. at deep");
		expect(bad.hint).toBe("Pass --fixtures-root <dir>.");
		expect(bad.recovery).toBeUndefined();
		// Live reasons stay fixed: a typed error from a live port never reaches the answer.
		const live = await explore(
			{
				snapshot: async () => {
					throw new ExplorationSourceError("secret hidden row text", "x");
				},
			},
			request({ operation: "search", source: "live", text: "x" }),
		);
		expect([live.reason, live.error_class, live.cause, live.hint]).toEqual([
			"reader_unavailable",
			"infra",
			undefined,
			undefined,
		]);
		expect(JSON.stringify(live)).not.toContain("secret");
	});
	it("keeps a cursor free of item-key padding and refuses a foreign one", async () => {
		const { port } = await setup(manifest);
		const first = await ex(port, request({ operation: "search", text: "strasse", limit: 1 }));
		const cursor = first.page.next_cursor ?? "";
		const decoded = JSON.parse(atob(cursor));
		expect(decoded.c.k).toEqual(["1.1", "places", "place_nodes", "test", "a"]);
		const alien = await setup(manifest);
		alien.set({ ...alien.snapshot, source: { ...alien.snapshot.source, connection_epoch: "x" } });
		expect(
			(
				await explore(
					alien.port,
					request({ operation: "search", text: "strasse", limit: 1, cursor }),
				)
			).status,
		).toBe("stale_cursor");
	});
});

describe("Ranking, default page and relevant coverage", () => {
	const node = (id: string, name: string, description = "") => ({
		node_id: id,
		place_graph_id: "g",
		display_name: name,
		description,
		bundle_id: "test",
	});
	const bars = {
		place_graphs: [{ place_graph_id: "g", display_name: "Town", bundle_id: "test" }],
		place_nodes: [
			node("n7", "Zeta", "a bar stool"),
			node("n6", "Crowbar"),
			node("n5", "Bartender Row"),
			node("n4", "Cellar", "behind the BAR"),
			node("n3", "Old Bar"),
			node("n2", "Barrel Hall"),
			node("n1", "BAR"),
		],
	};
	const labels = (out: Awaited<ReturnType<typeof explore>>) => out.items.map((x) => x.label);
	it("orders by label tier, then by the stable item key", async () => {
		const { port } = await setup(bars);
		const out = await ex(port, request({ operation: "search", text: "bar", limit: 20 }));
		expect(labels(out)).toEqual([
			"BAR", // 1: equals (case-folded)
			"Barrel Hall", // 2: starts with, by key n2 before n5
			"Bartender Row",
			"Old Bar", // 3: contains, by key n3 before n6
			"Crowbar",
			"Cellar", // 4: only the description contains it, by key n4 before n7
			"Zeta",
		]);
	});
	it("keeps the order by key without a text", async () => {
		const { port } = await setup(bars);
		const out = await ex(port, request({ operation: "search", kind: "place_nodes", limit: 20 }));
		expect(out.items.map((x) => x.ref.id)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6", "n7"]);
	});
	it("returns five by default with the total and a wider follow-up", async () => {
		const { port } = await setup(bars);
		const out = await ex(port, request({ operation: "search", text: "bar" }));
		expect(out.items).toHaveLength(5);
		expect(out.page.total).toEqual({ count: 7 });
		expect(out.page.complete).toBe(false);
		const wide = (out.next ?? []).find((x) => x.limit === 20);
		expect(wide).toMatchObject({ operation: "search", text: "bar", limit: 20 });
		expect(wide?.cursor).toBeUndefined();
		expect(labels(await explore(port, wide as ExploreRequest))).toHaveLength(7);
		// An explicit page of 20 or more has nothing wider to offer.
		const explicit = await ex(port, request({ operation: "search", text: "bar", limit: 6 }));
		expect((explicit.next ?? []).filter((x) => x.limit === 20)).toHaveLength(1);
		const all = await ex(port, request({ operation: "search", text: "bar", limit: 20 }));
		expect(all.next ?? []).toEqual([]);
	});
	it("pages stably across tiers and rejects a cursor for another text", async () => {
		const { port } = await setup(bars);
		const q = request({ operation: "search", text: "bar", limit: 3 });
		const seen: unknown[] = [];
		let cursor: string | undefined;
		for (let i = 0; i < 5; i++) {
			const page = await ex(port, { ...q, cursor });
			expect(page.ok).toBe(true);
			seen.push(...labels(page));
			cursor = page.page.next_cursor;
			if (!cursor) break;
		}
		expect(seen).toEqual([
			"BAR",
			"Barrel Hall",
			"Bartender Row",
			"Old Bar",
			"Crowbar",
			"Cellar",
			"Zeta",
		]);
		const first = await ex(port, q);
		const stale = await ex(port, { ...q, text: "barrel", cursor: first.page.next_cursor });
		expect([stale.ok, stale.status, stale.reason]).toEqual([
			false,
			"stale_cursor",
			"snapshot_or_request_changed",
		]);
	});
	it("refuses a cursor of the old key shape instead of answering an empty page", async () => {
		const { port } = await setup(bars);
		const q = request({ operation: "search", text: "bar", limit: 3 });
		const first = await ex(port, q);
		const decoded = JSON.parse(atob(first.page.next_cursor ?? ""));
		// Version 1 keys had no leading tier slot.
		const old = btoa(JSON.stringify({ ...decoded, v: 1, c: { t: "i", k: decoded.c.k.slice(1) } }));
		const out = await ex(port, { ...q, cursor: old });
		expect([out.ok, out.status, out.reason]).toEqual([
			false,
			"stale_cursor",
			"snapshot_or_request_changed",
		]);
	});
	it("derives the tiers from visible rows only", async () => {
		// A hidden row (absent from the snapshot) can neither match nor change another row's tier.
		const { port } = await setup({
			...bars,
			place_nodes: bars.place_nodes.filter((n) => n.node_id !== "n1"),
		});
		const out = await ex(port, request({ operation: "search", text: "bar", limit: 20 }));
		expect(labels(out)[0]).toBe("Barrel Hall");
		expect(out.page.total).toEqual({ count: 6 });
	});
	describe("coverage that affects the result", () => {
		const incompleteDefinitions = async () => {
			const { port, set, snapshot } = await setup({
				...bars,
				entity_definitions: [{ entity_def_id: "chest", bundle_id: "test", display_name: "Chest" }],
			});
			set({
				...snapshot,
				source: {
					...snapshot.source,
					coverage: snapshot.source.coverage.map((x) =>
						x.family === "entity_definitions"
							? { ...x, state: "incomplete", reason: "examined_row_bound" }
							: x,
					),
				},
			});
			return port;
		};
		it("stays complete and silent for a place search", async () => {
			const out = await ex(
				await incompleteDefinitions(),
				request({ operation: "search", collection: "places", text: "bar" }),
			);
			expect(out.completeness).toBe("complete");
			expect(out.source.coverage).toBe("complete");
			expect(out.recovery).toBeUndefined();
			expect(out.page.total).toEqual({ count: 7 });
		});
		it("is incomplete with the reason for a definition search", async () => {
			const out = await ex(
				await incompleteDefinitions(),
				request({ operation: "search", collection: "definitions", text: "chest" }),
			);
			expect(out.completeness).toBe("incomplete");
			expect(out.source.coverage).toEqual([
				{ state: "incomplete", reason: "examined_row_bound", families: ["entity_definitions"] },
			]);
			expect(out.page.total).toBeUndefined();
		});
	});
});
