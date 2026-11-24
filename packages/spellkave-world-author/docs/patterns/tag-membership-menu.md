# Tag-membership menu (derive lists from tags, tables from tag metadata)

## Name

`tag-membership-menu` — Membership from tags, reference tables as tag metadata

## Problem

I need a list (all fighting styles, all wizard spells of level 1, every skill) for a menu or a filter, or a finite reference table (ability-score meaning bands, DC bands) for authors and DMs to read — without a hand-maintained list that chases the catalog.

## Forces

- A hand list silently rots when the catalog grows; tag membership is
  recomputed from the rows themselves.
- A finite source table that explains ONE semantic class and has no
  structured runtime consumer should not become one row per rung.
- Declare every tag family in the bundle's `tag_prefixes`. A tag whose
  namespace no declared prefix covers is warning `MF-VAL-298`; a
  `tag_value_definitions` row whose bundle does not declare the EXACT
  owning prefix is fatal `MF-VAL-306` (the bare bundle catch-all does not
  cover a longer family's value rows;
  `crates/spellkave-validate/src/tag_grammar.rs:76-79,127-129`). For an
  exact-value vocabulary every value must be a `tag_value_definitions` row
  (naming a non-member is fatal); other ref-typed prefixes only warn
  (`tag_grammar.rs:95-104`).
- Vocabulary without a reader is cargo cult: every adopted tag names its
  consumer (predicate, server read, test, UI).

## Solution

- **Membership**: tag each member (`<bundle>.feat.fighting_style.*`,
  `<bundle>.spell.list.<class>`), register the family in the bundle
  header's `tag_prefixes`, and derive menus / pick lists by filtering rows
  on the tag (plus level or other facts). Feed
  [`advancement-choice`](./advancement-choice.md) members from this.
- **Typed references** ride inside a dotted family when no first-class
  column exists (`<bundle>.ability.wis` on a skill capability refers to
  the `<bundle>/wis` resource); declare the family and target kind so
  lint and ref-chasing can resolve it.
- **Reference tables** (ability-score meaning bands, difficulty-class bands)
  render into the shared `tag_value_definition.description` of the one
  tag that names the class, generated from the parsed source with
  provenance pinned. Discovery metadata only — predicates, macros and
  world facts remain the executable rule
  ([`derived-value-mechanism`](./derived-value-mechanism.md)).

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/classes/advancement-metadata.toml`
(a menu member carrying the membership its tag already implies) and the
weapon tag vocabulary:

```toml
# every entity tagged srd.feat.fighting_style is a member of this menu; the
# generator derives both the tag and the member rows from the same parsed
# feat category (advancement-metadata-units.ts:352-355), never a hand list
[[metadata_attachments]]
bundle_id = "srd"
namespace = "srd.advancement_choice"
payload_json = '{"class":"fighter","level":1,"choice_group":"srd/fighter/1/fighting-style","choose_n":1,"rechoose":"none","grants_ref":"srd/feat/archery","recommended":"srd/advancement-choice-option/fighter/1/feat/defense"}'
target_kind = "entity_definition"
target_ref = "srd/advancement-choice-option/fighter/1/feat/archery"   # unique per-menu wrapper; grants_ref is the tagged feat

# packages/spellkave-srd-cc/fixtures/base/equipment/weapons/dagger.toml
[[entity_definition_tag]]
entity_def_id = "srd/weapon/dagger"
tag = "srd.weapon.property.finesse"     # family srd.weapon registered in tag_prefixes
```

## Proof

- `packages/spellkave-srd-cc/src/test/offline/dm-data-advancement.test.ts`
- `packages/spellkave-srd-cc/src/test/offline/feats-units.test.ts`
- `packages/spellkave-srd-cc/src/test/offline/tag-value-vocabulary.test.ts`
  (`srd.ability_score` description pinned to the parsed table, `:149-162`)

## Related

[`advancement-choice`](./advancement-choice.md),
[`identity-tag-capability-grant`](./identity-tag-capability-grant.md)
(tags that are live identity),
[`metadata-attachments`](../metadata-attachments.md),
[`fixture-correctness`](../fixture-correctness.md) (tag hygiene rows).

## Known misuse / anti-pattern

- A hand-written member list in TypeScript.
- One tag or fixture row per table rung.
- Colon-shaped or flat tags (`faction:party`) — fully dotted under the
  bundle namespace.
- Forgetting the `tag_prefixes` entry and reading `MF-VAL-298` / `MF-VAL-306`
  as a validator bug. (`MF-VAL-306` used to double as a DSL-macro check too;
  sk-jay0.7.174.28 moved that one to `MF-VAL-356`.)
- Minting a relation-shaped tag without declaring its family and target.

## SRD features that use this

- Fighting-style menus, class spell lists, skill → ability references,
  `srd.ability_score` / `srd.difficulty_class` descriptions. Naming rules
  and the rename history:
  [`tags-and-ids.md`](../../../spellkave-srd-cc/docs/tags-and-ids.md).
