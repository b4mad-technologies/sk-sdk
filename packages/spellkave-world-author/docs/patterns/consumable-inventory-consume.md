# Consumable inventory consume

## Name

`consumable-inventory-consume` — Drink/use a carried stackable item through
one world verb whose target is the item

## Problem

A stackable inventory item (potion, scroll dose) must apply its own effect to
the carrier and remove one unit from the stack when used, and must fail
cleanly when the carrier does not hold it. A creature should see ONE "use a
consumable" action, with exactly the consumables it carries as targets — not
one verb per item that every creature sees whether or not it holds the item.

## Forces

- The kernel binds a consequence to the ACTION, not to the affordance
  template: `r_manipulate` applies `action_definitions.on_success`
  (the world API). Several
  templates that share one action therefore share its consequence.
- An outcome template may carry BOTH `manipulation_action_id` and an
  `outcome_expression_source`: `commit_resolved_manipulation` applies the
  action's frame first, then executes the selected template's outcome
  expression with the same binding context (`execute_outcome_expression`).
  An `invoke_outcome_graph(...)` there is the per-template effect seam; a
  graph node's outcome template carries its own `consequence_template_id`.
- `RemoveItem { source: TargetItem }` removes from the dispatch target
  (`r_apply_consequence/remove_item.rs`); removing the last unit deletes the
  entity ([remove-item-deletes-stack](../repairs/remove-item-deletes-stack.md)).
- When the item is spent on something ELSE (a key used on a seal, the target
  being the seal), remove it with
  `RemoveItem { source: { ActorInventoryItem: { actor_ref: "Actor", item_def_id } } }`
  instead: its prevalidate rejects the attempt atomically when the actor holds
  none, so that verb needs no separate possession check (elven-mini's
  `author/tomb-key.ts`).
- The kernel derives target niches for an item, among them its
  `entity_def_id`, its home state (`core/owned`, `core/contained`,
  `core/grounded`), its tags and `on_consume:`/`on_destroy:` facts
  (the world API). A carried item is
  therefore a `core/owned` target the carrier's manipulation context lists.
- For a carried target item, `r_manipulate` re-checks the template predicate
  (`revalidate_item_source`) against a NARROWER niche set: `item:<id>` and the
  item's `entity_def_id` only, no home state and no tags. A template predicate
  that reads `core/owned` or a tag fails there (`stale_item_source` /
  `predicate-fail`, measured live in sk-jay0.1.23.36.22.17). Put those facts on
  the niche, not on the template predicate.
- A gate that KEEPS the item is a different job: put
  `actor.has_item('<item_def_id>')` on the affordance predicate. The DSL
  `items` pool carries the acting body's directly-carried items since sk-vjh.7
  (proof anchor: the `manipulation_facts_expose_carried_items_to_has_item`
  unit test in `r_manipulate/selection/candidates.rs`); see
  [has-item-dead-in-manipulate](../repairs/has-item-dead-in-manipulate.md) for
  the retired gotcha.
- SRD potions are Bonus Actions; heal magnitude is dice (`2d4 + 2`).

## Solution

1. Stackable `entity_definitions` for each consumable (`stackable = true`),
   tagged with a consumable tag (srd-cc: `srd.consumable`). Only items that own
   a template carry the tag, so the niche never offers a target no template
   resolves.
2. ONE target niche with `provider = "entity"`: the consumable tag AND
   `core/owned` (srd-cc: `srd/consumable`,
   `target.has_niche('srd.consumable') && target.has_niche('core/owned')`).
3. ONE action (`spellkave_define_action`, no affordance of its own):
   `self_only = false`, `self_eligible = false`, and `on_success` a shared
   consequence `RemoveItem { count: 1, source: { TargetItem: {} } }`. srd-cc
   sets `required_capability = <bundle>/action/consume`, granted from the
   creature identity tag
   ([identity-tag-capability-grant](./identity-tag-capability-grant.md)).
   `required_capability` does not decide who sees or may use the verb: it is
   checked only when a sender acts through an actor it is not directly bound
   to (the world API).
4. Per consumable, ONE affordance template on that niche. Its
   `capability_id` is what disclosure keys on — the materialiser offers only
   templates whose `capability_id` the actor holds
   (`affordance_materialiser/mod.rs:76-78`; an empty one is never offered,
   sk-jay0.1.23.36.22.10). Its `spends_channel = <bundle>/economy_channel/bonus`
   makes the drink a Bonus Action: `r_manipulate` meters the template's
   channel (`r_manipulate/mod.rs:556-575`); an action-level `spends_channel`
   meters only `r_react` reactions. Its predicate re-checks the capability,
   because act-time selection does not enforce `capability_id`
   (`sk-jay0.2.46`), and selects the item definition as target
   (`actor.has_capability('<cap>') && target.has_niche('<item_def_id>')`).
   Its outcome template names the shared action AND
   `invoke_outcome_graph('<item>/consume/graph')`. The graph is one terminal
   node whose outcome template carries the item's effect consequence (e.g.
   `ModifyResource` or `ApplyStatus` on `Actor`). The item's
   `on_consume_consequence_id` may name that effect consequence, but the
   kernel only exposes it as an `on_consume:<id>` niche fact
   (`target_niches.rs:132-138`); it never applies it.
5. Pattern refs in generator + TOML (`// pattern:` / `# pattern:`).

