# Blueprint instance with overrides (scenario spawn from a catalog definition)

## Name

`blueprint-instance-override` — Instantiate a catalog blueprint; override per instance

## Problem

My scenario needs an NPC or encounter that "is a Commoner" / "is a Goblin" / "is three wolves at the bridge" — how do I place it without re-typing the stat block, and how do I change one number or give one body a role?

## Forces

- A hand-copied local definition typically carries only AC and HP and
  silently drops ability scores, speed, the baked proficiency stat and the
  size / type / CR tags the blueprint ships.
- There is **no definition inheritance**: `entity_definition_initial_state`
  is definition-level only (`lineage_id` exists but nothing reads it).
- A role-granting tag on the shared definition would make every instance
  of it a trainer / a giver.
- Cross-bundle references are legal only when the scenario declares
  `depends_on` on the catalog bundle; the closure check is `MF-VAL-214`
  (`crates/spellkave-validate/src/refs.rs:36-40,102`). (`MF-VAL-291` is a
  different warning: an id a bundle *defines* outside its own namespace.)

## Solution

1. Point the `entities` row's `entity_def_id` at the catalog blueprint
   (full cross-bundle id). Instance identity (`name`, `description`) stays
   on the scenario row.
2. One changed fact on a named instance → an admission-time
   `[[object_state]]` row for that `(entity, state_id)`; it supersedes the
   definition seed (the seeded row is deleted before the explicit one is
   inserted).
3. A role that only this body has → an instance `[[entity_tag]]` row.
   Target-niche derivation unions instance tags with definition tags, so
   `has_tag` / `has_niche` readers see it.
4. Universal behavior comes with the definition's identity tags
   ([`identity-tag-capability-grant`](./identity-tag-capability-grant.md))
   — do not copy capabilities onto the instance; reserve instance
   capability rows for a narrower source (a DM's watch extent, party
   sight).
5. A *different creature* (numbers that are not a catalog stat block)
   still gets its own definition.

Encounters are the same pattern in bulk: N instances of catalog blueprints
at a node, each with its behavior-selecting instance tag
([`role-driven-brain`](./role-driven-brain.md)).

## TOML example

Copied from `packages/spellkave-adventure-elven-mini/fixtures/adventure/cast/monsters/slime-scout.toml`
(one HP override) and `…/cast/monsters/storyline-encounters.toml` (an
encounter wolf with a role tag):

```toml
[[entities]]
bundle_id = "elven_mini"
entity_def_id = "srd/creature/gray-ooze"
entity_key = "elven_mini/adventure/npc/slime_scout_1"
kind = "npc"
name = "Slime Scout"
place_node_id = "elven_mini/tomb/hall"

[[object_state]]
bundle_id = "elven_mini"
entity_key = "elven_mini/adventure/npc/slime_scout_1"
source_template_id = "manifest"
state_id = "srd/hp"
value_bool = true
value_int = 3                       # definition seeds 22; tutorial pacing wants 3

[[entities]]
bundle_id = "elven_mini"
entity_def_id = "srd/creature/wolf"
entity_key = "elven_mini/adventure/encounter/road_wolf_1"
kind = "npc"
name = "Road Wolf 1"
place_node_id = "elven_mini/river_crossing/bridge_mid"

[[entity_tag]]
bundle_id = "elven_mini"
entity_key = "elven_mini/adventure/encounter/road_wolf_1"
source = "manifest"
tag = "srd.creature.role.skirmisher"
```

## Proof

- `packages/spellkave-adventure-elven-mini/tests/offline/elven-mini-actor-capabilities-no-dup.test.ts`
  (instances do not duplicate the capabilities their definition seeds)
- No test asserts an instance override (the slime's HP 3 over the
  definition's 22) directly; the fixture rows above are the evidence.
- `packages/spellkave-srd-cc/src/test/offline/creature-roles.test.ts`

## Related

[`identity-tag-capability-grant`](./identity-tag-capability-grant.md),
[`role-driven-brain`](./role-driven-brain.md),
[`definition-seed-statblock`](../examples/definition-seed-statblock.md),
[`manifest-format`](../manifest-format.md) (`entities`, `object_state`,
`entity_tag`).

## Known misuse / anti-pattern

- A local `entity_definitions` row that re-types a catalog stat block.
- Expecting a local definition to inherit a blueprint's seeds via
  `lineage_id`.
- Tagging the shared definition with a scenario role.
- Mirroring the blueprint's tag-derived capabilities onto the instance.
- Forgetting `depends_on` and reading the resulting `MF-VAL-214` as a
  kernel limit.

## SRD features that use this

- Mira and Aldwin (`srd/creature/commoner`), the Crypt Warden (goblin
  warrior, XP override), the Slime Scout (gray ooze, HP 3), every §5
  storyline encounter. Worked verdicts:
  [`scenario-blueprints.md`](../../../spellkave-srd-cc/docs/scenario-blueprints.md).
