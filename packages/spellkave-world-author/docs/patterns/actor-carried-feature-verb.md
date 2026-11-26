# Actor-carried feature verb (a class feature the hero carries everywhere)

## Name

`actor-carried-feature-verb` — Feature verb offered wherever its owner stands

## Problem

A granted class feature (Second Wind, Rage, Channel Divinity) must be usable wherever the hero is — in the tomb, not only at the room where it was granted — and spend its own uses.

## Forces

- A `capability:*` niche authored without a `provider` used to fall back
  to place-provided in silence, leaving the verb dead outside an authored
  node (a level-1 fighter needed Second Wind in the tomb and it was not
  offered); `WA-CAP-002` now rejects that.
- Scoping a feature to the place where it is "normally" exercised is a
  premise a blind playtest falsifies.
- There is no class-definition inheritance: granting the capability does
  not seed the feature's resource; an unseeded `actor.stat(<uses>)` gate
  fails closed.
- Uses are a pool the feature spends; a feature whose pool starts at 0 is
  correctly absent from the palette until something charges it.

## Solution

1. Niche `capability:<bundle>/class-feature/<class>/<slug>` with
   `provider = "actor"` — the acting creature's own capability carries the
   niche; no `spatial_niche_attachment`. Same shape attacks, Dodge and the
   rests use.
2. Affordance gated on the feature's own pool:
   `actor.stat('<uses>') >= 1`; `spends_channel` on the right economy
   channel.
3. Consequence: `ModifyResource` `-1` on the pool (ordinal 0), then the
   effect.
4. Whoever grants the capability (creation confirm, level-up apply) also
   **seeds the pool** from the resource definition's `initial_value` or
   its documented seed formula
   ([`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md)).

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/classes/fighter.toml`
(Second Wind; bundle_id, display names and default-valued fields omitted) and `…/base/classes/caster-features.toml` (Divine Spark
spend + effect):

```toml
[[affordance_templates]]
capability_id = "srd/class-feature/fighter/second-wind"   # what disclosure keys on
niche_id = "capability:srd/class-feature/fighter/second-wind"
outcome_template_id = "srd/fighter/second-wind/outcome"
predicate_source = "actor.stat('srd/fighter/second-wind-uses') >= 1"
spends_channel = "srd/economy_channel/bonus"
template_id = "srd/fighter/second-wind/affordance"

[[niche_definitions]]
display_name = "Use Second Wind (self)"
niche_id = "capability:srd/class-feature/fighter/second-wind"
predicate_source = ""
provider = "actor"

[[consequence_frame_writes]]
ordinal = 0
template_id = "srd/cleric/divine-spark-heal/success"

[consequence_frame_writes.frame_write.ModifyResource]
actor = "Actor"
delta_source = "-1"
resource = "srd/cleric/channel-divinity-uses"

[[consequence_frame_writes]]
ordinal = 1
template_id = "srd/cleric/divine-spark-heal/success"

[consequence_frame_writes.frame_write.ModifyResource]
actor = "TargetActor"
delta_source = "max(0, 1d8)"
resource = "srd/hp"
```

## Proof

- `packages/spellkave-adventure-kavemouth/tests/offline/kavemouth-class-features-actor-carried.test.ts`
- `packages/spellkave-srd-cc/src/test/offline/caster-features-units.test.ts`
- `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/second-wind.ts`,
  `…/channel-divinity.test.ts`

## Related

[`resource-spend-with-option-menu`](./resource-spend-with-option-menu.md)
(one pool, several spend options),
[`extra-action-budget`](./extra-action-budget.md) (a feature that grants
budget instead of an effect),
[`affordance-needs-niche-attachment`](../repairs/affordance-needs-niche-attachment.md),
[`sibling-resource-predicate-seeds`](../repairs/sibling-resource-predicate-seeds.md).

## Known misuse / anti-pattern

- Do **not** stretch this pattern to Halfling Lucky nat-1 auto-reroll: the
  reaction can be actor-carried, but eligibility still cannot read die faces
  (`packages/spellkave-srd-cc/docs/substrate-verdicts/lucky-nat1-reroll.md`).
- A `capability:*` niche without `provider`, or attached to a place.
- Granting the capability at confirm but not seeding its uses.
- Filing "feature not offered in the tomb" as an affordance-resolution
  bug.

## SRD features that use this

- Second Wind, Action Surge (charged by level-up), Rage, Channel Divinity
  (Divine Spark), Bardic Inspiration, Wild Shape uses, Lay On Hands, Innate
  Sorcery. Tables:
  [`caster-features-l1-4.md`](../../../spellkave-srd-cc/docs/caster-features-l1-4.md),
  [`character-creation.md`](../../../spellkave-srd-cc/docs/character-creation.md)
  § "Where a class feature can then be used".
- Spread Caltrops, Spill Ball Bearings: not class features, but the same
  actor-provided niche (`capability:srd/action/utilize`). They spend the
  carried item instead of a use pool
  ([`equipment-catalogue.md`](../../../spellkave-srd-cc/docs/equipment-catalogue.md)
  § "Area hazards").
