# Numeric condition modifiers need explicit `effective(...)` consumers

`actor.stat("my/state")` and `target.stat("my/state")` always read the authored
base value. A condition whose `modifier_template_id` composes onto that state is
visible to behavior only through `actor.effective("my/state")` or
`target.effective("my/state")`. Keep a base `stat(...)` check when it proves the
state exists, then use `effective(...)` for the modified comparison. SRD half
cover demonstrates the split: attacks require base `srd/ac >= 1` so cover cannot
make scenery strikeable, but compare the attack roll against effective AC.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
