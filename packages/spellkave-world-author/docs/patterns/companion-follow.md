# Companion follow seat

## Name

`companion-follow` — Companion follow seat

## Problem

After a quest, an NPC should follow the hero along place-graph edges without a kernel pathfinding primitive.

## Forces

- No pathfinding `FrameWriteOp`: movement is ordinary traverse/move
  affordances the seat chooses.
- Companion mode is a seat policy, not a condition.
- Who decides *where* the companion goes is a design choice: the seat itself
  (autonomous follow) or the human leading the party (ordered follow).

## Solution

Two shipped shapes.

**Autonomous follow brain** (Caddoc, Aldwin's rogue): the Rust host's companion kind
(formerly the TypeScript `createFollowBrain`, deleted with the TypeScript host), composed out of combat. On its turn it waits when
co-located with the ally; otherwise it prefers a scene exit whose disclosed
destination mentions the ally node's local name or full id, else a stable
first exit.

**Ordered follow under a companion policy** (Hesper, sk-jay0.1.23.12): the
NPC runs the host's shared player runtime (the TypeScript `buildPlayerRuntimeSeat` was deleted). The quest
terminal installs a `CompanionPolicy` (`createTerminalCompanionPolicySwitch`,
elven-mini `npcs/quests/terminal-companion.ts`); from then on strategic
direction belongs to the human, and only a live `follow` order moves her,
routed through the leader-location reader and the perceived map. The
follow brain's substring / first-exit fallback is not used on this path
(`player-runtime-seat.ts:609-611`). The switch reads the durable terminal
every cycle, so a restarted seat re-installs the policy from the world.

Quest context: `elven-mini-quests.md`,
`elven-mini-party.md`.

## TOML example

No special TOML — seat policy in TypeScript:

```ts
// pattern: companion-follow
// autonomous (Caddoc, rogue): createCompanionBrain composes createFollowBrain
createFollowBrain({ readAllyNodeId, readSelfNodeId });
// ordered (Hesper): the terminal installs a CompanionPolicy on the player
// runtime; only a human `follow` command moves the companion.
```

## Proof

- Autonomous: the Rust host's companion engine tests (`crates/spellkave-npc-host`).
- Ordered: elven-mini `npcs/__tests__/hesper-companion.test.ts`,
  `companion-commands.test.ts`, `terminal-companion.test.ts`.

## Related

[companion-combat](./companion-combat.md) (follow + role fight + ally heal),
[quest-xp-grant](./quest-xp-grant.md).

## Known misuse / anti-pattern

- Kernel `RelocateEntity` every tick to teleport-follow.
- Soft-locking when no traverse edge exists and there is no wait fallback.
- Copying the follow brain's name-substring exit choice into the ordered
  path — the player runtime retired it there on purpose
  (`player-runtime-seat.ts:609-611`).

## SRD features that use this

- **Hesper of the Lodge** after Q6 (ordered follow, first sk-ruh companion slot).
- **Brother Caddoc** after Q10 and **Aldwin's Blade** at hero L2 (autonomous follow brain).
