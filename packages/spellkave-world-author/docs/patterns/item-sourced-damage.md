# Item-sourced damage (weapon slot read by a shared attack)

## Name

`item-sourced-damage` — Item-sourced damage (the wielded item owns its magnitude)

## Problem

I need to give a weapon — manufactured or a monster's Bite/Slam — its own damage so ONE shared attack verb deals the right amount, without a bespoke action per weapon or per creature.

## Forces

- A per-creature attack verb would appear in every palette that shares the
  capability (a wolf's Bite clone shows up for the fighter).
- The magnitude must compose with attacker facts (ability modifier) and
  target facts (resistance), which a roll table cannot do.
- Exactly one site may own the sign: negate in both the slot and the write
  and they cancel; negate in neither and you heal the target.
- The to-hit side and the damage side must select the **same** ability
  (finesse is "for the attack and damage rolls").
- A tagged weapon with no damage slot must fail loudly, not deal nothing.

## Solution

1. The item carries a **positive magnitude** in an
   `entity_definition_item_dsl_source` row, slot `<bundle>/damage`
   (`<die> + <ability modifier>`; item slots are macro-aware). A ranged
   item carries a second slot for its normal range.
2. The item carries its identity tags: the weapon tag, the range class
   (`<melee|ranged>`) the shared offer predicate reads, and a documentary
   damage-type tag that the shared write reads for routing.
3. The **shared attack write** reads
   `actor.equipped_item('<bundle>/slot/main-hand').source('<bundle>/damage')`, negates once, and
   composes the defense ladder
   ([`damage-type-routing`](./damage-type-routing.md)) keyed by the item's
   damage-type tag.
4. **Natural weapons are wielded items**: tag them with the same weapon +
   range identity (no purchase category / mastery axes), seed them via
   definition-level initial equipment so every spawned instance is born
   with one. Derive the finesse tag per creature by comparing the source's
   damage bonus against both ability modifiers — never assume it.

The site that owns the `ModifyResource` owns the sign: item slots are
positive and are negated by the shared write; a spell or trap, which has no
item, negates at its own write site.

The slot is authored vocabulary, not a built-in weapon classification. Declare
it and use the same slot for equipment seeds, offer gates, to-hit checks and
damage reads. ADR-0126 supplies facts only for exactly one existing item in
that actor-slot relation; missing, dangling or ambiguous occupancy has no item
facts and does not fall back to carried items. Item source expressions retain
the surrounding Actor and Target. The legacy `actor.wielded_item` accessor
remains available, but its minimum-ID selection is unsuitable when unrelated
equipment must not determine which weapon this pattern reads.

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/monsters/giant-rat.toml`
(a natural weapon is a wielded item):

```toml
[[entity_definition_initial_equipment]]
bundle_id = "srd"
entity_def_id = "srd/creature/giant-rat"
equipped_entity_def_id = "srd/natural-weapon/giant-rat-bite"
slot_id = "srd/slot/main-hand"

[[entity_definition_item_dsl_source]]
bundle_id = "srd"
entity_def_id = "srd/natural-weapon/giant-rat-bite"
slot = "srd/damage"
source = "1d4 + (max(macro('srd/strength_modifier'), macro('srd/dexterity_modifier')))"

[[entity_definition_tag]]
entity_def_id = "srd/natural-weapon/giant-rat-bite"
tag = "srd.weapon"
# + srd.weapon.range.melee, srd.weapon.property.finesse (DEX-driven per the source), srd.damage_type.piercing
```

Shared write, simplified from
`packages/spellkave-srd-cc/fixtures/base/playing-the-game/attacks.toml`
(one ladder branch; the melee variants also add
`cond(actor.status('srd/condition/raging') == true, 2, 0)` to `dmg`):

```toml
[consequence_frame_writes.frame_write.ModifyResource]
actor = "TargetActor"
resource = "srd/hp"
delta_source = "cond(actor.equipped_item('srd/slot/main-hand').has_tag('srd.damage_type.piercing'), 0 - (let dmg = max(0, actor.equipped_item('srd/slot/main-hand').source('srd/damage')); cond(target.has_tag('damage_immune:piercing'), 0, cond(target.has_tag('damage_resist:piercing'), dmg / 2, cond(target.has_tag('damage_vulnerable:piercing'), dmg * 2, dmg)))), …)"
```

## Proof

- `packages/spellkave-srd-cc/src/test/offline/weapon-attack-units.test.ts`
  (finesse branch, item identity gate)
- Fail-closed on a missing slot: `MissingItemDslSource` in
  `crates/spellkave-dsl/src/eval.rs:1454` (unit tests at `:3419-3460`); the
  validator warns at authoring time (`crates/spellkave-validate/src/refs.rs:694`)
- `packages/spellkave-srd-cc/src/test/offline/weapon-units.test.ts`
- `packages/spellkave-srd-cc/src/test/offline/damage-units.test.ts`
- `packages/spellkave-srd-cc/src/test/live-self-seeding/monsters/starter-arena.test.ts`

## Related

[`damage-type-routing`](./damage-type-routing.md) (the ladder and the two
helpers), [`derived-value-mechanism`](./derived-value-mechanism.md) (macros
legal on slots AND on `delta_source`; prefer the item slot for reusable
attacker math, `delta_source` for a one-off non-item-sourced number),
[`offer-vs-resolution-roll`](./offer-vs-resolution-roll.md),
[`weapon-stricter-affordance-variant`](../repairs/weapon-stricter-affordance-variant.md),
[`definition-seed-statblock`](../examples/definition-seed-statblock.md)
(definition-level equipment seeds).

## Known misuse / anti-pattern

- A per-creature `…/action/bite` verb cloned from the shared attack.
- Enumerating a die as an N-row weight-1 int roll table with a text
  pointer (retired idiom: it could not compose with any fact).
- Negating in the slot as well as at the write; or a spell that reuses the
  positive-magnitude helper at its own write site.
- Omitting the item because "the dice happen to match" — identity and
  affordance provenance are load-bearing.
- Tagging a natural weapon with purchase category / mastery axes, or
  assuming finesse from a sample of two creatures.

## SRD features that use this

- Every manufactured weapon (`fixtures/base/equipment/weapons/<slug>.toml`),
  every CR 0–4 natural weapon, Opportunity Attack's weapon branch. The
  attack archetype, reach/range ownership and the retired-idiom tombstone:
  [`attack-and-damage.md`](../../../spellkave-srd-cc/docs/attack-and-damage.md),
  [`authoring-damage.md`](../../../spellkave-srd-cc/docs/authoring-damage.md).
