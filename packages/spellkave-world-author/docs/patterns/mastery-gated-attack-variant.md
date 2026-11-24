# Mastery-gated attack variant (stricter sibling of a shared attack)

## Name

`mastery-gated-attack-variant` — A full sibling attack action gated on a
wielded-item (or class) tag, carrying its own hit consequence

## Problem

I need an on-hit rider (Weapon Mastery Sap/Vex, Sneak Attack dice, …) that
cannot live inside the shared melee/ranged success consequence, because the
shared write either (a) rebounds Actor away from the attacker inside
`ForEachActorInRadius`, or (b) already hosts a multi-type damage ladder that
another rider would have to be threaded through.

## Forces

- Offer predicates that read attacker-only facts
  (`equipped_item('<slot>').has_tag`, `has_capability`, a once-per-turn spent
  marker) are fine — they stay on the
  acting subject.
- Shared melee success cannot host a gated `ApplyStatus` that needs attacker
  weapon tags: `ForEach` rebinds Actor to the cell occupant (see
  `weapon-stricter-affordance-variant` and L12a mastery riders).
- Folding class riders into the 13-type damage tower has already failed
  validation once (Sneak Attack attempt 1 → MF-VAL-256, a frame-write DSL
  parse error). The parser has no nesting limit, so the failure was an
  authoring error in a very long expression, not a ceiling; the shipped
  Sneak Attack instead adds its dice as a separate ordinal
  (`sneak-attack.toml:100-106`).
- A miss still needs its own authored `on_failure` consequence
  ([`offer-vs-resolution-roll`](./offer-vs-resolution-roll.md)).

## Solution

Author a **dedicated shallow attack action** that is a full sibling of
`srd/attack/melee` / `srd/attack/ranged`:

1. **Offer** — capability + range + the distinguishing gate
   (`actor.equipped_item('srd/slot/main-hand').has_tag('srd.weapon.mastery.vex')`, or
   `actor.has_capability('srd/class-feature/rogue/sneak-attack')` +
   Finesse/Ranged + `!actor.status('…/expended')`).
2. **Resolution** — same Stochastic to-hit as the base attack
   (`resolution_scope = srd/attack_roll`, `accepts_global_storm = true`).
3. **Consequence** — weapon damage (item-sourced) **plus** the rider
   (`ApplyStatus`, conditional Nd6, …) as its own ordinal on the same shallow
   template — not folded back into the shared ladder. A rider that deals
   typed damage needs its own routing ladder; the shipped Sneak Attack dice
   are not type-routed.
4. **Once-per-turn** — prefer an actor-scoped spent condition with
   `expires_at_boundary = turn_start` / `owner_actor = Actor` (auto-clears next
   turn). Gate offer on `actor.status('…') == false`. Document the reset.

Cite this page from generator source (`// pattern: mastery-gated-attack-variant`)
and emitted TOML (`# pattern: mastery-gated-attack-variant`).

## TOML example

Sneak Attack (K-A facts) — `packages/spellkave-srd-cc/fixtures/base/playing-the-game/sneak-attack.toml`:

```toml
[[action_definitions]]
action_id = "srd/attack/sneak-attack"
bundle_id = "srd"
display_name = "Sneak Attack"
required_capability = "srd/action/attack"
resolution_mode = "Stochastic"
resolution_scope = "srd/attack_roll"
on_success = "srd/attack/sneak-attack/success"
on_failure = "srd/attack/sneak-attack/miss"
# offer predicate (generated) also requires Finesse|Ranged, dice ≥ 1,
# !status(sneak-attack-expended)

[[consequence_frame_writes]]
template_id = "srd/attack/sneak-attack/success"
ordinal = 0
# weapon damage + cond(resolution_roll_modifier == 1 || peers_near_target(...), Nd6, 0)
```

Vex mastery — `weapon-mastery-riders.toml` action `srd/attack/melee-vex`.

## Proof

- Offline: `packages/spellkave-srd-cc/src/test/offline/martial-features-coverage.test.ts` (#101 evidence)
- Offline: mastery riders unit summaries in `weapon-mastery-riders.ts`
- Live (when node up): `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/sneak-attack.ts`
- Kernel facts demo: `openspec/specs/world-interaction-kernel/demos/sk-609b-ka-resolution-facts.demo.md`

## Related

[`offer-vs-resolution-roll`](./offer-vs-resolution-roll.md),
[`item-sourced-damage`](./item-sourced-damage.md),
[`condition-grant-and-suppression`](./condition-grant-and-suppression.md),
[`weapon-stricter-affordance-variant`](../repairs/weapon-stricter-affordance-variant.md),
[`damage-type-routing`](./damage-type-routing.md).

## Known misuse / anti-pattern

- Folding another class rider into the shared multi-type damage tower.
- Putting `peers_near_target` / `core/resolution_roll_modifier` in an **offer**
  predicate (materialiser seam does not populate them — ADR-0105 G-1).
- Expecting `ForEachActorInRadius` body predicates to see attacker
  `equipped_item(...)` tags.
- Reading `actor.wielded_item` in a new gate: it is the legacy accessor that
  picks the lowest-id item (see [`item-sourced-damage`](./item-sourced-damage.md)).

## SRD features that use this

- Weapon Mastery Sap / Slow / Topple / Graze / **Vex**
- Rogue **Sneak Attack** (`srd/attack/sneak-attack`)
Not this pattern: Paladin **Divine Smite** (`srd/paladin/divine-smite`) is a
Deterministic self-contained action that debits `srd/spell_slot_1` and deals
2d8 radiant with no to-hit roll and no weapon damage
(`fixtures/base/classes/caster-features.toml:253-268`).
