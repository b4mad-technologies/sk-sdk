# Proactive level-up watch

## Name

`proactive-level-up` — Proactive level-up watch (NPC offers when a threshold is crossed)

## Problem

When the hero crosses the next XP threshold, the DM should call them over and offer the level-up — the player should not have to poll their own sheet.

## Forces

- An invitation needs addressability; the consent offer needs co-location.
- One durable ceremony latch records the last applied level, so later levels
  can reopen the wizard. Process memory alone cannot prove sheet completion.
- The drafting handles and choices must exist before the offer is delivered.
- Movement carries hero and DM into the advancement limbo where the wizard's
  spatial niches are attached, and later returns them to the authored destination.

## Solution

The DM's threshold watch reads observed XP and level and compares the next
threshold. Away heroes receive a directed telepathic invitation through the
DM's authored Party extent. Once co-located, the watch offers the discrete
Accept/Decline pair. Its per-hero/level memory limits repeated invitations;
a host restart can re-invite or re-offer before the durable latch changes.

Ordinary `dm/level-up/enroll` remains a zero-delta initialization act for
DM and trainee state homes. The current candidate blueprint also seeds its
own draft homes. The watch checks the DM's visible applied-level latch before
its offer; this is not a claim that enrollment uniquely creates every home.
Before offering, the host opens the preauthored `dm/level-up/drafting`
condition through `dm/act/level-up/open`. The condition admits fixed consent
and drafting handles. No per-hero action definitions or runtime manifest
grants are published. The seat and XP watcher share one host-level opening
receipt per hero and observed level, so a delayed watcher cannot reopen a
phase already declined. A refused opening remains retryable; a later earned
level gets its own opening. A new host retains the documented reoffer behavior.

On consent, authored movement actions carry both participants into limbo.
Feature and sheet acts complete before the applied-level latch advances;
the successful apply frame also removes the drafting condition, then return
carries both back. Decline removes the condition in the same frame that clears
consent, withdrawing all six phase-derived handles. Required
adventure configuration supplies the hero resolver, persona, level cap,
invitation and return location; the runtime does not embed a story's cast.

## Authored reach example

The elven-mini publisher gives Aldwin the Party-scoped telepathy capability:

```toml
[[actor_capabilities]]
actor_entity_key = "elven_mini/adventure/npc/aldwin_1"
bundle_id = "elven_mini"
capability_id = "srd/action/communicate/telepathy"
elevation_class = ""
extent_kind_ref = "party"
extent_ref = "srd.party.heroes"
source = "srd"
```

That grant supplies reach, not evidence that an invitation, consent or sheet
change succeeded. The recorder must observe their actual receipts and effects.

## Proof

- `packages/spellkave-adventure-runtime/tests/live/xp-threshold.live.test.ts`
  checks the away invitation and threshold watch.
- `packages/spellkave-adventure-runtime/tests/live/seat-ceremony.live.test.ts`
  checks the autonomous menu-answer ceremony.
- `packages/spellkave-adventure-elven-mini/npcs/__tests__/aldwin-xp-threshold.test.ts`
  checks the authored phase-opening plan.
- `packages/spellkave-adventure-runtime/src/dm/level-up/grant-driver.test.ts`
  checks shared opening receipts, retries and later-level reopening.
- The adventure story's level-up chapters check the resulting player sheet.

## Related

[`kill-xp-grant`](./kill-xp-grant.md),
[`advancement-choice`](./advancement-choice.md),
[`draft-then-confirm-wizard`](./draft-then-confirm-wizard.md),
[`party-extent-grant`](./party-extent-grant.md),
[`relocate-entity-ungated`](../repairs/relocate-entity-ungated.md).

## Known misuse / anti-pattern

- Free-text consent, repeated offers every tick or a one-shot level latch.
- Increasing range to cross graphs instead of supplying admitted extent reach.
- Moving the hero without the DM or the wizard's spatial attachments.
- Treating the invitation or a selected decision as proof of successful acts.
- Guarding world-triggered return work solely with restart-lost process memory.
  The current watch blocks repeated refused returns at one latch value through
  `refusedReturnAtLatch`; it does not establish a world-location guard.

## SRD features that use this

Elven-mini Aldwin's levels 2–4 arc. Bundle IDs and recorder constraints:
`proactive-level-up.md` (`@spellkave/srd-cc` docs, not in this repository).
