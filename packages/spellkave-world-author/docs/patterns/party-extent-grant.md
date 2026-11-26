# Party-extent grant (addressability across graphs as a privilege)

## Name

`party-extent-grant` — Cross-graph reach via a capability extent, not a range number

## Problem

My DM (or a bonded item) must address a party member who is on ANOTHER place graph — the inn hearth to the tomb crypt — and a bigger `range_m` does not work.

## Forces

- `validate_reachability` rejects cross-graph pairs as incomparable metric
  frames, and candidate expansion is same-graph: no range number can
  cross a graph boundary.
- Ordinary telepaths (creatures, items) that only author a range should
  stay same-graph — privilege must be a grant, not a global change.
- The addressee still perceives the line by co-location with the
  directed trace; no new admission model may be introduced.
- An actor-only body without an `entity_location` row fails target
  resolution before the extent check (pre-existing, not a regression).

## Solution

Grant the SAME communicate capability on the privileged actor with an
**extent**: `extent_kind_ref = "party"` and `extent_ref = <membership tag>`
(the tag the party members carry). That admits every member as an addressee
regardless of node or graph. The trace is still anchored at the addressee's
place ([`directed-speech-anchor`](./directed-speech-anchor.md)). Seat
watches that also want a "same graph, in range" guard keep it as their own
policy; the substrate no longer requires it.

## TOML example

Copied from `packages/spellkave-adventure-elven-mini/fixtures/adventure/cast/npcs/aldwin.toml`:

```toml
[[actor_capabilities]]
actor_entity_key = "elven_mini/adventure/npc/aldwin_1"
bundle_id = "elven_mini"
capability_id = "srd/action/communicate/telepathy"
elevation_class = ""
extent_kind_ref = "party"
extent_ref = "srd.party.heroes"     # the same membership tag the hero carries
source = "srd"
source_args_hash = ""
```

Compare the DM's sight grant in the same file: `elven_mini/dm/watch` with
`extent_kind_ref = "place_graph"` — extents are the general privilege
shape, party is one kind.

## Proof

- Kernel: the world API
  unit tests `extent_membership_is_an_alternative_to_metric_range` and
  `cross_graph_metric_still_rejects_without_extent` (`:1389-1437`).
- `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/telepathy.ts`
  covers directed speech heard only by the addressee (range, not extent).
- `packages/spellkave-adventure-elven-mini/npcs/__tests__/aldwin-xp-threshold.test.ts`
  (invitation path)

## Related

[`directed-speech-anchor`](./directed-speech-anchor.md),
[`proactive-level-up`](./proactive-level-up.md) (the invitation consumer),
[`dm-oversight`](../dm-oversight.md) (graph-scoped sight extents).

## Known misuse / anti-pattern

- A very large `range_m` to "reach" another graph.
- Inventing a DM-only communicate verb instead of granting the shared one
  with an extent.
- Reading the extent as a recipient column — perception is still
  co-location with the anchor.

## SRD features that use this

- Aldwin's `srd/action/communicate/telepathy` party extent (level-up
  invitations). Creature / item telepathy stays range-only:
  `speech-and-traces.md` (`@spellkave/srd-cc` docs, not in this repository).
