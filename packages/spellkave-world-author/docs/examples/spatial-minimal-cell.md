# Example — minimal spatial cell

The smallest workable spatial topology: one `place_graph` with one
`place_node`. The complete manifest form is
[`spatial-minimal-cell.toml`](./spatial-minimal-cell.toml); it was originally
derived from the srd bundle's spatial probe (`base/spatial.toml`), retired
with that bundle in the world-fixtures retirement (2026-08-14).

```toml
[[place_graphs]]
place_graph_id = "example_spatial_cell"
bundle_id = "example_spatial_cell"
substrate_id = "outdoor"
display_name = "Example Cell Graph"
description = "One disconnected outdoor cell."

[[place_nodes]]
node_id = "example_spatial_cell/cell_a"
bundle_id = "example_spatial_cell"
place_graph_id = "example_spatial_cell"
local_id = "cell_a"
substrate_id = "outdoor"
display_name = "Open Ground"
pose_elevation_present = true
pos_x = 0
pos_y = 0
pos_present = true
```

## What's required, what's optional

- `place_graph_id`, `bundle_id`, `substrate_id`, `display_name` — required.
- `place_node`: `node_id`, `bundle_id`, `place_graph_id`, `local_id`,
  `substrate_id`, `display_name` — required.
- `pos_x` / `pos_y` / `pos_present` — required by the validator;
  default-zero is fine for a probe.
- `extent_shape_id` / `extent_params_json` — optional authored spatial
  extent (a shape reference into `area_shape_definition`, e.g.
  `core/area/cube` with a metre-native `extent_m`); omitted here, so this
  node's extent resolves from its bundle's default extent
  (`bundles.default_extent_shape_id`) — or fails admission if the bundle
  authors none (see `dsl-grammar.md`/`manifest-format.md` for the shape
  vocabulary).
- `core/area/cube` accepts required fallback `extent_m` plus independent
  `extent_x_m`, `extent_y_m`, and `extent_z_m` half-extent overrides. The x/y
  axes are shape-local after rotation. `core/area/sphere` similarly accepts
  `radius_x_m`, `radius_y_m`, and `radius_z_m`, producing an ellipse/ellipsoid.
  Every supplied dimension must be finite and greater than zero. The z override
  participates only when both queried positions carry elevation.
- `cell_res4`, `cell_res7`, `cell_res10` — H3 cell indices. Optional;
  the SRD probe omits them. Present on `core` bundle's outdoor nodes.
- `pose_elevation_present` — required boolean; set `true` if elevation
  is meaningful.

## How to verify

Local syntactic validation:

```bash
spellkave validate docs/modding/examples/spatial-minimal-cell.toml
```

Live module application:

```bash
spellkave manifest apply docs/modding/examples/spatial-minimal-cell.toml
```

If both exit `0`, the row landed. You can confirm the place node is
observable through the public SDK with
[`readLocationSnapshot`](../../../../packages/spellkave-sdk/src/core/readers/location_snapshot.ts):

```ts
const snapshot = readLocationSnapshot(db, "example_spatial_cell/cell_a");
// → { node_id, outgoing_edges: [], actors_here: [] }
```

`outgoing_edges` is empty because this example does not author any
edges; a single-cell location is disconnected from the rest of the
world by design. To connect it, add `[[place_edges]]` rows pointing
`from_node_id` / `to_node_id` to existing nodes — see
[`../../../packages/spellkave-mechanics/fixtures/core/base/spatial.toml`](../../../../packages/spellkave-mechanics/fixtures/core/base/spatial.toml)
for the full edge contract.

## Why this scores `fits`

The spatial schema captures everything the SRD's 5-ft-grid convention
requires: a typed substrate, a discrete cell with coordinates and an
(optionally authored) spatial extent. No SRD attribute is lost on
translation; no DSL is required.
This is the only SRD probe row that translated without dropped
attributes — see
[`../../../openspec/changes/archive/2026-05-18-srd-conformance-probe/gap-matrix.md`](../../../../openspec/changes/archive/2026-05-18-srd-conformance-probe/gap-matrix.md)
for the other four probe rows (`partial` / `gap`).
