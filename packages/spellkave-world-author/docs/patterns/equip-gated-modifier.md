# Equip-gated modifier (numeric stat modifier active while item is equipped)

## Name

`equip-gated-modifier` — Equip-gated modifier (item definition links to a modifier template via `entity_definition_equip_modifier`)

## Problem

An item (armor, shield, ring, magic item) provides a continuous numeric bonus or replacement (e.g. Armor Class, Speed, saving throw bonus) while equipped in a valid equipment slot on an actor, and that modifier must automatically deactivate when the item is unequipped or removed.

## Forces

- Modifier must track equip state directly from `entity_equipment_slot` without requiring point-in-time condition sync (`ApplyStatus`/`RemoveCondition`) on every equip/unequip path.
- Multiple equipped items modifying the same stat (e.g. body armor replacing AC + shield adding +2) must compose deterministically through `compose_modifiers_by_shape`.
- Unarmored actors or actors without the item equipped must not pay any phantom modifier.

## Solution

1. Define the item in `[[entity_definitions]]` with its `slot_compatibility_predicate` using the closed three-form grammar (ADR-0118), e.g. `slot_id == "srd/slot/chest"` — not a bare slot id and not `spellkave-dsl`.
2. Author a `[[modifier_templates]]` row on the target axis (e.g. `srd/ac`), with the appropriate `delta_kind` (`FlatSet` for armor replacement, `Plus` for shield/bonus) and expression.
3. Link the item definition to the modifier template in `[[entity_definition_equip_modifier]]`:
   - `entity_def_id` = the item definition ID (e.g. `srd/armor/chain-mail`)
   - `modifier_template_id` = the modifier template ID (e.g. `srd/armor/chain-mail/ac_bonus`)
   - `bundle_id` = the owning bundle (e.g. `srd`)
4. At runtime, the kernel's `fold_effective_int_facts` scans the actor's `entity_equipment_slot` memberships, resolves the equipped items' `entity_definition_equip_modifier` rows, lifts the modifier templates, and composes them into `target.effective('<stat>')`.

## Numeric wearer facts and dependency limits

An equipped template's numeric value can read current wearer integers with
`actor.stat('<field>')` and composed integers with
`actor.effective('<field>')`. Here `Actor` is the wearer, including when
an outer action reads a Target's equipment. The template's `Target` is not
bound to either wearer or attacker. Macro expansion uses the same facts.
Ordinary state changes take effect on the next collection; do not copy a
wearer stat onto the item or synchronize it with equip callbacks.

This admission is for numeric values. Template predicates retain their
existing world/equipment fact context; a wearer stat/effective read missing
there still makes that predicate false. Existing condition-row evaluation
also keeps its own context. An equipped value can nevertheless read an axis
whose effective value combines already lifted condition rows and other
linked equipment modifiers.

Effective dependencies resolve before their consumers. Raw `stat` reads
remain leaves; they do not read the overlay. Self-dependencies, multi-axis
cycles, missing dependencies, and uninspectable item sources refuse the
collection rather than silently dropping a contribution. All root-reachable
numeric branches are inspected, so even an inactive branch can introduce a
refused cycle. Directly selected item-source expressions retain their
existing one-source-layer limit and evaluate with the same subjects.

Per wearer collection, the admitted graph allows at most 512 distinct axes,
512 distinct reachable numeric expression nodes (shared expressions and
selected sources count once), and an effective chain of 64 axes. Each
expression retains its DSL evaluation/draw bounds. Verified wearer-free
sets retain the existing fold and bounds; an unresolved source cannot be
classified as wearer-free. Refusal returns no partial overlay. It can also
prevent ordinary actions, including unequip, whose facts need that fold;
an authorized author/operator can repair the bad template or link through
existing authoring paths, after which normal player actions resume.

Strict handling applies to wearer-reading/source-inspection axes and their
effective dependencies. Unrelated axes retain legacy lift/composition
omissions and do not consume the strict graph's node budget. A numeric axis
with modifying rows retains the existing zero starting value when no raw
row exists, including when another modifier reads that axis effectively.
An effective read with neither a raw row nor modifying rows remains unknown.

Current target facts are collected eagerly: cyclic gear can also refuse an
action against its wearer even when that action reads no effective value.
`EquipItem` validates the prospective graph before its equipment/lifecycle
writes: cyclic, unresolved or exhausted dependencies refuse admission. A
second item closing a cycle also refuses. The live fixture proves denied
PLAYER equip leaves the wearer targetable; publisher-staged legacy bad sets
retain the collection/refusal and author-repair controls.

