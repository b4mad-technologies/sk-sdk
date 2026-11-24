// `spellkave_map` and `sk map` turn a world's place rows into one view: an SVG,
// a terminal map (UTF-8, ASCII, braille), a text inventory and a PNG. The view
// must be deterministic and draw only what the rows say: floors, filters,
// extents, backdrops and session grids composed over their parent. Pure
// functions over tool-shaped rows; resvg for the PNG case.
// keep-file(K1): rule space of the pure rows-to-view renderer; the CLI renders no map
import { describe, expect, it } from "vitest";
import { rasterizeSvgToPng } from "../../node/rasterize.ts";
import {
	buildSpatialGraphModel,
	buildSpatialGraphView,
	chooseScaleBar,
	countMapPlaces,
	formatMetresLabel,
	layoutSpatialGraph,
	renderSpatialGraphSvg,
	renderSpatialGraphTextInventory,
	sharedMetresPerGraphUnit,
	svgEdgePairs,
	svgNodeIds,
} from "../index.ts";
import type { SpatialGraphBackdrop } from "../types.ts";

const sampleRows = {
	place_graphs: [
		{
			place_graph_id: "demo/graph",
			anchor_node_id: "demo/graph/a",
			display_name: "Demo",
			metres_per_unit: 1,
			substrate_id: "outdoor",
		},
	],
	place_nodes: [
		{
			node_id: "demo/graph/a",
			place_graph_id: "demo/graph",
			display_name: "Alpha",
			substrate_id: "outdoor",
			pos_present: true,
			pos_x: 0,
			pos_y: 0,
		},
		{
			node_id: "demo/graph/b",
			place_graph_id: "demo/graph",
			display_name: "Bravo",
			substrate_id: "outdoor",
			pos_present: true,
			pos_x: 10,
			pos_y: 0,
		},
		{
			node_id: "demo/graph/c",
			place_graph_id: "demo/graph",
			display_name: "Charlie",
			substrate_id: "outdoor",
			pos_present: true,
			pos_x: 20,
			pos_y: 5,
		},
	],
	place_edges: [
		{
			from_node_id: "demo/graph/a",
			to_node_id: "demo/graph/b",
			place_graph_id: "demo/graph",
		},
		{
			from_node_id: "demo/graph/b",
			to_node_id: "demo/graph/c",
			place_graph_id: "demo/graph",
		},
	],
	actor_spatial_locations: [{ place_node_id: "demo/graph/b", entity_key: "demo/actor/1" }],
};

