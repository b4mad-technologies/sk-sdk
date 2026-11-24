# @spellkave/world-author

Typed world-manifest authoring surface: builds manifest rows → a single-file
world manifest (TOML) for agent and code authors. The authoring counterpart to
[`@spellkave/sdk`](../spellkave-sdk)'s runtime actor surface.

## Boundary (same as the SDK, sdk CLAUDE §1/§3)

This package serializes **typed rows**. It does **not** re-implement validation.
The Rust validator (`crates/spellkave-validate`, via `r_apply_world_manifest`) is
the source of truth; callers can use `spellkave-validate-wasm` for the same
parser/validator feedback before apply.

## Bundle loading

`loadBundleChainDetailed({ rootManifestPath, resolveDependency })` loads an
explicitly named root and its dependency closure. It returns the familiar merged
row projection in `manifest` plus dependency-before-dependent `sources`; each
source preserves its absolute root path, declared bundle IDs, root
`schema_version`, `[metadata]`, and direct include paths. Its `fragments`
envelope retains each direct include's path, resolved path, and local
`[metadata]` tree in declaration order; the merged `manifest` remains a
row-only projection, so include metadata never becomes a second root. Direct
includes do not nest. `resolveDependency`
maps an authored dependency ID to its root TOML path. The legacy
`loadBundleChain(dir, fixturesRoot)` remains available for sibling
`<fixturesRoot>/<bundleId>/manifest.toml` layouts and returns only the merged
manifest.

## Metadata values

`[metadata]` is an open JSON-compatible tree: strings, booleans, finite
numbers within JavaScript's safe integer range, arrays, and nested tables are
preserved through TOML → WASM JSON → TOML. TOML datetimes, `nan`/`inf`, JSON
`null`, and numbers outside ±9,007,199,254,740,991 are rejected rather than
silently changed. The schema version remains `1.0.0`: this is an additive
widening, so producers must not emit structured metadata until every deployed
consumer has updated from the former string-only reader.

Existing validator-control keys (`profile`, `entity_ids`, `fk_refs`, and their
related legacy CSV keys) remain strings. Supplying a structured value for one
is a fatal validation error; use a distinct open metadata key for new data.

## Row vocabulary

The union of what the world-explorer co-evolution loops (#504) author:

- **Presence:** `entities`, `actors`, `actor_spatial_locations`
- **Actionable affordance chain:** `object_state_definitions`,
  `capability_definitions`, `niche_definitions`, `spatial_niche_attachments`,
  `outcome_templates`, `affordance_templates`, `action_definitions`,
  `consequence_templates` (+ `SetEntityFlag` frame writes), `actor_capabilities`

Every array on `WorldManifest` is optional; `renderManifest` emits only the rows
present.

## Commands

```bash
npm run typecheck -w @spellkave/world-author
npm run test -w @spellkave/world-author
```
