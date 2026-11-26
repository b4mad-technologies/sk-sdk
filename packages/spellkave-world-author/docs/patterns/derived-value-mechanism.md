# Derived value mechanism (macro vs baked stat vs effective vs literal)

## Name

`derived-value-mechanism` — Which mechanism computes a number

## Problem

I have a number that is computed rather than stored (a proficiency bonus, an ability modifier, a DC) — which mechanism do I author it with, and where is each one illegal?

## Forces

- Some subjects have a live feeding fact (a PC's level); others have none at
  run time (a monster's CR is documentary), so one rule may need two
  routes.
- `ModifyResource.delta_source`/`ModifyChannel.delta_source` are parsed
  act-time with the SAME world macro closure the validator already admits
  them against (`crates/spellkave-validate/src/refs.rs`'s
  `check_frame_write_dsl_expr`) — a `macro(...)` there resolves against
  live `dsl_macro_definition` rows the same way a resolution predicate
  does; only an UNDEFINED macro id still fails closed
  (`MF-DSL-MACRO-UNKNOWN`).
- Macro bodies are leaf-only — a macro cannot call another macro;
  composition happens at the call site.
- `stat(...)` / `effective(...)` fail **closed** on an absent fact
  (`UnknownField`); `has_tag` / `has_capability` / `has_item` / `has_niche`
  fail **open** (`false`).
- Integer division truncates toward zero, not floor.

## Solution

Four mechanisms; pick the FIRST row that matches:

| The number is… | Use | Row kind / read |
|---|---|---|
| adjusted by active conditions / equipment at read time (AC, roll bias) | `effective(...)` over a seeded base | effective-int read |
| applied CONDITIONALLY and a live feeding fact exists on the reader | DSL macro inside `cond(...)` | `dsl_macro_definitions`; `macro('<id>', <arg>)` |
| an UNCONDITIONAL per-entity constant read by archetypes shared across subjects with and without a feeding fact | **baked stat**, seeded per entity, fail-closed | `resource_definitions` + `entity_definition_initial_state`; `actor.stat('<id>')` |
| a task-shaped, scene-owned fact (this cliff is DC 15) | authored literal | plain number in the row |
| a constant the SOURCE declares on one item, which no feeding fact of its wielder reproduces (Specter Life Drain "7 (2d6)" with Strength 1) | source-derived literal in that item's own slot, generated from the stat block and never typed | `entity_definition_item_dsl_source`, e.g. `2d6 + (0)` |
| an entity-shaped fact (this guard's stubbornness) | NEVER a literal — one of the three above | — |

Where both a macro and a baked route encode the same rule, the generator
reads ONE source table for both so they cannot disagree; the two ids may
share a literal (one concept, two row kinds — separate tables, no
collision) but they are different reads: grep for both when auditing.

Where macros are legal: any gate-shaped int/bool predicate
(`resolution_predicate_source`, `order_roll_source`, offer predicates),
`entity_definition_item_dsl_source.source` (item slots, `MF-VAL-318` parse / `MF-VAL-329` unresolved `stat`/`effective` ids), and
— as of sk-awlo — `ModifyResource.delta_source`/`ModifyChannel.delta_source`
(the world API
parse with `act_time_compiler_definitions(ctx)`, the same act-time world
closure `order_roll_source`/`movement_cost_expression_source` use). Prefer
the item slot for reusable ATTACKER math shared across many weapons/actions
([`item-sourced-damage`](./item-sourced-damage.md)); a `delta_source`
macro call is for a one-off, non-item-sourced number (a class-feature
heal/damage formula, a channel budget grant) that doesn't warrant its own
item slot.

Rounding: floor-shaped formulas need the correction idiom
`+ cond(rem < 0, -1, 0)`; truncation-shaped ones must NOT get it.

Storage: per-actor numeric facts are `resource_definitions` (`stat` /
`effective` ids must resolve to a kernel fact, a `resource_definitions` row
or an `object_state_definitions` row — `MF-VAL-329`,
`crates/spellkave-validate/src/refs.rs:86-92`); `max_value` is a safety ceiling, the real
per-instance value is an explicit initial-state seed; `ModifyResource`
auto-seeds an absent row from `initial_value`. A predicate that reads
`stat`/`effective` on a target therefore **declares a seed precondition** —
guarantee the seed in the definition, never re-introduce an offer-predicate
gate for it (a target-fact read in an offer predicate also forces `Place`
locality).

## TOML example

Copied from `packages/spellkave-srd-cc/fixtures/base/equipment/weapons/dagger.toml`
(macro on an item slot) and
`packages/spellkave-srd-cc/fixtures/base/playing-the-game/attacks.toml`
(baked stat + `effective` in a resolution predicate):

```toml
[[entity_definition_item_dsl_source]]
bundle_id = "srd"
entity_def_id = "srd/weapon/dagger"
slot = "srd/damage"
source = "1d4 + (max(macro('srd/strength_modifier'), macro('srd/dexterity_modifier')))"

[[action_definitions]]
action_id = "srd/attack/melee"
resolution_mode = "Stochastic"
resolution_predicate_source = "let attack_roll = d20; macro('srd/attack_roll_hits', attack_roll, attack_roll + macro('srd/ability_modifier', cond(actor.equipped_item('srd/slot/main-hand').has_tag('srd.weapon.property.finesse'), max(actor.effective('srd/str'), actor.effective('srd/dex')), actor.effective('srd/str'))) + (actor.stat('srd/proficiency_bonus')), (target.effective('srd/ac')), cond(actor.has_capability('srd/class-feature/fighter/champion/improved-critical'), 19, 20))"
```

## Proof

- `packages/spellkave-srd-cc/src/test/offline/modifier-units.test.ts` and
  `attack-roll-units.test.ts` (rounding shapes, macro bodies)
- `packages/spellkave-srd-cc/src/test/offline/derived-units.test.ts`
  (passive perception and provenance; its note that spell save DC is
  deferred is stale)
- `crates/spellkave-validate/src/lib.rs:3625-3643` (`MF-VAL-318`: item
  slots are macro-aware) and `crates/spellkave-validate/tests/cross_row_refs.rs`
  (`MF-VAL-329` unresolved `stat`/`effective` ids)
- the world API's
  `delta_source_macro_call_resolves_with_definition_present_and_fails_without`
  (sk-awlo) — a `delta_source` calling `macro('t/one')` resolves when the
  definition is live and still fails closed with `MF-DSL-MACRO-UNKNOWN`
  when it is not. The test drives the parser with a hand-built macro list;
  it does not read live `dsl_macro_definition` rows, so the act-time wiring
  itself has no direct test

## Related

[`dsl-grammar`](../dsl-grammar.md) (`cond`, `let`, `macro`, `stat`,
`effective`), [`computed-literal`](./computed-literal.md) (a number
computed outside the DSL entirely),
[`effective-condition-modifiers`](../repairs/effective-condition-modifiers.md),
[`sibling-resource-predicate-seeds`](../repairs/sibling-resource-predicate-seeds.md),
[`item-sourced-damage`](./item-sourced-damage.md).

## Known misuse / anti-pattern

- Migrating a call site from the macro route to the stat route without
  checking what the affected entities seed (a five-hour all-attacks outage
  was exactly this: fail-closed doing its job).
- A literal for an entity-shaped fact, or N difficulty tiers × M skills as
  generated rows — one generic row plus world state.
- A second mutable "proficiency bonus" row on a PC that creation must keep
  in sync with level (derived state is derived).
- Applying the floor-correction idiom to a truncation formula (breaks the
  lowest band).
- **A `ForEachActorInRadius` body predicate ordering `stat(...)`/`effective(...)`
  before `has_tag`/`has_capability`/etc.** (sk-awlo, 2026-08-23). Such a
  predicate is evaluated against EVERY actor co-located with the frame
  write's center, not just the intended subject — a fail-closed `stat` read
  on a bystander that never bound that resource (a training dummy, an
  object, a corpse) throws `UnknownField`. Before sk-pgsm that aborted the
  WHOLE consequence, including an earlier legitimate write on the real
  target (`srd/attack/unarmed-strike/damage/success`'s HP subtraction rolled
  back when the Monster Death guard, ordered second, threw on a co-located
  training dummy). Today the loop skips that bystander and records a hidden
  `write_failure` provenance row; parse errors and other evaluation errors
  still abort (the world API).
  A skipped bystander is still a silently unapplied guard, so the rule
  stands: inside a `ForEachActorInRadius` predicate, always test a
  fail-open set-membership fact FIRST — `&&` short-circuits left-to-right, so
  an untagged/uncapable bystander never reaches the fail-closed read at all.
  A single-subject (non-radius) guard is NOT at risk this way — the target is
  always a real, resolved subject — so this rule is specific to radius/
  multi-candidate predicates, not derived-value authoring generally.

## SRD features that use this

- **Spell save DC / spell attack** = 8+PB+spellcasting_mod / PB+mod (srd-cc L12d).


- Proficiency Bonus (macro from `srd/level` for PCs, baked from CR for
  monsters), the six ability-modifier macros, AC via `effective`, DCs as
  scene literals. SRD tables, ids and the PC-level/monster-CR rule:
  `derived-values.md` (`@spellkave/srd-cc` docs, not in this repository).
