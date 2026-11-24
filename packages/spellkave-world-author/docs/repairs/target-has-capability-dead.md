# `target.has_capability(...)` is dead — capability facts are Actor-only; gate a TARGET's kind via `target.has_niche(...)` (an entity-def tag) instead

(The `ambush-loot.toml` worked example is from the retired Phandelver bundle, deleted in `fd2288bdea` — recover via `git show`, see `archive/README.md`; the rule still holds.)

**Gotcha — `target.has_capability(...)` parses and seeds cleanly, then never
derives an affordance.** `has_capability` is a subject-generic DSL primitive
(`crates/spellkave-dsl/src/lib.rs`'s `parse_method_bool` admits any subject
for it), so `target.has_capability("my/thing")` is syntactically valid — but
the world API's
`manipulation_facts` (the function that builds the DSL evaluation context for
every candidate target) only ever inserts `DslSubjectRef::Actor` facts into
`capabilities` — from the invoking actor's `actor_capabilities` grants and the
Actor arm of `item_definition_facts`. It inserts no `Target` capability
fact, so in an **affordance predicate** `target.has_capability(...)` is
always `false`, silently — it validates, seeds, and never fires. (Other
evaluation paths differ: reaction eligibility adds the target's folded
capabilities, the world API,
and roll-bias condition gates add its raw `capability` rows,
`selection/entity_facts.rs:83-110`; decision `sk-jay0.2.48`.) Author "this target entity affords being acted on as an
X" the way `ambush-loot.toml`'s `gatherable_horses` niche already does: tag
the target's `entity_def_id` with an `entity_definition_tag` row and gate on
`target.has_niche('<the tag string>')` — entity-def tags DO feed the `Target`
niche facts `manipulation_facts` builds. Capabilities stay Actor-only by
design (they answer "can the ACTOR do X", not "does the TARGET afford X").
**Caught automatically since #1846:** `sk lint`'s
`dead-target-capability` rule flags `target.has_capability(` in any
`*predicate_source` field.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
