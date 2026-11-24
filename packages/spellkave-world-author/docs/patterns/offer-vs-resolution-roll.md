# Offer vs resolution roll (the d20 lives in act-time resolution)

## Name

`offer-vs-resolution-roll` — Offer proves attemptability; the roll lives in resolution

## Problem

I need an attack or check that can miss: where does the d20 go so the verb is always offered when it is attemptable, and only the act decides hit or miss?

## Forces

- Disclosure does not evaluate the template predicate: the materialiser
  offers a template when the actor holds its `capability_id`
  (the world API).
  The template predicate runs at act time with live draws
  (the world API).
  A die there turns a miss into a **rejected attempt**
  (`predicate_rejected`): no `on_failure` consequence runs and the rejection
  looks exactly like an ineligible target. (Before capability-only
  disclosure the same die also hid the verb: never once offered across 35
  live attempts.)
- Offer predicates that read a target fact force `Place` locality and turn
  a target (an argument) into a precondition.
- A miss needs its own authored outcome, not "nothing happened".
- A `let`-bound die in an *affordance* predicate classifies as Global under
  the validator's conservative locality pass.

## Solution

Split the verb into three stages:

1. **Offer** — `affordance_templates.predicate_source` proves only
   *attemptability*: capability, wielded-item identity, range/reach. No
   die, no target-defense read.
2. **Resolution** — `action_definitions.resolution_mode = "Stochastic"` +
   `resolution_predicate_source` holds the roll vs the target's effective
   defense, with an explicit `on_failure` consequence for the miss. srd-cc
   also sets `accepts_global_storm = true` on the attack affordances; the
   resolution die does not require it, because the validator's locality
   pass reads only `affordance_templates.predicate_source`
   (`crates/spellkave-validate/src/lib.rs:554-600`).
3. **Consequence** — the hit's `ModifyResource` damage write. As of
   sk-awlo `delta_source` is macro-aware at act time — inline the formula
   for a genuinely one-off number, or call a macro when the same formula
   already has a named, reusable definition (see
   [`derived-value-mechanism`](./derived-value-mechanism.md)).

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/playing-the-game/attacks.toml`
(description and default-valued fields omitted):

```toml
[[action_definitions]]
action_id = "srd/attack/melee"
bundle_id = "srd"
display_name = "Melee Attack"
on_failure = "srd/attack/melee/miss"
on_success = "srd/attack/melee/success"
required_capability = "srd/action/attack"
resolution_mode = "Stochastic"
resolution_predicate_source = "let attack_roll = d20; macro('srd/attack_roll_hits', attack_roll, attack_roll + macro('srd/ability_modifier', cond(actor.equipped_item('srd/slot/main-hand').has_tag('srd.weapon.property.finesse'), max(actor.effective('srd/str'), actor.effective('srd/dex')), actor.effective('srd/str'))) + (actor.stat('srd/proficiency_bonus')), (target.effective('srd/ac')), cond(actor.has_capability('srd/class-feature/fighter/champion/improved-critical'), 19, 20))"
resolution_scope = "srd/attack_roll"
self_eligible = false
spends_channel = "srd/economy_channel/primary"
```

`srd/attack_roll_hits` takes four arguments (roll, total, AC, crit
threshold; `fixtures/base/playing-the-game/macros.toml`); the DSL rejects a wrong
argument count (`crates/spellkave-dsl/src/lib.rs:1785`).

The matching affordance's `predicate_source` checks only the wielded item's
range identity and distance — never AC.

## Proof

- `packages/spellkave-srd-cc/src/test/offline/attack-roll-units.test.ts`
- `packages/spellkave-srd-cc/src/test/offline/making-an-attack-units.test.ts`
- `packages/spellkave-srd-cc/src/test/offline/generic-check-units.test.ts`
  (checks use the same split with a DC)

## Related

[`item-sourced-damage`](./item-sourced-damage.md),
[`derived-value-mechanism`](./derived-value-mechanism.md),
[`multiattack-ordinals`](./multiattack-ordinals.md) (several rolls inside
one consequence), [`interaction-dsl-and-world-authoring`](../interaction-dsl-and-world-authoring.md).

## Known misuse / anti-pattern

- `d20` (or any die) in an affordance predicate (a miss becomes a rejection).
- A "strikeable" offer gate such as `target.stat('<ac>') >= 1` (retired: a
  target is an argument, not a precondition; it also forces locality).
- An action with no `on_failure` for a stochastic resolution.
- Filing "attack never offered" as a materialiser bug before checking the
  actor holds the template's `capability_id`.

## SRD features that use this

- Melee / Ranged / Unarmed / Opportunity Attack, every `srd/check/<subject>`
  verb, saving-throw style scene checks. Pipeline details:
  [`attack-and-damage.md`](../../../spellkave-srd-cc/docs/attack-and-damage.md).
- Thrown Acid, Alchemist's Fire, Holy Water (`srd/item/<slug>/throw`): the
  target's Dexterity save, written from the thrower's side
  (`d20 + DC - mod >= 22`, same unbiased odds). The target's own save
  modifiers are not routed onto that d20; its against-bearer attack bias is
  (sk-jay0.2.41). Details:
  [`equipment-catalogue.md`](../../../spellkave-srd-cc/docs/equipment-catalogue.md#thrown-consumables).
