# `RemoveItem` deletes a fully-consumed stack — it does not leave a zero-quantity row

(The ISS1705 worked example — an ammo-tracked ranged attack — was retired `spellkave-srd` content, now only under `archive/packages/spellkave-srd/fixtures/base/attack-ranged.toml`; the rule still holds.)

`RemoveItem`'s quantity split (`remove_item.rs::decide_quantity`) has two
branches: `current_quantity > requested_count` decrements in place, but
`current_quantity == requested_count` **deletes the entity outright**. A
consequence that draws down a stackable resource (ammunition, charges,
consumable reagents) to exactly zero leaves NO entity to read back —
`readItem`/`readEntity` returns `null`, not a row with `quantity: 0`. An
assertion written as "quantity drops to 0" after the last unit is consumed
will hang or misfire; assert "the item is now absent" instead (ISS1705's
ammo-tracked ranged attack: 2 arrows, 2 shots, the second shot's
post-consumption read is `null`).

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
