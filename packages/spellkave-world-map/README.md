# `@spellkave/world-map`

One geometry, three outputs — so a new map artefact never means touching two packages.

| Subpath | What it is |
|---|---|
| `.` | Place-graph → OSM geometry (`coords`, ids, tags, model), `exportWorld`, writers (XML / Overpass JSON / GeoJSON), `normalizeWorldOsmInput` |
| `./tiles` | MVT layer split, geojson-vt indexes, `encodeMvtTile`, TileJSON, MapLibre style, backdrop URL helpers |
| `./svg` | Spatial-graph layout + SVG / ASCII / braille / inventory (browser-safe except termdot braille) |
| `./node` | Node-only raster (no pi-tui): resvg PNG, JPEG write, backdrop file resolve, timg — safe for `pnpm deploy --prod` hosts |
| `./node/terminal` | Terminal image-protocol helpers (`ensureSpellkaveTerminalImageCapabilities`, `parseImagesModeFlag`, …) via optional peer `@earendil-works/pi-tui` — CLI/TUI only (#2468) |
| `./cli` / bins | `world-map export …` (bin `world-map`; `world-osm` kept as a one-release alias) |

## What is NOT here

**HTTP.** Routing, Bearer auth, CORS, operator cache refresh, asset/font/demo file serving stay in `@spellkave/player-mcp` (`tiles.ts`, `osm-model.ts`). The gateway imports builders from `@spellkave/world-map/tiles` and only transports bytes.

## Consumers

- `@spellkave/player-mcp` — OSM API / Overpass / MVT gateway
- `@spellkave/tool-player` — `spellkave_map` / `spellkave_map_graph` tools
- `@spellkave/cli` (`sk map-*`) — terminal + file map products
- `@spellkave/srd-cc` — kavemouth render fixtures
- `apps/maps` — MapLibre SPA (tiles via gateway; local demo may import export)

Import spatial products directly from `@spellkave/world-map/{svg,node}`. Terminal/TUI hosts that need pi-tui capability detection import `@spellkave/world-map/node/terminal` — never pull those helpers through `./node` (hosted PLAYER MCP loads `./node` under prod deploys without pi-tui).

## SVG class hooks

A host that inlines the spatial-graph SVG restyles or hides parts by class; it
does not parse label text.

- `text.label` — a place label. Its text node is the plain place name.
- `tspan.label-floor` — the floor part of that label (`(z=-3)`), a child of
  `text.label`. The separating space stays in the parent's text node, because
  resvg drops a space that leads a `tspan`. The renderer emits the element on
  an `elevation_band` or `metric` slice for a node off the ground floor; a
  floor-panel (`all_floors_offset`) or world (H3) map has none, because the
  panel title already names the floor. The drawn text, `textContent` and the
  PNG/JPG raster still read `Cellar (z=-3)`; a host that says the floor
  elsewhere hides the element (`display: none`). Pinned by
  `src/svg/__tests__/spatial-graph.test.ts`.

The markup is written where the SVG is rendered. For `spellkave_map` that is
the hosted player MCP (`@spellkave/tool-player`), a deployment separate from
the Play app that inlines the result. Play shows the plain name only once that
MCP runs a `@spellkave/world-map` with `tspan.label-floor`; against an older
one the hide rule matches nothing and the card keeps the suffix. Either order
of rollout is safe, and there is nothing to migrate or roll back: the change
is additive (same `textContent`, same raster, one more `tspan` in the raw SVG).

## CLI

```bash
pnpm --filter @spellkave/world-map exec tsx src/cli.ts export <bundle> \
  --xml out.osm --json out.json --backdrops backdrops.json --manifest manifest.json
# or: just world-map-export <bundle>
# alias: world-osm / just world-osm-export (one release)
```

## Gates

```bash
pnpm --filter @spellkave/world-map typecheck
pnpm --filter @spellkave/world-map test
pnpm --filter @spellkave/world-map test:behaviour   # behaviour/*.feature: the real CLI, offline
```
