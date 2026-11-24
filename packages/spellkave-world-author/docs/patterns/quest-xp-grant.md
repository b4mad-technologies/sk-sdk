# Quest XP grant

## Name

`quest-xp-grant` — Quest XP grant

## Problem

When a quest terminal fires I need to grant a fixed XP reward to the present party (not the killer).

## Forces

- Terminal evaluation and recipient selection belong to the story's watch.
- Durable per-recipient markers must survive retries and host restarts.
- A completed giver settlement must follow successful recipient awards.
- Elven-mini currently selects the hero and co-located catalog companions
  (Rogue, Hesper, Caddoc), joined or not. Its resolver does not filter on
  `srd.party.heroes`; this known membership gap is tracked as
  `sk-jay0.3.4.11.7`. Party extent admission is a separate kernel decision.

## Solution

At authoring time define one award action and one settlement action per quest.
`adventure-runtime/src/author/dm/quest-xp-acts.ts` builds these finite actions,
requiring `frontier.set_state`. Elven-mini binds them to
`elven_mini/dm/award-quest-xp/<Qn>` and `elven_mini/dm/settle-quest/<Qn>`.
The running DM dispatches them through its act port; it publishes no
per-terminal manifest or action definition.

For each unawarded recipient, one dispatch adds the quantity argument to
`srd/xp` and sets that recipient's `<bundle>/quest/<id>/xp-awarded` marker
from 0 to 1. The world predicate rejects repeat awards. After successful
awards, a separate giver-targeted act changes `accepted` from 1 to 2 and
`rewarded` from 0 to 1. If a later step fails, a fresh watch can retry while
skipping already marked recipients. This is a sequence of receipt-bound
acts, not one multi-recipient transaction.

Author the XP and award-marker homes before play, including in the blueprint
of a companion spawned later. Missing recipient award-marker observations make the watch's reward snapshot
incomplete, so it dispatches nothing. This is not a general rule that numeric
writes cannot initialize absent rows from resource definitions. Changing an already placed body's
definition does not create its new birth-time state homes; migration policy
is tracked separately in `sk-jay0.2.57`.

## Authored write example

The award action is targeted at one recipient and guarded by
`target.stat('<bundle>/quest/<id>/xp-awarded') == 0`:

```toml
[consequence_frame_writes.frame_write.ModifyResource]
actor = "TargetActor"
resource = "srd/xp"
delta_source = "actor.stat('core/dispatch_arg_quantity')"
# A second write in the same dispatch increments the recipient's xp-awarded marker.
```

The host supplies the catalog reward as the act's `quantity` argument.
Legacy `renderGrantQuestXp` exports remain publisher composition helpers;
they are not the production watch's reward path.

## Proof

- `packages/spellkave-adventure-runtime/tests/live/quest-xp.live.test.ts`
  checks terminal gating, recipient awards, settlement and replay through the watch.
- `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/q4-quest-xp.test.ts`
  checks actual hero and companion XP after Q4.
- `packages/spellkave-adventure-elven-mini/tests/offline/dm-acts.test.ts`
  checks finite actions and initial companion award homes.

## Related

[`quest-composition`](./quest-composition.md),
[`kill-xp-grant`](./kill-xp-grant.md),
[`companion-follow`](./companion-follow.md),
[`party-extent-grant`](./party-extent-grant.md).

## Known misuse / anti-pattern

- Awarding quest XP only to whoever landed the killing blow.
- Settling the giver before successful recipient receipts.
- Inferring initial zeroes from absent state rows.
- Selecting recipients by co-location while claiming joined-party membership.
- Leaving required reward-state readers outside the watch's reader closure:
  see [`watch-reader-manifest-closure`](./watch-reader-manifest-closure.md).

## SRD features that use this

Elven-mini Q1–Q12 catalog rewards to the currently selected present recipients.