describe("spatial-graph pure view", () => {
	it("builds model from tool-shaped rows with occupancy", () => {
		const model = buildSpatialGraphModel(sampleRows);
		expect(model.nodes.map((n) => n.id).sort()).toEqual([
			"demo/graph/a",
			"demo/graph/b",
			"demo/graph/c",
		]);
		expect(model.edges).toHaveLength(2);
		expect(model.actorClusters).toEqual([{ placeNodeId: "demo/graph/b", count: 1 }]);
		expect(model.root).toBe("demo/graph/a");
		expect(model.unreachable).toEqual([]);
	});

	it("layout is deterministic and preserves relative order", () => {
		const model = buildSpatialGraphModel(sampleRows);
		const a = layoutSpatialGraph(model);
		const b = layoutSpatialGraph(model);
		expect(a.nodes.map((n) => [n.id, n.x, n.y])).toEqual(b.nodes.map((n) => [n.id, n.x, n.y]));
		const ax = a.nodes.find((n) => n.id === "demo/graph/a")!;
		const bx = a.nodes.find((n) => n.id === "demo/graph/b")!;
		expect(bx.x).toBeGreaterThan(ax.x);
	});

	it("SVG is canonical and stamps node/edge membership", () => {
		const view = buildSpatialGraphView(sampleRows);
		expect(view.hasLayout).toBe(true);
		expect(view.svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
		expect(svgNodeIds(view.svg!)).toEqual(["demo/graph/a", "demo/graph/b", "demo/graph/c"]);
		expect(svgEdgePairs(view.svg!)).toEqual([
			"demo/graph/a|demo/graph/b",
			"demo/graph/b|demo/graph/c",
		]);
		const again = renderSpatialGraphSvg(view.model, layoutSpatialGraph(view.model), {
			sliceCaption: view.model.sliceLabel,
		});
		expect(again).toBe(view.svg);
	});

	it("filters by graphId", () => {
		const multi = {
			place_nodes: [
				...sampleRows.place_nodes,
				{
					node_id: "other/z",
					place_graph_id: "other",
					substrate_id: "outdoor",
					pos_present: true,
					pos_x: 0,
					pos_y: 0,
				},
			],
			place_edges: sampleRows.place_edges,
			place_graphs: sampleRows.place_graphs,
		};
		const view = buildSpatialGraphView(multi, { graphId: "demo/graph" });
		expect(svgNodeIds(view.svg!)).toEqual(["demo/graph/a", "demo/graph/b", "demo/graph/c"]);
	});

	it("empty / no-position graphs return inventory without inventing layout", () => {
		const empty = buildSpatialGraphView({ place_nodes: [] });
		expect(empty.hasLayout).toBe(false);
		expect(empty.svg).toBeNull();
		expect(empty.inventory).toMatch(/empty/i);

		const noPos = buildSpatialGraphView({
			place_nodes: [
				{
					node_id: "indoor/a",
					place_graph_id: "indoor",
					substrate_id: "indoor",
					pos_present: false,
				},
			],
		});
		expect(noPos.hasLayout).toBe(false);
		expect(noPos.svg).toBeNull();
	});

	it("graph-scoped view draws indoor metric plans; unfiltered still outdoor-only", () => {
		const rows = {
			place_nodes: [
				{
					node_id: "cottage/hall",
					place_graph_id: "cottage",
					substrate_id: "indoor",
					display_name: "Hall",
					pos_present: true,
					pos_x: 0,
					pos_y: 0,
				},
				{
					node_id: "cottage/kitchen",
					place_graph_id: "cottage",
					substrate_id: "indoor",
					display_name: "Kitchen",
					pos_present: true,
					pos_x: 4,
					pos_y: 0,
				},
			],
			place_edges: [
				{
					from_node_id: "cottage/hall",
					to_node_id: "cottage/kitchen",
					place_graph_id: "cottage",
				},
			],
		};
		const world = buildSpatialGraphView(rows);
		expect(world.hasLayout).toBe(false);
		const plan = buildSpatialGraphView(rows, { graphId: "cottage" });
		expect(plan.hasLayout).toBe(true);
		expect(svgNodeIds(plan.svg!)).toEqual(["cottage/hall", "cottage/kitchen"]);
	});

	it("elevation_band hides other floors; all_floors_offset panels both", () => {
		const rows = {
			place_graphs: [
				{
					place_graph_id: "inn",
					substrate_id: "indoor",
					metres_per_unit: 1,
					anchor_node_id: "inn/bar",
				},
			],
			place_nodes: [
				{
					node_id: "inn/bar",
					place_graph_id: "inn",
					substrate_id: "indoor",
					display_name: "Bar",
					pos_present: true,
					pos_x: 0,
					pos_y: 0,
					pose_elevation: 0,
					pose_elevation_present: true,
				},
				{
					node_id: "inn/cellar",
					place_graph_id: "inn",
					substrate_id: "indoor",
					display_name: "Cellar",
					pos_present: true,
					pos_x: 0,
					pos_y: 0,
					pose_elevation: -3,
					pose_elevation_present: true,
				},
			],
			place_edges: [{ from_node_id: "inn/bar", to_node_id: "inn/cellar", place_graph_id: "inn" }],
		};
		const ground = buildSpatialGraphView(rows, {
			graphId: "inn",
			slice: "elevation_band",
			z: 0,
		});
		expect(ground.model.nodes.map((n) => n.id)).toEqual(["inn/bar"]);
		expect(ground.hasLayout).toBe(true);

		const both = buildSpatialGraphView(rows, {
			graphId: "inn",
			slice: "all_floors_offset",
		});
		expect(both.model.nodes.map((n) => n.id).sort()).toEqual(["inn/bar", "inn/cellar"]);
		expect(both.svg).toContain("floor-panel");
		expect(both.inventory).toMatch(/Floors/);
	});

	it("wraps a node label's floor suffix in tspan.label-floor so a host can hide it (sk-jay0.4.21)", () => {
		const node = (id: string, name: string, x: number, z: number) => ({
			node_id: id,
			place_graph_id: "inn",
			substrate_id: "indoor",
			display_name: name,
			pos_present: true,
			pos_x: x,
			pos_y: 0,
			pose_elevation: z,
			pose_elevation_present: true,
		});
		const rows = {
			place_graphs: [
				{
					place_graph_id: "inn",
					substrate_id: "indoor",
					metres_per_unit: 1,
					anchor_node_id: "inn/bar",
				},
			],
			place_nodes: [
				node("inn/bar", "Bar", 0, 0),
				node("inn/cellar", "Cellar", 0, -3),
				node("inn/stores", "Salt & Stores", 4, -3),
			],
			place_edges: [
				{ from_node_id: "inn/cellar", to_node_id: "inn/stores", place_graph_id: "inn" },
			],
		};
		const labels = (svg: string) =>
			[...svg.matchAll(/<text [^>]*class="label[^"]*">(.*?)<\/text>/g)].map((m) => m[1]);

		const below = buildSpatialGraphView(rows, { graphId: "inn", slice: "elevation_band", z: -3 });
		// The plain name is the text node; the floor rides its own element, so a
		// host hides it by class instead of parsing the label. textContent (and
		// the raster an agent reads) still spell "Cellar (z=-3)".
		expect(labels(below.svg!)).toEqual([
			'Cellar <tspan class="label-floor">(z=-3)</tspan>',
			'Salt &amp; Stores <tspan class="label-floor">(z=-3)</tspan>',
		]);

		const ground = buildSpatialGraphView(rows, { graphId: "inn", slice: "elevation_band", z: 0 });
		expect(labels(ground.svg!)).toEqual(["Bar"]);
		expect(ground.svg).not.toContain("label-floor");

		// Floor panels already title each floor, so their node labels stay plain.
		const panels = buildSpatialGraphView(rows, { graphId: "inn", slice: "all_floors_offset" });
		expect(labels(panels.svg!).sort()).toEqual(["Bar", "Cellar", "Salt &amp; Stores"]);
		expect(panels.svg).not.toContain("label-floor");
	});

	it("topology_only places unpositioned graphs by adjacency", () => {
		const rows = {
			place_nodes: [
				{ node_id: "d/a", place_graph_id: "d", substrate_id: "indoor", display_name: "A" },
				{ node_id: "d/b", place_graph_id: "d", substrate_id: "indoor", display_name: "B" },
				{ node_id: "d/c", place_graph_id: "d", substrate_id: "indoor", display_name: "C" },
			],
			place_edges: [
				{ from_node_id: "d/a", to_node_id: "d/b", place_graph_id: "d" },
				{ from_node_id: "d/b", to_node_id: "d/c", place_graph_id: "d" },
			],
		};
		const view = buildSpatialGraphView(rows, { graphId: "d", slice: "topology_only" });
		expect(view.hasLayout).toBe(true);
		expect(svgNodeIds(view.svg!).sort()).toEqual(["d/a", "d/b", "d/c"]);
		expect(view.inventory).toMatch(/topology_only/);
	});

	it("structure lod omits occupancy badges on nodes", () => {
		const view = buildSpatialGraphView(sampleRows, { lod: "structure" });
		// Legend keeps one symbolic .actor; furnished adds a badge on the occupied node.
		const actorMarks = (svg: string) => (svg.match(/class="actor"/g) ?? []).length;
		expect(actorMarks(view.svg!)).toBe(1);
		const furnished = buildSpatialGraphView(sampleRows, { lod: "furnished" });
		expect(actorMarks(furnished.svg!)).toBe(2);
	});

	it("text inventory lists each named connection once as inline adjacency", () => {
		const model = buildSpatialGraphModel(sampleRows);
		const text = renderSpatialGraphTextInventory(model);
		expect(text).toContain("demo/graph/a");
		expect(text).toContain("adjacent=[demo/graph/b]");
		expect(text).toMatch(/NODES/);
		expect(text).not.toMatch(/^EDGES$/m);
		expect(text).not.toMatch(/^ADJACENCY$/m);
	});

	it("utf-8 / ascii terminal maps draw markers and edge strokes", () => {
		const utf8 = buildSpatialGraphView(sampleRows, {
			terminal: "utf8",
			width: 40,
			height: 16,
			color: false,
		});
		expect(utf8.hasLayout).toBe(true);
		expect(utf8.utf8).toMatch(/Spatial map \(utf-8\)/);
		expect(utf8.utf8).toMatch(/[○●]/);
		// Optional ANSI when color enabled.
		const colored = buildSpatialGraphView(sampleRows, {
			terminal: "utf8",
			width: 40,
			height: 12,
			color: true,
		});
		expect(colored.utf8?.includes(`[`)).toBe(true);
		const ascii = buildSpatialGraphView(sampleRows, { terminal: "ascii", width: 40, height: 16 });
		expect(ascii.ascii).toMatch(/Spatial map \(ascii\)/);
		expect(ascii.ascii).toMatch(/[o@]/);
	});

	// keep(K5): pins the termdot braille encoding, a library the suite does not drive
	it("braille map uses termdot dense dots", () => {
		const view = buildSpatialGraphView(sampleRows, { terminal: "braille", width: 40, height: 14 });
		expect(view.hasLayout).toBe(true);
		expect(view.braille).toMatch(/braille\/termdot/);
		// Braille block range U+2800–U+28FF appears in the body.
		expect(view.braille).toMatch(/[\u2800-\u28FF]/);
	});

	// keep(K5): pins resvg rasterising our SVG, a library the suite does not drive
	it("rasterizes SVG to PNG", async () => {
		const model = buildSpatialGraphModel(sampleRows);
		const layout = layoutSpatialGraph(model);
		const svg = renderSpatialGraphSvg(model, layout);
		const { png } = await rasterizeSvgToPng(svg);
		expect(png.byteLength).toBeGreaterThan(100);
		expect(png[0]).toBe(0x89);
	});

	it("reads place_graph.metres_per_unit (default 1) into model.graphs", () => {
		const model = buildSpatialGraphModel(sampleRows);
		expect(model.graphs).toEqual([
			{
				graphId: "demo/graph",
				metresPerUnit: 1,
				substrateId: "outdoor",
				displayName: "Demo",
				parentGraphId: "",
				originCellRes10Hex: null,
				bearing: 0,
				anchorNodeId: "demo/graph/a",
			},
		]);
	});

	it("SVG chrome includes scale bar + mini symbol legend", () => {
		const view = buildSpatialGraphView({
			place_graphs: [{ place_graph_id: "g", metres_per_unit: 1, substrate_id: "outdoor" }],
			place_nodes: [
				{
					node_id: "g/a",
					place_graph_id: "g",
					substrate_id: "outdoor",
					display_name: "A",
					pos_present: true,
					pos_x: 0,
					pos_y: 0,
				},
				{
					node_id: "g/b",
					place_graph_id: "g",
					substrate_id: "outdoor",
					display_name: "B",
					pos_present: true,
					pos_x: 1,
					pos_y: 0,
				},
			],
			place_edges: [{ from_node_id: "g/a", to_node_id: "g/b", place_graph_id: "g" }],
		});
		expect(view.svg).toContain('data-chrome="legend"');
		expect(view.svg).toContain("symbol-legend");
		expect(view.svg).toContain(">place</text>");
		expect(view.inventory).toMatch(/1 graph unit = 1 m/);
		expect(view.inventory).toMatch(/Δx 1 m/);
	});

	it("chooseScaleBar uses cartographic nice lengths", () => {
		const bar = chooseScaleBar(100, 1, { targetPx: 100, maxPx: 200 });
		expect(bar).not.toBeNull();
		expect(bar!.metres).toBe(1);
		expect(formatMetresLabel(1)).toBe("1 m");
		expect(sharedMetresPerGraphUnit([{ metresPerUnit: 1 }, { metresPerUnit: 1 }])).toBe(1);
		expect(sharedMetresPerGraphUnit([{ metresPerUnit: 1 }, { metresPerUnit: 2 }])).toBeNull();
	});
});

// backdrop masking (RenderSvgOptions.maskBackdropToNodes, render-svg.ts) —
// written and tested, but NOT enabled by any caller today. AUTHOR's
// `spellkave_map_graph` never sets the flag, so its SVG must stay byte-
// identical to before this option existed; `spellkave_map` (PLAYER
// tool) also does not set it — the backdrop renders in full/unmasked per
// operator decision 2026-08-12. Turning this on is tracked as bead sk-ubx;
// this describe block is that work's proof-of-concept, kept green.
describe("backdrop masking (maskBackdropToNodes)", () => {
	const demoBackdrop: SpatialGraphBackdrop = {
		graph_id: "demo/graph",
		scene: "Demo backdrop",
		module: "test",
		asset: "file:///demo-backdrop.png",
		width_cells: 30,
		height_cells: 20,
		image_origin_cells: [-5, -5],
		image_bounds_cells: [
			[-5, -5],
			[-5, 15],
			[25, 15],
			[25, -5],
		],
		rotation_deg: 0,
		state: "aligned",
	};

	function graphScopedSvg(maskBackdropToNodes?: boolean): string {
		const model = buildSpatialGraphModel(sampleRows, { graphId: "demo/graph" });
		const layout = layoutSpatialGraph(model, { graphId: "demo/graph" });
		return renderSpatialGraphSvg(model, layout, {
			backdrops: [demoBackdrop],
			backdropHref: (b) => b.asset,
			...(maskBackdropToNodes === undefined ? {} : { maskBackdropToNodes }),
		});
	}

	it("flag omitted (every real caller today) draws the backdrop unclipped — no <mask>, no mask= attribute", () => {
		const svg = graphScopedSvg();
		expect(svg).toContain('<image href="file:///demo-backdrop.png"');
		expect(svg).not.toContain("<mask");
		expect(svg).not.toContain('mask="url(#');
	});

	it("maskBackdropToNodes: false renders byte-identical to the flag omitted entirely", () => {
		expect(graphScopedSvg(false)).toBe(graphScopedSvg());
	});

	it("flag true clips the backdrop to a <mask> with one reveal circle per drawn node", () => {
		const svg = graphScopedSvg(true);
		expect(svg).toContain('<mask id="backdrop-known-mask"');
		// The <image> element carries the mask reference.
		expect(svg).toMatch(
			/<image href="file:\/\/\/demo-backdrop\.png"[^>]*mask="url\(#backdrop-known-mask\)"/,
		);
		// One reveal circle per node in the (3-node) demo graph, inside the mask.
		const maskBlock = svg.slice(svg.indexOf("<mask "), svg.indexOf("</mask>"));
		const circleCount = [...maskBlock.matchAll(/<circle /g)].length;
		expect(circleCount).toBe(3);
		// Opaque black backdrop the reveal circles cut through.
		expect(maskBlock).toContain('fill="#000"');
	});

	it("a node's authored cube extent masks with a square instead of collapsing to a circle", () => {
		// Extent params are METRES and HALF-extents; the demo graph authors no
		// metres_per_unit, so the model's fallback of 1 m/unit makes this
		// extent_m=8 cube a 16-unit footprint — the direct successor of the
		// old size_w=8 cell stub.
		const wideRows = {
			...sampleRows,
			place_nodes: sampleRows.place_nodes.map((n, i) =>
				i === 0
					? { ...n, extent_shape_id: "core/area/cube", extent_params_json: '{"extent_m": 8}' }
					: n,
			),
		};
		const model = buildSpatialGraphModel(wideRows, { graphId: "demo/graph" });
		const layout = layoutSpatialGraph(model, { graphId: "demo/graph" });
		const svg = renderSpatialGraphSvg(model, layout, {
			backdrops: [demoBackdrop],
			backdropHref: (b) => b.asset,
			maskBackdropToNodes: true,
		});
		const maskBlock = svg.slice(svg.indexOf("<mask "), svg.indexOf("</mask>"));
		const extentRect =
			/<rect x="[^"]+" y="[^"]+" width="([\d.]+)" height="([\d.]+)" fill="#fff"/.exec(maskBlock);
		expect(extentRect).not.toBeNull();
		expect(Number(extentRect![1])).toBe(Number(extentRect![2]));
		// The other two unauthored nodes retain the circular fallback reveal.
		expect([...maskBlock.matchAll(/<circle /g)]).toHaveLength(2);
	});
});

describe("explicit node extent marks (sk-evp)", () => {
	it("draws sphere as a circle and cube as a square at metric scale", () => {
		const rows = {
			...sampleRows,
			place_nodes: sampleRows.place_nodes.map((node, index) =>
				index === 0
					? {
							...node,
							extent_shape_id: "core/area/sphere",
							extent_params_json: '{"radius_m":2.5,"radius_z_m":1.5}',
						}
					: index === 1
						? {
								...node,
								extent_shape_id: "core/area/cube",
								extent_params_json: '{"extent_m":3,"extent_z_m":1.5}',
							}
						: node,
			),
		};
		const model = buildSpatialGraphModel(rows, { graphId: "demo/graph" });
		expect(model.nodes[0]!.extent).toMatchObject({
			shapeId: "core/area/sphere",
			widthUnits: 5,
			heightUnits: 5,
			depthMetres: 3,
		});
		expect(model.nodes[1]!.extent).toMatchObject({
			shapeId: "core/area/cube",
			widthUnits: 6,
			heightUnits: 6,
		});
		const svg = renderSpatialGraphSvg(model, layoutSpatialGraph(model, { graphId: "demo/graph" }), {
			showExtentDepth: true,
		});
		expect(svg).toMatch(/data-node-id="demo\/graph\/a"><circle[^>]+class="place-extent"/);
		expect(svg).toMatch(/data-node-id="demo\/graph\/b"><rect[^>]+class="place-extent"/);
		expect(svg).toContain("footprints ↕ 3 m");
		expect(svg).not.toContain('class="extent-depth">');
	});

	it("preserves independent planar axes for the anticipated sk-6rm params", () => {
		const rows = {
			...sampleRows,
			place_nodes: [
				{
					...sampleRows.place_nodes[0],
					extent_shape_id: "core/area/cube",
					extent_params_json: '{"extent_m":9,"extent_x_m":4,"extent_y_m":2}',
				},
			],
		};
		const model = buildSpatialGraphModel(rows, { graphId: "demo/graph" });
		expect(model.nodes[0]!.extent).toMatchObject({ widthUnits: 8, heightUnits: 4 });
		const svg = renderSpatialGraphSvg(model, layoutSpatialGraph(model, { graphId: "demo/graph" }));
		const rect = /class="place-extent"/.test(svg);
		expect(rect).toBe(true);
	});

	it("uses backdrop cell scale for extents when outdoor composition has a different graph scale", () => {
		const rows = {
			...sampleRows,
			place_graphs: sampleRows.place_graphs.map((graph) => ({ ...graph, metres_per_unit: 12 })),
			map_layers: [{ place_graph_id: "demo/graph", grid_distance_m: 1.5 }],
			place_nodes: [
				{
					...sampleRows.place_nodes[0],
					extent_shape_id: "core/area/cube",
					extent_params_json: '{"extent_m":3,"extent_x_m":3,"extent_y_m":1.5}',
				},
			],
		};
		const model = buildSpatialGraphModel(rows, { graphId: "demo/graph" });
		expect(model.nodes[0]?.extent).toMatchObject({ widthUnits: 4, heightUnits: 2 });
	});
});

// sk-pej D-2: an ephemeral session tactical grid composes over its parent
// location's own topology (and backdrop) by default. Gated strictly on
// is_ephemeral_instance — NOT merely a non-empty parent_graph_id — so
// elven-mini's already-live nested composition (tomb/inn under hamlet,
// is_ephemeral_instance=false) never moves; see compose.ts's
// isEphemeralInstanceGraph doc.
describe("session-grid composition over parent (sk-pej D-2)", () => {
	// Mirrors what materialise_tactical_grid actually authors
	// (r_session_open.rs, tactical_grid.rs): a 3x3 grid, local cell ids
	// c_<x>_<y>, pos_x/pos_y = the bare cell index (0..2), pose_elevation
	// hardcoded to 0/present regardless of the parent's own floor. The
	// parent (dungeon/crypt) sits at elevation -1 (a basement) specifically
	// to exercise the "adopt the anchor's elevation" fix.
	const gridCellRows = [0, 1, 2].flatMap((y) =>
		[0, 1, 2].map((x) => ({
			node_id: `session_grid_9/c_${x}_${y}`,
			place_graph_id: "session_grid_9",
			display_name: `Cell ${x},${y}`,
			substrate_id: "tactical",
			pos_present: true,
			pos_x: x,
			pos_y: y,
			pose_elevation: 0,
			pose_elevation_present: true,
		})),
	);
	const cryptRows = {
		place_graphs: [
			{
				place_graph_id: "dungeon/crypt",
				display_name: "Crypt",
				substrate_id: "indoor",
				metres_per_unit: 5,
				anchor_node_id: "dungeon/crypt/center",
			},
			{
				place_graph_id: "session_grid_9",
				display_name: "Session 9 tactical grid",
				substrate_id: "tactical",
				metres_per_unit: 5,
				bearing: 0,
				parent_graph_id: "dungeon/crypt",
				anchor_node_id: "dungeon/crypt/center",
				is_ephemeral_instance: true,
			},
		],
		place_nodes: [
			{
				node_id: "dungeon/crypt/center",
				place_graph_id: "dungeon/crypt",
				display_name: "Center",
				substrate_id: "indoor",
				pos_present: true,
				pos_x: 10,
				pos_y: 10,
				pose_elevation: -1,
				pose_elevation_present: true,
			},
			{
				node_id: "dungeon/crypt/altar",
				place_graph_id: "dungeon/crypt",
				display_name: "Altar",
				substrate_id: "indoor",
				pos_present: true,
				pos_x: 14,
				pos_y: 10,
				pose_elevation: -1,
				pose_elevation_present: true,
			},
			{
				node_id: "dungeon/crypt/pool",
				place_graph_id: "dungeon/crypt",
				display_name: "Acid Pool",
				substrate_id: "indoor",
				pos_present: true,
				pos_x: 9,
				pos_y: 9,
				pose_elevation: -1,
				pose_elevation_present: true,
				extent_shape_id: "core/area/sphere",
				extent_params_json: '{"radius_m":5}',
			},
			...gridCellRows,
		],
		place_edges: [
			{
				from_node_id: "dungeon/crypt/center",
				to_node_id: "dungeon/crypt/altar",
				place_graph_id: "dungeon/crypt",
			},
			{
				from_node_id: "session_grid_9/c_0_0",
				to_node_id: "session_grid_9/c_1_0",
				place_graph_id: "session_grid_9",
			},
		],
	};

	it("composes the grid over its parent's topology by default — anchor-centred, matched scale", () => {
		const view = buildSpatialGraphView(cryptRows, {
			graphId: "session_grid_9",
			terminal: "ascii",
			color: false,
		});
		expect(view.hasLayout).toBe(true);
		// Both the parent's own nodes and every grid cell are drawn together.
		expect(view.model.nodes.map((n) => n.id).sort()).toEqual(
			[
				"dungeon/crypt/altar",
				"dungeon/crypt/center",
				"dungeon/crypt/pool",
				...gridCellRows.map((r) => r.node_id),
			].sort(),
		);
		// The parent's own edges are drawn; CELL-to-CELL edges are not — grid
		// cells render as battle-map squares (adjacency is the lattice
		// itself), so a route line between two cells would redraw the grid
		// as an orange mesh (operator request 2026-08-14).
		expect(svgEdgePairs(view.svg!)).toEqual(["dungeon/crypt/altar|dungeon/crypt/center"]);
		expect(view.inventory).toContain(
			"GRID session_grid_9  3x3 cells  cell=5 m  anchor=dungeon/crypt/center",
		);
		expect(view.inventory).not.toContain('session_grid_9/c_1_1  "Cell 1,1"');
		expect(view.inventory).not.toContain("session_grid_9/c_0_0—session_grid_9/c_1_0");
		expect(view.inventory).toContain("session_grid_9/c_0_0  overlaps=[dungeon/crypt/pool]");
		expect(view.inventory).not.toMatch(
			/session_grid_9\/c_\d_\d.*overlaps=\[dungeon\/crypt\/center\]/,
		);
		expect(view.inventory).not.toMatch(/session_grid_9\/c_2_2.*overlaps=/);
		expect(view.ascii).not.toContain("Cell 0,0");
		// Cells render as stroke-only grid squares, not place dots.
		expect(view.svg!).toContain('class="grid-cell"');
		// childMetresPerUnit === parentMetresPerUnit (5 === 5) => a 1:1 unit ratio; the grid's
		// own local centre (1,1) lands exactly on the anchor's raw position
		// (10, 10); the corners offset by (local - centre) in parent units.
		const byId = new Map(view.model.nodes.map((n) => [n.id, n]));
		expect([byId.get("session_grid_9/c_1_1")!.x, byId.get("session_grid_9/c_1_1")!.y]).toEqual([
			10, 10,
		]);
		expect([byId.get("session_grid_9/c_0_0")!.x, byId.get("session_grid_9/c_0_0")!.y]).toEqual([
			9, 9,
		]);
		expect([byId.get("session_grid_9/c_2_2")!.x, byId.get("session_grid_9/c_2_2")!.y]).toEqual([
			11, 11,
		]);
		// The grid's own authored pose_elevation=0 is overridden to the
		// anchor's real floor (-1) so both layers land in the same
		// elevation_band slice instead of the grid silently vanishing.
		expect(byId.get("session_grid_9/c_0_0")!.elevation).toBe(-1);
	});

	it("lists cells in a visible attachment scope without rendering its fog-filtered anchor", () => {
		const pool = cryptRows.place_nodes.find((row) => row.node_id === "dungeon/crypt/pool");
		expect(pool).toBeDefined();
		const rows = {
			...cryptRows,
			place_nodes: cryptRows.place_nodes.filter((row) => row.node_id !== "dungeon/crypt/pool"),
			notable_anchor_nodes: pool === undefined ? [] : [pool],
			visible_spatial_niche_attachments: [
				{ niche_id: "elven-mini/acid_pool", place_node_id: "dungeon/crypt/pool" },
			],
		};
		const view = buildSpatialGraphView(rows, { graphId: "session_grid_9" });
		expect(view.model.nodes.some((node) => node.id === "dungeon/crypt/pool")).toBe(false);
		expect(view.inventory).toContain(
			"session_grid_9/c_0_0  notable=[elven-mini/acid_pool@dungeon/crypt/pool]",
		);
		expect(view.inventory).not.toContain('dungeon/crypt/pool  "Acid Pool"');
	});

	it("lists one place for a large gridded room, not one row per cell (sk-zz8)", () => {
		const largeCells = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((y) =>
			[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((x) => ({
				node_id: `session_grid_100/c_${x}_${y}`,
				place_graph_id: "session_grid_100",
				display_name: `Cell ${x},${y}`,
				substrate_id: "tactical",
				pos_present: true,
				pos_x: x,
				pos_y: y,
				pose_elevation: 0,
				pose_elevation_present: true,
			})),
		);
		const rows = {
			place_graphs: [
				{
					place_graph_id: "dungeon/hall",
					display_name: "Hall",
					substrate_id: "indoor",
					metres_per_unit: 1.524,
					anchor_node_id: "dungeon/hall/floor",
				},
				{
					place_graph_id: "session_grid_100",
					display_name: "Session 100 tactical grid",
					substrate_id: "tactical",
					metres_per_unit: 1.524,
					parent_graph_id: "dungeon/hall",
					anchor_node_id: "dungeon/hall/floor",
					is_ephemeral_instance: true,
				},
			],
			place_nodes: [
				{
					node_id: "dungeon/hall/floor",
					place_graph_id: "dungeon/hall",
					display_name: "Hall Floor",
					substrate_id: "indoor",
					pos_present: true,
					pos_x: 5,
					pos_y: 5,
					pose_elevation: 0,
					pose_elevation_present: true,
				},
				...largeCells,
			],
			place_edges: [],
		};
		const view = buildSpatialGraphView(rows, { graphId: "session_grid_100" });
		expect(countMapPlaces(view.model)).toBe(1);
		expect(view.inventory).toMatch(/^Spatial inventory: 1 named places; 100-cell grid/m);
		expect(view.inventory).toContain('  dungeon/hall/floor  "Hall Floor"');
		expect(view.inventory).toContain("GRID session_grid_100  10x10 cells");
		expect(view.inventory).not.toContain('session_grid_100/c_5_5  "Cell 5,5"');
	});

	it("bare-grid drill-down still lists cell ids under one GRID place (sk-zz8)", () => {
		const view = buildSpatialGraphView(
			{
				place_graphs: cryptRows.place_graphs,
				place_nodes: gridCellRows,
				place_edges: cryptRows.place_edges,
			},
			{ graphId: "session_grid_9" },
		);
		expect(countMapPlaces(view.model)).toBe(1);
		expect(view.inventory).toMatch(/^Spatial inventory: 0 named places; 9-cell grid/m);
		expect(view.inventory).toContain("GRID session_grid_9  3x3 cells");
		expect(view.inventory).toContain("    session_grid_9/c_0_0");
		expect(view.inventory).not.toContain('session_grid_9/c_1_1  "Cell 1,1"');
	});

	it("compose_parent: false is the escape hatch — byte-identical to a grid with no resolvable parent at all", () => {
		const gridAlone = buildSpatialGraphView(
			{
				place_graphs: cryptRows.place_graphs,
				place_nodes: gridCellRows,
				place_edges: cryptRows.place_edges,
			},
			{ graphId: "session_grid_9" },
		);
		const escaped = buildSpatialGraphView(cryptRows, {
			graphId: "session_grid_9",
			composeParent: false,
		});
		expect(escaped.model.nodes.map((n) => n.id).sort()).toEqual(
			gridCellRows.map((r) => r.node_id).sort(),
		);
		expect(escaped.svg).toBe(gridAlone.svg);
	});

	it("ordinary authored nesting (parent_graph_id set, is_ephemeral_instance=false) never composes", () => {
		// Same shape as elven-mini's tomb/hamlet: a real authored composition,
		// explicitly NOT ephemeral. Must render exactly as a single graph
		// always has, with composeParent left at its new default (true).
		const rows = {
			place_graphs: [
				{
					place_graph_id: "hamlet",
					substrate_id: "outdoor",
					metres_per_unit: 1,
					is_ephemeral_instance: false,
				},
				{
					place_graph_id: "tomb",
					substrate_id: "indoor",
					metres_per_unit: 1,
					parent_graph_id: "hamlet",
					anchor_node_id: "tomb/entrance",
					is_ephemeral_instance: false,
				},
			],
			place_nodes: [
				{
					node_id: "hamlet/square",
					place_graph_id: "hamlet",
					substrate_id: "outdoor",
					pos_present: true,
					pos_x: 0,
					pos_y: 0,
				},
				{
					node_id: "tomb/entrance",
					place_graph_id: "tomb",
					substrate_id: "indoor",
					pos_present: true,
					pos_x: 4,
					pos_y: 18,
				},
			],
			place_edges: [],
		};
		const view = buildSpatialGraphView(rows, { graphId: "tomb" });
		expect(view.model.nodes.map((n) => n.id)).toEqual(["tomb/entrance"]);
	});

	it("a parent's own [[map_layers]] backdrop draws under the composed grid (layout.graphs generalises to both ids)", () => {
		const cryptBackdrop: SpatialGraphBackdrop = {
			graph_id: "dungeon/crypt",
			scene: "Crypt backdrop",
			module: "test",
			asset: "file:///crypt-backdrop.png",
			width_cells: 30,
			height_cells: 20,
			image_origin_cells: [0, 0],
			image_bounds_cells: [
				[0, 0],
				[0, 20],
				[30, 20],
				[30, 0],
			],
			rotation_deg: 0,
			state: "aligned",
		};
		const view = buildSpatialGraphView(cryptRows, {
			graphId: "session_grid_9",
			sheetAlign: true,
			backdrops: [cryptBackdrop],
			backdropHref: (b) => b.asset,
		});
		expect(view.svg).toContain('<image href="file:///crypt-backdrop.png"');
	});

	it("prefers the parent's own map_layer.grid_distance_m over a stale/unmaintained place_graph_definition.metres_per_unit", () => {
		// Same shape as the real elven-mini tomb/inn fixtures: the parent's
		// place_graph_definition.metres_per_unit is left at an unmaintained 1.0
		// while its own [[map_layers]] row declares the REAL per-cell size
		// (grid_distance_m=5ft=1.524m). The session grid's own metres_per_unit
		// is metre-native (1.524, matching the SRD's own `ft(5)` authoring
		// helper) — with the map_layer-derived conversion, childMetresPerUnit
		// (1.524 m/cell) / parentUnitMetres (1.524 m/parent-unit) = ratio 1,
		// identical numbers to the matched-scale case above.
		const rows = {
			place_graphs: [
				{
					place_graph_id: "dungeon/crypt",
					substrate_id: "indoor",
					metres_per_unit: 1, // unmaintained default, deliberately NOT 1.524
					anchor_node_id: "dungeon/crypt/center",
				},
				{
					place_graph_id: "session_grid_9",
					substrate_id: "tactical",
					metres_per_unit: 1.5240000486373901,
					bearing: 0,
					parent_graph_id: "dungeon/crypt",
					anchor_node_id: "dungeon/crypt/center",
					is_ephemeral_instance: true,
				},
			],
			place_nodes: [
				{
					node_id: "dungeon/crypt/center",
					place_graph_id: "dungeon/crypt",
					substrate_id: "indoor",
					pos_present: true,
					pos_x: 10,
					pos_y: 10,
				},
				...gridCellRows,
			],
			place_edges: [],
			map_layers: [
				{ place_graph_id: "dungeon/crypt", grid_distance_m: 1.5240000486373901 },
				// A DIFFERENT graph's row must never be picked up by mistake.
				{ place_graph_id: "some/other/graph", grid_distance_m: 999 },
			],
		};
		const withMapLayer = buildSpatialGraphModel(rows, { graphId: "session_grid_9" });
		const center = withMapLayer.nodes.find((n) => n.id === "session_grid_9/c_1_1")!;
		const corner = withMapLayer.nodes.find((n) => n.id === "session_grid_9/c_0_0")!;
		expect([center.x, center.y]).toEqual([10, 10]);
		expect(corner.x).toBeCloseTo(9, 6);
		expect(corner.y).toBeCloseTo(9, 6);

		// Without the map_layers row, the SAME rows fall back to the stale
		// metres_per_unit=1 and land at a visibly different (wrong) position — proving
		// the map_layers row is genuinely load-bearing, not a no-op.
		const { map_layers: _drop, ...rowsWithoutMapLayer } = rows;
		const withoutMapLayer = buildSpatialGraphModel(rowsWithoutMapLayer, {
			graphId: "session_grid_9",
		});
		const cornerFallback = withoutMapLayer.nodes.find((n) => n.id === "session_grid_9/c_0_0")!;
		expect(cornerFallback.x).not.toBeCloseTo(corner.x, 3);
	});
});
