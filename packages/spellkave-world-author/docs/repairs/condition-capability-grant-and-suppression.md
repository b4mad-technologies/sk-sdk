# `grants_capability_while_active` grants a capability while a condition holds — and `suppresses_capability_while_active` takes one away

Both fields on `[[condition_definitions]]` are lists of `capability_id`s, and
both are enforced at one site: `capability_ids_for_actor`
(the world API).
Every gate that decides what a body may DO reads through it — the
materialiser's structural `affordance_template.capability_id` check, the act
path, movement, sensing, and the DSL fact pool — so a condition adds or removes
an ability in ONE place, with no per-affordance wiring. The same site also
folds identity-tag grants and equipped-item grants (see below); suppression
still wins over every grant source.

```toml
[[condition_definitions]]
condition_definition_id = "srd/condition/incapacitated"
bundle_id = "srd"
display_name = "Incapacitated"
grants_capability_while_active = []
suppresses_capability_while_active = ["srd/action/communicate/speak"]
```

## Why a grant is not expressible as a status, and vice versa

An `affordance_template` carries a **structural** `capability_id` gate: without
the capability the affordance is never offered at all. A `condition` is only a
fact, which each predicate must remember to read. So:

- **A condition that grants an ability while it lasts** (Rage, a granted
  spell while Blessed) belongs in `grants_capability_while_active`.
- **A ring that grants a spell while worn** belongs in
  `entity_definitions.grants_capability_while_equipped` (CSV of capability
  ids on the item definition), not on a condition. Modelling either as
  `ApplyStatus` + `actor.status(...)` means throwing away the structural gate
  on the spell's affordance and rebuilding it by hand in that affordance's
  predicate — and in every other affordance the grant should open.
- **"Can't speak" while Incapacitated** belongs in
  `suppresses_capability_while_active`. The status route would need every
  authored predicate to remember `!actor.status('...')`; one that forgets is a
  silent hole.

The two are not interchangeable in either direction. Granting ADDS to an open
vocabulary; suppressing SUBTRACTS from it. Expressing a grant as a suppression
would mean first giving every entity every conceivable capability and then
masking — which an open vocabulary cannot do.

`ApplyStatus` + `actor.status(...)` (the bane/bless/bardic-inspiration idiom)
remains the right tool for a fact a predicate reads: "is blessed", "has taken
the Grappler feat". Reach for the capability fields when the thing you are
granting or removing is an **ability to act**.

## Suppression applies to the ACTOR, never to the target

A condition that stops a creature acting does not stop it being acted upon.
"Speak with Dead" is the caster's affordance targeting a corpse that is itself
Incapacitated, and it stays authorable: the Target-subject fact pool
deliberately does not apply the fold, so the corpse still carries the
capability a caster's spell may name. Only its own attempts to act are gated.

## Equipped items share this fold

`entity_definitions.grants_capability_while_equipped` is a *source*, not a
seeded `capability` row. Equip writes only an `entity_equipment_slot`; unequip
deletes it; `capability_ids_for_actor` scans occupied slots on read and unions
the CSVs into the wearer's grant set (bead sk-54d / #2940). Order inside the
fold is identity grants, then equipped-item grants, then condition grants;
`fold_actor_capabilities` then applies suppression. Unequipping drops only that
item's ids. `grants_capability_while_present_in_location` is still unread.

## Precedence: suppression wins

If one active condition grants a capability and another suppresses it, the
result is suppressed. The same pass suppresses an equipped-item grant: a
paralysed wearer of a spell-granting ring does not cast through the paralysis.
This mirrors the action-economy rule where a condition's `FlatSet` pool beats a
positive `ModifyChannel` grant — taking an ability away is a safety statement,
adding one is a convenience, and a tie fails closed.

Both lists are unioned across every active condition, and the
`implies` cascade carries them: `dead implies incapacitated` suppresses through
the cascade with no re-declaration, because the cascade materialises each
implied condition as its own `target_condition` row.

## History

This field shipped as **dead metadata** — written by the manifest committer,
read by nothing — and as a CSV-in-a-string. Authoring it validated and seeded
cleanly, then silently did nothing; the `dead-grants-capability-while-active`
lint (#1846) existed to warn authors off it. Bead sk-syo made it real, added
the suppressing twin, turned both into proper lists, and retired that lint. If
you find prose anywhere claiming this field is inert, it predates sk-syo.

The sibling column `grants_capability_while_equipped` had the same
dead-metadata shape (Equip never seeded a capability row) until sk-54d folded
it into `capability_ids_for_actor`. Do not re-teach a worn item as a condition
grant to work around that; the item column is the primitive.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
