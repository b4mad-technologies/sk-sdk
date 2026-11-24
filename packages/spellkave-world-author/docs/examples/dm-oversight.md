# Example - define a DM that sees a region's hidden state

How to author a game-master ("DM") body that sees the **Hidden** rows of every
body inside an authored region, while ordinary players see none of it. The
complete manifest form is [`dm-oversight.toml`](./dm-oversight.toml). The
concept guide is [`dm-oversight.md`](../dm-oversight.md).

There is no "DM" type in the substrate. A DM is just a body holding a capability
whose `extent_ref` names a region and whose `extent_kind_ref` says how to
resolve it. Those authored fields are the whole feature.

## The oversight grant

The load-bearing row. `extent_ref` names a `place_graph_id` and
`extent_kind_ref = "place_graph"` selects the core place-graph resolver; the body
holding this grant now sees the `Hidden` rows of every body located in that
place graph.

```toml
[[actor_capabilities]]
actor_entity_key = "dm_oversight/dm"
capability_id = "dm_oversight/oversee"
source = "dm_oversight"
bundle_id = "dm_oversight"
extent_ref = "dm_oversight/region"
extent_kind_ref = "place_graph"
elevation_class = "internal"
```

`extent_ref` defaults to empty. An empty or omitted value broadens nothing
(fail-closed) — a body without it sees only its own Hidden rows, exactly like a
normal player. `extent_kind_ref` is optional only for legacy place-graph
manifests; new manifests should set it explicitly. A typo that names no real
extent grants no extra sight and is rejected at manifest apply; see the concept
guide. `elevation_class = "internal"` is what reaches `Internal`/ungated
`Discoverable` rows on top of `Hidden` — omitted, this grant would still see
`Hidden` rows but not `Internal` ones (ADR-0084, #1938).

## The hidden row it reveals

A capability on a body **inside** the region, marked `visibility = "hidden"`. A
passive player never receives this row through `visible_capability`; the
overseeing DM does.

```toml
[[actor_capabilities]]
actor_entity_key = "dm_oversight/guardian"   # a body at dm_oversight/region/vault
capability_id = "dm_oversight/secret_trait"
source = "dm_oversight"
bundle_id = "dm_oversight"
visibility = "hidden"
```

The guardian sits at `dm_oversight/region/vault`, a node of the
`dm_oversight/region` graph the DM oversees, so the guardian's Hidden trait
falls inside the DM's extent. The `player` body sits in a different graph
(`dm_oversight/outside`) and holds no extent, so it sees neither the guardian's
Hidden trait nor anything else outside its own body.

## Why it is bounded

The DM sees Hidden rows only for bodies in the *named* place graph — never
globally. To oversee two regions, grant the capability twice with two
`extent_ref`s. To share one DM seat among several people, bind several
identities to the one DM actor. The breadth is always authored data, never a
hardcoded rule (ADR-0007 D-3/D-4).