Preparation includes earlier equips and resource writes. Pending items use
the insertion's resolved `initial_item_state`, definition tags and sources,
without a synthetic entity ID. Earlier condition, tag/text, lifecycle or other
unprojected writes conservatively refuse before stale gate/source evaluation,
including for literal-only candidates. Split such frames into actions or
author the equip before those writes, with the intended consequences reviewed.
This constraint also applies to plain equipment after `Inscribe` (the
structured EmitTrace surface), `ModifyChannel`, `OpenSession` or
`ForEachActorInRadius`; their effects are not projected for this admission.
Resource-before-equip frames also refuse when an active ResourceDelta condition
hook may run: the resource overlay cannot project its synchronous side effects,
and preparation does not guess whether a dynamic detail filter will stay false.
The guarantee is validity at admission before the candidate's own lifecycle;
that hook, later writes or predicate changes can still invalidate the graph.
Author validation emits advisory `MF-VAL-390` for possible cycles, unbound
Target reads, unresolved sources or exhausted inspection limits. Ordinary wearer
raw/effective leaves are valid dependencies, including Dexterity-reading armor;
they do not independently emit a hazard. Runtime admission uses the concrete
wearer snapshot and diagnoses missing leaves there. The doctor check
`equipped_numeric_dependencies_resolve` reports current bad wearer sets.
Starting equipment seeded by `Spawn` or `CreateWorldObject` does not pass
through this EquipItem guard. Cyclic starting gear, as well as later state,
tick or lifecycle changes, can still make its wearer unavailable. The checkout
starting-gear audit found zero wearer-reading sets (312 seed rows, 311
definitions); this does not constrain new authoring. Lazy Target evaluation
is the commissioned P1 follow-up `sk-jay0.2.71`; do not use collection refusal
as a protection mechanic.

Composition uses the existing law: a `FlatSet` result absorbs `Plus`
in the same bucket. Include an intended body-armor enhancement in its
replacement expression; a separate `Plus` does not augment that replacement.
This fact admission does not change that law or complete the separate SRD
magic-armor content repair.

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/equipment/armor/chain-mail.toml`:

```toml
# pattern: equip-gated-modifier

[[entity_definitions]]
bundle_id = "srd"
description = "Chain Mail (Heavy Armor, static AC 16)..."
display_name = "Chain Mail"
entity_def_id = "srd/armor/chain-mail"
slot_compatibility_predicate = 'slot_id == "srd/slot/chest"'

[[modifier_templates]]
applies_to = "srd/ac"
bundle_id = "srd"
delta_kind = "FlatSet"
display_name = "Chain Mail AC 16"
modifier_expression_source = "let ac = 16; ac"
modifier_template_id = "srd/armor/chain-mail/ac_bonus"
predicate_source = ""
priority = 0

[[entity_definition_equip_modifier]]
bundle_id = "srd"
entity_def_id = "srd/armor/chain-mail"
modifier_template_id = "srd/armor/chain-mail/ac_bonus"
```

## Proof

- `packages/spellkave-srd-cc/src/test/live-self-seeding/scenes/equipped-modifier-wearer-facts.test.ts` (PLAYER values, gates, dependencies, refusal/recovery, isolation and session policies)
- `packages/spellkave-srd-cc/src/test/offline/armor-units.test.ts`
- `packages/spellkave-srd-cc/src/test/offline/equipment-coverage.test.ts`

## Related

[`item-sourced-damage`](./item-sourced-damage.md) (wielded weapons), [`derived-value-mechanism`](./derived-value-mechanism.md), [`damage-type-routing`](./damage-type-routing.md).

## Known misuse / anti-pattern

- Trying to manage armor AC through `on_equip_consequence_id` firing `ApplyStatus` (risks orphan conditions if removal fails).
- Hardcoding the AC on the actor's initial state and forgetting to recalculate on equip/unequip.
- Using `Plus` instead of `FlatSet` for base body armor (body armor replaces base AC; use `Plus` for additive buckets, accounting for the FlatSet absorption law above).

## SRD features that use this

- All 13 SRD armors and shields (`fixtures/base/equipment/armor/*.toml`).
- Magic items granting +N AC or stat bonuses while worn/attuned — intended,
  but not wired: magic armor ships `modifier_templates` (e.g.
  `magic-items/armor/chain-mail-plus-2.toml`) with no
  `entity_definition_equip_modifier` link, so neither its base AC nor its
  bonus applies (bug `sk-jay0.3.19.9`).
