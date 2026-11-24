# Any consequence containing `ApplyStatus` acquires a 10-tick claim-lock on its target — a second actor's manipulate against that same target can hit `claim_contended`

`r_manipulate` classifies a resolved action's consequence as *steering-shaped*
whenever any of its frame writes is `ApplyStatus`, `RemoveCondition`,
`InsertModifier`, or an item-manipulation op — `ModifyResource { actor:
"TargetActor" }` alone is the only thing that stays non-steering
(`steering_claim.rs`). A steering-shaped consequence makes the ACTING actor
acquire a `core/condition/controlled` claim-lock (`controlled_by:<actor
entity id>`, 10-tick TTL) on its TARGET as a side effect — this has been true
of every lethal attack since #1508 (the ordinal-1 `ApplyStatus` write), not
something a new beat introduces. In normal (unpaused) play the claim expires
naturally between actions; anything that pauses world ticks (the SDK's
`pauseWorldTicks()`) freezes the world clock, so the claim never expires on
its own. (The original worked example was the walkthrough helper
`prepareDeterministicBeat()`, which unconditionally paused ticks; it now
exists only under `archive/apps/world-walkthrough/` — the mechanism is
unchanged.) Concretely: actor A attacks actor B
(B now claimed by A). A later action authored with `self_only = true` lets B
act on themself without acquiring or contending on that target claim; A's claim
remains unchanged. A steering-shaped manipulation from any OTHER actor still
contends normally. Release a claim only when its steering relationship is
actually over, not as setup for a self-only verb. Diagnose genuine contention
via `evaluation_provenance.failure_kind = "claim_contended"`
(`just sql "SELECT * FROM evaluation_provenance"`), not by staring at the
predicate — the affordance itself is fine.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
