# `actor.stat(...)` and a self-eligible `ModifyResource`'s `TargetActor` only ever read/write the ACTING entity's own row — never a third party

**Gotcha — there is no cross-actor resource read/write shape.** In an
affordance predicate, `actor.stat("your/pool")` reads only the row belonging
to the entity EVALUATING that affordance (the one about to perform the
action) — never some other entity's row, even one co-located or targeted in
the same session. Symmetrically, a self-eligible action's `ModifyResource {
actor = "TargetActor", ... }` writes only the ACTING entity's own row,
because for a self-eligible action `actor == target` by definition. WT1
(`wt1-wyvern-tor.toml`) hit both halves of this in the same beat: four
bugbears' own self-eligible flee actions could not bump a resource meant to
be read off the HERO later (the write landed on each bugbear's own row,
invisible to `hero.stat(...)`), and a follow-up hero action gated on
`actor.stat("wt1_bugbear_fled") >= 1` silently rejected every time because
the hero's own row for that resource was never seeded/written by anyone —
only the bugbears' rows existed. **The fix, same shape both times: route the
write through an action performed BY the entity whose row you need to land
on.** A cross-actor "did X happen to some other entity" signal cannot be
expressed as a predicate read; either have the entity that needs to expose
the fact write its own flag via its own action, or (P5/WT1's precedent) drop
the predicate gate to `predicate_bool = true` and let the walkthrough/caller
drive the timing — the same simplification `phandelver/flee_confrontation`
(P5) already documents for morale.

**Gotcha — for a `self_eligible = false` (targeted) action, `ModifyResource`'s
`actor = "Actor"` vs `actor = "TargetActor"` are NOT interchangeable —
`"Actor"` is the caller, `"TargetActor"` is the entity being manipulated.**
The self-eligible case above collapses this distinction (actor == target by
definition), which makes it easy to copy a self-eligible action's `actor =
"TargetActor"` convention into a NEW targeted action without noticing it now
means something different. WE7's `grab_chest_defended` (hero manipulates the
wraith Mormesk; self_eligible = false) first shipped both frame-writes —
the hero's own HP-drain damage and a hero-owned attempt counter — as `actor =
"TargetActor"`; both silently landed on MORMESK's rows instead of the
hero's, so the hero's `srd/hp` never dropped and the walkthrough's own
attempt-counter assertion failed (caught live, not by inspection). Fix: any
frame-write meant to affect the ACTING entity on a targeted action must say
`actor = "Actor"`; `"TargetActor"` there deliberately means "the other
entity" (WE6's `loot_leader_pouch` already used `"Actor"` correctly for this
exact shape — the bug was in copying the wrong precedent, not a substrate
gap).

**Gotcha — inside a `ModifyResource.delta_source` formula, `target.*` is the
MODIFIED entity (whichever actor THIS write's own `actor` field binds), never
the manipulation's other party.** This is easy to confuse with the same
`target.*` syntax in a PREDICATE, where it genuinely does mean "the entity
this action targets" — the two contexts bind the word differently. `dm/
apply-level-up` (`packages/spellkave-adventure-runtime/src/dm/level-up/render.ts`,
sk-tyhy) shipped `modifyResourceWrite({ actor: "Actor", ... deltaSource:
"target.stat('srd/level') - actor.stat('dm/aldwin/level-up-applied')" })` —
a MANIPULATE action, Aldwin (`actor: "Actor"`) writing his own latch, trying
to read the hero's (the manipulation target's) level to compute the delta.
The action's own predicate, `target.stat('srd/level') > actor.stat(...)`,
resolved fine and the affordance was genuinely offered — but every dispatch
was rejected by the kernel (the `delta_source` evaluation in
the world API)
with `ModifyResource: delta_source
'...' failed to evaluate: UnknownField { subject: Target, field_id:
"srd/level" }`: `Target` never binds here, because this write's own subject
is `"Actor"`, so there is no OTHER entity to be `target.*` inside it. **Fix:
an `Actor`-scoped write cannot read the manipulation's other party at all —
restructure.** Two shapes that work: (1) a CONSTANT delta guarded by a
predicate that already establishes the invariant you need (this fix's own
choice — the predicate already guarantees the hero is exactly one level
ahead of the latch on every dispatch, so `deltaSource: "1"` advances the
latch correctly, one ceremony per level gained, without ever needing to read
the hero's value inside the write); or (2) a `TargetActor`-scoped write,
where `target.*` legitimately means the SAME entity the write modifies (see
the self-eligible gotcha above) — usable only when the value you need to
write already lives on the target's own row.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
