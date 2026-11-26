# Multiattack as baked ordinals

## Name

`multiattack-ordinals` — Multiattack as N independent rolled ordinals in one consequence

## Problem

I need a creature to make several attacks in one action (Multiattack), or an action whose numbers the shared attack archetype cannot host (flat damage, ability math that does not match the creature's facts).

## Forces

- There is no kernel multiattack primitive and none is needed: a
  consequence already holds an ordered list of frame writes.
- Each attack must roll its own d20 and its own damage.
- Later ordinals must observe earlier ordinals' committed state (lethal
  cascade, temp-HP lose-first).
- A bespoke creature verb must not leak into other actors' palettes.
- **What a baked ordinal gives up.** The generated ordinal compares
  `roll + to-hit >= AC` directly and subtracts raw damage. It does not call
  `macro('srd/attack_roll_hits', …)`, so it has no natural-20/natural-1 or
  critical-hit handling, and it has no damage-type ladder, so resistance,
  immunity and vulnerability are ignored (srd-cc
  `src/chapters/monsters/starter-behaviors.ts:224-233`; the breath/area route
  does route, `:340-346`). Tracked as `sk-jay0.3.10.5`. Add the ladder from
  [`damage-type-routing`](./damage-type-routing.md) by hand if a stat block
  needs it.

## Solution

Emit ONE action whose success consequence carries N `ModifyResource`
ordinals, each self-contained:
`let atkN_roll = d20; cond(atkN_roll + <to-hit> >= target.effective('<ac>'), 0 - (max(0, <damage>)), 0)`,
followed by the consequence-side idioms:

- **Lethality guard** as a trailing `ForEachActorInRadius` with
  `ball_radius 0` at `TargetSpatialRef`, predicate
  `actor.has_tag('<member>') && actor.stat('<hp>') <= 0` (membership before
  measurement — a co-located HP-less dummy raises `UnknownField` on the
  `stat` read; the kernel skips that occupant with a `write_failure`
  provenance row rather than aborting the batch, but the `has_tag` conjunct
  still belongs first). Inside that body the selected entity is `actor`, not
  `target`.
- **Sequential ordinals chain**: two writes in one consequence may depend
  on each other; ordinal k+1 sees ordinal k's result.

Gate a bespoke creature action with TWO capabilities with different jobs:
the affordance template's `capability_id` is per-creature (granted only by
that creature's definition — keeps "Black Bear — Multiattack" out of the
hero's palette), while the action's `required_capability` stays the shared
hostile-action discriminator the initiative watch keys on.

Check the arithmetic first: if the shared archetype plus an equipped item
already reproduces the stat block ([`item-sourced-damage`](./item-sourced-damage.md)),
prefer it — baked ordinals are the second route, not the default.

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/monsters/starter-behaviors.toml`
(Black Bear Multiattack, two attacks + lethality guard; other rows of the
same action omitted):

```toml
[[affordance_templates]]
accepts_global_storm = true
bundle_id = "srd"
capability_id = "srd/creature/black-bear/action"      # per-creature gate
niche_id = "srd/niche/attack-verb"
outcome_template_id = "srd/creature/black-bear/action/multiattack/outcome"
spends_channel = "srd/economy_channel/primary"
template_id = "srd/creature/black-bear/action/multiattack/affordance"

[[consequence_frame_writes]]
ordinal = 0
template_id = "srd/creature/black-bear/action/multiattack/success"

[consequence_frame_writes.frame_write.ModifyResource]
actor = "TargetActor"
delta_source = "let atk0_roll = d20; cond(atk0_roll + 4 >= target.effective('srd/ac'), 0 - (max(0, 1d6 + (2))), 0)"
resource = "srd/hp"

[[consequence_frame_writes]]
ordinal = 1
template_id = "srd/creature/black-bear/action/multiattack/success"

[consequence_frame_writes.frame_write.ModifyResource]
actor = "TargetActor"
delta_source = "let atk1_roll = d20; cond(atk1_roll + 4 >= target.effective('srd/ac'), 0 - (max(0, 1d6 + (2))), 0)"
resource = "srd/hp"

[[consequence_frame_writes]]
ordinal = 2
template_id = "srd/creature/black-bear/action/multiattack/success"

[consequence_frame_writes.frame_write.ForEachActorInRadius]
center_ref = "TargetSpatialRef"
predicate_source = "actor.has_tag('srd.monster') && actor.stat('srd/hp') <= 0"
shape_id = "core/area/node_ball"
shape_params_json = '{"ball_radius": 0}'

[[consequence_frame_writes.frame_write.ForEachActorInRadius.body]]

[consequence_frame_writes.frame_write.ForEachActorInRadius.body.ApplyStatus]
condition_definition_id = "srd/condition/dead"
target_kind = "entity"
target_ref = "Actor"
```

## Proof

- `packages/spellkave-srd-cc/src/test/offline/bestiary-cr0-4-coverage.test.ts`
- `packages/spellkave-srd-cc/src/test/offline/creature-units.test.ts`
- `packages/spellkave-srd-cc/src/test/live-self-seeding/monsters/starter-arena.test.ts`

## Related

[`offer-vs-resolution-roll`](./offer-vs-resolution-roll.md),
[`item-sourced-damage`](./item-sourced-damage.md),
[`ordered-resource-grants`](../repairs/ordered-resource-grants.md)
(ordinal ordering semantics),
[`definition-seed-statblock`](../examples/definition-seed-statblock.md).

## Known misuse / anti-pattern

- Filing "no multiattack primitive" as a kernel gap.
- Gating the bespoke action on the shared attack capability only (it then
  appears for every creature).
- Writing `target.stat(...)` inside a `ForEachActorInRadius` body (the
  loop rebinds the selected entity to `actor`).
- Reaching for baked ordinals when an equipped item would reproduce the
  numbers.
- Assuming a baked ordinal respects resistance or crits (see Forces).

## SRD features that use this

- CR 0–4 bestiary Multiattack (Black/Brown Bear and the rest), flat-1
  damage actions, ability-mismatch stat blocks. Route selection and the
  n/a list (breath/AoE, condition riders):
  `attack-and-damage.md` (`@spellkave/srd-cc` docs, not in this repository).
