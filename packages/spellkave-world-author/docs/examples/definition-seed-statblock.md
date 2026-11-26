# Example — statblock stats & innate capability on a definition

Teaching: `sk get object_state <entity_key>::srd/hp` reads the *placed* seed copy; `sk query` reads the definition seed table.

How to give a reusable creature **definition** its own numbers — so every
placed instance is born with them, and you author a creature *library* once
instead of attaching stats per instance. The complete manifest form is
[`definition-seed-statblock.toml`](./definition-seed-statblock.toml).

This closes the gap where a definition-bulk authoring slice (a creature library:
`entity_definitions` + taxonomy, no placement) structurally could not carry HP,
ability scores (#729), or innate Multiattack (#728) — those only attached to a
*placed* `[[entities]]` row.

## The three seed tables

Each seed row hangs off an `entity_def_id`. At admission (manifest placement) and
at runtime spawn (`CreateWorldObject`), every placed instance of that definition
gets the corresponding live row copied onto it:

| Seed row | Copies onto the instance | For |
|---|---|---|
| `[[entity_definition_initial_state]]` | an `object_state` row | HP, AC-as-state, ability scores, counters (#729) |
| `[[entity_definition_initial_capability]]` | a `capability` row | Multiattack, breath weapon, always-on traits (#728) |
| `[[entity_definition_initial_condition]]` | a `target_condition` row | a starting condition (e.g. a torch born `burning`) |

State-values use **typed carriers** — `value_int`, `value_text`, or
`value_bool`, in that precedence. There is no `value_kind` enum column
(ADR-0018).

```toml
[[entity_definition_initial_state]]
entity_def_id = "example_statblock/ghoul"
state_id      = "example_statblock/hp"
value_int     = 22
bundle_id     = "example_statblock"

[[entity_definition_initial_capability]]
entity_def_id = "example_statblock/ghoul"
capability_id = "example_statblock/multiattack"
bundle_id     = "example_statblock"
```

The seed FK targets (`entity_def_id`, `state_id`, `capability_id`,
`condition_definition_id`) must resolve in the same bundle or a declared
dependency. A same-bundle typo fails loudly at validation (MF-VAL-252…255);
a legitimate cross-bundle reference (a `phandelver` creature seeding `srd/hp`)
resolves at live admission / the merge-gate per
ADR-0044.

## Structural seeds: containment and equipment

Two more seed tables carry **structure**, not a flat value copy — every placed
or spawned instance of the definition is born with a **freshly spawned child
instance**, not merely a copied row:

| Seed row | What it does | For |
|---|---|---|
| `[[entity_definition_initial_containment]]` | spawns a child instance and carries it (loose `entity_containment`, `slot_id = ""`) | a bandit born with a quiver already in its pack |
| `[[entity_definition_initial_equipment]]` | spawns a child instance, carries it, AND inserts an `entity_equipment_slot` row into the named slot | a goblin born wielding a scimitar |

```toml
# Root -> quiver (loose carriage, quantity 1).
[[entity_definition_initial_containment]]
entity_def_id = "pack/bandit"
contained_entity_def_id = "pack/quiver"
quantity = 1
bundle_id = "pack"

# Nested: quiver -> bolts (pack/bolt is stackable — ONE bolt instance, quantity 20).
[[entity_definition_initial_containment]]
entity_def_id = "pack/quiver"
contained_entity_def_id = "pack/bolt"
quantity = 20
bundle_id = "pack"

# Root -> equipped scimitar, in the main_hand slot.
[[entity_definition_initial_equipment]]
entity_def_id = "pack/goblin"
equipped_entity_def_id = "pack/scimitar"
slot_id = "core/main_hand"
bundle_id = "pack"
```

(Cribbed from the live `edi_demo` proof bundle —
`entity-definition-initial-items.toml`, not in this repository,
— with the demo's `edi_demo/*` ids renamed to the `pack/*` ids the spec
scenarios use.)

**Verb form:** `spellkave_define_entity_type` folds both tables in as satellite
array params, symmetric with `initial_states`/`initial_capabilities`/
`initial_conditions` — no raw `spellkave_write_rows` call needed for the common
case:

```json
{
  "bundle": "pack",
  "id": "bandit",
  "display_name": "Bandit",
  "initial_containment": [
    { "contained_entity_def_id": "pack/quiver", "quantity": 1 }
  ],
  "initial_equipment": [
    { "equipped_entity_def_id": "pack/scimitar", "slot_id": "core/main_hand" }
  ]
}
```

The raw `[[entity_definition_initial_containment]]`/`[[entity_definition_initial_equipment]]`
TOML tables above remain the form for manifest-file authors (and for a
`spellkave_write_rows` escape hatch when the verb's shape doesn't fit); the
verb call is sugar over the exact same rows — same cycle check, same
slot-compatibility check, same idempotent-replace-on-rerun semantics.

`quantity` follows the same stack-vs-instance-count rule as `[[entities]].quantity`
(ADR-0028 D-6): when the contained definition is `stackable = true`, ONE
instance is spawned carrying `quantity` as its stack count; when `false`,
`quantity` SEPARATE instances are spawned. Equipment carries an implicit
`quantity = 1` — one child, one slot.

**Recursion:** the child's OWN `entity_definition_initial_*` seeds — including
its own containment/equipment rows — apply to it before the parent's seeding
completes. A bandit-carries-quiver-carries-bolts chain is not a special case;
it is the same one-hop rule applied twice. This is how the worked fixture
above nests `pack/quiver` inside `pack/bandit` and `pack/bolt` inside
`pack/quiver` in a single containment table.

**Cycle rule:** the def-level graph formed by every
`entity_definition_initial_containment`/`entity_definition_initial_equipment`
row's `entity_def_id` -> `contained_entity_def_id`/`equipped_entity_def_id`
edge (both row kinds share one graph) MUST be acyclic. A definition that
directly contains/equips itself, or a transitive cycle (A -> B -> A, or a
mixed containment/equipment cycle across both tables), fails admission with a
fatal **`MF-VAL-314`** diagnostic naming the exact cycle path — before any row
is applied. Equipment seeds are additionally checked against the equipped
definition's `slot_compatibility_predicate` at commit time (the same
`MF-VAL-311`/`-312`/`-313` class of static enforcement), not only at spawn.

**Spawn overrides:** the capability-gated runtime entry point
`spawn_entity_definition` accepts optional state-delta overrides
(`{state_id, delta_source}`) and added-condition overrides
(`{condition_definition_id, duration_ticks}`), applied to the freshly spawned
root instance strictly AFTER every definition-level seed above (state,
capability, condition, containment, equipment — recursively) has already run.
A state-delta override adds its DSL Int expression to the definition-seeded
value for that `state_id` (or to `0` if unseeded); a condition override adds
alongside any seeded conditions rather than replacing one. Overrides only
ever touch the spawned instance's own live rows — never the `entity_definition`
or its seed rows.

## End-to-end proof

```bash
just spacetime-start && just wipe && just seed
just seed docs/modding/examples/definition-seed-statblock.toml

# What does the definition seed onto its instances?
spellkave --url http://127.0.0.1:<port> entity-def-seed list --entity-def example_statblock/ghoul
# {"kind":"entity_def_seed","entity_def_id":"example_statblock/ghoul","seed_kind":"capability","ref_id":"example_statblock/multiattack",...}
# {"kind":"entity_def_seed","entity_def_id":"example_statblock/ghoul","seed_kind":"state","ref_id":"example_statblock/hp","value":"22",...}

# resolve the placed instance id
just sql "SELECT entity_id FROM entity WHERE name = 'Ghoul'"   # → e.g. 14

# the instance was BORN with HP 22 (object_state) and Multiattack (capability) —
# no per-instance rows were authored
just sql "SELECT state_id, value FROM object_state WHERE target_id = '14'"
just sql "SELECT capability_id FROM capability WHERE entity_id = 14"
```

`entity-def-seed list` shows what a definition will stamp on its instances;
`object_state` / `capability` on the placed entity id show that the stamp
happened at admission. (`<port>` is the per-worktree node port printed by
`just spacetime-start`; `just sql` resolves it automatically, the raw
`spellkave` binary needs `--url`.)

## Why this is the right shape

The seed is a generic **copy mechanism**, not new typology: `state_id` and
`capability_id` are authored vocabulary row-ids, and the live rows it writes
(`object_state`, `capability`) are the same content-neutral carriers the runtime
already uses (ADR-0021). Innate capabilities live in a **seed table**, not a new
CSV column on `entity_definition` — the `grants_capability_while_*` CSV grant
surface is frozen legacy per ADR-0028. The runtime consumer reuses the existing
`object_state` / `capability` write paths, adding no kernel enum variant.
