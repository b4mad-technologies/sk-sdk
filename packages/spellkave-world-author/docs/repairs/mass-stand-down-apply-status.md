# Mass stand-down: `ForEachActorInRadius` + `ApplyStatus`, not per-entity writes

(The G1/OW1 worked examples (`base/speak-to-room.toml`, `base/ow1-old-owl-well.toml`) are from the retired Phandelver bundle, deleted in `fd2288bdea` — recover via `git show`, see `archive/README.md`; the rule still holds.)

A single deterministic act (e.g. an NPC leader calling off its allies) can
apply a condition to every co-located, tag-matching actor in ONE consequence
— no need to author a hardcoded `ApplyStatus` frame-write per roster member.
G1's `speak_aloud_to_room` (`base/speak-to-room.toml`) already proved
`ForEachActorInRadius` selecting same-node actors and running an `Inscribe`
body per target; OW1 (`base/ow1-old-owl-well.toml`) composes the SAME
selector with `ApplyStatus` instead, filtered by an authored tag:

```toml
frame_write = { ForEachActorInRadius = { center_ref = "ActorSpatialRef", shape_id = "core/area/node_ball", shape_params_json = '{"ball_radius": 0}', predicate_source = "actor.has_tag(\"phandelver.ow1.zombie\")", body = [ { ApplyStatus = { target_kind = "entity", target_ref = "Actor", condition_definition_id = "core/condition/disengaged" } } ] } }
```

`predicate_source` here is the per-target FILTER (evaluated once per
selected actor, `actor` = that actor) — use it to exclude co-located actors
that shouldn't be affected (OW1 excludes the NPC leader itself, which is
co-located but untagged). This scales to any roster size without touching
the manifest as the roster grows; a beat that fights this pattern by writing
N near-identical `ApplyStatus` frame-writes is re-deriving what CR-8 already
wired.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
