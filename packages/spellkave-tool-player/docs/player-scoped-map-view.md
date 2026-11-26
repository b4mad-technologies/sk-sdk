# Player-scoped map view (`spellkave_map`, renamed 2026-08-13 from `spellkave_player_map` — bead sk-due)

Status: **implemented**. Package: `@spellkave/tool-player` (+ one new
`@spellkave/sdk` reader). Related: `spellkave_map_graph` (AUTHOR mode,
`authoring-verbs.ts`), the world API,
[`docs/README.md`](../../../docs/README.md#canonical-vs-change-local-docs).

> **Placement note.** This design was originally briefed to land under
> `packages/spellkave-srd-cc/ledger/designs/`. That directory is **frozen for
> new entries** (`packages/spellkave-srd-cc/ledger/CLAUDE.md`'s directory map,
> sk-54b ruling, 2026-08-12) and scoped to srd-cc *content* authoring — this
> design concerns the PLAYER tool surface, a different package
> entirely, so it lands here instead. See root `docs/README.md`'s "stable
> package docs live beside the package they document" convention.

## Goal

Give a PLAYER-role agent its own spatial-graph map — the same SVG/ASCII/
inventory rendering AUTHOR's `spellkave_map_graph` already produces — scoped
to what the connected actor has actually perceived, not the full authored (or
live) world.

## Investigation findings

**Is the fog-of-war substrate reachable from TS?** Yes, already. Bindings
exist (`packages/spellkave-bindings/src/module_bindings/
visible_observer_place_knowledge_table.ts`) and `@spellkave/sdk` already
exports a reader over them: `readObserverPlaceKnowledge` (`packages/
spellkave-sdk/src/core/readers/observer_place_knowledge.ts`), consumed today
by `spellkave_observer_place_knowledge` (`tools.ts`). No SDK gap on the
knowledge side.

**What WAS missing:** a reader for the place-graph *topology itself*
(`place_node`/`place_edge`/`place_graph_definition`) in the row shape
`buildSpatialGraphView` consumes. AUTHOR's `spellkave_map_graph` sources these
through `author-target.ts`'s `LIVE_TABLE_ACCESSORS` — a parallel, AUTHOR-only
path that reads live tables directly via `db.<table>().iter()`, bypassing the
`@spellkave/sdk` reader/`READER_SCOPED_TABLES` system entirely. That path is
legitimate for AUTHOR tooling but not reusable for a PLAYER-facing tool: the
PLAYER binding invariant is explicit — "NPC/companion code never
reads raw SQL — Companion SDK subscriptions only" (`packages/
spellkave-tool-player/README.md`). So this design adds one new reader,
`readPlaceTopology` (`packages/spellkave-sdk/src/core/readers/
place_topology.ts`), returning the full node/edge/graph catalog in the same
manifest-row (snake_case) shape `LIVE_TABLE_ACCESSORS` already uses — so a
PLAYER-scoped caller composes with the exact same `buildSpatialGraphView`
AUTHOR mode calls, unchanged.

*Aside, out of scope for this design:* `LIVE_TABLE_ACCESSORS` has **no** entry
for `actor_spatial_locations` at all, so AUTHOR's own occupancy badges are
silently empty whenever `spellkave_map_graph` reads from a live/local target
rather than workspace TOML. Pre-existing, unrelated to fog-of-war, flagged for
whoever owns `author-target.ts` next — not fixed here (AUTHOR path must stay
byte-identical for this PR).

## AUTHOR-mode vs. PLAYER-mode row sourcing

| | AUTHOR (`spellkave_map_graph`) | PLAYER (`spellkave_player_map`) |
|---|---|---|
| Node/edge/graph source | `collectSpatialToolRows` → workspace TOML ∪ `AuthorTarget.lookup()` (live/local override) | `readPlaceTopology(db)` — the full public catalog, unfiltered |
| Node filter | none — everything the target has | restricted to `readObserverPlaceKnowledge(db, actorId)`'s known-node set |
| Edge filter | model-level only (`model.ts`'s existing graph-scoped/compose-all rules) | pre-filtered to edges where **both** endpoints are known, before the shared model ever sees them |
| Occupancy | `actor_spatial_locations` (workspace/target rows) | omitted entirely — see decision 2 below |
| Rendering | `buildSpatialGraphView` (`spatial-graph/index.ts`) | the SAME function, unmodified |

The shared rendering module (`spatial-graph/model.ts`, `layout.ts`,
`render-svg.ts`, `render-ascii.ts`, `inventory.ts`) is **untouched**. Every
difference between the two tools lives entirely in which rows get fed in —
row-source filtering, not a rendering-path fork. This is what keeps the AUTHOR
path byte-identical (verified: full `packages/spellkave-session` player-tool
test suite green, `git status --porcelain` shows zero changes under
`packages/spellkave-srd-cc/fixtures/**`).

## Decision 1 — the open question: edges toward an unknown node

**The brief's working proposal:** show known nodes plus edges leaving a known
node, rendering the unknown far side as an "unexplored exit" stub — justified
because "the scene surface already tells the player which exits exist."

**Stress-testing that claim against the actual scene tool
(`tools.ts::currentScene`/`sceneToolDef`, #1987 exit annotation):**
`spellkave_scene`'s exit rows *do* disclose their destination `to_node_id`
unconditionally (`sceneToolDef`'s doc comment: "Each exit row carries its
destination as `to`... so `spellkave_scene_detail` is only needed for an
exit's affordance template/handle detail, not to learn where it leads") — but
**only for exits at the actor's CURRENT node**. There is no equivalent
disclosure for a *known-but-not-current* node's own exits toward an unknown
node. The proposal's justification is true at exactly one node (wherever the
actor is standing right now) and does not generalize to the whole known-node
set the map draws. An "unexplored exit" stub on every known room would
disclose *more* than scene ever does about a room the actor isn't currently
in — a new disclosure surface, not a mirror of existing behavior.

**A concrete leak found while stress-testing the "either endpoint known"
alternative (the natural middle ground):** `spatial-graph/inventory.ts`'s
`renderSpatialGraphTextInventory` EDGES section lists `model.edges` directly
with no endpoint-membership check — unlike its own `adjacency()` helper two
functions down, which does guard `m.has(e.from) && m.has(e.to)`. Passing
edges through on an "either endpoint known" basis (mirroring the existing
AUTHOR-mode outdoor-compose rule that keeps indoor-portal-stub edges) would
print the *literal id* of the unperceived far node in the tool's text body —
a real leak, not a hypothetical one. Proven and closed by
`src/__tests__/player-map-tool.test.ts` ("must never leak 'dungeon'").

**Implementation cost of a real stub feature:** rendering an actual visual
stub (not just retaining a dangling edge reference) means an unknown node
needs *some* laid-out position — but `model.ts`'s node inclusion
(`asNodes`) requires `pos_present` (or an H3 cell, or `topology_only` mode).
A bare unknown node has none of these. Building placeholder-position logic
for it means touching the SAME shared rendering files AUTHOR mode depends on
(`model.ts`, `layout.ts`, `render-svg.ts`, `render-ascii.ts`) — real risk to
"AUTHOR path stays byte-identical," for a feature with no product ask yet.

**Recommendation (implemented): reject the stub for v1.** An edge renders
only when **both** endpoints are known; an edge toward an unknown node is
silently omitted, never stubbed. Zero changes to shared rendering code — a
pure row-filter at the tool boundary — and it closes the inventory-text leak
by construction. `spellkave_scene` remains the sole authority for "what
exits exist from HERE, right now"; the map is a memory/orientation surface
across visited places, not a live decision surface, and staying quiet there
about unexplored connections from a *past* location is consistent with that
split, not a regression from it.

**Left explicitly open:** if a future design wants "you remember there being
more to explore from a place you've been" (e.g. a bare `known_exit_count`
badge with no destination), that is a deliberate, separately-scoped
disclosure decision — a DM/product call, not a default byproduct of this
tool's row filter.

## Decision 2 — occupancy badges omitted

AUTHOR mode's badges come from `actor_spatial_locations` (workspace/target
rows, unfiltered). The nearest PLAYER-legal equivalent,
`visible_actor_spatial_location`, is bounded to bodies **co-located with the
caller's own current node**. Feeding that into the map would
show an accurate count only at the actor's current node and a misleading `0`
at every other known-but-distant node — indistinguishable from "genuinely
empty." `spellkave_scene` is already the correct, richer surface for "who's
here now" (names + factions via `LocationActorEntry`). `spellkave_player_map`
omits `actor_spatial_locations` entirely rather than emit a badge that would
misread as ground truth.

## Canon-warden four-axis check

- **Gibson affordance discipline (ADR-0021).** No new closed-string enum
  classifying rows; the tool reads existing generic geometry columns
  (`node_id`, `place_graph_id`, positions) plus a generic knowledge-membership
  set. No domain vocabulary minted.
- **ADR fidelity (ADR-0120).** `readPlaceTopology` deliberately does **not**
  go through a `visible_*` view, because `place_node`/`place_edge` are not
  gated tables — `#[spacetimedb::table(accessor = place_node, public)]`
  (the world API) and the equivalent on `place_edge`
  (`place_edge.rs:5-9`). This matches existing precedent: `location_snapshot.ts`
  already reads the same raw public tables directly. The fog-of-war judgement
  is applied at the reader-CONSUMER layer (the tool), which is exactly SDK
  CLAUDE.md's own division of labour — readers project public/gated state
  faithfully, semantic judgement stays with the caller.
- **K-rule §17.** No kernel dispatch `match` touched. Zero the world implementation
  changes in this PR.
- **Manifest/DSL-first (ADR-0025/0018/0016).** No new authoring surface, no
  new manifest row kind — a pure read projection over already-authored
  place-graph content.

**Verdict: authorable-canon-safe.** No server change, no canon-warden gate
required for this PR.

## What shipped

- `packages/spellkave-sdk/src/core/readers/place_topology.ts` — new reader,
  `readPlaceTopology(db)`, unfiltered public catalog projection.
- `packages/spellkave-tool-player/src/tools.ts` — `playerMapGraphToolDef`
  (tool name `spellkave_player_map`), registered in both
  `spellkaveToolDefinitions` and `playerFacingToolDefinitions`
  (`createPlayerFacingTools`/`createPlayerFacingToolMap`), plus the thin
  `createPlayerMapGraphTool` factory.
- `packages/spellkave-tool-contracts/src/schemas.ts` —
  `SPELLKAVE_PLAYER_MAP_TOOL` + `PLAYER_MAP_PARAMS` (a subset of AUTHOR's
  params: `graph`, `slice`, `z`, `z_tolerance`, `terminal` — no `target`, no
  `lod`; PLAYER is always live+self-scoped, and occupancy badges never apply
  per decision 2).
- Tests: `packages/spellkave-session/src/player-tools/__tests__/
  map-tool.test.ts` (fog-of-war node filtering, known-known edge
  policy + the inventory-leak regression, per-observer scoping); SDK
  manifest-completeness coverage for the new reader.
- Docs: `packages/spellkave-tool-player/docs/tool-reference.md`
  regenerated (`npx tsx scripts/generate-player-tool-reference.ts`).

## Extension (2026-08-12/13) — map-art backdrop (unmasked) + JPEG output mode

Operator ruling superseded the "SVG only, no backdrop" posture above: the
tool now composes a backdrop when one is authored. **What it actually does
today:** fog-of-war applies to the GRAPH — `place_nodes`/`place_edges` stay
filtered to what the connected actor has perceived, same row filter as
always, no change there. The backdrop ART ITSELF is drawn in FULL and
UNMASKED — the operator has deliberately chosen that the rendered picture may
show rooms the character has not yet discovered; the graph is the fog-of-war
surface, the picture underneath it is not (yet). Three pieces:

- **Backdrop composition (existing `RenderSvgOptions.backdrops`/
  `backdropHref`, unchanged, unmasked).** The tool supplies backdrop rows and
  a href resolver into the SAME shared render path AUTHOR's
  `spellkave_map_graph` already used — no behavioral change to how a
  backdrop draws.
- **Backdrop masking — written, tested, NOT enabled
  (`RenderSvgOptions.maskBackdropToNodes`, `spatial-graph/render-svg.ts`).**
  An SVG `<mask>` built from `layout.nodes`, one reveal circle per node sized
  off its own authored `size_w`/`size_h` (threaded onto `SpatialGraphNode` as
  `sizeW`/`sizeH`) plus a fixed legibility margin. The machinery exists and
  has its own test coverage (`spatial-graph/__tests__/spatial-graph.test.ts`'s
  "backdrop masking" describe block, including a byte-identical-when-omitted
  regression) — but no caller sets the flag: AUTHOR's `spellkave_map_graph`
  never did, and `spellkave_player_map`'s JPEG mode explicitly does NOT set it
  either (`tools.ts`, `playerMapGraphToolDef`'s JPEG branch has an inline
  comment explaining why). Turning it on for the player tool — clipping the
  art to known nodes too — is tracked as **bead sk-ubx**, a deliberate,
  separately-scoped follow-up, not an oversight.
- **JPEG output mode (`output_dir`/`output_name` on `PLAYER_MAP_PARAMS`).**
  Host-supplied directory + base filename (never an ambient/hardcoded path —
  this package stays host-neutral) switch the tool into writing a
  backdrop-composed JPEG and returning its path as `details.jpg_path`; the
  default terminal/ASCII response is unaffected either way. Backdrop rows
  come from a new reader, `readMapLayers`
  (`packages/spellkave-sdk/src/core/readers/map_layers.ts` — `map_layer` is
  `#[table(..., public)]`, same not-gated precedent `readPlaceTopology`
  documents above), resolved via the existing `mapLayersToBackdrops`, drawn
  `sheetAlign: true` (image-cell coords) with the local asset embedded as a
  base64 data URI (`backdropAssetDataHref`, `spatial-graph/
  backdrop-resolve.ts` — resvg does not load `file://` reliably; same idea
  as `renders.ts`'s own `backdropDataHref`, kept separate/byte-for-byte
  there rather than consolidated).
  **PNG → JPEG (operator decision 2026-08-13):** a full-resolution backdrop
  PNG runs 1.1-1.4 MB, well over the repo's `check-added-large-files
  --maxkb=1024` pre-commit gate. `spatial-graph/jpeg-write.ts`'s
  `writeJpegWithChurnGuard` mirrors `renders.ts`'s own established
  `*-with-map.jpg` product-view path exactly: rasterize to a PNG buffer via
  resvg (`rasterizeSvgToPng`, unchanged — resvg has no native JPEG output),
  write it to a dot-prefixed temp file, `execFileSync("ffmpeg", ["-y", "-i",
  tmpPng, "-q:v", "4", outPath])`, then delete the temp PNG — same quality
  (`-q:v 4`) the AUTHOR-side product views use, landing in the same ballpark
  (live-confirmed under the 1024 KB gate — see the kavemouth story's own
  `fixtures/kavemouth/story/level-1/maps/*.jpg` for the committed sizes).
  ffmpeg is fine here — this render only ever runs during a LIVE local
  recording (`live-preseeded` tier, `SPELLKAVE_LOCAL_NODE=1`-gated), never on
  a CI runner (the SAME sk-dms.42 finding `generate.ts`'s own
  `SRD_CC_AUTHOR_CHECK_TEXT_ONLY` env-var skip documents; the session's
  OWN unit tests that exercise this path skip themselves via `it.skipIf` on
  a machine without ffmpeg, since `test` runs ungated in CI unlike the
  adventure suite). The churn guard is UNCHANGED by the encoder swap: still a
  sha256 over the deterministic source (SVG string, now embedding the
  backdrop's own base64 bytes, + raster width) — a JPEG is only re-encoded
  when that source changed since the last write into `output_dir`; encoded
  bytes themselves are host-dependent (fonts + native resvg + ffmpeg
  version), so the hash covers only the host-independent source (confirmed
  stable — same checksums — across repeated live recordings on the same
  machine).
  **`output_dir` may be relative (operator finding, 2026-08-13):** the tool
  records its own call params verbatim (T9) and echoes `output_dir` back in
  `jpg_path`, so an ABSOLUTE `output_dir` bakes the recording machine's own
  checkout path into whatever committed artifact embeds the call — exactly
  what happened the first time this shipped (`adventureStoryRoot()` is
  absolute). A relative `output_dir` resolves against the tool's own
  `process.cwd()` for the actual filesystem write ONLY; `jpg_path` always
  echoes the caller's ORIGINAL string (relative stays relative, absolute
  stays absolute — `isAbsolute` short-circuits so this package's own unit
  tests, which use a fresh `mkdtempSync` absolute dir, are unaffected). The
  srd-cc harness (`scene-steps.ts`'s `mapJpegStep`) now passes
  `path.relative(process.cwd(), …)` rather than the raw absolute root.
  `src/test/offline/adventure-story.test.ts`'s "no absolute filesystem paths
  leak into the recorded story artifacts" describe block is the durable
  regression guard — it scans the real committed JSONL and every chapter
  markdown for an absolute-path shape (Unix home dir or Windows drive
  letter) and fails the suite if one appears, so a future tool wired to a
  path param without this same care trips it immediately rather than
  shipping silently.
- **srd-cc adventure story wiring:** each recorded turn now calls
  `spellkave_player_map` twice (`shared/scene-steps.ts`'s `mapStep` +
  `mapJpegStep`) — ASCII mode (embedded as a fenced text block, graph only,
  no backdrop) and JPEG mode (embedded as an image, `story.ts`, full unmasked
  backdrop art with the known-node graph drawn on top) — replacing the old
  raw-SVG embed. Live-verified: two consecutive recordings against a freshly
  wiped+seeded node leave `git status` clean (churn guard proof); AUTHOR's
  own `fixtures/kavemouth/renders/*` are untouched by any of this.

Canon re-check: still no server change, no new manifest row kind, no
domain vocabulary — pure rendering/plumbing. Verdict unchanged:
**authorable-canon-safe.**

## Extension (2026-08-13) — rename to `spellkave_map`, `output_type` replaces `terminal`, selective rendering

Operator-requested cleanup (PR #2172 follow-up, bead sk-due) with three
coupled changes:

- **Rename `spellkave_player_map` → `spellkave_map`.** Every other
  PLAYER-facing tool in this package is named for the THING, never the
  role — `spellkave_scene`, `spellkave_inventory`, `spellkave_traces`,
  `spellkave_self_summary` — the role lives in the registry
  (`playerFacingToolDefinitions`), not the name. This tool was the sole
  exception. "scene = what I see here, map = what I know of the world."
  AUTHOR's `spellkave_map_graph` keeps its own name — "_graph" is
  deliberate there, since an author looks at substrate structure, not
  knowledge.
- **`output_type` replaces `terminal`, on BOTH map tools.** The old
  `terminal` param (`utf8 | ascii | braille | both`) only picked which text
  variant led the response body — `buildSpatialGraphView` rendered
  svg + utf8 + ascii + braille unconditionally regardless, and every tool
  response carried all four. `output_type` is a single flat enum covering
  the full artifact space: `utf8 | ascii | braille | inventory | svg | jpg`.
  `svg` and `jpg` are new as first-class values (previously `jpg` was a
  side-mode triggered by `output_dir`'s mere presence, decoupled from
  `terminal`).
- **The engine renders only what's asked.** `buildSpatialGraphView` gained
  an opt-in `renderOnly` option (`spatial-graph/index.ts`) — when omitted,
  it keeps the historical "compute everything" default every non-tool
  caller (`renders.ts`, `spellkave-cli`'s `map.ts`,
  `author-spatial-map-proofs.ts`) still relies on for byte-identical
  fixtures; the two map tools are the only callers that pass it, deriving
  it 1:1 from `output_type` via the shared `spatialRenderPlanForOutputType`
  helper (so the two tools' semantics can never drift apart). Concrete
  cost this closes: the kavemouth adventure story recorded TWO
  `spellkave_map` calls per turn and both used to carry a full SVG payload
  nobody read (286 KB → 380 KB across the story JSONL); the story now
  records `output_type: "ascii"` then `output_type: "jpg"`, and neither
  response's `details` carries an `svg` field at all.
- **`output_dir`/`output_name` both went from "required together" to fully
  optional.** An omitted `output_dir` under `output_type: "jpg"` now
  defaults to a fresh temp directory (`mkdtempSync`); an omitted
  `output_name` derives one from `graph` (or `"map"` for a world-compose
  call). `resolveMapJpegOutput` (`spatial-graph/jpeg-write.ts`) is the one
  place this default-resolution lives, shared by both map tools. Explicit
  values are byte-for-byte unchanged from before this extension — the
  relative-stays-relative contract the srd-cc adventure story recording
  depends on (documented above) is untouched.
- **AUTHOR's `spellkave_map_graph` gained `output_type: "jpg"` too**, reusing
  the exact same `resolveMapJpegOutput`/`writeJpegWithChurnGuard` plumbing —
  previously AUTHOR had no file-writing mode at all (only the interactive
  SVG/ASCII text response). Its default `output_type` is `"svg"` (not
  `"utf8"` like the PLAYER tool) — a deliberate default-per-tool split:
  AUTHOR's Pi TUI usage is picture-first (`attachSpatialGraphImageToToolResult`
  only paints an inline image when `details.svg` is present, so an agent
  calling `spellkave_map_graph` with no `output_type` still gets the same
  "always shows a picture" experience it had before this change), while
  PLAYER's default stays the cheap text body (`"utf8"`, matching the old
  `terminal` default) since a story-recording caller now asks explicitly
  for `ascii`/`jpg` when it wants those.

Every consumer of `buildSpatialGraphView` outside the two tools
(`renders.ts`, `spellkave-cli/src/map.ts`, `author-spatial-map-proofs.ts`)
was audited and left untouched — none of them pass `renderOnly`, so they
keep the full "compute everything" behavior byte-for-byte
(the `authored-fixture-drift` skgate registry gate is the durable proof for
`renders.ts`'s own committed output). The Pi extension
(`.pi/extensions/spellkave`) and `spellkave-cli`'s `map-inspect`/`map-render`
commands read tool-result `details` defensively (`typeof x === "string"`
guards, never an assumed-present field), so a narrower response shape needs
no code change on either side.

Canon re-check: still no server change, no new manifest row kind, no domain
vocabulary — pure rendering/plumbing, plus a rename. Verdict unchanged:
**authorable-canon-safe.**

## Amendment (2026-08-22) — module-side row filter (sk-adr8.7)

The fog-of-war row filter moved into the module (the world API).
Clients read only `visible_place_node` / `visible_place_edge` /
`visible_place_graph_definition` / `visible_map_layer` via the SDK one-reader
pair `readPlaceTopology` / `readMapLayers`. PLAYER admission matches scene:
known nodes plus the current node's exits (frontier). Edge admission is
**from a core node to an admitted node** (not the older "both endpoints known"
client join). `spellkave_map` no longer joins against
`readObserverPlaceKnowledge`; it still owns session-grid composition and
`notable_anchor_nodes` (now also from the view).

## Amendment — hosted MCP deep link to maps.spellkave.com

The MCP map contract stays host-agnostic: text + optional `image` block for
all clients (claude.ai, Pi via pi-mcp-adapter). No MCP-App/widget. On the
hosted PLAYER MCP gateway only, when `SPELLKAVE_MAPS_URL` is set and the
seat's world slug is known, `spellkave_map` results gain one extra text line
`Interactive map: <base>/w/<slug>` pointing at the browser app
(`apps/maps`). Local hosts leave the env unset and stay unchanged.
