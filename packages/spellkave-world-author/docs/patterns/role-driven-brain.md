# Role-driven brain (fight behavior selected by an instance tag)

## Name

`role-driven-brain` — Combat brain selected from a creature's role tag

## Problem

I have many enemies in many encounters and need each to fight sensibly (archers keep range, brutes charge, leaders hang back) without writing a bespoke seat per creature.

## Forces

- The module contains no actor decision logic: an NPC needs a driver
  ([`npc-needs-driver`](../repairs/npc-needs-driver.md)), and one driver
  per creature does not scale to a bestiary.
- Behavior is a fact about the *instance in this scene* (the same goblin
  may be a skirmisher in one fight and a leader in another).
- Speech / parley lines are adventure content, not part of the brain.
- Tag families should be declared as tag prefixes (an undeclared prefix is
  warning `MF-VAL-298`; a `tag_value_definitions` row whose bundle does not
  own the prefix is fatal `MF-VAL-306`, `crates/spellkave-validate/src/tag_grammar.rs:76-79,127-129`)
  and every tag needs a reader.

## Solution

1. Define a registered tag family `<bundle>.creature.role.<role>` with a
   small closed vocabulary (skirmisher, archer, brute, leader, lurker,
   undead-tide, caster-boss, …) and stamp one on every monster definition
   (generator-owned heuristics: attack shape + type/size, with per-scene
   overrides) or on the instance's `[[entity_tag]]`.
2. Keep content-free role brains in the NPC package; a **seat factory**
   reads the definition/instance tags (or an explicit `role`) and returns
   the brain. Speech and parley stay optional app-owned parameters.
3. Stock fights then need only the instances + tags
   ([`blueprint-instance-override`](./blueprint-instance-override.md)).

## TOML example

Copied from `packages/spellkave-adventure-kavemouth/fixtures/adventure/cast/monsters/storyline-encounters.toml`:

```toml
[[entity_tag]]
bundle_id = "kavemouth"
entity_key = "kavemouth/adventure/encounter/road_wolf_1"
source = "manifest"
tag = "srd.creature.role.skirmisher"
```

Seat side (TypeScript, not TOML):
`createRoleDrivenBrain({ definitionTags | role, hostileReplyLine?, … })`
from `@spellkave/adventure-runtime` (`src/role-driven/index.ts`); the Crypt
Warden uses `role: "archer"` plus its hostile refusal line
(`hostileReplyLine`).

## Proof

- `packages/spellkave-srd-cc/src/test/offline/creature-roles.test.ts`
  (every monster definition carries exactly one role; overrides win)
- `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/multi-role-fight.test.ts`
- `packages/spellkave-adventure-kavemouth/npcs/__tests__/crypt-warden-brain.test.ts`

## Related

[`blueprint-instance-override`](./blueprint-instance-override.md),
[`companion-follow`](./companion-follow.md) (another seat-policy pattern),
[`npc-needs-driver`](../repairs/npc-needs-driver.md),
`crates/spellkave-npc-host/MILESTONE-role-driven.md` (the role-driven contract).

## Known misuse / anti-pattern

- A bespoke seat per creature.
- Encoding behavior in the kernel (a "hostile AI" primitive).
- Hand-editing generated fixtures to set roles — override in the generator.
- Minting a role tag without a reader.

## SRD features that use this

- Every `srd/creature/<slug>` definition; kavemouth §5 encounters, the
  Crypt Warden, storyline villains. Role table and assignment heuristics:
  [`combat-roles.md`](../../../spellkave-srd-cc/docs/combat-roles.md).
