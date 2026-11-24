# Damage-type routing via defense tags

## Name

`damage-type-routing` — Damage-type routing via defense tags

## Problem

I need fire/cold/etc. damage that respects immunity, resistance, and vulnerability without a kernel damage subsystem.

## Forces

- HP writes stay `ModifyResource`; only the amount is typed.
- Resistance must not double-roll dice; immune must short-circuit.
- Item slots that carry positive magnitude must not double-negate.

## Solution

Use `routeDamage` / `routeDamageMagnitude` from `@spellkave/world-author` (re-exported by shared tool runtime).
Tag defenses as `damage_immune:<type>`, `damage_resist:<type>`, `damage_vulnerable:<type>`.
Guide: [`damage-type-routing.md`](../damage-type-routing.md).

## TOML example

Copied from `packages/spellkave-world-author/docs/examples/damage-type-routing.toml`
(the shape `routeDamage` emits in srd-cc `src/chapters/spells/spell-behaviors.ts`):

```toml
[[consequence_frame_writes]]
ordinal = 0
template_id = "damage_routing/cast_fire_bolt/success"

[consequence_frame_writes.frame_write.ModifyResource]
actor = "TargetActor"
delta_source = "let dmg = 8d6; -cond(target.has_tag('damage_immune:fire'), 0, cond(target.has_tag('damage_resist:fire'), dmg / 2, cond(target.has_tag('damage_vulnerable:fire'), dmg * 2, dmg)))"
resource = "damage_routing/hp"
```

## Proof

- The worked example above: `docs/examples/damage-type-routing.toml`, validated by
  `packages/spellkave-world-author/src/__tests__/doc-evidence-examples.test.ts`.
- The helpers: `packages/spellkave-world-author/src/__tests__/damage.test.ts`.
- srd-cc offline: `src/test/offline/spells-coverage.test.ts` (BL-57),
  `thrown-consumables.test.ts`, `area-hazards.test.ts`.

## Related

[computed-literal](./computed-literal.md), [lingering-hazard-zone](./lingering-hazard-zone.md).

## Known misuse / anti-pattern

Hand-rolling a different ladder order. Putting defense tags on capability_definition_tag. Negating both in the item slot and at the write site.

## SRD features that use this

- Every typed SRD spell and breath/area monster attack that calls `routeDamage`
  (Fireball, Scorching Ray, dragon breath, …). **Not** the baked Multiattack
  ordinals: they subtract raw damage (see
  [`multiattack-ordinals`](./multiattack-ordinals.md); `sk-jay0.3.10.5`).
- Thrown Acid, Alchemist's Fire, Holy Water (`srd/item/<slug>/throw`).
- Caltrops pulse (`srd/item/caltrops/spread/pulse`): 1 Piercing, routed with
  `subject: "actor"` because the pulse binds each occupant as Actor.
