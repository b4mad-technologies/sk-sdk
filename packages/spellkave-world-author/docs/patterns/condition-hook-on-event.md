# Condition hook on event (auto-resolving, per holder)

## Name

`condition-hook-on-event` — A condition reacts to a typed world event on its own holder, without a player-accepted window

## Problem

"While I am concentrating, any damage forces a CON save." "While raging, the
first hit each turn adds dice." "When I would drop to 0 HP, drop to 1
instead." The rule must fire by itself when something happens *to the
holder*, with no reaction window to accept or decline. (Plain expiry — "end
on a long rest", "clear at turn start" — is not this pattern: use the
condition's `expires_at_boundary`.)

## Forces

- A reaction window (`post-commit-hit-reaction`) is **optional by design**:
  ADR-0093 D-7 turn-bound windows have no timeout, so "never answer" is a
  legal outcome. A forced save modelled as a window can be kept forever by
  silence — wrong rule, wrong canon.
- Condition hooks already exist: `condition_definition.hooks` run on **every**
  typed event (the world API `record_event_typed`), iterate
  only the **active** `target_condition` rows, and run one side effect:
  `invoke_outcome_graph(...)` (see the next bullets).
- `Layer2.ResourceDelta` hooks see `resource_id`/`template_id` (Text) and
  `entity_id`/`delta`/`new_value` (Int). Kernel opening K-B (2026-08-22,
  ADR-0106) made those Int facts readable, registered the newer event kinds
  for the validator, exposed the holder's own entity id as
  `target.stat('core/entity_id')`, and fixed the side-effect payload so hook
  consequences actually execute on the holder.
- A hook cannot write `RemoveCondition` inline: the one side-effect op that
  **executes** inside a hook is `invoke_outcome_graph('<consequence_template_id>')`,
  which resolves to a **consequence template** (the name is historical) whose
  own `RemoveCondition`/`ModifyResource` frame writes run with the holder
  bound as Actor/TargetActor. `modify_resource`/`apply_status`/`emit_trace`,
  `OutcomeSequence` and `Arbitrate` parse but are recorded as explicit skips
  (`ConditionHookSkippedSideEffect`), never silent
  (the world API).

## Solution

Put the rule on the condition, keyed by the event kind that should trigger it:

Copied from `packages/spellkave-srd-cc/fixtures/base/spells/casting.toml`
(description trimmed):

```toml
# pattern: condition-hook-on-event
[[condition_definitions]]
bundle_id = "srd"
condition_definition_id = "srd/condition/concentrating"
display_name = "Concentrating"
gate_predicate_source = "1 == 1"
remove_time_policy = "srd/remove_policy/independent_lifetime"
stacking_rule = "srd/stacking/single"

[[condition_definitions.hooks]]
detail_filter_source = "$event.detail.entity_id == target.stat('core/entity_id') && $event.detail.resource_id == 'srd/hp' && $event.detail.delta < 0"
event_kind = "Layer2.ResourceDelta"
expression_source = "invoke_outcome_graph('srd/concentration/check')"
# `srd/concentration/check` is a consequence_template with one bare
# RemoveCondition frame write. As shipped there is NO save — see below.
```

The hook row accepts exactly `event_kind`, `detail_filter_source` and
`expression_source` (unknown keys are rejected;
`crates/spellkave-schema/src/lib.rs:2425-2440`). Field semantics:
[`interaction-dsl-and-world-authoring.md`](../interaction-dsl-and-world-authoring.md)
§"Reacting to events with condition hooks".

### Residual: DC cannot use `$event.detail.delta` inside the consequence

Attempted (content, sk-609b.12.2): put the SRD DC
`max(10, (0 - $event.detail.delta) / 2)` on the **consequence template's**
`ForEachActorInRadius.predicate_source` (where the CON save must run, because
hook evaluation facts do not carry ability scores — only event detail +
holder `core/entity_id`). **Refused:** `$event.detail.*` is only in scope for
hook `detail_filter_source` / `expression_source`. The consequence path binds
Actor/TargetActor via `apply_consequence_with_bindings` with
`FrameBindingContext::literal_only()` and no event context
(`condition_definition.rs` Phase B).

**Shipped content: no save at all.** The filter has no die roll and the
template only removes the condition, so any HP loss the holder did not cause
ends concentration (`casting.toml:62-80`; bug `sk-jay0.3.12.1`). The
generator comment, the template description ("failed CON save DC 10") and
the live-test header claim a DC 10 save that does not exist. The live proof
`packages/spellkave-srd-cc/src/test/live-self-seeding/mechanics/condition-hooks.ts`
(other-caused −7 HP) asserts only that the condition drops. A fixed DC 10
would equal `max(10, half damage)` for every hit dealing less than 22
damage.

## Proof

- Kernel demos (K-B): `openspec/specs/world-interaction-kernel/demos/sk-609b-kb-condition-hooks.demo.md`
  — other-caused HP loss removes the holder's condition via the template's
  `RemoveCondition`, a self-caused spend does not fire, a second
  concentrating creature is untouched; `sk-609b-kb-reentrancy-bound.demo.md`
  — an authored A↔B hook cycle stops at depth 3 with the reducer still `ok`.
- Authoring reference: `interaction-dsl-and-world-authoring.md` §"Reacting to
  events with condition hooks".
- Content: `packages/spellkave-srd-cc` concentration (`srd/condition/concentrating`),
  Deflect Attacks (`srd/condition/deflect-ready`), Relentless Endurance
  (`srd/condition/relentless-endurance-ready`) — sk-609b.12.2.

## Used by

The srd-cc base content ships six hooks: Concentration
(`spells/casting.toml`), Deflect Attacks mitigation (`classes/monk.toml`),
Relentless Endurance 0-HP intercept (`character-origins/traits.toml`), the
Unconscious condition (`playing-the-game/conditions.toml`), Barkskin and Shield of
Faith (`spells/level-2/barkskin.toml`, `spells/level-1/shield-of-faith.toml`). The Frenzy marker and
rest-expiry of blessings use `expires_at_boundary`, not hooks.

## Related

`post-commit-hit-reaction` (optional, player-accepted — use for choices, not
forced rules), `rest-boundary-resource-refill`, `condition-grant-and-suppression`.

## Residual: hook-invoked consequences lack spatial bindings

K-B Part A4 binds Actor/TargetActor **entity** refs only
(`FrameBindingContext { actor_ref, target_entity_ref, ..literal_only() }`).
`ActorSpatialRef` / `TargetSpatialRef` are absent, so
`ForEachActorInRadius` centers fail with `missing …SpatialRef binding`.
Use **bare** `RemoveCondition` / `ModifyResource` frame writes (target_ref
`Actor`), and put dice gates on the hook `detail_filter_source` (which can
roll `d20` and read `$event.detail.*` + `target.stat('core/entity_id')` +
statuses — **not** ability scores or other resources).

A flat save could therefore sit on the filter (e.g. `d20 >= 10`, DC 10, no
modifier); the CON modifier stays residual until hook facts gain ability
scores or bindings gain spatial refs. Concentration does not ship even the
flat save today (see above). That the filter can roll is inferred from the
rng the hook evaluator receives
(`condition_definition.rs:937`); no test asserts a d20 filter yet.

## Misuse

- Filing "the kernel cannot see damage" as a substrate gap: the kernel has no
  damage concept; it has `ResourceDelta` events and condition hooks. Two
  lanes and one lead filed this in 2026-08 before reading
  `condition_definition.hooks`.
- Modelling a forced save as a reaction window.
- Host-side watches (`kill-xp-grant` shape) for rules that must be atomic
  with the hit — those are for grants and narration, not for saves.
- Expecting `$event.detail.delta` inside the **consequence template** the hook
  invokes: event detail is available on the hook gate/expression only. Put
  the CON save (or any delta-dependent gate) in `detail_filter_source` when
  ability scores are not required; put ability-score saves in the template
  with a baked DC when scores are required (DC 10 equals the SRD DC for
  damage below 22).
- Expecting `Layer2.TurnStart` hooks to see `actor_id` today — the kind is
  registered but detail fields are not wired into hook evaluation; prefer
  `expires_at_boundary: turn_start` for per-turn counters.
