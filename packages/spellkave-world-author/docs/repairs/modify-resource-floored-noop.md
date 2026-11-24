# A `ModifyResource` against an already-floored resource is a silent no-op — use a dedicated counter to prove repeated harm

(The CC5 worked example is from the retired Phandelver bundle, deleted in `fd2288bdea` — recover via `git show`, see `archive/README.md`; the rule still holds.)

Resources clamp at `min_value` (`srd/hp`'s is 0). A consequence that deals
further "damage" to a target ALREADY at 0 HP (e.g. an unconscious hostage,
`core/condition/incapacitated` at `srd/hp=0`) is absorbed by the floor —
the write happens, the value doesn't move, and an assertion expecting the
HP to visibly drop fails even though the mechanism fired correctly (CC5's
`attack_grol_hostage` hostage-harm consequence, hit live: the target's HP
stayed 0 across the "harmful" call). If the claim you need to prove is
"this consequence genuinely ran against this target" rather than "this
target took lethal damage," add a small dedicated counter resource
(`min_value=0`, generous `max_value`, no floor collision) instead of
re-using the floored pool — same `ForEachActorInRadius` + `ModifyResource`
shape, different resource id.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
