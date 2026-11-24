# Sibling resource pools each need their OWN predicate-safety seed

(The RH3/RH6/CC1–CC3 worked examples are from the retired Phandelver bundle, deleted in `fd2288bdea` — recover via `git show`, see `archive/README.md`; the rule still holds.)

**Gotcha — seeding one resource pool does NOT seed a sibling pool with the
same shape.** `actor.stat(...)` throws `UnknownField` (excluding the whole
affordance) when no `object_state` fact exists yet for the reading actor —
documented at RH3/RH6 and fixed at CC2 for `phandelver/castle_alert/gate`
(an explicit `[[object_state]]` seed row, since CC1 never writes that pool
until its own tripwire fires). CC1 defines THREE parallel wing pools
(`castle_alert/gate`, `castle_alert/inner`, `castle_alert/posture`) from the
same `[[resource_definitions]]` template, but CC2 only seeded `gate` —
`inner` stayed unseeded until CC3 needed to read it (a kneeling-vs-hidden
posture predicate reading `<= 0` before its own tripwire ever fires) and hit
the identical throw. Authoring a resource pool with `initial_value = 0`
does NOT auto-materialise an `object_state` row for every actor; each
distinct predicate that reads a pool via `<=`/`<` (a default-TRUE gate)
needs its own seed, even when a same-shaped sibling pool already got one.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
