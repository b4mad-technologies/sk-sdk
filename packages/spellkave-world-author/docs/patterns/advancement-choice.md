# Advancement choice menus (choose-N metadata)

## Name

`advancement-choice` — Advancement choice menus (choose-N metadata)

## Problem

I need a choose-N menu (fighting style, subclass, ASI-or-feat, expertise) that a DM dialogue can render without hardcoding the member list in TypeScript.

## Forces

- The world must behave identically without the metadata (ADR-0073 D-1):
  menus are DM-side facts, never server behavior.
- One attachment row **per option member**, never one row per menu — the
  reader regroups by menu id, and the members stay individually
  addressable.
- Every member must be a real `entity_definition`; live apply validates
  that the ref exists (`MF-APPLY-026`), so capability ids and prose-only
  slugs fail seed. The check is global (the world API),
  not "same bundle" — keeping members in the menu's bundle is a convention.
- Menu-only options that are not already entities (a "divine order", a
  metamagic) need small option entity_definitions beside the rows.

## Solution

Emit one metadata attachment per member under a choice namespace with
`target_kind = "entity_definition"` and a payload carrying the menu id, the
pick count and an optional recommended default:

| Field | Required | Meaning |
|---|---|---|
| `class` / owner key | yes | whose advancement this is |
| `level` | yes | level at which the menu opens |
| `choice_group` | yes | stable menu id: `<bundle>/<class>/<level>/<slug>` |
| `choose_n` | yes | how many members to pick |
| `recommended` | no | member `target_ref` the source names as default |
| `rechoose` | no | `"none"` (default) or a documented re-pick policy |
| `grants_ref` | no (srd-cc always emits it) | the real entity the option grants when `target_ref` is an option wrapper (`srd-cc/src/chapters/classes/advancement-metadata-units.ts:518`). The DM duty document copies it per member as `memberGrantRefs`, checked against this row at publish (`crates/spellkave-validate/src/dm_reference_metadata.rs` `choice_groups_for`); the DM host sends it as the answer's reference so a client can show the granted feat, weapon or order. It is presentation only: no runtime reader grants from it |

A sibling **grant** namespace (`(class, level) → one entity id`) carries the
unconditional grants. A reader regroups choice rows by `choice_group`; the
dialogue offers them as [`dialog-choice-slots`](./dialog-choice-slots.md)
and applies the pick on confirm
([`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md)). Derive
large member sets from tag membership
([`tag-membership-menu`](./tag-membership-menu.md)), not hand lists.

## TOML example

Copied from
`packages/spellkave-srd-cc/fixtures/base/classes/advancement-metadata.toml`:

```toml
[[metadata_attachments]]
bundle_id = "srd"
namespace = "srd.advancement_choice"
payload_json = '{"class":"fighter","level":1,"choice_group":"srd/fighter/1/fighting-style","choose_n":1,"rechoose":"none","grants_ref":"srd/feat/archery","recommended":"srd/advancement-choice-option/fighter/1/feat/defense"}'
source = "manifest"
target_kind = "entity_definition"
target_ref = "srd/advancement-choice-option/fighter/1/feat/archery"

[[metadata_attachments]]
bundle_id = "srd"
namespace = "srd.advancement_choice"
payload_json = '{"class":"fighter","level":1,"choice_group":"srd/fighter/1/fighting-style","choose_n":1,"rechoose":"none","grants_ref":"srd/feat/defense","recommended":"srd/advancement-choice-option/fighter/1/feat/defense"}'
source = "manifest"
target_kind = "entity_definition"
target_ref = "srd/advancement-choice-option/fighter/1/feat/defense"
```

`target_ref` is a **unique per-menu wrapper** entity
(`<bundle>/advancement-choice-option/<class>/<level>/<member-tail>`) and
`grants_ref` names the real entity the option grants. Attachments upsert on
`(target_kind, target_ref, namespace, bundle_id)`
(the world API), so within one bundle two
menus naming the same real feat must not share it as `target_ref` — later seed rows would overwrite
earlier ones and drop whole choose-N groups from the live catalog.

## Proof

- `packages/spellkave-srd-cc/src/test/offline/dm-data-advancement.test.ts`
  (reader regroups by `choice_group`)
- `packages/spellkave-srd-cc/src/test/offline/metadata-target-ref-resolution.test.ts`
  (every member resolves to an entity_definition)
- `packages/spellkave-srd-cc/src/test/offline/advancement-metadata-units.test.ts`

## Related

[`metadata-attachments`](../metadata-attachments.md) (row shape, namespace
registry), [`dialog-choice-slots`](./dialog-choice-slots.md),
[`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md),
[`tag-membership-menu`](./tag-membership-menu.md),
[`resource-spend-with-option-menu`](./resource-spend-with-option-menu.md)
(runtime spend menus are a different thing: live actions, not metadata).

## Known misuse / anti-pattern

- Hand-listing members in TypeScript (derive from the tag).
- Putting eligibility in TypeScript — gate with server-evaluated DSL
  (`actor.stat('<level>')`, identity tags).
- Treating a member as granted before draft → confirm.
- Pointing `target_ref` at a capability id or a slug no entity carries.
- Using the real feat/weapon entity as `target_ref` in more than one menu
  (upsert collision silently drops a group) — wrap per menu.
- Authoring a menu for options that are not expressible as entities yet
  (leave the feature as identity until they are).

## SRD features that use this

- Fighting Style (L1 / Paladin-Ranger L2), subclass L3, ASI-or-feat L4 for
  all 12 classes, Divine/Primal Order, Expertise, Metamagic, Eldritch
  Invocations. The shipped menus and the ASI mechanics split:
  [`advancement-choice.md`](../../../spellkave-srd-cc/docs/advancement-choice.md),
  [`caster-features-l1-4.md`](../../../spellkave-srd-cc/docs/caster-features-l1-4.md).
