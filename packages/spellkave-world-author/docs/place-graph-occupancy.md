# Intent — place graph + occupancy (who is where)

**Pull this doc when you need more than the tool guidelines** — gotchas,
optional third call, fixture quirks. The default path is already on the tools:

| Goal | Call |
|---|---|
| Picture + density badges + scale | `spellkave_map_graph` (`target` if needed) |
| Who sits on which node | `spellkave_query` `{ kind: "entities", fields: "preferred" }` |

Then **group** entities by `place_node_id` and match to map places. That is
usually **two calls**. Do **not** N× detail each entity.

## Optional third call

Human place labels (`Proof Cell` vs raw node ids):

```
spellkave_query { kind: "place_nodes", fields: "preferred" }
```

Skip if node ids / map inventory already suffice.

## Prerequisites

- Authored/local: `author.target` (or `spellkave_config` `author.target`) on the
  manifest or directory you care about; pass `target: "local"` when you must
  force that source.
- For `sk` local registry calls, configure `author.dependencies.<bundle-id>` with
  `sk config set --project author.dependencies.<bundle-id> <manifest-path>` when
  dependencies live in separate packages (this repository's tracked
  `.spellkave/defaults.toml` already maps `srd` and `dm`, as the lowest layer).
  `query`, `map_graph` and `explore`
  resolve these mappings through the transitive dependency closure. Project paths
  are relative to the project root; global dependency paths are relative to the
  global config directory. An explicit `--fixtures-root` overrides the mappings
  for that call with a stderr warning. The real-CLI configure-once regression is
  `packages/spellkave-cli/behaviour/exploration/configured-world.feature`.
- Live world: connect first; same tools with `target: "live"` when available.
- Empty map: configure a source — map_graph guidance text says how.

### Terminal font (UTF-8 / braille maps)

`spellkave_map_graph` emits **code points + optional ANSI color**. Glyph shape
is entirely the **terminal emulator font** (Ghostty / Pi host) — not something
the tool can embed.

**Operator prerequisite** for clean box-drawing and braille maps:

| Role | Font |
|---|---|
| Recommended (often already installed) | **JetBrainsMono Nerd Font Mono** |
| Strong alternative | **Cascadia Mono NF** / CaskaydiaCove Nerd Font |
| Coverage needed | Box Drawing `U+2500–U+257F`, Braille `U+2800–U+28FF`, block elements |

Ghostty example:

```ini
font-family = "JetBrainsMono Nerd Font Mono"
# optional fallback:
font-family = "Cascadia Mono NF"
```

Install (macOS):

```bash
brew install --cask font-jetbrains-mono-nerd-font
# and/or
brew install --cask font-caskaydia-cove-nerd-font
```

Check locally:

```bash
just map-font-check
```

Override the chrome hint string (does not change rendering):

```bash
export SPELLKAVE_MAP_FONT_HINT="JetBrainsMono Nerd Font Mono"
```

Without a Nerd Mono font, maps still print but junctions/braille may look
gappy or fall back to tofu. CI does not require a font.

## Spatial toolbox verbs (prep for content)

Beyond `author_place` + `map_graph`:

| Tool | Purpose |
|---|---|
| `spellkave_link_places` | Portal between two existing nodes (cross-graph OK; auto `substrate_crossing`; optional `door` metadata) |
| `spellkave_attach_map_layer` | `[[map_layers]]` pointer + provenance; image stays in `ccc3-maps` / `FVTT_DATA_ROOT` |
| `spellkave_annotate_place` | `terrain.hint` metadata and/or demo `h3_origin_res10` on a graph |

`map_graph` overlays resolved `map_layers` when the asset file is on disk
(`CCC3_MAPS_ROOT` or git-sibling `ccc3-maps/`). Missing assets are skipped
(CI-safe). details.backdrops_resolved / backdrops_skipped report counts.

An [operable-door pattern](./patterns/operable-door.md) composes open/closed
and locked traversal with authored spatial states and edge gates; its live
player proof covers both endpoints. The `door` flag alone remains map
metadata. Secret-door discovery, real H3 encode, walls/LOS and JPG auto-trace
remain separate gaps.

## What each surface means

| Surface | Meaning |
|---|---|
| Map badge (blue number) | Count of `actor_spatial_locations` at that outdoor node |
| `entities` + `fields: preferred` | `name`, `place_node_id`, `kind`, `entity_def_id` per instance |
| Scale bar / chrome | Metric legend on the SVG (graph `metres_per_unit` → metres) |

Default `spellkave_query` lists stay **ids-only** (token bound). Always pass
`fields: "preferred"` (or an explicit column list) when you need columns.

## Do not

- Use `actors` for location — they have names, not `place_node_id`.
- Query `actor_spatial_locations` via `spellkave_query` — not a query kind today
  (map_graph still reads ASL internally for counts).
- Open SQL / `just sql` for occupancy on authored manifests.
- N× `kind=entities` + `id` when a preferred list would do.

## Fixture honesty

Some fixtures put **props** on the actor path so mechanics can target them
(e.g. a pressure plate as `kind: "npc"` + `actors` row so a save can read
`TargetActor` DC). Query and map will show them. When summarizing “people”,
filter by role/`kind`/entity_def if the user wants creatures only; the data is
not wrong — the fixture is mechanical.

## Related

- Spatial minimal cell: `spatial-minimal-cell`
- Tool parameters: `tool-reference` (`spellkave_map_graph`, `spellkave_query`)
- Metric embedding concept: package docs / ADR-0029 (graph `metres_per_unit`, not H3)
