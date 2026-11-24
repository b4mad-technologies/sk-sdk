# Cross-party capability gate

## Name

`cross-party-capability-gate` — My condition gate must read the OTHER party's capability

## Problem

A condition on one creature must open or close based on a capability held by
someone else in the same roll — the attacker has Darkvision, the attacker has
See Invisibility, the target still has a counter-sense. A gate that only sees
the bearer's own facts silently fails closed (`has_capability` → false).

## Forces

- Condition `gate_predicate_source` evaluates against the roll-bias fact pool,
  not the affordance-selection pool.
- Before sk-609b.16 that pool carried distance only; capability facts were
  absent, so every `actor.has_capability(...)` in a gate was always false.
- ADR-0045 D-4 forbids a second `capability` table scan — the gate pool must
  reuse `subject_capability_facts`.
- Actor and Target subjects both matter: In Darkness gates on the actor;
  Invisible gates on the attacker while the condition sits on the target.
- **The two subjects do not see the same capabilities.** `actor.has_capability`
  folds identity-tag, equipped-item and condition grants (and suppression);
  `target.has_capability` reads only the target's raw `capability` rows
  (the world API,
  `:185-201` vs `:346-351`). A gate on a *target's* granted sense (e.g. See
  Invisibility from the condition) is therefore false. Keep counter-capability
  reads on the actor, as the shipped gates below do (decision `sk-jay0.2.48`).

## Solution

1. **Kernel (already shipped sk-609b.16):**
   `manipulation_spatial_gate_facts` populates `capabilities` via
   `subject_capability_facts(ctx, Some(actor_ref), Some(target_entity_ref))`.
   Every roll-bias seam goes through `roll_bias::resolve`.
2. **Content:** author the condition with a gate that names the counter-capability:
   - In Darkness on the actor:
     `gate_predicate_source = "actor.has_capability('srd/capability/darkvision') == false"`
     + actor-side `srd/attack_roll` Disadvantage.
   - Invisible on the target:
     `gate_predicate_source = "actor.has_capability('srd/capability/see_invisibility') == false"`
     + target-side `ResolutionCheck` Disadvantage (and a twin actor-side
     Advantage on `srd/attack_roll`).
3. **Counter-capability grant:** See Invisibility is a timed condition with
   `grants_capability_while_active = ["srd/capability/see_invisibility"]`
   ([condition-grant-and-suppression](./condition-grant-and-suppression.md)).
4. **Dark node entry:** apply In Darkness via
   `spatial_niche_attachment.on_entry_action_id` (idiom:
   [authored-dark-cave](../examples/authored-dark-cave.md)) — do not invent a
   place-level env-state fact for the roll-bias pool.

## TOML example

From `packages/spellkave-srd-cc/fixtures/base/playing-the-game/perception-conditions.toml`
(generator: `src/chapters/playing-the-game/fragments/perception-conditions.ts`):

```toml
[[condition_definitions]]
condition_definition_id = "srd/condition/invisible"
gate_predicate_source = "actor.has_capability('srd/capability/see_invisibility') == false"
modifier_template_id = "srd/condition/invisible/attack_disadvantage"

[[modifier_templates]]
modifier_template_id = "srd/condition/invisible/attack_disadvantage"
applies_to = "ResolutionCheck"
delta_kind = "Disadvantage"
```

## Proof

- Server: `gate_predicate_reads_injected_actor_and_target_capability_facts`
  in `server/.../roll_bias.rs`.
- Design: `packages/spellkave-srd-cc/docs/substrate-verdicts/perception-kernel-design.md`.
- Offline fixture pins on the generated perception-conditions rows.

## Related

[condition-grant-and-suppression](./condition-grant-and-suppression.md),
[before-filing-a-kernel-gap](./before-filing-a-kernel-gap.md),
[offer-vs-resolution-roll](./offer-vs-resolution-roll.md).

## Known misuse / anti-pattern

- Filing a kernel gap for "gates can't see the other party" without grepping
  `selection/entity_facts.rs` and `roll_bias.rs` first.
- Baking a place env-state into the roll-bias pool instead of ApplyStatus on
  entry (violates the five binding conditions in the design note).
- A second raw `.capability().entity_id()` scan outside the one populator.

## SRD features that use this

- In Darkness / Darkvision (species traits + Darkvision spell grant).
- Invisible / See Invisibility / (later) Truesight.
