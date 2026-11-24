# No manifest knowledge-seed primitive — OR-extend the reading predicate instead

(The RH4/AG1/V2 worked examples are from the retired Phandelver bundle, deleted in `fd2288bdea` — recover via `git show`, see `archive/README.md`; the rule still holds.)

**Gotcha — there is no direct "insert this observer_knowledge row"
primitive.** The observed manifest-time writers are `CopyKnowledgeRow`
(giver-must-know) and co-location at seed time (`learn_at_node`, scanning
`entity_location` at that node) for a GIVER's own knowledge. RH4 hit this first (Mirna sharing a distant heirloom lead) and
recorded it as a substrate observation: co-locating a knowledge-source proxy
at the informant's own node also grants the SAME knowledge to any hero who
later merely visits that node — collapsing the informant's own "share" act
into a no-op negative control. RH4 sidestepped it with a plain resource flag
instead of a real `knows_entity` row.

AG1 hit the identical trap for a DIFFERENT reason: Agatha needed to "know"
Cragmaw Castle (a real entity, anchored far away at
`triboar_trail/cragmaw_approach`) so her divination answer could unlock V2's
existing `march_on_the_stronghold` traversal gate
(`actor.knows_entity($bindings.castle)`) — but co-locating a castle-knowledge
proxy at Agatha's lair would leak it to every hero visiting her, for free.
**The fix, when the payoff needs to reach an EXISTING predicate that already
reads `actor.knows_entity(...)`: OR-extend that predicate with a second,
independent gate** — a plain resource flag the new beat's answer act writes
(`actor.stat("phandelver/ag1_castle_lead_known") >= 1`), added as an
additional `||` clause on the SAME affordance_template. This delivers the
identical observable payoff (the edge now traverses) via a second route key,
without needing a new knowledge-seed primitive and without touching the
proven `knows_entity` branch. **DSL parenthesization caveat:** the grammar
has no generic `(...)` grouping for boolean sub-expressions (only
function-call parens) — `parse_and` loops over `parse_or`-parsed segments, so
OR naturally binds to the LAST AND-segment without needing parens at all:
write `a && b && c || d` to get `a && b && (c || d)`, not `a && b && (c || d)`
literally (that fails to parse — "expected `)`"). See
the AG1 postscript in the deleted Phandelver `base/locate-castle.toml`
(`git show fd2288bdea^:archive/world-fixtures/phandelver/base/locate-castle.toml`).

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
