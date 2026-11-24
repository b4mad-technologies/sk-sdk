# MF-VAL-263's budget requirement narrowed to self-eligible REACTIONS (2026-08-01, PR #2079) — a plain self-target action needs no `spends_channel` or `ModifyResource`

**The rule, as it stands today.** `self_eligible = true` has two independent
meanings on an `[[action_definitions]]` row (see `running-an-authored-act.md`'s
"Self-targeting (ADR-0060)" section for the targeting half). MF-VAL-263
(`validate_self_reaction_resource_refs`, `crates/spellkave-validate/src/refs.rs`)
only cares about the OTHER half: whether this action is also wired into the
§20 reaction producer, i.e. `reaction_eligibility` and/or `reaction_trigger` is
set (ADR-0050 "self-reaction-resolution-flip" — the acting entity admitted as
its own reactor, e.g. Legendary Resistance or the shipped
`srd/heroic_inspiration/reroll`). **Only for that reaction-wired shape** must
the action spend a real `spends_channel`, or its `on_success` chain write a
`ModifyResource` budget somewhere (including nested inside a
`ForEachActorInRadius` body) — no budget resource, no admission:

```
MF-VAL-263: self_eligible action_definition '<id>' on_success '<id>/success'
has no ModifyResource budget resource
```

**Solo self reactions.** With `self_eligible = true`, the acting entity is a
reaction candidate even when no seated peer shares its place. The authored
trigger, eligibility predicate and budget still decide whether its window
opens. Do not add a peer merely to activate a self reaction: the production proof in
`packages/spellkave-test-lab/src/live.solo-self-reaction.local-node.test.ts`
covers the solo case, the non-self negative control and peer deduplication.
It also pins the existing seatless-self bypass after a previously admitted
stochastic act loses its seat; the interim seatless-policy replacement is
tracked by `sk-dhu`.

**Why reactions still need a budget.** A reusable self reaction needs an
authored cost rather than a free outcome flip. The commit-driven path does
not use `REACTION_MAX_DEPTH` to meter later self-triggering acts (ADR-0050),
so budget a self reaction with `spends_channel` or a `ModifyResource` write
reachable from `on_success`, as `srd/heroic_inspiration/reroll` does. The
validator's `validate_self_reaction_resource_refs` and MF-VAL-263 tests in
`crates/spellkave-validate/src/refs.rs` anchor this requirement.

**What changed 2026-08-01 (finding #73,
`packages/spellkave-srd-cc/ledger/designs/prone-free-action.md` Slice A,
PR #2079).** Before this date the same budget requirement fired on EVERY
`self_eligible` action, including ones with no reaction wiring at all — a
plain self-targeted action like the SRD's Dropping Prone ("you can give
yourself the Prone condition ... without using an action or any of your
Speed"), which spends nothing by design. That shape is now valid — the
live srd-cc row
(`packages/spellkave-srd-cc/fixtures/base/playing-the-game/drop-prone.toml:14-27`):

```toml
[[action_definitions]]
action_id = "srd/movement/drop-prone"
bundle_id = "srd"
cost_time_ms = 0
description = "You give yourself the Prone condition without spending an action or Speed, unless your Speed is already 0."
display_name = "Drop Prone"
on_failure = ""
on_success = "srd/movement/drop-prone/success"
required_capability = "srd/action/drop-prone"
resolution_mode = "Deterministic"
resolution_predicate_source = ""
resumable = false
self_eligible = true
self_only = true
session_def_id = ""
# no spends_channel, no reaction_eligibility/reaction_trigger — genuinely free
```

If your `self_eligible` action has neither `reaction_eligibility` nor
`reaction_trigger` set, MF-VAL-263 no longer applies to it. If it does have
either set, the budget rule above is unchanged.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
