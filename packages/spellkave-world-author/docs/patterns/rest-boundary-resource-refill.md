# Rest-boundary resource refill

## Name

`rest-boundary-resource-refill` — Complete Short/Long Rest refills recoverable pools

## Problem

Class features and spell slots declare `recovery_rule` (`long_rest`,
`short_rest_partial_long_rest_full`, …) but that field is **documentary** —
the kernel never scans it. Completing a rest must actually restore HP, slots,
and feature uses.

## Forces

- `FireBoundary` already refreshes economy channels and affordance
  `recharges_on` clocks; it does **not** walk `resource_definitions`.
- There is no `ForEachResource` / tag-driven refill frame write. Attempts to
  invent one are a kernel gap; content must list the pools.
- `actor.stat('<pool>')` fails closed when the pool was never seeded
  (finding #35). Gate every class-specific refill with
  `actor.has_capability('<feature>')` so `cond` is lazy and skips the
  untaken branch (`crates/spellkave-dsl` `Op::Cond`).
- Full refill uses `actor.resource_max(id) - actor.stat(id)` (effective max
  honours `entity_resource_bound`). Partial short-rest recovery is a
  constant `+1` (Second Wind / Rage / Focus / Channel Divinity SRD shape).

## Solution

1. Keep Short Rest / Long Rest as actor-carried self verbs whose first
   ordinal is `FireBoundary` (`srd/boundary/short_rest` /
   `srd/boundary/long_rest`).
2. Append one `ModifyResource` ordinal per recoverable pool on the rest
   consequence:
   - Long Rest full: `cond(has_capability, resource_max - stat, 0)` for a
     pool whose ceiling is the same at every level. A class pool whose size
     grows with level (Rage, Second Wind, Action Surge, Focus Points, Channel
     Divinity) refills to a per-level macro generated from the class's
     Features table instead: `cond(has_capability, max(0, macro('srd/rage_uses_max') - stat), 0)`.
     The resource ceiling of such a pool is its level-20 value, so
     `resource_max` would hand a level-1 hero the pool of a level-20 one. HP is
     ungated (every resting creature carries `srd/hp`) and heals a player
     character to its real maximum, the `srd/hit_point_maximum` macro, never
     to the resource ceiling; other creatures heal to `resource_max`.
   - Short Rest partial: one use back, never past the same per-level macro:
     `cond(has_capability, min(1, max(0, macro('srd/rage_uses_max') - stat)), 0)`
     for `short_rest_partial_long_rest_full` pools; refill to the macro for
     pools that recover on either rest (Action Surge).
   - Short Rest Hit Point Die: one die per rest, for a hurt player character
     with a die left. Create both counters with a zero delta first (a read of
     a resource the actor never had fails closed), capture the rolled heal
     (class die + Constitution modifier, at least 1, capped at the room below
     the real maximum) in the scratch resource `srd/hit-die-heal`, add the
     scratch to `srd/hp`, then add 1 to `srd/hit-dice-spent` only when the
     scratch is above 0. A hero has one die per level
     (`srd/hit-dice-spent < srd/level`). The Long Rest sets the spent counter
     back to 0. The capture is the idiom of the death save
     ([derived-value-mechanism](derived-value-mechanism.md)).
3. Feature-specific mid-rest rites (Arcane Recovery, Magical Cunning) stay
   separate actor-carried verbs with their own once-per-long-rest use pool
   — they are not automatic on the shared boundary.

## TOML example

Excerpt from `packages/spellkave-srd-cc/fixtures/base/playing-the-game/rest.toml`
(ordinals 0, 2 and 5 of the Long Rest consequence; the others refill Heroic
Inspiration, spell slots and further class pools):

```toml
# pattern: rest-boundary-resource-refill
[[consequence_frame_writes]]
ordinal = 0
template_id = "srd/rest/long/complete/success"

[consequence_frame_writes.frame_write.FireBoundary]
boundary_id = "srd/boundary/long_rest"
scope = "Actor"

[[consequence_frame_writes]]
ordinal = 2
template_id = "srd/rest/long/complete/success"

[consequence_frame_writes.frame_write.ModifyResource]
actor = "Actor"
resource = "srd/hp"
delta_source = "cond(actor.has_tag('srd.player_character'), max(0, macro('srd/hit_point_maximum') - actor.stat('srd/hp')), actor.resource_max('srd/hp') - actor.stat('srd/hp'))"

[[consequence_frame_writes]]
ordinal = 5
template_id = "srd/rest/long/complete/success"

[consequence_frame_writes.frame_write.ModifyResource]
actor = "Actor"
resource = "srd/fighter/second-wind-uses"
delta_source = """
cond(actor.has_capability('srd/class-feature/fighter/second-wind'),
     actor.resource_max('srd/fighter/second-wind-uses')
       - actor.stat('srd/fighter/second-wind-uses'), 0)
"""
```

## Proof

- Generator: `packages/spellkave-srd-cc/src/chapters/playing-the-game/fragments/rest.ts`
- Offline: `packages/spellkave-srd-cc/src/test/offline/rest-refill-coverage.test.ts`
  (the rest fixture carries a `resource_max` refill ordinal per pool)
- Live: complete Long Rest with spent Second Wind / slots → SQL read-back

## Related

- [`actor-carried-feature-verb`](./actor-carried-feature-verb.md) — the pools
  these refills charge
- [`extra-action-budget`](./extra-action-budget.md) — Action Surge uses the
  same long/short full refill
- [`action-economy.md`](../action-economy.md) — `FireBoundary` itself

## Known misuse

- Expecting `recovery_rule` alone to restore anything at runtime.
- Ungated `actor.stat` on a class pool for every creature on rest (fails
  the whole consequence chain for non-owners).
- Treating Arcane Recovery / Magical Cunning as automatic boundary side
  effects — they are optional rites with their own use counters.
- Treating Relentless Endurance as "just a rest-refilled charge": the charge
  half fits this pattern, but the 0-HP intercept does not
  (`packages/spellkave-srd-cc/docs/substrate-verdicts/relentless-endurance-0hp-intercept.md`).

## SRD features

Long Rest HP/slot recovery and the return of spent Hit Point Dice; one Hit
Point Die spent per Short Rest; Second Wind / Rage / Focus / Channel Divinity
partial short + full long; Action Surge either rest; Arcane Recovery and
Magical Cunning as separate verbs (BL-70); curated wand charges (Wand of
Magic Missiles, Wand of Fireballs, sk-609b.13) — modelled as a full refill
on a Long Rest (`rest.toml:308-317`), not the SRD's partial recharge at
dawn.
