# Region-scale geography: check the live place graph, not a stale brief

(OV1/RH1 and the Thundertree/Old Owl Well/Wyvern Tor graphs are worked
examples from the retired Phandelver bundle and its Foundry importer,
deleted in `fd2288bdea` — recover via `git show`, see `archive/README.md`;
the rules still hold.)

**Gotcha — a beat brief's "region nodes: ZERO" open flank can go stale the
moment new topology lands, and the beat's own `units.toml` row inherits the
staleness.** OV1's brief (written 2026-07-02) listed Thundertree/Old Owl
Well/Wyvern Tor region nodes as entirely missing; the #1696 importer
(2026-07-03) had already emitted the FULL `region` place_graph (12 nodes with
metric `pos_x`/`pos_y` from the scene's note pins) plus the site graphs, all
wired into `manifest.toml` — the brief simply predated the import. At the
time the authoritative record of what an importer wave left ungated was the
per-scene "Deferred openings" list in `coverage/foundry-scenes.md`; that
record no longer exists (it lived under
`archive/packages/spellkave-phandelver/fixtures/coverage/` and was deleted
with the bundle in `fd2288bdea`), and no importer coverage record replaces
it. Today, before authoring any "missing" region/site nodes, check what the
manifest and the live node already carry — grep the bundle's
`[[place_nodes]]`/`[[place_edges]]` rows and run `spellkave place-node list`
/ `spellkave place-edge list` against a seeded node — not the brief or the
beat-dag `open_flanks`. The beat's real job may be proving the existing
graph live, not authoring new topology.

**Gotcha — imported region-scale coordinates are a DIFFERENT coordinate space
than any hand-authored graph; compute expected compass directions from the
real `pos_x`/`pos_y`, never guess or copy real-world geography.** A Foundry
scene importer emits `pos_x`/`pos_y` from the scene's own pixel/note-pin
layout, not the same origin or scale as a hand-authored graph like
`base/spatial.toml`'s "1 unit ≈ 1 mile" trail. `readLocationSnapshot`'s
`direction` field (X4) is derived purely from the two endpoint positions via
`atan2` (`packages/spellkave-sdk/src/core/readers/location_snapshot.ts`), so
it is internally consistent — but a brief's real-world claim (e.g. "Old Owl
Well is 18mi SE of Conyberry") can come out differently once the actual
imported positions are atan2'd (OV1: `region/conyberry_agatha` →
`region/old_owl_well_approach` computes `"northeast"`, not the brief's
guessed `"southeast"`). Assert whatever the real computed direction is, not
the brief's prose guess.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
