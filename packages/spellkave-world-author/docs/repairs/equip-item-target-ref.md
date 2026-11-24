# Equipping items: target-ref prefix, ownership depth, and `core/drop`'s real scope

**Gotcha — `entity:<id>` vs `item:<id>` target refs resolve through DIFFERENT
spatial resolvers.** `entity:` maps to `TargetRef::Entity`, which grounds the
target purely via `entity_location`/`actor_spatial_location` — it has no
concept of "carried" or "equipped". `item:` maps to `TargetRef::Item`, which
special-cases equipped (`entity_equipment_slot`) and directly-contained
(`entity_containment`) items as always-co-located before falling back to
`entity_location` (the world API).
A GROUNDED item (sitting at a real place_node) works fine with either prefix.
An EQUIPPED or CARRIED item (place_node_id `""`) only resolves correctly with
`item:` — targeting it with `entity:` fails `out_of_range` ("target place_node
'' is out of range from actor place_node '<X>' (range_m=0)"), a confusing
error that looks like a missing spatial_niche_attachment but is really just
the wrong prefix. Always use `item:<id>` for item-entity manipulate targets.

**Gotcha — nested containment does not count as actor ownership for
equip/unequip.** `EquipItem`/`UnequipItem`'s ownership check requires the
target's `entity_containment.container_id` to equal the actor's body entity
DIRECTLY. An item nested two levels deep (e.g. inside a container the actor
just picked up — hero → chest → sword) fails `"target entity <id> is not
owned by actor <id>"` even though it plainly travelled into the hero's pack.
The chest-carries-nested-contents shape (RH2's satchel, RH3's sarcophagus)
only proves an item TRAVELS with its container on pickup — it does not make
that item directly wieldable. An item you intend to equip must be its own
top-level pickup (`core.item` tag + a real `place_node_id`), not nested
inside another pickupable container.

**Gotcha — `core/drop`'s authored consequence does not actually unequip or
relocate.** `core/base/affordances.toml`'s `core/drop/success` consequence is
Inscribe-only (a trace write); the real unequip+relocate logic lives in the
`drop_item` reducer (the world API), which is NOT wired into
`r_manipulate`'s dispatch for the `core/drop` action — calling `core/drop` on
an equipped item returns `status: "success"` but leaves
`entity_equipment_slot`/`entity_containment` completely unchanged. To free an
equipped slot, author your own item-targeted action instead, mirroring the
equip pattern (`srd/equip_dagger`) but with `UnequipItem`:
`frame_write = { UnequipItem = { actor_ref = "Actor", slot_id = "<literal
slot>", source = { TargetItem = {} } } }`. `UnequipItem`/`EquipItem`'s
`source` only supports `TargetItem`/literal `Item{id}` — `ActorInventoryItem`
is explicitly unit-tested as unsupported in
`r_apply_consequence/equip_item.rs`, so the action must be item-targeted
(`self_eligible = false`), not self-eligible with a fixed-id lookup.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
