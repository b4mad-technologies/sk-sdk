# Companion combat seat

## Name

`companion-combat` — Companion follow + role fight + ally targeting

## Problem

A friendly companion should follow the hero out of combat, fight with a
named combat role when a scene session opens, never target the hero, and
optionally spend a healing consumable when the hero is bloodied.

## Forces

- Follow already exists as seat policy (`companion-follow`) with no pathfinding
  FrameWriteOp.
- Combat roles are content-free data (`@spellkave/adventure-runtime/npc-kinds`), run by the Rust NPC host's kinds (`crates/spellkave-npc-host`; the TypeScript brains were deleted, sk-jay0.1.55.60.8).
- Ally vs foe identity is host-owned (the brain must not invent factions).
- Healing is "if a matching heal affordance is offered for the ally" —
  inventory is expressed by the palette, not a second inventory protocol
  inside the brain. **No SRD verb gives a consumable to another creature
  today:** `srd/consume` targets a potion the drinker carries and heals the
  drinker, so a heal dispatched at the ally never matches it. Caddoc, the
  rogue and Hesper still wire `srd/consume` as their heal id (so it lights up
  if an administer verb lands); until then their heal branch does not fire
  (`npcs/quests/hesper.ts:61-68`; tracked as `sk-jay0.1.23.35.7`). A heal
  that works today needs an ally-targeted verb such as
  `srd/spell/cure-wounds/cast`.
- Speech lines (join / combat join) are app-owned.

## Solution

**This is the generic party companion mechanism** — not a single-NPC seat.
Two shipped shapes use it:

- **Companion kind** (the Rust host's `companion` kind; formerly `createCompanionBrain`): Caddoc
  (`healer`) and Aldwin's rogue (`skirmisher`) — steps 1–6 below.
- **Shared player runtime kit** (Hesper, sk-jay0.1.23.12): Hesper no longer
  has a brain of her own. She runs the host's shared player runtime (the TypeScript
  `buildPlayerRuntimeSeat` was deleted); the archer role brain is her combat-cycle
  `tacticalOverride` (hero never a target), and the join is a policy switch
  after which only a human `follow` order moves her. See the header of
  `packages/spellkave-adventure-elven-mini/npcs/quests/hesper.ts`.

Companion brain steps:

1. **Join trigger** — idle until `isCompanion()` (quest terminal / story latch).
2. **Out of session** → `createFollowBrain` toward the ally node.
3. **In session, my turn** → `createCombatRoleBrain` with caller `role`
   (Caddoc = `healer`, Aldwin's rogue = `skirmisher`; `lurker` also exists)
   and a host snapshot whose **foes are hostiles to the hero** and **allies
   include the hero**. Hard-filter any *attack* whose `targetRef` is the
   protected ally (heal affordances on the ally remain legal).
4. **Heal** — role `healer` heals the **lowest** ally below half HP when a
   heal action from `healActionIds` is offered **for that ally**, else
   attacks; any role may pass a `heal` overlay. See the Forces note: with
   `srd/consume` as the heal id this branch never fires today.
5. **Session ends** → follow automatically (`inSession === false`).
6. Optional join / combat-join / addressed Speak-To lines (app-owned).

A later companion is **configuration only**: `{ role, isCompanion, speech,
allyTargetRef, readAllyNodeId, readSelfNodeId, world, actions }` (plus the
optional `heal` overlay) — no new brain module (sk-609b.15).

Storyline slots (sk-609b.15): **Aldwin's rogue** (`skirmisher`) at hero L2;
**Hesper** (`archer`) after Q6; **Caddoc** (`healer`) after Q10. See
[`elven-mini-party.md`](../../../spellkave-adventure-elven-mini/docs/elven-mini-party.md).

## TOML example

No special TOML — seat policy in TypeScript. Generator / seat wiring cites
the pattern:

```ts
// pattern: companion-combat
createCompanionBrain({
  isCompanion: () => joined,
  role: "archer",
  allyTargetRef: heroRef,
  readAllyNodeId,
  readSelfNodeId,
  world: () => ({ self, foes: hostilesToHero, allies: [hero] }),
  actions: { rangedActionId: "srd/attack/ranged", meleeActionId: "srd/attack/melee" },
  // A heal verb whose TARGET is the ally. Not `srd/consume`: its target is a
  // potion the drinker carries and the effect lands on the drinker.
  heal: { actionIds: ["srd/spell/cure-wounds/cast"] },
  speech: { speakToActionId, traceKindId, joinLine, combatJoinLine },
});
```

## Proof

- Offline simulation: the Rust host's companion engine tests (`crates/spellkave-npc-host`).
- Live representative: `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/party-mill-fight.test.ts` (companion seats in a real multi-NPC fight). The never-the-hero and follow-after-session claims are proven offline only, in the companion-brain test above

## Related

[companion-follow](./companion-follow.md),
`combat-role-brains.md` (deleted with the TypeScript host),
[dialog-choice-slots](./dialog-choice-slots.md).

## Known misuse / anti-pattern

- Listing the hero in `world().foes` and relying on luck.
- Kernel RelocateEntity every tick to teleport-follow (same anti-pattern as
  companion-follow).
- Hardcoding SRD potion / attack ids inside the host engine (pass them in as data).

## SRD features that use this

- **Aldwin's Blade** (rogue skirmisher, companion brain) after hero L2 dialog offer.
- **Hesper of the Lodge** (archer, player-runtime kit) after Q6; fights in Q7 warren.
- **Brother Caddoc** (healer, companion brain) after Q10 — heal branch
  inert until an administer verb exists (`sk-jay0.1.23.35.7`).
