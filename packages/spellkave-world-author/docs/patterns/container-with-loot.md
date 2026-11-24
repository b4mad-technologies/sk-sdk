# Container with loot

## Name

`container-with-loot` — Place a container holding items; players take them out

## Problem

A room needs a container (chest, cache, shelf) that visibly holds items a
player can take, with no bespoke "search" or "open" action authored per
adventure — reusing the SRD's own generic pickup verb instead.

## Forces

- The SRD already grants every creature a Pick Up action for a loose item on
  the ground OR loose inside a grounded, non-body container (`srd/pickup`,
  SRD 5.2.1 "Interacting with Objects" / "Time-Limited Object Interactions",
  `packages/spellkave-srd-cc/src/chapters/playing-the-game/fragments/
  pickup.ts`) — authoring a second, adventure-local "search the chest" verb
  duplicates a capability the kernel already discloses generically.
- The kernel derives a contained item's disclosure home (`core/contained`,
  the world API) from the item's own
  `entity_containment` row — no niche, predicate, or action needs authoring
  on the container OR the item for this to work; the container only needs to
  actually CONTAIN the item.
- An open, lootable container is loose carriage, not a machine port:
  `slot_id`/`direction` stay empty on the `entity_containment` row (an open
  chest is not a socketed part).
- A per-actor one-shot search gate (the retired "faucet" design, superseded
  by this pattern and never merged; PR #3618 shipped the rebuild) forges a fresh item out of nothing
  instead of moving an authored one, and needs an explicit per-actor
  `object_state` seed row for every body the search must work for — which
  itself risks two traps: `actor.stat(<state>)` on a resource with no seeded
  `object_state` row is `UnknownField`, which fails the WHOLE containing
  predicate closed rather than reading the resource's `initial_value`
  (FAIL-CLOSED PRE-SEEDING, `creation-candidate.ts`'s own header note); and a
  placement's own `resources` param clears and reseeds `object_state`, so
  seeding the gate BEFORE the body's own placement silently wipes the seed.
  A gate authored only for the creation candidate also strands every OTHER
  player body, since the gate is per-actor but seeded for exactly one actor
  (sk-jay0.1.23.36.22.3, closed as obsolete once this pattern replaced the
  faucet). None of that machinery is needed here.

## Solution

1. An entity def for the container — the SRD's own `srd/item/chest`
   (`packages/spellkave-srd-cc/fixtures/base/equipment/gear/chest.toml`, tag
   `srd.item.container`) or any other entity def — placed with
   `spellkave_place_entity`. A cross-bundle entity_def reference is legal
   when the defining bundle is in your `depends_on` closure (e.g.
   `depends_on = ["srd"]`; the closure check is `MF-VAL-214`); no local
   entity_definition is required just to hold loot.
2. The loot items placed the same way, then moved inside the container with
   `spellkave_stow_item` (sk-9ll.3) — `item_entity_key` plus
   `container_entity_key` set to the container's key, `slot_id`/`direction`
   both omitted (loose carriage). No actor is needed for a container
   (sk-jay0.3.26.9), so a chest in a world without NPCs is filled the same
   way. With `actor_entity_key` (an actor with a spatial location) and
   `container_entity_key` omitted, the same verb puts the item straight
   into that actor's carriage — the way to hand a reward item to a hero at
   authoring time.
3. NO verb to author. `srd/pickup`'s niche (`srd/item`, provider `entity`)
   already admits a target tagged `srd.item` that is either `core/grounded`
   or `core/contained`; a body with the `srd.creature` capability grant
   already carries `srd/action/pickup`. Dispatching `srd/pickup` on the
   contained item's own `item:<id>` target ref moves it into the actor's
   carriage and spends one of the actor's free object interactions
   (`srd/economy_channel/object_interaction`) — authored to cover exactly one
   pickup per turn (a second contained item needs a new turn:
   sk-jay0.1.23.36.22.6 finding).

## TOML example

Use the chest and item definitions from the ruleset targeted by your adventure. Include the authored place and the actor’s ordinary object-interaction capabilities to validate the complete workflow.

For a complete, separate offline graph example use
`sk docs spatial-minimal-cell --full`; it does not implement this container task.

No `[[action_definitions]]`, `[[niche_definitions]]`, or
`[[resource_definitions]]` rows for the container itself — `srd/pickup` is
bundle-owned, authored once in `srd`.

## Proof

- Offline: `packages/spellkave-adventure-elven-mini` `typecheck` / `test`
  (`author:elven-mini:check`); `packages/spellkave-srd-cc` `test:fast`.
- Live: `packages/spellkave-srd-cc/src/test/live-self-seeding/scenes/pickup-two-potions.test.ts`
  and `pickup-disclosure.test.ts` — a hero dispatches `srd/pickup` against both
  potions' `item:<id>` target refs through the generic PLAYER `r_manipulate`
  reducer (no elven-mini bespoke action, no admin move of items); the authored
  loft chest itself is pinned offline in
  `packages/spellkave-adventure-elven-mini/tests/offline/seed-facts.test.ts`; and
  `packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/
  pickup-container.test.ts`, proving the generic capability against a
  disposable self-seeded scene. The one-pickup-per-turn budget comes from
  the channel capacity (`srd-cc fixtures/base/playing-the-game/action-economy.toml:52-54`,
  the world API);
  neither test asserts that a second same-turn pickup is refused — both
  advance the turn before each pickup.

## Related

[`consumable-inventory-consume`](./consumable-inventory-consume.md) (what a
player does with the item once carried).

## Known misuse / anti-pattern

- A bespoke per-adventure "search the container" action that `InsertItem`s a
  fresh item into the actor's inventory instead of moving an authored one
  out of the container — the retired faucet design (never merged; PR #3618 shipped this pattern instead):
  it forges items ex nihilo, needs an explicit per-actor `object_state` seed
  row for every body (else `actor.stat` fails `UnknownField`, closing the
  whole predicate — see Forces), and a gate seeded only for the creation
  candidate strands every other player body. Do not reintroduce it;
  `srd/pickup` needs no per-actor state at all.
- Authoring a custom niche for "container contents" — the kernel already
  derives `core/contained` from the `entity_containment` row itself; no
  niche or predicate authoring closes any gap here.
- Tagging the container's ENTITY DEFINITION instead of the placed instance
  when a niche or the website compendium needs a per-instance tag — use
  `place_entity`'s own `tags` param on the instance; a definition-level tag
  lands in the overflow basin instead of the intended compendium page.

## SRD features that use this

- Elven-mini's loft chest (`elven_mini/adventure/item/loft_chest_1`, 2x Potion
  of Healing, sk-jay0.1.23.36.22.2 — design §6, L-4 loop pilot).
