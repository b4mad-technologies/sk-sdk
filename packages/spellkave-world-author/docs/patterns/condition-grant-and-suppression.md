# Condition capability grant and suppression

## Name

`condition-grant-and-suppression` — Condition capability grant and suppression

## Problem

While a condition holds I need to grant or remove an ability to act (a capability), not just a fact a predicate might forget to read.

## Forces

- Affordance admission is structural on `capability_id` — status facts alone leave silent holes.
- Suppression must apply to the actor's own attempts, never make them an illegal target.
- Suppression wins over grant when both are active.

## Solution

Set `grants_capability_while_active` / `suppresses_capability_while_active` on
`[[condition_definitions]]`. Enforced in `capability_ids_for_actor` (same fold
as identity-tag grants and `entity_definitions.grants_capability_while_equipped`;
suppression still wins). Full repair:
[`repairs/condition-capability-grant-and-suppression.md`](../repairs/condition-capability-grant-and-suppression.md).

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/playing-the-game/conditions.toml`
(Dead suppresses, Unconscious grants; descriptions and default-valued fields
omitted):

```toml
[[condition_definitions]]
bundle_id = "srd"
condition_definition_id = "srd/condition/dead"
display_name = "Dead"
gate_predicate_source = ""          # required field, may be empty
implies = ["srd/condition/incapacitated"]
suppresses_capability_while_active = [
    "srd/action/attack",
    "srd/capability/walk",
    "srd/capability/death_save",
    # … dodge, help, drop-prone, short-rest, long-rest
]

[[condition_definitions]]
bundle_id = "srd"
condition_definition_id = "srd/condition/unconscious"
display_name = "Unconscious"
gate_predicate_source = ""
grants_capability_while_active = ["srd/capability/death_save"]
```

## Proof

- Kernel fold unit tests in
  the world API:
  `suppression_removes_the_capability_from_the_actor_set`,
  `a_grant_adds_a_capability_the_body_does_not_own`,
  `suppression_beats_a_grant_of_the_same_capability` (`:1295-1332`).
- The fold applies to the **actor** subject only; `target.has_capability`
  reads raw capability rows (`entity_facts.rs:185-201` vs `:346-351`; decision
  `sk-jay0.2.48`).
- Repair doc: [`repairs/condition-capability-grant-and-suppression.md`](../repairs/condition-capability-grant-and-suppression.md).

## Explain the condition to its holder

Set `condition_definitions.description` to a plain-text explanation. Manifest
application persists that prose on the `condition_definition_description`
satellite (the catalog `condition_definition` row stays binary-compatible).
An empty or omitted description deletes the satellite row. Granular condition
update preserves existing prose.
The text does not grant or suppress capabilities: those effects still come
from the fields above. Authorized PLAYER condition detail returns nonblank
prose for the holder's existing instances; missing prose stays absent.
The compact self summary retains its existing condition fields.

Persistence and authorized-read proof:
`condition-descriptions.md`
(historical captured evidence at the linked revision).

## Related

[extra-action-budget](./extra-action-budget.md) (channel FlatSet vs capability suppress), [action-economy](../action-economy.md), [identity-tag-capability-grant](./identity-tag-capability-grant.md) (the other grant sources in the same fold), [equip-gated-modifier](./equip-gated-modifier.md) (numeric bonus while equipped — not a capability).

## Known misuse / anti-pattern

- **Applying a condition with no way out.** `ApplyStatus` takes an optional
  `expires_at_boundary` (`{ boundary_id, owner_actor }`, worked example in
  [`action-economy.md`](../action-economy.md)); omit it and the condition
  persists until something explicitly removes it. That is correct for a
  condition its subject can end, and a trap for one it cannot. Kavemouth
  shipped a Prone that lasted forever — inflictable on a player by a monster,
  via the Topple weapon-mastery rider, with no save and no Stand Up authored
  (`sk-0m4.120.50`). Before authoring a condition, name the thing that ends
  it; if the answer is "an action nobody has built yet", give it a boundary.
  Note the two generated references do not show this field: `dsl-grammar.md`
  documents the DSL operator (which genuinely has only `subject` and
  `condition_definition_id`) and says in its own text that the manifest row
  is a different, structured shape.


Modelling a ring-granted spell as ApplyStatus + predicate, or as
`grants_capability_while_active` on a condition — put it on the item's
`grants_capability_while_equipped` CSV. Using suppression to block being
targeted (Speak with Dead must still work on a corpse).

## SRD features that use this

- **Dead** suppresses attack, dodge, help, drop-prone, rests, walk and death
  saves (`conditions.toml:100-122`).
- **Unconscious** grants `srd/capability/death_save` (`conditions.toml:130`).
- **See Invisibility** grants `srd/capability/see_invisibility`
  (`perception-conditions.toml:151`).
- Not this pattern: Bless / Bane / Guidance / Resistance are roll modifiers
  (`condition_roll_mod`), and Hold Person is a primary-channel FlatSet
  ([extra-action-budget](./extra-action-budget.md)).
- Incapacitated suppresses nothing yet (`conditions.toml:98`); speechless
  gating is not authored.
- Worn items that grant a spell belong on `grants_capability_while_equipped`, not this pattern.
