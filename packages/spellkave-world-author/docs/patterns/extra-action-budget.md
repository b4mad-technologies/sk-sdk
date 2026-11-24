# Extra action budget (one-shot channel grant)

## Name

`extra-action-budget` — Extra action budget (one-shot channel grant)

## Problem

I need a feature that gives the actor one extra action this round (Action Surge), without inventing a new kernel primitive.

## Forces

- Standing haste-like bonuses should recompute every gate for as long as a condition holds.
- One-shot "this round only" grants must evaporate on window rollover and must not leak.
- Suppression (incapacitated FlatSet(0) on a channel) must still win over a positive grant.
- Authors keep searching for a missing GrantAction arm and filing kernel gaps.

## Solution

Use `ModifyChannel` on the success consequence to grant one full (or signed)
pool of an existing economy channel for the current window. Spend any charge
resource in the same consequence. Documented in
[`action-economy.md`](../action-economy.md) §"Grant one-shot extra budget with ModifyChannel".
Do **not** open a substrate verdict for Action Surge until this pattern is tried.

## TOML example

Copied from `packages/spellkave-world-author/docs/action-economy.md (canonical shape; wire into srd/fighter/action-surge via packages/spellkave-srd-cc/src/chapters/classes/index.ts `buildActionSurgeFragment`)`:

```toml
[[consequence_frame_writes]]
template_id = "mybundle/ability/second_wind_of_action"
ordinal = 0
frame_write = { ModifyChannel = { actor = "Actor", channel = "mybundle/channel/primary" } }
```

## Proof

`crates/spellkave-validate/tests/cross_row_refs.rs` (ModifyChannel.channel MF-VAL-312); live channel grant logic in the world API. Fighter charge spend: `packages/spellkave-srd-cc/src/test/offline/martial-features-coverage.test.ts`.

## Related

[action-economy](../action-economy.md), [condition-grant-and-suppression](./condition-grant-and-suppression.md) (suppression beats grant).

## Known misuse / anti-pattern

Filing Action Surge / Indomitable-as-extra-action as a kernel gap without trying ModifyChannel. Using a negative ModifyChannel to model 'cannot act' (use condition FlatSet / capability suppression instead).

## SRD features that use this

- Fighter **Action Surge** (classes.md Level 2) — charge resource is live; extra Primary-channel grant is this pattern.
- Any one-shot 'act again this round' class feature.
