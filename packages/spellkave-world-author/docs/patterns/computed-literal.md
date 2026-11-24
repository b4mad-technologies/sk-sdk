# Computed-literal delta_source compositions

## Name

`computed-literal` — Computed-literal delta_source compositions

## Problem

I need to write a resource delta whose magnitude was computed outside the DSL (NPC host read another entity, TS chose N XP, etc.).

## Forces

- A frame-write formula can read its acting entity and its modified target,
  but cannot use that target binding to read an arbitrary third entity.
- A literal fixes the authored amount; it does not track later live variance.
- Live caller-selected amounts should use an admitted dispatch argument when
  the action already supports one.

## Solution

For a build-time constant, compute the integer in the generator and author
`delta_source = "<N>"` on the relevant `ModifyResource`. This is an ordinary
DSL literal, not a new primitive.

For the current DM XP watches, keep the action definition fixed and supply
`quantity` at dispatch. The award write reads
`actor.stat('core/dispatch_arg_quantity')`; see
[`kill-xp-grant`](./kill-xp-grant.md) and
[`quest-xp-grant`](./quest-xp-grant.md). Their production hosts no longer
render an action definition or apply a manifest for each reward.

## TOML example

A schematic generator-produced constant write:

```toml
[consequence_frame_writes.frame_write.ModifyResource]
actor = "TargetActor"
resource = "example/reward"
delta_source = "100"
```

Legacy XP renderer exports can still compose publisher-authored scenes with
literal numeric entity references. Such compatibility composition does not
establish the production DM's per-play write authority.

## Proof

`packages/spellkave-srd-cc/src/chapters/spells/spell-behaviors.ts`
(`aoeSpellSaveDcLiteral`) is a generator-owned computed constant.
Current live XP behavior is proved by the live tests linked in the XP patterns.

## Related

[`derived-value-mechanism`](./derived-value-mechanism.md),
[`kill-xp-grant`](./kill-xp-grant.md),
[`quest-xp-grant`](./quest-xp-grant.md).

## Known misuse / anti-pattern

- Reading a corpse as `target` inside a write whose target is the killer.
- Substituting a baked constant for a promised live-derived amount.
- Publishing a per-play action solely to embed a quantity supported as an argument.

## SRD features that use this

- Spell upcast dice authored for each `SpellCastingOption` slot level.
- AoE save DC: per-victim bodies rebind Actor, so `aoeSpellSaveDcLiteral`
  emits 13 from default proficiency 2 and casting modifier 3. This is the
  documented default-caster limitation, not a live caster-stat calculation.
