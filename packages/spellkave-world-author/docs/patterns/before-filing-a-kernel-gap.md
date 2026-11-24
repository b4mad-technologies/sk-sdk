# Before filing a kernel gap

## Name

`before-filing-a-kernel-gap` — The checklist every lane runs before a substrate verdict

## Problem

Three lanes filed Action Surge as a kernel gap although `extra-action-budget`
existed; two filed "concentration needs damage facts" although condition
hooks existed. Canon-warden runs are expensive; a wrong "kernel" label costs
a design note, a review, and a redesign.

## Checklist

In order; stop at the first hit.

1. **Catalog by problem** — [`index.md`](./index.md). Search the Problem
   column, not the mechanism names.
2. **Grep `packages/spellkave-world-author/docs/repairs/`** for the
   verb/effect name. Involuntary / un-gated primitives often already live
   there (RelocateEntity lesson — forced move without a place_edge is a
   repair, not a missing r_move flag).
3. **Prior verdicts** — `packages/spellkave-srd-cc/docs/substrate-verdicts/`:
   what was already tried, and with which exact refusal.
4. **Event-driven seams you may have missed**: condition hooks
   (`condition-hook-on-event`), autonomy jobs / `fire_at_boundary`
   (`lingering-hazard-zone`, `rest-boundary-resource-refill`), host watches
   (`kill-xp-grant`, `quest-xp-grant`) for grants and narration.
5. **A reaction window is never a forced rule.** In a turn-based session a
   window has no timeout and waits for `r_react` (ADR-0093 D-7), so a
   player who never answers keeps the benefit; forced rules belong in
   condition hooks.
6. **Attempt it and keep the error.** A verdict needs the authored rows and
   the verbatim validator/runtime refusal (`MF-VAL-…`, `MF-DSL-…`,
   `UnknownField`), not a reading of the corpus.
7. **Classify honestly** (K-A rule, 2026-08-22; worked use in
   `packages/spellkave-srd-cc/docs/substrate-verdicts/dispatch-args-kernel-design.md`
   §B): a kernel-prepopulated fact is
   outside K-1..K-5 only when it is a *pure projection of state the kernel
   already holds, carrying zero vocabulary the kernel had to invent*
   (`core/distance_to_actor_mm`, `core/resolution_roll_modifier`). Anything
   that bakes an id, prefix, radius, or condition into the kernel is a closed
   convention — worse than an enum because it is ungreppable — and must be a
   **parameterised leaf with authored arguments** (`peers_near_target`,
   `participant_tag_group_count`, `shares_tag`). "No new enum arm" is not a
   sufficient test.
8. **Name it content-neutrally.** The kernel has no damage, ally, faction,
   spell or class; it has resources, tags, conditions, events, subjects.
9. **Grep the populators before claiming a fact is unreadable.**
   `selection/entity_facts.rs` (`subject_capability_facts`) and
   `roll_bias.rs` (`manipulation_spatial_gate_facts`) are the two places a
   condition gate / outcome guard reads cross-party capabilities and distance.
   A silent `has_capability → false` is often a missing thread into one of
   those pools, not a missing DSL op — and `target.has_capability` never sees
   granted capabilities (`sk-jay0.2.48`).

## Related

`extra-action-budget`, `condition-hook-on-event`, `post-commit-hit-reaction`,
`mastery-gated-attack-variant`.
