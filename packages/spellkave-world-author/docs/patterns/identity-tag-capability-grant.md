# Identity-tag capability grant

## Name

`identity-tag-capability-grant` — Stable identity tags grant stable attempts

## Problem

Every creature should be able to walk, attack, dodge, rest and attempt checks — how do I grant that once instead of copying capability rows onto every definition, and when is a direct grant still right?

## Forces

- Copying universal capability rows onto every definition is cargo cult
  that drifts; a scenario adopting a blueprint must not re-copy them.
- Membership of a category (creature, player character) is not the same
  fact as a modality (can produce speech) or a competence (knows a
  language) — conflating them grants speech to corpses or to bodies that
  only *understand*.
- A capability is eligibility to attempt; the verb's predicate, resources,
  conditions, target, range and equipment still constrain the attempt.
- The effective capability union is an enforcement concept: direct-row
  listings do not expand tag, equipped-item, or condition grants.

## Solution

An actor's effective capabilities are the union of four independent
sources — use each for what it is:

| Source | Use it for | Example |
|---|---|---|
| `tag_capability_grant` | stable identity-derived attempts | `<bundle>.creature` → walk, attack, dodge, checks |
| explicit definition / instance grant | a narrow authored behavior or a sourced choice | a chosen skill proficiency, a DM's watch extent |
| `entity_definitions.grants_capability_while_equipped` | ability granted while the item occupies an equipment slot | a ring that grants Detect Magic |
| active condition | temporary behavior or suppression | [`condition-grant-and-suppression`](./condition-grant-and-suppression.md) |

Equipped-item CSVs are folded on read from occupied `entity_equipment_slot`
rows (same `capability_ids_for_actor` site as identity and conditions;
suppression still wins). Unequip drops that item's ids. Do not re-encode a
worn grant as a condition to work around a missing fold — that was the
pre-sk-54d workaround. Weapon *eligibility* still uses item tags (see the
SRD capabilities page), not this CSV.

Rules of thumb:

- Separate **attempt** from **proficiency**: `check/<skill>` (may attempt;
  from the creature tag) vs `skill/<skill>` (proficient; an explicit
  choice). The predicate adds the bonus only when the second is present.
- Separate **modality** from **membership** and **competence**: a vocal tag
  grants speech; the creature tag makes a body addressable; a language tag
  records competence. Derive the vocal tag from the source (an
  "understands only" line grants nothing).
- Tags that select rule branches (`<bundle>.monster`) grant nothing; tags
  consumed by equipped-item behavior (weapon range class) grant nothing
  either — every live tag names its concrete reader.
- Retain a direct grant only when its narrower source can be named.

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/playing-the-game/creature-identity.toml`:

```toml
[[tag_capability_grant]]
bundle_id = "srd"
capability_id = "srd/capability/walk"
tag = "srd.creature"

[[tag_capability_grant]]
bundle_id = "srd"
capability_id = "srd/action/attack"
tag = "srd.creature"

[[tag_capability_grant]]
bundle_id = "srd"
capability_id = "srd/action/dodge"
tag = "srd.creature"
```

## Proof

- `packages/spellkave-srd-cc/src/test/offline/character-identity-units.test.ts`
- `packages/spellkave-srd-cc/src/test/offline/creature-units.test.ts`
  (vocal tag derived from the cached `Languages` line, 179 rows)
- `packages/spellkave-adventure-elven-mini/tests/offline/elven-mini-actor-capabilities-no-dup.test.ts`
  (instances do not mirror tag-derived grants)

## Related

[`blueprint-instance-override`](./blueprint-instance-override.md)
(instances inherit definition tags),
[`condition-grant-and-suppression`](./condition-grant-and-suppression.md),
[`directed-speech-anchor`](./directed-speech-anchor.md) (who may speak),
[`tag-membership-menu`](./tag-membership-menu.md),
[`affordance-needs-niche-attachment`](../repairs/affordance-needs-niche-attachment.md).

## Known misuse / anti-pattern

- Granting all `skill/*` as a creature or PC baseline.
- Making the creature tag or a language tag grant speech; using the vocal
  tag to model telepathy.
- Mirroring tag-derived capabilities into
  `entity_definition_initial_capability` / `actor_capabilities`.
- Reading `selfStates(kind="capability")` as the effective set — verify a
  tag-derived grant by the tag plus the gated affordance it enables.

## SRD features that use this

- `srd.creature` (walk, Attack umbrella, Dash, Dodge, Help, Drop Prone,
  Stand Up, Utilize, Pickup, Consume, rests, 24 check verbs;
  `fixtures/base/playing-the-game/creature-identity.toml`), `srd.player_character` (Level Up, Claim Victory, Heroic
  Inspiration), `srd.communication.vocal` (Speak), caster class tags →
  `srd/action/magic`. The complete ownership split:
  [`capabilities-and-identity.md`](../../../spellkave-srd-cc/docs/capabilities-and-identity.md).
