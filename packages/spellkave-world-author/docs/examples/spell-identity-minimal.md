# Minimal single-identity spell

The smallest **lint-clean** spell skeleton — the shape the `emitSpell` primitive
renders and the author-time `manifest lint` accepts with zero findings. Copy it
when adding a spell, then hang an effect body off the outcome (see
[aoe-damage-spell](./aoe-damage-spell.md)).

The full rationale lives in
[spell-authoring-best-practices.md](../spell-authoring-best-practices.md); this is
the worked artifact.

## One spell = one identity

A spell touches several row-kinds, but it has **one identity** — and three of those
rows must agree on it:

| Row | Field | Value |
|---|---|---|
| `entity_definitions` (the catalog identity) | `entity_def_id` | `spell_identity/spell/spark` |
| `capability_definitions` (an actor can cast it) | `capability_id` | `spell_identity/spell/spark` |
| `action_definitions` (the cast verb) | `required_capability` | `spell_identity/spell/spark` |

The cast **action** keeps its own verb id (`spell_identity/cast_spark`) — only the
*identity* is unified. The catalog entity is what the bestiary/spell list shows;
the capability is the grantable "can cast"; the action's `required_capability`
binds back to that one identity so the runtime (and the validator's MF-VAL-264/265)
can see they are the same spell.

## What the lint checks here — and why this example passes

Run `manifest lint docs/modding/examples/spell-identity-minimal.toml --json`: it
reports **clean**. Each of the five author-time rules is satisfied:

- **`twin-action`** — there is exactly **one** `action_definition`. The affordance
  is an `affordance_template` pointing at the action's `outcome_template`, not a
  byte-identical `cast_spark/affordance` copy of the action.
- **`tag-repetition`** — taxonomy tags (`spell`, `cantrip`, `school:evocation`)
  live on `entity_definition_tag` (the identity) **only**; they are not
  re-authored verbatim onto the capability or action rows.
- **`spell-delimiter-drift`** — the slug is `…/spell/spark` (hyphen-delimited), not
  `…/spell/sp_ark`.
- **`orphan-spell-capability`** / **`dangling-required-capability`** — the
  capability has its matching catalog `entity_definition`, and the action's
  `required_capability` resolves to a real `capability_definition`.

## What this example deliberately omits

It is an **identity skeleton** — no effect body. A real spell hangs a
`consequence_template` (dice damage, a save, a condition) off the outcome; that
effect layer is shown in [aoe-damage-spell](./aoe-damage-spell.md) and the
SRD behavior cluster. Keeping the skeleton effect-free isolates the *identity*
discipline this example teaches.
