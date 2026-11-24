# `has_item` works inside a manipulate predicate — RETIRED gotcha, kept for readers of old manifests

**This gotcha no longer applies.** Since bead sk-vjh.7,
`actor.has_item('<item_def_id>')` is a real possession gate inside an
`r_manipulate` action predicate. `manipulation_facts`
(the world API)
now collects the items the acting body directly carries — every
`entity_containment` row whose `container_id` is the body, equipped or loose —
into the Actor `items` fact pool, so the predicate reads true at offer
(materialiser) time and at act (`r_manipulate`) time alike. Proof anchor: the
unit test `manipulation_facts_expose_carried_items_to_has_item` in that same
file. The `dead-manipulate-has-item` lint rule that used to flag this shape is
retired too, so `spellkave-author manifest lint` no longer warns.

Write the gate the obvious way:

```toml
[[affordance_templates]]
template_id = "my/affordance/gift_comb"
predicate_source = "actor.has_item('my/item/silver_comb')"
```

## The `RemoveItem` prevalidate shape is still right — for a CONSUME

A `RemoveItem` frame_write is the idiom for an action that **spends** the item.
`apply_consequence_with_bindings` prevalidates every frame_write before
executing any of them (`remove_item::prevalidate` -> `resolve_source_item_id`),
so a stack the actor does not hold aborts the whole consequence atomically. Use
it for drinking a potion or firing a piece of ammunition. Do not use it as a
**possession gate** for an action that leaves the item in hand — that was the
workaround for the dead pool, and it made a keep-the-item action consume it or
forced a compensating re-grant. A gate that keeps the item belongs on the
predicate. See [`consumable-inventory-consume`](../patterns/consumable-inventory-consume.md).

## History

Before sk-vjh.7, `manipulation_facts` left the DSL `items` pool at its empty
default. Only `r_move`'s `traversal_affordance_facts_from_bindings` populated
it, so `has_item(...)` was true only inside an edge-traversal predicate and
silently false everywhere else — a dead half of an `&&` chain that shipped
unnoticed more than once. Manifests written in that era route around it: they
gate on a resource or state flag toggled by an explicit act, or they lean on a
`RemoveItem` prevalidate to reject the attempt. Those manifests still work.
They are no longer the recommended shape, and prose anywhere claiming
`has_item` is dead in a manipulate predicate predates sk-vjh.7.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
