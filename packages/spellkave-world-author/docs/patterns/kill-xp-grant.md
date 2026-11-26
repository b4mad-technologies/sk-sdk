# Kill-time XP grant

## Name

`kill-xp-grant` — Kill-time XP grant (NPC watch pays the killer)

## Problem

When a creature dies I need the killer to receive that corpse's XP worth immediately — not when someone later takes a "claim victory" verb.

## Forces

- The awarding NPC writing the killer cannot read a third entity's XP worth
  inside that write's `delta_source`. The host reads the observed corpse.
- Attacks remain ordinary attacks; the award belongs to the DM's watch.
- A persistent victim latch prevents repeated payments after successful awards
  and host restarts. Process memory alone cannot establish that guarantee.
- Seeing the fight and holding authority to change state are separate grants.

## Solution

Author the finite `srd/dm/spend-xp-value` and `srd/dm/award-xp` actions before
play. Both require `frontier.set_state`; the DM needs admitted reach to their
targets as well as observation of the dead body and its recorded killer.
The watch in `adventure-runtime/src/dm/watches/initiative-watch.ts`:

1. observes `srd/condition/dead`, the killer and live `srd/xp_value`;
2. dispatches `srd/dm/spend-xp-value` at the victim and awaits success;
3. dispatches `srd/dm/award-xp` at the killer with that observed quantity.

These are two ordered dispatches. If the award fails after the spend succeeds,
the value is already consumed and the host reports `kill_xp_award_lost`.
The pair is not one atomic transaction. A kill with no running NPC host is
not paid by this watch. No action definition or manifest delta is published
per kill.

## Authored write example

The following consequence fragments come from
`spellkave-srd-cc/src/chapters/classes/dm-act-units.ts`. They belong to separate
preauthored actions; the spend predicate requires positive victim XP worth.

```toml
# srd/dm/spend-xp-value, targeted at the victim:
[consequence_frame_writes.frame_write.ModifyResource]
actor = "TargetActor"
resource = "srd/xp_value"
delta_source = "-target.stat('srd/xp_value')"

# srd/dm/award-xp, targeted at the killer:
# ModifyResource.actor = "TargetActor"
# ModifyResource.resource = "srd/xp"
# ModifyResource.delta_source = "actor.stat('core/dispatch_arg_quantity')"
```

The quantity is an act argument evaluated during the dispatch, not a newly
rendered literal definition. Legacy `renderGrantKillXp` exports remain
publisher composition helpers; their offline rendering tests do not prove the
current watch's live dispatch path.

## Proof

- `packages/spellkave-adventure-runtime/tests/live/kill-xp.live.test.ts`
  checks observed XP, spent latch and replay behavior through the actual watch.
- `packages/spellkave-srd-cc/src/test/offline/dm-act-catalog.test.ts`
  checks the authored action catalog.

## Related

[`quest-xp-grant`](./quest-xp-grant.md),
[`proactive-level-up`](./proactive-level-up.md),
[`computed-literal`](./computed-literal.md),
[`actor-stat-self-only`](../repairs/actor-stat-self-only.md).

## Known misuse / anti-pattern

- Publishing a per-kill action definition from the DM host.
- Awarding without spending the persistent victim latch.
- Treating the two receipts as an atomic award or silently ignoring a failed award.
- Hardcoding an XP amount onto each attack template.

## SRD features that use this

Kavemouth Aldwin's watch reads catalog creatures' `srd/xp_value`.
Bundle-specific values: [`kill-time-xp.md`](../../../spellkave-srd-cc/docs/kill-time-xp.md).
