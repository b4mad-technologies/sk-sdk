# OSM mapping — how authored places become a map

The world map (maps.spellkave.com, OSM API / Overpass endpoints, vector
tiles) is a **projection of the rows you author** — nothing is drawn that is
not a `place_graph`, `place_node`, `place_edge` or `map_layer` row. This
page is the author-facing half of ADR-0123 (`specifications/adr/0123-osm-projection-of-the-place-graph.md`):
what you must author for a place to show up, where it lands, and which OSM
tags an external tool (JOSM, iD, QGIS, Overpass Turbo) will see.

Visibility is **not** part of this mapping today: the map shows the full
world (operator catalog). Per-identity fog-of-war is a later bead
(`sk-adr8.15`).

## What you must author for a place to appear

| You want | Author |
|---|---|
| The bundle on the real globe | `origin_cell_res10` on every **root** graph (`parent_graph_id = ""`). Its `anchor_node_id` sits on that cell's centroid. A root without an origin cell is **unplaced** — listed in the export's `unplaced_graphs`, drawn nowhere. |
| Nodes at exact positions (a floorplan, a village sheet) | `pos_present = true`, `pos_x`/`pos_y` in sheet units (+x east, +y **south** — image rows), `metres_per_unit` on the graph, `bearing` if the sheet is not north-up. |
| A building inside a village, a dungeon under a hill | `parent_graph_id` on the child graph **and** one portal `place_edge` between a parent node and a child node. The child's portal node lands exactly on the parent's portal node; everything else follows from the child's `pos_*`. (For indoor children this is the exporter's rule — ADR-0123 D-1 case 3 — not something today's SVG renders; it ships with its own fixture.) |
| Floors | `pose_elevation_present = true`, `pose_elevation` in metres per node (0 = ground, 3 = first floor, −3 = cellar). Level index = `round(elevation / 3.0)`. |
| Room outlines | an extent on the node: `extent_shape_id = "core/area/cube"` with `extent_x_m`/`extent_y_m`, or `core/area/sphere` with `radius_x_m`/`radius_y_m` (the bundle's default extent applies when the node has none). Cone/line extents draw no outline. |
| The hand-drawn map under the nodes | a `[[map_layers]]` row with the grid metrics (`grid_size_px`, `grid_distance_m`, `image_origin_*`, `local_*_cells`, `rotation_deg`) — it becomes a georeferenced image source, not OSM data. Attribution (`posture`, `source_kind`) is exported and shown. |
| A node on the map without a sheet | outdoor substrate + `cell_res10` ≠ 0 → centroid of that H3 cell (no `pos_*` needed). |

Precedence: a metric chain (sheet positions up to an origin cell) wins over
`cell_res10` centroids; `cell_res10` wins over nothing; without either the
node is unplaced.

## Where each row lands (OSM vocabulary)

OSM knows three primitives — **node** (point), **way** (ordered node list,
closed = area) and **relation** (typed group) — plus free `key=value` tags.
Every Spellkave-specific key is prefixed `spellkave:`; everything else is a
standard OSM key. "Indoor" below means the substrate's `coordinate_kind_id`
is `graph_local` (read through `[[substrate_definitions]]`), "outdoor" means
`h3_cell` — the `substrate_id` string itself (`indoor`, `cave`, `sewer`, …)
is yours to choose and is never matched.

| Row | Becomes | Key tags |
|---|---|---|
| `place_node` | node | `name`, `description`, `ref=<local_id>`, `level=<n>` (indoor-class, when elevation authored), `spellkave:node_id`, `spellkave:graph`, `spellkave:substrate`, `spellkave:cell_res10` |
| node extent | closed way around the node | `indoor=room` (indoor) / `spellkave:extent=yes` (outdoor), `level`, `name`, `spellkave:extent_shape` |
| `place_edge` | 2-node way | `highway=corridor` (indoor) / `path` (outdoor) / `steps` (elevation delta), `oneway=yes` (edges are directed — author both directions, you get two ways), `door=yes` when `substrate_crossing`, `spellkave:edge_key`, `spellkave:portal=yes` for cross-graph edges |
| `place_graph_definition` | relation | indoor: `type=building`, `building=yes`, `min_level`, `max_level`, `building:levels`; outdoor: `type=site`; always `name`, `spellkave:graph_id`, `spellkave:parent_graph`, `spellkave:anchor_node`, `spellkave:bearing`, `spellkave:metres_per_unit` |
| `map_layer` | entry in `backdrops.json` (four lon/lat corners + url + license) | — |

Full column-by-column tables, id derivation (stable 63-bit hashes of your
ids — renaming a `node_id` changes its OSM id), and the Simple Indoor
Tagging checklist: ADR-0123 D-2/D-3/D-5.

## What is never on the map

Actors, items, niches, affordances, movement modes, knowledge. The map is
geography; live state (who stands where) arrives over a separate live
source in the maps app, and gating stays in the kernel. Session tactical
grids (`is_ephemeral`) are dropped from the export.

## Proving it

Export any adventure bundle (or a plain `rows.json` of place graph / node /
edge / map_layer rows) with the product exporter:

```bash
pnpm --filter @spellkave/world-map exec tsx src/cli.ts export <bundle> \
  --xml out.osm --json out.json --backdrops backdrops.json --manifest manifest.json
# or: just world-map-export <bundle>
```

The package is `@spellkave/world-map` (ADR-0123 D-1..D-6). Unplaced roots
(no `origin_cell_res10`) appear in `manifest.json` under `unplaced_graphs`.
Indoor nest composition (D-1 case 3) is covered by the package's kavemouth
fixture: `kavemouth/inn/foyer` lands within 2 m of `kavemouth/hamlet/inn_front`.

The **outdoor** half also still renders through `spellkave_map_graph` /
`sk render` (shared tool runtime `h3-layout.ts`); a graph that lands wrong there
will land at the same wrong spot in OSM. That SVG path deliberately omits
indoor floorplans — use `world-map export` for the full SIT building check.
