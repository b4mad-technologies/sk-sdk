# Draft-then-confirm wizard (multi-step form run by an NPC)

## Name

`draft-then-confirm-wizard` — Draft in NPC memory, grant through authored acts after Confirm

## Problem

I need a guided character-creation or advancement form where choices remain a
draft until confirmation admits the sheet and inventory changes. Explicit
name and description adoption can update their bounded text homes earlier;
feature and equipment grants wait for Confirm.

## Forces

- Free text proposes a value for explicit adoption (ADR-0096 D-7). The
  creation parser's existing exact-label exception remains an open decision;
  new dialogs should select options by acted slot.
- Grants follow confirmation, and each successful act precedes the corresponding
  latch (ADR-0096 D-4/D-5).
- Menus can exceed the sixteen-slot palette and require repeated picks.
- A talking NPC needs ordinary palette acts; privileged sheet changes use a
  separately admitted DM presence, within its extent.
- There is no definition inheritance: the blueprint must initialize each
  resource and Text home the finite vocabulary will update.

## Solution

1. Author the shared Answer 1–16 palette and closed-question vocabulary before
   play. Request an ask-menu act with the question and exactly N option labels.
   The same frame inscribes the directed speech and opens its occurrence.
   [Dialog choice slots](./dialog-choice-slots.md) explains the fixed palette;
   [prompt occurrences](./prompt-occurrence.md) explains the bound trace.
2. Associate the current option list with the observed player body in process
   memory. An acted slot selects that list's option. Large choose-N groups
   offer remaining options until the count is met; a group with no available
   options cannot leave an impossible open question.
3. Parse supported name, scores and description inputs into proposals. Offer
   explicit adoption. Name and description adoption request bounded text acts;
   appearance updates an existing Public Text state and backstory an existing
   Hidden Text state, preserving ownership and visibility.
4. Offer Confirm as a one-slot question when the structured draft is complete.
   The historical dedicated Confirm action is disabled (`1 == 0`); its ID
   remains readable in old traces. Independently recheck the draft before
   building the confirmation plan.
5. Dispatch the finite sheet plan through the admitted DM presence: selected
   identity tags, absolute state values, feature tags and the compiled starting
   kit. Party membership and extent-bearing sight come from the unbound vessel's
   blueprint. Runtime code publishes no grant or prompt manifest.
6. Advance the completion latch and announce completion only after successful
   receipts. A kit is one atomic frame, including nested items, equipment and
   its completion marker. Separate sheet acts can succeed before a later act
   refuses; the whole wizard is not one transaction. Retain unfinished work
   for retry and use the kit marker to prevent duplicate inventory.
7. A host restart can reconstruct drafts from retained visible speech and
   compatible menu data. This is replay, not a durable draft snapshot. The
   world-owned body and items persist independently of the NPC's process.
8. Let the candidate walk the answered questions. Author two input-less
   actions beside Discard, with the same phase gate, and name them in the duty
   document as `creation.wizard.back_action_id` and `forward_action_id` (the
   shared DM bundle ships `dm/creation/back` and `dm/creation/forward`). Back
   asks the question before the open one again and clears nothing; the old
   answer stands until another is acted. A new answer replaces what that
   question held, and a question that takes several picks is reopened whole.
   Forward leaves a reopened question as answered. Name, scores, appearance
   and backstory need neither: their own input actions can be sent again.
   Both actions leave a speech trace like every menu answer, which is what
   the replay of step 7 reads; a restart in the middle of a walk has not been
   tested.

9. Keep the order of the questions as data, not in the NPC's program, and
   send where the dialogue stands with every question. The DM's creation
   wizard does both; [guided dialogue](./guided-dialogue.md) describes the
   step list and the machine side. The advancement wizard does not yet.

## TOML example

The author seeds fixed question definitions; the runtime selects a question
and supplies its presentation through the admitted act. The creation offer
builder uses the same one-option shape for Confirm:

```ts
if (step === null && creationStructuredDraftsComplete(state, catalog)) {
  return offerFromPairs("confirmation", "confirm:character", [
    { label: "Confirm character creation", pick: { kind: "confirm" } },
  ]);
}
```

The ask act carries one label; the player's Answer 1 consumes its occurrence.
The NPC then requests the confirmation plan's authored acts. No author delta
is computed or applied by the dialogue runtime.

## Proof

- `crates/spellkave-npc-host/src/dm/engine/creation_tests.rs` pins the draft
  and its offers on the Rust DM engine: slot binding in catalog order, the
  class change that clears class-dependent picks, the token grammar, the
  vocabulary, and stepping back and forward
  (`native_creation_back_and_forward_walk_answered_questions`,
  `native_creation_back_reopens_a_multi_pick_question_whole`), and that the
  order follows the guide (`native_creation_asks_in_the_order_the_guide_holds`). These are pure
  engine tests; they do not prove live mutation. The TypeScript creation test
  this page named before went with the TypeScript host.
- `packages/spellkave-srd-cc/src/test/offline/dm-level-up.test.ts` proves finite
  plans and accepted-receipt-before-latch ordering.
- `packages/spellkave-adventure-runtime/src/dm/dialog/prompt-offer.test.ts`
  pins the atomic ask shape, labels and matching response count.
- Live creation has no automated acceptance test since the TypeScript host
  was deleted; `just play-host` stages a world where the Rust DM runs it, and
  `apps/classic/PLAYTEST.md` records the hand-played runs.

## Related

[Dialog choice slots](./dialog-choice-slots.md),
[advancement choice](./advancement-choice.md),
[tag membership menu](./tag-membership-menu.md),
[actor-carried feature verb](./actor-carried-feature-verb.md),
[proactive level-up](./proactive-level-up.md), and
[offer-gate/consume-guard parity](./offer-gate-consume-guard-parity.md).

## Known misuse / anti-pattern

- Runtime author deltas for prompt definitions, sheet grants or inventory.
- Treating a completed announcement as proof that a privileged act succeeded.
- Granting a feature capability without initializing its required resource.
- Re-parenting the live body to a pregen definition to apply its sheet.
- Claiming that all creation writes are deferred until Confirm: explicit name
  and description adoption can occur earlier.
- Copying creation's exact spoken-label convenience into a new dialogue while
  its parse-to-propose decision (`sk-jay0.1.48`) remains open.

## SRD features that use this

Aldwin's creation and advancement wizards use these steps. The SRD vocabulary,
kit composition and world-owned vessel limits are described in
the character creation notes of the `@spellkave/srd-cc` docs (not in this
repository).