srd-cc authoring: `playing-the-game/fragments/consume.ts` owns the action,
niche and shared consequence; `consumeTemplateCalls` adds one template per
consumable beside its definition (magic-items). The graph + node pair is
written through verb-runner's `outcomeGraphRowsCall`, the finding #66
workaround: `spellkave_write_rows` cannot write a bare graph and its nodes
atomically (`sk-jay0.7.172`). `spellkave_define_behavior` with the
OutcomeGraph primitive writes a graph with its nodes only for a new action
it creates itself, so an author outside srd-cc cannot build this pattern
with the public verbs today; write the rows as manifest TOML instead.

## TOML example

From `packages/spellkave-srd-cc/fixtures/base/playing-the-game/consume.toml`
and `fixtures/base/magic-items/consumables-potion-of-healing.toml` (generated),
trimmed (bundle_id, display names and descriptions omitted):

```toml
# pattern: consumable-inventory-consume
[[action_definitions]]
action_id = "srd/consume"
on_success = "srd/consume/success"   # RemoveItem TargetItem, count 1
required_capability = "srd/action/consume"
self_eligible = false
self_only = false
spends_channel = "srd/economy_channel/bonus"   # meters r_react only; the template's channel meters the drink

[[niche_definitions]]
niche_id = "srd/consumable"
predicate_source = "target.has_niche('srd.consumable') && target.has_niche('core/owned')"
provider = "entity"

[[affordance_templates]]
template_id = "srd/item/potion-of-healing/consume/affordance"
niche_id = "srd/consumable"
capability_id = "srd/action/consume"
predicate_source = "actor.has_capability('srd/action/consume') && target.has_niche('srd/item/potion-of-healing')"
outcome_template_id = "srd/item/potion-of-healing/consume/outcome"
spends_channel = "srd/economy_channel/bonus"      # the channel r_manipulate meters

[[outcome_templates]]
outcome_template_id = "srd/item/potion-of-healing/consume/outcome"
manipulation_action_id = "srd/consume"
outcome_expression_source = "invoke_outcome_graph('srd/item/potion-of-healing/consume/graph')"

[[outcome_templates]]
outcome_template_id = "srd/item/potion-of-healing/consume/effect"
consequence_template_id = "srd/item/potion-of-healing/consume/success"  # ModifyResource Actor srd/hp "2d4 + 2"

[[outcome_graphs]]
outcome_graph_id = "srd/item/potion-of-healing/consume/graph"
max_depth = 1
max_draws = 8
max_nodes = 1

[[outcome_graph_nodes]]
outcome_graph_id = "srd/item/potion-of-healing/consume/graph"
outcome_graph_node_id = "srd/item/potion-of-healing/consume/graph/effect"
node_id = "effect"
outcome_template_id = "srd/item/potion-of-healing/consume/effect"
authored_order = 0
terminal = true
```

The templates share action and niche with mutually exclusive predicates, so
`MF-VAL-243` warns once per group (accepted in srd-cc's `pipeline.test.ts`).

## Proof

- Offline: `packages/spellkave-srd-cc/src/test/offline/magic-items-coverage.test.ts`
  (potion-of-healing consume unit).
- Live: `q4-fanatic-loot.test.ts` (one `srd/consume` row disclosed, the held
  potion as its target, HP rises, the last dose is deleted) and
  `potions-and-recharge.test.ts` (condition applied), both when
  `SPELLKAVE_LOCAL_NODE=1`.

## Related

[has-item-dead-in-manipulate](../repairs/has-item-dead-in-manipulate.md),
[remove-item-deletes-stack](../repairs/remove-item-deletes-stack.md),
[loot-table-drop](./loot-table-drop.md),
[container-with-loot](./container-with-loot.md).

## Known misuse / anti-pattern

- One self-only verb per consumable. Every creature sees every verb whether
  or not it carries the item, and a brain or player cannot tell from the
  context which consumable it holds. This package retired that shape in
  sk-jay0.1.23.36.22.17.
- Putting the item effect on the shared action's consequence: every template
  would apply the same effect.
- Reading `core/owned` or a tag in the template predicate: the carried-item
  revalidation does not see those facts and rejects the dispatch.
- Adding `RemoveItem` to an action that should LEAVE the item with the actor,
  as a stand-in for a possession check. Gate that on the predicate with
  `actor.has_item(...)` instead.
- Asserting `quantity == 0` after the last dose — the row is deleted.
- Leaving the template's `capability_id` empty to mean "anyone may drink" —
  the materialiser then offers it to nobody, while a direct dispatch that
  passes the predicate still works.
- Putting `spends_channel` only on the action: the drink is then unmetered.

## SRD features that use this

- `srd/consume` with one template per consumable (sk-jay0.1.23.36.22.17):
  Potion of Healing, all 4 tiers (`srd/item/potion-of-healing*`); Potion of
  Giant Strength (`srd/item/potion-of-giant-strength`); the expressible SRD
  potions (`srd/magic_item/potion-*`: climbing, heroism, resistance, speed,
  water breathing).
- Thrown Acid, Alchemist's Fire, Holy Water (`srd/item/<slug>/throw`): a
  targeted verb whose target is a creature; both the hit and the miss branch
  remove one item from inventory.
- Spread Caltrops, Spill Ball Bearings (`srd/item/caltrops/spread`,
  `srd/item/ball-bearings/spill`): a self-only Utilize verb removes one item
  and schedules a `lingering-hazard-zone` pulse.
