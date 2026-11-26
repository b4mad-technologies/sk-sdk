# Quest composition (giver slot + objective + terminal watch + reward)

## Name

`quest-composition` — A quest is a composition, not a primitive

## Problem

I need a quest: an NPC offers it, the hero does something in the world, and when it is done the hero is rewarded — and there is no quest row kind.

## Forces

- There is no quest primitive in the world (verified 2026-08-22), and the
  composition below does not need one.
- Acceptance must be a discrete act (no free-text commitment).
- The terminal condition is a predicate over world state the giver (or the
  DM) can observe; it must be testable offline against a fake view.
- Rewards must be paid exactly once and must survive a host restart.
- XP recipients are a policy decision (the present party, the killer, …);
  the host enumerates them and dispatches an award act per recipient —
  one write cannot broadcast to "the party present".

## Solution

| Part | Mechanism |
|---|---|
| Offer / accept | a [`dialog-choice-slots`](./dialog-choice-slots.md) pair on the giver (`1: I'll do it.` / `2: Not today.`); the accept writes a persistent world resource `<bundle>/quest/<id>/accepted` (kavemouth `author/quest-progress.ts:8-30`) — conversation steps stay private to the brain |
| Objective | enemies, items and places authored as ordinary content ([`blueprint-instance-override`](./blueprint-instance-override.md)) |
| Terminal | an exact boolean over a quest view — `dead(x) && …`, `has_item(hero, y)`, `at(npc, node)`, `flag(z)` — evaluated by the giver/DM seat watch against a live snapshot projection. A `flag(z)` term reads the persistent resource `<bundle>/quest/flag/<z>`, so **something must write it**: an action whose consequence sets it (kavemouth `author/tomb-key.ts` is the worked writer for `q9_tomb_opened`). A terminal flag with no writer never fires |
| Reward | XP via finite authored recipient awards ([`quest-xp-grant`](./quest-xp-grant.md)), optional items / follow-up speech; each recipient owns an `xp-awarded` marker, and a separate giver settlement changes `accepted` and `rewarded` after successful awards. The watch's memory is only a fast path |
| Parley (optional) | a villain slot open while `alive(villain) && minions_alive >= 1` whose accept must write the alternative terminal's flag. **Not wired in kavemouth yet:** `createParleyOverlay` (`npcs/quests/parley.ts`) has no production caller and no action writes `q4_maelis_surrendered`, `q5_camp_burned` or `q7_truce`, so those endings are reached only in offline tests (tracked on `sk-jay0.3.4.11`) |
| Companion (optional) | the giver's seat flips to [`companion-follow`](./companion-follow.md) after the terminal |

Author the catalog as data (giver, slot text, objective, terminal, reward,
enemies) and derive both the seats and the offline proofs from it.

## Authored composition example

The quest catalog is seat data; its world-facing parts are ordinary rows.
For Q1 the catalog reward is 50 XP per selected present recipient. The giver's
shared Answer 1/2 palette accepts or declines the offer. A terminal watch
observes the dead cellar rats and swarm, then runs fixed
`kavemouth/dm/award-quest-xp/Q1` actions and `kavemouth/dm/settle-quest/Q1`.
The generic action builder is `adventure-runtime/src/author/dm/quest-xp-acts.ts`;
kavemouth binds its IDs in `author/dm-acts.ts`.

The award formula reads `actor.stat('core/dispatch_arg_quantity')`. Its
predicate and write use the recipient's durable award marker; settlement uses
the giver's accepted and rewarded resources. Author these homes before play.
There is no per-terminal action definition or manifest publication.

## Proof

- `packages/spellkave-adventure-kavemouth/tests/offline/kavemouth-quests.test.ts`
  (every terminal satisfies on a fake view; every reward returns the
  catalog XP; rung sums clear the thresholds)
- Q1 live representative under `SPELLKAVE_LOCAL_NODE=1`:
  `packages/spellkave-adventure-kavemouth/tests/live-preseeded/player/adventure/levels/level-1/03-cellar-rats.ts`
  (driven by `…/player/adventure/adventure.test.ts`).

## Related

[`dialog-choice-slots`](./dialog-choice-slots.md),
[`quest-xp-grant`](./quest-xp-grant.md),
[`kill-xp-grant`](./kill-xp-grant.md),
[`companion-follow`](./companion-follow.md),
[`milestone-gate-terminal-flags`](./milestone-gate-terminal-flags.md)
(gating a later beat on earlier terminals).

## Known misuse / anti-pattern

- Filing "no quest system" as a kernel gap.
- Free-text acceptance ("I'll help") as the commit path.
- Keeping commitments or paid rewards only in seat memory: a host restart
  forgets them and pays twice. Accept and reward are persistent world
  resources the grant predicate reads; only conversation steps stay in the
  seat.
- A `flag(z)` terminal with no action that writes the flag.
- Granting reward XP to whoever landed the last blow (that is kill XP, a
  different policy).

## SRD features that use this

- Kavemouth Q1–Q12 (givers, terminals, rewards, parleys, Hesper):
  [`kavemouth-quests.md`](../../../spellkave-adventure-kavemouth/docs/kavemouth-quests.md).
