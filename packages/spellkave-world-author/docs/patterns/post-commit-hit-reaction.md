# Post-commit hit reaction (OA-shaped mitigate)

## Name

`post-commit-hit-reaction` — Reaction after another creature's manipulate commits

## Problem

A feature should fire as an off-turn reaction after another creature's
manipulate commits against you (a counter-blow, a post-hit heal).
Opportunity Attack already shows the off-turn reaction shape; this pattern
uses the same producer with a post-commit trigger. Damage *mitigation* that
must read the damage amount (Deflect Attacks) is not this pattern: it is
[`condition-hook-on-event`](./condition-hook-on-event.md) on
`Layer2.ResourceDelta`, whose detail carries `delta`.

## Forces

- The reaction producer runs **after** `r_manipulate` commits
  (`reaction_producer::run` with `$event.kind == 'r_manipulate'` and empty
  detail on the post-commit path). Damage `ModifyResource` has already
  applied.
- Candidate reactors are co-located entities **other than** the acting
  attacker (plus the attacker only when `self_eligible`). The hit target is
  therefore a normal co-located candidate.
- Eligibility binds `actor` = reactor, `target` = triggering actor
  (attacker) (the world API).
  Gate with `actor.has_capability('<feature>')`.
- The post-commit **manipulate intent** carries no damage magnitude or damage
  type. The HP write itself is visible as a `Layer2.ResourceDelta` event
  (`delta`, `entity_id`, `resource_id`) to a condition hook — use that when
  the amount matters.

## Solution

1. Author a reaction action like Opportunity Attack:
   - `spends_channel = srd/economy_channel/reaction`
   - `reaction_trigger = "$event.kind == 'r_manipulate'"` (post-commit;
     do not require `$event.detail.phase` — that is pre-commit only)
   - `reaction_eligibility = actor.has_capability('<feature>')`
   - `self_eligible = false` (the target is not the manipulator)
2. Consequence: any frame writes on `Actor` (the reactor) or `TargetActor`
   (the attacker), e.g. a `ModifyResource` heal on the reactor. Clamp is
   automatic at resource max.
3. When the rule needs the damage amount or type, switch to
   `condition-hook-on-event`; when it needs an event the kernel does not
   emit (a fall), record that in a substrate verdict.

## TOML example

Schematic (ids are illustrative; the shipped reaction with this shape is
Opportunity Attack in `packages/spellkave-srd-cc/fixtures/base/playing-the-game/attacks.toml`,
which uses an `r_move` trigger instead):

```toml
# pattern: post-commit-hit-reaction
[[action_definitions]]
action_id = "my-bundle/feature/rally-on-hit"
reaction_trigger = "$event.kind == 'r_manipulate'"
reaction_eligibility = "actor.has_capability('my-bundle/feature/rally-on-hit')"
spends_channel = "srd/economy_channel/reaction"
self_eligible = false

[[consequence_frame_writes]]
template_id = "my-bundle/feature/rally-on-hit/success"
ordinal = 0

[consequence_frame_writes.frame_write.ModifyResource]
actor = "Actor"
resource = "srd/hp"
delta_source = "1d10 + macro('srd/ability_modifier', actor.effective('srd/dex'))"
```

Macros are called as `macro('<id>', args…)`
(`crates/spellkave-dsl/src/lib.rs:1759`).

## Proof

- Precedent: Opportunity Attack
  (`packages/spellkave-srd-cc/fixtures/base/playing-the-game/attacks.toml`)
- Heroic Inspiration uses the **pre-commit** stochastic path
  (`$event.detail.phase == 'resolution'`) — different seam; do not copy
  those detail conjuncts onto post-commit mitigate reactions.

## Related

- [`offer-vs-resolution-roll`](./offer-vs-resolution-roll.md)
- Opportunity Attack eligibility geometry in
  [`interaction-dsl-and-world-authoring.md`](../interaction-dsl-and-world-authoring.md)

## Known misuse

- Expecting `$event.detail.damage` or damage type on post-commit
  manipulate intents (not populated).
- Authoring a hit reaction as `self_eligible` on the attacker's turn (wrong seat).
- Using pre-commit Heroic Inspiration triggers for post-hit mitigate.

## SRD features

- Opportunity Attack (the shipped reaction shape, on `r_move`).
- Deflect Attacks moved to `condition-hook-on-event` (sk-609b.12.2); the id
  `srd/monk/deflect-attacks` is now a self-only "ready" action, not a
  reaction (`fixtures/base/classes/monk.toml:1848-1861`).
- Slow Fall needs a fall event (verdict when absent).
- Concentration break on damage is a condition hook, not a reaction.

## Misuse

- A **forced** rule (concentration save, Relentless Endurance) as a reaction
  window: ADR-0093 D-7 turn-bound windows have no timeout, so silence keeps
  the benefit forever. Forced rules are `condition-hook-on-event`.
- Filing "no damage magnitude on the post-commit intent" as a kernel gap
  before reading `condition_definition.hooks` (`Layer2.ResourceDelta` carries
  `delta`/`entity_id` as Int facts and `template_id`/`resource_id` as Text;
  `crates/spellkave-dsl/src/lib.rs:4035-4100`).
